import { env } from '../config/env.js';
import {
  GOODEX_NOT_FOUND_STATUS,
  GOODEX_INITIAL_STATUS_ID,
  missingApiConfig,
  configErrorMessage,
  liveCallBlockReason,
  liveBlockedMessage,
} from '../config/goodex.js';

/**
 * The only module that talks to GOODEX.
 *
 * Outcome classification for createParcel:
 *  - outcome 'failed'  : provably nothing was created (not configured, connection
 *                        refused / DNS before sending, 4xx). Safe to retry.
 *  - outcome 'unknown' : a parcel may exist (timeout, reset, 5xx, unreadable or
 *                        invalid body). Must NOT be retried automatically.
 * The API token travels in the body (create) and query string (track): never log
 * request bodies or URLs from here. Redirects are never followed (they would resend
 * the token to whatever host answers).
 */

const SAFE_CONNECT_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const EAN_PATTERN = /^\S{1,64}$/;

function cfg() {
  return env.goodex;
}

/** Error text when the live-call gate refuses a request (nothing is sent), else null. */
function liveBlock() {
  const reason = liveCallBlockReason();
  return reason ? liveBlockedMessage(reason) : null;
}

function scrub(text) {
  let out = String(text ?? '').slice(0, 300);
  const { apiToken } = cfg();
  if (apiToken) out = out.split(apiToken).join('***');
  return out;
}

function isTimeout(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

function connectErrorCode(err) {
  return err?.cause?.code || err?.code || null;
}

// The documented success response is a flat parcel object:
// { id, ean, user_id, client, cod, ..., last_statut, echange, decharge, created_at }.
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractEan(body) {
  if (!isPlainObject(body)) return null;
  return typeof body.ean === 'string' && EAN_PATTERN.test(body.ean) ? body.ean : null;
}

/**
 * Initial status of a freshly created parcel (`last_statut`, documented as 12 /
 * "En Attente"). Returned raw: the service resolves it against the official list.
 */
function extractLastStatut(body) {
  if (!isPlainObject(body)) return null;
  const candidate = body.last_statut;
  return typeof candidate === 'number' || typeof candidate === 'string' ? candidate : null;
}

/** GOODEX's internal parcel id and creation timestamp, kept for troubleshooting (null if absent/odd). */
function extractParcelDetails(body) {
  if (!isPlainObject(body)) return { parcelId: null, createdAt: null };
  const id = typeof body.id === 'string' && /^\d{1,15}$/.test(body.id) ? Number(body.id) : body.id;
  return {
    parcelId: Number.isSafeInteger(id) && id > 0 ? id : null,
    // Documented as "YYYY-MM-DD HH:MM:SS" without a time zone: kept as the raw text.
    createdAt: typeof body.created_at === 'string' && body.created_at.trim() ? body.created_at.trim().slice(0, 32) : null,
  };
}

/**
 * Readable summary of an error body. The documented 422 is a bare map of field -> messages
 * ({"governorat":["The governorat field is required."]}); {message, errors:{...}} and
 * {error} are tolerated too, since failures do not all share one shape.
 */
function describeErrorBody(body) {
  if (!isPlainObject(body)) return '';
  const parts = [];
  const direct = [body.message, body.error].find((v) => typeof v === 'string' && v.trim());
  if (direct) parts.push(direct.trim());
  const fieldMaps = [body, isPlainObject(body.errors) ? body.errors : null].filter(Boolean);
  for (const map of fieldMaps) {
    for (const [field, messages] of Object.entries(map)) {
      if (Array.isArray(messages) && messages.length && messages.every((m) => typeof m === 'string')) {
        parts.push(`${field} : ${messages.join(' ')}`);
      }
    }
  }
  return parts.join(' ; ').slice(0, 250);
}

/** Short, secret-free hint of what an unexpected body contained (message text + key names). */
function describeBody(body) {
  if (!body || typeof body !== 'object') return '';
  const text = [body.message, body.error].find((v) => typeof v === 'string' && v.trim());
  const keys = Object.keys(body).slice(0, 8).join(', ');
  return scrub([text ? `« ${text}`.slice(0, 160) + ' »' : '', keys ? `clés : ${keys}` : ''].filter(Boolean).join(' ; '));
}

async function readBody(res) {
  const text = await res.text();
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: undefined };
  }
}

async function readJson(res) {
  return (await readBody(res)).json;
}

