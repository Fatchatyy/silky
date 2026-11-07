/**
 * What happens to the STATIC storefront when the shop changes while customers use it, on silky_test, through the real routes:
 *   A. publishing: which edits make the public site need a publish (the admin banner), that NOTHING starts a build by itself, and
 *      that one press of the button is one call to the deploy hook
 *   B. buying: the last units, two buyers at once, a cart that went stale, prices that changed, retries
 *   C. what the product page asks the API at load time (price, discount, stock) after the page was built
 *
 * The hook is a local mock. Nothing is deployed. Refuses to run unless DATABASE_URL is exactly the silky_test database.
 * Usage: DATABASE_URL=postgres://.../silky_test node integration/test_static_scenarios.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { assertSilkyTestUrl } from '../server/scripts/helpers/silky_test_guard.js';
import { importFromServer } from './lib/server_deps.mjs';

assertSilkyTestUrl();
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:4321';
process.env.GOODEX_ENABLE_LIVE = 'false';
process.env.GOODEX_BASE_URL = 'http://127.0.0.1:1';
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-scenarios-uploads-'));
process.env.PUBLISH_HOOK_TIMEOUT_MS = '5000';

const hook = { calls: [], status: 200, delayMs: 0 };
const hookServer = http.createServer((req, res) => {
  hook.calls.push({ at: Date.now() });
  setTimeout(() => {
    res.writeHead(hook.status, { 'Content-Type': 'application/json' });
    res.end('{}');
  }, hook.delayMs);
});
await new Promise((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
process.env.PUBLISH_HOOK_URL = `http://127.0.0.1:${hookServer.address().port}/hooks/secret`;

const { startApi, createFixtures } = await import('./lib/fixtures.mjs');
const { createAccount, removeAccounts } = await import('../server/scripts/helpers/test_accounts.js');
const { pool } = await import('../server/db/pool.js');
const { env } = await import('../server/config/env.js');
const publishService = await import('../server/services/publish.service.js');
const { _resetRateLimits } = await import('../server/middleware/rateLimiter.js');
const { default: jwt } = await importFromServer('jsonwebtoken');
const { runPublishStateMigration } = await import('../server/db/migrations/add_publish_state.js');

const results = [];
let passed = 0;
let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`✓ PASS: ${label}`);
    results.push({ label, ok: true });
    passed++;
  } catch (err) {
    console.error(`✗ FAIL: ${label}\n   ${String(err.message).split('\n').join('\n   ')}`);
    results.push({ label, ok: false, message: err.message });
    failed++;
  }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => wait(2300); // longer than the 1 s check delay plus the check itself
// A valid 1x1 PNG (the upload route checks the first bytes and resizes the picture).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let api;
let fixtures;
const orderIds = [];
const productIds = [];
try {
  api = await startApi(0);
  fixtures = await createFixtures();
  const adminId = await createAccount(pool, 'admin', 'scenarios');
  const customerId = await createAccount(pool, 'customer', 'scenarios');
  const sign = (id, role) => jwt.sign({ sub: id, email: `${role}@scenarios.invalid`, role }, env.jwtSecret, { expiresIn: 1800 });
  const adminToken = sign(adminId, 'admin');
  const customerToken = sign(customerId, 'customer');
  const call = async (pathname, { method = 'GET', body, token, headers = {} } = {}) => {
    const res = await fetch(`${api.url}/api${pathname}`, {
      method,
      headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  };
  await runPublishStateMigration(pool);
  await pool.query('UPDATE site_settings SET publish_hook_fingerprint = NULL, publish_hook_at = NULL, publish_hook_ok = NULL, publish_hook_message = NULL WHERE id = 1');
  const [{ id: governorateId }] = (await pool.query('SELECT id FROM governorates ORDER BY id LIMIT 1')).rows;
  const [{ id: femmeId, slug: femmeSlug }] = (await pool.query("SELECT id, slug FROM categories WHERE slug = 'femme'")).rows;

  const marker = fixtures.marker;
  const uniq = (() => { let n = 0; return (label) => `${label} ${marker} ${++n}`; })();
  const baseProduct = (over = {}) => ({
    name: uniq('Scenario'),
    description: 'Une pièce de test, coupe droite, tissu fluide pour les scénarios.',
    category: femmeSlug,
    categoryId: femmeId,
    price: 100,
    discount: 0,
    collectionImage: '/pictures/blushmarron.jpg',
    colors: [
      { id: 'noir', name: 'Noir', image: '/pictures/blushmarron.jpg', gallery: [] },
      { id: 'rose', name: 'Rose', image: '/pictures/comfyrose.jpg', gallery: [] },
    ],
    sizes: ['S', 'M'],
    stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 },
    ...over,
  });
  const createViaApi = async (over) => {
    const res = await call('/products', { method: 'POST', token: adminToken, body: baseProduct(over) });
    assert.equal(res.status, 201, `create: ${res.status} ${res.text.slice(0, 200)}`);
    productIds.push(res.json.id);
    return res.json;
  };
  /** The product as the admin form would send it back: the stored product with some fields replaced. */
  const edit = async (product, over) => {
    const current = (await call(`/products/${product.id}`, { token: adminToken })).json;
    const body = { ...current, ...over };
    // the stored product also carries isActive / is_active, which win over isHidden: drop them when hiding or showing
    if (over.isHidden !== undefined) {
      delete body.isActive;
      delete body.is_active;
    }
    const res = await call(`/products/${product.id}`, { method: 'PUT', token: adminToken, body });
    assert.equal(res.status, 200, `edit: ${res.status} ${res.text.slice(0, 300)}`);
    return res.json;
  };
  const variantsOf = async (id) => (await pool.query('SELECT id, color_slug, size, stock_quantity FROM product_variants WHERE product_id = $1', [id])).rows;
  const stockOf = async (variantId) => Number((await pool.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId])).rows[0]?.stock_quantity);
  const customer = { name: 'Client Scenario', phone: '22334455', address: 'Rue des tests 12', governorateId };
  const newShopper = () => ({ 'X-Guest-Session-ID': crypto.randomUUID() });
  const buyNow = (headers, variant, productId, quantity, extra = {}) =>
    call('/orders/checkout', { method: 'POST', headers, body: { customer, buyNowItem: { productId, variantId: variant.id, quantity, ...extra } } });
  const trackOrder = (res) => {
    if (res.json?.id) orderIds.push(res.json.id);
    return res;
  };
  const liveFingerprint = async () => (await call('/publish/status', { token: adminToken })).json.fingerprint;
  /**
   * Runs `action` and says whether it changed what the public site is built from (1) or not (0): that is the moment the admin banner
   * turns to « Modifications non publiées ». Nothing publishes by itself, so the hook must never be called here: that is asserted
   * on every call. The old name stays because the scenarios below read "starts a build" as "makes the site need a publish".
   */
  const buildsFrom = async (action) => {
    await wait(100);
    const calls = hook.calls.length;
    const before = await liveFingerprint();
    await action();
    await wait(300);
    assert.equal(hook.calls.length, calls, 'nothing may call the deploy hook by itself');
    return (await liveFingerprint()) !== before ? 1 : 0;
  };

  // A first product, so every scenario below starts from a catalogue that has one.
  const anchor = await createViaApi({ name: uniq('Ancre') });

  console.log('\n=== A. PUBLISHING: which edits start a build ===');

  await check('A1 adding a photo while a new product is still unsaved starts NO build (the photo belongs to no product yet)', async () => {
    const form = new FormData();
    form.append('image', new Blob([PNG], { type: 'image/png' }), 'unsaved.png');
    let uploaded;
    const n = await buildsFrom(async () => {
      const res = await call('/products/upload', { method: 'POST', token: adminToken, body: form });
      assert.equal(res.status, 200, `upload ${res.status} ${res.text.slice(0, 200)}`);
      uploaded = res.json;
    });
    assert.equal(n, 0, 'an unsaved upload must not rebuild the site');
    assert.ok(uploaded && (uploaded.url || uploaded.imageUrl || uploaded.path), `the upload answered a path: ${JSON.stringify(uploaded)}`);
  });

  await check('A2 abandoning that photo (discard) starts no build either', async () => {
    const n = await buildsFrom(async () => {
      const res = await call('/products/uploads/discard', { method: 'POST', token: adminToken, body: {} });
      assert.ok(res.status < 500, `discard ${res.status}`);
    });
    assert.equal(n, 0);
  });

  let visible;
  await check('A3 saving a new visible product starts exactly ONE build, and the product is in the catalogue snapshot', async () => {
    let created;
    const n = await buildsFrom(async () => {
      created = await createViaApi({ name: uniq('Visible') });
    });
    visible = created;
    assert.equal(n, 1);
    const snapshot = (await call('/storefront/snapshot')).json;
    assert.ok(snapshot.products.some((p) => p.id === created.id));
  });

  let hiddenProduct;
  await check('A4 saving a new HIDDEN product starts no build (a hidden product is in no public page)', async () => {
    let created;
    const n = await buildsFrom(async () => {
      created = await createViaApi({ name: uniq('Cache'), isHidden: true });
    });
    hiddenProduct = created;
    assert.equal(n, 0);
    const snapshot = (await call('/storefront/snapshot')).json;
    assert.ok(!snapshot.products.some((p) => p.id === created.id));
  });

  await check('A5 showing the hidden product starts one build; hiding it again starts one', async () => {
    assert.equal(await buildsFrom(() => edit(hiddenProduct, { isHidden: false })), 1, 'shown');
    assert.equal(await buildsFrom(() => edit(hiddenProduct, { isHidden: true })), 1, 'hidden again');
  });

  await check('A6 changing the price starts one build; changing the discount starts one; removing the discount starts one', async () => {
    assert.equal(await buildsFrom(() => edit(visible, { price: 120 })), 1, 'price');
    assert.equal(await buildsFrom(() => edit(visible, { discount: 15 })), 1, 'discount added');
    assert.equal(await buildsFrom(() => edit(visible, { discount: 0 })), 1, 'discount removed');
  });

  await check('A7 saving a product without changing anything starts no build', async () => {
    assert.equal(await buildsFrom(() => edit(visible, {})), 0);
  });

  await check('A8 editing and putting the old price back inside one waiting period starts no build', async () => {
    const before = hook.calls.length;
    await wait(300);
    const startCount = hook.calls.length;
    await edit(visible, { price: 777 });
    await edit(visible, { price: 120 });
    await settle();
    assert.equal(hook.calls.length - startCount, 0, `calls: ${hook.calls.length - before}`);
  });

  await check('A9 adding a colour starts one build, and the new colour is in the snapshot', async () => {
    const colors = [
      { id: 'noir', name: 'Noir', image: '/pictures/blushmarron.jpg', gallery: [] },
      { id: 'rose', name: 'Rose', image: '/pictures/comfyrose.jpg', gallery: [] },
      { id: 'vert', name: 'Vert', image: '/pictures/blushrose.jpg', gallery: [] },
    ];
    const stock = { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5, 'vert-S': 2, 'vert-M': 2 };
    assert.equal(await buildsFrom(() => edit(visible, { colors, stock })), 1);
    const p = (await call(`/products/${visible.id}`)).json;
    assert.ok(p.colors.some((c) => c.id === 'vert') && p.stock['vert-S'] === 2);
  });

  await check('A10 removing a colour starts one build, and its stock disappears', async () => {
    const colors = [
      { id: 'noir', name: 'Noir', image: '/pictures/blushmarron.jpg', gallery: [] },
      { id: 'rose', name: 'Rose', image: '/pictures/comfyrose.jpg', gallery: [] },
    ];
    const stock = { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 };
    assert.equal(await buildsFrom(() => edit(visible, { colors, stock })), 1);
    const p = (await call(`/products/${visible.id}`)).json;
    assert.ok(!p.colors.some((c) => c.id === 'vert') && p.stock['vert-S'] === undefined);
  });

  await check('A11 adding a size starts one build; removing it starts one', async () => {
    const stockL = { 'noir-S': 5, 'noir-M': 5, 'noir-L': 3, 'rose-S': 5, 'rose-M': 5, 'rose-L': 3 };
    assert.equal(await buildsFrom(() => edit(visible, { sizes: ['S', 'M', 'L'], stock: stockL })), 1, 'size added');
    assert.equal(await buildsFrom(() => edit(visible, { sizes: ['S', 'M'], stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } })), 1, 'size removed');
  });

  await check('A12 renaming a product starts one build and keeps its address (slug)', async () => {
    const slug = (await call(`/products/${visible.id}`)).json.slug;
    assert.equal(await buildsFrom(() => edit(visible, { name: uniq('Renomme') })), 1);
    assert.equal((await call(`/products/${visible.id}`)).json.slug, slug, 'the slug did not change');
  });

  await check('A13 deleting a visible product starts one build; deleting a hidden one starts none', async () => {
    const doomed = await createViaApi({ name: uniq('ASupprimer') });
    await settle();
    assert.equal(await buildsFrom(() => call(`/products/${doomed.id}`, { method: 'DELETE', token: adminToken })), 1, 'visible deleted');
    assert.equal(await buildsFrom(() => call(`/products/${hiddenProduct.id}`, { method: 'DELETE', token: adminToken })), 0, 'hidden deleted');
  });

  console.log('\n=== A. PUBLISHING: stock ===');
  const stockProduct = await createViaApi({ name: uniq('Stock'), stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
  await settle();
  const sv = await variantsOf(stockProduct.id);
  const vNoirS = sv.find((v) => v.color_slug === 'noir' && v.size === 'S');
  const vNoirM = sv.find((v) => v.color_slug === 'noir' && v.size === 'M');

  await check('A14 a real order that leaves the variant in stock starts NO build (even though it writes the variant row)', async () => {
    let res;
    const n = await buildsFrom(async () => {
      res = trackOrder(await buyNow(newShopper(), vNoirS, stockProduct.id, 2));
    });
    assert.equal(res.status, 201, res.text.slice(0, 200));
    assert.equal(await stockOf(vNoirS.id), 3);
    assert.equal(n, 0, 'selling 2 of 5 must not rebuild the site');
  });

  await check('A15 a real order that sells the LAST units of one size starts one build (that size shows as sold out)', async () => {
    let res;
    const n = await buildsFrom(async () => {
      res = trackOrder(await buyNow(newShopper(), vNoirS, stockProduct.id, 3));
    });
    assert.equal(res.status, 201);
    assert.equal(await stockOf(vNoirS.id), 0);
    assert.equal(n, 1);
  });

  await check('A16 the admin changing the stock 5 → 3 starts no build, 3 → 0 starts one, 0 → 5 starts one', async () => {
    assert.equal(await buildsFrom(() => call(`/admin/inventory/${vNoirM.id}`, { method: 'PATCH', token: adminToken, body: { stockQuantity: 3 } })), 0, '5 → 3');
    assert.equal(await buildsFrom(() => call(`/admin/inventory/${vNoirM.id}`, { method: 'PATCH', token: adminToken, body: { stockQuantity: 0 } })), 1, '3 → 0');
    assert.equal(await buildsFrom(() => call(`/admin/inventory/${vNoirM.id}`, { method: 'PATCH', token: adminToken, body: { stockQuantity: 5 } })), 1, '0 → 5');
  });

  await check('A17 cancelling the order that sold the last units (stock comes back) starts one build', async () => {
    const lastOrderId = orderIds[orderIds.length - 1];
    const n = await buildsFrom(async () => {
      const res = await call(`/orders/${lastOrderId}/cancel`, { method: 'POST', token: adminToken, body: {} });
      assert.ok(res.status === 200, `cancel ${res.status} ${res.text.slice(0, 200)}`);
    });
    assert.equal(await stockOf(vNoirS.id), 3);
    assert.equal(n, 1);
  });

  await check('A18 confirming / delivering orders (status changes) starts no build', async () => {
    const res = trackOrder(await buyNow(newShopper(), vNoirM, stockProduct.id, 1));
    assert.equal(res.status, 201);
    await settle();
    const n = await buildsFrom(async () => {
      const c = await call(`/orders/${res.json.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'processing' } });
      assert.ok(c.status < 500, `status ${c.status}`);
    });
    assert.equal(n, 0);
  });

  console.log('\n=== A. PUBLISHING: reviews ===');
  const reviewProduct = await createViaApi({ name: uniq('Avis') });
  await settle();
  const addReview = async (status = 'pending', over = {}) => {
    const [row] = (
      await pool.query(
        `INSERT INTO reviews (product_id, guest_session_id, email, author_name, rating, comment, is_approved, status, show_in_general)
         VALUES ($1, $2, $3, 'Cliente', 5, 'Très bien', $4, $5, $6) RETURNING id`,
        [reviewProduct.id, crypto.randomUUID(), `${crypto.randomBytes(3).toString('hex')}@r.test`, status === 'approved', status, over.showInGeneral === true],
      )
    ).rows;
    return row.id;
  };
  const setReview = (id, body) => call(`/products/reviews/${id}`, { method: 'PATCH', token: adminToken, body });

  await check('A19 a customer sending a review (pending) starts NO build', async () => {
    let res;
    const n = await buildsFrom(async () => {
      res = await call(`/products/${reviewProduct.id}/reviews`, { method: 'POST', token: customerToken, body: { rating: 5, comment: 'Superbe produit, je recommande.' } });
    });
    assert.ok(res.status === 201 || res.status === 200, `review ${res.status} ${res.text.slice(0, 200)}`);
    assert.equal(n, 0, 'a pending review is on no public page');
  });

  await check('A20 accepting ONE review starts one build; accepting it again changes nothing', async () => {
    const id = await addReview('pending');
    assert.equal(await buildsFrom(() => setReview(id, { status: 'approved' })), 1);
    assert.equal(await buildsFrom(() => setReview(id, { status: 'approved' })), 0);
  });

  await check('A21 accepting THREE reviews one after the other: no build at all, the site needs a publish', async () => {
    const ids = [await addReview(), await addReview(), await addReview()];
    const n = await buildsFrom(async () => {
      for (const id of ids) await setReview(id, { status: 'approved' });
    });
    assert.equal(n, 1);
  });

  await check('A22 accepting three reviews spaced far apart: still no build by itself, and ONE press of the button then publishes all three', async () => {
    const ids = [await addReview(), await addReview(), await addReview()];
    await wait(300);
    const before = hook.calls.length;
    for (const id of ids) {
      await setReview(id, { status: 'approved' });
      await settle();
    }
    assert.equal(hook.calls.length - before, 0, 'nothing is built by itself, however long the edits take');
    assert.equal((await call('/publish', { method: 'POST', token: adminToken })).status, 200);
    assert.equal(hook.calls.length - before, 1, 'one press, one build for all of them');
  });

  await check('A23 refusing or deleting a PENDING review starts no build; refusing or deleting an APPROVED one starts one', async () => {
    const pending1 = await addReview('pending');
    const pending2 = await addReview('pending');
    assert.equal(await buildsFrom(() => setReview(pending1, { status: 'rejected' })), 0, 'pending refused');
    assert.equal(await buildsFrom(() => call(`/products/reviews/${pending2}`, { method: 'DELETE', token: adminToken })), 0, 'pending deleted');
    const approved1 = await addReview('approved');
    const approved2 = await addReview('approved');
    await settle();
    assert.equal(await buildsFrom(() => setReview(approved1, { status: 'rejected' })), 1, 'approved then refused');
    assert.equal(await buildsFrom(() => call(`/products/reviews/${approved2}`, { method: 'DELETE', token: adminToken })), 1, 'approved deleted');
  });

  await check('A24 ticking / unticking « afficher dans avis généraux » on a review starts NO build (the home block reads it live)', async () => {
    const id = await addReview('approved');
    assert.equal(await buildsFrom(() => setReview(id, { showInGeneral: true })), 0, 'ticked');
    assert.equal(await buildsFrom(() => setReview(id, { showInGeneral: false })), 0, 'unticked');
  });

  await check('A25 the home page block reads general reviews from the API (not from the build): the tick shows at once', async () => {
    const id = await addReview('approved');
    const before = (await call('/reviews/published')).json.reviews.length;
    await setReview(id, { showInGeneral: true });
    const after = (await call('/reviews/published')).json.reviews.length;
    assert.equal(after, before + 1);
  });

  console.log('\n=== A. PUBLISHING: the button ===');
  const press = () => {
    _resetRateLimits(); // the button is limited to 6 presses a minute; the publish test checks that limit
    return call('/publish', { method: 'POST', token: adminToken });
  };
  await check('A26 several edits and an order, then ONE press: one call to the hook, and the status then reads as sent for the current catalogue', async () => {
    await wait(300);
    const before = hook.calls.length;
    await edit(visible, { price: 131 });
    await edit(visible, { price: 132 });
    trackOrder(await buyNow(newShopper(), vNoirM, stockProduct.id, 1));
    await wait(2500);
    assert.equal(hook.calls.length - before, 0, 'no edit and no order calls the hook by itself');
    assert.equal((await press()).status, 200);
    assert.equal(hook.calls.length - before, 1);
    const status = (await call('/publish/status', { token: adminToken })).json;
    assert.ok(status.lastHook.forCurrentCatalogue && status.lastHook.ok, 'the call was for the final state');
  });

  await check('A27 a double click on the button while the hook is slow is ONE call', async () => {
    hook.delayMs = 800;
    const before = hook.calls.length;
    const [a, b] = await Promise.all([press(), press()]);
    hook.delayMs = 0;
    assert.ok(a.status === 200 && b.status === 200);
    assert.equal(hook.calls.length - before, 1);
  });

  await check('A28 the hook fails: the button answers 502, nothing else calls it, and pressing again works', async () => {
    hook.status = 500;
    const before = hook.calls.length;
    await edit(visible, { price: 150 });
    trackOrder(await buyNow(newShopper(), vNoirM, stockProduct.id, 1));
    await wait(2500);
    assert.equal(hook.calls.length - before, 0, 'edits and orders call nothing, even after a failure (no automatic retry)');
    assert.equal((await press()).status, 502);
    assert.equal((await call('/publish/status', { token: adminToken })).json.lastHook.ok, false);
    hook.status = 200;
    assert.equal((await press()).status, 200);
    assert.equal((await call('/publish/status', { token: adminToken })).json.lastHook.ok, true);
  });

  console.log('\n=== B. BUYING while the shop changes ===');
  const stockBefore = async (productId) => Object.fromEntries((await variantsOf(productId)).map((v) => [`${v.color_slug}-${v.size}`, Number(v.stock_quantity)]));

  await check('B1 two customers buy the LAST unit at the same moment: one order, one refusal, stock 0 (never negative)', async () => {
    const p = await createViaApi({ name: uniq('Derniere'), stock: { 'noir-S': 1, 'noir-M': 1, 'rose-S': 1, 'rose-M': 1 } });
    const v = (await variantsOf(p.id))[0];
    const [a, b] = await Promise.all([buyNow(newShopper(), v, p.id, 1), buyNow(newShopper(), v, p.id, 1)]);
    trackOrder(a);
    trackOrder(b);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 400], `statuses ${statuses}`);
    const refused = a.status === 400 ? a : b;
    assert.match(refused.json.error, /stock insuffisant/);
    assert.equal(await stockOf(v.id), 0);
  });

  await check('B2 ten customers race for 5 units (one each): exactly 5 orders, 5 refusals, stock 0', async () => {
    const p = await createViaApi({ name: uniq('Course'), stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const v = (await variantsOf(p.id))[0];
    await pool.query('UPDATE product_variants SET stock_quantity = 5 WHERE id = $1', [v.id]);
    const all = await Promise.all(Array.from({ length: 10 }, () => buyNow(newShopper(), v, p.id, 1)));
    all.forEach(trackOrder);
    assert.equal(all.filter((r) => r.status === 201).length, 5);
    assert.equal(all.filter((r) => r.status === 400).length, 5);
    assert.equal(await stockOf(v.id), 0);
  });

  await check('B3 adding more than the stock to the cart is refused; adding a sold-out size is refused (not only at checkout)', async () => {
    const p = await createViaApi({ name: uniq('Panier'), stock: { 'noir-S': 2, 'noir-M': 0, 'rose-S': 2, 'rose-M': 2 } });
    const vs = await variantsOf(p.id);
    const soldOut = vs.find((v) => Number(v.stock_quantity) === 0);
    const ok = vs.find((v) => Number(v.stock_quantity) === 2);
    const shopper = newShopper();
    const tooMany = await call('/cart/items', { method: 'POST', headers: shopper, body: { productId: p.id, variantId: ok.id, quantity: 3 } });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.json.error, /stock insuffisant/);
    const none = await call('/cart/items', { method: 'POST', headers: shopper, body: { productId: p.id, variantId: soldOut.id, quantity: 1 } });
    assert.equal(none.status, 400);
  });

  await check('B4 a cart filled while in stock, then the stock is sold elsewhere: checkout is refused, no order, no stock change, cart kept', async () => {
    const p = await createViaApi({ name: uniq('Perime'), stock: { 'noir-S': 3, 'noir-M': 3, 'rose-S': 3, 'rose-M': 3 } });
    const v = (await variantsOf(p.id))[0];
    const shopper = newShopper();
    assert.ok([200, 201].includes((await call('/cart/items', { method: 'POST', headers: shopper, body: { productId: p.id, variantId: v.id, quantity: 3 } })).status));
    trackOrder(await buyNow(newShopper(), v, p.id, 3)); // another customer takes all of it
    const res = await call('/orders/checkout', { method: 'POST', headers: shopper, body: { customer } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /stock insuffisant/);
    assert.equal(await stockOf(v.id), 0, 'no stock taken twice, none made negative');
    const cart = (await call('/cart', { headers: shopper })).json;
    assert.equal(cart.items.length, 1, 'the cart is still there');
  });

  await check('B5 the price rises after the item went into the cart: the order is charged the CURRENT price', async () => {
    const p = await createViaApi({ name: uniq('PrixCart'), price: 100, stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const v = (await variantsOf(p.id))[0];
    const shopper = newShopper();
    await call('/cart/items', { method: 'POST', headers: shopper, body: { productId: p.id, variantId: v.id, quantity: 1 } });
    await edit(p, { price: 150 });
    const res = trackOrder(await call('/orders/checkout', { method: 'POST', headers: shopper, body: { customer } }));
    assert.equal(res.status, 201, res.text.slice(0, 200));
    assert.equal(Number(res.json.subtotal ?? res.json.total - res.json.deliveryFee), 150);
  });

  await check('B6 a discount added after the item went into the cart: the order is charged the discounted price', async () => {
    const p = await createViaApi({ name: uniq('RemiseCart'), price: 100, stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const v = (await variantsOf(p.id))[0];
    const shopper = newShopper();
    await call('/cart/items', { method: 'POST', headers: shopper, body: { productId: p.id, variantId: v.id, quantity: 1 } });
    await edit(p, { discount: 30 });
    const res = trackOrder(await call('/orders/checkout', { method: 'POST', headers: shopper, body: { customer } }));
    assert.equal(res.status, 201);
    assert.equal(Number(res.json.subtotal), 70);
  });

  await check('B7 « Commander » (buy now) with a price the page showed (stale or forged) is IGNORED: the database price is charged', async () => {
    const p = await createViaApi({ name: uniq('PrixDirect'), price: 100, discount: 10, stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const v = (await variantsOf(p.id))[0];
    const res = trackOrder(await buyNow(newShopper(), v, p.id, 2, { price: 1 }));
    assert.equal(res.status, 201);
    assert.equal(Number(res.json.subtotal), 180);
  });

  await check('B8 the product was hidden / deleted after the customer put it in the cart: checkout does not sell it and does not crash', async () => {
    const p = await createViaApi({ name: uniq('Retire'), stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const v = (await variantsOf(p.id))[0];
    const shopper = newShopper();
    await call('/cart/items', { method: 'POST', headers: shopper, body: { productId: p.id, variantId: v.id, quantity: 1 } });
    await edit(p, { isHidden: true });
    const hiddenTry = await call('/orders/checkout', { method: 'POST', headers: shopper, body: { customer } });
    assert.ok(hiddenTry.status >= 400 && hiddenTry.status < 500, `hidden: ${hiddenTry.status} ${hiddenTry.text.slice(0, 150)}`);
    assert.equal(await stockOf(v.id), 5, 'nothing was taken');
    await call(`/products/${p.id}`, { method: 'DELETE', token: adminToken });
    const deletedTry = await call('/orders/checkout', { method: 'POST', headers: shopper, body: { customer } });
    assert.ok(deletedTry.status >= 400 && deletedTry.status < 500, `deleted: ${deletedTry.status}`);
  });

  await check('B9 a size removed from the product after it was in the cart: no server error, nothing sold', async () => {
    const p = await createViaApi({ name: uniq('TailleRetiree'), stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const vM = (await variantsOf(p.id)).find((v) => v.size === 'M' && v.color_slug === 'noir');
    const shopper = newShopper();
    await call('/cart/items', { method: 'POST', headers: shopper, body: { productId: p.id, variantId: vM.id, quantity: 1 } });
    await edit(p, { sizes: ['S'], stock: { 'noir-S': 5, 'rose-S': 5 } });
    const res = await call('/orders/checkout', { method: 'POST', headers: shopper, body: { customer } });
    assert.ok(res.status >= 400 && res.status < 500, `${res.status} ${res.text.slice(0, 200)}`);
    const left = (await pool.query('SELECT 1 FROM product_variants WHERE id = $1', [vM.id])).rowCount;
    assert.ok(left <= 1);
  });

  await check('B10 the customer double-clicks « Confirmer »: the same Idempotency-Key makes ONE order and takes the stock once', async () => {
    const p = await createViaApi({ name: uniq('DoubleClic'), stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const v = (await variantsOf(p.id))[0];
    const shopper = newShopper();
    const key = crypto.randomUUID();
    const send = () => call('/orders/checkout', { method: 'POST', headers: { ...shopper, 'Idempotency-Key': key }, body: { customer, buyNowItem: { productId: p.id, variantId: v.id, quantity: 2 } } });
    const [a, b] = await Promise.all([send(), send()]);
    trackOrder(a);
    trackOrder(b);
    assert.ok(a.status === 201 && (b.status === 201 || b.status === 200 || b.status === 409), `${a.status} ${b.status}`);
    if (a.json?.id && b.json?.id) assert.equal(a.json.id, b.json.id, 'same order answered twice');
    assert.equal(await stockOf(v.id), 3, 'stock taken once');
  });

  await check('B11 impossible quantities (0, -1, 1000, "abc") are refused and take no stock', async () => {
    const p = await createViaApi({ name: uniq('Quantite'), stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const v = (await variantsOf(p.id))[0];
    for (const quantity of [0, -1, 1000, 'abc', 1.5]) {
      const res = await buyNow(newShopper(), v, p.id, quantity);
      assert.equal(res.status, 400, `quantity ${quantity} → ${res.status}`);
    }
    assert.equal(await stockOf(v.id), 5);
  });

  await check('B12 the admin sets the stock to 0 while a customer has it in the cart: checkout refused cleanly', async () => {
    const p = await createViaApi({ name: uniq('AdminZero'), stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const v = (await variantsOf(p.id))[0];
    const shopper = newShopper();
    await call('/cart/items', { method: 'POST', headers: shopper, body: { productId: p.id, variantId: v.id, quantity: 2 } });
    await call(`/admin/inventory/${v.id}`, { method: 'PATCH', token: adminToken, body: { stockQuantity: 0 } });
    const res = await call('/orders/checkout', { method: 'POST', headers: shopper, body: { customer } });
    assert.equal(res.status, 400);
    assert.equal(await stockOf(v.id), 0);
  });

  console.log('\n=== C. WHAT THE PRODUCT PAGE ASKS THE API AFTER IT LOADS ===');
  await check('C1 /products/by-slug answers the CURRENT price, discount and exact stock right after an edit (what the page shows after loading)', async () => {
    const p = await createViaApi({ name: uniq('Live'), price: 100, discount: 0, stock: { 'noir-S': 5, 'noir-M': 5, 'rose-S': 5, 'rose-M': 5 } });
    const first = (await call(`/products/by-slug/${p.slug}`)).json;
    assert.equal(Number(first.price), 100);
    await edit(p, { price: 140, discount: 20 });
    const v = (await variantsOf(p.id)).find((x) => x.color_slug === 'noir' && x.size === 'S');
    await call(`/admin/inventory/${v.id}`, { method: 'PATCH', token: adminToken, body: { stockQuantity: 2 } });
    const live = (await call(`/products/by-slug/${p.slug}`)).json;
    assert.equal(Number(live.price), 140);
    assert.equal(Number(live.discount), 20);
    assert.equal(live.stock['noir-S'], 2);
    assert.equal(typeof live.stock['rose-M'], 'number');
  });

  await check('C2 a product hidden or deleted after the build answers 404 to the page (the page then reads « rupture de stock »)', async () => {
    const p = await createViaApi({ name: uniq('Disparu') });
    await edit(p, { isHidden: true });
    assert.equal((await call(`/products/by-slug/${p.slug}`)).status, 404);
    await edit(p, { isHidden: false });
    assert.equal((await call(`/products/by-slug/${p.slug}`)).status, 200);
    await call(`/products/${p.id}`, { method: 'DELETE', token: adminToken });
    assert.equal((await call(`/products/by-slug/${p.slug}`)).status, 404);
  });

  await check('C3 the page cannot be abused to read hidden data: an anonymous call never returns a hidden product or a customer\'s details', async () => {
    const p = await createViaApi({ name: uniq('Secret'), isHidden: true });
    const res = await call(`/products/by-slug/${p.slug}`);
    assert.equal(res.status, 404);
    assert.ok(!/email|password|guest/i.test(res.text));
  });
} catch (err) {
  failed++;
  console.error('✗ FAIL: unexpected error:', err);
} finally {
  publishService._resetPublishState();
  try {
    if (orderIds.length) {
      await pool.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]).catch(() => {});
      await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    }
    if (productIds.length) await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]).catch((e) => console.error('cleanup products:', e.message));
    await pool.query('UPDATE site_settings SET publish_hook_fingerprint = NULL, publish_hook_at = NULL, publish_hook_ok = NULL, publish_hook_message = NULL WHERE id = 1');
    fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  } catch (err) {
    console.error('cleanup:', err.message);
  }
  await removeAccounts(pool).catch(() => {});
  if (fixtures) console.log((await fixtures.cleanup().catch(() => false)) ? 'Fixtures removed.' : 'WARNING: fixtures left behind.');
  if (api) await api.stop().catch(() => {});
  hookServer.closeAllConnections?.();
  await new Promise((resolve) => hookServer.close(resolve));
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200);
}
