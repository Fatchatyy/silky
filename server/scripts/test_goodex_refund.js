/**
 * GOODEX refund-parcel integration tests (no real GOODEX account needed).
 *
 * A local mock HTTP server stands in for GOODEX; env.goodex.baseUrl is pointed at it and the
 * script refuses to run against any non-loopback host. Requires DATABASE_URL pointing at a
 * DEDICATED TEST database (its name must contain "test"; ALLOW_NON_TEST_DB=1 overrides at
 * your own risk). Cleans up the rows it creates. No real credentials, no real GOODEX host.
 *
 * Covers: Remboursement and Remboursement gratuit each create one separate parcel with
 * cod = the refund's stored "montant à payer" (8.000 / 0.000), echange=0 and decharge=0,
 * the ordinary parcel left untouched, the address taken from the order or from the latest
 * exchange, failures that never undo the refund, retry (failed / unknown with acknowledgement),
 * duplicate and concurrent protection, webhook and refresh acting on the refund parcel only, and
 * list loading sending nothing to GOODEX.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://.../silky_test'; node server/scripts/test_goodex_refund.js
 */

import http from 'http';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { db } from '../db/orm.js';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  products,
  productVariants,
  categories,
  orders,
  users,
  orderRefunds,
  orderDeliveries,
} from '../models/index.js';
import { _resetRateLimits } from '../middleware/rateLimiter.js';
import { signAccessToken } from '../services/token.service.js';
import { runOrderDeliveriesMigration } from '../db/migrations/add_order_deliveries.js';
import { runExchangeDeliveriesMigration } from '../db/migrations/add_exchange_deliveries.js';
import { runRefundDeliveriesMigration } from '../db/migrations/add_refund_deliveries.js';
import { ensureParcelForRefund } from '../services/delivery.service.js';
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
        const record = { fields: parseMultipart(raw), contentType: req.headers['content-type'] || '' };
        mock.creates.push(record);
        const handler = mock.onCreate || ((r, reply) => {
          eanCounter += 1;
          reply(200, {
            id: 900000 + eanCounter, ean: `REFEAN${eanCounter}-${Date.now()}`, user_id: 9999, client: r.fields.client,
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
let robe;
let ensemble;

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

async function makeConfirmedOrder() {
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
  _resetRateLimits();
  await request(`/orders/${res.data.id}/confirm`, { method: 'POST', token: adminToken });
  return res.data;
}

function postRefund(orderId, paymentResponsibility) {
  _resetRateLimits();
  return request(`/orders/${orderId}/refund`, { method: 'POST', token: adminToken, body: { paymentResponsibility } });
}

const ordinaryRows = async (orderId) => db.select().from(orderDeliveries)
  .where(and(eq(orderDeliveries.orderId, orderId), isNull(orderDeliveries.exchangeId), isNull(orderDeliveries.refundId)));
const refundDeliveryRow = async (refundId) => (await db.select().from(orderDeliveries)
  .where(eq(orderDeliveries.refundId, refundId)))[0] || null;
const orderRow = async (orderId) => (await db.select().from(orders).where(eq(orders.id, orderId)))[0];

// --------------------------------------------------------------------- tests
async function run() {
  const dbName = new URL(env.databaseUrl).pathname.slice(1);
  if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== '1') {
    throw new Error(`Refusing to run against database "${dbName}": use a dedicated test database (name containing "test")`);
  }
  await runOrderDeliveriesMigration(pool);
  await runExchangeDeliveriesMigration(pool);
  await runRefundDeliveriesMigration(pool);
  await runRefundDeliveriesMigration(pool); // idempotent
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
      email: `admin-goodex-ref-${Date.now()}@silky.tn`, passwordHash: 'fakehash', fullName: 'Admin GOODEX', role: 'admin',
    }).returning();
  }
  adminToken = signAccessToken(admin);

  let [category] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!category) [category] = await db.insert(categories).values({ name: 'Femme', slug: 'femme' }).returning();
  robe = await makeProduct('Robe Élégante', 59);
  ensemble = await makeProduct('Ensemble Enfant', 35);

  // ------------------------------------------------ 1. Remboursement (client payé)
  console.log('\n[1] Remboursement (customer_paid) creates a separate parcel with cod = 8.000');
  mock.reset();
  const oA = await makeConfirmedOrder();
  const [origBefore] = await ordinaryRows(oA.id);
  assert(origBefore?.state === 'created' && mock.creates.length === 1, 'the ordinary order parcel exists first (one request)');

  const refA = await postRefund(oA.id, 'customer_paid');
  assert(refA.status === 200 && refA.data.status === 'refunded', `refund accepted, order status refunded (${refA.status})`);
  assert(mock.creates.length === 2, 'exactly one additional GOODEX request for the refund');
  const fA = mock.creates[1].fields;
  assert(mock.creates[1].contentType.startsWith('multipart/form-data'), 'multipart/form-data like every other parcel');
  assert(fA.echange === '0' && fA.decharge === '0', 'echange=0 and decharge=0 are sent explicitly');
  const rA = refA.data.refunds[0];
  assert(rA.customerAmountToPay === 8 && fA.cod === '8.000', `cod = the refund's montant à payer 8.000 (${fA.cod})`);
  assert(fA.client === 'Test Client' && fA.gsm1 === '12345678', 'customer name and phone');
  assert(fA.adresse === '12 Rue Test' && fA.governorat === 'Tunis', 'address and governorate come from the order');
  assert(!('gsm2' in fA) && fA.last_statut === '12', 'no gsm2; last_statut=12 sent');
  assert(fA.remarque.includes('Ensemble Enfant') && fA.nbre === '1', `remarque lists the refunded products (${fA.remarque})`);
  assert(!('designation' in fA), 'designation is not sent');
  assert(fA.token === API_TOKEN && fA.user_id === '9999', 'token and user_id come from configuration');

  const dA = await refundDeliveryRow(rA.id);
  assert(dA?.state === 'created' && dA.ean?.startsWith('REFEAN') && dA.refundId === rA.id && dA.orderId === oA.id && dA.exchangeId === null, 'refund delivery row stores the ean and is linked to the refund and the order');
  assert(Number(dA.codAmount) === 8 && dA.goodexStatusId === 12, 'cod snapshot and initial GOODEX status stored');
  assert(rA.delivery?.state === 'created' && rA.delivery.ean === dA.ean && rA.delivery.refundId === rA.id, 'response attaches the delivery to the refund');
  const origAfterRows = await ordinaryRows(oA.id);
  assert(origAfterRows.length === 1 && origAfterRows[0].ean === origBefore.ean && origAfterRows[0].updatedAt.getTime() === origBefore.updatedAt.getTime(), 'still exactly one ordinary parcel row, unchanged');
  assert(refA.data.delivery?.ean === origBefore.ean, 'the order still reports its own parcel as its delivery');
  assert((await orderRow(oA.id)).status === 'refunded', 'Silky order status is refunded (GOODEX status is separate)');
  assert(!JSON.stringify(refA.data).includes(API_TOKEN), 'API token never appears in responses');

  // --------------------------------------------- 2. Remboursement gratuit (Silky paie)
  console.log('\n[2] Remboursement gratuit (silky_paid) creates a parcel with cod = 0.000');
  const oB = await makeConfirmedOrder();
  const b0 = mock.creates.length;
  const refB = await postRefund(oB.id, 'silky_paid');
  const rB = refB.data.refunds[0];
  const fB = mock.creates[b0].fields;
  assert(refB.status === 200 && mock.creates.length === b0 + 1, 'free refund creates exactly one request');
  assert(rB.customerAmountToPay === 0 && fB.cod === '0.000', `cod = 0.000 (${fB.cod})`);
  assert(fB.echange === '0' && fB.decharge === '0', 'echange=0 and decharge=0');
  assert(fB.remarque.includes('Ensemble Enfant') && !('designation' in fB), `free refund: remarque holds the product lines, no designation (${fB.remarque})`);
  const dB = await refundDeliveryRow(rB.id);
  assert(dB?.state === 'created' && dB.id !== dA.id && dB.ean !== dA.ean && Number(dB.codAmount) === 0, 'independent delivery row and ean; cod snapshot 0');

  // ------------------------------------------------- 3. listing keeps working, no GOODEX call
  console.log('\n[3] Listing');
  const t0 = mock.creates.length;
  const tr0 = mock.tracks.length;
  _resetRateLimits();
  const list = await request('/orders', { token: adminToken });
  const listed = list.data.find((o) => o.id === oA.id);
  assert(listed.refunds.length === 1 && listed.refunds[0].delivery?.ean === dA.ean && listed.delivery?.ean === origBefore.ean, 'list attaches each refund its own delivery; the order keeps its own');
  assert(listed.refunds[0].refundAmount === 35 && listed.refunds[0].customerAmountToPay === 8, 'refund amounts in the list are unchanged');
  assert(mock.creates.length === t0 && mock.tracks.length === tr0, 'loading the list sends nothing to GOODEX');

  // ----------------------------------- 4. exchanged order: address comes from the latest exchange
  console.log('\n[4] Refund of an exchanged order uses the exchange address');
  const oC = await makeConfirmedOrder();
  _resetRateLimits();
  const ex = await request(`/admin/orders/${oC.id}/exchange`, {
    method: 'POST', token: adminToken,
    body: {
      customer: { customerName: 'Client Echange', phoneNumber: '22334455', shippingAddress: 'Béja — 5 Avenue Habib Bourguiba' },
      items: [{ variantId: ensemble.id, action: 'keep', quantity: 1 }, { variantId: robe.id, action: 'add', quantity: 1 }],
      paymentResponsibility: 'silky_paid',
    },
  });
  assert(ex.status === 201, `exchange created (${ex.status})`);
  const c0 = mock.creates.length;
  const refC = await postRefund(oC.id, 'customer_paid');
  const fC = mock.creates[c0].fields;
  assert(refC.status === 200 && mock.creates.length === c0 + 1, 'refund of the exchanged order creates one request');
  assert(fC.client === 'Client Echange' && fC.gsm1 === '22334455' && fC.adresse === '5 Avenue Habib Bourguiba' && fC.governorat === 'Beja', `exchange customer and address, "Béja" -> "Beja" (${fC.governorat})`);
  assert(fC.cod === '8.000' && fC.echange === '0' && fC.decharge === '0', 'cod 8.000, echange=0, decharge=0');

  // ---------------------------------------- 5. failure never undoes the refund; retry
  console.log('\n[5] A GOODEX failure keeps the refund; retry works');
  const oD = await makeConfirmedOrder();
  mock.onCreate = (r, reply) => reply(422, { adresse: ['The adresse is invalid.'] });
  const d0 = mock.creates.length;
  const refD = await postRefund(oD.id, 'customer_paid');
  mock.onCreate = null;
  const rD = refD.data.refunds[0];
  const dDFail = await refundDeliveryRow(rD.id);
  assert(refD.status === 200 && (await orderRow(oD.id)).status === 'refunded' && (await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, oD.id))).length === 1, 'refund committed and order refunded although GOODEX refused');
  assert(dDFail.state === 'failed' && dDFail.lastError && mock.creates.length === d0 + 1 && rD.delivery?.state === 'failed', 'delivery row failed with the provider error; the response shows it');
  _resetRateLimits();
  const retryOk = await request(`/orders/refunds/${rD.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(retryOk.status === 200 && retryOk.data.state === 'created' && retryOk.data.attemptCount === 2 && retryOk.data.refundId === rD.id, 'admin retry of a failed refund parcel succeeds');
  assert(mock.creates[mock.creates.length - 1].fields.cod === '8.000' && mock.creates[mock.creates.length - 1].fields.echange === '0', 'the retry sends the same montant à payer and echange=0');
  const dup0 = mock.creates.length;
  _resetRateLimits();
  const retryCreated = await request(`/orders/refunds/${rD.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(retryCreated.status === 409 && mock.creates.length === dup0, 'retry on a created parcel -> 409, no request');

  // ------------------------------------------- 6. missing governorate is a local failure
  console.log('\n[6] Invalid data never reaches GOODEX');
  const oE = await makeConfirmedOrder();
  _resetRateLimits();
  const exE = await request(`/admin/orders/${oE.id}/exchange`, {
    method: 'POST', token: adminToken,
    body: {
      customer: { customerName: 'Client Echange', phoneNumber: '22334455', shippingAddress: 'Atlantis — 5 rue du Port' },
      items: [{ variantId: ensemble.id, action: 'keep', quantity: 1 }, { variantId: robe.id, action: 'add', quantity: 1 }],
      paymentResponsibility: 'silky_paid',
    },
  });
  assert(exE.status === 201, `exchange with an unknown governorate saved (${exE.status})`);
  // That exchange's own parcel failed locally; the server-side guard would hold the refund back until
  // it is created, so mark it created (as a successful admin retry would) to reach the refund itself.
  await db.update(orderDeliveries).set({ state: 'created' }).where(eq(orderDeliveries.exchangeId, exE.data.exchanges[0].id));
  const e0 = mock.creates.length;
  const logStart = logged.length;
  const refE = await postRefund(oE.id, 'silky_paid');
  const dE = await refundDeliveryRow(refE.data.refunds[0].id);
  assert(refE.status === 200 && dE.state === 'failed' && /Gouvernorat invalide/.test(dE.lastError) && mock.creates.length === e0, 'unknown governorate: refund saved, delivery failed locally, zero requests');
  const addressLogLeaks = logged.slice(logStart).filter((l) => /Atlantis|5\s+rue\s+du\s+Port/i.test(l));
  assert(addressLogLeaks.length === 0 && /Atlantis/.test(dE.lastError), `the invalid address is not echoed in the logs (${addressLogLeaks.length} leaked) while the admin still sees the cause`);

  // ------------------------------------------- 7. unknown outcome needs acknowledgement
  console.log('\n[7] Unknown outcome');
  const oF = await makeConfirmedOrder();
  mock.onCreate = (r, reply) => setTimeout(() => reply(200, { id: 1, ean: 'LATE-EAN', last_statut: 12 }), 1200);
  const refF = await postRefund(oF.id, 'customer_paid');
  mock.onCreate = null;
  const rF = refF.data.refunds[0];
  const dFUnknown = await refundDeliveryRow(rF.id);
  assert(refF.status === 200 && dFUnknown.state === 'unknown', 'a timeout leaves the refund parcel unknown (refund kept)');
  const f0 = mock.creates.length;
  _resetRateLimits();
  const noAck = await request(`/orders/refunds/${rF.id}/delivery/retry`, { method: 'POST', token: adminToken, body: {} });
  assert(noAck.status === 409 && mock.creates.length === f0, 'retry without acknowledgement -> 409, no request');
  _resetRateLimits();
  const ack = await request(`/orders/refunds/${rF.id}/delivery/retry`, { method: 'POST', token: adminToken, body: { acknowledgeUnknown: true } });
  assert(ack.status === 200 && ack.data.state === 'created' && mock.creates.length === f0 + 1, 'retry with acknowledgement creates the parcel');

  // ------------------------------------------------- 8. duplicates and concurrency
  console.log('\n[8] Duplicate / concurrent protection');
  const g0 = mock.creates.length;
  const again = await ensureParcelForRefund(rA.id);
  assert(again?.state === 'created' && mock.creates.length === g0, 'ensureParcelForRefund on a created refund sends nothing');
  const parallel = await Promise.all(Array.from({ length: 6 }, () => ensureParcelForRefund(rA.id)));
  assert(mock.creates.length === g0 && parallel.every((r) => r?.state === 'created'), 'repeated parallel calls send nothing');
  assert((await db.select().from(orderDeliveries).where(eq(orderDeliveries.refundId, rA.id))).length === 1, 'exactly one delivery row for the refund');

  // -------------------------------------------- 9. webhook and refresh act on the refund parcel
  console.log('\n[9] Webhook and refresh');
  _resetRateLimits();
  const hook = await request('/webhooks/goodex', {
    method: 'POST', headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` }, body: { code: dA.ean, statut: 'Livré', motif: '' },
  });
  const dAAfter = await refundDeliveryRow(rA.id);
  assert(hook.status === 200 && dAAfter.goodexStatusId === 2, 'webhook for the refund ean updates the refund parcel');
  const origHook = (await ordinaryRows(oA.id))[0];
  assert(origHook.goodexStatusId === 12 && origHook.updatedAt.getTime() === origBefore.updatedAt.getTime(), 'the ordinary parcel did not change');
  mock.tracks = [];
  _resetRateLimits();
  const refresh = await request(`/orders/refunds/${rB.id}/delivery/refresh`, { method: 'POST', token: adminToken, body: {} });
  assert(refresh.status === 200 && mock.tracks.length === 1 && mock.tracks[0].includes(encodeURIComponent(dB.ean)), 'refresh tracks the refund ean');
  assert((await refundDeliveryRow(rB.id)).goodexStatusId === 1, 'GOODEX status stored separately (id 1) while the Silky order stays refunded');
  assert((await ordinaryRows(oB.id))[0].lastPolledAt === null, 'the ordinary parcel was not polled');

  // ------------------------------------------------ 10. admin authorization on the new routes
  console.log('\n[10] Authorization');
  _resetRateLimits();
  const anon = await request(`/orders/refunds/${rA.id}/delivery/refresh`, { method: 'POST', body: {} });
  const anonRetry = await request(`/orders/refunds/${rA.id}/delivery/retry`, { method: 'POST', body: {} });
  assert([401, 403].includes(anon.status) && [401, 403].includes(anonRetry.status), `refund delivery routes refuse anonymous callers (${anon.status}/${anonRetry.status})`);
  _resetRateLimits();
  const unknownRefund = await request('/orders/refunds/00000000-0000-4000-8000-000000000000/delivery/retry', { method: 'POST', token: adminToken, body: {} });
  assert(unknownRefund.status === 404, `unknown refund -> 404 (${unknownRefund.status})`);

  const leaks = logged.filter((line) => line.includes(API_TOKEN) || line.includes(WEBHOOK_SECRET));
  assert(leaks.length === 0, `no log line contains the API token or the webhook secret (${leaks.length} found)`);
  const piiLeaks = logged.filter((line) => /parcel/i.test(line) && /12345678|22334455/.test(line));
  assert(piiLeaks.length === 0, `no parcel log line contains a customer phone number (${piiLeaks.length} found)`);

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