/**
 * has_motif is documented as an indicator (the example uses numeric 0) and its data type
 * is not guaranteed. Booleans, 0/1 and their string forms are understood; anything else is
 * "unknown" (null) and is never guessed.
 */
export function parseHasMotif(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  }
  return null;
}

export async function createParcel(fields) {
  const missing = missingApiConfig();
  if (missing.length) {
    return { ok: false, outcome: 'failed', error: configErrorMessage(missing), configError: true };
  }
  const blocked = liveBlock();
  if (blocked) return { ok: false, outcome: 'failed', error: blocked, configError: true };

  const c = cfg();
  const form = new FormData();
  form.append('token', c.apiToken);
  form.append('user_id', c.userId);
  // Required by the live API (HTTP 422 "The last statut field is required" without it), despite
  // the PDF; every new parcel starts as 12 / En Attente.
  form.append('last_statut', String(GOODEX_INITIAL_STATUS_ID));
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    form.append(key, String(value));
  }

  let res;
  try {
    res = await fetch(`${c.baseUrl}/api/v1/colis/create`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: form,
      redirect: 'manual',
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    if (isTimeout(err)) {
      return { ok: false, outcome: 'unknown', error: 'Délai dépassé lors de la création du colis' };
    }
    if (SAFE_CONNECT_ERRORS.has(connectErrorCode(err))) {
      return { ok: false, outcome: 'failed', error: `GOODEX injoignable (${connectErrorCode(err)})` };
    }
    return { ok: false, outcome: 'unknown', error: 'Erreur réseau lors de la création du colis' };
  }

  let body;
  try {
    body = await readJson(res);
  } catch {
    return { ok: false, outcome: 'unknown', error: `Réponse illisible (HTTP ${res.status})` };
  }

  if (res.status >= 400 && res.status < 500) {
    const detail = describeErrorBody(body);
    const authHint = res.status === 401 || res.status === 403
      ? ' (identifiants refusés : vérifier GOODEX_API_TOKEN et GOODEX_USER_ID)'
      : '';
    return { ok: false, outcome: 'failed', error: scrub(`HTTP ${res.status} ${detail}`.trim() + authHint) };
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, outcome: 'unknown', error: `Réponse inattendue (HTTP ${res.status})` };
  }

  const ean = extractEan(body);
  if (!ean) {
    const hint = describeBody(body);
    return { ok: false, outcome: 'unknown', error: `Réponse GOODEX sans code de suivi (ean) valide${hint ? ` — ${hint}` : ''}` };
  }
  return { ok: true, ean, lastStatut: extractLastStatut(body), ...extractParcelDetails(body) };
}

/** Failure type of a non-retryable tracking answer, from its HTTP status. */
function failureKind(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return 'invalid';
}

/** Retry-After as milliseconds (seconds or an HTTP date), capped at one hour; null when absent or odd. */
function parseRetryAfterMs(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60 * 60 * 1000) : null;
}

