/**
 * GOODEX claims (tickets) integration tests. No real GOODEX account is needed.
 *
 * A stateful local mock stands in for GOODEX (documented dedup of open claims, cancel only
 * while "nouveau", paginated list, counters); env.goodex.baseUrl points at it and the script
 * refuses any non-loopback host. Like test_goodex_delivery.js it requires DATABASE_URL to name
 * a dedicated TEST database (ALLOW_NON_TEST_DB=1 overrides at your own risk).
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://.../silky_test'; node server/scripts/test_goodex_claims.js
 */

import http from 'http';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { db } from '../db/orm.js';
import { eq, inArray } from 'drizzle-orm';
import { products, productVariants, categories, orders, users, orderDeliveries, orderClaims } from '../models/index.js';
import { _resetRateLimits } from '../middleware/rateLimiter.js';
import { signAccessToken } from '../services/token.service.js';
import { runOrderDeliveriesMigration } from '../db/migrations/add_order_deliveries.js';
import { runOrderClaimsMigration } from '../db/migrations/add_order_claims.js';
import { pool } from '../db/pool.js';
import { claimRepository } from '../repositories/claim.repository.js';
import { _resetClaimCaches } from '../services/claims.service.js';
import { validateClaimInput, validateValue } from '../utils/claimValidation.js';

const logged = [];
for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    logged.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    original(...args);
  };
}

let passed = 0;
let failed = 0;
let BASE = '';
let adminToken = '';
const API_TOKEN = 'test-claims-token-not-real';

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function request(endpoint, { method = 'GET', body, token = adminToken } = {}) {
  _resetRateLimits();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const raw = await res.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { status: res.status, data };
}

// ------------------------------------------------------------------ mock GOODEX
const TYPES = [
  { code: 'cod', label: 'Changement montant', value_type: 'montant', needs_value: true, hint: 'Nouveau montant COD à encaisser (en DT)', priorite: 'normale', message_required: false },
  { code: 'adresse', label: 'Changement adresse', value_type: 'texte', needs_value: true, hint: 'Nouvelle adresse complète', priorite: 'normale', message_required: false },
  { code: 'telephone', label: 'Changement téléphone', value_type: 'telephone', needs_value: true, hint: 'Nouveau numéro', priorite: 'normale', message_required: false },
  { code: 'colis_urgent', label: 'Colis urgent', needs_value: false, priorite: 'haute', message_required: false },
  { code: 'annuler', label: 'Annulation du colis', needs_value: false, priorite: 'haute', message_required: false },
  { code: 'rdv', label: 'Rendez-vous planifié', value_type: 'date', needs_value: true, hint: 'Date du rendez-vous', priorite: 'normale', message_required: false },
  { code: 'personnaliser', label: 'Personnaliser', needs_value: false, priorite: 'normale', message_required: true },
];

const mock = {
  server: null,
  requests: [],
  claims: new Map(),
  nextId: 128,
  parcelSeq: 0,
  on: {},
  reset() {
    this.requests = [];
    this.claims = new Map();
    this.nextId = 128;
    this.on = {};
  },
  calls(method, path) {
    return this.requests.filter((r) => r.method === method && r.path === path);
  },
};

function parseMultipart(raw) {
  const fields = {};
  const re = /name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g;
  let m;
  while ((m = re.exec(raw))) fields[m[1]] = m[2];
  return fields;
}

const pad6 = (n) => String(n).padStart(6, '0');

function makeTicket(ean, def, valeur) {
  const id = mock.nextId++;
  const ticket = {
    id, reference: `TK-${pad6(id)}`, colis_ean: ean, type: def.code, type_label: def.label, valeur: valeur ?? null,
    statut: 'nouveau', priorite: 'normale', is_open: true, reponse: null, created_at: '2026-08-27T09:12:44.000000Z',
  };
  mock.claims.set(id, ticket);
  return ticket;
}

