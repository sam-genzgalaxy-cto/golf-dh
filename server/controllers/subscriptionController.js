import Stripe from 'stripe';
import { query } from '../services/database.js';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const mapPlanToPriceId = (plan, explicitPriceId) => {
	if (explicitPriceId) {
		return explicitPriceId;
	}

	if (plan === 'monthly') {
		return process.env.STRIPE_PRICE_MONTHLY;
	}

	if (plan === 'yearly') {
		return process.env.STRIPE_PRICE_YEARLY;
	}

	return null;
};

const mapStripeSubStatus = (status) => {
	if (status === 'active' || status === 'trialing') {
		return 'active';
	}
	if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
		return 'canceled';
	}
	return 'lapsed';
};

export const createCheckoutSession = async (req, res) => {
	const userId = req.user.userId;
	const { plan = 'monthly', priceId, success_url, cancel_url } = req.body;

	try {
		const userResult = await query(
			`SELECT u.id, u.email,
					(SELECT s.stripe_customer_id FROM subscriptions s WHERE s.user_id = u.id ORDER BY s.id DESC LIMIT 1) AS stripe_customer_id
			 FROM users u
			 WHERE u.id = $1`,
			[userId]
		);

		if (userResult.rows.length === 0) {
			return res.status(404).json({ message: 'User not found.' });
		}

		const user = userResult.rows[0];
		const resolvedPriceId = mapPlanToPriceId(plan, priceId);

		if (!resolvedPriceId) {
			return res.status(400).json({ message: 'Valid plan or priceId is required.' });
		}

		let customerId = user.stripe_customer_id;
		if (!customerId) {
			const customer = await stripe.customers.create({
				email: user.email,
				metadata: { userId: String(userId) }
			});
			customerId = customer.id;
		}

		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			customer: customerId,
			line_items: [{ price: resolvedPriceId, quantity: 1 }],
			success_url: success_url || process.env.STRIPE_CHECKOUT_SUCCESS_URL,
			cancel_url: cancel_url || process.env.STRIPE_CHECKOUT_CANCEL_URL,
			metadata: {
				userId: String(userId),
				plan
			}
		});

		return res.status(201).json({
			message: 'Checkout session created.',
			sessionId: session.id,
			url: session.url
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error.' });
	}
};

