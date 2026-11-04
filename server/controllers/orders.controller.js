import * as orderService from '../services/order.service.js';
import * as deliveryService from '../services/delivery.service.js';
import { requireShopper } from '../utils/shopper.js';
import { sendError } from '../utils/errors.js';
import { validateIdempotencyKey } from '../utils/idempotency.js';
import { MAX_ORDER_ITEMS, MAX_BULK_ORDER_IDS } from '../config/orderLimits.js';

export async function listMine(req, res) {
  try {
    const orders = await orderService.getOrdersByUserId(req.user.id);
    res.json(orders);
  } catch (err) {
    sendError(res, err);
  }
}

export async function list(_req, res) {
  try {
    const orders = await orderService.getAllOrders();
    res.json(await deliveryService.attachDelivery(orders));
  } catch (err) {
    sendError(res, err);
  }
}

export async function getById(req, res) {
  try {
    const order = await orderService.getOrderById(req.params.id);
    res.json(await deliveryService.attachDelivery(order));
  } catch (err) {
    sendError(res, err);
  }
}

export async function create(req, res) {
  if (req.user?.role === 'admin') {
    return res.status(403).json({ error: 'Les administrateurs ne peuvent pas passer de commandes.' });
  }

  const { customer, items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Les articles sont requis.' });
  }
  if (items.length > MAX_ORDER_ITEMS) {
    return res.status(400).json({ error: `Trop d'articles dans la commande (maximum ${MAX_ORDER_ITEMS})` });
  }

  try {
    const idempotencyKey = validateIdempotencyKey(req.headers['idempotency-key']);
    const order = await orderService.createOrder({
      customer,
      items,
      userId: req.user?.id || null,
      guestSessionId: req.user?.id ? null : req.guestSessionId,
      allowCustomPrices: false,
      idempotencyKey,
    });
    res.status(201).json(order);
  } catch (err) {
    sendError(res, err);
  }
}

export async function checkout(req, res) {
  if (req.user?.role === 'admin') {
    return res.status(403).json({ error: 'Les administrateurs ne peuvent pas passer de commandes.' });
  }

  const customer = req.body.customer || req.body;
  if (!customer) {
    return res.status(400).json({ error: 'Les informations de livraison sont requises.' });
  }

  try {
    const idempotencyKey = validateIdempotencyKey(req.headers['idempotency-key']);
    const shopper = requireShopper(req);
    const buyNowItem = req.body.buyNowItem;

    let order;
    if (buyNowItem) {
      order = await orderService.checkoutDirect({ customer, shopper, item: buyNowItem, idempotencyKey });
    } else {
      order = await orderService.checkoutFromCart({ customer, shopper, idempotencyKey });
    }

    res.status(201).json(order);
  } catch (err) {
    sendError(res, err);
  }
}

export async function cancelOrder(req, res) {
  try {
    const order = await orderService.cancelOrder(req.params.id);
    res.json(order);
  } catch (err) {
    sendError(res, err);
  }
}

export async function refundOrder(req, res) {
  try {
    const { paymentResponsibility } = req.body || {};
    const order = await orderService.refundOrder(req.params.id, { paymentResponsibility });
    res.json(await deliveryService.attachDelivery(order));
  } catch (err) {
    sendError(res, err);
  }
}

export async function confirmOrder(req, res) {
  try {
    const order = await orderService.confirmOrder(req.params.id);
    res.json(await deliveryService.attachDelivery(order));
  } catch (err) {
    sendError(res, err);
  }
}

export async function deliverOrder(req, res) {
  try {
    const order = await orderService.deliverOrder(req.params.id);
    res.json(order);
  } catch (err) {
    sendError(res, err);
  }
}

