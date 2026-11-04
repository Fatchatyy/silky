import { env } from '../config/env.js';
import { orderRepository } from '../repositories/order.repository.js';
import { deliveryRepository } from '../repositories/delivery.repository.js';
import { claimRepository } from '../repositories/claim.repository.js';
import { AppError } from '../utils/errors.js';
import { validateClaimInput } from '../utils/claimValidation.js';
import * as goodexClient from './goodex.client.js';
import * as deliveryService from './delivery.service.js';
import {
  configErrorMessage,
  GOODEX_INITIAL_STATUS_ID,
  CLAIM_TYPES_TTL_MS,
  CLAIM_COUNTS_TTL_MS,
  CLAIMS_DEFAULT_PER_PAGE,
  CLAIMS_MAX_PER_PAGE,
} from '../config/goodex.js';

/**
 * GOODEX delivery claims (tickets) on a parcel. GOODEX is the source of truth; Silky keeps a
 * local copy (id + reference) so an admin can find a claim again. Claims never change an
 * order's status, payment or totals, and cancelling a claim never cancels the parcel.
 *
 * Duplicate safety differs from parcel creation: GOODEX itself refuses a second open claim of
 * the same type on a parcel (HTTP 200 + already_sent), so re-submitting after an uncertain
 * outcome is safe, and an already_sent answer is never presented as a new claim.
 */

export class ClaimError extends AppError {
  constructor(message, status, extra = {}) {
    super(message, status);
    Object.assign(this, extra);
  }
}

const DOCUMENTED_STATUTS = ['nouveau', 'en_cours', 'resolu', 'rejete'];
const PAGE_CEILING = 10; // sync never walks more than this many pages of one parcel's claims

let typesCache = null;
let typesInflight = null;
let countsCache = null;

/** Test hook: forget cached types and counters. */
export function _resetClaimCaches() {
  typesCache = null;
  typesInflight = null;
  countsCache = null;
}

export function isClaimsConfigured() {
  return Boolean(env.goodex.apiToken);
}

function requireConfigured() {
  if (!isClaimsConfigured()) throw new AppError(configErrorMessage(['GOODEX_API_TOKEN']), 503);
}

// --------------------------------------------------------------------------- presentation
export function toPublicClaim(row) {
  if (!row) return null;
  const cancelled = Boolean(row.cancelledAt);
  return {
    id: row.id,
    goodexClaimId: row.goodexClaimId,
    reference: row.reference,
    ean: row.ean,
    type: row.type,
    typeLabel: row.typeLabel,
    valeur: row.valeur,
    message: row.message,
    status: row.status,
    priorite: row.priorite,
    isOpen: row.isOpen && !cancelled,
    reponse: row.reponse,
    createdAt: row.goodexCreatedAt,
    resolvedAt: row.resolvedAt,
    cancelled,
    // Only "nouveau" claims can be cancelled; an open claim may already be "en_cours".
    canCancel: !cancelled && row.status === 'nouveau',
    lastSyncedAt: row.lastSyncedAt,
    source: row.source,
  };
}

function flattenErrors(errors) {
  return Object.entries(errors).map(([field, messages]) => `${field} : ${messages.join(' ')}`).join(' ; ');
}

function validationError(errors, base = 'Les informations saisies sont incomplètes') {
  return new ClaimError(`${base} — ${flattenErrors(errors)}`, 422, { errors });
}

// --------------------------------------------------------------------------- cached lookups
/** The exact claim types and rules GOODEX validates against; cached, with a stale fallback. */
export async function getClaimTypes({ force = false } = {}) {
  requireConfigured();
  const fresh = typesCache && Date.now() - typesCache.at < CLAIM_TYPES_TTL_MS;
  const shape = (stale, warning) => ({
    types: typesCache.data.types,
    statuts: typesCache.data.statuts,
    fetchedAt: new Date(typesCache.at).toISOString(),
    stale,
    ...(warning ? { warning } : {}),
  });
  if (fresh && !force) return shape(false);

  if (!typesInflight) {
    typesInflight = goodexClient.fetchClaimTypes().finally(() => { typesInflight = null; });
  }
  const result = await typesInflight;
  if (result.ok) {
    typesCache = { at: Date.now(), data: { types: result.types, statuts: result.statuts } };
    return shape(false);
  }
  if (typesCache) return shape(true, result.error);
  throw new AppError(`Types de réclamation indisponibles : ${result.error}`, 502);
}

