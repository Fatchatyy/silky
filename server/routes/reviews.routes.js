import { Router } from 'express';
import * as reviewsController from '../controllers/reviews.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { reviewLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const admin = [authMiddleware, adminMiddleware];

router.get('/published', reviewsController.listPublished);
// Only a logged-in customer can write a review; guests are refused (401). The contact form stays open to guests.
router.post('/', authMiddleware, reviewLimiter, reviewsController.submit);
router.get('/', admin, reviewsController.listAll);
router.patch('/:id', admin, reviewsController.updateStatus);
router.delete('/:id', admin, reviewsController.remove);

export default router;
