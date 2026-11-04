import crypto from 'crypto';
import { orderRepository } from '../repositories/order.repository.js';
import { exchangeRepository } from '../repositories/exchange.repository.js';
import { refundRepository } from '../repositories/refund.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { themeRepository } from '../repositories/theme.repository.js';
import { emailDeliveryRepository } from '../repositories/email-delivery.repository.js';
import { idempotencyRepository } from '../repositories/idempotency.repository.js';
import { getCartItemsForCheckout, clearCart } from './cart.service.js';
import { runInTransaction } from '../repositories/transaction.repository.js';
import { AppError } from '../utils/errors.js';
import { sendOrderConfirmationEmail } from './email.service.js';
import * as notificationService from './notification.service.js';
import * as deliveryService from './delivery.service.js';
import { DELIVERY_ECONOMICS } from '../config/delivery.js';
import { generateRequestFingerprint } from '../utils/idempotency.js';
import { resolveGovernorateSync } from '../config/governorates.js';
import {
  MAX_ITEM_QUANTITY,
  MAX_ORDER_ITEMS,
  MAX_BULK_ORDER_IDS,
  validateOrderQuantity,
} from '../config/orderLimits.js';

const EMAIL_TYPE_ORDER_CONFIRMATION = 'order_confirmation';

/**
 * Dispatch an order-confirmation email with PostgreSQL-backed idempotency.
 */
export async function dispatchOrderConfirmationEmail(order) {
  if (!order?.id) return;
  const customerEmail = (order.customer?.email || order.customerEmail || '').trim();
  if (!customerEmail) return;

  let delivery = null;
  try {
    delivery = await emailDeliveryRepository.claimDelivery(
      order.id,
      EMAIL_TYPE_ORDER_CONFIRMATION
    );

    if (!delivery) {
      console.log(
        `[email] Order confirmation already claimed for order ${order.id} — skipping.`
      );
      return;
    }

    await sendOrderConfirmationEmail(order);
    await emailDeliveryRepository.markSent(delivery.id);
  } catch (err) {
    console.error('[email] Failed to send order confirmation email:', err.message);
    if (delivery?.id) {
      try {
        await emailDeliveryRepository.markFailed(delivery.id, err.message);
      } catch (updateErr) {
        console.error('[email] Failed to mark delivery as failed:', updateErr.message);
      }
    }
  }
}

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

export async function getAllOrders() {
  return orderRepository.findAll();
}

export async function getOrdersByUserId(userId) {
  return orderRepository.findByUserId(userId);
}

export async function getOrderById(id) {
  const order = await orderRepository.findById(id);
  if (!order) {
    throw new AppError('Commande non trouvée', 404);
  }
  return order;
}

export async function getOrderByIdForUser(id, userId) {
  const order = await orderRepository.findById(id);
  // FIX-03: Strict userId match required.
  // The original condition `order.userId && order.userId !== userId` short-circuits
  // when order.userId is null (guest order), erroneously allowing any authenticated
  // user to read a guest order. Correct rule: the order must be explicitly owned by
  // the requesting user. Guest orders are NOT accessible via this function.
  if (!order || order.userId !== userId) {
    throw new AppError('Commande non trouvée', 404);
  }
  return order;
}

