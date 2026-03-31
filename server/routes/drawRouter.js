import express from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/index.js';
import {
	getDraws,
	getDrawById,
	currentDraw,
	simulateDraw,
	executeDraw,
	updateDrawConfig
} from '../controllers/drawController.js';

const drawRouter = express.Router();

drawRouter.get('/', getDraws);
drawRouter.get('/current', currentDraw);
drawRouter.get('/:drawId', getDrawById);


// Admin routes

drawRouter.post('/admin/simulate', [authMiddleware, adminMiddleware], simulateDraw);
drawRouter.post('/admin/execute', [authMiddleware, adminMiddleware], executeDraw);
drawRouter.post('/admin/config', [authMiddleware, adminMiddleware], updateDrawConfig);


export default drawRouter;