/**
 * What a guard-blocked GOODEX call looks like in the database and through the admin API:
 * parcel creation, tracking, claims (types / open / sync / refresh / cancel). The real
 * GOODEX URL stays configured with a token-like credential; global fetch is wrapped so any
 * request that is not to this process (127.0.0.1) is recorded and refused, and a fake
 * loopback port plays GOODEX only to prime a claim for the cancel scenario.
 *
 * Requires DATABASE_URL pointing at a DEDICATED TEST database (name containing "test").
 * Usage (PowerShell): $env:DATABASE_URL='postgres://.../silky_test'; node server/scripts/test_goodex_blocked_flow.js
 */
import http from 'http';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { db } from '../db/orm.js';
import { eq, inArray } from 'drizzle-orm';
import { products, productVariants, categories, orders, users, orderDeliveries, orderDeliveryEvents, orderClaims } from '../models/index.js';
import { _resetRateLimits } from '../middleware/rateLimiter.js';
import { signAccessToken } from '../services/token.service.js';
import { runOrderDeliveriesMigration } from '../db/migrations/add_order_deliveries.js';
import { runOrderClaimsMigration } from '../db/migrations/add_order_claims.js';
import { ensureParcelForOrder } from '../services/delivery.service.js';
import { _resetClaimCaches } from '../services/claims.service.js';
import { pool } from '../db/pool.js';

const REAL_URL = 'https://transport.goodex.tn';
const TOKEN = 'tok_blocked_flow_not_real';
const FAKE_PORT = '1'; // never listened on: served by the fetch wrapper below

let passed = 0;
let failed = 0;
let BASE = '';
let adminToken = '';
const created = { orderIds: [], productIds: [] };
const external = []; // every non-local request that was attempted (must stay empty)
const fakeCalls = []; // requests served by the fake GOODEX during priming

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1' && u.port === FAKE_PORT) {
    const method = init.method || 'GET';
    fakeCalls.push(`${method} ${u.pathname}`);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'GET' && u.pathname === '/api/v1/tickets/types') {
      return json(200, { types: [
        { code: 'colis_urgent', label: 'Colis urgent', needs_value: false, priorite: 'haute', message_required: false },
        { code: 'personnaliser', label: 'Personnaliser', needs_value: false, priorite: 'normale', message_required: true },
      ], statuts: ['nouveau', 'en_cours', 'resolu', 'rejete'] });
    }
    if (method === 'POST' && u.pathname === '/api/client/tickets') {
      return json(201, { success: true, message: 'ok', ticket: {
        id: 777, reference: 'TK-000777', colis_ean: init.body.get('ean'), type: init.body.get('type'), type_label: 'Colis urgent',
        valeur: null, statut: 'nouveau', priorite: 'haute', is_open: true, reponse: null, created_at: '2026-08-27T09:12:44.000000Z',
      } });
    }
    return json(500, {});
  }
  if (u.hostname === '127.0.0.1') return realFetch(url, init); // this process's own API
  external.push(`${init.method || 'GET'} ${u.origin}${u.pathname}`);
  throw new Error('test: external request refused');
};