export async function confirmBulkOrders(req, res) {
  const { orderIds } = req.body;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: 'orderIds array parameter is required' });
  }
  if (orderIds.length > MAX_BULK_ORDER_IDS) {
    return res.status(400).json({ error: `Trop de commandes pour la confirmation en masse (maximum ${MAX_BULK_ORDER_IDS})` });
  }

  try {
    const confirmedList = await orderService.confirmOrders(orderIds);
    res.json(await deliveryService.attachDelivery(confirmedList));
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateStatus(req, res) {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'Status parameter is required' });
  }

  try {
    const order = await orderService.updateOrderStatus(req.params.id, status);
    res.json(await deliveryService.attachDelivery(order));
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateBulkStatus(req, res) {
  const { orderIds, status } = req.body;
  if (!Array.isArray(orderIds) || orderIds.length === 0 || !status) {
    return res.status(400).json({ error: 'orderIds array and status parameter are required' });
  }
  if (orderIds.length > MAX_BULK_ORDER_IDS) {
    return res.status(400).json({ error: `Trop de commandes pour la mise à jour en masse (maximum ${MAX_BULK_ORDER_IDS})` });
  }

  try {
    const updatedList = [];
    for (const id of orderIds) {
      const updated = await orderService.updateOrderStatus(id, status);
      if (updated) updatedList.push(updated);
    }
    res.json(await deliveryService.attachDelivery(updatedList));
  } catch (err) {
    sendError(res, err);
  }
}

export async function getDelivery(req, res) {
  try {
    const row = await deliveryService.getDelivery(req.params.id);
    res.json(deliveryService.toPublicDelivery(row));
  } catch (err) {
    sendError(res, err);
  }
}

export async function refreshDelivery(req, res) {
  try {
    const onlyIfStale = req.body?.onlyIfStale === true;
    const { row, skipped } = await deliveryService.refreshStatus(req.params.id, { onlyIfStale });
    res.json({ ...deliveryService.toPublicDelivery(row), refreshSkipped: skipped });
  } catch (err) {
    sendError(res, err);
  }
}

export async function retryDelivery(req, res) {
  try {
    const acknowledgeUnknown = req.body?.acknowledgeUnknown === true;
    const row = await deliveryService.retryParcel(req.params.id, { acknowledgeUnknown });
    res.json(deliveryService.toPublicDelivery(row));
  } catch (err) {
    sendError(res, err);
  }
}

export async function refreshExchangeDelivery(req, res) {
  try {
    const onlyIfStale = req.body?.onlyIfStale === true;
    const { row, skipped } = await deliveryService.refreshExchangeStatus(req.params.exchangeId, { onlyIfStale });
    res.json({ ...deliveryService.toPublicDelivery(row), refreshSkipped: skipped });
  } catch (err) {
    sendError(res, err);
  }
}

export async function retryExchangeDelivery(req, res) {
  try {
    const acknowledgeUnknown = req.body?.acknowledgeUnknown === true;
    const row = await deliveryService.retryExchangeParcel(req.params.exchangeId, { acknowledgeUnknown });
    res.json(deliveryService.toPublicDelivery(row));
  } catch (err) {
    sendError(res, err);
  }
}

export async function refreshRefundDelivery(req, res) {
  try {
    const onlyIfStale = req.body?.onlyIfStale === true;
    const { row, skipped } = await deliveryService.refreshRefundStatus(req.params.refundId, { onlyIfStale });
    res.json({ ...deliveryService.toPublicDelivery(row), refreshSkipped: skipped });
  } catch (err) {
    sendError(res, err);
  }
}

export async function retryRefundDelivery(req, res) {
  try {
    const acknowledgeUnknown = req.body?.acknowledgeUnknown === true;
    const row = await deliveryService.retryRefundParcel(req.params.refundId, { acknowledgeUnknown });
    res.json(deliveryService.toPublicDelivery(row));
  } catch (err) {
    sendError(res, err);
  }
}

export async function linkDelivery(req, res) {
  try {
    const row = await deliveryService.linkExistingEan(req.params.id, req.body?.ean);
    res.json(deliveryService.toPublicDelivery(row));
  } catch (err) {
    sendError(res, err);
  }
}
