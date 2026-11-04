/**
 * GOODEX delivery integration tests (no real GOODEX account needed).
 *
 * A local mock HTTP server stands in for GOODEX; env.goodex.baseUrl is pointed at it,
 * and the script refuses to run against any non-loopback host.
 *
 * Covers: parcel creation on confirm, ean persistence, cod value, `last_statut=12` sent (required by the live API),
 * duplicate / concurrent / bulk / PATCH confirmations, local validation failure, 4xx,
 * timeout and 5xx (unknown, never auto-retried), malformed responses, admin retry
 * rules, tracking (incl. "Colis Introuvable"), webhook auth / test / duplicate /
 * unknown-code handling, and status mapping ("Payé" never touches Silky financials).
 *
 * Requires DATABASE_URL pointing at a DEDICATED TEST database (its name must contain
 * "test"; set ALLOW_NON_TEST_DB=1 to override at your own risk). Cleans up the rows it
 * creates. No real credentials and no real GOODEX host are ever used.
 * Usage (PowerShell): $env:DATABASE_URL='postgres://.../silky_test'; node server/scripts/test_goodex_delivery.js
 */

import http from 'http';
import { app } from '../app.js';
import { env } from '../config/env.js';
import {
  resolveParcelGovernorate,
  missingApiConfig,
  missingWebhookConfig,
  resolveGoodexStatus,
  GOODEX_STATUSES,
  formatCod,
} from '../config/goodex.js';
import { orderMatchesSearch } from '../../src/utils/orderSearch.js';
import { CANONICAL_GOVERNORATES } from '../config/governorates.js';
import { deliveryRepository } from '../repositories/delivery.repository.js';
import { parseHasMotif } from '../services/goodex.client.js';
import { db } from '../db/orm.js';
import { eq, inArray } from 'drizzle-orm';
import {
  products,
  productVariants,
  categories,
  orders,
  governorates,
  drafts,
  users,
  orderDeliveries,
  orderDeliveryEvents,
} from '../models/index.js';
import { _resetRateLimits } from '../middleware/rateLimiter.js';
import { signAccessToken } from '../services/token.service.js';
import { runOrderDeliveriesMigration } from '../db/migrations/add_order_deliveries.js';
import { pool } from '../db/pool.js';