async function request(endpoint, { method = 'GET', body, token = adminToken } = {}) {
  _resetRateLimits();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await realFetch(`${BASE}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

let variant;
async function makeOrder() {
  const res = await request('/orders', {
    method: 'POST',
    token: null,
    body: {
      customer: { name: 'Test Client', phone: '12345678', address: '12 Rue Test', governorate: 'Tunis' },
      items: [{ variantId: variant.id, quantity: 1 }],
    },
  });
  if (res.status !== 201) throw new Error(`order creation failed: ${res.status} ${JSON.stringify(res.data)}`);
  created.orderIds.push(res.data.id);
  return res.data;
}
const deliveryRow = async (orderId) => (await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, orderId)))[0] || null;
const claimRows = (orderId) => db.select().from(orderClaims).where(eq(orderClaims.orderId, orderId));
const BLOCKED = /réels bloqués/;

async function run() {
  const dbName = new URL(env.databaseUrl).pathname.slice(1);
  if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== '1') {
    throw new Error(`Refusing to run against database "${dbName}": use a dedicated test database (name containing "test")`);
  }
  await runOrderDeliveriesMigration(pool);
  await runOrderClaimsMigration(pool);

  const httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${httpServer.address().port}/api`;

  // Real URL, a credential present, no opt-in: exactly what a dev/test run with a real .env looks like.
  env.goodex.baseUrl = REAL_URL;
  env.goodex.apiToken = TOKEN;
  env.goodex.userId = '9999';
  env.goodex.enableLive = false;
  env.goodex.timeoutMs = 400;

  let [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) {
    [admin] = await db.insert(users).values({ email: `admin-blocked-${Date.now()}@silky.tn`, passwordHash: 'fakehash', fullName: 'Admin', role: 'admin' }).returning();
  }
  adminToken = signAccessToken(admin);
  let [category] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!category) [category] = await db.insert(categories).values({ name: 'Femme', slug: 'femme' }).returning();
  const prod = await request('/products', {
    method: 'POST',
    body: {
      name: 'Produit Blocked Test', description: 'd', collectionImage: '/pictures/collection.jpg', slug: `blocked-prod-${Date.now()}`,
      price: 100, category: category.slug, categoryId: category.id, colors: [{ id: 'noir', name: 'Noir', image: '/pictures/noir.jpg' }],
      sizes: ['M'], stock: { 'noir-M': 50 },
    },
  });
  created.productIds.push(prod.data.id);
  [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, prod.data.id));

  // ------------------------------------------------------------- 1. blocked parcel creation
  console.log('\n[1] Parcel creation refused by the guard');
  const o1 = await makeOrder();
  const confirmRes = await request(`/orders/${o1.id}/confirm`, { method: 'POST' });
  assert(confirmRes.status === 200, 'the order is still confirmed (confirmation never depends on GOODEX)');
  const row = await deliveryRow(o1.id);
  assert(row?.state === 'failed', `delivery row is "failed", never creating/created/unknown (got ${row?.state})`);
  assert(BLOCKED.test(row?.lastError || ''), 'last_error says real GOODEX calls are blocked');
  assert(!row?.ean && !row?.goodexParcelId && !row?.goodexStatus && !row?.goodexStatusId && !row?.statusReceivedAt, 'no ean / parcel id / status / receipt timestamp is recorded');
  assert(row?.attemptCount === 1, 'attempt_count is 1 (a claim counter: nothing was sent)');
  const events = await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, row.id));
  assert(events.length === 0, 'no delivery event (status history) was written');
  const api = await request(`/orders/${o1.id}/delivery`);
  assert(api.status === 200 && api.data.state === 'failed' && BLOCKED.test(api.data.lastError || '') && !api.data.ean && !api.data.statusLabel && !api.data.incident, 'admin API: state failed + explanatory error, no tracking data, no incident');
  assert(external.length === 0, 'no request left the process');

  // ------------------------------------------------------------- 2. no automatic retry
  console.log('\n[2] No automatic retry');
  const stamp = row.updatedAt.getTime();
  await new Promise((r) => setTimeout(r, 1200));
  const again = await ensureParcelForOrder(o1.id);
  const reconfirm = await request(`/orders/${o1.id}/confirm`, { method: 'POST' });
  const afterAuto = await deliveryRow(o1.id);
  assert(again?.id === row.id && afterAuto.attemptCount === 1 && afterAuto.updatedAt.getTime() === stamp, 'waiting, calling ensureParcelForOrder and re-confirming do not claim or touch the row again');
  assert(reconfirm.status !== 500, 'confirming an already confirmed order does not error');

  console.log('\n[3] Explicit admin retry stays blocked');
  const retry = await request(`/orders/${o1.id}/delivery/retry`, { method: 'POST', body: {} });
  const afterRetry = await deliveryRow(o1.id);
  assert(afterRetry.state === 'failed' && BLOCKED.test(afterRetry.lastError || '') && afterRetry.attemptCount === 2, `manual retry is refused again (state ${afterRetry.state}, attempts ${afterRetry.attemptCount}, HTTP ${retry.status})`);
  assert(external.length === 0, 'still no request left the process');

  // opting in does not help inside a test database
  env.goodex.enableLive = true;
  const o1b = await makeOrder();
  await request(`/orders/${o1b.id}/confirm`, { method: 'POST' });
  const rowB = await deliveryRow(o1b.id);
  assert(rowB?.state === 'failed' && BLOCKED.test(rowB.lastError || ''), 'GOODEX_ENABLE_LIVE=true is still refused on a test database');
  env.goodex.enableLive = false;

  // ------------------------------------------------------------- 4. tracking
  console.log('\n[4] Tracking an existing parcel');
  const o2 = await makeOrder();
  await request(`/orders/${o2.id}/confirm`, { method: 'POST' });
  const link = await request(`/orders/${o2.id}/delivery/link`, { method: 'POST', body: { ean: `EAN-BLOCKED-${Date.now()}` } });
  assert(link.status < 300, `an admin-verified ean can be linked (HTTP ${link.status})`);
  const before = await deliveryRow(o2.id);
  const refresh = await request(`/orders/${o2.id}/delivery/refresh`, { method: 'POST', body: { onlyIfStale: false } });
  const after = await deliveryRow(o2.id);
  assert([502, 503].includes(refresh.status) && BLOCKED.test(refresh.data?.error || ''), `refresh answers an error that names the block (HTTP ${refresh.status})`);
  assert(after.state === 'created' && after.goodexStatus === before.goodexStatus && after.lastPolledAt === null && after.statusReceivedAt === null && after.trackingNotFoundAt === null, 'a blocked refresh changes nothing (no status, no poll timestamp, no "introuvable")');

  // ------------------------------------------------------------- 5. claims
  console.log('\n[5] Claims while blocked');
  _resetClaimCaches();
  const types = await request('/orders/claims/types');
  assert(types.status === 502 && BLOCKED.test(types.data?.error || ''), 'types: 502 naming the block');
  const open1 = await request(`/orders/${o2.id}/claims`, { method: 'POST', body: { type: 'colis_urgent' } });
  assert(open1.status === 502 && BLOCKED.test(open1.data?.error || '') && (await claimRows(o2.id)).length === 0, 'open (no cached types): refused, no local claim row');
  const counts = await request('/orders/claims/counts');
  assert(counts.status === 502 && BLOCKED.test(counts.data?.error || ''), 'counts: 502 naming the block');
  const sync = await request(`/orders/${o2.id}/claims/sync`, { method: 'POST' });
  assert(sync.status >= 400 && (await claimRows(o2.id)).length === 0, `sync: refused, nothing imported (HTTP ${sync.status})`);
  assert(external.length === 0, 'no request left the process');

  // Prime a claim and the type cache through the fake loopback GOODEX, then go back to the real URL.
  env.goodex.baseUrl = `http://127.0.0.1:${FAKE_PORT}`;
  _resetClaimCaches();
  const primed = await request(`/orders/${o2.id}/claims`, { method: 'POST', body: { type: 'colis_urgent' } });
  assert(primed.status === 201 && (await claimRows(o2.id)).length === 1, 'priming through the loopback fake created one local claim and cached the types');
  env.goodex.baseUrl = REAL_URL;
  const fakeBefore = fakeCalls.length;

  const open2 = await request(`/orders/${o2.id}/claims`, { method: 'POST', body: { type: 'personnaliser', message: 'Merci de rappeler le client' } });
  assert(open2.status === 503 && BLOCKED.test(open2.data?.error || '') && !open2.data?.outcome, `open with cached types reaches the provider call and is refused as a configuration error, not an uncertain outcome (HTTP ${open2.status})`);
  assert((await claimRows(o2.id)).length === 1, 'refused open leaves no new local claim');

  const [claim] = await claimRows(o2.id);
  const cancel = await request(`/orders/claims/${claim.id}`, { method: 'DELETE' });
  const afterCancel = (await claimRows(o2.id))[0];
  assert(cancel.status >= 400 && BLOCKED.test(cancel.data?.error || '') && cancel.data?.outcome !== 'unknown', `cancel: refused naming the block, not "résultat incertain" (HTTP ${cancel.status})`);
  assert(afterCancel.cancelledAt === null && afterCancel.isOpen === true && afterCancel.status === claim.status, 'a refused cancel leaves the claim untouched');
  const refreshClaim = await request(`/orders/claims/${claim.id}/refresh`, { method: 'POST' });
  assert(refreshClaim.status >= 400 && BLOCKED.test(refreshClaim.data?.error || ''), 'claim refresh: refused naming the block');
  assert(fakeCalls.length === fakeBefore && !fakeCalls.some((c) => c.startsWith('DELETE')), 'nothing (and no DELETE) reached the provider after switching back to the real URL');
  assert(external.length === 0, 'no request left the process');
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
  globalThis.fetch = realFetch;
  console.log(`\nExternal requests attempted: ${external.length}${external.length ? ` -> ${external.join(', ')}` : ''}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 || external.length > 0 ? 1 : 0);
}
