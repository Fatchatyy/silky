import { env } from './env.js';
import { resolveGovernorateSync, CANONICAL_GOVERNORATES } from './governorates.js';

/**
 * GOODEX integration constants and pure helpers.
 *
 * Governorates: GOODEX's parcel documentation is stated to accept the same
 * unaccented names as Silky's canonical list (server/config/governorates.js), so no
 * translation table exists. resolveParcelGovernorate only validates the saved
 * governorate against that list; the name is sent as stored. Still to be confirmed
 * against a real GOODEX response (see the Monday checklist).
 */

/** Credentials needed to create/track parcels. Returns env var names only, never values. */
export function missingApiConfig() {
  const missing = [];
  if (!env.goodex.apiToken) missing.push('GOODEX_API_TOKEN');
  if (!env.goodex.userId) missing.push('GOODEX_USER_ID');
  return missing;
}

export function missingWebhookConfig() {
  return env.goodex.webhookSecret ? [] : ['GOODEX_WEBHOOK_SECRET'];
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Former API host: nothing may be sent there, whatever the configuration says. */


/**
 * Why a request to the configured GOODEX base URL must NOT be sent, or null if it may be.
 * Real GOODEX calls need all of: a non-test run (NODE_ENV not "test", database name without
 * "test") and an explicit opt-in (GOODEX_ENABLE_LIVE=true). A loopback base URL (the local
 * mock servers of the test scripts) is always allowed. This is the only gate between the
 * app and the real provider: every request in goodex.client.js passes through it first, so
 * a real token in .env cannot make a test script or an unconfigured dev run create parcels.
 * The inputs can be overridden for tests; the defaults read the live configuration.
 */
export function liveCallBlockReason({
  baseUrl = env.goodex.baseUrl,
  enableLive = env.goodex.enableLive,
  nodeEnv = process.env.NODE_ENV,
  databaseUrl = env.databaseUrl,
} = {}) {
  let host = '';
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'GOODEX_BASE_URL invalide';
  }
  if (LOOPBACK_HOSTS.has(host)) return null;
  if (nodeEnv === 'test') return 'NODE_ENV=test';
  let dbName = '';
  try {
    dbName = new URL(databaseUrl).pathname.slice(1);
  } catch {
    // an unparsable URL is treated as a non-test database name below
  }
  if (/test/i.test(dbName)) return 'la base de données est une base de test';
  if (!enableLive) return "GOODEX_ENABLE_LIVE n'est pas activé";
  return null;
}

export function liveBlockedMessage(reason) {
  return `Appels GOODEX réels bloqués : ${reason}`;
}

export function configErrorMessage(missing) {
  return `Configuration GOODEX incomplète : ${missing.join(', ')} manquant(s)`;
}

/**
 * Validates the governorate saved on an order (admin shape: governorateId +
 * governorate { id, name }) against the canonical list. Never asks for it again.
 * Returns { name } or { error } (French message, no request is made on error).
 */
export function resolveParcelGovernorate(order) {
  const id = order?.governorateId ?? order?.governorate?.id ?? null;
  const savedName = order?.governorate?.name ?? order?.customer?.governorate ?? null;
  if (id == null && !savedName) return { error: 'Gouvernorat manquant sur la commande' };

  const canonical = id != null ? resolveGovernorateSync(id) : resolveGovernorateSync(savedName);
  if (!canonical) return { error: `Gouvernorat invalide : ${savedName || id}` };
  if (savedName && savedName !== canonical.name) {
    return { error: `Gouvernorat incohérent : « ${savedName} » ne correspond pas à l'identifiant ${canonical.id} (${canonical.name})` };
  }
  return { name: canonical.name };
}

const ADDRESS_SEPARATOR = ' — ';