export function extractCustomerInfo(customer, { requireGovernorate = true } = {}) {
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
    throw new AppError('Les informations client sont requises.', 400);
  }

  // 1. Phone validation (Strictly 8 digits)
  const rawPhone = customer.phone !== undefined ? customer.phone : customer.phoneNumber;
  if (rawPhone === undefined || rawPhone === null || (typeof rawPhone === 'string' && rawPhone.trim() === '')) {
    throw new AppError('Le numéro de téléphone est obligatoire.', 400);
  }
  if (typeof rawPhone !== 'string') {
    throw new AppError('Le numéro de téléphone doit contenir exactement 8 chiffres.', 400);
  }
  const phone = rawPhone.trim();
  if (!/^\d{8}$/.test(phone)) {
    throw new AppError('Le numéro de téléphone doit contenir exactement 8 chiffres.', 400);
  }

  // 2. Name validation (Letters, accents, spaces, hyphens, apostrophes; 3..35 chars)
  const NAME_REGEX = /^[a-zA-ZÀ-ÿ\s'-]+$/;
  let name = null;

  const hasFirstName = customer.firstName !== undefined;
  const hasLastName = customer.lastName !== undefined;

  if (hasFirstName || hasLastName) {
    if (!hasFirstName || typeof customer.firstName !== 'string' || !customer.firstName.trim()) {
      throw new AppError('Le prénom est obligatoire.', 400);
    }
    const trimmedFirst = customer.firstName.trim();
    if (!NAME_REGEX.test(trimmedFirst)) {
      throw new AppError('Le prénom doit contenir uniquement des lettres.', 400);
    }
    if (trimmedFirst.length < 3) {
      throw new AppError('Le prénom doit contenir au moins 3 lettres.', 400);
    }
    if (trimmedFirst.length > 35) {
      throw new AppError('Le prénom ne doit pas dépasser 35 lettres.', 400);
    }

    if (!hasLastName || typeof customer.lastName !== 'string' || !customer.lastName.trim()) {
      throw new AppError('Le nom de famille est obligatoire.', 400);
    }
    const trimmedLast = customer.lastName.trim();
    if (!NAME_REGEX.test(trimmedLast)) {
      throw new AppError('Le nom de famille doit contenir uniquement des lettres.', 400);
    }
    if (trimmedLast.length < 3) {
      throw new AppError('Le nom de famille doit contenir au moins 3 lettres.', 400);
    }
    if (trimmedLast.length > 35) {
      throw new AppError('Le nom de famille ne doit pas dépasser 35 lettres.', 400);
    }

    name = `${trimmedFirst} ${trimmedLast}`;
  } else {
    const rawName = customer.name !== undefined
      ? customer.name
      : (customer.customerName !== undefined ? customer.customerName : customer.fullName);

    if (rawName === undefined || rawName === null || (typeof rawName === 'string' && rawName.trim() === '')) {
      throw new AppError('Le nom du client est obligatoire.', 400);
    }
    if (typeof rawName !== 'string') {
      throw new AppError('Le nom du client doit contenir uniquement des lettres.', 400);
    }
    const trimmedName = rawName.trim();
    if (!NAME_REGEX.test(trimmedName)) {
      throw new AppError('Le nom du client doit contenir uniquement des lettres.', 400);
    }
    if (trimmedName.length < 3) {
      throw new AppError('Le nom du client doit contenir au moins 3 lettres.', 400);
    }
    if (trimmedName.length > 35) {
      throw new AppError('Le nom du client ne doit pas dépasser 35 lettres.', 400);
    }

    name = trimmedName;
  }

  // 3. Email validation (Optional, valid syntax if provided)
  const rawEmail = customer.email !== undefined ? customer.email : customer.customerEmail;
  let email = null;
  if (rawEmail !== undefined && rawEmail !== null && (typeof rawEmail !== 'string' || rawEmail.trim() !== '')) {
    if (typeof rawEmail !== 'string') {
      throw new AppError('Veuillez entrer une adresse e-mail valide.', 400);
    }
    const trimmedEmail = rawEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      throw new AppError('Veuillez entrer une adresse e-mail valide.', 400);
    }
    email = trimmedEmail.toLowerCase();
  }

  // 4. Governorate validation (Authoritative)
  const rawGovernorate = customer.governorateId ?? customer.governorate_id ?? customer.governorate ?? customer.state ?? customer.region;

  let governorateId = null;
  let governorateName = null;
  let governorateCode = null;

  if (requireGovernorate) {
    if (rawGovernorate === undefined || rawGovernorate === null || (typeof rawGovernorate === 'string' && rawGovernorate.trim() === '')) {
      throw new AppError('Le gouvernorat est obligatoire.', 400);
    }
    const resolvedGov = resolveGovernorateSync(rawGovernorate);
    if (!resolvedGov) {
      throw new AppError('Gouvernorat invalide.', 400);
    }
    governorateId = resolvedGov.id;
    governorateName = resolvedGov.name;
    governorateCode = resolvedGov.code;
  } else if (rawGovernorate !== undefined && rawGovernorate !== null && (typeof rawGovernorate !== 'string' || rawGovernorate.trim() !== '')) {
    const resolvedGov = resolveGovernorateSync(rawGovernorate);
    if (!resolvedGov) {
      throw new AppError('Gouvernorat invalide.', 400);
    }
    governorateId = resolvedGov.id;
    governorateName = resolvedGov.name;
    governorateCode = resolvedGov.code;
  }

  // 5. Address validation (Street address / location details only)
  const rawAddress = customer.address !== undefined ? customer.address : customer.shippingAddress;
  if (rawAddress === undefined || rawAddress === null || typeof rawAddress !== 'string' || !rawAddress.trim()) {
    throw new AppError("L'adresse de livraison est obligatoire.", 400);
  }
  let address = rawAddress.trim();

  // Strip redundant governorate prefix if present (e.g. "Tunis — Rue de la Liberté" -> "Rue de la Liberté")
  if (governorateName) {
    const prefixRegex = new RegExp(`^${governorateName}\\s*[-—–:]\\s*`, 'i');
    if (prefixRegex.test(address)) {
      address = address.replace(prefixRegex, '').trim();
    }
  }

  if (!address) {
    throw new AppError("L'adresse de livraison est obligatoire.", 400);
  }

  return {
    name,
    phone,
    email,
    address,
    governorateId,
    governorate: governorateName,
    governorateCode,
  };
}

