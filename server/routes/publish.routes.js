import { Router } from 'express';
import * as publishController from '../controllers/publish.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { publishLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const admin = [authMiddleware, adminMiddleware];

// GET  /api/publish/status  the live catalogue fingerprint, whether a deploy hook is set, how the last call went
// POST /api/publish         call the deploy hook now ("Publier maintenant")
router.get('/status', admin, publishController.status);
router.post('/', admin, publishLimiter, publishController.publish);

export default router;