function defaultHandlers(rec, send) {
  const { method, path, query, fields } = rec;
  const idMatch = /^\/api\/client\/tickets\/(\d+)$/.exec(path);

  if (method === 'POST' && path === '/api/v1/colis/create') {
    const n = ++mock.parcelSeq;
    return send(200, { id: 5000 + n, ean: `CLM${n}-${Date.now()}`, user_id: 9999, client: fields.client, cod: Number(fields.cod), last_statut: 12, created_at: '2026-07-14 10:30:00' });
  }
  if (method === 'GET' && path.startsWith('/api/v1/colis/etat/')) {
    return send(200, { ean: decodeURIComponent(path.split('/').pop()), statut: 'En Transit', has_motif: 0, motif: '' });
  }
  if (method === 'GET' && path === '/api/v1/tickets/types') {
    return send(200, { types: TYPES, statuts: ['nouveau', 'en_cours', 'resolu', 'rejete'] });
  }
  if (method === 'POST' && path === '/api/client/tickets') {
    const def = TYPES.find((t) => t.code === fields.type);
    if (!def) return send(422, { message: 'Les informations saisies sont incomplètes', errors: { type: ['Type invalide'] } });
    const dup = [...mock.claims.values()].find((t) => t.colis_ean === fields.ean && t.type === def.code && t.is_open);
    if (dup) return send(200, { success: true, already_sent: true, message: `Une réclamation « ${def.label} » est déjà en cours sur ce colis.` });
    const ticket = makeTicket(fields.ean, def, fields.valeur);
    return send(201, { success: true, message: 'Votre réclamation a été envoyée. Notre équipe la traite au plus vite.', ticket });
  }
  if (method === 'GET' && path === '/api/client/tickets/counts') {
    const all = [...mock.claims.values()];
    const count = (s) => all.filter((t) => t.statut === s).length;
    return send(200, { nouveau: count('nouveau'), en_cours: count('en_cours'), resolu: count('resolu'), rejete: count('rejete'), ouverts: count('nouveau') + count('en_cours'), total: all.length });
  }
  if (method === 'GET' && path === '/api/client/tickets') {
    let items = [...mock.claims.values()].sort((a, b) => b.id - a.id);
    if (query.etat === 'ouverts') items = items.filter((t) => t.is_open);
    if (query.etat === 'clotures') items = items.filter((t) => !t.is_open);
    if (query.statut) items = items.filter((t) => t.statut === query.statut);
    if (query.type) items = items.filter((t) => t.type === query.type);
    if (query.ean) items = items.filter((t) => t.colis_ean === query.ean);
    const perPage = Number(query.per_page) || 20;
    const page = Number(query.page) || 1;
    // The documented list items carry type_label (no type code, no priorite).
    const data = items.slice((page - 1) * perPage, page * perPage).map(({ type, priorite, ...rest }) => rest);
    return send(200, { current_page: page, data, total: items.length, per_page: perPage, last_page: Math.max(1, Math.ceil(items.length / perPage)) });
  }
  if (method === 'GET' && idMatch) {
    const t = mock.claims.get(Number(idMatch[1]));
    return t ? send(200, t) : send(404, { error: 'Réclamation introuvable' });
  }
  if (method === 'DELETE' && idMatch) {
    const t = mock.claims.get(Number(idMatch[1]));
    if (!t) return send(404, { error: 'Réclamation introuvable' });
    if (t.statut !== 'nouveau') return send(422, { error: 'Cette réclamation est déjà prise en charge, elle ne peut plus être annulée.' });
    mock.claims.delete(t.id);
    return send(200, { success: true, message: 'Réclamation annulée' });
  }
  return send(404, {});
}

function startMock() {
  mock.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      const rec = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        accept: req.headers.accept || '',
        fields: parseMultipart(Buffer.concat(chunks).toString('utf8')),
      };
      mock.requests.push(rec);
      const send = (status, body, opts = {}) => {
        if (opts.raw !== undefined) {
          res.writeHead(status, { 'Content-Type': 'text/plain' });
          return res.end(opts.raw);
        }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const normalizedPath = rec.path.replace(/\/api\/v1\/colis\/etat\/[^/]+$/, '/api/v1/colis/etat/:ean').replace(/\/\d+$/, '/:id');
      const key = `${rec.method} ${normalizedPath}`;
      if (mock.on[key]) return mock.on[key](rec, send, res);
      return defaultHandlers(rec, send);
    });
  });
  return new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
}

// ------------------------------------------------------------------ fixtures
const created = { orderIds: [], productIds: [] };
let variant;

async function makeOrder() {
  _resetRateLimits();
  const res = await request('/orders', {
    method: 'POST',
    token: null,
    body: { customer: { name: 'Claim Client', phone: '12345678', address: '12 Rue Test', governorate: 'Tunis' }, items: [{ variantId: variant.id, quantity: 1 }] },
  });
  if (res.status !== 201) throw new Error(`order creation failed: ${res.status} ${JSON.stringify(res.data)}`);
  created.orderIds.push(res.data.id);
  return res.data;
}

