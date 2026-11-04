/**
 * GOODEX background reconciliation tests. A LOCAL mock HTTP server stands in for GOODEX; the
 * script refuses to run against a non-loopback host or a database whose name lacks "test". It
 * never calls the real provider. Parcels are created through the normal confirmation flow against
 * the mock, then the reconciler is exercised directly (no real timers: injected timer functions
 * and an injected clock).
 *
 * Usage: DATABASE_URL=postgres://.../silky_test node server/scripts/test_goodex_reconciler.js
 */
import http from 'http';
import fs from 'fs';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { db } from '../db/orm.js';
import { eq, inArray } from 'drizzle-orm';
import { products, productVariants, categories, orders, users, orderDeliveries, orderDeliveryEvents } from '../models/index.js';
import { _resetRateLimits } from '../middleware/rateLimiter.js';
import { signAccessToken } from '../services/token.service.js';
import { runOrderDeliveriesMigration } from '../db/migrations/add_order_deliveries.js';
import { runExchangeDeliveriesMigration } from '../db/migrations/add_exchange_deliveries.js';
import { runRefundDeliveriesMigration } from '../db/migrations/add_refund_deliveries.js';
import { deliveryRepository } from '../repositories/delivery.repository.js';
import { refreshDeliveryRow } from '../services/delivery.service.js';
import { createDeliveryReconciler, startDeliveryReconciler, stopDeliveryReconciler } from '../services/delivery.reconciler.js';
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
const API_TOKEN = 'recon-api-token-not-real';
const WEBHOOK_SECRET = 'recon-webhook-secret-not-real';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms);
const stamp = Date.now();

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed += 1;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed += 1;
  }
}

async function request(endpoint, { method = 'GET', body, token, headers: extra } = {}) {
  _resetRateLimits();
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ------------------------------------------------------------------ mock GOODEX
const mock = {
  server: null,
  posts: 0,
  strayPosts: 0, // creations sent outside a fixture step (must stay 0)
  fixtureDepth: 0,
  gets: 0,
  hits: {},
  inflight: 0,
  maxInflight: 0,
  delayMs: 0,
  handlers: new Map(),
  fallback: null,
  resetCounters() {
    this.gets = 0;
    this.hits = {};
    this.maxInflight = 0;
    this.delayMs = 0;
    this.handlers = new Map();
    this.fallback = null;
  },
};

function startMock() {
  mock.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const send = (status, body, opts = {}) => {
        if (opts.raw !== undefined) { res.writeHead(status, { 'Content-Type': 'text/plain', ...(opts.headers || {}) }); return res.end(opts.raw); }
        res.writeHead(status, { 'Content-Type': 'application/json', ...(opts.headers || {}) });
        return res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/api/v1/colis/create') {
        mock.posts += 1;
        if (!mock.fixtureDepth) mock.strayPosts += 1;
        return send(200, { id: 800000 + mock.posts, ean: `RECTMP-${stamp}-${mock.posts}`, last_statut: 12 });
      }
      if (req.method === 'GET' && req.url.startsWith('/api/v1/colis/etat/')) {
        const ean = decodeURIComponent(req.url.split('?')[0].split('/').pop());
        mock.gets += 1;
        mock.hits[ean] = (mock.hits[ean] || 0) + 1;
        mock.inflight += 1;
        mock.maxInflight = Math.max(mock.maxInflight, mock.inflight);
        try {
          if (mock.delayMs) await new Promise((r) => setTimeout(r, mock.delayMs));
          const handler = mock.handlers.get(ean) || mock.fallback;
          if (handler) return await handler(send, ean);
          return send(200, { ean, statut: 'En Transit', has_motif: 0, motif: '' });
        } finally {
          mock.inflight -= 1;
        }
      }
      return send(404, {});
    });
  });
  return new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
}

// ------------------------------------------------------------------ fixtures
const created = { orderIds: [], productIds: [] };
const mine = new Set(); // delivery ids created by this script
let variant;
let variantB;
let seq = 0;

