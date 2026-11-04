import { orderRepository, calculateOrderCustomerAmountToPay } from '../repositories/order.repository.js';
import { deliveryRepository } from '../repositories/delivery.repository.js';
import { exchangeRepository } from '../repositories/exchange.repository.js';
import { refundRepository } from '../repositories/refund.repository.js';
import { runInTransaction } from '../repositories/transaction.repository.js';
import { AppError } from '../utils/errors.js';
import * as goodexClient from './goodex.client.js';
import {
  resolveGoodexStatus,
  normalizeGoodexStatus,
  GOODEX_NOT_FOUND_STATUS,
  deliveryStatusCode,
  goodexStatusLabel,
  DELIVERY_REFRESH_COOLDOWN_MS,
  formatCod,
  resolveParcelGovernorate,
  resolveExchangeAddress,
  missingApiConfig,
  configErrorMessage,
} from '../config/goodex.js';

const PERSIST_ATTEMPTS = 3;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Log lines must not carry the customer's data, even when a provider error or one of our own
 * validation messages echoes it. Matching is case-insensitive and tolerates other spacing, and
 * a phone number is matched digit by digit so "12 34 56 78" or "+216 12-34-56-78" is masked too.
 * `values` are the raw customer strings (name, phone, address ...). The text saved for the admin
 * (last_error) is NOT passed through here.
 */
function redactCustomerData(text, values) {
  let out = String(text ?? '');
  for (const raw of values || []) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length < 3) continue;
    const digits = value.replace(/\D/g, '');
    const looksLikePhone = digits.length >= 6 && digits.length >= value.replace(/\s/g, '').length - 2;
    const pattern = looksLikePhone
      ? digits.split('').join('[\\s.-]*')
      : value.split(/\s+/).map(escapeRegExp).join('\\s+');
    out = out.replace(new RegExp(pattern, 'gi'), '***');
  }
  return out;
}
const MAX_DESIGNATION_LENGTH = 250;

// Drizzle wraps driver errors; the Postgres code lives on `cause`.
function isUniqueViolation(err) {
  return (err?.cause?.code || err?.code) === '23505';
}

/** Turns a provider status (text or numeric id) into the columns we store, or null if empty. */
function toStatusPatch(statut) {
  const resolved = resolveGoodexStatus(statut);
  if (!resolved) return null;
  return {
    goodexStatus: resolved.raw,
    goodexStatusId: resolved.id,
    deliveryStatus: deliveryStatusCode(resolved),
  };
}

/**
 * Delivery summary for the admin UI. This is GOODEX data only ("Statut livraison"):
 * statusLabel is the official French label when the status is recognized, otherwise null
 * and goodexStatus carries the raw provider value. It never feeds Silky's order status.
 */
export function toPublicDelivery(row) {
  if (!row) return null;
  return {
    state: row.state,
    exchangeId: row.exchangeId ?? null,
    refundId: row.refundId ?? null,
    ean: row.ean,
    parcelId: row.goodexParcelId ?? null,
    goodexCreatedAt: row.goodexCreatedAt ?? null,
    codAmount: row.codAmount == null ? null : parseFloat(row.codAmount),
    statusId: row.goodexStatusId ?? null,
    statusLabel: goodexStatusLabel(row.goodexStatusId),
    goodexStatus: row.goodexStatus,
    deliveryStatus: row.deliveryStatus,
    trackingNotFound: Boolean(row.trackingNotFoundAt),
    motif: row.motif,
    hasMotif: row.hasMotif ?? null,
    // The single rule for showing an incident: the parcel exists, a reason text was received
    // and GOODEX has not said (has_motif false) that there is no reason.
    incident: Boolean(row.state === 'created' && row.motif && row.hasMotif !== false),
    motifUpdatedAt: row.motifUpdatedAt,
    statusUpdatedAt: row.statusUpdatedAt,
    statusReceivedAt: row.statusReceivedAt,
    lastWebhookAt: row.lastWebhookAt,
    lastPolledAt: row.lastPolledAt,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
  };
}

