import express from 'express';
import { authMiddleware, adminMiddleware, subsMiddleware } from '../middleware/index.js';
import {
    listCharities,
    getCharityById,
    selectUserCharity,
    updateContribution,
    donateToCharity,
    addCharity,
    editCharity,
    removeCharity
} from '../controllers/charityController.js';

const charityRouter = express.Router();

charityRouter.get('', listCharities);
charityRouter.get('/:id', getCharityById);


charityRouter.post('/donate', authMiddleware, donateToCharity);


charityRouter.post('/select', [authMiddleware, subsMiddleware], selectUserCharity);
charityRouter.post('/contribution', [authMiddleware, subsMiddleware], updateContribution);


// Admin routes


charityRouter.post('/admin', [authMiddleware, adminMiddleware], addCharity);
charityRouter.post('/admin/:id', [authMiddleware, adminMiddleware], editCharity);
charityRouter.delete('/admin/:id', [authMiddleware, adminMiddleware], removeCharity);

export default charityRouter;
