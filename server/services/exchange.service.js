import { orderRepository } from '../repositories/order.repository.js';
import { exchangeRepository } from '../repositories/exchange.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { themeRepository } from '../repositories/theme.repository.js';
import { runInTransaction } from '../repositories/transaction.repository.js';
import { AppError } from '../utils/errors.js';
import * as deliveryService from './delivery.service.js';
import { DELIVERY_ECONOMICS } from '../config/delivery.js';

function parseCustomerName(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
  };
}

function buildVariantLabel(variant) {
  const parts = [];
  if (variant.colorName) parts.push(variant.colorName);
  if (variant.size) parts.push(`Taille ${variant.size}`);
  return parts.join(' · ') || 'Standard';
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function calculateExchangeTransitions(previousMap, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Au moins un article est requis pour l\'échange', 400);
  }

  const VALID_ACTIONS = new Set(['keep', 'garder', 'return', 'retourner', 'replace', 'echanger', 'échanger', 'add', 'ajouter']);
  const seenVariantIds = new Set();

  for (const item of items) {
    if (!item.variantId || typeof item.variantId !== 'string' || !UUID_REGEX.test(item.variantId.trim())) {
      throw new AppError('Chaque article doit avoir une variante valide', 400);
    }

    const trimmedVariantId = item.variantId.trim();
    if (seenVariantIds.has(trimmedVariantId)) {
      throw new AppError(`Entrée en double pour la variante (${trimmedVariantId})`, 400);
    }
    seenVariantIds.add(trimmedVariantId);

    if (!item.action || typeof item.action !== 'string' || !item.action.trim()) {
      throw new AppError('L\'action est obligatoire pour chaque article (keep, return, replace, add)', 400);
    }

    const normAction = item.action.toLowerCase().trim();
    if (!VALID_ACTIONS.has(normAction)) {
      throw new AppError(`Action invalide pour l'article (${item.action})`, 400);
    }

    const rawQty = item.quantity;
    if (rawQty === null || rawQty === undefined || typeof rawQty === 'boolean') {
      throw new AppError('Quantité invalide pour l\'article', 400);
    }
    if (typeof rawQty === 'string' && !/^\d+$/.test(rawQty.trim())) {
      throw new AppError('Quantité invalide pour l\'article', 400);
    }
    const numQty = Number(rawQty);
    if (!Number.isInteger(numQty) || !Number.isFinite(numQty) || isNaN(numQty) || numQty <= 0) {
      throw new AppError('Quantité invalide pour l\'article', 400);
    }
  }

  const incomingVariantIds = items.map((i) => i.variantId);
  const allVariantIds = Array.from(new Set([...previousMap.keys(), ...incomingVariantIds])).sort();
  const variantTransitions = new Map();

  for (const variantId of allVariantIds) {
    const prevQty = previousMap.get(variantId) || 0;
    const line = items.find((i) => i.variantId === variantId);

    if (prevQty > 0) {
      // Existing variant previously held by customer
      if (!line) {
        // Variant held previously but omitted from exchange -> full return
        variantTransitions.set(variantId, {
          variantId,
          prevQty,
          keepQty: 0,
          returnQty: prevQty,
          replacementQty: 0,
          additionalQty: 0,
          warehouseRequirement: 0,
          resultingActiveQty: 0,
          netStockChange: prevQty,
        });
        continue;
      }

      const act = line.action.toLowerCase().trim();
      const qty = Number(line.quantity);

      let keepQty = 0;
      let returnQty = 0;
      let replacementQty = 0;
      let additionalQty = 0;

      if (act === 'keep' || act === 'garder') {
        if (qty > prevQty) {
          throw new AppError(`La quantité à garder (${qty}) ne peut pas dépasser la quantité actuelle (${prevQty})`, 400);
        }
        keepQty = qty;
        returnQty = prevQty - keepQty;
      } else if (act === 'replace' || act === 'echanger' || act === 'échanger') {
        if (qty <= 0) {
          throw new AppError('La quantité à échanger doit être supérieure à 0', 400);
        }
        if (qty > prevQty) {
          throw new AppError(`La quantité à échanger (${qty}) ne peut pas dépasser la quantité actuelle (${prevQty})`, 400);
        }
        replacementQty = qty;
        returnQty = qty;
        keepQty = prevQty - qty;
      } else if (act === 'return' || act === 'retourner') {
        if (qty <= 0) {
          throw new AppError('La quantité à retourner doit être supérieure à 0', 400);
        }
        if (qty > prevQty) {
          throw new AppError(`La quantité à retourner (${qty}) ne peut pas dépasser la quantité actuelle (${prevQty})`, 400);
        }
        returnQty = qty;
        keepQty = prevQty - qty;
      } else if (act === 'add' || act === 'ajouter') {
        // ADD on an already-held variant: increase the customer's quantity.
        // The existing units are fully preserved (keepQty = prevQty).
        // Fresh warehouse stock equal to qty is required independently.
        // returned/replaced units from this exchange NEVER satisfy this requirement.
        additionalQty = qty;
        keepQty = prevQty;
        // returnQty and replacementQty remain 0
      }

      variantTransitions.set(variantId, {
        variantId,
        prevQty,
        keepQty,
        returnQty,
        replacementQty,
        additionalQty,
        warehouseRequirement: replacementQty + additionalQty,
        resultingActiveQty: keepQty + replacementQty + additionalQty,
        netStockChange: returnQty - (replacementQty + additionalQty),
      });
    } else {
      // Variant was not held previously (prevQty === 0) -> New product added
      const act = line.action.toLowerCase().trim();
      const qty = Number(line.quantity);

      if (act !== 'add' && act !== 'ajouter') {
        throw new AppError(`Action invalide pour une nouvelle variante (${line.action}). Seule l'action 'add' est autorisée.`, 400);
      }
      if (qty <= 0) {
        throw new AppError('La quantité pour un nouvel article doit être supérieure à 0', 400);
      }

      variantTransitions.set(variantId, {
        variantId,
        prevQty: 0,
        keepQty: 0,
        returnQty: 0,
        replacementQty: 0,
        additionalQty: qty,
        warehouseRequirement: qty,
        resultingActiveQty: qty,
        netStockChange: -qty,
      });
    }
  }

  // Validation: Check Keep-Only Unchanged Exchange (no-op)
  const allTransitions = Array.from(variantTransitions.values());
  const isKeepOnlyUnchanged = allTransitions.every(
    (t) => t.replacementQty === 0 && t.additionalQty === 0 && t.returnQty === 0 && t.resultingActiveQty === t.prevQty
  );
  if (isKeepOnlyUnchanged) {
    throw new AppError("Aucune modification détectée. Un échange nécessite au moins un remplacement, un retour ou un ajout d'article.", 400);
  }

  // Validation: Check Zero-Item Resulting Active Quantity (all-return)
  const totalResultingActiveQty = allTransitions.reduce(
    (sum, t) => sum + t.resultingActiveQty,
    0
  );
  if (totalResultingActiveQty <= 0) {
    throw new AppError("Un échange doit contenir au moins un article actif. Pour un retour complet, veuillez utiliser le Remboursement.", 400);
  }

  return { variantTransitions, allVariantIds };
}