/** Account-level counters for the badge. Unconfigured is a state, not an error. */
export async function getClaimCounts() {
  if (!isClaimsConfigured()) return { configured: false };
  const fresh = countsCache && Date.now() - countsCache.at < CLAIM_COUNTS_TTL_MS;
  if (fresh) return { configured: true, ...countsCache.counts, stale: false };

  const result = await goodexClient.fetchClaimCounts();
  if (result.ok) {
    countsCache = { at: Date.now(), counts: result.counts };
    return { configured: true, ...result.counts, stale: false };
  }
  if (countsCache) return { configured: true, ...countsCache.counts, stale: true, warning: result.error };
  throw new AppError(`Compteurs de réclamations indisponibles : ${result.error}`, 502);
}

// --------------------------------------------------------------------------- per-order reads
async function loadClaimableDelivery(orderId) {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('Commande non trouvée', 404);
  const delivery = await deliveryRepository.findByOrderId(order.id);
  return { order, delivery };
}

function claimableReason(delivery) {
  if (!delivery || delivery.state !== 'created' || !delivery.ean) {
    return "Aucun colis GOODEX n'a été créé pour cette commande : une réclamation n'est pas possible";
  }
  return null;
}

export async function listOrderClaims(orderId) {
  const { delivery } = await loadClaimableDelivery(orderId);
  const rows = await claimRepository.findByOrderId(orderId);
  const reason = claimableReason(delivery);
  return { claims: rows.map(toPublicClaim), canOpen: !reason, reason };
}

// --------------------------------------------------------------------------- open a claim
/**
 * GOODEX only accepts a claim once the parcel has left "En Attente". The saved status may be
 * stale, so when it still says 12 the status is refreshed first (a read-only GET); only a
 * freshly confirmed "En Attente" blocks locally. If the refresh itself fails, GOODEX decides.
 */
async function assertParcelProcessed(orderId, delivery) {
  if (delivery.goodexStatusId !== GOODEX_INITIAL_STATUS_ID) return;
  let current = delivery;
  let refreshed = false;
  try {
    const result = await deliveryService.refreshStatus(orderId);
    current = result.row || delivery;
    refreshed = true;
  } catch {
    // tracking unavailable: let the claim request be judged by GOODEX (documented 422)
  }
  if (refreshed && current.goodexStatusId === GOODEX_INITIAL_STATUS_ID && !current.trackingNotFoundAt) {
    throw new ClaimError(
      "Le colis est encore « En Attente » chez GOODEX : une réclamation n'est possible qu'une fois le colis pris en charge. "
        + 'Modifiez-le directement chez GOODEX en attendant.',
      409
    );
  }
}

async function persistTicket({ orderId, ean, ticket, message, source }) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return { row: await claimRepository.upsertFromRemote({ orderId, ean, ticket, message, source }) };
    } catch (err) {
      lastErr = err;
    }
  }
  console.error(`[claims] Claim ${ticket.reference || ticket.goodexClaimId} created but not persisted: ${lastErr.message}`);
  return {
    row: null,
    warning: `Réclamation ${ticket.reference || `n°${ticket.goodexClaimId}`} créée chez GOODEX mais non enregistrée localement : `
      + 'utilisez « Synchroniser » pour la retrouver.',
  };
}

/** The open claim of this type that GOODEX says already exists, if it can be found. */
async function findExistingOpenClaim(orderId, ean, typeDef) {
  const local = await claimRepository.findOpenByOrderAndType(orderId, typeDef.code);
  if (local) return local;
  const remote = await goodexClient.listClaims({ ean, etat: 'ouverts', per_page: CLAIMS_MAX_PER_PAGE });
  if (!remote.ok) return null;
  const match = remote.items.find((t) => t.goodexClaimId && (t.type === typeDef.code || t.typeLabel === typeDef.label));
  if (!match) return null;
  try {
    return await claimRepository.upsertFromRemote({ orderId, ean, ticket: match, source: 'import' });
  } catch {
    return null;
  }
}