async function trackOnce(ean) {
  const c = cfg();
  const url = `${c.baseUrl}/api/v1/colis/etat/${encodeURIComponent(ean)}?token=${encodeURIComponent(c.apiToken)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    const timedOut = isTimeout(err);
    return { ok: false, retryable: true, kind: timedOut ? 'timeout' : 'network', error: timedOut ? 'Délai dépassé' : 'Erreur réseau' };
  }

  let text;
  let body;
  try {
    ({ text, json: body } = await readBody(res));
  } catch {
    return { ok: false, retryable: true, kind: 'network', error: `Réponse illisible (HTTP ${res.status})` };
  }

  if (res.status >= 500) return { ok: false, retryable: true, kind: 'server', error: `HTTP ${res.status}` };
  // For callers that must react to the failure type (the background reconciler) without parsing
  // the message: auth (401/403), rate_limit (429, with Retry-After when given), else invalid.
  const failure = (error) => ({
    ok: false,
    retryable: false,
    kind: failureKind(res.status),
    ...(res.status === 429 ? { retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after')) } : {}),
    error,
  });

  const isObject = Boolean(body) && typeof body === 'object' && !Array.isArray(body);

  // The documentation does not say whether an unknown parcel answers 200 or 404, so both the
  // HTTP code and the body are inspected. Anything that is not an ordinary status is a
  // lookup result ("not found"), never a status change.
  const notFoundByBody = isObject && typeof body.statut === 'string'
    && body.statut.trim().toLowerCase() === GOODEX_NOT_FOUND_STATUS.toLowerCase();
  // An HTTP 404 with an empty body, or a JSON object carrying no status, is read as "no such
  // parcel". A 404 whose body is something else (an HTML error page, a different status) looks
  // like a wrong URL or proxy and stays a tracking error. To confirm against real responses.
  const notFoundBy404 = res.status === 404
    && (text.trim() === '' || (isObject && body.statut === undefined));
  if (notFoundByBody || notFoundBy404) {
    return { ok: true, notFound: true, statut: GOODEX_NOT_FOUND_STATUS, motif: null, hasMotif: null };
  }
  if (!isObject) {
    return failure(`Réponse invalide (HTTP ${res.status})`);
  }

  // Documented as text; an integer is tolerated and resolved as an official status id.
  let statut = '';
  if (typeof body.statut === 'string') statut = body.statut.trim();
  else if (Number.isSafeInteger(body.statut)) statut = String(body.statut);
  if (res.status < 200 || res.status >= 300) {
    return failure(scrub(`HTTP ${res.status} ${body.message || body.error || ''}`.trim()));
  }
  if (!statut) {
    return failure('Réponse GOODEX sans statut');
  }
  if (body.ean !== undefined && String(body.ean) !== ean) {
    return failure('Réponse GOODEX pour un autre colis');
  }

  // has_motif says whether a delivery reason/issue exists; motif is its text. The flag is
  // reported as sent (true / false / null when absent or of an unknown type) and decides
  // whether an incident is displayed. Text accompanying an explicit "no reason" is dropped;
  // a missing or empty motif is null, i.e. "nothing received", never "cleared".
  const hasMotif = parseHasMotif(body.has_motif);
  const rawMotif = typeof body.motif === 'string' ? body.motif.trim() : '';
  const motif = rawMotif && hasMotif !== false ? rawMotif.slice(0, 1000) : null;
  return { ok: true, notFound: false, statut, motif, hasMotif };
}

/** Read-only GET, so a single retry on network/5xx errors is safe. */
export async function trackParcel(ean) {
  if (!cfg().apiToken) {
    return { ok: false, kind: 'config', error: configErrorMessage(['GOODEX_API_TOKEN']), configError: true };
  }
  const blocked = liveBlock();
  if (blocked) return { ok: false, kind: 'config', error: blocked, configError: true };
  const first = await trackOnce(ean);
  if (first.ok || !first.retryable) return first;
  return trackOnce(ean);
}

// =============================================================================
// Claims (tickets) API. Same rules as above: bounded timeout, no redirects, token never
// logged, every documented shape parsed defensively. POST carries the token in the form,
// GET / DELETE in the query string, as documented.
// =============================================================================

const asFlag = (value) => parseHasMotif(value) === true;

function text(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function positiveInt(value) {
  const n = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function fieldErrors(body) {
  if (!isPlainObject(body) || !isPlainObject(body.errors)) return null;
  const out = {};
  for (const [field, messages] of Object.entries(body.errors)) {
    if (Array.isArray(messages) && messages.every((m) => typeof m === 'string')) out[field] = messages;
  }
  return Object.keys(out).length ? out : null;
}

/** Maps a claim object (create / list / detail layouts differ) to Silky's fields; absent -> null. */
export function normalizeTicket(t) {
  if (!isPlainObject(t)) return null;
  const isOpen = typeof t.is_open === 'boolean' ? t.is_open : (t.is_open === 1 || t.is_open === 0 ? t.is_open === 1 : null);
  return {
    goodexClaimId: positiveInt(t.id),
    reference: text(t.reference, 64),
    ean: text(t.colis_ean ?? t.ean, 64),
    type: text(t.type, 64),
    typeLabel: text(t.type_label, 160),
    valeur: t.valeur === null || t.valeur === undefined ? null : text(String(t.valeur), 255),
    status: text(t.statut, 32),
    priorite: text(t.priorite, 32),
    isOpen,
    reponse: typeof t.reponse === 'string' && t.reponse.trim() ? t.reponse : null,
    createdAt: text(t.created_at, 40),
    resolvedAt: text(t.resolved_at, 40),
  };
}

async function callClaimsApi(method, path, { query = {}, form = null } = {}) {
  const c = cfg();
  if (!c.apiToken) {
    return { ok: false, kind: 'config', error: configErrorMessage(['GOODEX_API_TOKEN']) };
  }
  const blocked = liveBlock();
  if (blocked) return { ok: false, kind: 'config', error: blocked };
  const params = new URLSearchParams();
  if (method !== 'POST') params.set('token', c.apiToken);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();

  let res;
  try {
    res = await fetch(`${c.baseUrl}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: { Accept: 'application/json' },
      body: form || undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    if (isTimeout(err)) return { ok: false, kind: 'timeout', error: 'Délai dépassé' };
    return { ok: false, kind: 'network', safe: SAFE_CONNECT_ERRORS.has(connectErrorCode(err)), error: 'Erreur réseau' };
  }
  try {
    const { text: raw, json } = await readBody(res);
    return { ok: true, status: res.status, text: raw, json };
  } catch {
    return { ok: false, kind: 'unreadable', error: `Réponse illisible (HTTP ${res.status})` };
  }
}

