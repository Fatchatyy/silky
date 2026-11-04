import { Router } from 'express';
import * as contactController from '../controllers/contact.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { contactLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const admin = [authMiddleware, adminMiddleware];

router.post('/', contactLimiter, optionalAuthMiddleware, contactController.submit);
router.get('/', admin, contactController.listAll);
router.get('/:id', admin, contactController.getById);
router.post('/:id/reply', admin, contactController.reply);

export default router;

