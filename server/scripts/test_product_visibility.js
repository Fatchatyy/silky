/**
 * Hidden (unpublished) product visibility over HTTP.
 *
 * Anonymous callers, invalid/expired tokens and customers must never receive a product whose
 * is_active is false (list, by id, videos); an admin token still does.
 * Also covers malformed product ids (404, never the database error text) and the generic 500 for unexpected errors.
 *
 * Database safety: this script refuses to run unless DATABASE_URL is set explicitly in the
 * environment (.env is NOT consulted for the target) and points at the database named exactly
 * "silky_test" on a loopback host. The check runs before any application module is imported, and is
 * repeated against the live connection (SELECT current_database()) before the first write.
 * Every row it inserts is deleted in a finally block and the cleanup is verified.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_product_visibility.js
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { createAccount, removeAccounts } from './helpers/test_accounts.js';

const REQUIRED_DB = 'silky_test';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function refuse(message) {
  console.error(`REFUSING TO RUN: ${message}`);
  process.exit(2);
}

// Guard 1: static check of the URL given in the environment, before anything else is loaded.
function assertTargetIsSilkyTest() {
  const raw = process.env.DATABASE_URL;
  if (!raw) refuse('DATABASE_URL is not set. Set it explicitly to the silky_test database; .env is not used as the target.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    refuse('DATABASE_URL is not a valid URL.');
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (dbName !== REQUIRED_DB) refuse(`database name must be exactly "${REQUIRED_DB}" (got "${dbName}").`);
  if (!LOOPBACK_HOSTS.has(url.hostname)) refuse(`host must be loopback (got "${url.hostname}").`);
  return { raw, host: url.hostname, dbName };
}

const target = assertTargetIsSilkyTest();
console.log(`Target database: ${target.dbName} on ${target.host} (password not printed)`);

// Only now load the application (this reads .env, which cannot override the variable set above).
const { app } = await import('../app.js');
const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { inArray, eq } = await import('drizzle-orm');
const { categories, products, productVariants, productVideos } = await import('../models/index.js');
const { default: jwt } = await import('jsonwebtoken');

let passed = 0;
let failed = 0;
let server;
let BASE = '';

function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

async function get(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, text };
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, text };
}

const accountIds = {};

function signToken(role, options = {}) {
  return jwt.sign({ sub: accountIds[role] ?? crypto.randomUUID(), email: `${role}@visibility.test`, role }, env.jwtSecret, {
    expiresIn: 600,
    ...options,
  });
}

const idsOf = (data) => (Array.isArray(data) ? data : data?.products || []).map((p) => p.id);

async function runTests() {
  // Guard 2: the live connection, before any write.
  if (env.databaseUrl !== target.raw) refuse('the application resolved a different DATABASE_URL than the one set in the environment.');
  const { rows } = await pool.query('SELECT current_database() AS name');
  if (rows[0].name !== REQUIRED_DB) refuse(`connected database is "${rows[0].name}", expected "${REQUIRED_DB}".`);
  console.log(`Connected database confirmed: ${rows[0].name}`);

  const marker = `vis${crypto.randomBytes(4).toString('hex')}`;
  const created = { categoryId: null, productIds: [] };

  try {
    // ---------------------------------------------------------------- fixtures
    const [category] = await db.insert(categories).values({ name: `Visibility ${marker}`, slug: marker }).returning();
    created.categoryId = category.id;

    const makeProduct = async (title, isActive) => {
      const [product] = await db
        .insert(products)
        .values({
          title,
          slug: `${marker}-${isActive ? 'active' : 'hidden'}`,
          description: `Fixture ${marker}`,
          price: '10.000',
          discountAmount: '0',
          categoryId: category.id,
          isActive,
        })
        .returning();
      created.productIds.push(product.id);
      await db.insert(productVariants).values({
        productId: product.id,
        size: 'M',
        colorSlug: 'noir',
        colorName: 'Noir',
        stockQuantity: 5,
        sku: `${marker}-${isActive ? 'A' : 'H'}-M-NOIR`.toUpperCase(),
      });
      return product;
    };

    const active = await makeProduct(`ACTIVE ${marker}`, true);
    const hidden = await makeProduct(`HIDDEN ${marker}`, false);
    await db.insert(productVideos).values({ productId: hidden.id, videoUrl: `/uploads/${marker}.mp4`, sortOrder: 0 });

    accountIds.admin = await createAccount(pool, 'admin', 'visibility');
    accountIds.customer = await createAccount(pool, 'customer', 'visibility');
    const adminToken = signToken('admin');
    const customerToken = signToken('customer');
    const expiredToken = signToken('admin', { expiresIn: -60 });
    const garbageToken = 'not-a-jwt';
    const unknownId = crypto.randomUUID();

    // ---------------------------------------------------------------- list: guests
    console.log('\n--- List (guests) ---');
    const catQuery = `category=${marker}`;

    const anonAll = await get('/products?includeHidden=true');
    assert(anonAll.status === 200 && Array.isArray(anonAll.data), 'anonymous GET /products?includeHidden=true -> 200 array');
    assert(!idsOf(anonAll.data).includes(hidden.id), 'anonymous full list does not contain the hidden product');
    assert(idsOf(anonAll.data).includes(active.id), 'anonymous full list still contains the active product');
    assert(!anonAll.data.some((p) => p.isHidden === true || p.is_active === false), 'anonymous full list contains no hidden product at all');
    assert(!anonAll.text.includes(hidden.id) && !anonAll.text.includes(`HIDDEN ${marker}`), 'anonymous full-list body has no trace of the hidden product');

    const anonCat = await get(`/products?${catQuery}&includeHidden=true`);
    assert(anonCat.status === 200 && JSON.stringify(idsOf(anonCat.data)) === JSON.stringify([active.id]), 'anonymous category list with includeHidden=true -> only the active product');
    assert(anonCat.data.pagination?.total === 1, 'anonymous category list pagination counts only active products');

    const anonSearch = await get(`/products?search=${marker}&page=1&limit=50&includeHidden=true`);
    assert(JSON.stringify(idsOf(anonSearch.data)) === JSON.stringify([active.id]), 'anonymous search with includeHidden=true -> only the active product');

    const anonPlain = await get(`/products?${catQuery}`);
    assert(JSON.stringify(idsOf(anonPlain.data)) === JSON.stringify([active.id]), 'anonymous list without the flag is unchanged (active only)');
    const anonPlainAll = await get('/products');
    assert(anonPlainAll.status === 200 && !idsOf(anonPlainAll.data).includes(hidden.id) && idsOf(anonPlainAll.data).includes(active.id), 'anonymous GET /products without the flag is unchanged');

    for (const [label, token] of [['customer token', customerToken], ['expired admin token', expiredToken], ['garbage token', garbageToken]]) {
      const res = await get(`/products?${catQuery}&includeHidden=true`, token);
      assert(res.status === 200, `${label}: list answers 200 (treated as guest, never 401)`);
      assert(JSON.stringify(idsOf(res.data)) === JSON.stringify([active.id]), `${label}: hidden product not returned`);
    }

    // ---------------------------------------------------------------- list: admin
    console.log('\n--- List (admin) ---');
    const adminCat = await get(`/products?${catQuery}&includeHidden=true`, adminToken);
    assert(adminCat.status === 200 && idsOf(adminCat.data).sort().join() === [active.id, hidden.id].sort().join(), 'admin category list with includeHidden=true -> active and hidden');
    assert(adminCat.data.products.find((p) => p.id === hidden.id)?.isHidden === true, 'admin sees the hidden product flagged isHidden');
    const adminAll = await get('/products?includeHidden=true', adminToken);
    assert(Array.isArray(adminAll.data) && idsOf(adminAll.data).includes(hidden.id) && idsOf(adminAll.data).includes(active.id), 'admin full list includes the hidden product');
    const adminNoFlag = await get(`/products?${catQuery}`, adminToken);
    assert(JSON.stringify(idsOf(adminNoFlag.data)) === JSON.stringify([active.id]), 'admin without includeHidden still gets active only (unchanged)');

    // ---------------------------------------------------------------- by id
    console.log('\n--- GET /products/:id ---');
    const unknown = await get(`/products/${unknownId}`);
    for (const [label, token] of [['anonymous', undefined], ['customer', customerToken], ['expired token', expiredToken], ['garbage token', garbageToken]]) {
      const res = await get(`/products/${hidden.id}`, token);
      assert(res.status === 404, `${label}: hidden product by id -> 404`);
      assert(res.status === unknown.status && JSON.stringify(res.data) === JSON.stringify(unknown.data), `${label}: hidden id answers exactly like an unknown id (no existence oracle)`);
    }
    const adminHidden = await get(`/products/${hidden.id}`, adminToken);
    assert(adminHidden.status === 200 && adminHidden.data.id === hidden.id && adminHidden.data.isHidden === true, 'admin: hidden product by id -> 200');
    for (const [label, token] of [['anonymous', undefined], ['customer', customerToken], ['admin', adminToken]]) {
      const res = await get(`/products/${active.id}`, token);
      assert(res.status === 200 && res.data.id === active.id && res.data.isHidden === false, `${label}: active product by id -> 200 (unchanged)`);
    }

    // ---------------------------------------------------------------- videos
    console.log('\n--- GET /products/:id/videos ---');
    for (const [label, token] of [['anonymous', undefined], ['customer', customerToken], ['garbage token', garbageToken]]) {
      const res = await get(`/products/${hidden.id}/videos`, token);
      assert(res.status === 404 && !res.text.includes(marker), `${label}: hidden product videos -> 404 with no video URL`);
    }
    const adminVideos = await get(`/products/${hidden.id}/videos`, adminToken);
    assert(adminVideos.status === 200 && Array.isArray(adminVideos.data) && adminVideos.data.length === 1, 'admin: hidden product videos -> 200 with the video');
    const activeVideos = await get(`/products/${active.id}/videos`);
    assert(activeVideos.status === 200 && Array.isArray(activeVideos.data), 'anonymous: active product videos -> 200 (unchanged)');

    // ---------------------------------------------------------------- malformed ids / error text exposure
    console.log('\n--- Malformed ids and driver error text ---');
    const LEAK = /Failed query|params:|select\s.+\sfrom|invalid input syntax|"products"|pg_catalog/i;
    const badIds = ['not-a-uuid', '12345', "x'%20or%201=1--", 'UPLOAD'];
    for (const badId of badIds) {
      for (const suffix of ['', '/videos', '/reviews']) {
        const res = await get(`/products/${badId}${suffix}`);
        assert(
          res.status === 404 && res.data?.error === 'Produit non trouvé' && !LEAK.test(res.text),
          `anonymous GET /products/${badId}${suffix} -> 404 "Produit non trouvé", no SQL text`,
        );
      }
      const posted = await post(`/products/${badId}/reviews`, { rating: 5, comment: 'x', authorName: 'Test' });
      assert(posted.status === 404 && !LEAK.test(posted.text), `anonymous POST /products/${badId}/reviews -> 404, no SQL text`);
    }

    // An unexpected database error on a route the id guard does not cover (admin-only) must still not leak its text.
    const adminBad = await get('/products/not-a-uuid/admin-reviews', adminToken);
    assert(
      adminBad.status === 500 && adminBad.data?.error === 'Internal server error' && !LEAK.test(adminBad.text),
      'unexpected DB error -> generic 500 "Internal server error", no SQL text',
    );
    // Intentional (AppError) messages are unchanged.
    const adminUnknown = await get(`/products/${unknownId}/admin-reviews`, adminToken);
    assert(adminUnknown.status === 200, 'admin-reviews for a well-formed unknown id is unchanged (200)');
    assert(unknown.status === 404 && unknown.data?.error === 'Produit non trouvé', 'AppError message for an unknown id is unchanged');
  } finally {
    // ---------------------------------------------------------------- cleanup (always)
    console.log('\n--- Cleanup ---');
    try {
      if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
      if (created.categoryId) await db.delete(categories).where(eq(categories.id, created.categoryId));
      const leftProducts = created.productIds.length
        ? await db.select({ id: products.id }).from(products).where(inArray(products.id, created.productIds))
        : [];
      const leftCategories = created.categoryId
        ? await db.select({ id: categories.id }).from(categories).where(eq(categories.id, created.categoryId))
        : [];
      const leftVariants = created.productIds.length
        ? await db.select({ id: productVariants.id }).from(productVariants).where(inArray(productVariants.productId, created.productIds))
        : [];
      const leftVideos = created.productIds.length
        ? await db.select({ id: productVideos.id }).from(productVideos).where(inArray(productVideos.productId, created.productIds))
        : [];
      assert(
        leftProducts.length === 0 && leftCategories.length === 0 && leftVariants.length === 0 && leftVideos.length === 0,
        'every inserted row (category, products, variants, videos) was removed',
      );
    } catch (err) {
      failed++;
      console.error('✗ FAIL: cleanup error:', err.message);
    }
  }
}

try {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}/api`;
  console.log(`Test server on ${BASE}`);
  await runTests();
} catch (err) {
  failed++;
  console.error('✗ FAIL: unexpected error:', err);
} finally {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  await removeAccounts(pool).catch(() => {});
  await pool.end().catch(() => {});
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