export async function openClaim(orderId, input) {
  const { order, delivery } = await loadClaimableDelivery(orderId);
  const blocked = claimableReason(delivery);
  if (blocked) throw new AppError(blocked, 409);

  const { types } = await getClaimTypes();
  const { errors, clean } = validateClaimInput(input, types);
  if (!clean) throw validationError(errors);

  await assertParcelProcessed(order.id, delivery);

  const result = await goodexClient.createClaim({
    ean: delivery.ean,
    type: clean.type,
    valeur: clean.valeur,
    message: clean.message,
  });

  if (result.ok && result.kind === 'created') {
    const saved = await persistTicket({ orderId: order.id, ean: delivery.ean, ticket: result.ticket, message: clean.message, source: 'silky' });
    countsCache = null; // the account counters just changed
    return {
      result: 'created',
      claim: saved.row ? toPublicClaim(saved.row) : { ...result.ticket, ean: delivery.ean, status: result.ticket.status },
      ...(saved.warning ? { warning: saved.warning } : {}),
    };
  }

  if (result.ok && result.kind === 'already_sent') {
    const existing = await findExistingOpenClaim(order.id, delivery.ean, clean.def);
    return {
      result: 'already_sent', // explicitly NOT a new claim
      message: result.message || 'Une réclamation de ce type est déjà en cours sur ce colis.',
      claim: toPublicClaim(existing),
    };
  }

  if (result.configError) throw new AppError(result.error, 503);
  if (result.outcome === 'unknown') {
    throw new ClaimError(
      `Résultat incertain : ${result.error}. GOODEX refuse un doublon de réclamation ouverte : vous pouvez soumettre à nouveau, `
        + 'ou utiliser « Synchroniser » pour vérifier.',
      502,
      { outcome: 'unknown' }
    );
  }
  if (result.status === 404) {
    throw new ClaimError(
      `Colis inconnu de GOODEX ou non rattaché à votre compte : vérifiez le code de suivi (EAN). (${result.error})`,
      404
    );
  }
  if (result.status === 422) {
    if (result.errors) throw validationError(result.errors, result.error);
    const waiting = /attente/i.test(result.error || '')
      ? "Le colis n'est pas encore pris en charge chez GOODEX (« En Attente »). "
      : '';
    throw new ClaimError(`${waiting}${result.error}`, 422);
  }
  // Provider auth failures and other 4xx are never forwarded as our own 401 (it would log the admin out).
  throw new ClaimError(`Réclamation refusée par GOODEX : ${result.error}`, 502);
}

// --------------------------------------------------------------------------- sync / refresh / cancel
/** Imports the claims GOODEX holds for this parcel (also recovers one whose local save failed). */
export async function syncOrderClaims(orderId) {
  const { delivery } = await loadClaimableDelivery(orderId);
  const blocked = claimableReason(delivery);
  if (blocked) throw new AppError(blocked, 409);

  for (let page = 1; page <= PAGE_CEILING; page += 1) {
    const result = await goodexClient.listClaims({ ean: delivery.ean, page, per_page: CLAIMS_MAX_PER_PAGE });
    if (!result.ok) throw new AppError(`Synchronisation impossible : ${result.error}`, 502);
    for (const ticket of result.items) {
      if (!ticket.goodexClaimId || (ticket.ean && ticket.ean !== delivery.ean)) continue;
      await claimRepository.upsertFromRemote({ orderId, ean: delivery.ean, ticket, source: 'import' });
    }
    const last = result.lastPage ?? (result.total && result.perPage ? Math.ceil(result.total / result.perPage) : 1);
    if (page >= last || result.items.length === 0) break;
  }
  countsCache = null;
  return listOrderClaims(orderId);
}

async function loadClaimOrThrow(claimId) {
  const row = await claimRepository.findById(claimId);
  if (!row) throw new AppError('Réclamation non trouvée', 404);
  return row;
}

export async function refreshClaim(claimId) {
  requireConfigured();
  const row = await loadClaimOrThrow(claimId);
  const result = await goodexClient.getClaimDetails(row.goodexClaimId);
  if (result.ok) {
    const saved = await claimRepository.upsertFromRemote({ orderId: row.orderId, ean: row.ean, ticket: result.ticket });
    return toPublicClaim(saved);
  }
  if (result.notFound) {
    if (row.cancelledAt) return toPublicClaim(row); // expected: a cancelled claim no longer exists at GOODEX
    throw new ClaimError(`Réclamation introuvable chez GOODEX (${result.error}). Elle a peut-être été supprimée.`, 404);
  }
  throw new AppError(`Suivi de la réclamation indisponible : ${result.error}`, 502);
}

/**
 * Cancels the CLAIM (not the parcel). The provider only allows it while the claim is still
 * "nouveau", so the live status is read first; an open claim may already be "en_cours".
 */