// Everything printed (by the tests and by the app) is captured so we can prove that no
// credential ever reaches the logs.
const logged = [];
for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    logged.push(args.map((a) => (a instanceof Error ? `${a.message}
${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    original(...args);
  };
}

let passed = 0;
let failed = 0;
let BASE = '';
let adminToken = '';

const API_TOKEN = 'test-api-token-not-real';
const WEBHOOK_SECRET = 'test-webhook-secret-not-real';

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function request(endpoint, { method = 'GET', body, token, headers: extra } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// ---------------------------------------------------------------- mock GOODEX
const mock = {
  server: null,
  creates: [],
  tracks: [],
  onCreate: null,
  onTrack: null,
  reset() {
    this.creates = [];
    this.tracks = [];
    this.onCreate = null;
    this.onTrack = null;
  },
};

function parseMultipart(raw) {
  const fields = {};
  const re = /name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g;
  let m;
  while ((m = re.exec(raw))) fields[m[1]] = m[2];
  return fields;
}

function startMock() {
  mock.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST' && req.url === '/api/v1/colis/create') {
        const record = { fields: parseMultipart(raw), contentType: req.headers['content-type'] || '', accept: req.headers.accept || '' };
        mock.creates.push(record);
        const handler = mock.onCreate || ((r, send) => send(200, { id: 100000 + mock.creates.length, ean: `EAN${mock.creates.length}-${Date.now()}`, user_id: 9999, client: r.fields.client, cod: Number(r.fields.cod), adresse: r.fields.adresse, governorat: r.fields.governorat, gsm1: r.fields.gsm1, gsm2: '', designation: r.fields.designation, nbre: Number(r.fields.nbre), last_statut: 12, echange: 0, decharge: 0, created_at: '2026-07-14 10:30:00' }));
        return handler(record, (status, body, opts = {}) => {
          if (opts.raw !== undefined) {
            res.writeHead(status, { 'Content-Type': 'text/plain' });
            return res.end(opts.raw);
          }
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        }, res);
      }
      if (req.method === 'GET' && req.url.startsWith('/api/v1/colis/etat/')) {
        mock.tracks.push(req.url);
        mock.lastTrackAccept = req.headers.accept || '';
        const handler = mock.onTrack || ((u, send) => send(200, { statut: 'En cours' }));
        return handler(req.url, (status, body, opts = {}) => {
          if (opts.raw !== undefined) {
            res.writeHead(status, { 'Content-Type': 'text/plain' });
            return res.end(opts.raw);
          }
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        });
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  return new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
}

// ------------------------------------------------------------------ fixtures
const created = { orderIds: [], productIds: [], governorateIds: [], draftIds: [] };
let variant;

async function makeOrder(quantity = 1, governorate = 'Tunis') {
  _resetRateLimits();
  const res = await request('/orders', {
    method: 'POST',
    body: {
      customer: { name: 'Test Client', phone: '12345678', address: '12 Rue Test', governorate },
      items: [{ variantId: variant.id, quantity }],
    },
  });
  if (res.status !== 201) throw new Error(`order creation failed: ${res.status} ${JSON.stringify(res.data)}`);
  created.orderIds.push(res.data.id);
  return res.data;
}

async function deliveryRow(orderId) {
  const [row] = await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, orderId));
  return row || null;
}

async function orderRow(orderId) {
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
  return row;
}

async function stockOf(variantId) {
  const [row] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
  return row.stock;
}

async function confirm(orderId) {
  _resetRateLimits();
  return request(`/orders/${orderId}/confirm`, { method: 'POST', token: adminToken });
}

function webhook(body, authHeader) {
  _resetRateLimits();
  return request('/webhooks/goodex', {
    method: 'POST',
    body,
    headers: authHeader === undefined ? {} : { Authorization: authHeader },
  });
}

// --------------------------------------------------------------------- tests
async function run() {
  const dbName = new URL(env.databaseUrl).pathname.slice(1);
  if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== '1') {
    throw new Error(`Refusing to run against database "${dbName}": use a dedicated test database (name containing "test")`);
  }
  await runOrderDeliveriesMigration(pool);
  await startMock();
  const mockHost = '127.0.0.1';

  const httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  BASE = `http://127.0.0.1:${httpServer.address().port}/api`;

  env.goodex.baseUrl = `http://${mockHost}:${mock.server.address().port}`;
  env.goodex.apiToken = API_TOKEN;
  env.goodex.userId = '9999';
  env.goodex.webhookSecret = WEBHOOK_SECRET;
  env.goodex.timeoutMs = 400;
  if (new URL(env.goodex.baseUrl).hostname !== '127.0.0.1') throw new Error('Refusing to run against a non-loopback GOODEX URL');

  let [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) {
    [admin] = await db.insert(users).values({
      email: `admin-goodex-${Date.now()}@silky.tn`, passwordHash: 'fakehash', fullName: 'Admin GOODEX', role: 'admin',
    }).returning();
  }
  adminToken = signAccessToken(admin);

  let [category] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!category) [category] = await db.insert(categories).values({ name: 'Femme', slug: 'femme' }).returning();

  const prodRes = await request('/products', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Produit GOODEX Test', description: 'd', collectionImage: '/pictures/collection.jpg',
      slug: `goodex-prod-${Date.now()}`, price: 100, category: category.slug, categoryId: category.id,
      colors: [{ id: 'noir', name: 'Noir', image: '/pictures/noir.jpg' }], sizes: ['M'], stock: { 'noir-M': 200 },
    },
  });
  created.productIds.push(prodRes.data.id);
  [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, prodRes.data.id));

  // ------------------------------------------------------------ 1. happy path
  console.log('\n[1] Parcel creation on confirmation');
  mock.reset();
  const o1 = await makeOrder(1);
  assert(mock.creates.length === 0, 'creating an order (pending) sends nothing to GOODEX');
  assert(await deliveryRow(o1.id) === null, 'no delivery row before confirmation');
  const stockBefore = await stockOf(variant.id);
  const subtotalBefore = (await orderRow(o1.id)).totalAmount;

  const c1 = await confirm(o1.id);
  assert(c1.status === 200 && c1.data.status === 'completed', 'confirmation succeeds');
  assert(mock.creates.length === 1, 'exactly one GOODEX create request');
  const f = mock.creates[0].fields;
  assert(mock.creates[0].contentType.startsWith('multipart/form-data'), 'request is multipart/form-data');
  assert(f.token === API_TOKEN && f.user_id === '9999', 'token and user_id come from env (not 2722)');
  assert(f.cod === '108.000', `cod equals total payable (108 = 100 + 8 fee): ${f.cod}`);
  assert(f.governorat === 'Tunis', 'governorat is the canonical saved name, sent unchanged');
  assert(f.gsm1 === '12345678' && f.client === 'Test Client' && f.adresse === '12 Rue Test', 'client/gsm1/adresse mapped');
  assert(f.last_statut === '12', 'last_statut=12 is sent (the live API answers 422 without it)');
  assert(/ x\d+/.test(f.remarque) && !('designation' in f), `remarque carries the product lines (name x quantity); designation is not sent (${f.remarque})`);
  const d1 = await deliveryRow(o1.id);
  assert(d1?.state === 'created' && d1.ean?.startsWith('EAN'), 'ean persisted on this order');
  assert(d1.goodexStatusId === 12 && d1.goodexStatus === 'En Attente' && c1.data.delivery?.statusLabel === 'En Attente', 'last_statut 12 from the create response stored as id 12 / "En Attente"');
  assert(c1.data.delivery?.ean === d1.ean && c1.data.delivery?.state === 'created', 'confirm response exposes delivery summary');
  assert(!JSON.stringify(c1.data).includes(API_TOKEN), 'API token never appears in responses');
  assert((await stockOf(variant.id)) === stockBefore, 'stock unchanged by confirmation');
  assert((await orderRow(o1.id)).totalAmount === subtotalBefore, 'order totals unchanged');

  // ------------------------------------------------------------ 2. duplicates
  console.log('\n[2] Duplicate / concurrent / bulk / PATCH confirmation');
  const again = await confirm(o1.id);
  assert(again.status === 200 && mock.creates.length === 1, 'confirming an already confirmed order sends nothing');

  const o2 = await makeOrder(1);
  const before = mock.creates.length;
  mock.onCreate = (r, send) => setTimeout(() => send(200, { ean: `EANCONC-${Date.now()}` }), 100);
  _resetRateLimits();
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    request(`/orders/${o2.id}/confirm`, { method: 'POST', token: adminToken })));
  assert(results.every((r) => r.status === 200), 'all 8 concurrent confirms return 200');
  assert(mock.creates.length - before === 1, 'exactly one GOODEX request for 8 concurrent confirms');
  const dupRows = await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, o2.id));
  assert(dupRows.length === 1 && dupRows[0].state === 'created', 'single delivery row, created');
  mock.onCreate = null;

  const o3 = await makeOrder(1);
  const o4 = await makeOrder(2);
  const b0 = mock.creates.length;
  _resetRateLimits();
  const bulk = await request('/orders/bulk-confirm', { method: 'POST', token: adminToken, body: { orderIds: [o3.id, o4.id, o3.id] } });
  assert(bulk.status === 200 && mock.creates.length - b0 === 2, 'bulk confirm creates one parcel per order (repeated id ignored)');
  const o4cod = mock.creates[mock.creates.length - 1].fields.cod;
  assert(o4cod === '208.000', `bulk: cod for 2 x 100 + 8 fee = 208.000 (${o4cod})`);
  assert(bulk.data.every((o) => o.delivery?.state === 'created'), 'bulk response includes delivery summaries');

  const o5 = await makeOrder(1);
  const p0 = mock.creates.length;
  _resetRateLimits();
  const patch = await request(`/orders/${o5.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'completed' } });
  assert(patch.status === 200 && mock.creates.length - p0 === 1, 'PATCH status=completed also creates exactly one parcel');

  // ------------------------------------------------------------ 3. failures
  console.log('\n[3] Failure handling');
  // saved address missing -> local validation failure, order stays confirmed, zero requests
  const o6 = await makeOrder(1);
  await db.update(orders).set({ shippingAddress: '   ' }).where(eq(orders.id, o6.id));
  const l0 = mock.creates.length;
  const c6 = await confirm(o6.id);
  const d6 = await deliveryRow(o6.id);
  assert(c6.status === 200 && c6.data.status === 'completed', 'confirmation still succeeds when GOODEX data is invalid');
  assert(d6.state === 'failed' && /Adresse manquante/.test(d6.lastError) && mock.creates.length === l0, 'invalid order data fails locally, zero requests');

  mock.onCreate = (r, send) => send(422, { message: 'adresse invalide' });
  const o7 = await makeOrder(1);
  await confirm(o7.id);
  assert((await deliveryRow(o7.id)).state === 'failed', '4xx -> failed (safe to retry)');
  mock.onCreate = null;
  _resetRateLimits();
  const retry7 = await request(`/orders/${o7.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(retry7.status === 200 && retry7.data.state === 'created', 'admin retry from failed creates the parcel');
  _resetRateLimits();
  const retry7b = await request(`/orders/${o7.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(retry7b.status === 409, 'retry when a parcel exists is refused');

  mock.onCreate = () => { /* never answers: client timeout */ };
  const o8 = await makeOrder(1);
  const t0 = mock.creates.length;
  await confirm(o8.id);
  const d8 = await deliveryRow(o8.id);
  assert(d8.state === 'unknown' && d8.ean === null, 'timeout -> unknown, no ean');
  const t1 = mock.creates.length;
  await confirm(o8.id);
  assert(mock.creates.length === t1 && t1 - t0 === 1, 'a second confirm never re-sends after an uncertain outcome');
  mock.onCreate = null;
  _resetRateLimits();
  const noAck = await request(`/orders/${o8.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(noAck.status === 409 && mock.creates.length === t1, 'retry from unknown needs acknowledgement (nothing sent)');
  _resetRateLimits();
  const ack = await request(`/orders/${o8.id}/delivery/retry`, { method: 'POST', token: adminToken, body: { acknowledgeUnknown: true } });
  assert(ack.status === 200 && ack.data.state === 'created' && mock.creates.length === t1 + 1, 'acknowledged retry sends once and succeeds');

  const malformed = [
    ['5xx', (r, send) => send(500, { error: 'boom' })],
    ['non-JSON 200', (r, send) => send(200, null, { raw: 'OK<html>' })],
    ['empty 200', (r, send) => send(200, null, { raw: '' })],
    ['200 without ean', (r, send) => send(200, { statut: 'ok' })],
    ['ean wrong type', (r, send) => send(200, { ean: 12345 })],
    ['ean with whitespace', (r, send) => send(200, { ean: 'AB CD' })],
    ['ean too long', (r, send) => send(200, { ean: 'X'.repeat(65) })],
    ['200 with error body', (r, send) => send(200, { error: 'Token invalide' })],
  ];
  for (const [label, handler] of malformed) {
    mock.onCreate = handler;
    const o = await makeOrder(1);
    await confirm(o.id);
    const d = await deliveryRow(o.id);
    assert(d.state === 'unknown' && d.ean === null, `malformed (${label}) -> unknown, no ean stored`);
  }
  mock.onCreate = null;

  // ------------------------------------------------------------ 4. link + tracking
  console.log('\n[4] Manual link and tracking');
  const o9 = await makeOrder(1);
  mock.onCreate = (r, send) => send(500, {});
  await confirm(o9.id);
  mock.onCreate = null;
  _resetRateLimits();
  const dupEan = await request(`/orders/${o9.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: d1.ean } });
  assert(dupEan.status === 409, 'linking an ean already used by another order is refused');
  _resetRateLimits();
  const linked = await request(`/orders/${o9.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: 'MANUAL/EAN 1'.replace(' ', '-') } });
  assert(linked.status === 200 && linked.data.state === 'created' && linked.data.ean === 'MANUAL/EAN-1', 'admin can link an existing ean');

  _resetRateLimits();
  mock.onTrack = (u, send) => send(200, { ean: 'MANUAL/EAN-1', statut: 'Livré', has_motif: false });
  const ref = await request(`/orders/${o9.id}/delivery/refresh`, { method: 'POST', token: adminToken });
  assert(ref.status === 200 && ref.data.goodexStatus === 'Livré' && ref.data.statusId === 2 && ref.data.statusLabel === 'Livré', 'refresh maps Livré -> id 2');
  assert(mock.tracks[0].includes('MANUAL%2FEAN-1') && mock.tracks[0].includes(`token=${API_TOKEN}`), 'ean is URL-encoded and token sent as query');
  assert((await orderRow(o9.id)).status === 'completed', 'Silky order status not changed by a delivered delivery status');

  _resetRateLimits();
  mock.onTrack = (u, send) => send(200, { statut: 'Colis Introuvable' });
  const nf = await request(`/orders/${o9.id}/delivery/refresh`, { method: 'POST', token: adminToken });
  assert(nf.status === 200 && nf.data.trackingNotFound === true && nf.data.statusId === 2 && nf.data.ean === 'MANUAL/EAN-1', 'Colis Introuvable handled explicitly, ean and last valid status kept');

  _resetRateLimits();
  mock.onTrack = (u, send) => send(200, { foo: 'bar' });
  const bad = await request(`/orders/${o9.id}/delivery/refresh`, { method: 'POST', token: adminToken });
  assert(bad.status === 502 && (await deliveryRow(o9.id)).goodexStatusId === 2, 'invalid tracking response -> 502, saved status untouched');

  mock.tracks = [];
  _resetRateLimits();
  mock.onTrack = (u, send) => (mock.tracks.length === 1 ? send(503, {}) : send(200, { statut: 'En cours' }));
  const retried = await request(`/orders/${o9.id}/delivery/refresh`, { method: 'POST', token: adminToken });
  assert(retried.status === 200 && mock.tracks.length === 2, 'tracking GET is retried once on 5xx');
  mock.onTrack = null;

  // ------------------------------------------------------------ 5. access control
  console.log('\n[5] Admin-only endpoints');
  const noAuth = await request(`/orders/${o9.id}/delivery`);
  assert(noAuth.status === 401, 'delivery endpoint rejects unauthenticated calls');
  const [customer] = await db.select().from(users).where(eq(users.role, 'customer')).limit(1);
  if (customer) {
    const custRes = await request(`/orders/${o9.id}/delivery`, { token: signAccessToken(customer) });
    assert(custRes.status === 403, 'delivery endpoint rejects non-admin users');
  }

  // ------------------------------------------------------------ 6. webhook
  console.log('\n[6] Webhook');
  const events = async (id) => (await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, id))).length;
  const wh = await deliveryRow(o1.id);
  const startEvents = await events(wh.id);
  const totalBefore = (await orderRow(o1.id)).totalAmount;

  assert((await webhook({ code: wh.ean, statut: 'Livré' })).status === 401, 'missing Authorization -> 401');
  assert((await webhook({ code: wh.ean, statut: 'Livré' }, 'Bearer wrong')).status === 401, 'wrong secret -> 401');
  assert((await webhook({ code: wh.ean, statut: 'Livré' }, `Bearer ${API_TOKEN}`)).status === 401, 'API token is not accepted as webhook secret');
  assert((await webhook({ code: wh.ean, statut: 'Livré' }, WEBHOOK_SECRET)).status === 401, 'non-Bearer scheme -> 401');
  assert((await deliveryRow(o1.id)).goodexStatus === 'En Attente', 'rejected webhooks change nothing');

  const authz = `Bearer ${WEBHOOK_SECRET}`;
  const testRes = await webhook({ test: true, code: wh.ean, statut: 'Livré' }, authz);
  assert(testRes.status === 200 && (await deliveryRow(o1.id)).goodexStatus === 'En Attente', 'test notification ignored');
  assert((await webhook({ statut: 'Livré' }, authz)).status === 400, 'missing code -> 400');
  assert((await webhook('nope', authz)).status === 400, 'non-object body -> 400');
  const unknownCode = await webhook({ code: 'DOES-NOT-EXIST', statut: 'Livré' }, authz);
  assert(unknownCode.status === 200 && unknownCode.data.result === 'unknown_code', 'unknown code acknowledged without change');

  const w1 = await webhook({ code: wh.ean, statut: 'Livré' }, authz);
  assert(w1.status === 200 && w1.data.result === 'updated', 'valid notification applied');
  let after = await deliveryRow(o1.id);
  assert(after.goodexStatus === 'Livré' && after.goodexStatusId === 2, 'status stored raw and mapped to its id');
  const w2 = await webhook({ code: wh.ean, statut: 'Livré' }, authz);
  assert(w2.data.result === 'duplicate' && (await events(wh.id)) === startEvents + 1, 'duplicate webhook is a no-op (one event)');
  const concurrent = await Promise.all(Array.from({ length: 5 }, () =>
    request('/webhooks/goodex', { method: 'POST', body: { code: wh.ean, statut: 'Livré' }, headers: { Authorization: authz } })));
  assert(concurrent.every((r) => r.status === 200) && (await events(wh.id)) === startEvents + 1, 'concurrent duplicate webhooks add no events');

  const pay = await webhook({ code: wh.ean, statut: 'Payé', motif: 'x' }, authz);
  after = await deliveryRow(o1.id);
  const orderAfter = await orderRow(o1.id);
  assert(pay.status === 200 && after.goodexStatusId === 8 && after.motif === 'x', 'Payé -> id 8 with motif');
  assert(orderAfter.status === 'completed' && orderAfter.totalAmount === totalBefore, 'Payé does not alter Silky order status or financial fields');
  await webhook({ code: wh.ean, statut: 'Statut Inconnu 42' }, authz);
  after = await deliveryRow(o1.id);
  assert(after.deliveryStatus === 'unknown' && after.goodexStatus === 'Statut Inconnu 42', 'unknown status keeps raw value, maps to unknown');

  env.goodex.webhookSecret = '';
  assert((await webhook({ code: wh.ean, statut: 'Livré' }, authz)).status === 503, 'unset webhook secret fails closed');
  env.goodex.webhookSecret = WEBHOOK_SECRET;

  // ------------------------------------------------------------ 7. governorates
  console.log('\n[7] Governorates');
  const dbGovs = await db.select().from(governorates);
  assert(CANONICAL_GOVERNORATES.length === 24, 'canonical list has 24 governorates');
  assert(CANONICAL_GOVERNORATES.every((g) => dbGovs.some((r) => r.id === g.id && r.name === g.name)),
    'governorates table rows equal the canonical list (id and exact name)');
  const okAll = CANONICAL_GOVERNORATES.every((g) =>
    resolveParcelGovernorate({ governorateId: g.id, governorate: { id: g.id, name: g.name, code: g.code } }).name === g.name);
  assert(okAll, 'all 24 canonical governorates validate and keep their exact name');
  assert(resolveParcelGovernorate({ governorate: { name: 'Tunis' } }).name === 'Tunis', 'name-only shape resolves against the canonical list');

  const invalidShapes = [
    ['no governorate at all', {}, /manquant/],
    ['null id and null object', { governorateId: null, governorate: null }, /manquant/],
    ['unknown id', { governorateId: 99, governorate: { id: 99, name: 'Atlantis' } }, /invalide/],
    ['unknown name only', { governorate: { name: 'Atlantis' } }, /invalide/],
    ['name does not belong to id', { governorateId: 1, governorate: { id: 1, name: 'Sfax' } }, /incohérent/],
    ['accented non-canonical spelling', { governorateId: 13, governorate: { id: 13, name: 'Béja' } }, /incohérent/],
  ];
  for (const [label, shape, pattern] of invalidShapes) {
    const r = resolveParcelGovernorate(shape);
    assert(!r.name && pattern.test(r.error || ''), `invalid governorate (${label}) -> local error: ${r.error}`);
  }

  mock.reset();
  const badGov = [];
  for (const g of CANONICAL_GOVERNORATES) {
    const og = await makeOrder(1, g.name);
    await confirm(og.id);
    const sent = mock.creates[mock.creates.length - 1]?.fields.governorat;
    const dg = await deliveryRow(og.id);
    if (sent !== g.name || dg?.state !== 'created') badGov.push(g.name);
  }
  assert(badGov.length === 0 && mock.creates.length === 24,
    `end to end: all 24 governorates create a parcel with the exact saved name (${badGov.join(', ') || 'none failed'})`);

  const [atlantis] = await db.insert(governorates).values({ name: 'Atlantis', code: 'XX-99' }).returning();
  created.governorateIds.push(atlantis.id);
  const oAtl = await makeOrder(1);
  await db.update(orders).set({ governorateId: atlantis.id }).where(eq(orders.id, oAtl.id));
  const atl0 = mock.creates.length;
  const cAtl = await confirm(oAtl.id);
  const dAtl = await deliveryRow(oAtl.id);
  assert(cAtl.status === 200 && dAtl.state === 'failed' && /Gouvernorat invalide : Atlantis/.test(dAtl.lastError) && mock.creates.length === atl0,
    `non-canonical saved governorate fails locally with a clear error, zero requests (${dAtl.lastError})`);
  assert(!/sélectionn|choisir|ressaisir/i.test(dAtl.lastError), 'the error never asks to select the governorate again');

  // ------------------------------------------------------------ 8. configuration
  console.log('\n[8] Missing configuration');
  assert(missingApiConfig().length === 0 && missingWebhookConfig().length === 0, 'fully configured -> nothing reported missing');
  const savedApi = { apiToken: env.goodex.apiToken, userId: env.goodex.userId };
  env.goodex.apiToken = '';
  const oCfg = await makeOrder(1);
  await db.update(orders).set({ shippingAddress: ' ' }).where(eq(orders.id, oCfg.id)); // also invalid business data
  const cfg0 = mock.creates.length;
  const cCfg = await confirm(oCfg.id);
  const dCfg = await deliveryRow(oCfg.id);
  assert(cCfg.status === 200 && cCfg.data.status === 'completed', 'confirmation succeeds without GOODEX credentials');
  assert(dCfg.state === 'failed' && /Configuration GOODEX incomplète : GOODEX_API_TOKEN/.test(dCfg.lastError) && !/Adresse/.test(dCfg.lastError) && mock.creates.length === cfg0,
    `missing token is reported as a configuration error (not a data error), zero requests: ${dCfg.lastError}`);
  env.goodex.userId = '';
  assert(missingApiConfig().join() === 'GOODEX_API_TOKEN,GOODEX_USER_ID', 'missingApiConfig lists variable names only');
  _resetRateLimits();
  const rCfg = await request(`/orders/${oCfg.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(rCfg.status === 200 && /GOODEX_API_TOKEN, GOODEX_USER_ID/.test(rCfg.data.lastError || ''), 'retry without credentials names both missing variables');
  _resetRateLimits();
  const refCfg = await request(`/orders/${o9.id}/delivery/refresh`, { method: 'POST', token: adminToken });
  assert(refCfg.status === 503 && /GOODEX_API_TOKEN/.test(refCfg.data.error), 'tracking without a token -> 503 configuration error');
  env.goodex.apiToken = savedApi.apiToken;
  env.goodex.userId = savedApi.userId;
  await db.update(orders).set({ shippingAddress: '12 Rue Test' }).where(eq(orders.id, oCfg.id));
  _resetRateLimits();
  const rCfg2 = await request(`/orders/${oCfg.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(rCfg2.status === 200 && rCfg2.data.state === 'created', 'once configured and data fixed, admin retry creates the parcel');

  // ------------------------------------------------------------ 9. client hardening
  console.log('\n[9] Create-parcel request and response handling');
  assert(JSON.stringify(Object.keys(f).sort()) === JSON.stringify(['adresse', 'client', 'cod', 'governorat', 'gsm1', 'last_statut', 'nbre', 'remarque', 'token', 'user_id']),
    `only documented fields are sent: ${Object.keys(f).sort().join(',')}`);
  assert(formatCod(108) === '108.000' && formatCod(10.5) === '10.500' && formatCod(0) === '0.000' && formatCod('abc') === '0.000', 'cod formatting (3 decimals, TND)');

  mock.onCreate = (r, send) => send(401, { message: 'Unauthorized' });
  const o401 = await makeOrder(1);
  await confirm(o401.id);
  const d401 = await deliveryRow(o401.id);
  assert(d401.state === 'failed' && /GOODEX_API_TOKEN/.test(d401.lastError), '401 -> failed with a hint to check credentials');

  mock.onCreate = (r, send) => send(400, { message: `rejected token ${API_TOKEN}` });
  const oEcho = await makeOrder(1);
  await confirm(oEcho.id);
  const dEcho = await deliveryRow(oEcho.id);
  assert(dEcho.state === 'failed' && !dEcho.lastError.includes(API_TOKEN) && dEcho.lastError.includes('***'), 'a token echoed by GOODEX is scrubbed from the stored error');

  mock.onCreate = (r, send, res) => { res.writeHead(302, { Location: '/api/v1/colis/create' }); res.end(); };
  const oRedir = await makeOrder(1);
  const redir0 = mock.creates.length;
  await confirm(oRedir.id);
  assert((await deliveryRow(oRedir.id)).state === 'unknown' && mock.creates.length - redir0 === 1, 'redirects are not followed (one request, outcome unknown)');

  mock.onCreate = (r, send) => send(200, { error: 'Token invalide', code: 12 });
  const oNoEan = await makeOrder(1);
  await confirm(oNoEan.id);
  const dNoEan = await deliveryRow(oNoEan.id);
  assert(dNoEan.state === 'unknown' && /Token invalide/.test(dNoEan.lastError) && /clés : error, code/.test(dNoEan.lastError), `200 without ean keeps a diagnosable, secret-free message: ${dNoEan.lastError}`);
  mock.onCreate = null;

  // ------------------------------------------------------------ 10. lifecycle
  console.log('\n[10] Lifecycle, transactions, concurrency');
  const control = await pool.connect();
  await control.query('BEGIN');
  const idleCount = async () => (await pool.query(
    "select count(*)::int n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'")).rows[0].n;
  assert((await idleCount()) >= 1, 'control: the detector sees an open transaction');
  await control.query('ROLLBACK');
  control.release();
  let idleDuringRequest = null;
  mock.onCreate = async (r, send) => { idleDuringRequest = await idleCount(); send(200, { ean: `EANTX-${Date.now()}` }); };
  const oTx = await makeOrder(1);
  await confirm(oTx.id);
  assert(idleDuringRequest === 0, `no database transaction is open while the GOODEX request is in flight (open: ${idleDuringRequest})`);
  mock.onCreate = null;

  const g0 = mock.creates.length;
  _resetRateLimits();
  const draftBody = { customerName: 'Draft Client', phoneNumber: '22334455', governorate: 'Sfax', shippingAddress: '1 Rue Draft', deliveryFee: 8, items: [{ variantId: variant.id, quantity: 1 }] };
  const dr = await request('/admin/drafts', { method: 'POST', token: adminToken, body: draftBody });
  created.draftIds.push(dr.data?.id);
  _resetRateLimits();
  const drc = await request(`/admin/drafts/${dr.data?.id}/confirm`, { method: 'POST', token: adminToken });
  if (drc.data?.id) created.orderIds.push(drc.data.id);
  assert(dr.status === 201 && drc.status === 201 && drc.data.status === 'pending', `draft conversion yields a pending order (draft ${dr.status}, confirm ${drc.status})`);
  assert(mock.creates.length === g0 && (await deliveryRow(drc.data.id)) === null, 'draft conversion sends nothing to GOODEX and creates no delivery row');
  await confirm(drc.data.id);
  assert(mock.creates.length === g0 + 1 && mock.creates[g0].fields.governorat === 'Sfax', 'confirming the converted order creates exactly one parcel with its saved governorate');

  // remote success but local persistence failure
  const realMarkCreated = deliveryRepository.markCreated;
  let markCalls = 0;
  deliveryRepository.markCreated = async () => { markCalls++; throw new Error('simulated database failure'); };
  mock.onCreate = (r, send) => send(200, { ean: 'EANPERSIST-1' });
  const oPer = await makeOrder(1);
  const per0 = mock.creates.length;
  const cPer = await confirm(oPer.id);
  deliveryRepository.markCreated = realMarkCreated;
  mock.onCreate = null;
  const dPer = await deliveryRow(oPer.id);
  assert(cPer.status === 200 && cPer.data.status === 'completed', 'order stays confirmed when persisting the ean fails');
  assert(dPer.state === 'unknown' && dPer.ean === null && /EANPERSIST-1/.test(dPer.lastError) && /non enregistré/.test(dPer.lastError), `persist failure -> unknown with the ean preserved in lastError: ${dPer.lastError}`);
  assert(markCalls === 3 && mock.creates.length - per0 === 1, 'persist retried locally 3 times; GOODEX POST sent exactly once');
  await confirm(oPer.id);
  assert(mock.creates.length - per0 === 1, 'a later confirm does not re-send');
  _resetRateLimits();
  const linkPer = await request(`/orders/${oPer.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: 'EANPERSIST-1' } });
  assert(linkPer.status === 200 && linkPer.data.state === 'created' && linkPer.data.ean === 'EANPERSIST-1', 'admin links the preserved ean to recover');

  // concurrency on retry paths
  mock.onCreate = (r, send) => send(422, { message: 'adresse invalide' });
  const oRf = await makeOrder(1);
  await confirm(oRf.id);
  mock.onCreate = (r, send) => setTimeout(() => send(200, { ean: `EANRETRY-${Date.now()}` }), 100);
  const rf0 = mock.creates.length;
  _resetRateLimits();
  const retries = await Promise.all(Array.from({ length: 6 }, () =>
    request(`/orders/${oRf.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} })));
  assert(mock.creates.length - rf0 === 1, `6 concurrent retries of a failed parcel send exactly one request (statuses: ${retries.map((r) => r.status).join(',')})`);
  assert(retries.filter((r) => r.status === 200).length >= 1 && retries.every((r) => r.status === 200 || r.status === 409), 'losers get 409 or the finished row, never an error');
  assert((await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, oRf.id))).length === 1, 'still a single delivery row');

  mock.onCreate = (r, send) => setTimeout(() => send(200, { ean: `EANINFLIGHT-${Date.now()}` }), 250);
  const oIn = await makeOrder(1);
  const in0 = mock.creates.length;
  _resetRateLimits();
  const inflight = request(`/orders/${oIn.id}/confirm`, { method: 'POST', token: adminToken });
  for (let i = 0; i < 100 && (await deliveryRow(oIn.id))?.state !== 'creating'; i += 1) await new Promise((r) => setTimeout(r, 20));
  _resetRateLimits();
  const midRetry = await request(`/orders/${oIn.id}/delivery/retry`, { method: 'POST', token: adminToken, body: { acknowledgeUnknown: true } });
  await inflight;
  assert(midRetry.status === 409 && mock.creates.length - in0 === 1, 'retry while creation is in flight is refused (409), one request total');

  mock.onCreate = () => { /* timeout */ };
  const oUn = await makeOrder(1);
  await confirm(oUn.id);
  assert((await deliveryRow(oUn.id)).state === 'unknown', 'setup: timeout leaves state unknown');
  mock.onCreate = (r, send) => setTimeout(() => send(200, { ean: `EANACK-${Date.now()}` }), 100);
  const un0 = mock.creates.length;
  _resetRateLimits();
  const acks = await Promise.all(Array.from({ length: 4 }, () =>
    request(`/orders/${oUn.id}/delivery/retry`, { method: 'POST', token: adminToken, body: { acknowledgeUnknown: true } })));
  assert(mock.creates.length - un0 === 1, `4 concurrent acknowledged retries from unknown send exactly one request (statuses: ${acks.map((r) => r.status).join(',')})`);
  mock.onCreate = null;

  // abandoned claim -> unknown on read; confirmed order whose process died before the POST
  const oStale = await makeOrder(1);
  await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, oStale.id));
  await db.insert(orderDeliveries).values({ orderId: oStale.id, state: 'creating', claimedAt: new Date(Date.now() - 5 * 60 * 1000), attemptCount: 1 });
  _resetRateLimits();
  const staleRead = await request(`/orders/${oStale.id}/delivery`, { token: adminToken });
  assert(staleRead.data.state === 'unknown' && /interrompue/.test(staleRead.data.lastError), 'a claim abandoned for minutes is surfaced as unknown (never auto-resent)');

  const oCrash = await makeOrder(1);
  await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, oCrash.id));
  const cr0 = mock.creates.length;
  await confirm(oCrash.id);
  assert(mock.creates.length === cr0 && (await deliveryRow(oCrash.id)) === null, 'confirming an already-confirmed order never creates a parcel implicitly');
  _resetRateLimits();
  const crashRetry = await request(`/orders/${oCrash.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(crashRetry.status === 200 && crashRetry.data.state === 'created' && mock.creates.length === cr0 + 1, 'explicit admin retry covers a confirmed order that has no delivery row');

  const oPend = await makeOrder(1);
  _resetRateLimits();
  const pendRetry = await request(`/orders/${oPend.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(pendRetry.status === 400, 'retry on an unconfirmed order is refused');

  // ------------------------------------------------------------ 11. webhook edge cases
  console.log('\n[11] Webhook edge cases');
  assert((await webhook({ test: true }, undefined)).status === 401, 'test notifications are authenticated too (401 without the secret)');
  const rawPost = (raw, auth = authz) => {
    _resetRateLimits();
    return fetch(`${BASE}/webhooks/goodex`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: raw });
  };
  const badJson = await rawPost('{"code": "x", ');
  assert(badJson.status === 400, 'malformed JSON -> 400');
  assert((await webhook([{ code: 'x', statut: 'y' }], authz)).status === 400, 'array body -> 400');
  assert((await webhook({ code: 'x'.repeat(65), statut: 'Livré' }, authz)).status === 400, 'overlong code -> 400');
  assert((await webhook({ code: wh.ean, statut: { id: 2 } }, authz)).status === 400, 'object statut -> 400');

  mock.onCreate = (r, send) => send(500, {});
  const oNum = await makeOrder(1);
  await confirm(oNum.id);
  mock.onCreate = null;
  _resetRateLimits();
  await request(`/orders/${oNum.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: '1234567890123' } });
  const numRes = await webhook({ code: 1234567890123, statut: 'En cours' }, authz);
  assert(numRes.status === 200 && numRes.data.result === 'updated' && (await deliveryRow(oNum.id)).goodexStatus === 'En cours', 'numeric code is accepted and matched as text');

  const realFind = deliveryRepository.findByEan;
  deliveryRepository.findByEan = async () => { throw new Error('simulated transient database failure'); };
  const dbFail = await webhook({ code: '1234567890123', statut: 'Livré' }, authz);
  deliveryRepository.findByEan = realFind;
  assert(dbFail.status === 500 && (await deliveryRow(oNum.id)).goodexStatus === 'En cours', 'transient database failure -> 500 (provider may retry), nothing changed');
  const redelivered = await webhook({ code: '1234567890123', statut: 'Livré' }, authz);
  assert(redelivered.status === 200 && redelivered.data.result === 'updated', 'the retried delivery of the same notification is then applied');

  // poll started before a webhook must not overwrite it; a later poll may
  await webhook({ code: '1234567890123', statut: 'En cours' }, authz);
  mock.onTrack = async (u, send) => { await webhook({ code: '1234567890123', statut: 'Livré' }, authz); send(200, { statut: 'En cours' }); };
  _resetRateLimits();
  const raced = await request(`/orders/${oNum.id}/delivery/refresh`, { method: 'POST', token: adminToken });
  assert(raced.status === 200 && raced.data.goodexStatus === 'Livré', 'stale poll that overlapped a newer webhook does not overwrite it');
  mock.onTrack = (u, send) => send(200, { statut: 'En cours' });
  _resetRateLimits();
  const later = await request(`/orders/${oNum.id}/delivery/refresh`, { method: 'POST', token: adminToken });
  assert(later.data.goodexStatus === 'En cours', 'a poll that starts after the last webhook is applied normally');
  mock.onTrack = null;

  // ------------------------------------------------------------ 12. status ids, motif, tracking, search
  console.log('\n[12] Status ids, motif, tracking behaviour, EAN search');
  {
    const expectedLabels = ['EN COURS', 'Livré', 'En Depot', 'En Transit', 'Enleve', 'Retour', 'Exception', 'Payé', 'Préparation Retour',
      'NON REÇUE', 'Retour Payé', 'En Attente', 'Préparation Livraison', 'Dispatch', 'Prep Paiement', 'Err Sync', 'Retour Recu Magasin',
      'Verification', 'Echange', 'Livré Provisoirement'];
    assert(GOODEX_STATUSES.length === 20 && GOODEX_STATUSES.every((st, i) => st.id === i + 1 && st.label === expectedLabels[i]),
      'official list: 20 statuses, ids 1..20, labels exactly as supplied');
    assert(GOODEX_STATUSES.every((st) => resolveGoodexStatus(st.id)?.label === st.label
      && resolveGoodexStatus(st.label)?.id === st.id && resolveGoodexStatus(String(st.id))?.id === st.id),
    'every official id, id string and label resolves to itself');
    assert(resolveGoodexStatus('Retour').id === 6 && resolveGoodexStatus('Retour Payé').id === 11
      && resolveGoodexStatus('livre provisoirement').id === 20 && resolveGoodexStatus('Livré').id === 2,
    'similar labels are never confused (Retour / Retour Payé, Livré / Livré Provisoirement)');
    const unrecognized = [0, 21, 99, '0', 'Livré!', 'Statut X', 'Livre Definitivement', 'Colis Introuvable'];
    assert(unrecognized.every((v) => {
      const r = resolveGoodexStatus(v);
      return r && r.id === null && r.label === null && r.raw === String(v);
    }), 'unrecognized values keep their raw text and get no id and no label');
    assert(resolveGoodexStatus('') === null && resolveGoodexStatus(null) === null && resolveGoodexStatus(undefined) === null, 'empty status -> null');

    // ---- POST response: last_statut stored, never invented
    const stamp = Date.now();
    const variants = [
      ['last_statut 12 (number)', { ean: `LSA-${stamp}`, last_statut: 12 }, 12, 'En Attente'],
      ['last_statut "12" (string)', { ean: `LSB-${stamp}`, last_statut: '12' }, 12, 'En Attente'],
      ['last_statut absent', { ean: `LSD-${stamp}` }, null, null],
      ['unknown last_statut 99', { ean: `LSE-${stamp}`, last_statut: 99 }, null, '99'],
    ];
    for (const [label, body, id, raw] of variants) {
      mock.onCreate = (r, send) => send(200, body);
      const ov = await makeOrder(1);
      await confirm(ov.id);
      const dv = await deliveryRow(ov.id);
      assert(dv.state === 'created' && dv.goodexStatusId === id && dv.goodexStatus === raw, `create response (${label}) -> id ${id}, stored "${raw}"`);
    }
    mock.onCreate = null;

    const oS = await makeOrder(1);
    await confirm(oS.id);
    const dS = await deliveryRow(oS.id);
    _resetRateLimits();
    const pubS = await request(`/orders/${oS.id}/delivery`, { token: adminToken });
    assert(dS.goodexStatusId === 12 && pubS.data.statusId === 12 && pubS.data.statusLabel === 'En Attente' && pubS.data.state === 'created',
      'after creation: stored id 12, displayed as "En Attente" (state created)');
    const createEvents = await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, dS.id));
    assert(createEvents.length === 1 && createEvents[0].source === 'create' && createEvents[0].goodexStatusId === 12, 'creation event records the initial status id');
    const dupInitial = await webhook({ code: dS.ean, statut: 'En Attente' }, authz);
    assert(dupInitial.data.result === 'duplicate', 'a webhook repeating the initial status (text) is a duplicate of the stored id');
    const unrecognizedPub = (await request(`/orders/${(await db.select().from(orderDeliveries).where(eq(orderDeliveries.ean, `LSE-${stamp}`)))[0].orderId}/delivery`, { token: adminToken })).data;
    assert(unrecognizedPub.statusLabel === null && unrecognizedPub.statusId === null && unrecognizedPub.goodexStatus === '99',
      'unrecognized initial status: no label shown, raw value kept for diagnosis');

    // ---- GET tracking: every official label maps to its id
    const setTrack = (payload) => { mock.onTrack = (u, send) => send(200, payload); };
    const refresh = async (id, body = {}) => {
      _resetRateLimits();
      return request(`/orders/${id}/delivery/refresh`, { method: 'POST', token: adminToken, body });
    };
    const badMaps = [];
    for (const st of GOODEX_STATUSES) {
      setTrack({ statut: st.label });
      const r = await refresh(oS.id);
      if (!(r.status === 200 && r.data.statusId === st.id && r.data.statusLabel === st.label && r.data.deliveryStatus === `status_${st.id}`)) badMaps.push(st.label);
    }
    assert(badMaps.length === 0, `GET: all 20 official labels map to their ids (${badMaps.join(', ') || 'none wrong'})`);
    setTrack({ statut: 7 });
    const numericGet = await refresh(oS.id);
    assert(numericGet.data.statusId === 7 && numericGet.data.statusLabel === 'Exception', 'GET: an integer statut is read as the official id');
    setTrack({ statut: 'Foo Bar' });
    const fooGet = await refresh(oS.id);
    assert(fooGet.status === 200 && fooGet.data.statusId === null && fooGet.data.statusLabel === null && fooGet.data.goodexStatus === 'Foo Bar' && fooGet.data.deliveryStatus === 'unknown',
      'GET: unknown status kept raw, no id, no label, no crash');
    const rawStatuses = (await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, dS.id))).map((e) => e.goodexStatus);
    assert(rawStatuses.includes('Foo Bar'), 'unknown status is also kept in the event history');

    // ---- webhook statuses
    const whRetourPaye = await webhook({ code: dS.ean, statut: 'Retour Payé' }, authz);
    let cur = await deliveryRow(oS.id);
    assert(whRetourPaye.data.result === 'updated' && cur.goodexStatusId === 11, 'webhook: "Retour Payé" -> id 11');
    await webhook({ code: dS.ean, statut: 6 }, authz);
    cur = await deliveryRow(oS.id);
    assert(cur.goodexStatusId === 6 && cur.goodexStatus === 'Retour', 'webhook: integer statut 6 -> "Retour"');
    const whUnknown = await webhook({ code: dS.ean, statut: 'XYZ inconnu' }, authz);
    cur = await deliveryRow(oS.id);
    assert(whUnknown.status === 200 && cur.goodexStatusId === null && cur.goodexStatus === 'XYZ inconnu' && cur.deliveryStatus === 'unknown', 'webhook: unrecognized status stored raw without id');

    // ---- motif: never erased by omission
    await webhook({ code: dS.ean, statut: 'Exception', motif: 'Client injoignable' }, authz);
    cur = await deliveryRow(oS.id);
    assert(cur.motif === 'Client injoignable' && cur.motifUpdatedAt && cur.goodexStatusId === 7, 'webhook: motif stored with its reception time');
    await webhook({ code: dS.ean, statut: 'Dispatch' }, authz);
    cur = await deliveryRow(oS.id);
    assert(cur.goodexStatusId === 14 && cur.motif === 'Client injoignable', 'webhook without motif keeps the stored reason');
    const emptyMotif = await webhook({ code: dS.ean, statut: 'Dispatch', motif: '   ' }, authz);
    assert(emptyMotif.data.result === 'duplicate' && (await deliveryRow(oS.id)).motif === 'Client injoignable', 'blank motif is ignored (duplicate, reason kept)');
    setTrack({ statut: 'Dispatch', has_motif: false, motif: '' });
    await refresh(oS.id);
    assert((await deliveryRow(oS.id)).motif === 'Client injoignable' && (await deliveryRow(oS.id)).hasMotif === false, 'GET with has_motif=false and empty motif does not clear the reason (incident hidden via the flag)');
    setTrack({ statut: 'Dispatch', has_motif: false, motif: 'texte périmé' });
    await refresh(oS.id);
    assert((await deliveryRow(oS.id)).motif === 'Client injoignable', 'GET with has_motif=false never stores the accompanying text');
    setTrack({ statut: 'Dispatch', has_motif: 1, motif: '   ' });
    await refresh(oS.id);
    assert((await deliveryRow(oS.id)).motif === 'Client injoignable' && (await deliveryRow(oS.id)).hasMotif === true, 'GET with has_motif=1 and a whitespace-only motif keeps the stored reason (incident shown)');
    setTrack({ statut: 'Dispatch', has_motif: true, motif: 'Adresse erronée' });
    const motifGet = await refresh(oS.id);
    assert(motifGet.data.motif === 'Adresse erronée' && (await deliveryRow(oS.id)).motif === 'Adresse erronée', 'GET with a new non-empty motif replaces the old one');
    const longMotif = await webhook({ code: dS.ean, statut: 'Dispatch', motif: 'x'.repeat(1500) }, authz);
    assert(longMotif.status === 200 && (await deliveryRow(oS.id)).motif.length === 1000, 'overlong motif is truncated to 1000 characters');
    const evBefore = (await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, dS.id))).length;
    await webhook({ code: dS.ean, statut: 'Dispatch', motif: 'x'.repeat(1500) }, authz);
    assert((await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, dS.id))).length === evBefore, 'repeating the same status and motif creates no new event');
    const orderStatusSnapshot = (await orderRow(oS.id)).status;
    assert(orderStatusSnapshot === 'completed', 'Silky order status unchanged by all GOODEX statuses so far');

    // ---- Colis Introuvable is kept apart from the saved status
    await webhook({ code: dS.ean, statut: 'Livré' }, authz);
    const evNf0 = (await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, dS.id))).length;
    setTrack({ statut: 'Colis Introuvable' });
    const nf1 = await refresh(oS.id);
    assert(nf1.status === 200 && nf1.data.trackingNotFound === true && nf1.data.statusId === 2 && nf1.data.statusLabel === 'Livré', 'Colis Introuvable: flagged, last valid status (Livré) preserved');
    setTrack({ statut: 'COLIS INTROUVABLE' });
    await refresh(oS.id);
    assert((await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, dS.id))).length === evNf0 + 1, 'repeated Colis Introuvable adds a single history event');
    setTrack({ statut: 'Livré' });
    const nf2 = await refresh(oS.id);
    assert(nf2.data.trackingNotFound === false && nf2.data.statusId === 2, 'a later successful answer clears the not-found flag');

    // ---- tracking errors never overwrite the saved data
    const before = await deliveryRow(oS.id);
    mock.onTrack = (u, send) => send(500, {});
    const err500 = await refresh(oS.id);
    mock.onTrack = (u, send) => send(200, { statut: '' });
    const errEmpty = await refresh(oS.id);
    mock.onTrack = (u, send) => send(200, { statut: 'Retour', ean: 'AUTRE-COLIS' });
    const errOther = await refresh(oS.id);
    mock.onTrack = (u, send) => send(200, null, { raw: '<html>oops</html>' });
    const errHtml = await refresh(oS.id);
    const afterErr = await deliveryRow(oS.id);
    assert([err500, errEmpty, errOther, errHtml].every((r) => r.status === 502), 'tracking errors (5xx, empty status, other parcel, non-JSON) -> 502 with a message');
    assert(afterErr.goodexStatusId === before.goodexStatusId && afterErr.goodexStatus === before.goodexStatus && afterErr.motif === before.motif
      && String(afterErr.statusUpdatedAt) === String(before.statusUpdatedAt) && !afterErr.trackingNotFoundAt, 'a failed or invalid answer leaves the saved status untouched');

    // ---- refresh behaviour: DB-only list, cooldown on opening details, explicit refresh always calls
    mock.tracks = [];
    setTrack({ statut: 'Livré' });
    _resetRateLimits();
    const listRes = await request('/orders', { token: adminToken });
    assert(listRes.status === 200 && mock.tracks.length === 0, 'loading the orders list never calls GOODEX');
    const listed = listRes.data.find((o) => o.id === oS.id);
    assert(listed.delivery?.ean === dS.ean && listed.delivery.statusLabel === 'Livré', 'the list carries the saved delivery data (ean, status label)');
    await refresh(oS.id);
    assert(mock.tracks.length === 1, 'explicit refresh calls GOODEX');
    const skipped = await refresh(oS.id, { onlyIfStale: true });
    assert(skipped.status === 200 && skipped.data.refreshSkipped === true && mock.tracks.length === 1, 'opening details within the cooldown does not call GOODEX');
    const longAgo = new Date(Date.now() - 20 * 60 * 1000);
    await db.update(orderDeliveries).set({ lastPolledAt: longAgo, lastWebhookAt: longAgo, statusUpdatedAt: longAgo }).where(eq(orderDeliveries.id, dS.id));
    const stale = await refresh(oS.id, { onlyIfStale: true });
    assert(stale.data.refreshSkipped === false && mock.tracks.length === 2, 'stale data (older than the cooldown) is refreshed when details are opened');
    const noParcel = await refresh(oPend.id, { onlyIfStale: true });
    assert(noParcel.status === 404, 'refresh on an order without a parcel -> 404');

    // ---- EAN search (the exact function the admin page uses)
    const oSearch = listed;
    const ean = oSearch.delivery.ean;
    assert(orderMatchesSearch(oSearch, ean), 'search: full EAN matches');
    assert(orderMatchesSearch(oSearch, ean.slice(2, 8)) && orderMatchesSearch(oSearch, ean.slice(-4)), 'search: partial EAN (middle, suffix) matches');
    assert(orderMatchesSearch(oSearch, ean.toUpperCase()) && orderMatchesSearch(oSearch, `  ${ean.toLowerCase()}  `), 'search: EAN is case-insensitive and trimmed');
    assert(orderMatchesSearch(oSearch, oSearch.orderNumber.slice(-5)) && orderMatchesSearch(oSearch, oSearch.customer.phone)
      && orderMatchesSearch(oSearch, 'test cli') && orderMatchesSearch(oSearch, oSearch.id.slice(0, 8)), 'search: order number, phone, name and id still work');
    assert(!orderMatchesSearch(oSearch, 'zzz-no-match') && orderMatchesSearch(oSearch, '') && orderMatchesSearch(oSearch, '   '), 'search: no false positive; empty query matches all');
    const pendingListed = listRes.data.find((o) => o.id === oPend.id);
    assert(pendingListed.delivery === null && !orderMatchesSearch(pendingListed, ean) && orderMatchesSearch(pendingListed, pendingListed.orderNumber), 'search: orders without a parcel do not break and do not match an EAN');
    const otherListed = listRes.data.find((o) => o.delivery?.ean && o.id !== oS.id);
    assert(otherListed && !orderMatchesSearch(otherListed, ean), 'search: another order does not match this EAN');

    // ---- creation states stay distinguishable through the API
    const oNoRow = await makeOrder(1);
    await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, oNoRow.id));
    _resetRateLimits();
    const noRowOrder = (await request(`/orders/${oNoRow.id}`, { token: adminToken })).data;
    assert(noRowOrder.delivery === null, 'confirmed order never submitted: delivery is null ("Aucun colis")');
    const failedPub = (await request(`/orders/${oAtl.id}/delivery`, { token: adminToken })).data;
    assert(failedPub.state === 'failed' && failedPub.statusLabel === null && failedPub.ean === null, 'failed creation: no status label, no ean');
    const unknownPub = (await request(`/orders/${oUn.id}/delivery`, { token: adminToken })).data;
    assert(['unknown', 'created'].includes(unknownPub.state), 'uncertain creation exposes its own state (recovered to created by the acknowledged retry in [10])');
    mock.onTrack = null;
  }


  // ---- Deliver / refund are held back while GOODEX has no parcel for an order that tried
  console.log('\n[13] Deliver / refund wait for the GOODEX parcel (server-side guard)');
  {
    const attempt = async (path, method = 'POST') => { _resetRateLimits(); return request(path, { method, token: adminToken }); };
    const blockedFlow = async (label, prepare, recover) => {
      const o = await makeOrder(1);
      await prepare(o);
      const before = await deliveryRow(o.id);
      const del = await attempt(`/orders/${o.id}/deliver`);
      const ref = await attempt(`/orders/${o.id}/refund`);
      assert(del.status === 409 && /colis GOODEX/.test(del.data?.error || ''), `"Livrée" is refused (409) when the parcel is: ${label} (HTTP ${del.status})`);
      assert(ref.status === 409, `"Remboursement" is refused (409) when the parcel is: ${label} (HTTP ${ref.status})`);
      assert((await orderRow(o.id)).status === 'completed', `order stays confirmed after the refused actions (${label})`);
      assert(JSON.stringify(before) === JSON.stringify(await deliveryRow(o.id)), `refused actions leave the delivery record untouched (${label})`);
      _resetRateLimits();
      const retry = await request(`/orders/${o.id}/delivery/retry`, { method: 'POST', token: adminToken, body: recover });
      assert(retry.status === 200 && (await deliveryRow(o.id))?.state === 'created', `retry creates the parcel (${label})`);
      const ok = await attempt(`/orders/${o.id}/deliver`);
      assert(ok.status === 200 && (await orderRow(o.id)).status === 'delivered', `"Livrée" works once the parcel is created (${label}) (HTTP ${ok.status})`);
    };
    await blockedFlow('failed (no credentials)', async (o) => {
      const saved = env.goodex.apiToken;
      env.goodex.apiToken = '';
      await confirm(o.id);
      env.goodex.apiToken = saved;
    }, {});
    await blockedFlow('uncertain (timeout)', async (o) => {
      mock.onCreate = () => { /* never answers */ };
      await confirm(o.id);
      mock.onCreate = null;
    }, { acknowledgeUnknown: true });

    // Orders confirmed before GOODEX was connected have no parcel row and stay usable.
    const legacy = await makeOrder(1);
    await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, legacy.id));
    const legacyDeliver = await attempt(`/orders/${legacy.id}/deliver`);
    assert(legacyDeliver.status === 200 && (await deliveryRow(legacy.id)) === null, `"Livrée" works for an order with no parcel row (confirmed before GOODEX) (HTTP ${legacyDeliver.status})`);

    const okOrder = await makeOrder(1);
    await confirm(okOrder.id);
    const okDeliver = await attempt(`/orders/${okOrder.id}/deliver`);
    assert(okDeliver.status === 200 && (await orderRow(okOrder.id)).status === 'delivered', 'created parcel: "Livrée" works');

    // The same rule through the status endpoints (single and bulk).
    const viaStatus = await makeOrder(1);
    { const saved = env.goodex.apiToken; env.goodex.apiToken = ''; await confirm(viaStatus.id); env.goodex.apiToken = saved; }
    _resetRateLimits();
    const patch = await request(`/orders/${viaStatus.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'delivered' } });
    _resetRateLimits();
    const bulk = await request('/orders/bulk-status', { method: 'PATCH', token: adminToken, body: { orderIds: [viaStatus.id], status: 'delivered' } });
    assert(patch.status === 409 && bulk.status === 409 && (await orderRow(viaStatus.id)).status === 'completed', `PATCH status / bulk-status "delivered" are refused too (${patch.status}/${bulk.status})`);
  }

  // ---- has_motif decides whether an incident is displayed; not-found handling; receipt times
  console.log('\n[14] has_motif, incident rule, HTTP 404 lookups, receipt times');
  {
    const cases = [[true, true], [1, true], ['1', true], ['true', true], [' TRUE ', true],
      [false, false], [0, false], ['0', false], ['false', false], [' False ', false],
      [null, null], [undefined, null], ['', null], ['maybe', null], [2, null], [[], null], [{}, null]];
    const badParses = cases.filter(([input, expected]) => parseHasMotif(input) !== expected).map(([input]) => JSON.stringify(input));
    assert(badParses.length === 0, `has_motif parsing: booleans, 0/1 and string forms understood, anything else unknown (${badParses.join(', ') || 'all ok'})`);

    // A string payload is sent raw (empty body, HTML page); anything else as JSON.
    const setTrack = (payload, status = 200) => {
      mock.onTrack = (u, send) => (typeof payload === 'string' ? send(status, null, { raw: payload }) : send(status, payload));
    };
    const refresh = async (id) => { _resetRateLimits(); return request(`/orders/${id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} }); };
    const pub = async (id) => { _resetRateLimits(); return (await request(`/orders/${id}/delivery`, { token: adminToken })).data; };
    const pause = (ms = 25) => new Promise((r) => setTimeout(r, ms));

    const oI = await makeOrder(1);
    await confirm(oI.id);
    const dI = await deliveryRow(oI.id);
    let p = await pub(oI.id);
    assert(p.incident === false && p.hasMotif === null && p.motif === null, 'no reason received: no incident, has_motif unknown');

    await webhook({ code: dI.ean, statut: 'Exception', motif: 'Client injoignable' }, authz);
    p = await pub(oI.id);
    assert(p.incident === true && p.hasMotif === null && p.motif === 'Client injoignable', 'webhook reason (no flag in the payload) -> incident shown, flag unknown');

    setTrack({ ean: dI.ean, statut: 'Exception', has_motif: 0, motif: '' });
    await refresh(oI.id);
    p = await pub(oI.id);
    assert(p.hasMotif === false && p.incident === false && p.motif === 'Client injoignable', 'GET has_motif=0 -> incident hidden, stored text kept (not erased)');
    _resetRateLimits();
    const listed = (await request('/orders', { token: adminToken })).data.find((o) => o.id === oI.id);
    assert(listed.delivery.incident === false, 'the orders list carries the same incident decision (hidden)');

    const dupAfterFalse = await webhook({ code: dI.ean, statut: 'Exception' }, authz);
    p = await pub(oI.id);
    assert(dupAfterFalse.data.result === 'duplicate' && p.incident === false, 'a later webhook without a reason does not re-open the incident');

    await webhook({ code: dI.ean, statut: 'Exception', motif: 'Adresse introuvable' }, authz);
    p = await pub(oI.id);
    assert(p.incident === true && p.hasMotif === null && p.motif === 'Adresse introuvable', 'a new reason without a flag re-opens the incident with the new text');

    setTrack({ ean: dI.ean, statut: 'Exception', has_motif: 'false', motif: 'texte périmé' });
    await refresh(oI.id);
    p = await pub(oI.id);
    assert(p.hasMotif === false && p.incident === false && p.motif === 'Adresse introuvable', 'GET has_motif="false" (string) -> hidden, accompanying text not stored');

    setTrack({ ean: dI.ean, statut: 'Exception', has_motif: 1, motif: '' });
    await refresh(oI.id);
    p = await pub(oI.id);
    assert(p.hasMotif === true && p.incident === true && p.motif === 'Adresse introuvable', 'GET has_motif=1 -> incident shown with the stored reason');

    setTrack({ ean: dI.ean, statut: 'Exception', has_motif: 'peut-être', motif: '' });
    await refresh(oI.id);
    p = await pub(oI.id);
    assert(p.hasMotif === true && p.incident === true, 'an unrecognized has_motif value changes nothing (never guessed)');

    setTrack({ ean: dI.ean, statut: 'Exception', has_motif: true, motif: 'Colis refusé' });
    await refresh(oI.id);
    p = await pub(oI.id);
    assert(p.incident === true && p.motif === 'Colis refusé' && p.motifUpdatedAt, 'GET has_motif=true with text -> replaced and timestamped');

    // ---- Colis Introuvable via HTTP 404, inspecting code and body
    const eventsOf = async (id) => (await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, id))).length;
    const e0 = await eventsOf(dI.id);
    setTrack({ statut: 'Colis Introuvable' }, 404);
    let r = await refresh(oI.id);
    assert(r.status === 200 && r.data.trackingNotFound === true && r.data.goodexStatus === 'Exception', 'HTTP 404 + {"statut":"Colis Introuvable"} -> lookup result, saved status kept');
    setTrack('', 404);
    r = await refresh(oI.id);
    assert(r.status === 200 && r.data.trackingNotFound === true && (await eventsOf(dI.id)) === e0 + 1, 'HTTP 404 with an empty body -> lookup result (single history event)');
    setTrack({ message: 'Not found' }, 404);
    r = await refresh(oI.id);
    assert(r.status === 200 && r.data.trackingNotFound === true, 'HTTP 404 with a JSON body carrying no status -> lookup result');
    setTrack({ ean: dI.ean, statut: 'Exception' });
    r = await refresh(oI.id);
    assert(r.data.trackingNotFound === false, 'a normal answer clears the not-found flag');
    setTrack('<html><body>Not Found</body></html>', 404);
    r = await refresh(oI.id);
    assert(r.status === 502 && (await pub(oI.id)).trackingNotFound === false, 'HTTP 404 with an HTML error page stays a tracking error (502), nothing recorded');
    setTrack({ statut: 'Livré' }, 404);
    r = await refresh(oI.id);
    assert(r.status === 502 && (await pub(oI.id)).goodexStatus === 'Exception', 'HTTP 404 carrying a real status is an error, never applied');
    setTrack({ statut: 'Colis Introuvable' }, 200);
    r = await refresh(oI.id);
    assert(r.status === 200 && r.data.trackingNotFound === true, 'HTTP 200 + Colis Introuvable -> lookup result as well');

    // ---- receipt times: when a status was last received, apart from when it changed
    const oR = await makeOrder(1);
    await confirm(oR.id);
    const dR = await deliveryRow(oR.id);
    p = await pub(oR.id);
    const receivedAtCreate = p.statusReceivedAt;
    assert(receivedAtCreate && p.statusId === 12, 'creation records the receipt time of the initial status');
    await pause();
    setTrack({ ean: dR.ean, statut: 'En Attente' });
    await refresh(oR.id);
    p = await pub(oR.id);
    assert(new Date(p.statusReceivedAt) > new Date(receivedAtCreate) && String(p.statusUpdatedAt) === String(receivedAtCreate), 'an unchanged status still updates "received at" but not "changed at"');
    const receivedAfterPoll = p.statusReceivedAt;
    await pause();
    setTrack({ statut: 'Colis Introuvable' });
    await refresh(oR.id);
    p = await pub(oR.id);
    assert(String(p.statusReceivedAt) === String(receivedAfterPoll) && p.trackingNotFound === true, 'a not-found answer is not a status receipt');
    await pause();
    const dupWebhook = await webhook({ code: dR.ean, statut: 'En Attente' }, authz);
    p = await pub(oR.id);
    assert(dupWebhook.data.result === 'duplicate' && new Date(p.statusReceivedAt) > new Date(receivedAfterPoll) && p.lastWebhookAt, 'a duplicate webhook updates the receipt time and the webhook time');
    mock.onTrack = null;
  }

  // ---- the documented request/response contract (create + tracking)
  console.log('\n[15] Documented GOODEX contract: headers, 422, parcel id, strict response shape');
  {
    const stamp = Date.now();
    const pub = async (id) => { _resetRateLimits(); return (await request(`/orders/${id}/delivery`, { token: adminToken })).data; };

    // The create request: multipart, Accept: application/json, documented field names only.
    mock.reset();
    const oC = await makeOrder(2);
    await confirm(oC.id);
    const req = mock.creates[0];
    assert(req.accept === 'application/json', `create sends "Accept: application/json" (got "${req.accept}")`);
    assert(/^\d+\.\d{3}$/.test(req.fields.cod) && req.fields.cod === '208.000', `cod is a decimal dinar amount with 3 decimals: ${req.fields.cod}`);
    assert(/^\d+$/.test(req.fields.nbre) && req.fields.nbre === '2', `nbre is the number of items: ${req.fields.nbre}`);
    const documented = new Set(['token', 'user_id', 'last_statut', 'client', 'cod', 'adresse', 'governorat', 'gsm1', 'gsm2', 'designation', 'nbre', 'remarque', 'echange', 'decharge']);
    assert(Object.keys(req.fields).every((k) => documented.has(k)), 'only documented field names are sent');
    assert(['token', 'user_id', 'last_statut', 'client', 'cod', 'adresse', 'governorat', 'gsm1'].every((k) => req.fields[k]), 'all 8 required fields are present and non-empty');
    assert(!('echange' in req.fields) && !('decharge' in req.fields) && !('gsm2' in req.fields), 'optional echange/decharge/gsm2 are left to their documented defaults');

    // The documented success response, field for field.
    const documentedResponse = (ean) => ({
      id: 12345, ean, user_id: 564, client: 'Test test', cod: 40, adresse: 'Sahloul', governorat: 'Sousse', gsm1: '55899090', gsm2: '',
      designation: 'Produit', nbre: 1, last_statut: 12, echange: 0, decharge: 0, created_at: '2026-07-14 10:30:00',
    });
    mock.onCreate = (r, send) => send(200, documentedResponse(`YOUR_EAN-${stamp}`));
    const oD = await makeOrder(1);
    await confirm(oD.id);
    const dD = await deliveryRow(oD.id);
    const pD = await pub(oD.id);
    assert(dD.state === 'created' && dD.ean === `YOUR_EAN-${stamp}` && dD.goodexStatusId === 12 && pD.statusLabel === 'En Attente',
      'documented success response: ean saved, last_statut 12 -> "En Attente"');
    assert(dD.goodexParcelId === 12345 && dD.goodexCreatedAt === '2026-07-14 10:30:00' && pD.parcelId === 12345 && pD.goodexCreatedAt === '2026-07-14 10:30:00',
      'documented success response: GOODEX id and created_at saved and exposed');

    // id / created_at absent or odd must never break an otherwise valid creation.
    mock.onCreate = (r, send) => send(200, { ean: `NOID-${stamp}`, id: 'abc', created_at: 42, last_statut: 12 });
    const oN = await makeOrder(1);
    await confirm(oN.id);
    const dN = await deliveryRow(oN.id);
    assert(dN.state === 'created' && dN.goodexParcelId === null && dN.goodexCreatedAt === null, 'an odd id / created_at is ignored, creation still succeeds');
    mock.onCreate = (r, send) => send(200, { ean: `STRID-${stamp}`, id: '777', last_statut: 12 });
    const oS2 = await makeOrder(1);
    await confirm(oS2.id);
    assert((await deliveryRow(oS2.id)).goodexParcelId === 777, 'a numeric-string id is accepted');

    // Only the documented flat shape is read: nested layouts are not guessed.
    mock.onCreate = (r, send) => send(200, { data: { ean: `NESTED-${stamp}`, last_statut: 12 } });
    const oNest = await makeOrder(1);
    await confirm(oNest.id);
    const dNest = await deliveryRow(oNest.id);
    assert(dNest.state === 'unknown' && dNest.ean === null, 'an undocumented nested response is not guessed at (outcome unknown, no ean)');

    // The documented 422 body, verbatim, plus other error shapes.
    mock.onCreate = (r, send) => send(422, { governorat: ['The governorat field is required.'] });
    const o422 = await makeOrder(1);
    await confirm(o422.id);
    const d422 = await deliveryRow(o422.id);
    assert(d422.state === 'failed' && /HTTP 422/.test(d422.lastError) && /governorat : The governorat field is required\./.test(d422.lastError),
      `documented 422 body -> failed, readable cause kept: ${d422.lastError}`);
    mock.onCreate = (r, send) => send(422, { message: 'The given data was invalid.', errors: { gsm1: ['The gsm1 must be 8 digits.'], cod: ['The cod is invalid.', 'Too low.'] } });
    const o422b = await makeOrder(1);
    await confirm(o422b.id);
    const d422b = await deliveryRow(o422b.id);
    assert(d422b.state === 'failed' && /invalid/.test(d422b.lastError) && /gsm1 : The gsm1 must be 8 digits\./.test(d422b.lastError) && /cod : The cod is invalid\. Too low\./.test(d422b.lastError),
      'a {message, errors:{...}} body is flattened as well');
    mock.onCreate = (r, send) => send(401, { message: 'Unauthenticated.' });
    const o401b = await makeOrder(1);
    await confirm(o401b.id);
    const d401b = await deliveryRow(o401b.id);
    assert(d401b.state === 'failed' && /Unauthenticated/.test(d401b.lastError) && /GOODEX_API_TOKEN/.test(d401b.lastError), 'authentication error -> failed with a configuration hint');
    mock.onCreate = (r, send) => send(422, null, { raw: '<html>Unprocessable</html>' });
    const o422c = await makeOrder(1);
    await confirm(o422c.id);
    const d422c = await deliveryRow(o422c.id);
    assert(d422c.state === 'failed' && /HTTP 422/.test(d422c.lastError) && !/<html>/.test(d422c.lastError), 'a non-JSON error body never breaks handling and is not echoed');
    mock.onCreate = null;

    // The track request: documented URL, token in the query, Accept header, encoded ean.
    mock.tracks = [];
    mock.lastTrackAccept = null;
    mock.onTrack = (u, send) => send(200, { ean: dD.ean, statut: 'Livré', has_motif: 0, motif: '' });
    _resetRateLimits();
    const tr = await request(`/orders/${oD.id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} });
    assert(mock.lastTrackAccept === 'application/json', 'tracking sends "Accept: application/json"');
    assert(mock.tracks.length === 1 && mock.tracks[0] === `/api/v1/colis/etat/${encodeURIComponent(dD.ean)}?token=${encodeURIComponent(API_TOKEN)}`, 'tracking GET uses /api/v1/colis/etat/{ean}?token=...');
    assert(tr.status === 200 && tr.data.statusId === 2 && tr.data.hasMotif === false && tr.data.incident === false, 'the documented found-response (has_motif numeric 0, empty motif) is read correctly');
    mock.onTrack = null;
  }

  const leaks = logged.filter((line) => line.includes(API_TOKEN) || line.includes(WEBHOOK_SECRET));
  assert(leaks.length === 0, `no log line (tests + app) contains the API token or the webhook secret (${leaks.length} found)`);

  // webhook route must not issue a guest cookie
  const cookieRes = await fetch(`${BASE}/webhooks/goodex`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authz }, body: JSON.stringify({ test: true }) });
  assert(!cookieRes.headers.get('set-cookie'), 'webhook responses set no guest cookie');

  await new Promise((r) => httpServer.close(r));
  await new Promise((r) => mock.server.close(r));
}

async function cleanup() {
  try {
    const draftIds = created.draftIds.filter(Boolean);
    if (draftIds.length) await db.delete(drafts).where(inArray(drafts.id, draftIds));
    if (created.orderIds.length) await db.delete(orders).where(inArray(orders.id, created.orderIds));
    if (created.governorateIds.length) await db.delete(governorates).where(inArray(governorates.id, created.governorateIds));
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
