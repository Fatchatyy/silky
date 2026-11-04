/**
 * GOODEX exchange-parcel integration tests (no real GOODEX account needed).
 *
 * A local mock HTTP server stands in for GOODEX; env.goodex.baseUrl is pointed at it and the
 * script refuses to run against any non-loopback host. Requires DATABASE_URL pointing at a
 * DEDICATED TEST database (its name must contain "test"; ALLOW_NON_TEST_DB=1 overrides at
 * your own risk). Cleans up the rows it creates. No real credentials, no real GOODEX host.
 *
 * Covers: one separate parcel per confirmed exchange (echange=1, cod = the stored "montant
 * à payer", decharge always 0), both Échange and Échange payé, the original parcel left untouched,
 * history/details unchanged, duplicate/concurrent protection, failures that never undo the
 * exchange, the unknown-outcome retry safeguard, no ordinary-parcel side effects, webhook and
 * refresh on the exchange parcel, and the live-call guard on the exchange path.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://.../silky_test'; node server/scripts/test_goodex_exchange.js
 */

import http from 'http';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { liveCallBlockReason, resolveExchangeAddress } from '../config/goodex.js';
import { db } from '../db/orm.js';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  products,
  productVariants,
  categories,
  orders,
  users,
  orderExchanges,
  orderDeliveries,
  orderDeliveryEvents,
} from '../models/index.js';
import { _resetRateLimits } from '../middleware/rateLimiter.js';
import { signAccessToken } from '../services/token.service.js';
import { runOrderDeliveriesMigration } from '../db/migrations/add_order_deliveries.js';
import { runExchangeDeliveriesMigration } from '../db/migrations/add_exchange_deliveries.js';
import { runRefundDeliveriesMigration } from '../db/migrations/add_refund_deliveries.js';
import { ensureParcelForExchange, ensureParcelForOrder } from '../services/delivery.service.js';
import * as exchangeService from '../services/exchange.service.js';
import { pool } from '../db/pool.js';

// Everything printed (by the tests and by the app) is captured to prove no credential leaks.
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
  const res = await fetch(`${BASE}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

let eanCounter = 0;
function startMock() {
  mock.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/api/v1/colis/create') {
        const record = { fields: parseMultipart(raw), contentType: req.headers['content-type'] || '', accept: req.headers.accept || '' };
        mock.creates.push(record);
        const handler = mock.onCreate || ((r, reply) => {
          eanCounter += 1;
          reply(200, {
            id: 700000 + eanCounter, ean: `XEAN${eanCounter}-${Date.now()}`, user_id: 9999, client: r.fields.client,
            cod: Number(r.fields.cod), adresse: r.fields.adresse, governorat: r.fields.governorat, gsm1: r.fields.gsm1,
            last_statut: 12, echange: Number(r.fields.echange || 0), decharge: Number(r.fields.decharge || 0), created_at: '2026-07-14 10:30:00',
          });
        });
        return handler(record, send);
      }
      if (req.method === 'GET' && req.url.startsWith('/api/v1/colis/etat/')) {
        mock.tracks.push(req.url);
        const handler = mock.onTrack || ((u, reply) => reply(200, { statut: 'En cours' }));
        return handler(req.url, send);
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  return new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
}

// ------------------------------------------------------------------ fixtures
const created = { orderIds: [], productIds: [] };
let robe; // 59 TND
let ensemble; // 35 TND

async function makeProduct(name, price) {
  const res = await request('/products', {
    method: 'POST',
    token: adminToken,
    body: {
      name, description: 'd', collectionImage: '/pictures/collection.jpg', slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`,
      price, category: 'femme', colors: [{ id: 'noir', name: 'Noir', image: '/pictures/noir.jpg' }], sizes: ['M'], stock: { 'noir-M': 200 },
    },
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`product creation failed: ${res.status} ${JSON.stringify(res.data)}`);
  created.productIds.push(res.data.id);
  const [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, res.data.id));
  return variant;
}

async function makeOrder() {
  _resetRateLimits();
  const res = await request('/orders', {
    method: 'POST',
    body: {
      customer: { name: 'Test Client', phone: '12345678', address: '12 Rue Test', governorate: 'Tunis' },
      items: [{ variantId: ensemble.id, quantity: 1 }],
    },
  });
  if (res.status !== 201) throw new Error(`order creation failed: ${res.status} ${JSON.stringify(res.data)}`);
  created.orderIds.push(res.data.id);
  return res.data;
}