export async function previewExchange({ orderId, customer, items, deliveryFee = null, paymentResponsibility = 'customer_paid' }) {
  if (!orderId || typeof orderId !== 'string') {
    throw new AppError('ID de commande requis', 400);
  }
  if (!UUID_REGEX.test(orderId.trim())) {
    throw new AppError('ID de commande invalide', 400);
  }

  if (!customer?.customerName?.trim() || !customer?.phoneNumber?.trim() || !customer?.shippingAddress?.trim()) {
    throw new AppError('Informations du client incomplètes (nom, téléphone, adresse)', 400);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Au moins un article est requis pour l\'échange', 400);
  }

  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw new AppError('Commande introuvable', 404);
  }

  if (order.status === 'delivered') {
    throw new AppError('Impossible d\'échanger une commande déjà livrée', 400);
  }

  if (order.status !== 'completed' && order.status !== 'exchanged') {
    throw new AppError('Seules les commandes confirmées ou échangées peuvent faire l\'objet d\'un échange', 400);
  }

  const normalizedResp = paymentResponsibility === DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID
    ? DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID
    : DELIVERY_ECONOMICS.RESPONSIBILITIES.CUSTOMER_PAID;

  const latestExchange = await exchangeRepository.findLatestExchange(orderId);

  let previousItems = [];
  if (latestExchange && latestExchange.items) {
    previousItems = latestExchange.items.map((r) => ({ variantId: r.variantId, quantity: Number(r.quantity) }));
  } else {
    previousItems = (order.items || []).map((r) => ({ variantId: r.variantId, quantity: Number(r.quantity) }));
  }

  const previousMap = new Map();
  for (const pItem of previousItems) {
    if (pItem.variantId) {
      previousMap.set(pItem.variantId, (previousMap.get(pItem.variantId) || 0) + Number(pItem.quantity));
    }
  }

  const { variantTransitions, allVariantIds } = calculateExchangeTransitions(previousMap, items);

  const variantDetailsMap = new Map();
  for (const variantId of allVariantIds) {
    const v = await productRepository.findVariantById(variantId);
    if (v) {
      const p = await productRepository.findById(v.productId);
      variantDetailsMap.set(variantId, { ...v, productTitle: p?.name || '', price: p?.price || 0, discountAmount: p?.discount || 0 });
    }
  }

  for (const variantId of allVariantIds) {
    const transition = variantTransitions.get(variantId);
    if (transition && (transition.resultingActiveQty > 0 || transition.warehouseRequirement > 0)) {
      if (!variantDetailsMap.has(variantId)) {
        throw new AppError(`Variante introuvable (${variantId})`, 400);
      }
    }
  }

  for (const [variantId, transition] of variantTransitions.entries()) {
    const v = variantDetailsMap.get(variantId);
    if (!v) continue;
    if (transition.warehouseRequirement > 0 && v.stockQuantity < transition.warehouseRequirement) {
      throw new AppError(`${v.productTitle}: stock insuffisant (${v.stockQuantity} disponible(s))`, 400);
    }
  }

  const resolvedExchangeItems = [];
  for (const [variantId, transition] of variantTransitions.entries()) {
    if (transition.resultingActiveQty > 0) {
      const v = variantDetailsMap.get(variantId);
      const unitPrice = Number(v.price) - Number(v.discountAmount);
      const variantLabel = buildVariantLabel(v);

      resolvedExchangeItems.push({
        variantId: v.id,
        productId: v.productId,
        name: v.productTitle,
        productTitle: v.productTitle,
        details: variantLabel,
        variantLabel,
        image: v.colorImageUrl || null,
        imageUrl: v.colorImageUrl || null,
        quantity: transition.resultingActiveQty,
        price: unitPrice,
        unitPrice,
      });
    }
  }

  const subtotal = resolvedExchangeItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  let resolvedDeliveryFee;
  if (deliveryFee !== null && deliveryFee !== undefined) {
    resolvedDeliveryFee = Number(deliveryFee);
  } else if (normalizedResp === DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID) {
    resolvedDeliveryFee = DELIVERY_ECONOMICS.SILKY_PAID_EXCHANGE_CUSTOMER_FEE;
  } else {
    resolvedDeliveryFee = await themeRepository.getDeliveryFee();
  }

  const totalAmount = subtotal + resolvedDeliveryFee;
  const sequence = latestExchange ? latestExchange.exchangeSequence + 1 : 1;
  const exchangeNumber = `EXCH-${order.orderNumber}-${sequence}`;
  const { firstName, lastName } = parseCustomerName(customer.customerName);

  const previousSubtotal = latestExchange ? parseFloat(latestExchange.subtotal) : parseFloat(order.subtotal);
  const productDiff = Math.max(0, subtotal - previousSubtotal);
  const customerAmountToPay = productDiff + resolvedDeliveryFee;
  const productAmountAdded = Math.max(0, subtotal - previousSubtotal);
  const productRefundObligation = Math.max(0, previousSubtotal - subtotal);

  return {
    exchangeNumber,
    exchangeSequence: sequence,
    orderNumber: order.orderNumber,
    paymentResponsibility: normalizedResp,
    customer: {
      firstName,
      lastName,
      name: customer.customerName.trim(),
      email: customer.customerEmail?.trim() || null,
      phone: customer.phoneNumber.trim(),
      address: customer.shippingAddress.trim(),
    },
    items: resolvedExchangeItems,
    subtotal,
    deliveryFee: resolvedDeliveryFee,
    total: totalAmount,
    productAmountAdded,
    productRefundObligation,
    customerAmountToPay,
    finalCustomerPayableAmount: customerAmountToPay,
    createdAt: new Date().toISOString(),
  };
}