export const getSubscriptionStatus = async (req, res) => {
	const userId = req.user.userId;

	try {
		const current = await query(
			`SELECT id, user_id, stripe_sub_id, stripe_customer_id, plan, status, amount_pence, current_period_end, canceled_at
			 FROM subscriptions
			 WHERE user_id = $1
			 ORDER BY id DESC
			 LIMIT 1`,
			[userId]
		);

		if (current.rows.length === 0) {
			return res.json({
				subscribed: false,
				subscription: null
			});
		}

		const sub = current.rows[0];
		return res.json({
			subscribed: sub.status === 'active',
			subscription: sub
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error.' });
	}
};

export const cancelSubscription = async (req, res) => {
	const userId = req.user.userId;

	try {
		const current = await query(
			`SELECT id, stripe_sub_id, status
			 FROM subscriptions
			 WHERE user_id = $1
			 ORDER BY id DESC
			 LIMIT 1`,
			[userId]
		);

		if (current.rows.length === 0 || !current.rows[0].stripe_sub_id) {
			return res.status(404).json({ message: 'No Stripe subscription found for user.' });
		}

		const stripeSubId = current.rows[0].stripe_sub_id;
		await stripe.subscriptions.cancel(stripeSubId);

		await query(
			`UPDATE subscriptions
			 SET status = 'canceled', canceled_at = NOW()
			 WHERE id = $1`,
			[current.rows[0].id]
		);

		return res.json({ message: 'Subscription canceled successfully.' });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error.' });
	}
};

export const createPortalSession = async (req, res) => {
	const userId = req.user.userId;
	const { return_url } = req.body;

	try {
		const current = await query(
			`SELECT stripe_customer_id
			 FROM subscriptions
			 WHERE user_id = $1 AND stripe_customer_id IS NOT NULL
			 ORDER BY id DESC
			 LIMIT 1`,
			[userId]
		);

		if (current.rows.length === 0) {
			return res.status(404).json({ message: 'No Stripe customer found for this user.' });
		}

		const portalSession = await stripe.billingPortal.sessions.create({
			customer: current.rows[0].stripe_customer_id,
			return_url: return_url || process.env.STRIPE_PORTAL_RETURN_URL
		});

		return res.status(201).json({
			message: 'Portal session created.',
			url: portalSession.url
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error.' });
	}
};

const upsertSubscriptionFromStripe = async ({
	userId,
	stripeSubId,
	stripeCustomerId,
	plan,
	status,
	amountPence,
	currentPeriodEnd,
	canceledAt
}) => {
	const existing = await query(
		'SELECT id FROM subscriptions WHERE stripe_sub_id = $1 LIMIT 1',
		[stripeSubId]
	);

	if (existing.rows.length > 0) {
		await query(
			`UPDATE subscriptions
			 SET user_id = $1,
				 stripe_customer_id = $2,
				 plan = $3,
				 status = $4,
				 amount_pence = $5,
				 current_period_end = $6,
				 canceled_at = $7
			 WHERE id = $8`,
			[userId, stripeCustomerId, plan, status, amountPence, currentPeriodEnd, canceledAt, existing.rows[0].id]
		);
		return;
	}

	await query(
		`INSERT INTO subscriptions (user_id, stripe_sub_id, stripe_customer_id, plan, status, amount_pence, current_period_end, canceled_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[userId, stripeSubId, stripeCustomerId, plan, status, amountPence, currentPeriodEnd, canceledAt]
	);
};

export const handleStripeWebhook = async (req, res) => {
	const signature = req.headers['stripe-signature'];

	if (!signature) {
		return res.status(400).send('Missing stripe-signature header');
	}

	let event;
	try {
		event = stripe.webhooks.constructEvent(
			req.body,
			signature,
			process.env.STRIPE_WEBHOOK_SECRET
		);
	} catch (err) {
		console.error('Stripe webhook signature verification failed:', err.message);
		return res.status(400).send(`Webhook Error: ${err.message}`);
	}

	try {
		if (event.type === 'checkout.session.completed') {
			const session = event.data.object;
			const userId = Number(session.metadata?.userId);
			if (!userId || !session.subscription) {
				return res.status(200).json({ received: true });
			}

			const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
			await upsertSubscriptionFromStripe({
				userId,
				stripeSubId: stripeSubscription.id,
				stripeCustomerId: stripeSubscription.customer,
				plan: session.metadata?.plan || 'monthly',
				status: mapStripeSubStatus(stripeSubscription.status),
				amountPence: stripeSubscription.items.data[0]?.price?.unit_amount || null,
				currentPeriodEnd: stripeSubscription.current_period_end
					? new Date(stripeSubscription.current_period_end * 1000)
					: null,
				canceledAt: null
			});
		}

		if (event.type === 'invoice.payment_succeeded') {
			const invoice = event.data.object;
			if (invoice.subscription) {
				await query(
					`UPDATE subscriptions
					 SET status = 'active',
						 amount_pence = $1,
						 current_period_end = COALESCE(to_timestamp($2), current_period_end)
					 WHERE stripe_sub_id = $3`,
					[invoice.amount_paid || null, invoice.period_end || null, invoice.subscription]
				);
			}
		}

		if (event.type === 'invoice.payment_failed') {
			const invoice = event.data.object;
			if (invoice.subscription) {
				await query(
					`UPDATE subscriptions
					 SET status = 'lapsed'
					 WHERE stripe_sub_id = $1`,
					[invoice.subscription]
				);
			}
		}

		if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
			const subscription = event.data.object;
			const mappedStatus = mapStripeSubStatus(subscription.status);
			const canceledAt = subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null;

			await query(
				`UPDATE subscriptions
				 SET status = $1,
					 current_period_end = COALESCE(to_timestamp($2), current_period_end),
					 canceled_at = $3
				 WHERE stripe_sub_id = $4`,
				[mappedStatus, subscription.current_period_end || null, canceledAt, subscription.id]
			);
		}

		return res.status(200).json({ received: true });
	} catch (err) {
		console.error('Stripe webhook processing failed:', err);
		return res.status(500).json({ message: 'Webhook processing failed.' });
	}
};
