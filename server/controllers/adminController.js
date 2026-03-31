import { query } from '../services/database.js';
import { sendEmail } from '../services/mailer.js';

export const listUsersAdmin = async (req, res) => {
	try {
		const { page = 1, limit = 10, search, role, country, sub_status } = req.query;

		const pageNum = Math.max(1, Number(page) || 1);
		const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
		const offset = (pageNum - 1) * limitNum;

		const filters = [];
		const values = [];
		let index = 1;

		if (search) {
			filters.push(`(u.email ILIKE $${index} OR u.full_name ILIKE $${index})`);
			values.push(`%${search}%`);
			index++;
		}

		if (role) {
			filters.push(`u.role = $${index}`);
			values.push(role);
			index++;
		}

		if (country) {
			filters.push(`u.country = $${index}`);
			values.push(country);
			index++;
		}

		if (sub_status) {
			filters.push(`latest_sub.status = $${index}`);
			values.push(sub_status);
			index++;
		}

		const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

		const countResult = await query(
			`SELECT COUNT(*)::int AS total
			 FROM users u
			 LEFT JOIN LATERAL (
				SELECT s.status
				FROM subscriptions s
				WHERE s.user_id = u.id
				ORDER BY s.id DESC
				LIMIT 1
			 ) latest_sub ON true
			 ${whereClause}`,
			values
		);

		const users = await query(
			`SELECT
				u.id,
				u.email,
				u.full_name,
				u.role,
				u.country,
				u.charity_id,
				u.charity_pct,
				u.created_at,
				latest_sub.plan AS subscription_plan,
				latest_sub.status AS subscription_status,
				latest_sub.amount_pence AS subscription_amount_pence,
				latest_sub.current_period_end AS subscription_current_period_end
			 FROM users u
			 LEFT JOIN LATERAL (
				SELECT s.plan, s.status, s.amount_pence, s.current_period_end
				FROM subscriptions s
				WHERE s.user_id = u.id
				ORDER BY s.id DESC
				LIMIT 1
			 ) latest_sub ON true
			 ${whereClause}
			 ORDER BY u.created_at DESC
			 LIMIT $${index} OFFSET $${index + 1}`,
			[...values, limitNum, offset]
		);

		return res.json({
			data: users.rows,
			pagination: {
				page: pageNum,
				limit: limitNum,
				total: countResult.rows[0].total
			}
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error.' });
	}
};

export const updateUserByAdmin = async (req, res) => {
	const { id } = req.params;
	let userFieldsChanged = [];
	let subFieldsChanged = [];

	try {
		const userExists = await query('SELECT id FROM users WHERE id = $1', [id]);
		if (userExists.rows.length === 0) {
			return res.status(404).json({ message: 'User not found.' });
		}

		const allowedUserFields = ['email', 'full_name', 'role', 'country', 'charity_id', 'charity_pct'];
		const userKeys = Object.keys(req.body).filter((key) => allowedUserFields.includes(key));

		if (userKeys.length > 0) {
			const setClauses = [];
			const userValues = [];
			userFieldsChanged = userKeys;

			userKeys.forEach((key, i) => {
				setClauses.push(`${key} = $${i + 1}`);
				userValues.push(req.body[key]);
			});

			userValues.push(id);

			await query(
				`UPDATE users
				 SET ${setClauses.join(', ')}
				 WHERE id = $${userValues.length}`,
				userValues
			);
		}

		const subscriptionPayload = req.body.subscription || req.body;
		const allowedSubFields = ['plan', 'status', 'amount_pence', 'current_period_end', 'canceled_at'];
		const subKeys = allowedSubFields.filter((field) => subscriptionPayload[field] !== undefined);

		if (subKeys.length > 0) {
			subFieldsChanged = subKeys;
			const latestSub = await query(
				'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
				[id]
			);

			if (latestSub.rows.length === 0) {
				const fields = ['user_id', ...subKeys];
				const values = [id, ...subKeys.map((key) => subscriptionPayload[key])];
				const placeholders = fields.map((_, i) => `$${i + 1}`);

				await query(
					`INSERT INTO subscriptions (${fields.join(', ')})
					 VALUES (${placeholders.join(', ')})`,
					values
				);
			} else {
				const setClauses = [];
				const values = [];

				subKeys.forEach((key, i) => {
					setClauses.push(`${key} = $${i + 1}`);
					values.push(subscriptionPayload[key]);
				});

				values.push(latestSub.rows[0].id);

				await query(
					`UPDATE subscriptions
					 SET ${setClauses.join(', ')}
					 WHERE id = $${values.length}`,
					values
				);
			}
		}

		const updatedUser = await query(
			`SELECT
				u.id,
				u.email,
				u.full_name,
				u.role,
				u.country,
				u.charity_id,
				u.charity_pct,
				latest_sub.plan AS subscription_plan,
				latest_sub.status AS subscription_status,
				latest_sub.amount_pence AS subscription_amount_pence,
				latest_sub.current_period_end AS subscription_current_period_end,
				latest_sub.canceled_at AS subscription_canceled_at
			 FROM users u
			 LEFT JOIN LATERAL (
				SELECT s.plan, s.status, s.amount_pence, s.current_period_end, s.canceled_at
				FROM subscriptions s
				WHERE s.user_id = u.id
				ORDER BY s.id DESC
				LIMIT 1
			 ) latest_sub ON true
			 WHERE u.id = $1`,
			[id]
		);

		try {
			if (updatedUser.rows[0]?.email && (userFieldsChanged.length > 0 || subFieldsChanged.length > 0)) {
				const changeLines = [
					userFieldsChanged.length > 0 ? `User profile fields updated: ${userFieldsChanged.join(', ')}` : null,
					subFieldsChanged.length > 0 ? `Subscription fields updated: ${subFieldsChanged.join(', ')}` : null
				].filter(Boolean);

				await sendEmail(
					updatedUser.rows[0].email,
					'Account System Update',
					`Hi ${updatedUser.rows[0].full_name || 'there'},\n\nAn administrator updated your account settings.\n${changeLines.join('\n')}`,
					`<p>Hi ${updatedUser.rows[0].full_name || 'there'},</p><p>An administrator updated your account settings.</p><p>${changeLines.join('<br/>')}</p>`
				);
			}
		} catch (notifyErr) {
			console.error('System update email notification failed:', notifyErr);
		}

		return res.json({
			message: 'User updated successfully.',
			user: updatedUser.rows[0]
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error.' });
	}
};

export const getAdminAnalytics = async (req, res) => {
	try {
		const [usersCount, drawStats, charityTotals, poolTotals, winnerTotals, activeSubs] = await Promise.all([
			query('SELECT COUNT(*)::int AS total_users FROM users'),
			query(`
				SELECT
					COUNT(*)::int AS total_draws,
					COUNT(*) FILTER (WHERE status = 'published')::int AS published_draws
				FROM draws
			`),
			query('SELECT COALESCE(SUM(total_received), 0)::bigint AS charity_total_received_pence FROM charities'),
			query('SELECT COALESCE(SUM(pool_total_pence), 0)::bigint AS cumulative_pool_pence FROM draws'),
			query(`
				SELECT
					COALESCE(SUM(prize_pence), 0)::bigint AS total_prize_pence,
					COALESCE(SUM(prize_pence) FILTER (WHERE payout_status = 'paid'), 0)::bigint AS paid_prize_pence,
					COUNT(*) FILTER (WHERE verify_status = 'pending')::int AS pending_verifications
				FROM winners
			`),
			query(`
				SELECT COUNT(*)::int AS active_subscriptions
				FROM (
					SELECT DISTINCT ON (user_id) user_id, status
					FROM subscriptions
					ORDER BY user_id, id DESC
				) s
				WHERE s.status = 'active'
			`)
		]);

		return res.json({
			kpis: {
				total_users: usersCount.rows[0].total_users,
				active_subscriptions: activeSubs.rows[0].active_subscriptions,
				total_draws: drawStats.rows[0].total_draws,
				published_draws: drawStats.rows[0].published_draws,
				cumulative_pool_pence: poolTotals.rows[0].cumulative_pool_pence,
				charity_total_received_pence: charityTotals.rows[0].charity_total_received_pence,
				total_prize_pence: winnerTotals.rows[0].total_prize_pence,
				paid_prize_pence: winnerTotals.rows[0].paid_prize_pence,
				pending_winner_verifications: winnerTotals.rows[0].pending_verifications
			}
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error.' });
	}
};