export async function createExchange({ orderId, customer, items, deliveryFee = null, paymentResponsibility = 'customer_paid' }) {
  if (!orderId || typeof orderId !== 'string') {
    throw new AppError('ID de commande requis', 400);
  }
  if (!UUID_REGEX.test(orderId.trim())) {
    throw new AppError('ID de commande invalide', 400);
  }

  if (!customer?.customerName?.trim() || !customer?.phoneNumber?.trim() || !customer?.shippingAddress?.trim()) {
    throw new AppError('Informations du client incomplètes (nom, téléphone, adresse)', 400);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Au moins un article est requis pour l\'échange', 400);
  }

  const normalizedResp = paymentResponsibility === DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID
    ? DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID
    : DELIVERY_ECONOMICS.RESPONSIBILITIES.CUSTOMER_PAID;

  let exchangeId;
  const updatedOrder = await runInTransaction(async (tx) => {
    const lockedOrder = await orderRepository.findByIdForUpdate(orderId, tx);
    if (!lockedOrder) {
      throw new AppError('Commande introuvable', 404);
    }

    if (lockedOrder.status === 'delivered') {
      throw new AppError('Impossible d\'échanger une commande déjà livrée', 400);
    }

    if (lockedOrder.status !== 'completed' && lockedOrder.status !== 'exchanged') {
      throw new AppError('Seules les commandes confirmées ou échangées peuvent faire l\'objet d\'un échange', 400);
    }

    await deliveryService.assertParcelCreated(orderId, tx);

    const latestExchange = await exchangeRepository.findLatestExchange(orderId, tx);

    let previousItems = [];
    if (latestExchange && latestExchange.items) {
      previousItems = latestExchange.items.map((r) => ({ variantId: r.variantId, quantity: Number(r.quantity) }));
    } else {
      const currentOrder = await orderRepository.findById(orderId, tx);
      previousItems = (currentOrder.items || []).map((r) => ({ variantId: r.variantId, quantity: Number(r.quantity) }));
    }

    const previousMap = new Map();
    for (const pItem of previousItems) {
      if (pItem.variantId) {
        previousMap.set(pItem.variantId, (previousMap.get(pItem.variantId) || 0) + Number(pItem.quantity));
      }
    }

    const { variantTransitions, allVariantIds } = calculateExchangeTransitions(previousMap, items);

    if (allVariantIds.length > 0) {
      await orderRepository.lockVariantsForUpdate(allVariantIds, tx);
    }

    const variantDetailsMap = new Map();
    for (const variantId of allVariantIds) {
      const v = await productRepository.findVariantById(variantId, tx);
      if (v) {
        const p = await productRepository.findById(v.productId, tx);
        variantDetailsMap.set(variantId, { ...v, productTitle: p?.name || '', price: p?.price || 0, discountAmount: p?.discount || 0 });
      }
    }

    for (const variantId of allVariantIds) {
      const transition = variantTransitions.get(variantId);
      if (transition && (transition.resultingActiveQty > 0 || transition.warehouseRequirement > 0)) {
        if (!variantDetailsMap.has(variantId)) {
          throw new AppError(`Variante introuvable (${variantId})`, 400);
        }
      }
    }

    // Authoritative stock validation after locks
    for (const [variantId, transition] of variantTransitions.entries()) {
      const v = variantDetailsMap.get(variantId);
      if (!v) continue;
      if (transition.warehouseRequirement > 0 && v.stockQuantity < transition.warehouseRequirement) {
        throw new AppError(`${v.productTitle}: stock insuffisant (${v.stockQuantity} disponible(s))`, 400);
      }
    }

    // Atomic inventory mutation
    for (const [variantId, transition] of variantTransitions.entries()) {
      const v = variantDetailsMap.get(variantId);
      if (!v) continue;
      if (transition.netStockChange !== 0) {
        const updatedStock = v.stockQuantity + transition.netStockChange;
        await productRepository.updateVariantStock(variantId, updatedStock, tx);
      }
    }

    const resolvedExchangeItems = [];
    for (const [variantId, transition] of variantTransitions.entries()) {
      if (transition.resultingActiveQty > 0) {
        const v = variantDetailsMap.get(variantId);
        const unitPrice = Number(v.price) - Number(v.discountAmount);
        const variantLabel = buildVariantLabel(v);

        resolvedExchangeItems.push({
          variantId: v.id,
          productId: v.productId,
          name: v.productTitle,
          productTitle: v.productTitle,
          details: variantLabel,
          variantLabel,
          image: v.colorImageUrl || null,
          imageUrl: v.colorImageUrl || null,
          quantity: transition.resultingActiveQty,
          price: unitPrice,
          unitPrice,
        });
      }
    }

    const subtotal = resolvedExchangeItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    let resolvedDeliveryFee;
    if (deliveryFee !== null && deliveryFee !== undefined) {
      resolvedDeliveryFee = Number(deliveryFee);
    } else if (normalizedResp === DELIVERY_ECONOMICS.RESPONSIBILITIES.SILKY_PAID) {
      resolvedDeliveryFee = DELIVERY_ECONOMICS.SILKY_PAID_EXCHANGE_CUSTOMER_FEE;
    } else {
      resolvedDeliveryFee = await themeRepository.getDeliveryFee(tx);
    }

    const totalAmount = subtotal + resolvedDeliveryFee;
    const sequence = latestExchange ? latestExchange.exchangeSequence + 1 : 1;
    const exchangeNumber = `EXCH-${lockedOrder.orderNumber}-${sequence}`;

    const previousSubtotal = latestExchange ? parseFloat(latestExchange.subtotal) : parseFloat(lockedOrder.subtotal);
    const productAmountAdded = Math.max(0, subtotal - previousSubtotal);
    const productRefundObligation = Math.max(0, previousSubtotal - subtotal);

    const exchangeRecord = await exchangeRepository.createExchangeRecord({
      orderId,
      exchangeNumber,
      exchangeSequence: sequence,
      paymentResponsibility: normalizedResp,
      customerName: customer.customerName.trim(),
      customerEmail: customer.customerEmail?.trim() || null,
      customerPhone: customer.phoneNumber.trim(),
      shippingAddress: customer.shippingAddress.trim(),
      subtotal,
      deliveryFee: resolvedDeliveryFee,
      totalAmount,
      productAmountAdded,
      productRefundObligation,
    }, resolvedExchangeItems, tx);
    exchangeId = exchangeRecord.id;

    await orderRepository.updateStatus(orderId, 'exchanged', tx);

    return orderRepository.findById(orderId, tx);
  });

  // Post-commit, outside any transaction: the exchange is final whatever GOODEX answers.
  // This is the exchange's own parcel; the ordinary order parcel path is never involved.
  // ensureParcelForExchange never throws and records its own outcome on the delivery row.
  await deliveryService.ensureParcelForExchange(exchangeId);
  return updatedOrder;
}


