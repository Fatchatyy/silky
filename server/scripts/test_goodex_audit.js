/**
 * GOODEX integration audit tests: gaps left by test_goodex_delivery / _exchange / _claims.
 *
 * Everything runs against a LOCAL mock HTTP server (loopback only). No real GOODEX request is
 * ever made: the script refuses to run unless env.goodex.baseUrl is loopback and the database
 * name contains "test". It creates no real parcel, only rows in the test database, which it
 * removes at the end.
 *
 * Covers: admin authorization sweep over every delivery / claims / order-mutation route, page
 * loads sending zero GOODEX requests, tracking failures (401/403/429/5xx/network/malformed)
 * never touching the saved status, webhook edge cases (malformed JSON, oversize body, duplicate,
 * "Colis Introuvable", out-of-order arrival, response time, no outbound call), configuration
 * errors (missing user id), and customer data / secrets never reaching the logs.
 *
 * Usage: DATABASE_URL=postgres://.../silky_test node server/scripts/test_goodex_audit.js
 */
import http from 'http';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { db } from '../db/orm.js';
import { eq, inArray } from 'drizzle-orm';
import { products, productVariants, categories, orders, users, orderDeliveries, orderDeliveryEvents } from '../models/index.js';
import { _resetRateLimits } from '../middleware/rateLimiter.js';
import { signAccessToken } from '../services/token.service.js';
import { runOrderDeliveriesMigration } from '../db/migrations/add_order_deliveries.js';
import { pool } from '../db/pool.js';

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
let customerToken = '';
const API_TOKEN = 'audit-api-token-not-real';
const WEBHOOK_SECRET = 'audit-webhook-secret-not-real';
const authz = `Bearer ${WEBHOOK_SECRET}`;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed += 1;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed += 1;
  }
}

