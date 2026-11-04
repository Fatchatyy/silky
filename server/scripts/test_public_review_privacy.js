/**
 * Public review endpoints never expose a reviewer's email or user id; the admin review list still does.
 *   GET /api/reviews/published       (home page reviews)
 *   GET /api/products/:id/reviews    (product page reviews)
 *   GET /api/reviews                 (admin only, unchanged)
 *
 * Database safety: refuses to run unless DATABASE_URL is set in the environment to exactly "silky_test" on a
 * loopback host (helpers/silky_test_guard.js), re-checked on the live connection before the first write. Every row
 * it inserts is deleted in a finally block and the cleanup is verified.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_public_review_privacy.js
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { createAccount, removeAccounts } from './helpers/test_accounts.js';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();

const { app } = await import('../app.js');
const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products, reviews, storeReviews } = await import('../models/index.js');
const { default: jwt } = await import('jsonwebtoken');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

let BASE = '';
async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  return { status: res.status, text, data: text ? JSON.parse(text) : null };
}

const hasPrivateKeys = (review) => Object.prototype.hasOwnProperty.call(review, 'email') || Object.prototype.hasOwnProperty.call(review, 'userId');

async function runTests() {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);

  const marker = `priv${crypto.randomBytes(4).toString('hex')}`;
  const reviewerEmail = `${marker}@reviewer.test`;
  const created = { categoryId: null, productId: null, storeReviewId: null };

  try {
    const [category] = await db.insert(categories).values({ name: `Privacy ${marker}`, slug: marker }).returning();
    created.categoryId = category.id;
    const [product] = await db
      .insert(products)
      .values({ title: `Produit ${marker}`, slug: marker, description: 'Fixture', price: '10.000', categoryId: category.id, isActive: true })
      .returning();
    created.productId = product.id;
    const [storeReview] = await db
      .insert(storeReviews)
      .values({ authorName: `Auteur ${marker}`, email: reviewerEmail, body: `Avis boutique ${marker}`, rating: 5, status: 'approved' })
      .returning();
    created.storeReviewId = storeReview.id;
    const [productReview] = await db
      .insert(reviews)
      .values({
        productId: product.id,
        guestSessionId: crypto.randomUUID(),
        email: reviewerEmail,
        authorName: `Client ${marker}`,
        rating: 4,
        comment: `Avis produit ${marker}`,
        isApproved: true,
        status: 'approved',
        showInGeneral: true,
      })
      .returning();

    console.log('\n--- GET /api/reviews/published ---');
    const published = await get('/reviews/published');
    assert(published.status === 200, 'published reviews answer 200');
    const list = published.data.reviews || [];
    const ourStore = list.find((r) => r.id === storeReview.id);
    const ourProduct = list.find((r) => r.id === productReview.id);
    assert(ourStore && ourStore.authorName === `Auteur ${marker}` && ourStore.body === `Avis boutique ${marker}`, 'store review still listed with author and text');
    assert(ourProduct && ourProduct.authorName === `Client ${marker}`, 'product review shown in general is listed');
    assert(list.every((r) => !hasPrivateKeys(r)), 'no published review carries an email or userId field');
    assert(!published.text.includes(reviewerEmail), 'response body contains no reviewer email');
    assert(published.data.summary && typeof published.data.summary.count === 'number', 'rating summary unchanged');

    console.log('\n--- GET /api/products/:id/reviews ---');
    const productList = await get(`/products/${product.id}/reviews`);
    assert(productList.status === 200 && productList.data.reviews.some((r) => r.id === productReview.id), 'product review listed on its product');
    assert(productList.data.reviews.every((r) => !hasPrivateKeys(r)), 'no product review carries an email or userId field');
    assert(!productList.text.includes(reviewerEmail), 'response body contains no reviewer email');
    assert(productList.data.summary.count === 1 && productList.data.summary.average === 4, 'product rating summary unchanged');

    console.log('\n--- GET /api/reviews (admin) ---');
    const adminToken = jwt.sign({ sub: await createAccount(pool, 'admin', 'privacy'), email: 'admin@privacy.test', role: 'admin' }, env.jwtSecret, { expiresIn: 600 });
    const adminList = await get('/reviews', adminToken);
    const adminRow = (adminList.data || []).find((r) => r.id === storeReview.id);
    assert(adminList.status === 200 && adminRow?.email === reviewerEmail, 'admin review list still shows the reviewer email');
    const anonymousAdmin = await get('/reviews');
    assert(anonymousAdmin.status === 401, 'admin review list still requires authentication');
  } finally {
    console.log('\n--- Cleanup ---');
    try {
      if (created.storeReviewId) await db.delete(storeReviews).where(eq(storeReviews.id, created.storeReviewId));
      if (created.productId) await db.delete(products).where(eq(products.id, created.productId)); // cascades its reviews
      if (created.categoryId) await db.delete(categories).where(eq(categories.id, created.categoryId));
      const leftStore = created.storeReviewId
        ? await db.select({ id: storeReviews.id }).from(storeReviews).where(eq(storeReviews.id, created.storeReviewId))
        : [];
      const leftReviews = created.productId
        ? await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.productId, created.productId))
        : [];
      const leftProducts = created.productId
        ? await db.select({ id: products.id }).from(products).where(inArray(products.id, [created.productId]))
        : [];
      const leftCategories = created.categoryId
        ? await db.select({ id: categories.id }).from(categories).where(eq(categories.id, created.categoryId))
        : [];
      assert(
        leftStore.length + leftReviews.length + leftProducts.length + leftCategories.length === 0,
        'every inserted row (category, product, store review, product review) was removed',
      );
    } catch (err) {
      failed++;
      console.error('✗ FAIL: cleanup error:', err.message);
    }
  }
}

let server;
try {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}/api`;
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