function buildParcelFields(order) {
  const problems = [];
  const gov = resolveParcelGovernorate(order);
  if (gov.error) problems.push(gov.error);

  const client = (order.customer?.name || '').trim();
  const adresse = (order.customer?.shippingAddress || '').trim();
  const gsm1 = (order.customer?.phone || '').trim();
  if (!client) problems.push('Nom du client manquant');
  if (!adresse) problems.push('Adresse manquante');
  if (!gsm1) problems.push('Téléphone manquant');

  const codValue = calculateOrderCustomerAmountToPay(order);
  if (!Number.isFinite(codValue) || codValue < 0) problems.push('Montant à encaisser invalide');

  const items = order.items || [];
  const productLines = items
    .map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} x${i.quantity}`)
    .join(', ')
    .slice(0, MAX_DESIGNATION_LENGTH);
  const nbre = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

  return {
    problems,
    codValue,
    pii: [client, gsm1, adresse],
    fields: {
      client,
      cod: formatCod(codValue),
      adresse,
      governorat: gov.name,
      gsm1,
      nbre: nbre || undefined,
      // The product lines are sent in `remarque`; `designation` is not sent.
      remarque: productLines,
    },
  };
}

/**
 * Parcel fields for an exchange. Everything comes from the persisted exchange, never from
 * the button that created it: `cod` is the exchange's "montant à payer" exactly as Silky
 * shows it (formatOrder's customerAmountToPay), `echange` is always 1 and `decharge` is always 0.
 * gsm2 is omitted (an exchange records one phone number).
 */
function buildExchangeParcelFields(order, exchange) {
  const problems = [];
  const address = resolveExchangeAddress(exchange.customer?.address);
  if (address.error) problems.push(address.error);

  const client = (exchange.customer?.name || '').trim();
  const gsm1 = (exchange.customer?.phone || '').trim();
  if (!client) problems.push('Nom du client manquant');
  if (!gsm1) problems.push('Téléphone manquant');

  const codValue = Number(exchange.customerAmountToPay);
  if (!Number.isFinite(codValue) || codValue < 0) problems.push('Montant à encaisser invalide');

  const items = exchange.items || [];
  const productLines = items
    .map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} x${i.quantity}`)
    .join(', ')
    .slice(0, MAX_DESIGNATION_LENGTH);
  const nbre = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

  // An invalid "<prefix> — <street>" address echoes the prefix in our own message, and the prefix
  // can be street text, so the raw address and its parts are masked in logs.
  const rawAddress = String(exchange.customer?.address || '');
  return {
    problems,
    codValue,
    pii: [client, gsm1, rawAddress, address.adresse, ...rawAddress.split(' — ')],
    fields: {
      client,
      cod: formatCod(codValue),
      adresse: address.adresse,
      governorat: address.governorat,
      gsm1,
      nbre: nbre || undefined,
      // The product lines are sent in `remarque`; `designation` is not sent.
      remarque: productLines,
      echange: '1',
      decharge: '0',
    },
  };
}

/**
 * Parcel fields for a refund (Remboursement / Remboursement gratuit). Everything comes from the
 * persisted refund: `cod` is the refund's "montant à payer" exactly as Silky shows it (formatOrder's
 * refund customerAmountToPay: 8 TND, or 0 for a free refund), and `echange` and `decharge` are always 0.
 * The address is the one `refundOrder` copied onto the refund: the latest exchange's
 * "<Governorate> — <street>" when the order was exchanged, otherwise the order's street plus the
 * order's governorate. gsm2 is omitted (a refund records one phone number).
 */
