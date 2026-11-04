import { Router } from 'express';
import * as webhooksController from '../controllers/webhooks.controller.js';
import { webhookLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/goodex', webhookLimiter, webhooksController.goodexWebhook);

export default router;
