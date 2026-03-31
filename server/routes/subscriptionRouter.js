import express from 'express';
import {
	cancelSubscription,
	createCheckoutSession,
	createPortalSession,
	getSubscriptionStatus
} from '../controllers/subscriptionController.js';
import { authMiddleware } from '../middleware/index.js';

const subscriptionRouter = express.Router();

subscriptionRouter.post('/checkout', authMiddleware, createCheckoutSession);
subscriptionRouter.get('/status', authMiddleware, getSubscriptionStatus);
subscriptionRouter.post('/cancel', authMiddleware, cancelSubscription);
subscriptionRouter.post('/portal', authMiddleware, createPortalSession);

export default subscriptionRouter;
