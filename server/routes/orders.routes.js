import { Router } from 'express';
import * as ordersController from '../controllers/orders.controller.js';
import * as claimsController from '../controllers/claims.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import {
  checkoutLimiter,
  orderCreationLimiter,
  orderMutationLimiter,
} from '../middleware/rateLimiter.js';

const router = Router();
const admin = [authMiddleware, adminMiddleware];

router.get('/mine', authMiddleware, ordersController.listMine);
router.post('/checkout', checkoutLimiter, optionalAuthMiddleware, ordersController.checkout);
router.get('/', admin, ordersController.list);
router.get('/claims/types', admin, claimsController.getTypes);
router.get('/claims/counts', admin, claimsController.getCounts);
router.get('/claims/remote', admin, claimsController.listRemote);
router.post('/claims/:claimId/refresh', admin, orderMutationLimiter, claimsController.refresh);
router.delete('/claims/:claimId', admin, orderMutationLimiter, claimsController.cancel);
router.post('/exchanges/:exchangeId/delivery/refresh', admin, orderMutationLimiter, ordersController.refreshExchangeDelivery);
router.post('/exchanges/:exchangeId/delivery/retry', admin, orderMutationLimiter, ordersController.retryExchangeDelivery);
router.post('/refunds/:refundId/delivery/refresh', admin, orderMutationLimiter, ordersController.refreshRefundDelivery);
router.post('/refunds/:refundId/delivery/retry', admin, orderMutationLimiter, ordersController.retryRefundDelivery);
router.post('/bulk-confirm', admin, orderMutationLimiter, ordersController.confirmBulkOrders);
router.patch('/bulk-status', admin, orderMutationLimiter, ordersController.updateBulkStatus);
router.post('/:id/confirm', admin, orderMutationLimiter, ordersController.confirmOrder);
router.post('/:id/deliver', admin, orderMutationLimiter, ordersController.deliverOrder);
router.post('/:id/cancel', admin, orderMutationLimiter, ordersController.cancelOrder);
router.post('/:id/refund', admin, orderMutationLimiter, ordersController.refundOrder);
router.patch('/:id/status', admin, orderMutationLimiter, ordersController.updateStatus);
router.get('/:id/delivery', admin, ordersController.getDelivery);
router.post('/:id/delivery/refresh', admin, orderMutationLimiter, ordersController.refreshDelivery);
router.post('/:id/delivery/retry', admin, orderMutationLimiter, ordersController.retryDelivery);
router.post('/:id/delivery/link', admin, orderMutationLimiter, ordersController.linkDelivery);
router.get('/:id/claims', admin, claimsController.listForOrder);
router.post('/:id/claims', admin, orderMutationLimiter, claimsController.open);
router.post('/:id/claims/sync', admin, orderMutationLimiter, claimsController.syncForOrder);
router.get('/:id', admin, ordersController.getById);
router.post('/', orderCreationLimiter, optionalAuthMiddleware, ordersController.create);

export default router;