function buildRefundParcelFields(order, refund) {
  const problems = [];
  let governorat;
  let adresse;
  if ((order.exchanges || []).length > 0) {
    const address = resolveExchangeAddress(refund.customer?.address);
    if (address.error) problems.push(address.error);
    governorat = address.governorat;
    adresse = address.adresse;
  } else {
    const gov = resolveParcelGovernorate(order);
    if (gov.error) problems.push(gov.error);
    governorat = gov.name;
    adresse = (refund.customer?.address || '').trim();
    if (!adresse) problems.push('Adresse manquante');
  }

  const client = (refund.customer?.name || '').trim();
  const gsm1 = (refund.customer?.phone || '').trim();
  if (!client) problems.push('Nom du client manquant');
  if (!gsm1) problems.push('Téléphone manquant');

  const codValue = Number(refund.customerAmountToPay);
  if (!Number.isFinite(codValue) || codValue < 0) problems.push('Montant à encaisser invalide');

  const items = refund.items || [];
  const productLines = items
    .map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} x${i.quantity}`)
    .join(', ')
    .slice(0, MAX_DESIGNATION_LENGTH);
  const nbre = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

  const rawAddress = String(refund.customer?.address || '');
  return {
    problems,
    codValue,
    pii: [client, gsm1, rawAddress, adresse, ...rawAddress.split(' — ')],
    fields: {
      client,
      cod: formatCod(codValue),
      adresse,
      governorat,
      gsm1,
      nbre: nbre || undefined,
      // The product lines are sent in `remarque`; `designation` is not sent.
      remarque: productLines,
      echange: '0',
      decharge: '0',
    },
  };
}

async function persistCreated(deliveryId, ean, details) {
  let lastErr;
  for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt += 1) {
    try {
      return await runInTransaction((tx) => deliveryRepository.markCreated(deliveryId, ean, details, tx));
    } catch (err) {
      lastErr = err;
      if (isUniqueViolation(err)) break; // ean already linked elsewhere: retrying cannot help
    }
  }
  throw lastErr;
}

function parcelTarget(row) {
  if (row.exchangeId) return `exchange ${row.exchangeId}`;
  if (row.refundId) return `refund ${row.refundId}`;
  return `order ${row.orderId}`;
}

/**
 * Runs the claimed creation: validates locally, performs the single POST outside
 * any DB transaction, and records the outcome. Never throws.
 */
async function runClaimedCreation(claimed, built) {
  const target = parcelTarget(claimed);

  // Configuration first: a missing credential must not surface as a data problem.
  const missing = missingApiConfig();
  if (missing.length) {
    console.warn(`[delivery] Parcel not created for ${target}: ${configErrorMessage(missing)}`);
    return deliveryRepository.markState(claimed.id, 'failed', configErrorMessage(missing));
  }

  const { problems, fields, pii } = built;
  const safe = (text) => redactCustomerData(text, pii);
  if (problems.length) {
    console.warn(`[delivery] Parcel not created for ${target}: ${safe(problems.join(' ; '))}`);
    return deliveryRepository.markState(claimed.id, 'failed', problems.join(' ; '));
  }

  const result = await goodexClient.createParcel(fields);
  if (!result.ok) {
    console.warn(`[delivery] Parcel creation ${result.outcome} for ${target}: ${safe(result.error)}`);
    return deliveryRepository.markState(claimed.id, result.outcome, result.error);
  }

  try {
    return await persistCreated(claimed.id, result.ean, {
      status: toStatusPatch(result.lastStatut),
      parcelId: result.parcelId,
      createdAt: result.createdAt,
    });
  } catch (err) {
    // The parcel exists at GOODEX but we could not save it. Never POST again.
    console.error(
      `[delivery] Parcel created but not persisted for ${target} (ean ${result.ean}): ${safe(err.message)}`
    );
    try {
      return await deliveryRepository.markState(
        claimed.id,
        'unknown',
        `Colis créé chez GOODEX (ean ${result.ean}) mais non enregistré : ${err.message}`
      );
    } catch {
      return null;
    }
  }
}

async function loadOrderOrThrow(orderId) {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('Commande non trouvée', 404);
  return order;
}

/**
 * Creates the GOODEX parcel for a confirmed order exactly once. Concurrent or
 * repeated calls lose the claim and return the existing row without any request.
 * Never throws: the order confirmation must not depend on GOODEX.
 */
export async function ensureParcelForOrder(orderId) {
  try {
    const order = await orderRepository.findById(orderId);
    if (!order || order.status !== 'completed') return null;

    const claimed = await deliveryRepository.claimNew(order.id, calculateOrderCustomerAmountToPay(order));
    if (!claimed) return deliveryRepository.findByOrderId(order.id);

    return await runClaimedCreation(claimed, buildParcelFields(order));
  } catch (err) {
    console.error(`[delivery] ensureParcelForOrder failed for order ${orderId}: ${err.message}`);
    return null;
  }
}

/** The exchange as Silky presents it (with its payable amount). */
async function loadExchangeParcelContext(exchangeId) {
  const stored = await exchangeRepository.findById(exchangeId);
  if (!stored) throw new AppError('Échange non trouvé', 404);
  const order = await loadOrderOrThrow(stored.orderId);
  const exchange = (order.exchanges || []).find((e) => e.id === exchangeId);
  if (!exchange) throw new AppError('Échange non trouvé', 404);
  return { order, exchange };
}

/**
 * Creates the separate GOODEX parcel of a confirmed exchange exactly once. The delivery row
 * is keyed by the exchange, so a repeated or concurrent call loses the claim and returns the
 * existing row without any request; other exchanges of the same order and the order's own
 * parcel are never read or written. Never throws: the exchange is already committed and
 * must not depend on GOODEX.
 */
export async function ensureParcelForExchange(exchangeId) {
  try {
    const { order, exchange } = await loadExchangeParcelContext(exchangeId);

    const claimed = await deliveryRepository.claimExchange(order.id, exchange.id, Number(exchange.customerAmountToPay) || 0);
    if (!claimed) return deliveryRepository.findByExchangeId(exchange.id);

    return await runClaimedCreation(claimed, buildExchangeParcelFields(order, exchange));
  } catch (err) {
    console.error(`[delivery] ensureParcelForExchange failed for exchange ${exchangeId}: ${err.message}`);
    return null;
  }
}

export async function getExchangeDelivery(exchangeId) {
  const stored = await exchangeRepository.findById(exchangeId);
  if (!stored) throw new AppError('Échange non trouvé', 404);
  await deliveryRepository.expireStaleClaims([stored.orderId]);
  return deliveryRepository.findByExchangeId(exchangeId);
}

/** Explicit admin retry for an exchange parcel; same rules as retryParcel. */
export async function retryExchangeParcel(exchangeId, { acknowledgeUnknown = false } = {}) {
  const { order, exchange } = await loadExchangeParcelContext(exchangeId);

  await deliveryRepository.expireStaleClaims([order.id]);
  const existing = await deliveryRepository.findByExchangeId(exchange.id);
  const codAmount = Number(exchange.customerAmountToPay) || 0;

  let claimed;
  if (!existing) {
    claimed = await deliveryRepository.claimExchange(order.id, exchange.id, codAmount);
  } else if (existing.state === 'failed') {
    claimed = await deliveryRepository.reclaimExchange(exchange.id, ['failed'], codAmount);
  } else if (existing.state === 'unknown') {
    if (!acknowledgeUnknown) {
      throw new AppError('Résultat incertain : vérifiez chez GOODEX qu\'aucun colis n\'existe, puis confirmez', 409);
    }
    claimed = await deliveryRepository.reclaimExchange(exchange.id, ['unknown'], codAmount);
  } else {
    throw new AppError(
      existing.state === 'created' ? 'Un colis existe déjà pour cet échange' : 'Création du colis en cours',
      409
    );
  }

  if (!claimed) throw new AppError('Création du colis déjà en cours', 409);
  const row = await runClaimedCreation(claimed, buildExchangeParcelFields(order, exchange));
  return row || deliveryRepository.findByExchangeId(exchange.id);
}

/** The refund as Silky presents it (with its payable amount), plus the order it belongs to. */
async function loadRefundParcelContext(refundId) {
  const stored = await refundRepository.findById(refundId);
  if (!stored) throw new AppError('Remboursement non trouvé', 404);
  const order = await loadOrderOrThrow(stored.orderId);
  const refund = (order.refunds || []).find((r) => r.id === refundId);
  if (!refund) throw new AppError('Remboursement non trouvé', 404);
  return { order, refund };
}

/**
 * Creates the separate GOODEX parcel of a refund exactly once, with the refund's "montant à payer"
 * as `cod` and echange=0 / decharge=0. Same claim row as the exchange parcels, keyed by the refund,
 * so a repeated or concurrent call returns the existing row without any request. Never throws: the
 * refund is already committed and must not depend on GOODEX.
 */
export async function ensureParcelForRefund(refundId) {
  try {
    const { order, refund } = await loadRefundParcelContext(refundId);

    const claimed = await deliveryRepository.claimRefund(order.id, refund.id, Number(refund.customerAmountToPay) || 0);
    if (!claimed) return deliveryRepository.findByRefundId(refund.id);

    return await runClaimedCreation(claimed, buildRefundParcelFields(order, refund));
  } catch (err) {
    console.error(`[delivery] ensureParcelForRefund failed for refund ${refundId}: ${err.message}`);
    return null;
  }
}

export async function getRefundDelivery(refundId) {
  const stored = await refundRepository.findById(refundId);
  if (!stored) throw new AppError('Remboursement non trouvé', 404);
  await deliveryRepository.expireStaleClaims([stored.orderId]);
  return deliveryRepository.findByRefundId(refundId);
}

/** Explicit admin retry for a refund parcel; same rules as retryParcel. */
export async function retryRefundParcel(refundId, { acknowledgeUnknown = false } = {}) {
  const { order, refund } = await loadRefundParcelContext(refundId);

  await deliveryRepository.expireStaleClaims([order.id]);
  const existing = await deliveryRepository.findByRefundId(refund.id);
  const codAmount = Number(refund.customerAmountToPay) || 0;

  let claimed;
  if (!existing) {
    claimed = await deliveryRepository.claimRefund(order.id, refund.id, codAmount);
  } else if (existing.state === 'failed') {
    claimed = await deliveryRepository.reclaimRefund(refund.id, ['failed'], codAmount);
  } else if (existing.state === 'unknown') {
    if (!acknowledgeUnknown) {
      throw new AppError('Résultat incertain : vérifiez chez GOODEX qu\'aucun colis n\'existe, puis confirmez', 409);
    }
    claimed = await deliveryRepository.reclaimRefund(refund.id, ['unknown'], codAmount);
  } else {
    throw new AppError(
      existing.state === 'created' ? 'Un colis existe déjà pour ce remboursement' : 'Création du colis en cours',
      409
    );
  }

  if (!claimed) throw new AppError('Création du colis déjà en cours', 409);
  const row = await runClaimedCreation(claimed, buildRefundParcelFields(order, refund));
  return row || deliveryRepository.findByRefundId(refund.id);
}

export async function getDelivery(orderId) {
  await deliveryRepository.expireStaleClaims([orderId]);
  return deliveryRepository.findByOrderId(orderId);
}

let parcelGuardDisabledForTests = false;

/** Test hook (like setMockOrderConfirmationSender): legacy scripts that are not about GOODEX turn the guard off. */
export function disableParcelGuardForTests() {
  if (process.env.NODE_ENV === 'production') throw new Error('disableParcelGuardForTests is for tests only');
  parcelGuardDisabledForTests = true;
}

/**
 * Deliver / exchange / refund must wait until GOODEX has the parcel. Called inside the action's
 * transaction (reads only, no external call). Same rule as the admin buttons: the order is held
 * back only when a parcel row exists and is not "created" (failed, unknown, creating), or when
 * one of its exchange parcels is failed / unknown. Orders confirmed before GOODEX was connected
 * have no row and stay allowed.
 */
export async function assertParcelCreated(orderId, tx) {
  if (parcelGuardDisabledForTests) return;
  const row = await deliveryRepository.findByOrderId(orderId, tx);
  const exchangeRows = await deliveryRepository.findExchangeRowsByOrderIds([orderId], tx);
  const blocked = (row && row.state !== 'created')
    || exchangeRows.some((r) => r.state === 'failed' || r.state === 'unknown');
  if (blocked) {
    throw new AppError("Le colis GOODEX n'a pas encore été créé pour cette commande : réessayez la création avant de continuer", 409);
  }
}

/** Adds a `delivery` summary to one admin order or a list of them. */
export async function attachDelivery(orderOrOrders) {
  const list = Array.isArray(orderOrOrders) ? orderOrOrders : [orderOrOrders];
  const ids = list.filter(Boolean).map((o) => o.id);
  try {
    await deliveryRepository.expireStaleClaims(ids);
    const rows = await deliveryRepository.findByOrderIds(ids);
    const byOrder = new Map(rows.map((r) => [r.orderId, r]));

    // Each exchange carries its own parcel; the order's `delivery` stays the ordinary parcel.
    const exchangeRows = await deliveryRepository.findExchangeRowsByOrderIds(ids);
    const byExchange = new Map(exchangeRows.map((r) => [r.exchangeId, r]));
    const withExchangeDeliveries = (o) => (
      Array.isArray(o.exchanges) && o.exchanges.length
        ? {
            ...o,
            exchanges: o.exchanges.map((e) => ({
              ...e,
              delivery: toPublicDelivery(byExchange.get(e.id)),
            })),
          }
        : o
    );

    // A refund carries its own parcel as well (Remboursement / Remboursement gratuit).
    const refundRows = await deliveryRepository.findRefundRowsByOrderIds(ids);
    const byRefund = new Map(refundRows.map((r) => [r.refundId, r]));
    const withRefundDeliveries = (o) => (
      Array.isArray(o.refunds) && o.refunds.length
        ? {
            ...o,
            refunds: o.refunds.map((r) => ({
              ...r,
              delivery: toPublicDelivery(byRefund.get(r.id)),
            })),
          }
        : o
    );
    const withDelivery = (o) => (o ? withRefundDeliveries(withExchangeDeliveries({ ...o, delivery: toPublicDelivery(byOrder.get(o.id)) })) : o);
    return Array.isArray(orderOrOrders) ? list.map(withDelivery) : withDelivery(orderOrOrders);
  } catch (err) {
    console.error('[delivery] Could not attach delivery summaries:', err.message);
    return orderOrOrders;
  }
}

/**
 * Explicit admin retry. 'failed' is safe to resend. 'unknown' may already exist at
 * GOODEX, so the admin must acknowledge having checked there first.
 */
export async function retryParcel(orderId, { acknowledgeUnknown = false } = {}) {
  const order = await loadOrderOrThrow(orderId);
  if (order.status !== 'completed') {
    throw new AppError('Seules les commandes confirmées peuvent avoir un colis GOODEX', 400);
  }

  await deliveryRepository.expireStaleClaims([order.id]);
  const existing = await deliveryRepository.findByOrderId(order.id);
  const codAmount = calculateOrderCustomerAmountToPay(order);

  let claimed;
  if (!existing) {
    claimed = await deliveryRepository.claimNew(order.id, codAmount);
  } else if (existing.state === 'failed') {
    claimed = await deliveryRepository.reclaim(order.id, ['failed'], codAmount);
  } else if (existing.state === 'unknown') {
    if (!acknowledgeUnknown) {
      throw new AppError('Résultat incertain : vérifiez chez GOODEX qu\'aucun colis n\'existe, puis confirmez', 409);
    }
    claimed = await deliveryRepository.reclaim(order.id, ['unknown'], codAmount);
  } else {
    throw new AppError(
      existing.state === 'created' ? 'Un colis existe déjà pour cette commande' : 'Création du colis en cours',
      409
    );
  }

  if (!claimed) throw new AppError('Création du colis déjà en cours', 409);
  const row = await runClaimedCreation(claimed, buildParcelFields(order));
  return row || deliveryRepository.findByOrderId(order.id);
}

export async function linkExistingEan(orderId, ean) {
  const trimmed = typeof ean === 'string' ? ean.trim() : '';
  if (!/^\S{1,64}$/.test(trimmed)) {
    throw new AppError('Code de suivi (ean) invalide', 400);
  }
  const order = await loadOrderOrThrow(orderId);
  // Same rule as the retry: an unconfirmed, cancelled or refunded order never holds a parcel.
  if (!['completed', 'exchanged', 'delivered'].includes(order.status)) {
    throw new AppError('Seules les commandes confirmées peuvent avoir un colis GOODEX', 400);
  }
  try {
    const row = await deliveryRepository.linkEan(order.id, trimmed, calculateOrderCustomerAmountToPay(order));
    if (!row) throw new AppError('Un colis est déjà enregistré pour cette commande', 409);
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('Ce code de suivi est déjà associé à une autre commande', 409);
    throw err;
  }
}

/**
 * Fetches the live status from GOODEX (GET). Explicit admin refreshes always call
 * GOODEX. With `onlyIfStale` (used when order details are opened) the saved data is
 * returned untouched if anything was received or polled within the cooldown, so
 * opening details repeatedly cannot hammer the API. Returns { row, skipped }.
 */
export async function refreshStatus(orderId, options = {}) {
  return refreshRow(await getDelivery(orderId), options, 'cette commande');
}

export async function refreshExchangeStatus(exchangeId, options = {}) {
  return refreshRow(await getExchangeDelivery(exchangeId), options, 'cet échange');
}

export async function refreshRefundStatus(refundId, options = {}) {
  return refreshRow(await getRefundDelivery(refundId), options, 'ce remboursement');
}

async function refreshRow(row, { onlyIfStale = false } = {}, subject) {
  if (!row || row.state !== 'created' || !row.ean) {
    throw new AppError(`Aucun colis GOODEX à suivre pour ${subject}`, 404);
  }

  if (onlyIfStale) {
    const freshest = Math.max(
      ...[row.lastPolledAt, row.lastWebhookAt, row.statusUpdatedAt].map((d) => (d ? new Date(d).getTime() : 0))
    );
    if (freshest && Date.now() - freshest < DELIVERY_REFRESH_COOLDOWN_MS) {
      return { row, skipped: true };
    }
  }

  const outcome = await trackAndApply(row);
  if (!outcome.ok) {
    throw new AppError(`Suivi GOODEX indisponible : ${outcome.error}`, outcome.configError ? 503 : 502);
  }
  return { row: outcome.row || row, skipped: false };
}

/**
 * One tracking request (GET) for an existing parcel plus saving of a valid answer. A failed or
 * invalid answer touches nothing saved. "Colis Introuvable" is recorded apart (trackingNotFound)
 * and leaves the last valid status in place. Database errors propagate to the caller.
 * Returns { ok: false, kind, error, configError, retryAfterMs, row } on a provider failure
 * (kind: config | auth | rate_limit | server | network | timeout | invalid), otherwise
 * { ok: true, outcome: 'updated' | 'unchanged' | 'not_found' | 'skipped', changed, row }.
 */
async function trackAndApply(row) {
  const requestedAt = new Date();
  const result = await goodexClient.trackParcel(row.ean);
  if (!result.ok) {
    return {
      ok: false,
      kind: result.kind || 'invalid',
      error: result.error,
      configError: Boolean(result.configError),
      retryAfterMs: result.retryAfterMs ?? null,
      row,
    };
  }

  const applied = await runInTransaction((tx) =>
    deliveryRepository.applyStatus(
      row.id,
      {
        status: result.notFound ? null : toStatusPatch(result.statut),
        notFound: Boolean(result.notFound),
        motif: result.motif,
        hasMotif: result.hasMotif,
        source: 'poll',
        requestedAt,
      },
      tx
    )
  );
  let outcome = applied.changed ? 'updated' : 'unchanged';
  if (applied.skipped) outcome = 'skipped'; // a webhook arrived while the request was in flight
  else if (result.notFound) outcome = 'not_found';
  return { ok: true, outcome, changed: Boolean(applied.changed), row: applied.row || row };
}

/**
 * Row-level refresh for the background reconciler: tracks one EXISTING parcel row (ordinary or
 * exchange) and saves a valid status. Never creates, retries or modifies anything at GOODEX,
 * never throws (a database error becomes kind 'internal'), and returns a structured outcome so
 * the caller never has to parse a message. Manual refresh keeps using refreshStatus.
 */
export async function refreshDeliveryRow(row) {
  if (!row || row.state !== 'created' || !row.ean) {
    return { ok: false, kind: 'ineligible', error: 'Aucun colis GOODEX à suivre', configError: false, retryAfterMs: null, row };
  }
  try {
    return await trackAndApply(row);
  } catch (err) {
    // Only the Postgres error code is exposed: Drizzle messages embed the query parameters.
    return { ok: false, kind: 'internal', error: 'Enregistrement du statut impossible', configError: false, retryAfterMs: null, row, dbCode: err?.cause?.code || err?.code || null };
  }
}

/**
 * Applies a webhook notification. Idempotent: replaying the same status/motif
 * changes nothing; an omitted motif never erases the stored one. Makes no outbound calls so it stays fast.
 */
export async function applyWebhook({ code, statut, motif }) {
  const row = await deliveryRepository.findByEan(code);
  if (!row) return { result: 'unknown_code' };

  // "Colis Introuvable" is a lookup outcome, not a status (and not in the documented webhook
  // list): same handling as a tracking poll, so it can never replace the saved status.
  const notFound = normalizeGoodexStatus(statut) === normalizeGoodexStatus(GOODEX_NOT_FOUND_STATUS);
  const { changed } = await runInTransaction((tx) =>
    deliveryRepository.applyStatus(
      row.id,
      notFound
        ? { status: null, notFound: true, source: 'webhook' }
        : { status: toStatusPatch(statut), motif, source: 'webhook' },
      tx
    )
  );
  return { result: changed ? 'updated' : 'duplicate' };
}