async function makeProduct(name, price) {
  const res = await request('/products', {
    method: 'POST', token: adminToken,
    body: { name, description: 'd', collectionImage: '/pictures/collection.jpg', slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`, price, category: 'femme', colors: [{ id: 'noir', name: 'Noir', image: '/pictures/noir.jpg' }], sizes: ['M'], stock: { 'noir-M': 300 } },
  });
  created.productIds.push(res.data.id);
  return (await db.select().from(productVariants).where(eq(productVariants.productId, res.data.id)))[0];
}

async function makeOrder() {
  const res = await request('/orders', {
    method: 'POST',
    body: { customer: { name: 'Reco Client', phone: '12345678', address: '7 Rue Reconciliation', governorate: 'Tunis' }, items: [{ variantId: variant.id, quantity: 1 }] },
  });
  if (res.status !== 201) throw new Error(`order creation failed: ${res.status} ${JSON.stringify(res.data)}`);
  created.orderIds.push(res.data.id);
  return res.data;
}

async function fixtureStep(fn) {
  mock.fixtureDepth += 1;
  try {
    return await fn();
  } finally {
    mock.fixtureDepth -= 1;
  }
}

const rowById = async (id) => (await db.select().from(orderDeliveries).where(eq(orderDeliveries.id, id)))[0];
const eventsOf = async (id) => db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, id));
const orderStatus = async (id) => (await db.select().from(orders).where(eq(orders.id, id)))[0].status;

/** A confirmed order with a created parcel (status "En Transit", changed 1 h ago, never polled). */
async function makeParcel(label, patch = {}, silkyStatus = null) {
  seq += 1;
  const order = await makeOrder();
  await fixtureStep(() => request(`/orders/${order.id}/confirm`, { method: 'POST', token: adminToken }));
  const [row] = await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, order.id));
  if (row?.state !== 'created') throw new Error(`parcel not created for ${label}: ${row?.state} ${row?.lastError}`);
  await db.update(orderDeliveries).set({
    ean: `REC-${label}-${stamp}-${seq}`, goodexStatus: 'En Transit', goodexStatusId: 4, deliveryStatus: 'status_4',
    statusUpdatedAt: ago(HOUR), lastPolledAt: null, hasMotif: false, ...patch, // has_motif already known, so an unchanged poll writes no event
  }).where(eq(orderDeliveries.id, row.id));
  if (silkyStatus) await db.update(orders).set({ status: silkyStatus }).where(eq(orders.id, order.id));
  mine.add(row.id);
  return { ...(await rowById(row.id)), orderId: order.id };
}

const SEEN_INTERVAL = 10; // minutes -> base polling gap of 5 minutes

/** A reconciler restricted to this script's own parcels (the SQL query itself is the real one). */
function reconciler({ scope, ...overrides } = {}) {
  const allowed = scope ? new Set(scope.map((r) => r.id)) : mine;
  return createDeliveryReconciler({
    intervalMinutes: SEEN_INTERVAL,
    batchSize: 50,
    concurrency: 2,
    maxAgeDays: 60,
    canRun: () => null,
    findCandidates: async (args) => (await deliveryRepository.findRefreshCandidates({ ...args, limit: 1000 }))
      .filter((r) => allowed.has(r.id)).slice(0, args.limit),
    ...overrides,
  });
}

async function run() {
  const dbName = new URL(env.databaseUrl).pathname.slice(1);
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run against database "${dbName}": a dedicated test database (name containing "test") is required`);
  await runOrderDeliveriesMigration(pool);
  await runExchangeDeliveriesMigration(pool);
  await runRefundDeliveriesMigration(pool);
  await startMock();
  const httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  BASE = `http://127.0.0.1:${httpServer.address().port}/api`;

  env.goodex.baseUrl = `http://127.0.0.1:${mock.server.address().port}`;
  env.goodex.apiToken = API_TOKEN;
  env.goodex.userId = '9999';
  env.goodex.webhookSecret = WEBHOOK_SECRET;
  env.goodex.timeoutMs = 400;
  env.goodex.enableLive = false;
  if (new URL(env.goodex.baseUrl).hostname !== '127.0.0.1') throw new Error('Refusing to run against a non-loopback GOODEX URL');

  let [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) [admin] = await db.insert(users).values({ email: `admin-recon-${Date.now()}@silky.tn`, passwordHash: 'fakehash', fullName: 'Admin Recon', role: 'admin' }).returning();
  adminToken = signAccessToken(admin);
  let [category] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!category) [category] = await db.insert(categories).values({ name: 'Femme', slug: 'femme' }).returning();
  variant = await makeProduct('Produit Reco A', 100);
  variantB = await makeProduct('Produit Reco B', 60);

  // ---------------------------------------------------------------- 1. disabled and lifecycle
  console.log('\n[1] Disabled mode and start/stop lifecycle');
  const savedPoll = { ...env.goodex.poll };
  env.goodex.poll.intervalMinutes = 0;
  assert(startDeliveryReconciler() === null, 'GOODEX_POLL_INTERVAL_MINUTES=0 -> startDeliveryReconciler returns null (no timer)');
  env.goodex.poll.intervalMinutes = savedPoll.intervalMinutes;
  const off = createDeliveryReconciler({ intervalMinutes: 0, canRun: () => null });
  assert(off.enabled === false && off.start() === false && off._state().scheduled === false, 'a zero interval never schedules anything');
  assert(createDeliveryReconciler({ intervalMinutes: -5 }).enabled === false, 'a negative interval is disabled too');
  await stopDeliveryReconciler(); // nothing started: must not throw

  const timers = [];
  const cleared = [];
  const lifecycle = createDeliveryReconciler({
    intervalMinutes: 10, initialDelayMs: 1000, canRun: () => null,
    findCandidates: async () => [],
    setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; },
    clearTimer: (t) => cleared.push(t),
  });
  assert(lifecycle.start() === true && timers.length === 1 && timers[0].ms === 1000, 'start schedules the first run after the initial delay');
  assert(lifecycle.start() === false && timers.length === 1, 'a second start is ignored');
  await timers[0].fn();
  assert(timers.length === 2 && timers[1].ms === 10 * MIN, 'after a run the next one is scheduled one interval later (no fixed ticking, no overlap)');
  await lifecycle.stop();
  assert(cleared.includes(timers[1]) && lifecycle._state().scheduled === false && lifecycle._state().stopped === true, 'stop clears the pending timer');
  await timers[1].fn();
  assert(timers.length === 2, 'after stop no new timer is scheduled even if a stale callback fires');
  await lifecycle.stop(); // idempotent

  // stop waits for the run in progress
  let release;
  const gate = new Promise((r) => { release = r; });
  const slowOne = createDeliveryReconciler({
    intervalMinutes: 10, canRun: () => null,
    findCandidates: async () => [{ id: 'x' }],
    refresh: async () => { await gate; return { ok: true, outcome: 'unchanged' }; },
    setTimer: (fn) => ({ fn, unref() {} }), clearTimer: () => {},
  });
  const inFlight = slowOne.runOnce();
  let stopped = false;
  const stopping = slowOne.stop().then(() => { stopped = true; });
  await new Promise((r) => setTimeout(r, 30));
  assert(slowOne.isRunning() === true && stopped === false, 'stop waits for the run in progress');
  release();
  await stopping;
  await inFlight;
  assert(stopped === true && slowOne.isRunning() === false, 'stop returns once the run has finished');

  // ---------------------------------------------------------------- 2. eligibility
  console.log('\n[2] Which parcels are selected');
  const P = {};
  const add = async (label, patch, silky) => { P[label] = await makeParcel(label, patch, silky); };
  await add('never', {});
  await add('active_notdue', { lastPolledAt: ago(2 * MIN) });
  await add('active_due', { lastPolledAt: ago(6 * MIN) });
  await add('mid_notdue', { statusUpdatedAt: ago(3 * DAY), lastPolledAt: ago(HOUR) });
  await add('mid_due', { statusUpdatedAt: ago(3 * DAY), lastPolledAt: ago(4 * HOUR) });
  await add('old_notdue', { statusUpdatedAt: ago(20 * DAY), lastPolledAt: ago(6 * HOUR) });
  await add('old_due', { statusUpdatedAt: ago(20 * DAY), lastPolledAt: ago(13 * HOUR) });
  await add('paye', { goodexStatus: 'Payé', goodexStatusId: 8, deliveryStatus: 'status_8' });
  await add('retour_paye', { goodexStatus: 'Retour Payé', goodexStatusId: 11, deliveryStatus: 'status_11' });
  await add('livre', { goodexStatus: 'Livré', goodexStatusId: 2, deliveryStatus: 'status_2', lastPolledAt: ago(10 * MIN) });
  await add('unknown_state', { state: 'unknown' });
  await add('too_old', { createdAt: ago(90 * DAY) });
  await add('nf_recent_due', { trackingNotFoundAt: ago(30 * MIN), lastPolledAt: ago(6 * MIN) });
  await add('nf_recent_notdue', { trackingNotFoundAt: ago(30 * MIN), lastPolledAt: ago(2 * MIN) });
  await add('nf_day_notdue', { trackingNotFoundAt: ago(5 * HOUR), lastPolledAt: ago(30 * MIN) });
  await add('nf_day_due', { trackingNotFoundAt: ago(5 * HOUR), lastPolledAt: ago(90 * MIN) });
  await add('nf_week_notdue', { trackingNotFoundAt: ago(3 * DAY), lastPolledAt: ago(6 * HOUR) });
  await add('nf_week_due', { trackingNotFoundAt: ago(3 * DAY), lastPolledAt: ago(13 * HOUR) });
  await add('nf_give_up', { trackingNotFoundAt: ago(15 * DAY), lastPolledAt: ago(30 * DAY) });
  await add('bad_ean', { ean: 'has space' });
  await add('cancelled', {}, 'cancelled');
  await add('refunded', {}, 'refunded');
  await add('webhooked', { lastWebhookAt: ago(MIN), lastPolledAt: ago(6 * MIN) });
  // an exchange parcel
  const exOrder = await makeOrder();
  await fixtureStep(() => request(`/orders/${exOrder.id}/confirm`, { method: 'POST', token: adminToken }));
  const exRes = await fixtureStep(() => request(`/admin/orders/${exOrder.id}/exchange`, {
    method: 'POST', token: adminToken,
    body: { customer: { customerName: 'Client Echange', phoneNumber: '22334455', shippingAddress: 'Béja — 5 Avenue Test' }, items: [{ variantId: variant.id, action: 'keep', quantity: 1 }, { variantId: variantB.id, action: 'add', quantity: 1 }], paymentResponsibility: 'silky_paid' },
  }));
  const exId = exRes.data.exchanges[0].id;
  const [exRow] = await db.select().from(orderDeliveries).where(eq(orderDeliveries.exchangeId, exId));
  await db.update(orderDeliveries).set({ ean: `REC-exchange-${stamp}`, goodexStatus: 'En Transit', goodexStatusId: 4, deliveryStatus: 'status_4', statusUpdatedAt: ago(HOUR), lastPolledAt: null }).where(eq(orderDeliveries.id, exRow.id));
  mine.add(exRow.id);
  P.exchange = { ...(await rowById(exRow.id)), orderId: exOrder.id };
  await add('failed_state', { state: 'failed', ean: null });

  const baseGapMs = 5 * MIN;
  const selected = (await deliveryRepository.findRefreshCandidates({ now: new Date(), limit: 1000, baseGapMs, maxAgeDays: 60 })).filter((r) => mine.has(r.id));
  const ids = new Set(selected.map((r) => r.id));
  const want = ['never', 'active_due', 'mid_due', 'old_due', 'livre', 'nf_recent_due', 'nf_day_due', 'nf_week_due', 'cancelled', 'refunded', 'webhooked', 'exchange'];
  const wantNot = ['active_notdue', 'mid_notdue', 'old_notdue', 'paye', 'retour_paye', 'unknown_state', 'too_old', 'nf_recent_notdue', 'nf_day_notdue', 'nf_week_notdue', 'nf_give_up', 'bad_ean', 'failed_state'];
  for (const label of want) assert(ids.has(P[label].id), `selected: ${label}`);
  for (const label of wantNot) assert(!ids.has(P[label].id), `not selected: ${label}`);
  assert(selected.every((r) => r.state === 'created' && r.ean), 'only created parcels with a tracking code are ever selected');
  assert(P.exchange.exchangeId !== null && ids.has(P.exchange.id), 'exchange parcels are selected like ordinary ones');
  const ordered = selected.map((r) => r.lastPolledAt ? new Date(r.lastPolledAt).getTime() : -Infinity);
  assert(ordered.every((t, i) => i === 0 || ordered[i - 1] <= t), 'never-polled parcels come first, then the least recently polled');
  const limited = await deliveryRepository.findRefreshCandidates({ now: new Date(), limit: 3, baseGapMs, maxAgeDays: 60 });
  assert(limited.length === 3, 'the batch size bounds the selection');
  const excluded = await deliveryRepository.findRefreshCandidates({ now: new Date(), limit: 1000, baseGapMs, maxAgeDays: 60, excludeIds: [P.never.id] });
  assert(!excluded.some((r) => r.id === P.never.id), 'excludeIds leaves out parcels the caller is backing off from');
  assert((await orderStatus(P.cancelled.orderId)) === 'cancelled' && (await orderStatus(P.refunded.orderId)) === 'refunded', 'cancelled and refunded Silky orders are still tracked (policy), their status untouched');

  // ---------------------------------------------------------------- 3. row-level refresh
  console.log('\n[3] refreshDeliveryRow outcomes');
  mock.resetCounters();
  const r1 = await makeParcel('row1');
  mock.handlers.set(r1.ean, (send, ean) => send(200, { ean, statut: 'Livré', has_motif: 0, motif: '' }));
  const ev0 = (await eventsOf(r1.id)).length;
  const out1 = await refreshDeliveryRow(r1);
  assert(out1.ok && out1.outcome === 'updated' && out1.changed === true && out1.row.goodexStatusId === 2, 'a changed status is saved: outcome "updated"');
  assert((await eventsOf(r1.id)).length === ev0 + 1, 'one history event for the change');
  const before = await rowById(r1.id);
  const out2 = await refreshDeliveryRow(before);
  const after = await rowById(r1.id);
  assert(out2.ok && out2.outcome === 'unchanged' && out2.changed === false, 'same status again: outcome "unchanged"');
  assert((await eventsOf(r1.id)).length === ev0 + 1 && String(after.statusUpdatedAt) === String(before.statusUpdatedAt) && String(after.updatedAt) === String(before.updatedAt), 'unchanged: no event, status time and updated_at untouched (only the poll bookkeeping moves)');
  mock.handlers.set(r1.ean, (send) => send(200, { statut: 'Colis Introuvable' }));
  const out3 = await refreshDeliveryRow(after);
  const nf = await rowById(r1.id);
  assert(out3.ok && out3.outcome === 'not_found' && Boolean(nf.trackingNotFoundAt) && nf.goodexStatusId === 2, '"Colis Introuvable": flagged apart, saved status kept');
  const nfEvents = (await eventsOf(r1.id)).length;
  const out4 = await refreshDeliveryRow(nf);
  assert(out4.outcome === 'not_found' && out4.changed === false && (await eventsOf(r1.id)).length === nfEvents, 'repeated "introuvable": no new event');

  const kinds = [
    ['401', (s) => s(401, { message: `Unauthenticated ${API_TOKEN}` }), 'auth'],
    ['403', (s) => s(403, { message: 'Forbidden' }), 'auth'],
    ['429 with Retry-After', (s) => s(429, { message: 'slow down' }, { headers: { 'Retry-After': '7' } }), 'rate_limit'],
    ['429 empty body', (s) => s(429, null, { raw: '' }), 'rate_limit'],
    ['500', (s) => s(500, { message: 'boom' }), 'server'],
    ['503 html', (s) => s(503, null, { raw: '<html>maintenance</html>' }), 'server'],
    ['200 invalid JSON', (s) => s(200, null, { raw: '{not json' }), 'invalid'],
    ['200 array', (s) => s(200, [{ statut: 'Livré' }]), 'invalid'],
    ['200 no statut', (s) => s(200, { hello: 'world' }), 'invalid'],
    ['200 other parcel', (s) => s(200, { ean: 'OTHER', statut: 'Livré' }), 'invalid'],
    ['timeout', () => { /* never answers */ }, 'timeout'],
  ];
  for (const [label, handler, kind] of kinds) {
    const row = await makeParcel('kind');
    mock.handlers.set(row.ean, handler);
    const ev = (await eventsOf(row.id)).length;
    const o = await refreshDeliveryRow(row);
    const saved = await rowById(row.id);
    assert(o.ok === false && o.kind === kind, `${label} -> kind "${kind}" (got ${o.kind})`);
    assert(saved.goodexStatusId === 4 && !saved.trackingNotFoundAt && (await eventsOf(row.id)).length === ev, `${label}: saved status, flag and history untouched`);
    assert(!JSON.stringify(o).includes(API_TOKEN), `${label}: the outcome never carries the API token`);
    if (label === '429 with Retry-After') assert(o.retryAfterMs === 7000, 'Retry-After seconds are returned as milliseconds');
    if (label === '429 empty body') assert(o.retryAfterMs === null, 'no Retry-After header -> null');
  }
  const netRow = await makeParcel('net');
  const savedBase = env.goodex.baseUrl;
  env.goodex.baseUrl = 'http://127.0.0.1:1';
  const netOut = await refreshDeliveryRow(netRow);
  env.goodex.baseUrl = savedBase;
  assert(netOut.ok === false && netOut.kind === 'network' && (await rowById(netRow.id)).goodexStatusId === 4, 'connection refused -> kind "network", nothing saved');
  const cfgRow = await makeParcel('cfg');
  const hitsBefore = mock.gets;
  env.goodex.apiToken = '';
  const cfgOut = await refreshDeliveryRow(cfgRow);
  env.goodex.apiToken = API_TOKEN;
  assert(cfgOut.ok === false && cfgOut.kind === 'config' && cfgOut.configError === true && mock.gets === hitsBefore, 'missing credentials -> kind "config", no request');
  const failedRow = await rowById((await makeParcel('inel')).id);
  const inel = await refreshDeliveryRow({ ...failedRow, state: 'failed' });
  assert(inel.ok === false && inel.kind === 'ineligible', 'a row that is not a created parcel is refused locally');
  assert((await refreshDeliveryRow(null)).kind === 'ineligible', 'a missing row is refused locally');
  // a webhook that lands while the request is in flight wins
  const raceRow = await makeParcel('race');
  mock.handlers.set(raceRow.ean, async (send, ean) => {
    await fetch(`${BASE}/webhooks/goodex`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WEBHOOK_SECRET}` }, body: JSON.stringify({ code: ean, statut: 'Livré' }) });
    return send(200, { ean, statut: 'En Transit', has_motif: 0, motif: '' });
  });
  const raceOut = await refreshDeliveryRow(raceRow);
  assert(raceOut.ok && raceOut.outcome === 'skipped' && (await rowById(raceRow.id)).goodexStatusId === 2, 'a poll that started before a newer webhook is discarded: outcome "skipped"');
  // a database error never throws
  const dbRow = await makeParcel('dberr');
  const realApply = deliveryRepository.applyStatus;
  deliveryRepository.applyStatus = async () => { throw Object.assign(new Error('Failed query: update ... params: secret-looking-params'), { code: '57P01' }); };
  const dbOut = await refreshDeliveryRow(dbRow);
  deliveryRepository.applyStatus = realApply;
  assert(dbOut.ok === false && dbOut.kind === 'internal' && dbOut.dbCode === '57P01' && !JSON.stringify(dbOut).includes('secret-looking-params'), 'a database error becomes kind "internal" without leaking the query text');
  assert(mock.strayPosts === 0, 'no creation request was sent by any refresh');

  // ---------------------------------------------------------------- 4. reconciler runs
  console.log('\n[4] Reconciler runs');
  const fresh = async (n, label, patch = {}) => { const rows = []; for (let i = 0; i < n; i += 1) rows.push(await makeParcel(`${label}${i}`, patch)); return rows; };

  // 4a. batch bound + fairness
  mock.resetCounters();
  const batchRows = await fresh(7, 'batch');
  const rec = reconciler({ batchSize: 3, scope: batchRows });
  const s1 = await rec.runOnce();
  assert(s1.selected === 3 && s1.updated + s1.unchanged === 3, 'a run checks at most one batch');
  const s2 = await rec.runOnce();
  const s3 = await rec.runOnce();
  const polled = await Promise.all(batchRows.map((r) => rowById(r.id)));
  assert(s2.selected === 3 && s3.selected === 1 && polled.every((r) => r.lastPolledAt), 'the next runs pick the parcels not polled yet first: all 7 covered in 3 runs');
  assert(Object.values(mock.hits).every((n) => n === 1), 'no parcel polled twice while others waited');

  // 4b. status changes and unchanged
  mock.resetCounters();
  const [chg, same] = await fresh(2, 'chg');
  mock.handlers.set(chg.ean, (send, ean) => send(200, { ean, statut: 'Livré', has_motif: 0, motif: '' }));
  const evChg = (await eventsOf(chg.id)).length;
  const evSame = (await eventsOf(same.id)).length;
  const sCh = await reconciler({ scope: [chg, same] }).runOnce();
  assert(sCh.updated === 1 && sCh.unchanged === 1 && (await rowById(chg.id)).goodexStatusId === 2, 'a changed status is saved, an unchanged one is not counted as an update');
  assert((await eventsOf(chg.id)).length === evChg + 1 && (await eventsOf(same.id)).length === evSame, 'one event for the change, none for the unchanged parcel');

  // 4c. cancelled / refunded orders and exchanges are reconciled, their Silky status untouched
  mock.resetCounters();
  const canc = await makeParcel('canc', {}, 'cancelled');
  const refd = await makeParcel('refd', {}, 'refunded');
  mock.handlers.set(canc.ean, (send, ean) => send(200, { ean, statut: 'Retour', has_motif: 0, motif: '' }));
  mock.handlers.set(refd.ean, (send, ean) => send(200, { ean, statut: 'Retour Payé', has_motif: 0, motif: '' }));
  mock.handlers.set(P.exchange.ean, (send, ean) => send(200, { ean, statut: 'Livré', has_motif: 0, motif: '' }));
  await db.update(orderDeliveries).set({ lastPolledAt: null }).where(eq(orderDeliveries.id, P.exchange.id));
  const origEx = (await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, P.exchange.orderId))).find((r) => r.exchangeId === null);
  await db.update(orderDeliveries).set({ lastPolledAt: new Date() }).where(eq(orderDeliveries.id, origEx.id));
  const sCr = await reconciler({ scope: [canc, refd, P.exchange] }).runOnce();
  assert(sCr.updated === 3, `cancelled, refunded and exchange parcels were updated (${sCr.updated})`);
  assert((await rowById(canc.id)).goodexStatusId === 6 && (await rowById(refd.id)).goodexStatusId === 11 && (await rowById(P.exchange.id)).goodexStatusId === 2, 'each row got its own provider status');
  assert((await orderStatus(canc.orderId)) === 'cancelled' && (await orderStatus(refd.orderId)) === 'refunded', 'Silky order statuses are untouched');
  assert((await rowById(origEx.id)).goodexStatusId !== 2, 'the exchange status did not leak onto the ordinary parcel');
  await db.update(orderDeliveries).set({ lastPolledAt: ago(DAY) }).where(eq(orderDeliveries.id, refd.id));
  const sTerm = await reconciler({ scope: [refd] }).runOnce();
  assert(sTerm.selected === 0, 'Retour Payé is terminal: not selected again even a day after its last poll');

  // 4d. "introuvable" is not re-polled within its gap
  mock.resetCounters();
  const [lost] = await fresh(1, 'lost');
  mock.handlers.set(lost.ean, (send) => send(200, { statut: 'Colis Introuvable' }));
  const sLost1 = await reconciler({ scope: [lost] }).runOnce();
  assert(sLost1.notFound === 1 && Boolean((await rowById(lost.id)).trackingNotFoundAt), 'first run flags the parcel');
  const sLost2 = await reconciler({ scope: [lost] }).runOnce();
  assert(sLost2.selected === 0 && mock.hits[lost.ean] === 1, 'an immediate second run does not ask again (backoff)');
  const later = await reconciler({ scope: [lost], now: () => new Date(Date.now() + 40 * MIN) }).runOnce();
  assert(later.selected === 1 && later.notFound === 1, 'it is asked again once the first-hour cadence allows');
  const evenLater = await reconciler({ scope: [lost], now: () => new Date(Date.now() + 2 * HOUR + 10 * MIN) }).runOnce();
  await db.update(orderDeliveries).set({ lastPolledAt: new Date(Date.now() + 2 * HOUR + 10 * MIN) }).where(eq(orderDeliveries.id, lost.id)); // the poll happened at that (simulated) time
  const muchLater = await reconciler({ scope: [lost], now: () => new Date(Date.now() + 2 * HOUR + 10 * MIN + 30 * MIN) }).runOnce();
  assert(evenLater.selected === 1 && muchLater.selected === 0, 'after an hour the gap grows to one hour (not re-asked 30 minutes later)');
  const gaveUp = await reconciler({ scope: [lost], now: () => new Date(Date.now() + 16 * DAY) }).runOnce();
  assert(gaveUp.selected === 0, 'a parcel "introuvable" for two weeks is dropped');

  // 4e. concurrency bound
  mock.resetCounters();
  const concRows = await fresh(6, 'conc');
  mock.delayMs = 60;
  await reconciler({ concurrency: 2, scope: concRows }).runOnce();
  assert(mock.maxInflight === 2, `at most 2 simultaneous requests, and they do run in parallel (peak ${mock.maxInflight})`);
  mock.resetCounters();
  const conc1Rows = await fresh(4, 'conc1');
  mock.delayMs = 40;
  await reconciler({ concurrency: 1, scope: conc1Rows }).runOnce();
  assert(mock.maxInflight === 1, 'concurrency 1 is strictly sequential');

  // 4f. no overlapping runs
  mock.resetCounters();
  const ovlRows = await fresh(3, 'ovl');
  mock.delayMs = 80;
  const overlap = reconciler({ concurrency: 1, scope: ovlRows });
  const first = overlap.runOnce();
  await new Promise((r) => setTimeout(r, 20));
  const second = await overlap.runOnce();
  assert(overlap.isRunning() === true && second.skipped === 'already_running', 'a call during a run is a no-op ("already_running")');
  await first;
  assert(mock.gets === 3 && overlap.isRunning() === false, 'the first run completed alone, one request per parcel');

  // 4g. one failing parcel does not abort the batch
  mock.resetCounters();
  const [bad, ok1, ok2] = await fresh(3, 'iso');
  mock.handlers.set(bad.ean, (send) => send(500, { message: 'boom' }));
  const sIso = await reconciler({ concurrency: 1, scope: [bad, ok1, ok2] }).runOnce();
  assert(sIso.errors.server === 1 && sIso.updated + sIso.unchanged === 2 && sIso.aborted === null, 'a server error on one parcel is counted, the others are still checked');
  assert((await rowById(ok1.id)).lastPolledAt && (await rowById(ok2.id)).lastPolledAt && (await rowById(bad.id)).goodexStatusId === 4, 'the failing parcel keeps its saved status');

  // 4h. a malformed answer for one parcel
  mock.resetCounters();
  const [garbled, fine] = await fresh(2, 'garb');
  mock.handlers.set(garbled.ean, (send) => send(200, null, { raw: '{not json' }));
  const sGarb = await reconciler({ concurrency: 1, scope: [garbled, fine] }).runOnce();
  assert(sGarb.errors.invalid === 1 && sGarb.aborted === null && (await rowById(fine.id)).lastPolledAt, 'a malformed answer is isolated to its parcel');

  // 4i. authentication error stops the run
  mock.resetCounters();
  const authRows = await fresh(4, 'auth');
  mock.fallback = (send) => send(401, { message: 'Unauthenticated.' });
  const sAuth = await reconciler({ concurrency: 1, scope: authRows }).runOnce();
  assert(sAuth.aborted === 'auth' && sAuth.errors.auth === 1 && mock.gets === 1, 'a 401 ends the run after a single request');
  const authAgain = await reconciler({ concurrency: 1, scope: authRows }).runOnce();
  assert(authAgain.aborted === 'auth' && mock.gets === 2, 'the next run tries once again (no request storm)');

  // 4j. rate limit pauses the scheduler
  mock.resetCounters();
  const rateRows = await fresh(4, 'rate');
  mock.fallback = (send) => send(429, { message: 'Too Many Attempts.' }, { headers: { 'Retry-After': '900' } });
  let clock = Date.now();
  const limited429 = reconciler({ concurrency: 1, scope: rateRows, now: () => new Date(clock) });
  const sRate = await limited429.runOnce();
  assert(sRate.aborted === 'rate_limit' && mock.gets === 1, 'a 429 ends the run after a single request');
  const paused = await limited429.runOnce();
  assert(paused.skipped === 'paused' && mock.gets === 1, 'the scheduler is paused: the next call sends nothing');
  clock += 16 * MIN;
  mock.fallback = null;
  const resumed = await limited429.runOnce();
  assert(!resumed.skipped && mock.gets > 1, 'it resumes after the Retry-After delay');

  // 4k. provider down: circuit breaker, then per-parcel backoff
  mock.resetCounters();
  const downRows = await fresh(8, 'down');
  mock.fallback = (send) => send(500, { message: 'boom' });
  const down = reconciler({ concurrency: 1, maxTransientFailures: 3, scope: downRows });
  const sDown = await down.runOnce();
  assert(sDown.aborted === 'provider_unavailable' && sDown.errors.server === 3, 'several consecutive server errors end the run');
  assert(down._state().backedOffIds.length === 3, 'the failing parcels are backed off');
  const sDown2 = await down.runOnce();
  const hitIds = new Set(Object.keys(mock.hits));
  assert(sDown2.backedOff === 3 && downRows.filter((r) => hitIds.has(r.ean)).length === 6, 'the next run skips the backed-off parcels and tries the others');
  mock.fallback = null;
  const clock0 = Date.now();
  const lateRun = reconciler({ concurrency: 2, scope: downRows, now: () => new Date(clock0 + 8 * HOUR) });
  assert((await lateRun.runOnce()).selected > 0, 'a fresh reconciler (restart) starts clean');

  // 4l. timeout and network failure classes stop a dead provider quickly
  mock.resetCounters();
  const tmoRows = await fresh(4, 'tmo');
  mock.fallback = () => { /* never answers */ };
  const sTmo = await reconciler({ concurrency: 1, maxTransientFailures: 2, scope: tmoRows }).runOnce();
  assert(sTmo.aborted === 'provider_unavailable' && sTmo.errors.timeout === 2, 'timeouts count as transient failures and end the run');
  mock.fallback = null;
  mock.resetCounters();
  const netRows = await fresh(3, 'net');
  const realBase = env.goodex.baseUrl;
  env.goodex.baseUrl = 'http://127.0.0.1:1';
  const sNet = await reconciler({ concurrency: 1, maxTransientFailures: 2, scope: netRows }).runOnce();
  env.goodex.baseUrl = realBase;
  assert(sNet.aborted === 'provider_unavailable' && sNet.errors.network === 2, 'network errors count as transient failures and end the run');

  // 4m. not configured / live gate: nothing is sent
  mock.resetCounters();
  await fresh(2, 'cfg');
  env.goodex.apiToken = '';
  const sCfg = await createDeliveryReconciler({
    intervalMinutes: 10,
    findCandidates: async () => { throw new Error('must not query'); },
  }).runOnce();
  env.goodex.apiToken = API_TOKEN;
  assert(sCfg.skipped === 'not_configured' && mock.gets === 0, 'without credentials the run is skipped before any query or request');

  // 4n. a stale webhook status is corrected by the reconciliation
  mock.resetCounters();
  const [stale] = await fresh(1, 'stale');
  mock.handlers.set(stale.ean, (send, ean) => send(200, { ean, statut: 'Livré', has_motif: 0, motif: '' }));
  await reconciler({ scope: [stale] }).runOnce();
  assert((await rowById(stale.id)).goodexStatusId === 2, 'the real status (Livré) is saved by a poll');
  _resetRateLimits();
  await fetch(`${BASE}/webhooks/goodex`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WEBHOOK_SECRET}` }, body: JSON.stringify({ code: stale.ean, statut: 'En Transit' }) });
  const regressed = await rowById(stale.id);
  assert(regressed.goodexStatusId === 4 && regressed.lastWebhookAt, 'a late older webhook regresses the saved status (known limitation)');
  const notDue = await reconciler({ scope: [stale] }).runOnce();
  assert(notDue.selected === 0, 'right after a poll the parcel is not asked again');
  await db.update(orderDeliveries).set({ lastPolledAt: ago(10 * MIN) }).where(eq(orderDeliveries.id, stale.id));
  const repaired = await reconciler({ scope: [stale] }).runOnce();
  const healed = await rowById(stale.id);
  assert(repaired.selected === 1 && healed.goodexStatusId === 2, 'a recent webhook does not shield the parcel: the next due run restores the real status');
  const lastEvent = (await eventsOf(stale.id)).slice(-1)[0];
  assert(lastEvent.source === 'poll' && lastEvent.goodexStatusId === 2, 'the history records the correction as a poll');

  // ---------------------------------------------------------------- 5. safety
  console.log('\n[5] Safety');
  assert(mock.strayPosts === 0, 'no creation request reached GOODEX during any reconciliation run');
  const source = fs.readFileSync(new URL('../services/delivery.reconciler.js', import.meta.url), 'utf8');
  const forbidden = ['ensureParcel', 'retryParcel', 'retryExchangeParcel', 'createParcel', 'claimNew', 'reclaim', 'linkExistingEan', 'markCreated'];
  assert(forbidden.every((word) => !source.includes(word)), 'the reconciler source references no creation / retry / link function');
  const reconLines = logged.filter((l) => l.includes('[reconciler]'));
  assert(reconLines.length > 0 && reconLines.every((l) => !l.includes('REC-') && !/Reco Client|12345678|7 Rue Reconciliation/i.test(l) && !l.includes(API_TOKEN)), `reconciler log lines (${reconLines.length}) carry only counts: no tracking codes, customer data or token`);
  const secrets = logged.filter((l) => l.includes(API_TOKEN) || l.includes(WEBHOOK_SECRET));
  assert(secrets.length === 0, 'no log line contains the API token or the webhook secret');

  await new Promise((r) => httpServer.close(r));
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
  failed += 1;
} finally {
  await cleanup();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}
