import express from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/index.js';
import { getAdminAnalytics, listUsersAdmin, updateUserByAdmin } from '../controllers/adminController.js';

const adminRouter = express.Router();

adminRouter.get('/users', [authMiddleware, adminMiddleware], listUsersAdmin);
adminRouter.patch('/users/:id', [authMiddleware, adminMiddleware], updateUserByAdmin);
adminRouter.get('/analytics', [authMiddleware, adminMiddleware], getAdminAnalytics);

export default adminRouter;