function httpFailure(r) {
  const authHint = r.status === 401 || r.status === 403
    ? ' (identifiants refusés : vérifier GOODEX_API_TOKEN)'
    : '';
  return scrub(`${describeErrorBody(r.json) || `HTTP ${r.status}`}${authHint}`);
}

/** GET /api/v1/tickets/types: the exact claim types and validation rules GOODEX enforces. */
export async function fetchClaimTypes() {
  const r = await callClaimsApi('GET', '/api/v1/tickets/types');
  if (!r.ok) return { ok: false, error: r.error, configError: r.kind === 'config' };
  if (r.status < 200 || r.status >= 300 || !isPlainObject(r.json) || !Array.isArray(r.json.types)) {
    return { ok: false, error: `Réponse inattendue (HTTP ${r.status})${r.status >= 400 ? ` : ${httpFailure(r)}` : ''}` };
  }
  const types = r.json.types
    .filter((t) => isPlainObject(t) && text(t.code, 64))
    .map((t) => ({
      code: text(t.code, 64),
      label: text(t.label, 160) || text(t.code, 64),
      valueType: text(t.value_type, 32)?.toLowerCase() ?? null,
      needsValue: asFlag(t.needs_value),
      hint: text(t.hint, 300),
      priorite: text(t.priorite, 32),
      messageRequired: asFlag(t.message_required),
    }));
  if (!types.length) return { ok: false, error: 'Aucun type de réclamation reçu de GOODEX' };
  const statuts = Array.isArray(r.json.statuts) ? r.json.statuts.filter((s) => typeof s === 'string') : [];
  return { ok: true, types, statuts };
}

/**
 * POST /api/client/tickets. Outcomes:
 *  - kind 'created'      HTTP 201 with a ticket: a new claim exists.
 *  - kind 'already_sent' HTTP 200 with already_sent: true: an open claim of that type already
 *                        exists, NOTHING was created.
 *  - outcome 'failed'    documented 4xx (404 unknown parcel, 422 invalid / parcel En Attente).
 *  - outcome 'unknown'   timeout, 5xx, unreadable or unexpected body: a claim may exist.
 *                        GOODEX refuses a duplicate of an open claim, so re-submitting is safe.
 */
export async function createClaim({ ean, type, valeur, message }) {
  const c = cfg();
  if (!c.apiToken) {
    return { ok: false, outcome: 'failed', configError: true, error: configErrorMessage(['GOODEX_API_TOKEN']) };
  }
  const blocked = liveBlock();
  if (blocked) return { ok: false, outcome: 'failed', configError: true, error: blocked };
  const form = new FormData();
  form.append('token', c.apiToken);
  form.append('ean', ean);
  form.append('type', type);
  if (valeur) form.append('valeur', valeur);
  if (message) form.append('message', message);

  const r = await callClaimsApi('POST', '/api/client/tickets', { form });
  if (!r.ok) return { ok: false, outcome: r.kind === 'network' && r.safe ? 'failed' : 'unknown', error: r.error };

  const { status, json: body } = r;
  if (status === 200 || status === 201) {
    if (isPlainObject(body) && body.already_sent === true) {
      return { ok: true, kind: 'already_sent', message: text(body.message, 300) };
    }
    const ticket = isPlainObject(body) ? normalizeTicket(body.ticket) : null;
    if (status === 201 && isPlainObject(body) && body.success === true && ticket?.goodexClaimId) {
      return { ok: true, kind: 'created', ticket };
    }
    return { ok: false, outcome: 'unknown', error: `Réponse GOODEX inattendue (HTTP ${status})` };
  }
  if (status >= 400 && status < 500) {
    return { ok: false, outcome: 'failed', status, error: httpFailure(r), errors: fieldErrors(body) };
  }
  return { ok: false, outcome: 'unknown', error: `Réponse inattendue (HTTP ${status})` };
}