export async function cancelClaim(claimId) {
  requireConfigured();
  const row = await loadClaimOrThrow(claimId);
  if (row.cancelledAt) throw new AppError('Cette réclamation est déjà annulée', 409);

  const current = await refreshClaim(claimId); // throws a clear error when GOODEX cannot be read
  if (current.status !== 'nouveau') {
    throw new ClaimError(
      `Cette réclamation est déjà prise en charge (statut « ${current.status || 'inconnu'} ») : elle ne peut plus être annulée.`,
      409
    );
  }

  const result = await goodexClient.cancelClaimRemote(row.goodexClaimId);
  if (result.ok) {
    countsCache = null;
    return toPublicClaim(await claimRepository.markCancelled(row.id));
  }
  if (result.configError) throw new AppError(result.error, 503);
  if (result.outcome === 'unknown') {
    throw new ClaimError(
      `Résultat incertain : ${result.error}. Actualisez la réclamation pour vérifier si elle a été annulée.`,
      502,
      { outcome: 'unknown' }
    );
  }
  // A refused cancellation (422 "already taken") means the stored status was stale: resync it.
  try { await refreshClaim(claimId); } catch { /* the message below is what matters */ }
  throw new ClaimError(result.error, result.notFound ? 404 : 409);
}

// --------------------------------------------------------------------------- remote list
function dateParam(value, name) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new AppError(`${name} invalide : le format attendu est AAAA-MM-JJ`, 400);
  }
  return value;
}

function sanitizeListQuery(query = {}) {
  const out = {};
  if (query.etat !== undefined && query.etat !== '') {
    if (!['ouverts', 'clotures'].includes(query.etat)) throw new AppError("etat invalide : « ouverts » ou « clotures » attendu", 400);
    out.etat = query.etat;
  }
  if (query.statut !== undefined && query.statut !== '') {
    const allowed = typesCache?.data.statuts?.length ? typesCache.data.statuts : DOCUMENTED_STATUTS;
    if (!allowed.includes(query.statut)) throw new AppError(`statut invalide : ${allowed.join(', ')}`, 400);
    out.statut = query.statut;
  }
  if (query.type !== undefined && query.type !== '') {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(query.type)) throw new AppError('type invalide', 400);
    out.type = query.type;
  }
  if (query.ean !== undefined && query.ean !== '') {
    if (!/^\S{1,64}$/.test(query.ean)) throw new AppError('ean invalide', 400);
    out.ean = query.ean;
  }
  out.date_debut = dateParam(query.date_debut, 'date_debut');
  out.date_fin = dateParam(query.date_fin, 'date_fin');

  const page = query.page === undefined || query.page === '' ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new AppError('page invalide', 400);
  out.page = page;
  const perPage = query.per_page === undefined || query.per_page === '' ? CLAIMS_DEFAULT_PER_PAGE : Number(query.per_page);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > CLAIMS_MAX_PER_PAGE) {
    throw new AppError(`per_page invalide : 1 à ${CLAIMS_MAX_PER_PAGE} (le maximum de GOODEX n'est pas documenté)`, 400);
  }
  out.per_page = perPage;
  return out;
}

/** One page of GOODEX's own claim list, each claim linked to its Silky order when its EAN is known. */
export async function listRemoteClaims(query = {}) {
  requireConfigured();
  const params = sanitizeListQuery(query);
  const result = await goodexClient.listClaims(params);
  if (!result.ok) throw new AppError(`Liste des réclamations indisponible : ${result.error}`, 502);

  const eans = [...new Set(result.items.map((t) => t.ean).filter(Boolean))];
  const links = await claimRepository.findOrdersByEans(eans);
  const byEan = new Map(links.map((l) => [l.ean, { id: l.orderId, orderNumber: l.orderNumber }]));
  // Claims Silky knows locally get their own id (for refresh / cancel); the others were opened
  // elsewhere (GOODEX dashboard) and are read-only here.
  const local = await claimRepository.findByGoodexIds(result.items.map((t) => t.goodexClaimId).filter(Boolean));
  const byGoodexId = new Map(local.map((row) => [row.goodexClaimId, row]));
  return {
    page: result.currentPage ?? params.page,
    perPage: result.perPage ?? params.per_page,
    total: result.total,
    lastPage: result.lastPage,
    items: result.items.map((t) => {
      const row = byGoodexId.get(t.goodexClaimId);
      const cancelled = Boolean(row?.cancelledAt);
      return {
        ...t,
        order: byEan.get(t.ean) || null,
        localId: row?.id ?? null,
        cancelled,
        canCancel: Boolean(row) && !cancelled && t.status === 'nouveau',
      };
    }),
  };
}