async function confirm(orderId) {
  _resetRateLimits();
  return request(`/orders/${orderId}/confirm`, { method: 'POST', token: adminToken });
}

const EXCHANGE_CUSTOMER = {
  customerName: 'Client Echange',
  phoneNumber: '22334455',
  shippingAddress: 'Béja — 5 Avenue Habib Bourguiba',
};

function exchangeBody(overrides = {}) {
  return {
    customer: EXCHANGE_CUSTOMER,
    items: [
      { variantId: ensemble.id, action: 'keep', quantity: 1 },
      { variantId: robe.id, action: 'add', quantity: 1 },
    ],
    paymentResponsibility: 'silky_paid',
    ...overrides,
  };
}

function postExchange(orderId, body) {
  _resetRateLimits();
  return request(`/admin/orders/${orderId}/exchange`, { method: 'POST', token: adminToken, body });
}

const ordinaryRow = async (orderId) => (await db.select().from(orderDeliveries)
  .where(and(eq(orderDeliveries.orderId, orderId), isNull(orderDeliveries.exchangeId))))[0] || null;
const exchangeDeliveryRow = async (exchangeId) => (await db.select().from(orderDeliveries)
  .where(eq(orderDeliveries.exchangeId, exchangeId)))[0] || null;
const exchangeCount = async (orderId) => (await db.select().from(orderExchanges).where(eq(orderExchanges.orderId, orderId))).length;
const orderRow = async (orderId) => (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
const eventCount = async (deliveryId) => (await db.select().from(orderDeliveryEvents).where(eq(orderDeliveryEvents.deliveryId, deliveryId))).length;

// --------------------------------------------------------------------- tests
async function run() {
  const dbName = new URL(env.databaseUrl).pathname.slice(1);
  if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== '1') {
    throw new Error(`Refusing to run against database "${dbName}": use a dedicated test database (name containing "test")`);
  }
  await runOrderDeliveriesMigration(pool);
  await runExchangeDeliveriesMigration(pool);
  await runExchangeDeliveriesMigration(pool); // idempotent
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
  if (new URL(env.goodex.baseUrl).hostname !== '127.0.0.1') throw new Error('Refusing to run against a non-loopback GOODEX URL');

  let [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) {
    [admin] = await db.insert(users).values({
      email: `admin-goodex-ex-${Date.now()}@silky.tn`, passwordHash: 'fakehash', fullName: 'Admin GOODEX', role: 'admin',
    }).returning();
  }
  adminToken = signAccessToken(admin);

  let [category] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!category) [category] = await db.insert(categories).values({ name: 'Femme', slug: 'femme' }).returning();
  robe = await makeProduct('Robe Élégante', 59);
  ensemble = await makeProduct('Ensemble Enfant', 35);

  // ---------------------------------------------- 1. Échange payé creates its own parcel
  console.log('\n[1] Échange payé (silky_paid) creates a separate parcel');
  mock.reset();
  const oA = await makeOrder();
  await confirm(oA.id);
  const origBefore = await ordinaryRow(oA.id);
  const origEventsBefore = await eventCount(origBefore.id);
  assert(origBefore.state === 'created' && mock.creates.length === 1, 'the ordinary order parcel exists first (one request)');
  const stockRobeBefore = (await db.select().from(productVariants).where(eq(productVariants.id, robe.id)))[0].stockQuantity;

  const exA1 = await postExchange(oA.id, exchangeBody());
  assert(exA1.status === 201, `exchange accepted (${exA1.status})`);
  const ex1 = exA1.data.exchanges[0];
  assert(mock.creates.length === 2, 'exactly one additional GOODEX request for the exchange');
  const f1 = mock.creates[1].fields;
  assert(mock.creates[1].contentType.startsWith('multipart/form-data') && mock.creates[1].accept === 'application/json', 'multipart/form-data with Accept: application/json');
  assert(f1.echange === '1', 'echange=1');
  assert(f1.decharge === '0', 'decharge=0 transmitted');
  assert(f1.token === API_TOKEN && f1.user_id === '9999', 'token and user_id come from configuration');
  assert(f1.client === 'Client Echange' && f1.gsm1 === '22334455', 'exchange customer name and primary phone');
  assert(f1.adresse === '5 Avenue Habib Bourguiba' && f1.governorat === 'Beja', 'address without prefix; "Béja" normalized to GOODEX "Beja"');
  assert(!('gsm2' in f1) && f1.last_statut === '12', 'no gsm2 (not recorded); last_statut=12 sent');
  assert(f1.remarque.includes('Ensemble Enfant') && f1.remarque.includes('Robe Élégante') && f1.nbre === '2', `remarque lists the exchange products, nbre=2 (${f1.remarque})`);
  assert(!('designation' in f1), 'designation is not sent');

  // Existing history example: Robe 59 + Ensemble 35, delivery 0, amount added 59.
  assert(ex1.subtotal === 94 && ex1.deliveryFee === 0 && ex1.total === 94 && ex1.productAmountAdded === 59, 'history: total 94, delivery 0, amount added to products 59');
  assert(ex1.items.length === 2 && ex1.items.some((i) => i.name === 'Robe Élégante' && i.quantity === 1 && i.price === 59) && ex1.items.some((i) => i.name === 'Ensemble Enfant' && i.price === 35), 'history: exchanged products and prices unchanged');
  assert(ex1.customerAmountToPay === 59 && f1.cod === '59.000', `cod = the stored montant à payer 59.000, not the exchange total 94 (${f1.cod})`);
  const [exRow1] = await db.select().from(orderExchanges).where(eq(orderExchanges.id, ex1.id));
  assert(exRow1.decharge === null && Number(exRow1.productAmountAdded) + Number(exRow1.deliveryFee) === 59, 'no decharge is stored on the exchange; stored fields add up to the cod');
  assert(!('decharge' in ex1) && ex1.delivery?.state === 'created', 'response carries no decharge and exposes the exchange\'s own delivery');

  const d1 = await exchangeDeliveryRow(ex1.id);
  assert(d1?.state === 'created' && d1.ean?.startsWith('XEAN') && d1.goodexParcelId > 700000, 'exchange delivery stores the returned ean and parcel id');
  assert(d1.exchangeId === ex1.id && d1.orderId === oA.id && Number(d1.codAmount) === 59, 'delivery row is linked to the exchange and the order; cod snapshot saved');
  assert(d1.goodexStatusId === 12 && ex1.delivery.ean === d1.ean, 'initial GOODEX status stored; response ean matches');
  const origAfter = await ordinaryRow(oA.id);
  assert(origAfter.ean === origBefore.ean && origAfter.id === origBefore.id && origAfter.goodexStatusId === origBefore.goodexStatusId
    && origAfter.updatedAt.getTime() === origBefore.updatedAt.getTime() && origAfter.attemptCount === origBefore.attemptCount, 'original parcel row (ean, status, timestamps) untouched');
  assert((await eventCount(origAfter.id)) === origEventsBefore, 'original parcel tracking history unchanged');
  assert(exA1.data.delivery?.ean === origBefore.ean, 'the order still reports the original parcel as its delivery');
  assert((await db.select().from(orderDeliveries).where(and(eq(orderDeliveries.orderId, oA.id), isNull(orderDeliveries.exchangeId)))).length === 1, 'still exactly one ordinary parcel row');
  assert(exA1.data.status === 'exchanged' && (await orderRow(oA.id)).status === 'exchanged', 'Silky order status is "exchanged" (GOODEX status is separate)');
  const stockRobeAfter = (await db.select().from(productVariants).where(eq(productVariants.id, robe.id)))[0].stockQuantity;
  assert(stockRobeAfter === stockRobeBefore - 1, 'exchange stock logic unchanged');
  assert(!JSON.stringify(exA1.data).includes(API_TOKEN), 'API token never appears in responses');

  // ------------------------------------------ 2. Échange (customer_paid, decharge=0), same order
  console.log('\n[2] Échange (customer_paid) on the same order gets its own, independent parcel');
  const exA2 = await postExchange(oA.id, exchangeBody({
    items: [{ variantId: ensemble.id, action: 'keep', quantity: 1 }, { variantId: robe.id, action: 'add', quantity: 1 }],
    paymentResponsibility: 'customer_paid',
  }));
  assert(exA2.status === 201 && mock.creates.length === 3, 'second exchange creates a second request');
  const ex2 = exA2.data.exchanges[0];
  const f2 = mock.creates[2].fields;
  assert(ex2.id !== ex1.id && ex2.paymentResponsibility === 'customer_paid', 'a new exchange record');
  assert(f2.echange === '1' && f2.decharge === '0', 'echange=1 and decharge=0 transmitted');
  assert(ex2.deliveryFee === 8 && ex2.productAmountAdded === 59 && ex2.total === 161, 'history: total 161 = 153 + 8 delivery, 59 added');
  assert(ex2.customerAmountToPay === 67 && f2.cod === '67.000', `cod = 59 added + 8 delivery = 67.000, not the total 161 (${f2.cod})`);
  const d2 = await exchangeDeliveryRow(ex2.id);
  assert(d2?.state === 'created' && d2.ean !== d1.ean && d2.id !== d1.id, 'independent delivery row and ean for the second exchange');
  assert((await exchangeDeliveryRow(ex1.id)).ean === d1.ean, 'the first exchange parcel is unchanged');
  assert((await ordinaryRow(oA.id)).ean === origBefore.ean, 'the original parcel is still unchanged');

  // --------------------------------------------------------------- 3. history and listing
  console.log('\n[3] Existing exchange history is intact');
  _resetRateLimits();
  const list = await request('/orders', { token: adminToken });
  const listed = list.data.find((o) => o.id === oA.id);
  const lh1 = listed.exchanges.find((e) => e.id === ex1.id);
  assert(listed.exchanges.length === 2 && lh1.exchangeNumber === ex1.exchangeNumber && lh1.items.length === 2, 'list shows both exchanges with their products');
  assert(lh1.total === 94 && lh1.customerAmountToPay === 59 && lh1.productAmountAdded === 59 && lh1.productRefundObligation === 0, 'list: unchanged amounts for the exchange');
  assert(lh1.delivery?.ean === d1.ean && listed.exchanges.find((e) => e.id === ex2.id).delivery?.ean === d2.ean && listed.delivery?.ean === origBefore.ean, 'list attaches each exchange its own delivery; the order keeps its own');
  // ------------------------------------------------- 4. decharge is not asked and always 0
  console.log('\n[4] decharge is not requested and always sent as 0');
  const oB = await makeOrder();
  await confirm(oB.id);
  const strDecharge = await postExchange(oB.id, exchangeBody());
  assert(strDecharge.status === 201 && mock.creates[mock.creates.length - 1].fields.decharge === '0' && mock.creates[mock.creates.length - 1].fields.echange === '1', 'an exchange without any decharge is accepted: echange=1, decharge=0');
  const oB2 = await makeOrder();
  await confirm(oB2.id);
  const ignoredDecharge = await postExchange(oB2.id, exchangeBody({ decharge: 1 }));
  assert(ignoredDecharge.status === 201 && mock.creates[mock.creates.length - 1].fields.decharge === '0', 'a decharge sent by an older client is ignored: still decharge=0');

  // -------------------------------------------- 5. duplicates and concurrency
  console.log('\n[5] Duplicate / concurrent protection');
  const exB = strDecharge.data.exchanges[0];
  const dup0 = mock.creates.length;
  const again = await ensureParcelForExchange(exB.id);
  assert(again?.state === 'created' && mock.creates.length === dup0, 'ensureParcelForExchange on a created exchange sends nothing');
  _resetRateLimits();
  const retryCreated = await request(`/orders/exchanges/${exB.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(retryCreated.status === 409 && mock.creates.length === dup0, 'admin retry on a created parcel -> 409, no request');
  const parallel = await Promise.all(Array.from({ length: 6 }, () => ensureParcelForExchange(exB.id)));
  assert(mock.creates.length === dup0 && parallel.every((r) => r?.state === 'created'), 'repeated parallel calls send nothing');

  const oC = await makeOrder();
  await confirm(oC.id);
  const c0 = mock.creates.length;
  mock.onCreate = (r, reply) => setTimeout(() => reply(200, { id: 810001, ean: `XSLOW-${Date.now()}`, last_statut: 12 }), 200);
  const slowExchange = postExchange(oC.id, exchangeBody());
  let slowExchangeId = null;
  for (let i = 0; i < 100 && !slowExchangeId; i += 1) {
    await new Promise((r) => setTimeout(r, 15));
    slowExchangeId = (await db.select().from(orderExchanges).where(eq(orderExchanges.orderId, oC.id)))[0]?.id || null;
  }
  const during = await Promise.all([
    ...Array.from({ length: 5 }, () => ensureParcelForExchange(slowExchangeId)),
    ...Array.from({ length: 3 }, () => { _resetRateLimits(); return request(`/orders/exchanges/${slowExchangeId}/delivery/retry`, { method: 'POST', token: adminToken, body: {} }); }),
  ]);
  const slowRes = await slowExchange;
  assert(slowRes.status === 201 && mock.creates.length - c0 === 1, 'while the first request is in flight, concurrent ensure/retry calls send nothing more (one request in total)');
  assert(during.slice(5).every((r) => r.status === 409), 'concurrent admin retries are refused with 409');
  assert((await db.select().from(orderDeliveries).where(eq(orderDeliveries.exchangeId, slowExchangeId))).length === 1, 'a single delivery row for the exchange');
  mock.onCreate = null;

  // -------------------------------------------- 6. failures never undo the exchange
  console.log('\n[6] Failures keep the exchange');
  const oD = await makeOrder();
  await confirm(oD.id);
  mock.onCreate = (r, reply) => reply(422, { adresse: ['The adresse is invalid.'] });
  const d0 = mock.creates.length;
  const f422 = await postExchange(oD.id, exchangeBody());
  const exD = f422.data.exchanges[0];
  const dD = await exchangeDeliveryRow(exD.id);
  assert(f422.status === 201 && f422.data.status === 'exchanged' && (await exchangeCount(oD.id)) === 1, 'HTTP 422 from GOODEX: the exchange is still confirmed and saved');
  assert(dD.state === 'failed' && /adresse : The adresse is invalid\./.test(dD.lastError) && exD.delivery.state === 'failed', 'delivery recorded as failed with the provider message, visible in the response');
  assert(mock.creates.length - d0 === 1, 'one request only (no automatic retry)');
  const ordD = await ordinaryRow(oD.id);
  assert(ordD.state === 'created', 'the ordinary parcel is unaffected by the exchange parcel failure');
  mock.onCreate = null;
  _resetRateLimits();
  const retryFailed = await request(`/orders/exchanges/${exD.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  const dD2 = await exchangeDeliveryRow(exD.id);
  assert(retryFailed.status === 200 && dD2.state === 'created' && dD2.attemptCount === 2 && mock.creates[mock.creates.length - 1].fields.echange === '1', 'admin retry of a failed exchange parcel succeeds with echange=1');
  assert(Number(dD2.codAmount) === 59 && mock.creates[mock.creates.length - 1].fields.cod === '59.000', 'the retry sends the same stored montant à payer (59.000)');
  const oZ = await makeOrder();
  await confirm(oZ.id);
  const free = await postExchange(oZ.id, exchangeBody({ items: [{ variantId: ensemble.id, action: 'replace', quantity: 1 }] }));
  assert(free.status === 201 && free.data.exchanges[0].customerAmountToPay === 0 && mock.creates[mock.creates.length - 1].fields.cod === '0.000'
    && free.data.exchanges[0].delivery.state === 'created', 'a free exchange (nothing to collect) sends cod=0.000');

  // Unknown outcome (timeout): never retried automatically, retry needs the acknowledgement.
  const oE = await makeOrder();
  await confirm(oE.id);
  mock.onCreate = (r, reply) => setTimeout(() => reply(200, { id: 820001, ean: `XLATE-${Date.now()}`, last_statut: 12 }), 900);
  const e0 = mock.creates.length;
  const timedOut = await postExchange(oE.id, exchangeBody());
  const exE = timedOut.data.exchanges[0];
  assert(timedOut.status === 201 && (await exchangeDeliveryRow(exE.id)).state === 'unknown', 'timeout -> exchange saved, delivery "unknown"');
  _resetRateLimits();
  const noAck = await request(`/orders/exchanges/${exE.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(noAck.status === 409 && mock.creates.length - e0 === 1, 'unknown outcome: retry without acknowledgement -> 409, no request');
  const falseAck = await request(`/orders/exchanges/${exE.id}/delivery/retry`, { method: 'POST', token: adminToken, body: { acknowledgeUnknown: 'true' } });
  assert(falseAck.status === 409 && mock.creates.length - e0 === 1, 'a non-boolean acknowledgement does not count');
  await new Promise((r) => setTimeout(r, 700)); // let the late reply drain
  mock.onCreate = null;
  const ack = await request(`/orders/exchanges/${exE.id}/delivery/retry`, { method: 'POST', token: adminToken, body: { acknowledgeUnknown: true } });
  assert(ack.status === 200 && (await exchangeDeliveryRow(exE.id)).state === 'created' && mock.creates.length - e0 === 2, 'with the acknowledgement the retry sends exactly one more request');

  // 5xx -> unknown, no auto retry.
  const oF = await makeOrder();
  await confirm(oF.id);
  mock.onCreate = (r, reply) => reply(500, { message: 'boom' });
  const g0 = mock.creates.length;
  const r500 = await postExchange(oF.id, exchangeBody());
  assert((await exchangeDeliveryRow(r500.data.exchanges[0].id)).state === 'unknown' && mock.creates.length - g0 === 1, 'HTTP 500 -> unknown, single request');
  mock.onCreate = null;
  const oG = await makeOrder();
  await confirm(oG.id); // confirmed with a working mock: the exchange guard needs a created order parcel
  mock.onCreate = (r, reply) => reply(200, { message: 'no ean here' });
  const rBad = await postExchange(oG.id, exchangeBody());
  const dBad = await exchangeDeliveryRow(rBad.data.exchanges[0].id);
  assert(dBad.state === 'unknown' && !dBad.ean && /ean/.test(dBad.lastError), 'a 200 without an ean is never treated as a created parcel');
  mock.onCreate = null;

  // Local validation: unusable address data is caught before any request.
  const oH = await makeOrder();
  await confirm(oH.id);
  const h0 = mock.creates.length;
  const logStart = logged.length;
  const badGov = await postExchange(oH.id, exchangeBody({ customer: { ...EXCHANGE_CUSTOMER, shippingAddress: 'Atlantis — 5 rue du Port' } }));
  const dBadGov = await exchangeDeliveryRow(badGov.data.exchanges[0].id);
  assert(badGov.status === 201 && dBadGov.state === 'failed' && /Gouvernorat invalide/.test(dBadGov.lastError) && mock.creates.length === h0, 'unknown governorate: exchange saved, delivery failed locally, zero requests');
  const addressLogLeaks = logged.slice(logStart).filter((l) => /Atlantis|5\s+rue\s+du\s+Port/i.test(l));
  assert(addressLogLeaks.length === 0 && /Atlantis/.test(dBadGov.lastError), `an invalid exchange address is not echoed in the logs (${addressLogLeaks.length} leaked) while the admin still sees the cause`);
  assert(resolveExchangeAddress('5 rue sans gouvernorat').error && resolveExchangeAddress('12 — rue').error && resolveExchangeAddress('Tunis — ').error, 'address helper rejects: no prefix, numeric prefix, empty street');
  assert(resolveExchangeAddress('Médenine — Rue 1').governorat === 'Medenine' && resolveExchangeAddress('Gabès — x').governorat === 'Gabes', 'accents are normalized to the canonical GOODEX names');

  // An exchange created through the service with no decharge at all reaches GOODEX normally.
  const oI = await makeOrder();
  await confirm(oI.id);
  const i0 = mock.creates.length;
  await exchangeService.createExchange({ orderId: oI.id, customer: EXCHANGE_CUSTOMER, items: exchangeBody().items, paymentResponsibility: 'silky_paid' });
  const [exI] = await db.select().from(orderExchanges).where(eq(orderExchanges.orderId, oI.id));
  const dI = await exchangeDeliveryRow(exI.id);
  assert(dI.state === 'created' && mock.creates.length === i0 + 1 && mock.creates[i0].fields.decharge === '0', 'no decharge anywhere -> the parcel is still created with decharge=0');

  // -------------------------------------- 6b. server-side guard: no exchange / delivery while a parcel is missing
  console.log('\n[6b] Exchange, deliver and refund wait for the GOODEX parcels');
  const oGuardA = await makeOrder();
  mock.onCreate = (r, reply) => reply(422, { adresse: ['The adresse is invalid.'] });
  await confirm(oGuardA.id);
  mock.onCreate = null;
  const kk0 = mock.creates.length;
  const exOnFailedOrder = await postExchange(oGuardA.id, exchangeBody());
  assert(exOnFailedOrder.status === 409 && /colis GOODEX/.test(exOnFailedOrder.data?.error || '') && (await exchangeCount(oGuardA.id)) === 0 && mock.creates.length === kk0,
    `exchange refused (409) while the order's own parcel failed: no exchange saved, no request (HTTP ${exOnFailedOrder.status})`);
  _resetRateLimits();
  await request(`/orders/${oGuardA.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  const exAfterRetry = await postExchange(oGuardA.id, exchangeBody());
  assert(exAfterRetry.status === 201 && exAfterRetry.data.exchanges[0].delivery.state === 'created', 'once the order parcel exists the exchange goes through');

  const oGuardB = await makeOrder();
  await confirm(oGuardB.id);
  mock.onCreate = (r, reply) => reply(422, { adresse: ['The adresse is invalid.'] });
  const exGuardB = await postExchange(oGuardB.id, exchangeBody());
  mock.onCreate = null;
  assert(exGuardB.status === 201 && exGuardB.data.exchanges[0].delivery.state === 'failed', 'an exchange whose own parcel failed is still saved');
  const secondExGuard = await postExchange(oGuardB.id, exchangeBody());
  _resetRateLimits();
  const deliverGuard = await request(`/orders/${oGuardB.id}/deliver`, { method: 'POST', token: adminToken });
  _resetRateLimits();
  const refundGuard = await request(`/orders/${oGuardB.id}/refund`, { method: 'POST', token: adminToken });
  assert(secondExGuard.status === 409 && deliverGuard.status === 409 && refundGuard.status === 409 && (await exchangeCount(oGuardB.id)) === 1,
    `with a failed exchange parcel: new exchange, deliver and refund are refused (${secondExGuard.status}/${deliverGuard.status}/${refundGuard.status})`);
  _resetRateLimits();
  await request(`/orders/exchanges/${exGuardB.data.exchanges[0].id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  _resetRateLimits();
  const deliverGuard2 = await request(`/orders/${oGuardB.id}/deliver`, { method: 'POST', token: adminToken });
  assert(deliverGuard2.status === 200, `deliver works once the exchange parcel is created (HTTP ${deliverGuard2.status})`);

  // -------------------------------------- 7. webhook and refresh act on the exchange parcel only
  console.log('\n[7] Webhook and refresh');
  _resetRateLimits();
  const hook = await request('/webhooks/goodex', {
    method: 'POST', headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` }, body: { code: d1.ean, statut: 'Livré', motif: '' },
  });
  const d1After = await exchangeDeliveryRow(ex1.id);
  assert(hook.status === 200 && d1After.goodexStatusId === 2, 'webhook for the exchange ean updates the exchange parcel');
  // "Colis Introuvable" through the webhook flags the exchange parcel only; it never replaces its status.
  const nfHook = await request('/webhooks/goodex', { method: 'POST', headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` }, body: { code: d1.ean, statut: 'Colis Introuvable' } });
  const d1Nf = await exchangeDeliveryRow(ex1.id);
  assert(nfHook.status === 200 && d1Nf.goodexStatusId === 2 && Boolean(d1Nf.trackingNotFoundAt), '"Colis Introuvable" webhook on an exchange parcel: flagged, saved status (Livré) kept');
  const nfAgain = await request('/webhooks/goodex', { method: 'POST', headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` }, body: { code: d1.ean, statut: 'Colis Introuvable' } });
  assert(nfAgain.status === 200 && nfAgain.data.result === 'duplicate', 'a repeated "introuvable" notification is an idempotent duplicate');
  assert((await ordinaryRow(oA.id)).trackingNotFoundAt === null, 'the original parcel is not flagged by an exchange notification');
  const origHook = await ordinaryRow(oA.id);
  assert(origHook.goodexStatusId === 12 && origHook.updatedAt.getTime() === origBefore.updatedAt.getTime(), 'the original parcel did not change');
  mock.tracks = [];
  _resetRateLimits();
  const refresh = await request(`/orders/exchanges/${ex2.id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} });
  assert(refresh.status === 200 && mock.tracks.length === 1 && mock.tracks[0].includes(encodeURIComponent(d2.ean)), 'refresh tracks the exchange ean');
  assert((await ordinaryRow(oA.id)).lastPolledAt === null, 'the original parcel was not polled');
  assert((await exchangeDeliveryRow(ex2.id)).goodexStatusId === 1, 'GOODEX status stored separately (id 1) while the Silky exchange is unchanged');

  // ------------------------------------- 8. ordinary orders and no cross-triggering
  console.log('\n[8] Ordinary orders unaffected');
  const oJ = await makeOrder();
  const j0 = mock.creates.length;
  const cJ = await confirm(oJ.id);
  assert(cJ.status === 200 && mock.creates.length - j0 === 1 && !('echange' in mock.creates[mock.creates.length - 1].fields) && !('decharge' in mock.creates[mock.creates.length - 1].fields), 'ordinary confirmation still creates one parcel, without echange/decharge');
  assert((await ordinaryRow(oJ.id)).exchangeId === null, 'ordinary parcel row has no exchange id');
  const k0 = mock.creates.length;
  const noOrdinaryAfterExchange = await ensureParcelForOrder(oA.id);
  assert(noOrdinaryAfterExchange === null && mock.creates.length === k0, 'ensureParcelForOrder does nothing for an exchanged order');
  const oK = await makeOrder();
  await confirm(oK.id);
  const l0 = mock.creates.length;
  await postExchange(oK.id, exchangeBody());
  assert(mock.creates.length - l0 === 1 && (await db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, oK.id))).length === 2, 'one exchange = one request and exactly two rows (ordinary + exchange)');

  // -------------------------------------------------------- 9. live-call guard on the exchange path
  console.log('\n[9] Live-call guard');
  assert(liveCallBlockReason({ baseUrl: 'https://transport.goodex.tn', enableLive: true, nodeEnv: 'production', databaseUrl: env.databaseUrl }), 'enableLive=true with a test database is still blocked');
  assert(liveCallBlockReason({ baseUrl: 'https://transport.goodex.tn', enableLive: true, nodeEnv: 'test', databaseUrl: 'postgres://u:p@h/silky' }), 'enableLive=true under NODE_ENV=test is still blocked');
  assert(liveCallBlockReason({ baseUrl: 'https://transport.goodex.tn', enableLive: false, nodeEnv: 'production', databaseUrl: 'postgres://u:p@h/silky' }), 'a non-test run without GOODEX_ENABLE_LIVE is blocked');
  const oL = await makeOrder();
  await confirm(oL.id);
  const realFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = (url, init) => {
    const host = new URL(String(url)).hostname;
    if (host !== '127.0.0.1') {
      outbound.push(String(url));
      return Promise.reject(new Error('non-loopback request attempted in test'));
    }
    return realFetch(url, init);
  };
  const saved = { baseUrl: env.goodex.baseUrl, enableLive: env.goodex.enableLive };
  try {
    env.goodex.baseUrl = 'https://transport.goodex.tn';
    env.goodex.enableLive = true;
    await exchangeService.createExchange({ orderId: oL.id, customer: EXCHANGE_CUSTOMER, items: exchangeBody().items, paymentResponsibility: 'silky_paid' });
    const [exL] = await db.select().from(orderExchanges).where(eq(orderExchanges.orderId, oL.id));
    const dL = await exchangeDeliveryRow(exL.id);
    assert(dL.state === 'failed' && /Appels GOODEX réels bloqués/.test(dL.lastError), 'exchange parcel creation is refused by the guard (configuration error, state failed)');
    assert(outbound.length === 0, `no request left the machine (${outbound.length} outbound)`);
  } finally {
    globalThis.fetch = realFetch;
    env.goodex.baseUrl = saved.baseUrl;
    env.goodex.enableLive = saved.enableLive;
  }

  const leaks = logged.filter((line) => line.includes(API_TOKEN) || line.includes(WEBHOOK_SECRET));
  assert(leaks.length === 0, `no log line contains the API token or the webhook secret (${leaks.length} found)`);

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
  failed++;
} finally {
  await cleanup();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}