async function request(endpoint, { method = 'GET', body, token, headers: extra, raw } = {}) {
  _resetRateLimits();
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${endpoint}`, { method, headers, body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, text };
}

// ------------------------------------------------------------------ mock GOODEX
const mock = { server: null, requests: [], onCreate: null, onTrack: null };

function startMock() {
  mock.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      mock.requests.push(`${req.method} ${req.url.split('?')[0]}`);
      const send = (status, body, opts = {}) => {
        if (opts.raw !== undefined) { res.writeHead(status, { 'Content-Type': 'text/plain' }); return res.end(opts.raw); }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/api/v1/colis/create') {
        const handler = mock.onCreate || ((r, s) => s(200, { id: 700000 + mock.requests.length, ean: `AUD${mock.requests.length}-${Date.now()}`, last_statut: 12 }));
        return handler(null, send);
      }
      if (req.method === 'GET' && req.url.startsWith('/api/v1/colis/etat/')) {
        const handler = mock.onTrack || ((u, s) => s(200, { statut: 'En Transit', has_motif: 0, motif: '' }));
        return handler(req.url, send);
      }
      return send(404, {});
    });
  });
  return new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
}

// ------------------------------------------------------------------ fixtures
const created = { orderIds: [], productIds: [], userIds: [] };
let variant;

async function makeOrder(customerOverride = {}) {
  const res = await request('/orders', {
    method: 'POST',
    body: { customer: { name: 'Audit Client', phone: '12345678', address: '99 Avenue Audit', governorate: 'Tunis', ...customerOverride }, items: [{ variantId: variant.id, quantity: 1 }] },
  });
  if (res.status !== 201) throw new Error(`order creation failed: ${res.status} ${JSON.stringify(res.data)}`);
  created.orderIds.push(res.data.id);
  return res.data;
}
const confirm = (id) => request(`/orders/${id}/confirm`, { method: 'POST', token: adminToken });
const rowOf = async (orderId) => (await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, orderId)))[0] || null;
const eventsOf = async (rowId) => db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, rowId));
const webhook = (body, auth = authz, extra = {}) => request('/webhooks/goodex', { method: 'POST', body, headers: { ...(auth ? { Authorization: auth } : {}), ...extra } });

/** A confirmed order with a created parcel whose saved status is "En Transit" (id 4). */
async function parcelOrder() {
  const order = await makeOrder();
  await confirm(order.id);
  let row = await rowOf(order.id);
  if (row?.state !== 'created') throw new Error(`parcel not created: ${row?.state} ${row?.lastError}`);
  await db.update(orderDeliveries).set({ goodexStatus: 'En Transit', goodexStatusId: 4, deliveryStatus: 'status_4' }).where(eq(orderDeliveries.id, row.id));
  row = await rowOf(order.id);
  return { order, row };
}

async function run() {
  const dbName = new URL(env.databaseUrl).pathname.slice(1);
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run against database "${dbName}": a dedicated test database (name containing "test") is required`);
  await runOrderDeliveriesMigration(pool);
  await startMock();

  const httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  BASE = `http://127.0.0.1:${httpServer.address().port}/api`;

  env.goodex.baseUrl = `http://127.0.0.1:${mock.server.address().port}`;
  env.goodex.apiToken = API_TOKEN;
  env.goodex.userId = '9999';
  env.goodex.webhookSecret = WEBHOOK_SECRET;
  env.goodex.timeoutMs = 500;
  env.goodex.enableLive = false;
  if (new URL(env.goodex.baseUrl).hostname !== '127.0.0.1') throw new Error('Refusing to run against a non-loopback GOODEX URL');

  let [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) [admin] = await db.insert(users).values({ email: `admin-audit-${Date.now()}@silky.tn`, passwordHash: 'fakehash', fullName: 'Admin Audit', role: 'admin' }).returning();
  adminToken = signAccessToken(admin);
  const [customer] = await db.insert(users).values({ email: `customer-audit-${Date.now()}@silky.tn`, passwordHash: 'fakehash', fullName: 'Customer Audit', role: 'customer' }).returning();
  created.userIds.push(customer.id);
  customerToken = signAccessToken(customer);

  let [category] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!category) [category] = await db.insert(categories).values({ name: 'Femme', slug: 'femme' }).returning();
  const prod = await request('/products', {
    method: 'POST', token: adminToken,
    body: { name: 'Produit Audit', description: 'd', collectionImage: '/pictures/collection.jpg', slug: `audit-prod-${Date.now()}`, price: 100, category: category.slug, categoryId: category.id, colors: [{ id: 'noir', name: 'Noir', image: '/pictures/noir.jpg' }], sizes: ['M'], stock: { 'noir-M': 200 } },
  });
  created.productIds.push(prod.data.id);
  [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, prod.data.id));

  // ---------------------------------------------------------------- A. authorization sweep
  console.log('\n[A] Server-side authorization of every GOODEX-related admin route');
  const { order: oAuth, row: rAuth } = await parcelOrder();
  const fakeId = '00000000-0000-4000-8000-000000000000';
  const routes = [
    ['GET', '/orders'], ['GET', `/orders/${oAuth.id}`], ['GET', `/orders/${oAuth.id}/delivery`],
    ['POST', `/orders/${oAuth.id}/delivery/refresh`], ['POST', `/orders/${oAuth.id}/delivery/retry`], ['POST', `/orders/${oAuth.id}/delivery/link`],
    ['POST', `/orders/exchanges/${fakeId}/delivery/refresh`], ['POST', `/orders/exchanges/${fakeId}/delivery/retry`],
    ['POST', `/orders/${oAuth.id}/confirm`], ['POST', `/orders/${oAuth.id}/deliver`], ['POST', `/orders/${oAuth.id}/refund`], ['PATCH', `/orders/${oAuth.id}/status`],
    ['POST', '/orders/bulk-confirm'], ['PATCH', '/orders/bulk-status'],
    ['GET', `/orders/${oAuth.id}/claims`], ['POST', `/orders/${oAuth.id}/claims`], ['POST', `/orders/${oAuth.id}/claims/sync`],
    ['GET', '/orders/claims/types'], ['GET', '/orders/claims/counts'], ['GET', '/orders/claims/remote'],
    ['POST', `/orders/claims/${fakeId}/refresh`], ['DELETE', `/orders/claims/${fakeId}`],
  ];
  const before = mock.requests.length;
  const open = [];
  const customerOpen = [];
  for (const [method, path] of routes) {
    const none = await request(path, { method, body: method === 'GET' ? undefined : { ean: 'X', status: 'delivered', orderIds: [oAuth.id] } });
    const cust = await request(path, { method, token: customerToken, body: method === 'GET' ? undefined : { ean: 'X', status: 'delivered', orderIds: [oAuth.id] } });
    if (none.status !== 401) open.push(`${method} ${path} (no token -> ${none.status})`);
    if (cust.status !== 403) customerOpen.push(`${method} ${path} (customer -> ${cust.status})`);
  }
  assert(open.length === 0, `all ${routes.length} routes answer 401 without a token${open.length ? `: ${open.join(' ; ')}` : ''}`);
  assert(customerOpen.length === 0, `all ${routes.length} routes answer 403 for a non-admin user${customerOpen.length ? `: ${customerOpen.join(' ; ')}` : ''}`);
  assert(mock.requests.length === before, 'refused requests never reach GOODEX');
  assert((await rowOf(oAuth.id)).goodexStatusId === 4 && (await orderRow(oAuth.id)) === 'completed', 'the order and parcel are untouched by the refused requests');

  // ---------------------------------------------------------------- B. page loads
  console.log('\n[B] Loading admin pages sends nothing to GOODEX');
  const b0 = mock.requests.length;
  const list = await request('/orders', { token: adminToken });
  const one = await request(`/orders/${oAuth.id}`, { token: adminToken });
  const del = await request(`/orders/${oAuth.id}/delivery`, { token: adminToken });
  assert(list.status === 200 && one.status === 200 && del.status === 200, 'order list, order details and delivery summary load');
  assert(mock.requests.length === b0, 'zero GOODEX requests for list + details + delivery summary (saved data only)');
  assert(list.data.find((o) => o.id === oAuth.id)?.delivery?.statusLabel === 'En Transit', 'the list shows the persisted status without asking GOODEX');
  const secretsInResponses = [list.text, one.text, del.text].some((t) => t.includes(API_TOKEN) || t.includes(WEBHOOK_SECRET));
  assert(!secretsInResponses, 'no API token or webhook secret in admin responses');

  // ---------------------------------------------------------------- C. tracking failures
  console.log('\n[C] Tracking failures never change the saved status');
  const { order: oT, row: rT } = await parcelOrder();
  const cases = [
    ['HTTP 401', (u, s) => s(401, { message: 'Unauthenticated.' })],
    ['HTTP 403', (u, s) => s(403, { message: 'Forbidden' })],
    ['HTTP 429', (u, s) => s(429, { message: 'Too Many Attempts.' })],
    ['HTTP 500', (u, s) => s(500, { message: 'boom' })],
    ['HTTP 503 html', (u, s) => s(503, null, { raw: '<html>maintenance</html>' })],
    ['200 invalid JSON', (u, s) => s(200, null, { raw: '{not json' })],
    ['200 empty body', (u, s) => s(200, null, { raw: '' })],
    ['200 array body', (u, s) => s(200, [{ statut: 'Livré' }])],
    ['200 object without statut', (u, s) => s(200, { ean: 'x', hello: 'world' })],
    ['200 statut of another parcel', (u, s) => s(200, { ean: 'SOMEONE-ELSE', statut: 'Livré' })],
    ['timeout', () => { /* never answers */ }],
  ];
  for (const [label, handler] of cases) {
    mock.onTrack = handler;
    const res = await request(`/orders/${oT.id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} });
    const row = await rowOf(oT.id);
    assert([502, 503].includes(res.status) && /Suivi GOODEX indisponible/.test(res.data?.error || ''), `${label}: refresh reports a failure (${res.status})`);
    assert(row.goodexStatusId === 4 && row.goodexStatus === 'En Transit' && !row.trackingNotFoundAt, `${label}: saved status kept, no "introuvable" invented`);
  }
  mock.onTrack = null;
  // network failure: nothing listens on the port
  const savedBase = env.goodex.baseUrl;
  env.goodex.baseUrl = 'http://127.0.0.1:1';
  const net = await request(`/orders/${oT.id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} });
  env.goodex.baseUrl = savedBase;
  assert(net.status === 502 && (await rowOf(oT.id)).goodexStatusId === 4, 'connection refused: 502, saved status kept');
  assert((await eventsOf(rT.id)).length === 1, 'failed refreshes wrote no status events (only the creation event exists)');
  // Colis Introuvable is its own outcome
  mock.onTrack = (u, s) => s(200, { statut: 'Colis Introuvable' });
  const nf = await request(`/orders/${oT.id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} });
  const nfRow = await rowOf(oT.id);
  assert(nf.status === 200 && nf.data.trackingNotFound === true && nfRow.goodexStatusId === 4 && nf.data.statusLabel === 'En Transit', '"Colis Introuvable": flagged apart, last valid status kept, not an error');
  assert((await orderRow(oT.id)) === 'completed', '"Colis Introuvable" never changes the Silky order status (no automatic cancellation)');
  mock.onTrack = null;

  // ---------------------------------------------------------------- D. webhook edge cases
  console.log('\n[D] Webhook edge cases');
  const { order: oW, row: rW } = await parcelOrder();
  const b1 = mock.requests.length;
  const t0 = Date.now();
  const okRes = await webhook({ code: rW.ean, statut: 'Livré' });
  const elapsed = Date.now() - t0;
  assert(okRes.status === 200 && (await rowOf(oW.id)).goodexStatusId === 2, 'a valid notification updates the saved status');
  assert(elapsed < 3000, `acknowledged in ${elapsed} ms (GOODEX requires < 3 s)`);
  assert(mock.requests.length === b1, 'processing a webhook makes no outbound GOODEX call');
  assert(!okRes.text.includes(WEBHOOK_SECRET) && !JSON.stringify(okRes.data).includes(API_TOKEN), 'the response never echoes a secret');

  const bad = await request('/webhooks/goodex', { method: 'POST', raw: '{"code": "x", "statut"', headers: { Authorization: authz } });
  assert(bad.status === 400 && !String(bad.text).includes(WEBHOOK_SECRET), `malformed JSON body -> ${bad.status}, nothing stored`);
  const big = await request('/webhooks/goodex', { method: 'POST', raw: JSON.stringify({ code: rW.ean, statut: 'Livré', motif: 'x'.repeat(200000) }), headers: { Authorization: authz } });
  assert(big.status === 413, `oversize body is refused (${big.status})`);
  const noJson = await request('/webhooks/goodex', { method: 'POST', raw: 'code=x&statut=y', headers: { Authorization: authz, 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert(noJson.status === 400, `non-JSON content type -> ${noJson.status}`);
  assert((await webhook({ code: rW.ean })).status === 400 && (await webhook({ statut: 'Livré' })).status === 400, 'missing code or statut -> 400');
  assert((await webhook({ code: '', statut: 'Livré' })).status === 400 && (await webhook({ code: rW.ean, statut: '   ' })).status === 400, 'blank code or statut -> 400');
  const testStr = await webhook({ test: 'true', code: rW.ean, statut: 'Retour' });
  const testBool = await webhook({ test: true, code: rW.ean, statut: 'Retour' });
  assert(testStr.status === 200 && testBool.status === 200 && (await rowOf(oW.id)).goodexStatusId === 2, '`test` notifications are acknowledged and change nothing');
  const unknown = await webhook({ code: 'NO-SUCH-PARCEL', statut: 'Livré' });
  assert(unknown.status === 200, 'unknown parcel code: 2xx so GOODEX does not retry');
  const evBefore = (await eventsOf(rW.id)).length;
  const dup = await webhook({ code: rW.ean, statut: 'Livré' });
  assert(dup.status === 200 && (await eventsOf(rW.id)).length === evBefore, 'duplicate notification: 2xx, no new event');
  const other = await rowOf((await parcelOrder()).order.id);
  assert(other.goodexStatusId === 4, 'a notification changes only the parcel with that code (other parcels untouched)');

  // Colis Introuvable text sent through the webhook must not become the saved status.
  const wnf = await webhook({ code: rW.ean, statut: 'Colis Introuvable' });
  const wnfRow = await rowOf(oW.id);
  assert(wnf.status === 200 && wnfRow.goodexStatusId === 2 && wnfRow.goodexStatus === 'Livré', `"Colis Introuvable" through the webhook never overwrites the saved status (${wnfRow.goodexStatus})`);
  assert(Boolean(wnfRow.trackingNotFoundAt), 'it is recorded as the "introuvable" flag instead (same as a tracking poll)');
  const livre = await webhook({ code: rW.ean, statut: 'Livré' });
  const livreRow = await rowOf(oW.id);
  assert(livre.status === 200 && livreRow.goodexStatus === 'Livré' && !livreRow.trackingNotFoundAt, 'a later real status keeps "Livré" and clears the flag');

  // Out-of-order arrival: the payload has no timestamp, so arrival order wins (provider contract).
  await webhook({ code: rW.ean, statut: 'En Transit' });
  assert((await rowOf(oW.id)).goodexStatusId === 4, 'KNOWN LIMITATION (documented): a late retry of an older status overwrites a newer one; the next refresh corrects it');
  await webhook({ code: rW.ean, statut: 'Livré' });

  // ---------------------------------------------------------------- E. configuration
  console.log('\n[E] Configuration errors');
  const e0 = mock.requests.length;
  const savedUser = env.goodex.userId;
  env.goodex.userId = '';
  const oCfg = await makeOrder();
  await confirm(oCfg.id);
  const rCfg = await rowOf(oCfg.id);
  env.goodex.userId = savedUser;
  assert(rCfg.state === 'failed' && /GOODEX_USER_ID/.test(rCfg.lastError) && mock.requests.length === e0, 'missing user id: confirmation succeeds, parcel recorded as failed, zero requests');
  assert((await orderRow(oCfg.id)) === 'completed', 'the order stays confirmed');
  const retry = await request(`/orders/${oCfg.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(retry.status === 200 && (await rowOf(oCfg.id)).state === 'created', 'once configured, the admin retry creates the parcel');

  // ---------------------------------------------------------------- F. data in logs
  console.log('\n[F] Customer data and secrets in logs');
  mock.onCreate = (r, s) => s(422, { message: 'Invalid destination for Audit Client, phone 12345678, 99 Avenue Audit' });
  const oPii = await makeOrder();
  await confirm(oPii.id);
  mock.onCreate = null;
  const rPii = await rowOf(oPii.id);
  assert(rPii.state === 'failed', 'a provider refusal echoing customer data is recorded as failed');
  const piiLines = logged.filter((l) => l.includes('12345678') || l.includes('99 Avenue Audit') || l.includes('Audit Client'));
  assert(piiLines.length === 0, `no log line contains the customer's name, phone or address (${piiLines.length} found)`);
  const secretLines = logged.filter((l) => l.includes(API_TOKEN) || l.includes(WEBHOOK_SECRET));
  assert(secretLines.length === 0, `no log line contains the API token or the webhook secret (${secretLines.length} found)`);

  // ---------------------------------------------------------------- G. log redaction, other shapes
  console.log('\n[G] Customer data masked in logs for every response shape and formatting');
  const shapes = [
    ['bare field map', (e) => [422, { gsm1: [`The gsm1 ${e.phone} is invalid.`], adresse: [`Bad address ${e.addr}`] }]],
    ['message + errors map', (e) => [422, { message: `Invalid data for ${e.name}`, errors: { client: [`${e.name} already exists`], gsm1: [e.phone] } }]],
    ['error string', (e) => [400, { error: `Cannot deliver to ${e.addr} (${e.name})` }]],
    ['200 without ean', (e) => [200, { message: `no tracking code for ${e.name}, ${e.phone}` }]],
    ['500 with message', (e) => [500, { message: `crash while handling ${e.addr}` }]],
    ['token echoed too', (e) => [400, { message: `rejected token ${API_TOKEN} for ${e.name}` }]],
  ];
  const variants = [
    ['exact', { name: 'Audit Client', phone: '12345678', addr: '99 Avenue Audit' }],
    ['lower/upper case', { name: 'audit client', phone: '12345678', addr: '99 AVENUE AUDIT' }],
    ['spaced and international phone', { name: 'Audit  Client', phone: '+216 12 34 56 78', addr: '99   Avenue Audit' }],
    ['dashed phone', { name: 'AUDIT CLIENT', phone: '12-34-56-78', addr: '99 avenue audit' }],
  ];
  for (const [shape, build] of shapes) {
    for (const [vlabel, echo] of variants) {
      const startAt = logged.length;
      const [status, body] = build(echo);
      mock.onCreate = (r, send) => send(status, body);
      const oG = await makeOrder();
      await confirm(oG.id);
      mock.onCreate = null;
      const rG = await rowOf(oG.id);
      const newLines = logged.slice(startAt);
      const leaked = newLines.filter((l) => /12\D?34\D?56\D?78/.test(l) || /audit\s+client/i.test(l) || /99\s+avenue\s+audit/i.test(l) || l.includes(API_TOKEN));
      assert(['failed', 'unknown'].includes(rG.state) && newLines.some((l) => l.includes('[delivery] Parcel creation')), `${shape} / ${vlabel}: failure recorded and logged`);
      assert(leaked.length === 0, `${shape} / ${vlabel}: no customer data or token in logs (${leaked.length} leaked)`);
    }
  }
  // The text saved for the admin keeps the provider's wording (only the logs are masked).
  mock.onCreate = (r, send) => send(422, { message: 'Invalid destination for Audit Client' });
  const oKeep = await makeOrder();
  await confirm(oKeep.id);
  mock.onCreate = null;
  assert(/Invalid destination for Audit Client/.test((await rowOf(oKeep.id)).lastError || ''), 'the admin-visible last_error is unchanged (provider text kept)');
  mock.onCreate = (r, send) => send(400, { message: `rejected token ${API_TOKEN}` });
  const oTok = await makeOrder();
  await confirm(oTok.id);
  mock.onCreate = null;
  assert(!(await rowOf(oTok.id)).lastError.includes(API_TOKEN), 'a token echoed by the provider is masked in the saved error as well');
  // Diagnostics stay useful: order id, outcome and the HTTP status survive masking.
  mock.onCreate = (r, send) => send(422, { gsm1: ['The gsm1 12345678 is invalid.'] });
  const oDiag = await makeOrder();
  await confirm(oDiag.id);
  mock.onCreate = null;
  const diagLine = logged.slice(-6).find((l) => l.includes(oDiag.id) && l.includes('[delivery] Parcel creation'));
  assert(Boolean(diagLine) && /failed/.test(diagLine) && /HTTP 422/.test(diagLine) && /gsm1 : The gsm1 \*\*\* is invalid\./.test(diagLine), `masked log keeps the order id, outcome, status and field: ${diagLine?.slice(-90)}`);

  // ---------------------------------------------------------------- H. webhook ordering and idempotency
  console.log('\n[H] Webhook ordering: limits and the repair path');
  const { order: oO, row: rO } = await parcelOrder();
  await webhook({ code: rO.ean, statut: 'Livré' });
  await webhook({ code: rO.ean, statut: 'En Transit' }); // a late retry of an older event
  assert((await rowOf(oO.id)).goodexStatusId === 4, 'a late older notification is applied as-is (no timestamp to prove it is older)');
  const history = await eventsOf(rO.id);
  assert(history.length === 3 && history.slice(-2).every((e) => e.source === 'webhook'), `the history keeps every change in arrival order (${history.map((e) => e.goodexStatus || 'create').join(' > ')})`);
  mock.onTrack = (u, send) => send(200, { ean: rO.ean, statut: 'Livré', has_motif: 0, motif: '' });
  const repair = await request(`/orders/${oO.id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} });
  mock.onTrack = null;
  assert(repair.status === 200 && (await rowOf(oO.id)).goodexStatusId === 2, 'a tracking refresh (source of truth) repairs the stale status');
  const beforeBurst = (await eventsOf(rO.id)).length;
  const burst = await Promise.all(Array.from({ length: 15 }, () => webhook({ code: rO.ean, statut: 'Dispatch' })));
  assert(burst.every((r) => r.status === 200) && (await eventsOf(rO.id)).length === beforeBurst + 1, '15 simultaneous identical notifications produce exactly one status change');

  // ---------------------------------------------------------------- I. delivery-link endpoint
  console.log('\n[I] Admin delivery-link endpoint');
  const l0 = mock.requests.length;
  const oPend = await makeOrder();
  const linkPend = await request(`/orders/${oPend.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: `LINK-PEND-${Date.now()}` } });
  assert(linkPend.status === 400 && (await rowOf(oPend.id)) === null, `an unconfirmed order cannot be linked to a parcel (${linkPend.status})`);
  const oCan = await makeOrder();
  await request(`/orders/${oCan.id}/cancel`, { method: 'POST', token: adminToken });
  const linkCan = await request(`/orders/${oCan.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: `LINK-CAN-${Date.now()}` } });
  assert(linkCan.status === 400 && (await rowOf(oCan.id)) === null, `a cancelled order cannot be linked either (${linkCan.status})`);
  const oLink = await makeOrder();
  await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, oLink.id));
  for (const bad of ['', '   ', 'has space', 'x'.repeat(65), null, 12345, { a: 1 }, ['a']]) {
    const r = await request(`/orders/${oLink.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: bad } });
    assert(r.status === 400, `invalid code ${String(JSON.stringify(bad)).slice(0, 20)} refused (${r.status})`);
  }
  const eanL = `LINK-OK-${Date.now()}`;
  const good = await request(`/orders/${oLink.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: eanL } });
  assert(good.status === 200 && good.data.state === 'created' && good.data.ean === eanL && good.data.statusId === null, 'a valid code on a confirmed order is linked (state created, no status yet)');
  const again = await request(`/orders/${oLink.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: `${eanL}-2` } });
  assert(again.status === 409, 'a second link on an order that already has a parcel is refused (409)');
  const oOther = await makeOrder();
  await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, oOther.id));
  const clash = await request(`/orders/${oOther.id}/delivery/link`, { method: 'POST', token: adminToken, body: { ean: eanL } });
  assert(clash.status === 409 && (await rowOf(oOther.id)) === null, 'a code already linked to another order is refused (409), nothing stored');
  assert(mock.requests.length === l0, 'linking never calls GOODEX (the code is not verified remotely)');
  mock.onTrack = (u, send) => send(200, { statut: 'Colis Introuvable' });
  const wrongRefresh = await request(`/orders/${oLink.id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} });
  mock.onTrack = null;
  assert(wrongRefresh.data.trackingNotFound === true, 'a wrongly typed code is revealed by the next refresh ("Colis introuvable"), nothing is invented');

  // ---------------------------------------------------------------- J. Colis Introuvable via webhook, edge cases
  console.log('\n[J] "Colis Introuvable" through the webhook, edge cases');
  const { order: oN, row: rN } = await parcelOrder();
  const evN = (await eventsOf(rN.id)).length;
  for (const variantText of ['colis introuvable', 'COLIS  INTROUVABLE', ' Colis Introuvable ', 'Colis Introuvablé']) {
    const r = await webhook({ code: rN.ean, statut: variantText, motif: 'ignored reason' });
    const row = await rowOf(oN.id);
    assert(r.status === 200 && row.goodexStatusId === 4 && row.goodexStatus === 'En Transit' && Boolean(row.trackingNotFoundAt), `variant ${JSON.stringify(variantText)}: saved status untouched (${row.goodexStatus}), flagged apart`);
  }
  const rowN = await rowOf(oN.id);
  assert(!rowN.motif && !rowN.hasMotif, 'a motif sent with "Colis Introuvable" is not stored as an incident');
  assert((await eventsOf(rN.id)).length === evN + 1, 'repeats of the same "introuvable" outcome write one event only (idempotent)');
  assert((await orderRow(oN.id)) === 'completed' && rowN.state === 'created' && rowN.ean === rN.ean, 'the order is not cancelled and the parcel is neither deleted nor unlinked');

  await new Promise((r) => httpServer.close(r));
  await new Promise((r) => mock.server.close(r));
}

async function orderRow(id) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row?.status;
}

async function cleanup() {
  try {
    if (created.orderIds.length) await db.delete(orders).where(inArray(orders.id, created.orderIds));
    if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
    if (created.userIds.length) await db.delete(users).where(inArray(users.id, created.userIds));
  } catch (err) {
    console.warn('Cleanup warning:', err.message);
  }
}

try {
  await run();
} catch (err) {
  console.error('Test execution error:', err);
  failed += 1;
} finally {
  await cleanup();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}
