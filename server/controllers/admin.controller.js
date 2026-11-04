import * as adminService from '../services/admin.service.js';
import * as inventoryService from '../services/inventory.service.js';
import * as analyticsService from '../services/analytics.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as authService from '../services/auth.service.js';
import * as deliveryService from '../services/delivery.service.js';
import { userRepository } from '../repositories/user.repository.js';
import { sendError } from '../utils/errors.js';

export async function login(req, res) {
  try {
    const { password } = req.body;
    const result = await authService.adminPanelLogin(password);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function logout(req, res) {
  // Ends the admin's sessions: tokens issued before now stop working, so a copied token is useless after logout.
  await userRepository.revokeTokens(req.user.id);
  res.json({ ok: true });
}

export async function createManualOrder(req, res) {
  const {
    customerName,
    phoneNumber,
    items,
    customerEmail,
    governorateId,
    governorate,
    shippingAddress,
    deliveryFee,
  } = req.body;

  try {
    const order = await adminService.createManualOrder({
      customerName,
      phoneNumber,
      items,
      customerEmail,
      governorateId,
      governorate,
      shippingAddress,
      deliveryFee,
    });
    res.status(201).json(order);
  } catch (err) {
    sendError(res, err);
  }
}

export async function previewExchange(req, res) {
  const { customer, items, deliveryFee, paymentResponsibility } = req.body;
  const orderId = req.params.id;

  try {
    const preview = await exchangeService.previewExchange({
      orderId,
      customer,
      items,
      deliveryFee,
      paymentResponsibility,
    });
    res.json(preview);
  } catch (err) {
    sendError(res, err);
  }
}

export async function createExchange(req, res) {
  const { customer, items, deliveryFee, paymentResponsibility } = req.body;
  const orderId = req.params.id;

  try {
    const updatedOrder = await exchangeService.createExchange({
      orderId,
      customer,
      items,
      deliveryFee,
      paymentResponsibility,
    });
    res.status(201).json(await deliveryService.attachDelivery(updatedOrder));
  } catch (err) {
    sendError(res, err);
  }
}

export async function getInventory(_req, res) {
  try {
    const inventory = await inventoryService.getInventory();
    res.json(inventory);
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateInventory(req, res) {
  const { stockQuantity } = req.body;

  try {
    const variant = await inventoryService.updateVariantStock(req.params.variantId, stockQuantity);
    res.json(variant);
  } catch (err) {
    sendError(res, err);
  }
}

export async function getAnalytics(req, res) {
  const { granularity, limit, piePeriod } = req.query;

  try {
    const analytics = await analyticsService.getAnalytics({ granularity, limit, piePeriod });
    res.json(analytics);
  } catch (err) {
    sendError(res, err);
  }
}

