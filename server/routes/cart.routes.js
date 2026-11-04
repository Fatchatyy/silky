import { Router } from 'express';
import * as cartController from '../controllers/cart.controller.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { cartAddLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(optionalAuthMiddleware);

router.get('/', cartController.getCart);
router.post('/items', cartAddLimiter, cartController.addItem);
router.delete('/items/:id', cartController.removeItem);
router.delete('/', cartController.clearCart);

export default router;