let cleanupCounter = 0;
function maybeTriggerCleanup() {
  cleanupCounter++;
  if (cleanupCounter % 50 === 0) {
    idempotencyRepository.cleanupExpired(48).catch((err) => {
      console.warn('[idempotency] Cleanup warning:', err.message);
    });
  }
}

/**
 * Executes an order creation operation with robust transaction-safe idempotency.
 */
async function executeWithIdempotency({
  shopper,
  idempotencyKey,
  requestPath,
  fingerprint,
  executeOrderTx,
}) {
  maybeTriggerCleanup();

  if (!idempotencyKey) {
    return runInTransaction(executeOrderTx);
  }

  const userId = shopper?.userId || null;
  const guestSessionId = shopper?.guestSessionId || null;

  // 1. Pre-check for existing completed/in_progress record before starting a transaction
  const existing = await idempotencyRepository.findByShopperAndKey({
    key: idempotencyKey,
    userId,
    guestSessionId,
  });

  if (existing) {
    if (existing.requestFingerprint !== fingerprint) {
      throw new AppError('Cette clé d\'idempotence a déjà été utilisée pour une requête différente.', 409);
    }
    if (existing.status === 'completed' && existing.orderId) {
      const existingOrder = await orderRepository.findById(existing.orderId);
      if (existingOrder) return existingOrder;
    }
    if (existing.status === 'in_progress') {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const polled = await idempotencyRepository.findByShopperAndKey({
          key: idempotencyKey,
          userId,
          guestSessionId,
        });
        if (!polled) {
          // Record disappeared (rolled back by first request) -> break to attempt checkout
          break;
        }
        if (polled.requestFingerprint !== fingerprint) {
          throw new AppError('Cette clé d\'idempotence a déjà été utilisée pour une requête différente.', 409);
        }
        if (polled.status === 'completed' && polled.orderId) {
          const completedOrder = await orderRepository.findById(polled.orderId);
          if (completedOrder) return completedOrder;
        }
      }
      const finalCheck = await idempotencyRepository.findByShopperAndKey({
        key: idempotencyKey,
        userId,
        guestSessionId,
      });
      if (finalCheck?.status === 'in_progress') {
        throw new AppError('Une commande avec cette clé est déjà en cours de traitement. Veuillez réessayer.', 409);
      }
    }
  }

  // 2. Attempt reservation and order creation inside transaction
  try {
    return await runInTransaction(async (tx) => {
      const reserved = await idempotencyRepository.reserveKey({
        key: idempotencyKey,
        userId,
        guestSessionId,
        requestPath,
        requestFingerprint: fingerprint,
      }, tx);

      const createdOrder = await executeOrderTx(tx);

      await idempotencyRepository.completeKey(reserved.id, {
        orderId: createdOrder.id,
        responseStatus: 201,
      }, tx);

      return createdOrder;
    });
  } catch (err) {
    const isUniqueViolation = err?.code === '23505' ||
      err?.message?.includes('idx_idempotency_') ||
      err?.message?.includes('idempotency_keys_key');

    if (isUniqueViolation) {
      // Transaction was aborted and rolled back. Outside tx, read winner's record
      for (let i = 0; i < 25; i++) {
        const winner = await idempotencyRepository.findByShopperAndKey({
          key: idempotencyKey,
          userId,
          guestSessionId,
        });
        if (winner) {
          if (winner.requestFingerprint !== fingerprint) {
            throw new AppError('Cette clé d\'idempotence a déjà été utilisée pour une requête différente.', 409);
          }
          if (winner.status === 'completed' && winner.orderId) {
            const winnerOrder = await orderRepository.findById(winner.orderId);
            if (winnerOrder) return winnerOrder;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new AppError('Conflit de concurrence sur la clé d\'idempotence. Veuillez réessayer.', 409);
    }
    throw err;
  }
}

export async function createOrder({
  customer,
  items,
  userId = null,
  guestSessionId = null,
  deliveryFee: customDeliveryFee = null,
  orderNumber: customOrderNumber = null,
  allowCustomPrices = false,
  idempotencyKey = null,
}) {
  const custInfo = extractCustomerInfo(customer);
  if (!custInfo.name || !custInfo.phone || !custInfo.address) {
    throw new AppError('Les informations client (nom, téléphone, adresse) sont requises', 400);
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('La commande doit contenir au moins un article', 400);
  }
  if (items.length > MAX_ORDER_ITEMS) {
    throw new AppError(`Trop d'articles dans la commande (maximum ${MAX_ORDER_ITEMS})`, 400);
  }

  const shopper = { userId, guestSessionId };
  const fingerprint = generateRequestFingerprint('orders:create', { customer: custInfo, items });

  const order = await executeWithIdempotency({
    shopper,
    idempotencyKey,
    requestPath: '/api/orders',
    fingerprint,
    executeOrderTx: async (tx) => {
      // 1. Resolve all variant IDs for items and validate product ownership & quantities
      const resolvedItems = [];
      for (const item of items) {
        let variantId = item.variantId;
        if (variantId) {
          const v = await productRepository.findVariantById(variantId, tx);
          if (!v) {
            throw new AppError(`Article non trouvé (${item.name || item.productTitle || 'Variant'})`, 404);
          }
          if (item.productId && v.productId !== item.productId) {
            throw new AppError(`La variante ne correspond pas au produit spécifié (${item.name || item.productTitle || 'Variant'})`, 400);
          }
        } else if (item.productId && item.colorId && item.size) {
          const v = await productRepository.findVariantForOrderItem(item.productId, item.colorId, item.size, tx);
          variantId = v?.id;
        }
        if (!variantId) {
          throw new AppError(`Article non trouvé (${item.name || item.productTitle || 'Variant'})`, 404);
        }
        const quantity = validateOrderQuantity(item.quantity);
        resolvedItems.push({ ...item, variantId, quantity });
      }

      // 2. Deduplicate and sort variant IDs to ensure deterministic lock ordering
      const uniqueVariantIds = Array.from(new Set(resolvedItems.map((i) => i.variantId))).sort();
      if (uniqueVariantIds.length > 0) {
        await orderRepository.lockVariantsForUpdate(uniqueVariantIds, tx);
      }

      // 3. Aggregate total required quantity per variant
      const totalRequiredByVariant = new Map();
      for (const item of resolvedItems) {
        totalRequiredByVariant.set(item.variantId, (totalRequiredByVariant.get(item.variantId) || 0) + item.quantity);
      }

      // 4. Validate stock for each locked variant
      for (const [vId, reqQty] of totalRequiredByVariant.entries()) {
        const lockedVariant = await productRepository.findVariantById(vId, tx);
        if (!lockedVariant) {
          throw new AppError('Article non trouvé', 404);
        }
        const product = await productRepository.findById(lockedVariant.productId, tx);
        if (!product || !product.is_active) {
          throw new AppError(`Produit non disponible (${lockedVariant.sku})`, 400);
        }
        if (lockedVariant.stockQuantity < reqQty) {
          throw new AppError(
            `${product.name}: stock insuffisant (${lockedVariant.stockQuantity} disponible(s))`,
            400
          );
        }
      }

      let subtotal = 0;
      const validatedItems = [];
      const remainingStock = new Map();

      for (const item of resolvedItems) {
        const variant = await productRepository.findVariantById(item.variantId, tx);
        const product = await productRepository.findById(variant.productId, tx);
        const currentStock = remainingStock.has(variant.id) ? remainingStock.get(variant.id) : variant.stockQuantity;
        const quantity = item.quantity;
        const newStock = currentStock - quantity;
        remainingStock.set(variant.id, newStock);
        await productRepository.updateVariantStock(variant.id, newStock, tx);

        // Price integrity: Only allow custom price if allowCustomPrices is true (admin manual order only)
        const unitPrice = allowCustomPrices && Number(item.price) !== undefined && !isNaN(Number(item.price))
          ? Number(item.price)
          : (parseFloat(product.price) - parseFloat(product.discount || 0));

        const lineSubtotal = unitPrice * quantity;
        subtotal += lineSubtotal;

        validatedItems.push({
          variantId: variant.id,
          name: product.name,
          variantLabel: `${variant.colorName} / ${variant.size}`,
          image: variant.colorImageUrl || product.collectionImage || product.mainImage || null,
          quantity,
          price: unitPrice,
        });
      }

      // Delivery fee integrity: Only allow custom fee if allowCustomPrices is true (admin manual order only)
      const deliveryFee = (allowCustomPrices && customDeliveryFee !== null && customDeliveryFee !== undefined)
        ? Number(customDeliveryFee)
        : await themeRepository.getDeliveryFee(tx);
      const totalAmount = subtotal + deliveryFee;
      const orderNumber = customOrderNumber || generateOrderNumber();

      const createdOrder = await orderRepository.createOrder({
        orderNumber,
        userId,
        guestSessionId,
        customerName: custInfo.name,
        customerEmail: custInfo.email,
        customerPhone: custInfo.phone,
        governorateId: custInfo.governorateId,
        shippingAddress: custInfo.address,
        subtotal,
        deliveryFee,
        totalAmount,
        status: 'pending',
      }, validatedItems, tx);

      return createdOrder;
    },
  });

  dispatchOrderConfirmationEmail(order);
  await notificationService.createOrderNotification(order);
  return order;
}

export async function checkoutFromCart({ customer, shopper, idempotencyKey = null }) {
  const custInfo = extractCustomerInfo(customer);
  if (!custInfo.name || !custInfo.phone || !custInfo.address) {
    throw new AppError('Les informations client (nom, téléphone, adresse) sont requises', 400);
  }

  // Generate deterministic fingerprint
  const fingerprint = generateRequestFingerprint('checkout:cart', {
    customer: custInfo,
    cartId: shopper.userId || shopper.guestSessionId,
  });

  const order = await executeWithIdempotency({
    shopper,
    idempotencyKey,
    requestPath: '/api/orders/checkout',
    fingerprint,
    executeOrderTx: async (tx) => {
      const { cartId, items } = await getCartItemsForCheckout(shopper, tx);
      if (!items.length) {
        throw new AppError('Votre panier est vide', 400);
      }
      if (items.length > MAX_ORDER_ITEMS) {
        throw new AppError(`Trop d'articles dans la commande (maximum ${MAX_ORDER_ITEMS})`, 400);
      }

      const variantIds = Array.from(new Set(items.map((i) => i.variantId).filter(Boolean))).sort();
      if (variantIds.length > 0) {
        await orderRepository.lockVariantsForUpdate(variantIds, tx);
      }

      let subtotal = 0;
      const validatedItems = [];

      for (const item of items) {
        const quantity = validateOrderQuantity(item.quantity);
        const variant = await productRepository.findVariantById(item.variantId, tx);
        if (!variant) {
          throw new AppError(`Article non trouvé (${item.name})`, 404);
        }

        if (variant.stockQuantity < quantity) {
          throw new AppError(
            `${item.name}: stock insuffisant (${variant.stockQuantity} disponible(s))`,
            400
          );
        }

        const unitPrice = item.price;
        subtotal += unitPrice * quantity;

        // Deduct stock
        await productRepository.updateVariantStock(variant.id, variant.stockQuantity - quantity, tx);

        validatedItems.push({
          variantId: variant.id,
          name: item.name,
          variantLabel: item.details,
          image: item.image,
          quantity,
          price: unitPrice,
        });
      }

      const deliveryFee = await themeRepository.getDeliveryFee(tx);
      const totalAmount = subtotal + deliveryFee;
      const orderNumber = generateOrderNumber();

      const createdOrder = await orderRepository.createOrder({
        orderNumber,
        userId: shopper.userId || null,
        guestSessionId: shopper.guestSessionId || null,
        customerName: custInfo.name,
        customerEmail: custInfo.email,
        customerPhone: custInfo.phone,
        governorateId: custInfo.governorateId,
        shippingAddress: custInfo.address,
        subtotal,
        deliveryFee,
        totalAmount,
        status: 'pending',
      }, validatedItems, tx);

      await clearCart(cartId, tx);

      return createdOrder;
    },
  });

  dispatchOrderConfirmationEmail(order);
  await notificationService.createOrderNotification(order);
  return order;
}

function buildVariantLabel(colorName, size) {
  const parts = [];
  if (colorName) parts.push(colorName);
  if (size) parts.push(`Taille ${size}`);
  return parts.join(' · ') || 'Standard';
}

export async function checkoutDirect({ customer, shopper, item, idempotencyKey = null }) {
  const custInfo = extractCustomerInfo(customer);
  if (!custInfo.name || !custInfo.phone || !custInfo.address) {
    throw new AppError('Les informations client (nom, téléphone, adresse) sont requises', 400);
  }

  if (!item || (!item.variantId && (!item.productId || !item.size))) {
    throw new AppError('Article invalide pour achat direct', 400);
  }

  const quantity = validateOrderQuantity(item.quantity);
  const fingerprint = generateRequestFingerprint('checkout:direct', { customer: custInfo, item: { ...item, quantity } });

  const order = await executeWithIdempotency({
    shopper,
    idempotencyKey,
    requestPath: '/api/orders/checkout',
    fingerprint,
    executeOrderTx: async (tx) => {
      let variant = null;
      if (item.variantId) {
        variant = await productRepository.findVariantById(item.variantId, tx);
        if (variant && item.productId && variant.productId !== item.productId) {
          throw new AppError('La variante ne correspond pas au produit spécifié', 400);
        }
      } else {
        variant = await productRepository.findVariantForOrderItem(item.productId, item.colorId, item.size, tx);
      }

      if (!variant) {
        throw new AppError('Article non trouvé', 404);
      }

      const product = await productRepository.findById(variant.productId, tx);
      if (!product || !product.is_active) {
        throw new AppError('Produit non disponible', 400);
      }

      await orderRepository.lockVariantsForUpdate([variant.id], tx);

      const lockedVariant = await productRepository.findVariantById(variant.id, tx);
      if (!lockedVariant || lockedVariant.stockQuantity < quantity) {
        throw new AppError(
          `${product.name}: stock insuffisant (${lockedVariant?.stockQuantity ?? 0} disponible(s))`,
          400
        );
      }

      // Authoritative unit price directly from DB
      const unitPrice = parseFloat(product.price) - parseFloat(product.discount || 0);
      const subtotal = unitPrice * quantity;

      // Deduct variant stock
      await productRepository.updateVariantStock(variant.id, lockedVariant.stockQuantity - quantity, tx);

      const validatedItems = [{
        variantId: variant.id,
        name: product.name,
        variantLabel: buildVariantLabel(variant.colorName, variant.size),
        image: variant.colorImageUrl || product.collectionImage || product.mainImage || null,
        quantity,
        price: unitPrice,
      }];

      const deliveryFee = await themeRepository.getDeliveryFee(tx);
      const totalAmount = subtotal + deliveryFee;
      const orderNumber = generateOrderNumber();

      const createdOrder = await orderRepository.createOrder({
        orderNumber,
        userId: shopper?.userId || null,
        guestSessionId: shopper?.guestSessionId || null,
        customerName: custInfo.name,
        customerEmail: custInfo.email,
        customerPhone: custInfo.phone,
        governorateId: custInfo.governorateId,
        shippingAddress: custInfo.address,
        subtotal,
        deliveryFee,
        totalAmount,
        status: 'pending',
      }, validatedItems, tx);

      return createdOrder;
    },
  });

  dispatchOrderConfirmationEmail(order);
  await notificationService.createOrderNotification(order);
  return order;
}

export async function cancelOrder(orderId) {
  if (!orderId) {
    throw new AppError('ID de commande requis', 400);
  }

  return runInTransaction(async (tx) => {
    const lockedOrder = await orderRepository.findByIdForUpdate(orderId, tx);
    if (!lockedOrder) {
      throw new AppError('Commande non trouvée', 404);
    }

    if (lockedOrder.status === 'cancelled') {
      throw new AppError('La commande est déjà annulée', 400);
    }

    if (lockedOrder.status === 'refunded') {
      throw new AppError('Impossible d\'annuler une commande remboursée', 400);
    }

    if (lockedOrder.status === 'delivered') {
      throw new AppError('Impossible d\'annuler une commande déjà livrée', 400);
    }

    const latestExchange = await exchangeRepository.findLatestExchange(orderId, tx);

    let itemsToRestore = [];
    if (latestExchange && latestExchange.items && latestExchange.items.length > 0) {
      itemsToRestore = latestExchange.items;
    } else {
      const order = await orderRepository.findById(orderId, tx);
      itemsToRestore = order ? order.items || [] : [];
    }

    const quantityByVariant = new Map();
    for (const item of itemsToRestore) {
      if (item.variantId && Number(item.quantity) > 0) {
        quantityByVariant.set(
          item.variantId,
          (quantityByVariant.get(item.variantId) || 0) + Number(item.quantity)
        );
      }
    }

    const variantIds = Array.from(quantityByVariant.keys());

    if (variantIds.length > 0) {
      await orderRepository.lockVariantsForUpdate(variantIds, tx);
      for (const [variantId, qty] of quantityByVariant.entries()) {
        const variant = await productRepository.findVariantById(variantId, tx);
        if (variant) {
          await productRepository.updateVariantStock(variant.id, variant.stockQuantity + qty, tx);
        }
      }
    }

    await orderRepository.updateStatus(orderId, 'cancelled', tx);
    return orderRepository.findById(orderId, tx);
  });
}

export async function refundOrder(orderId, options = {}) {
  if (!orderId) {
    throw new AppError('ID de commande requis', 400);
  }

  const rawResponsibility = typeof options === 'string'
    ? options
    : (options?.paymentResponsibility || DELIVERY_ECONOMICS.RESPONSIBILITIES.CUSTOMER_PAID);

  const paymentResponsibility = rawResponsibility === DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID
    ? DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID
    : DELIVERY_ECONOMICS.RESPONSIBILITIES.CUSTOMER_PAID;

  const isSilkyPaid = paymentResponsibility === DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID;

  const deliveryFee = isSilkyPaid
    ? DELIVERY_ECONOMICS.SILKY_PAID_REFUND_CUSTOMER_FEE
    : DELIVERY_ECONOMICS.REFUND_CUSTOMER_DELIVERY_FEE;
  const carrierCost = DELIVERY_ECONOMICS.CARRIER_COST_REFUND_DELIVERY;

  let refundId;
  const refundedOrder = await runInTransaction(async (tx) => {
    const lockedOrder = await orderRepository.findByIdForUpdate(orderId, tx);
    if (!lockedOrder) {
      throw new AppError('Commande non trouvée', 404);
    }

    if (lockedOrder.status === 'cancelled') {
      throw new AppError('Impossible de rembourser une commande annulée', 400);
    }

    if (lockedOrder.status === 'refunded') {
      throw new AppError('La commande est déjà remboursée', 400);
    }

    if (lockedOrder.status === 'delivered') {
      throw new AppError('Impossible de rembourser une commande déjà livrée', 400);
    }

    if (lockedOrder.status !== 'completed' && lockedOrder.status !== 'exchanged') {
      throw new AppError('Seules les commandes confirmées ou échangées peuvent faire l\'objet d\'un remboursement', 400);
    }

    await deliveryService.assertParcelCreated(orderId, tx);

    const latestExchange = await exchangeRepository.findLatestExchange(orderId, tx);

    let itemsToRestore = [];
    let refundableProductAmount = 0;
    let customerName = lockedOrder.customerName;
    let customerEmail = lockedOrder.customerEmail;
    let customerPhone = lockedOrder.customerPhone;
    let shippingAddress = lockedOrder.shippingAddress;

    if (latestExchange && latestExchange.items && latestExchange.items.length > 0) {
      itemsToRestore = latestExchange.items;
      refundableProductAmount = parseFloat(latestExchange.subtotal);
      customerName = latestExchange.customerName || customerName;
      customerEmail = latestExchange.customerEmail || customerEmail;
      customerPhone = latestExchange.customerPhone || customerPhone;
      shippingAddress = latestExchange.shippingAddress || shippingAddress;
    } else {
      const currentOrder = await orderRepository.findById(orderId, tx);
      itemsToRestore = currentOrder ? currentOrder.items || [] : [];
      refundableProductAmount = parseFloat(lockedOrder.subtotal);
    }

    const quantityByVariant = new Map();
    for (const item of itemsToRestore) {
      if (item.variantId && Number(item.quantity) > 0) {
        quantityByVariant.set(
          item.variantId,
          (quantityByVariant.get(item.variantId) || 0) + Number(item.quantity)
        );
      }
    }

    const variantIds = Array.from(quantityByVariant.keys());

    if (variantIds.length > 0) {
      await orderRepository.lockVariantsForUpdate(variantIds, tx);
      for (const [variantId, qty] of quantityByVariant.entries()) {
        const variant = await productRepository.findVariantById(variantId, tx);
        if (variant) {
          await productRepository.updateVariantStock(variant.id, variant.stockQuantity + qty, tx);
        }
      }
    }

    const refundNumber = `REF-${lockedOrder.orderNumber}`;

    const refundRecord = await refundRepository.createRefundRecord({
      orderId,
      refundNumber,
      paymentResponsibility,
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      refundAmount: refundableProductAmount,
      deliveryFee,
      carrierCost,
    }, itemsToRestore, tx);
    refundId = refundRecord.id;

    await orderRepository.updateStatus(orderId, 'refunded', tx);
    return orderRepository.findById(orderId, tx);
  });

  // Post-commit, outside any transaction: the refund is final whatever GOODEX answers.
  // ensureParcelForRefund never throws and records its own outcome on the delivery row.
  await deliveryService.ensureParcelForRefund(refundId);
  return refundedOrder;
}

export async function confirmOrder(orderId) {
  if (!orderId) {
    throw new AppError('ID de commande requis', 400);
  }

  let confirmedNow = false;
  const confirmed = await runInTransaction(async (tx) => {
    const lockedOrder = await orderRepository.findByIdForUpdate(orderId, tx);
    if (!lockedOrder) {
      throw new AppError('Commande non trouvée', 404);
    }

    if (lockedOrder.status === 'cancelled') {
      throw new AppError('Impossible de confirmer une commande annulée', 400);
    }

    if (lockedOrder.status === 'refunded') {
      throw new AppError('Impossible de confirmer une commande remboursée', 400);
    }

    if (lockedOrder.status === 'delivered') {
      throw new AppError('Impossible de confirmer une commande déjà livrée', 400);
    }

    if (lockedOrder.status === 'pending' || lockedOrder.status === 'processing') {
      await orderRepository.updateStatus(orderId, 'completed', tx);
      confirmedNow = true;
    }

    return orderRepository.findById(orderId, tx);
  });

  // GOODEX parcel creation happens only after the confirmation has committed and
  // never inside the transaction. ensureParcelForOrder never throws.
  if (confirmedNow) {
    await deliveryService.ensureParcelForOrder(orderId);
  }
  return confirmed;
}

export async function deliverOrder(orderId) {
  if (!orderId) {
    throw new AppError('ID de commande requis', 400);
  }

  return runInTransaction(async (tx) => {
    const lockedOrder = await orderRepository.findByIdForUpdate(orderId, tx);
    if (!lockedOrder) {
      throw new AppError('Commande non trouvée', 404);
    }

    if (lockedOrder.status === 'delivered') {
      return orderRepository.findById(orderId, tx);
    }

    if (lockedOrder.status === 'cancelled') {
      throw new AppError('Impossible de marquer comme livrée une commande annulée', 400);
    }

    if (lockedOrder.status === 'refunded') {
      throw new AppError('Impossible de marquer comme livrée une commande remboursée', 400);
    }

    if (lockedOrder.status !== 'completed' && lockedOrder.status !== 'exchanged') {
      throw new AppError('Seules les commandes confirmées ou échangées peuvent être marquées comme livrées', 400);
    }

    await deliveryService.assertParcelCreated(orderId, tx);

    await orderRepository.updateStatus(orderId, 'delivered', tx);
    return orderRepository.findById(orderId, tx);
  });
}

export async function confirmOrders(orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return [];
  }
  if (orderIds.length > MAX_BULK_ORDER_IDS) {
    throw new AppError(`Trop de commandes pour la confirmation en masse (maximum ${MAX_BULK_ORDER_IDS})`, 400);
  }

  const confirmedList = [];
  for (const orderId of orderIds) {
    if (!orderId) continue;
    try {
      const confirmed = await confirmOrder(orderId);
      if (confirmed) confirmedList.push(confirmed);
    } catch (err) {
      console.warn(`[order.service] Skipping confirmation for order ${orderId}: ${err.message}`);
    }
  }
  return confirmedList;
}

export async function updateOrderStatus(orderId, status) {
  if (status === 'exchanged') {
    throw new AppError('Le statut "exchanged" ne peut pas être défini directement. Veuillez utiliser le processus d\'échange dédié.', 400);
  }

  const allowed = ['pending', 'processing', 'completed', 'delivered', 'cancelled', 'refunded'];
  if (!allowed.includes(status)) {
    throw new AppError('Statut de commande invalide', 400);
  }

  if (status === 'cancelled') {
    return cancelOrder(orderId);
  }

  if (status === 'refunded') {
    return refundOrder(orderId);
  }

  if (status === 'completed') {
    return confirmOrder(orderId);
  }

  if (status === 'delivered') {
    return deliverOrder(orderId);
  }

  return runInTransaction(async (tx) => {
    const lockedOrder = await orderRepository.findByIdForUpdate(orderId, tx);
    if (!lockedOrder) {
      throw new AppError('Commande non trouvée', 404);
    }

    if (lockedOrder.status === 'delivered') {
      throw new AppError('Impossible de modifier le statut d\'une commande livrée', 400);
    }

    if (lockedOrder.status === 'cancelled') {
      throw new AppError('Impossible de modifier le statut d\'une commande annulée', 400);
    }

    if (lockedOrder.status === 'refunded') {
      throw new AppError('Impossible de modifier le statut d\'une commande remboursée', 400);
    }

    if (lockedOrder.status === 'completed') {
      throw new AppError('Impossible de repasser une commande confirmée en attente ou en cours', 400);
    }

    if (lockedOrder.status === 'exchanged') {
      throw new AppError('Impossible de repasser une commande échangée en attente ou en cours', 400);
    }

    await orderRepository.updateStatus(orderId, status, tx);
    return orderRepository.findById(orderId, tx);
  });
}