function stripAccents(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * An exchange stores its delivery address as "<Governorate> — <street>" (the admin form
 * prefixes the chosen governorate; there is no separate column). Splits it and validates
 * the governorate against the canonical list, accent-insensitively ("Béja" -> "Beja").
 * No governorate is ever guessed: a missing or unknown prefix is an error and nothing is sent.
 * Returns { governorat, adresse } or { error } (French message).
 */
export function resolveExchangeAddress(address) {
  const text = String(address ?? '').trim();
  const at = text.indexOf(ADDRESS_SEPARATOR);
  if (at < 0) return { error: "Gouvernorat manquant dans l'adresse de l'échange" };

  const prefix = text.slice(0, at).trim();
  // By name only: numeric ids and ISO codes must not be read out of a street prefix.
  const wanted = stripAccents(prefix).toLowerCase();
  const canonical = CANONICAL_GOVERNORATES.find((g) => g.name.toLowerCase() === wanted);
  if (!canonical) return { error: `Gouvernorat invalide dans l'adresse de l'échange : ${prefix}` };

  const adresse = text.slice(at + ADDRESS_SEPARATOR.length).trim();
  if (!adresse) return { error: "Adresse manquante" };
  return { governorat: canonical.name, adresse };
}

/**
 * Official GOODEX status list (id -> label, as supplied by the user). The numeric id
 * is only known when GOODEX sends one (POST `last_statut`); GET and webhook examples
 * carry the textual `statut` only, which is mapped to an id solely when its
 * normalized text equals exactly one official label.
 */
export const GOODEX_STATUSES = [
  { id: 1, label: 'EN COURS' },
  { id: 2, label: 'Livré' },
  { id: 3, label: 'En Depot' },
  { id: 4, label: 'En Transit' },
  { id: 5, label: 'Enleve' },
  { id: 6, label: 'Retour' },
  { id: 7, label: 'Exception' },
  { id: 8, label: 'Payé' },
  { id: 9, label: 'Préparation Retour' },
  { id: 10, label: 'NON REÇUE' },
  { id: 11, label: 'Retour Payé' },
  { id: 12, label: 'En Attente' },
  { id: 13, label: 'Préparation Livraison' },
  { id: 14, label: 'Dispatch' },
  { id: 15, label: 'Prep Paiement' },
  { id: 16, label: 'Err Sync' },
  { id: 17, label: 'Retour Recu Magasin' },
  { id: 18, label: 'Verification' },
  { id: 19, label: 'Echange' },
  { id: 20, label: 'Livré Provisoirement' },
];

/** Tracking-only answer for an unknown parcel; not part of the official list, so it has no id. */
export const GOODEX_NOT_FOUND_STATUS = 'Colis Introuvable';

/** Initial status GOODEX assigns on creation (also what POST `last_statut` reports). */
export const GOODEX_INITIAL_STATUS_ID = 12;

/**
 * Background reconciliation policy (read-only tracking of existing parcels).
 * Terminal = financially settled: "Payé" (8) and "Retour Payé" (11). "Livré" (2) is NOT terminal
 * because the COD is settled afterwards. Orders cancelled or refunded in Silky are still tracked:
 * cancelling in Silky does not cancel the parcel at GOODEX, and returns end at "Retour Payé".
 * The polling gap grows with the time since the status last changed, and a parcel GOODEX no
 * longer finds is polled less and less often, then dropped.
 */
export const RECONCILE_TERMINAL_STATUS_IDS = [8, 11];
export const RECONCILE_ACTIVE_WINDOW_HOURS = 48; // changed within this: polled every cycle
export const RECONCILE_MID_WINDOW_DAYS = 14; // then every RECONCILE_MID_GAP_HOURS until this age
export const RECONCILE_MID_GAP_HOURS = 3;
export const RECONCILE_OLD_GAP_HOURS = 12;
export const RECONCILE_NOT_FOUND_FIRST_HOURS = 1; // flagged less than this ago: normal cadence
export const RECONCILE_NOT_FOUND_DAY_GAP_HOURS = 1; // up to one day after the flag
export const RECONCILE_NOT_FOUND_LATER_GAP_HOURS = 12; // afterwards
export const RECONCILE_NOT_FOUND_GIVE_UP_DAYS = 14; // never found again: stop (manual refresh still works)

/** How long a saved delivery status is considered fresh when the admin opens order details. */
export const DELIVERY_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

export function normalizeGoodexStatus(statut) {
  return String(statut ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const STATUS_BY_ID = new Map(GOODEX_STATUSES.map((st) => [st.id, st]));
const STATUS_BY_LABEL = new Map(GOODEX_STATUSES.map((st) => [normalizeGoodexStatus(st.label), st]));

export function goodexStatusLabel(id) {
  return STATUS_BY_ID.get(id)?.label ?? null;
}

/**
 * Interprets a status as sent by GOODEX: an integer (or integer string) is an official
 * id; any other text must match an official label exactly (case, accents and spacing
 * ignored). Anything else is "unrecognized": id and label are null and the raw value is
 * returned untouched for diagnosis. Never guesses or maps to a neighbouring status.
 * Returns null for empty input.
 */
export function resolveGoodexStatus(value) {
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'string' ? value.trim() : String(value);
  if (!raw) return null;

  const isId = typeof value === 'number' || /^\d{1,3}$/.test(raw);
  const known = isId ? STATUS_BY_ID.get(Number(raw)) : STATUS_BY_LABEL.get(normalizeGoodexStatus(raw));
  if (known) {
    // A numeric input carries no provider text, so show the official label.
    return { id: known.id, label: known.label, raw: isId ? known.label : raw };
  }
  return { id: null, label: null, raw: raw.slice(0, 100) };
}

/** Value for order_deliveries.delivery_status: a stable code, never a Silky order/payment status. */
export function deliveryStatusCode(resolved) {
  return resolved?.id != null ? `status_${resolved.id}` : 'unknown';
}

export function formatCod(amount) {
  return (Math.round((Number(amount) || 0) * 1000) / 1000).toFixed(3);
}

// ---- Claims (tickets) API -------------------------------------------------------------
/** The types endpoint is documented as the exact list the server validates against; cache it. */
export const CLAIM_TYPES_TTL_MS = 6 * 60 * 60 * 1000;
/** Account-level counters, shown as a badge: refreshed at most this often. */
export const CLAIM_COUNTS_TTL_MS = 2 * 60 * 1000;
/** Documented default page size for the list endpoint. */
export const CLAIMS_DEFAULT_PER_PAGE = 20;
/** Silky's own ceiling: the provider's maximum page size is not documented. */
export const CLAIMS_MAX_PER_PAGE = 50;
/** Documented maximum length of a claim message. */
export const CLAIM_MESSAGE_MAX = 1000;
