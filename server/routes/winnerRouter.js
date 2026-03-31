import express from 'express';
import { authMiddleware, adminMiddleware, subsMiddleware } from '../middleware/index.js';
import {
    uploadProof,
    getMyWinnings,
    listPendingVerifications,
    verifyWinner,
    markAsPaid
} from '../controllers/winnerController.js';

const winnerRouter = express.Router();

winnerRouter.post('/proof', [authMiddleware, subsMiddleware], uploadProof);
winnerRouter.get('/my', [authMiddleware, subsMiddleware], getMyWinnings);

// Admin routes

winnerRouter.get('/admin', [authMiddleware, adminMiddleware], listPendingVerifications);
winnerRouter.post('/admin/:id/verify', [authMiddleware, adminMiddleware], verifyWinner);
winnerRouter.patch('/admin/:id/payout', [authMiddleware, adminMiddleware], markAsPaid);

export default winnerRouter;