const deliveryRow = async (orderId) => (await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, orderId)))[0] || null;
const orderRow = async (orderId) => (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
const claimRows = (orderId) => db.select().from(orderClaims).where(eq(orderClaims.orderId, orderId));

/** A confirmed order whose parcel exists; its status defaults to "En Transit" (4), i.e. past "En Attente". */
async function makeParcelOrder({ statusId = 4, statusLabel = 'En Transit' } = {}) {
  const order = await makeOrder();
  await request(`/orders/${order.id}/confirm`, { method: 'POST' });
  const d = await deliveryRow(order.id);
  if (!d || d.state !== 'created') throw new Error(`parcel not created: ${JSON.stringify(d)}`);
  if (statusId !== 12) {
    const now = new Date();
    await db.update(orderDeliveries).set({
      goodexStatus: statusLabel, goodexStatusId: statusId, deliveryStatus: `status_${statusId}`, statusUpdatedAt: now, statusReceivedAt: now, lastPolledAt: now,
    }).where(eq(orderDeliveries.id, d.id));
  }
  return { order, ean: d.ean, deliveryId: d.id };
}

const openClaim = (orderId, body) => request(`/orders/${orderId}/claims`, { method: 'POST', body });

// --------------------------------------------------------------------- tests
async function run() {
  const dbName = new URL(env.databaseUrl).pathname.slice(1);
  if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== '1') {
    throw new Error(`Refusing to run against database "${dbName}": use a dedicated test database (name containing "test")`);
  }
  await runOrderDeliveriesMigration(pool);
  await runOrderClaimsMigration(pool);
  await startMock();

  const httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  BASE = `http://127.0.0.1:${httpServer.address().port}/api`;

  env.goodex.baseUrl = `http://127.0.0.1:${mock.server.address().port}`;
  env.goodex.apiToken = API_TOKEN;
  env.goodex.userId = '9999';
  env.goodex.timeoutMs = 400;
  if (new URL(env.goodex.baseUrl).hostname !== '127.0.0.1') throw new Error('Refusing to run against a non-loopback GOODEX URL');

  let [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) {
    [admin] = await db.insert(users).values({ email: `admin-claims-${Date.now()}@silky.tn`, passwordHash: 'fakehash', fullName: 'Admin Claims', role: 'admin' }).returning();
  }
  adminToken = signAccessToken(admin);

  let [category] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!category) [category] = await db.insert(categories).values({ name: 'Femme', slug: 'femme' }).returning();
  const prodRes = await request('/products', {
    method: 'POST',
    body: {
      name: 'Produit Claims Test', description: 'd', collectionImage: '/pictures/collection.jpg', slug: `claims-prod-${Date.now()}`, price: 100,
      category: category.slug, categoryId: category.id, colors: [{ id: 'noir', name: 'Noir', image: '/pictures/noir.jpg' }], sizes: ['M'], stock: { 'noir-M': 300 },
    },
  });
  created.productIds.push(prodRes.data.id);
  [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, prodRes.data.id));

  // ---------------------------------------------------------------- 1. types, cache, access
  console.log('\n[1] Claim types: cache, stale fallback, access, configuration');
  mock.reset();
  _resetClaimCaches();
  const t1 = await request('/orders/claims/types');
  assert(t1.status === 200 && t1.data.types.length === TYPES.length && t1.data.types[0].code === 'cod' && t1.data.types[0].needsValue === true && t1.data.types[0].valueType === 'montant', 'types fetched and normalized (value_type, needs_value, hint, message_required)');
  assert(t1.data.types.find((t) => t.code === 'personnaliser').messageRequired === true && t1.data.statuts.join() === 'nouveau,en_cours,resolu,rejete', 'message_required and the provider statuses are exposed');
  await request('/orders/claims/types');
  await request('/orders/claims/types');
  assert(mock.calls('GET', '/api/v1/tickets/types').length === 1, 'cached: three admin calls cause a single GOODEX request');
  assert(mock.calls('GET', '/api/v1/tickets/types')[0].accept === 'application/json' && mock.calls('GET', '/api/v1/tickets/types')[0].query.token === API_TOKEN, 'types request: Accept header, token in the query string');
  await request('/orders/claims/types?refresh=1');
  assert(mock.calls('GET', '/api/v1/tickets/types').length === 2, 'refresh=1 forces a new request');
  mock.on['GET /api/v1/tickets/types'] = (r, send) => send(500, {});
  const stale = await request('/orders/claims/types?refresh=1');
  assert(stale.status === 200 && stale.data.stale === true && stale.data.types.length === TYPES.length, 'provider failure with a cache -> the cached list is served, flagged stale');
  _resetClaimCaches();
  const noCache = await request('/orders/claims/types');
  assert(noCache.status === 502 && /indisponibles/.test(noCache.data.error), 'provider failure without a cache -> 502 with a clear message');
  mock.on = {};
  _resetClaimCaches();
  mock.on['GET /api/v1/tickets/types'] = (r, send) => send(200, { types: [] });
  assert((await request('/orders/claims/types')).status === 502, 'an empty type list is rejected');
  mock.on['GET /api/v1/tickets/types'] = (r, send) => send(200, [{ code: 'cod' }]);
  assert((await request('/orders/claims/types')).status === 502, 'a bare array instead of {types:[...]} is rejected');
  mock.on = {};
  _resetClaimCaches();

  assert((await request('/orders/claims/types', { token: null })).status === 401, 'claims routes reject unauthenticated calls');
  const [customer] = await db.select().from(users).where(eq(users.role, 'customer')).limit(1);
  if (customer) assert((await request('/orders/claims/types', { token: signAccessToken(customer) })).status === 403, 'claims routes reject non-admin users');

  const requestsBeforeNoToken = mock.requests.length;
  env.goodex.apiToken = '';
  _resetClaimCaches();
  assert((await request('/orders/claims/types')).status === 503, 'no token: types -> 503 configuration error');
  const unconfiguredCounts = await request('/orders/claims/counts');
  assert(unconfiguredCounts.status === 200 && unconfiguredCounts.data.configured === false, 'no token: counts -> 200 {configured:false} (a state, not an error)');
  assert((await request('/orders/claims/remote')).status === 503 && mock.requests.length === requestsBeforeNoToken, 'no token: the list is refused and nothing is sent to GOODEX');
  env.goodex.apiToken = API_TOKEN;

  // ---------------------------------------------------------------- 2. validation
  console.log('\n[2] Validation driven by the provider type definitions');
  const types = (await request('/orders/claims/types')).data.types;
  const fixedNow = new Date(2026, 7, 27, 10, 0, 0);
  const v = (input) => validateClaimInput(input, types, fixedNow);
  assert(v({ type: 'inconnu' }).errors.type && !v({ type: 'inconnu' }).clean, 'unknown type rejected');
  assert(v({ type: 'cod' }).errors.valeur?.[0] === 'Cette information est obligatoire pour ce motif', 'needs_value=true and no valeur -> required');
  assert(v({ type: 'cod', valeur: '85' }).clean.valeur === '85.000' && v({ type: 'cod', valeur: '85,5' }).clean.valeur === '85.500', 'montant normalized to 3 decimals (comma accepted)');
  assert(['abc', '-5', '85.0000', '1e3'].every((x) => v({ type: 'cod', valeur: x }).errors.valeur), 'montant: letters, negative, 4 decimals, exponent rejected');
  assert(v({ type: 'telephone', valeur: '55 899 090' }).clean.valeur === '55899090' && v({ type: 'telephone', valeur: '1234567' }).errors.valeur && v({ type: 'telephone', valeur: '1'.repeat(21) }).errors.valeur && v({ type: 'telephone', valeur: '55a89909' }).errors.valeur, 'telephone: 8-20 digits only');
  assert(v({ type: 'rdv', valeur: '2026-08-27' }).clean && v({ type: 'rdv', valeur: '2026-09-30' }).clean && v({ type: 'rdv', valeur: '2026-08-26' }).errors.valeur && v({ type: 'rdv', valeur: '2026-02-30' }).errors.valeur && v({ type: 'rdv', valeur: '27/08/2026' }).errors.valeur, 'date: YYYY-MM-DD, real calendar day, today or later');
  assert(v({ type: 'adresse', valeur: 'Rue' }).errors.valeur && v({ type: 'adresse', valeur: 'x'.repeat(256) }).errors.valeur && v({ type: 'adresse', valeur: 'Sahloul, Sousse' }).clean, 'texte: 5-255 characters');
  assert(v({ type: 'colis_urgent', valeur: 'ignoré' }).clean.valeur === null, 'a value is not sent when the type does not need one');
  assert(v({ type: 'personnaliser' }).errors.message && v({ type: 'personnaliser', message: 'Bonjour' }).clean, 'message_required=true -> message mandatory');
  assert(v({ type: 'colis_urgent', message: 'x'.repeat(1001) }).errors.message && v({ type: 'colis_urgent', message: 'x'.repeat(1000) }).clean, 'message limited to 1000 characters');
  assert(validateValue('prix_special', 'quelque chose').value === 'quelque chose' && validateValue('prix_special', 'x'.repeat(256)).error, 'an unknown value_type is not guessed at (presence and 255 characters only)');

  // ---------------------------------------------------------------- 3. eligibility
  console.log('\n[3] Which orders can have a claim');
  const noParcel = await makeOrder();
  const elig = await request(`/orders/${noParcel.id}/claims`);
  assert(elig.status === 200 && elig.data.canOpen === false && /Aucun colis GOODEX/.test(elig.data.reason) && elig.data.claims.length === 0, 'order without a parcel: canOpen=false with the reason');
  const sentBefore = mock.requests.length;
  const noParcelOpen = await openClaim(noParcel.id, { type: 'colis_urgent' });
  assert(noParcelOpen.status === 409 && mock.requests.length === sentBefore, 'order without a parcel: opening is refused (409) with no request to GOODEX');
  assert((await request('/orders/00000000-0000-0000-0000-000000000000/claims')).status === 404, 'unknown order -> 404');

  // ---------------------------------------------------------------- 4. opening a claim
  console.log('\n[4] Opening a claim');
  const P = await makeParcelOrder();
  const orderBefore = await orderRow(P.order.id);
  const deliveryBefore = await deliveryRow(P.order.id);
  mock.requests = [];
  const o1 = await openClaim(P.order.id, { type: 'cod', valeur: '85', message: "Demande envoyee depuis l'API" });
  const sent = mock.calls('POST', '/api/client/tickets')[0];
  assert(o1.status === 201 && o1.data.result === 'created' && o1.data.claim.reference === 'TK-000128' && o1.data.claim.goodexClaimId === 128, 'new claim: HTTP 201, id and reference kept');
  assert(sent.fields.token === API_TOKEN && sent.fields.ean === P.ean && sent.fields.type === 'cod' && sent.fields.valeur === '85.000' && sent.fields.message === "Demande envoyee depuis l'API", 'request fields: token, ean, type, valeur (3 decimals), message');
  assert(!('colis_id' in sent.fields) && sent.accept === 'application/json', 'ean identifies the parcel (no colis_id), Accept: application/json sent');
  const rows = await claimRows(P.order.id);
  assert(rows.length === 1 && rows[0].goodexClaimId === 128 && rows[0].reference === 'TK-000128' && rows[0].ean === P.ean && rows[0].status === 'nouveau' && rows[0].isOpen === true && rows[0].source === 'silky' && rows[0].message === "Demande envoyee depuis l'API" && rows[0].type === 'cod' && rows[0].valeur === '85.000', 'claim id, reference, type, value, our message and status saved locally against the order');
  const orderAfter = await orderRow(P.order.id);
  const deliveryAfter = await deliveryRow(P.order.id);
  assert(orderAfter.status === orderBefore.status && orderAfter.totalAmount === orderBefore.totalAmount && JSON.stringify(deliveryAfter) === JSON.stringify(deliveryBefore), 'a claim never changes the order, its totals or the parcel record');

  const dup = await openClaim(P.order.id, { type: 'cod', valeur: '90' });
  assert(dup.status === 200 && dup.data.result === 'already_sent' && /déjà en cours/.test(dup.data.message), 'duplicate: HTTP 200 already_sent, explicitly not a creation');
  assert(dup.data.claim?.reference === 'TK-000128' && (await claimRows(P.order.id)).length === 1 && mock.claims.size === 1, 'duplicate: linked to the existing claim, no second local row, no second claim at GOODEX');

  // already_sent where Silky has no local copy: the claim is found through the remote list (type_label only)
  await db.delete(orderClaims).where(eq(orderClaims.orderId, P.order.id));
  const relinked = await openClaim(P.order.id, { type: 'cod', valeur: '90' });
  assert(relinked.data.result === 'already_sent' && relinked.data.claim?.goodexClaimId === 128 && (await claimRows(P.order.id))[0]?.source === 'import', 'already_sent without a local copy: existing claim imported via the list and linked');

  const race = await Promise.all(Array.from({ length: 5 }, () => openClaim(P.order.id, { type: 'adresse', valeur: '5 Rue de Sousse, Tunis' })));
  const kinds = race.map((r) => r.data.result).sort().join();
  assert(race.every((r) => r.status === 200 || r.status === 201) && race.filter((r) => r.status === 201).length === 1 && kinds === 'already_sent,already_sent,already_sent,already_sent,created', `5 simultaneous requests: exactly one claim is created (${kinds})`);
  assert((await claimRows(P.order.id)).filter((r) => r.type === 'adresse').length === 1, 'concurrent requests leave a single local row');

  // validation never reaches GOODEX
  const before = mock.calls('POST', '/api/client/tickets').length;
  const bad = [
    ['missing valeur', { type: 'cod' }, /valeur/], ['bad montant', { type: 'cod', valeur: 'abc' }, /valeur/], ['past date', { type: 'rdv', valeur: '2000-01-01' }, /valeur/],
    ['missing message', { type: 'personnaliser' }, /message/], ['unknown type', { type: 'zzz' }, /type/], ['message too long', { type: 'colis_urgent', message: 'x'.repeat(1001) }, /message/],
  ];
  for (const [label, body, pattern] of bad) {
    const r = await openClaim(P.order.id, body);
    assert(r.status === 422 && pattern.test(r.data.error) && r.data.errors && Object.keys(r.data.errors).length > 0, `invalid request (${label}) -> 422 with field messages`);
  }
  assert(mock.calls('POST', '/api/client/tickets').length === before, 'invalid requests never reach GOODEX');

  // provider failures
  const failures = [
    ['404 parcel unknown', 404, { error: 'Colis introuvable' }, 404, /inconnu de GOODEX/],
    ['422 with field errors', 422, { message: 'Les informations saisies sont incomplètes', errors: { valeur: ['Cette information est obligatoire pour ce motif'] } }, 422, /valeur : Cette information/],
    ['422 parcel still En Attente', 422, { message: 'Le colis est encore En Attente, modifiez-le directement.' }, 422, /pas encore pris en charge/],
    ['401 invalid token', 401, { message: 'Unauthenticated.' }, 502, /GOODEX_API_TOKEN/],
    ['403', 403, { message: 'Forbidden' }, 502, /refusée/],
  ];
  for (const [label, status, body, expectedStatus, pattern] of failures) {
    mock.on['POST /api/client/tickets'] = (r, send) => send(status, body);
    const r = await openClaim(P.order.id, { type: 'colis_urgent' });
    assert(r.status === expectedStatus && pattern.test(r.data.error), `provider ${label} -> HTTP ${expectedStatus}, explained: ${r.data.error}`);
  }
  mock.on = {};
  const failedRows = (await claimRows(P.order.id)).length;

  const uncertain = [
    ['timeout', (r) => { /* never answers */ }],
    ['HTTP 500', (r, send) => send(500, {})],
    ['201 without ticket', (r, send) => send(201, { success: true })],
    ['200 without already_sent', (r, send) => send(200, { success: true })],
    ['non-JSON 201', (r, send) => send(201, null, { raw: 'OK' })],
  ];
  for (const [label, handler] of uncertain) {
    mock.on['POST /api/client/tickets'] = handler;
    const r = await openClaim(P.order.id, { type: 'colis_urgent' });
    assert(r.status === 502 && r.data.outcome === 'unknown' && /Résultat incertain/.test(r.data.error), `uncertain outcome (${label}) -> 502 "unknown", nothing stored`);
  }
  mock.on = {};
  assert((await claimRows(P.order.id)).length === failedRows, 'no failed or uncertain attempt left a local row');
  const resubmit = await openClaim(P.order.id, { type: 'colis_urgent' });
  assert(resubmit.status === 201 && resubmit.data.result === 'created', 'after an uncertain outcome, re-submitting is safe (GOODEX dedups) and succeeds');

  // saved at GOODEX but the local write fails
  const realUpsert = claimRepository.upsertFromRemote;
  claimRepository.upsertFromRemote = async () => { throw new Error('simulated database failure'); };
  const lost = await openClaim(P.order.id, { type: 'annuler' });
  claimRepository.upsertFromRemote = realUpsert;
  assert(lost.status === 201 && lost.data.result === 'created' && /non enregistrée localement/.test(lost.data.warning) && lost.data.claim.reference, 'GOODEX created it but the local save failed: success with a warning carrying the reference');
  assert((await claimRows(P.order.id)).every((r) => r.type !== 'annuler'), 'nothing was saved locally in that case');
  const synced = await request(`/orders/${P.order.id}/claims/sync`, { method: 'POST' });
  assert(synced.status === 200 && synced.data.claims.some((c) => c.typeLabel === 'Annulation du colis'), '« Synchroniser » recovers the claim from GOODEX');

  // parcel "En Attente": GOODEX needs the parcel taken in charge
  const W = await makeParcelOrder({ statusId: 12, statusLabel: 'En Attente' });
  mock.requests = [];
  mock.on['GET /api/v1/colis/etat/:ean'] = (r, send) => send(200, { ean: W.ean, statut: 'En Attente', has_motif: 0, motif: '' });
  const waiting = await openClaim(W.order.id, { type: 'colis_urgent' });
  assert(waiting.status === 409 && /En Attente/.test(waiting.data.error) && mock.calls('POST', '/api/client/tickets').length === 0, 'parcel confirmed still "En Attente": blocked locally with an explanation, no claim request');
  assert(mock.calls('GET', `/api/v1/colis/etat/${W.ean}`).length === 1, 'the saved status was refreshed first (read-only GET) before deciding');
  mock.on['GET /api/v1/colis/etat/:ean'] = (r, send) => send(200, { ean: W.ean, statut: 'En Transit', has_motif: 0, motif: '' });
  const moved = await openClaim(W.order.id, { type: 'colis_urgent' });
  assert(moved.status === 201 && (await deliveryRow(W.order.id)).goodexStatusId === 4, 'the saved status was stale: refreshed to "En Transit", then the claim is sent');
  const W2 = await makeParcelOrder({ statusId: 12, statusLabel: 'En Attente' });
  mock.on['GET /api/v1/colis/etat/:ean'] = (r, send) => send(500, {});
  mock.on['POST /api/client/tickets'] = (r, send) => send(422, { message: 'Le colis est encore En Attente' });
  const trackDown = await openClaim(W2.order.id, { type: 'colis_urgent' });
  assert(trackDown.status === 422 && /pas encore pris en charge/.test(trackDown.data.error), 'tracking unavailable: GOODEX itself decides (documented 422), explained');
  mock.on = {};

  // ---------------------------------------------------------------- 5. remote list
  console.log('\n[5] Listing claims');
  mock.requests = [];
  const L = await request(`/orders/claims/remote?etat=ouverts&statut=nouveau&type=cod&ean=${encodeURIComponent(P.ean)}&date_debut=2026-08-01&date_fin=2026-08-31&page=1&per_page=20`);
  const lq = mock.calls('GET', '/api/client/tickets')[0];
  assert(lq && lq.query.token === API_TOKEN && lq.query.etat === 'ouverts' && lq.query.statut === 'nouveau' && lq.query.type === 'cod' && lq.query.ean === P.ean && lq.query.date_debut === '2026-08-01' && lq.query.date_fin === '2026-08-31' && lq.query.per_page === '20', 'all documented filters are forwarded, token in the query');
  assert(L.status === 200 && L.data.total === 1 && L.data.items[0].reference === 'TK-000128' && L.data.items[0].order?.id === P.order.id && L.data.items[0].order.orderNumber, 'items are read from `data`, pagination from the top level, and linked to the Silky order by EAN');
  assert(L.data.items[0].type === null && L.data.items[0].typeLabel === 'Changement montant' && L.data.items[0].resolvedAt === null, 'missing optional fields (type code, resolved_at) are tolerated');
  const defaults = await request('/orders/claims/remote');
  assert(mock.calls('GET', '/api/client/tickets').at(-1).query.per_page === '20' && mock.calls('GET', '/api/client/tickets').at(-1).query.page === '1', 'defaults: page 1, 20 per page (the documented default)');
  assert((await request('/orders/claims/remote?per_page=51')).status === 400 && (await request('/orders/claims/remote?per_page=0')).status === 400, 'page size is capped at 50 locally (the provider maximum is undocumented)');
  assert((await request('/orders/claims/remote?etat=nimporte')).status === 400 && (await request('/orders/claims/remote?statut=zzz')).status === 400 && (await request('/orders/claims/remote?date_debut=hier')).status === 400 && (await request('/orders/claims/remote?page=0')).status === 400 && (await request('/orders/claims/remote?ean=a b')).status === 400, 'invalid filters are refused before any request');
  mock.on['GET /api/client/tickets'] = (r, send) => send(200, [{ id: 1 }]);
  assert((await request('/orders/claims/remote')).status === 502, 'a bare array (instead of the paginated object) is rejected');
  mock.on['GET /api/client/tickets'] = (r, send) => send(200, { data: 'oops' });
  assert((await request('/orders/claims/remote')).status === 502, 'a non-array `data` is rejected');
  mock.on['GET /api/client/tickets'] = (r, send) => send(500, {});
  assert((await request('/orders/claims/remote')).status === 502, 'provider error -> 502');
  mock.on = {};

  // ---------------------------------------------------------------- 6. counters
  console.log('\n[6] Counters');
  _resetClaimCaches();
  mock.requests = [];
  mock.on['GET /api/client/tickets/counts'] = (r, send) => send(200, { nouveau: 2, en_cours: 1, resolu: 14, rejete: 0, ouverts: 5, total: 17 });
  const c1 = await request('/orders/claims/counts');
  assert(c1.status === 200 && c1.data.configured === true && c1.data.ouverts === 5 && c1.data.nouveau === 2 && c1.data.total === 17, 'counters used as returned (ouverts is not recomputed from nouveau + en_cours)');
  await request('/orders/claims/counts');
  await request('/orders/claims/counts');
  assert(mock.calls('GET', '/api/client/tickets/counts').length === 1, 'counters cached: three calls, one GOODEX request');
  mock.on['GET /api/client/tickets/counts'] = (r, send) => send(200, { nouveau: 'x' });
  _resetClaimCaches();
  const cOdd = await request('/orders/claims/counts');
  assert(cOdd.status === 200 && cOdd.data.nouveau === null && cOdd.data.total === null, 'non-numeric counters become null instead of garbage');
  mock.on = {};
  _resetClaimCaches();
  await request('/orders/claims/counts');
  const fresh = await makeParcelOrder();
  await openClaim(fresh.order.id, { type: 'colis_urgent' });
  mock.requests = [];
  await request('/orders/claims/counts');
  assert(mock.calls('GET', '/api/client/tickets/counts').length === 1, 'opening a claim invalidates the cached counters');
  mock.on['GET /api/client/tickets/counts'] = (r, send) => send(500, {});
  // expire the cache by resetting only the TTL: simulate through a fresh process state with a stale copy
  _resetClaimCaches();
  assert((await request('/orders/claims/counts')).status === 502, 'counters unavailable and never fetched -> 502');
  mock.on = {};

  // ---------------------------------------------------------------- 7. refresh / details
  console.log('\n[7] Claim details and refresh');
  const claimRow = (await claimRows(P.order.id)).find((r) => r.goodexClaimId === 128);
  mock.claims.get(128).statut = 'en_cours';
  mock.claims.get(128).reponse = 'Nous traitons votre demande.';
  const r1 = await request(`/orders/claims/${claimRow.id}/refresh`, { method: 'POST' });
  assert(r1.status === 200 && r1.data.status === 'en_cours' && r1.data.reponse === 'Nous traitons votre demande.' && r1.data.isOpen === true && r1.data.canCancel === false, 'refresh updates status and the team response; an en_cours claim cannot be cancelled');
  assert(r1.data.type === 'cod' && r1.data.valeur === '85.000', 'refresh fills in what the list omitted (type code) and keeps the value');
  mock.claims.get(128).statut = 'resolu';
  mock.claims.get(128).is_open = false;
  mock.claims.get(128).resolved_at = '2026-08-27T14:02:10.000000Z';
  const r2 = await request(`/orders/claims/${claimRow.id}/refresh`, { method: 'POST' });
  assert(r2.data.status === 'resolu' && r2.data.isOpen === false && r2.data.resolvedAt === '2026-08-27T14:02:10.000000Z', 'resolved claim: closed, with its resolution date');
  mock.on['GET /api/client/tickets/:id'] = (r, send) => send(200, { ticket: { ...mock.claims.get(128), statut: 'rejete' } });
  assert((await request(`/orders/claims/${claimRow.id}/refresh`, { method: 'POST' })).data.status === 'rejete', 'a detail response wrapped in {ticket} is understood');
  mock.on['GET /api/client/tickets/:id'] = (r, send) => send(404, { error: 'Réclamation introuvable' });
  const gone = await request(`/orders/claims/${claimRow.id}/refresh`, { method: 'POST' });
  assert(gone.status === 404 && /introuvable/i.test(gone.data.error) && (await claimRows(P.order.id)).find((r) => r.id === claimRow.id).status === 'rejete', 'detail 404 -> a clear message, the local copy is left as it was');
  mock.on['GET /api/client/tickets/:id'] = (r, send) => send(200, { foo: 'bar' });
  assert((await request(`/orders/claims/${claimRow.id}/refresh`, { method: 'POST' })).status === 502, 'a detail body with neither status nor reference -> 502, not treated as an empty successful claim');
  mock.on['GET /api/client/tickets/:id'] = (r, send) => send(500, {});
  assert((await request(`/orders/claims/${claimRow.id}/refresh`, { method: 'POST' })).status === 502, 'detail server error -> 502');
  mock.on = {};
  assert((await request('/orders/claims/00000000-0000-0000-0000-000000000000/refresh', { method: 'POST' })).status === 404, 'unknown local claim -> 404');

  // ---------------------------------------------------------------- 8. cancel
  console.log('\n[8] Cancelling a claim (the claim only, never the parcel)');
  const Q = await makeParcelOrder();
  const q1 = (await openClaim(Q.order.id, { type: 'colis_urgent' })).data.claim;
  const qDeliveryBefore = JSON.stringify(await deliveryRow(Q.order.id));
  mock.requests = [];
  const cancelled = await request(`/orders/claims/${q1.id}`, { method: 'DELETE' });
  const del = mock.calls('DELETE', `/api/client/tickets/${q1.goodexClaimId}`)[0];
  assert(cancelled.status === 200 && cancelled.data.cancelled === true && cancelled.data.isOpen === false && cancelled.data.canCancel === false, 'a "nouveau" claim is cancelled and shown as such');
  assert(del && del.query.token === API_TOKEN && del.accept === 'application/json' && !mock.claims.has(q1.goodexClaimId), 'DELETE sent with the token in the query; the claim is gone at GOODEX');
  assert(JSON.stringify(await deliveryRow(Q.order.id)) === qDeliveryBefore && (await orderRow(Q.order.id)).status === 'completed', 'cancelling a claim leaves the parcel and the order untouched');
  const again = await request(`/orders/claims/${q1.id}`, { method: 'DELETE' });
  assert(again.status === 409 && mock.calls('DELETE', `/api/client/tickets/${q1.goodexClaimId}`).length === 1, 'cancelling twice is refused without a second DELETE');
  const afterCancel = await request(`/orders/claims/${q1.id}/refresh`, { method: 'POST' });
  assert(afterCancel.status === 200 && afterCancel.data.cancelled === true, 'refreshing a cancelled claim (404 at GOODEX) is expected and harmless');

  const q2 = (await openClaim(Q.order.id, { type: 'annuler' })).data.claim;
  mock.claims.get(q2.goodexClaimId).statut = 'en_cours';
  mock.requests = [];
  const blocked = await request(`/orders/claims/${q2.id}`, { method: 'DELETE' });
  assert(blocked.status === 409 && /déjà prise en charge/.test(blocked.data.error) && mock.calls('DELETE', `/api/client/tickets/${q2.goodexClaimId}`).length === 0, 'open but en_cours (stale local "nouveau"): live status read first, cancel blocked, no DELETE sent');
  assert((await claimRows(Q.order.id)).find((r) => r.id === q2.id).status === 'en_cours', 'the stale local status was corrected by that read');

  const q3 = (await openClaim(Q.order.id, { type: 'colis_urgent' })).data.claim;
  mock.on['DELETE /api/client/tickets/:id'] = (r, send) => send(422, { error: 'Cette réclamation est déjà prise en charge, elle ne peut plus être annulée.' });
  mock.claims.get(q3.goodexClaimId).statut = 'nouveau';
  const refused = await request(`/orders/claims/${q3.id}`, { method: 'DELETE' });
  assert(refused.status === 409 && /déjà prise en charge/.test(refused.data.error) && (await claimRows(Q.order.id)).find((r) => r.id === q3.id).cancelledAt === null, 'GOODEX refuses (422): its message is shown, the claim is not marked cancelled');
  mock.on['DELETE /api/client/tickets/:id'] = (r) => { /* never answers */ };
  const unsure = await request(`/orders/claims/${q3.id}`, { method: 'DELETE' });
  assert(unsure.status === 502 && unsure.data.outcome === 'unknown' && (await claimRows(Q.order.id)).find((r) => r.id === q3.id).cancelledAt === null, 'cancel timeout -> uncertain, nothing marked cancelled');
  mock.on['DELETE /api/client/tickets/:id'] = (r, send) => send(200, { ok: true });
  assert((await request(`/orders/claims/${q3.id}`, { method: 'DELETE' })).status === 502, 'a 200 without success:true is not treated as a cancellation');
  mock.on = {};

  // ---------------------------------------------------------------- 9. sync
  console.log('\n[9] Synchronising a parcel\'s claims');
  const S = await makeParcelOrder();
  for (let i = 0; i < 60; i += 1) makeTicket(S.ean, TYPES[i % 3], `${i}`);
  makeTicket('OTHER-PARCEL-EAN', TYPES[0], '1');
  mock.requests = [];
  const sy = await request(`/orders/${S.order.id}/claims/sync`, { method: 'POST' });
  const syncCalls = mock.calls('GET', '/api/client/tickets');
  assert(sy.status === 200 && sy.data.claims.length === 60 && syncCalls.length === 2 && syncCalls.every((c) => c.query.ean === S.ean && c.query.per_page === '50'), '60 claims imported over 2 pages (50 per page), filtered by EAN');
  assert((await claimRows(S.order.id)).every((r) => r.source === 'import' && r.ean === S.ean), 'imported claims are marked as imports and belong to this parcel');
  const sy2 = await request(`/orders/${S.order.id}/claims/sync`, { method: 'POST' });
  assert(sy2.data.claims.length === 60 && (await claimRows(S.order.id)).length === 60, 'a second sync creates no duplicates');
  mock.on['GET /api/client/tickets'] = (r, send) => send(500, {});
  assert((await request(`/orders/${S.order.id}/claims/sync`, { method: 'POST' })).status === 502, 'sync failure -> 502, local data untouched');
  mock.on = {};
  assert((await request(`/orders/${noParcel.id}/claims/sync`, { method: 'POST' })).status === 409, 'sync needs a parcel');

  // ---------------------------------------------------------------- 10. hygiene
  console.log('\n[10] Secrets and hosts');
  const leaks = logged.filter((line) => line.includes(API_TOKEN));
  assert(leaks.length === 0, `no log line contains the API token (${leaks.length} found)`);
  assert(new URL(env.goodex.baseUrl).hostname === '127.0.0.1', 'the GOODEX base URL was the loopback mock throughout');

  await new Promise((r) => httpServer.close(r));
  mock.server.closeAllConnections?.();
  await new Promise((r) => mock.server.close(r));
}

async function cleanup() {
  try {
    if (created.orderIds.length) await db.delete(orders).where(inArray(orders.id, created.orderIds));
    if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
  } catch (err) {
    console.warn('Cleanup warning:', err.message);
  }
}

try {
  await run();
} catch (err) {
  console.error('Test execution error:', err);
  failed++;
} finally {
  await cleanup();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}