/** GET /api/client/tickets: paginated; `data` is the array, pagination sits at the top level. */
export async function listClaims(query = {}) {
  const r = await callClaimsApi('GET', '/api/client/tickets', { query });
  if (!r.ok) return { ok: false, error: r.error, configError: r.kind === 'config' };
  if (r.status < 200 || r.status >= 300) return { ok: false, error: `HTTP ${r.status} ${httpFailure(r)}`.trim() };
  if (!isPlainObject(r.json) || !Array.isArray(r.json.data)) {
    return { ok: false, error: 'Réponse invalide : un objet paginé avec « data » est attendu' };
  }
  const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ok: true,
    items: r.json.data.map(normalizeTicket).filter(Boolean),
    currentPage: num(r.json.current_page),
    lastPage: num(r.json.last_page),
    total: num(r.json.total),
    perPage: num(r.json.per_page),
  };
}

/** GET /api/client/tickets/counts: account-level aggregates, used as returned. */
export async function fetchClaimCounts() {
  const r = await callClaimsApi('GET', '/api/client/tickets/counts');
  if (!r.ok) return { ok: false, error: r.error, configError: r.kind === 'config' };
  if (r.status < 200 || r.status >= 300 || !isPlainObject(r.json)) {
    return { ok: false, error: `Réponse inattendue (HTTP ${r.status})` };
  }
  const counts = {};
  for (const key of ['nouveau', 'en_cours', 'resolu', 'rejete', 'ouverts', 'total']) {
    const v = r.json[key];
    counts[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return { ok: true, counts };
}

/** GET /api/client/tickets/{id}. The detail layout is only partly documented, so it is read defensively. */
export async function getClaimDetails(id) {
  const r = await callClaimsApi('GET', `/api/client/tickets/${encodeURIComponent(id)}`);
  if (!r.ok) return { ok: false, error: r.error, configError: r.kind === 'config' };
  if (r.status === 404) {
    return { ok: false, notFound: true, error: scrub(describeErrorBody(r.json) || 'Réclamation introuvable') };
  }
  if (r.status < 200 || r.status >= 300) return { ok: false, error: `HTTP ${r.status} ${httpFailure(r)}`.trim() };
  const ticket = normalizeTicket(isPlainObject(r.json?.ticket) ? r.json.ticket : r.json);
  if (!ticket || (!ticket.status && !ticket.reference)) {
    return { ok: false, error: 'Réponse GOODEX illisible : ni statut ni référence' };
  }
  return { ok: true, ticket };
}

/**
 * DELETE /api/client/tickets/{id}: cancels the CLAIM (never the parcel). Only claims still
 * "nouveau" can be cancelled; GOODEX answers 422 {error} otherwise.
 */
export async function cancelClaimRemote(id) {
  const r = await callClaimsApi('DELETE', `/api/client/tickets/${encodeURIComponent(id)}`);
  // A config/guard refusal sent nothing, so it is a clean failure, never an uncertain outcome.
  if (!r.ok) return { ok: false, outcome: r.kind === 'config' ? 'failed' : 'unknown', error: r.error, configError: r.kind === 'config' };
  if (r.status === 404) {
    return { ok: false, outcome: 'failed', notFound: true, error: scrub(describeErrorBody(r.json) || 'Réclamation introuvable') };
  }
  if (r.status >= 200 && r.status < 300) {
    if (isPlainObject(r.json) && r.json.success === true) return { ok: true, message: text(r.json.message, 200) };
    return { ok: false, outcome: 'unknown', error: `Réponse GOODEX inattendue (HTTP ${r.status})` };
  }
  if (r.status >= 400 && r.status < 500) return { ok: false, outcome: 'failed', status: r.status, error: httpFailure(r) };
  return { ok: false, outcome: 'unknown', error: `Réponse inattendue (HTTP ${r.status})` };
}
