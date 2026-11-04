/**
 * Public endpoints the Astro storefront reads, and the cross-origin setup it needs:
 *   GET /api/products/by-slug/:slug          (same body as /api/products/:id; hidden or unknown -> 404)
 *   GET /api/storefront/home | collections/:slug | settings | sitemap-entries   (published data only)
 *   CORS: an allowed origin gets credentials and can read X-Guest-Session-ID; another origin is refused by the browser.
 *
 * Database safety: refuses to run unless DATABASE_URL is set in the environment to exactly "silky_test" on a
 * loopback host (helpers/silky_test_guard.js), re-checked on the live connection before the first write. Every row
 * it inserts is deleted in a finally block and the cleanup is verified.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_storefront_endpoints.js
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { createAccount, removeAccounts } from './helpers/test_accounts.js';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();

// Read by server/config/env.js when it loads; dotenv never overrides a variable that is already set.
const STOREFRONT_ORIGIN = 'http://localhost:4321';
process.env.CORS_ALLOWED_ORIGINS = `${STOREFRONT_ORIGIN},http://localhost:5173`;
process.env.GOODEX_ENABLE_LIVE = 'false';

const { app } = await import('../app.js');
const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products, productImages, productVariants, siteSettings } = await import('../models/index.js');
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
async function request(path, { token, headers = {}, method = 'GET' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, headers: res.headers, text, data };
}
const get = (path, options) => request(path, options);

const sameKeys = (object, keys) => JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());
// What a product card needs (name, price, discount, photos, alt text, sold-out flag, category) and nothing else.
const SUMMARY_KEYS = ['id', 'slug', 'name', 'nameAr', 'imageAlt', 'imageAltAr', 'price', 'discount', 'category', 'mainImage', 'collectionImage', 'soldOut'];
const PRIVATE_WORDS = /email|password|token|secret|cost|supplier|userId|guest/i;

async function runTests() {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);

  const marker = `sf${crypto.randomBytes(4).toString('hex')}`;
  const created = { categoryIds: [], productIds: [] };

  try {
    const [category] = await db.insert(categories).values({ name: `Cat ${marker}`, slug: marker }).returning();
    const [emptyCategory] = await db.insert(categories).values({ name: `Vide ${marker}`, slug: `${marker}-vide` }).returning();
    const [hiddenOnlyCategory] = await db.insert(categories).values({ name: `Caché ${marker}`, slug: `${marker}-cache` }).returning();
    created.categoryIds.push(category.id, emptyCategory.id, hiddenOnlyCategory.id);

    const insertProduct = async (slug, extra = {}) => {
      const [row] = await db
        .insert(products)
        .values({ title: `Produit ${slug}`, slug, description: `Description ${slug}`, price: '49.900', categoryId: category.id, isActive: true, ...extra })
        .returning();
      created.productIds.push(row.id);
      return row;
    };
    const plain = await insertProduct(`${marker}-plain`);
    const arabic = await insertProduct(`${marker}-arabe`, { titleAr: 'فستان', descriptionAr: 'وصف الفستان' });
    const halfArabic = await insertProduct(`${marker}-moitie`, { titleAr: 'فستان' });
    // Card data: photos, alt text, stock.
    const carded = await insertProduct(`${marker}-carte`, { collectionImageUrl: '/pictures/collection.jpg', imageAlt: 'Robe rouge', imageAltAr: 'فستان أحمر', discountAmount: '10.000' });
    await db.insert(productImages).values([
      { productId: carded.id, imageUrl: '/pictures/second.jpg', colorSlug: 'rouge', sortOrder: 0, isPrimary: false },
      { productId: carded.id, imageUrl: '/pictures/primary.jpg', colorSlug: 'rouge', sortOrder: 5, isPrimary: true },
    ]);
    await db.insert(productVariants).values([
      { productId: carded.id, size: 'S', colorSlug: 'rouge', colorName: 'Rouge', stockQuantity: 0, sku: `${marker}-S` },
      { productId: carded.id, size: 'M', colorSlug: 'rouge', colorName: 'Rouge', stockQuantity: 0, sku: `${marker}-M` },
    ]);
    const soldOutCard = await insertProduct(`${marker}-epuise`);
    await db.insert(productImages).values({ productId: soldOutCard.id, imageUrl: '/pictures/only.jpg', colorSlug: 'bleu', sortOrder: 3, isPrimary: false });
    await db.insert(productVariants).values({ productId: soldOutCard.id, size: 'S', colorSlug: 'bleu', colorName: 'Bleu', stockQuantity: 2, sku: `${marker}-B` });
    const hidden = await insertProduct(`${marker}-secret`, { isActive: false, categoryId: hiddenOnlyCategory.id });

    const adminToken = jwt.sign({ sub: await createAccount(pool, 'admin', 'storefront'), email: 'admin@storefront.test', role: 'admin' }, env.jwtSecret, { expiresIn: 600 });

    console.log('\n--- GET /api/products/by-slug/:slug ---');
    const bySlug = await get(`/products/by-slug/${plain.slug}`);
    assert(bySlug.status === 200 && bySlug.data.id === plain.id && bySlug.data.slug === plain.slug, 'a published product is found by its slug (200)');
    const byId = await get(`/products/${plain.id}`);
    assert(byId.status === 200 && JSON.stringify(byId.data) === JSON.stringify(bySlug.data), 'the body is exactly what /api/products/:id returns');
    assert(!PRIVATE_WORDS.test(Object.keys(bySlug.data).join(' ')), 'no private-looking field in the product body');
    const arabicBySlug = await get(`/products/by-slug/${arabic.slug}`);
    assert(arabicBySlug.status === 200 && arabicBySlug.data.nameAr === 'فستان' && arabicBySlug.data.descriptionAr === 'وصف الفستان', 'the Arabic name and description come with it');

    const hiddenGuest = await get(`/products/by-slug/${hidden.slug}`);
    assert(hiddenGuest.status === 404 && typeof hiddenGuest.data?.error === 'string', 'a hidden product answers 404 { error } to a visitor');
    const hiddenAdmin = await get(`/products/by-slug/${hidden.slug}`, { token: adminToken });
    assert(hiddenAdmin.status === 200 && hiddenAdmin.data.id === hidden.id, 'a hidden product is still readable by an admin (same rule as /:id)');
    const hiddenBadToken = await get(`/products/by-slug/${hidden.slug}`, { token: 'not-a-token' });
    assert(hiddenBadToken.status === 404, 'an invalid token is treated as a visitor');

    const unknown = await get(`/products/by-slug/${marker}-nope`);
    assert(unknown.status === 404 && typeof unknown.data?.error === 'string', 'an unknown slug answers 404 { error }');
    for (const odd of ['UPPER-case', 'a%20b', 'a--b', '-start', `x${'a'.repeat(300)}`, plain.id]) {
      const res = await get(`/products/by-slug/${odd}`);
      assert(res.status === 404, `a malformed slug is a plain 404 (${odd.slice(0, 24)})`);
    }
    const reviewsOfSlugNamedReviews = await get('/products/by-slug/reviews');
    assert(reviewsOfSlugNamedReviews.status === 404, 'a slug named like a route is still just an unknown slug');
    const reviews = await get(`/products/${plain.id}/reviews`);
    assert(reviews.status === 200 && reviews.data.summary, 'the existing /:id routes still work after the new route');

    console.log('\n--- GET /api/storefront/home ---');
    const home = await get('/storefront/home');
    assert(home.status === 200 && Array.isArray(home.data.products), 'home answers 200 with a product list');
    const ours = home.data.products.filter((p) => p.slug.startsWith(marker));
    assert(ours.length === 5 && ours.every((p) => sameKeys(p, SUMMARY_KEYS)), 'the five published fixtures are listed with exactly the card fields');
    assert(!home.data.products.some((p) => p.id === hidden.id || p.slug === hidden.slug), 'the hidden product is never listed');
    const row = ours.find((p) => p.id === arabic.id);
    assert(row && row.price === 49.9 && row.discount === 0 && row.nameAr === 'فستان' && row.category === marker, 'price and discount are numbers, Arabic name and category slug are included');
    assert(ours.find((p) => p.id === plain.id).nameAr === null, 'a product without Arabic text has nameAr null');
    const card = ours.find((p) => p.id === carded.id);
    assert(card.mainImage === '/pictures/primary.jpg' && card.collectionImage === '/pictures/collection.jpg', 'mainImage is the primary photo, collectionImage the one set by the admin');
    assert(card.imageAlt === 'Robe rouge' && card.imageAltAr === 'فستان أحمر' && card.discount === 10, 'alt texts and discount are included');
    assert(card.soldOut === true, 'a product whose every variant is out of stock is soldOut');
    const inStock = ours.find((p) => p.id === soldOutCard.id);
    assert(inStock.soldOut === false && inStock.mainImage === '/pictures/only.jpg' && inStock.collectionImage === '/pictures/only.jpg' && inStock.imageAlt === null, 'one variant in stock: not soldOut; without a primary flag the first photo is used for both images; no alt = null');
    const plainRow = ours.find((p) => p.id === plain.id);
    assert(plainRow.soldOut === false && plainRow.mainImage === '' && plainRow.collectionImage === '', 'a product with no variants and no photo is not soldOut and has empty images');
    assert(!PRIVATE_WORDS.test(home.text), 'nothing private-looking in the home body');
    assert(home.data.products.length <= 200, 'the list is bounded (200)');

    console.log('\n--- GET /api/storefront/collections/:slug ---');
    const collection = await get(`/storefront/collections/${marker}`);
    assert(collection.status === 200 && collection.data.slug === marker && collection.data.name === `Cat ${marker}`, 'a known category answers 200 with its slug and name');
    assert(collection.data.products.length === 5 && collection.data.products.every((p) => p.category === marker && sameKeys(p, SUMMARY_KEYS)), 'it lists only its own published products, card fields only');
    assert(!collection.data.products.some((p) => p.id === hidden.id), 'a hidden product is not in its category');
    const empty = await get(`/storefront/collections/${marker}-vide`);
    assert(empty.status === 200 && empty.data.products.length === 0, 'a category with no products is an existing, empty collection (200)');
    const hiddenOnly = await get(`/storefront/collections/${marker}-cache`);
    assert(hiddenOnly.status === 200 && hiddenOnly.data.products.length === 0 && !hiddenOnly.text.includes(hidden.slug), 'a category holding only a hidden product lists nothing and does not leak it');
    const noCollection = await get(`/storefront/collections/${marker}-inconnue`);
    assert(noCollection.status === 404 && typeof noCollection.data?.error === 'string', 'an unknown category answers 404 { error }');
    const badCollection = await get('/storefront/collections/Bad_Slug');
    assert(badCollection.status === 404, 'a malformed category slug answers 404');

    console.log('\n--- GET /api/storefront/settings ---');
    const [settingsRow] = await db.select({ fee: siteSettings.deliveryFee }).from(siteSettings).where(eq(siteSettings.id, 1));
    const settings = await get('/storefront/settings');
    assert(settings.status === 200 && sameKeys(settings.data, ['deliveryFee']) && typeof settings.data.deliveryFee === 'number', 'settings answer 200 with the delivery fee as a number and nothing else');
    assert(settingsRow ? settings.data.deliveryFee === parseFloat(settingsRow.fee) : settings.data.deliveryFee === 8, 'the fee is the one stored in site_settings (default 8 when none)');

    console.log('\n--- GET /api/storefront/sitemap-entries ---');
    const sitemap = await get('/storefront/sitemap-entries');
    assert(sitemap.status === 200 && Array.isArray(sitemap.data.products) && Array.isArray(sitemap.data.categories), 'sitemap entries answer 200 (products, categories)');
    const entry = (p) => sitemap.data.products.find((e) => e.slug === p.slug);
    assert(entry(plain) && sameKeys(entry(plain), ['slug', 'updatedAt', 'hasArabic']) && !Number.isNaN(Date.parse(entry(plain).updatedAt)), 'a product entry holds exactly slug, updatedAt (a date) and hasArabic');
    assert(entry(plain).hasArabic === false && entry(arabic).hasArabic === true, 'hasArabic is true only with an Arabic name AND description');
    assert(entry(halfArabic).hasArabic === false, 'an Arabic name without description is not an Arabic page');
    assert(!sitemap.data.products.some((e) => e.slug === hidden.slug), 'the hidden product is not in the sitemap data');
    const cats = sitemap.data.categories;
    assert(cats.some((c) => c.slug === marker) && cats.every((c) => sameKeys(c, ['slug'])), 'a category with published products is listed (slug only)');
    assert(!cats.some((c) => c.slug === `${marker}-vide` || c.slug === `${marker}-cache`), 'categories with no published product are not listed');
    assert(!PRIVATE_WORDS.test(sitemap.text), 'nothing private-looking in the sitemap data');

    console.log('\n--- Cross-origin ---');
    const allowed = await get(`/storefront/home`, { headers: { Origin: STOREFRONT_ORIGIN } });
    assert(allowed.headers.get('access-control-allow-origin') === STOREFRONT_ORIGIN && allowed.headers.get('access-control-allow-credentials') === 'true', 'an allowed origin gets its own origin back with credentials allowed');
    const exposed = (allowed.headers.get('access-control-expose-headers') || '').split(',').map((h) => h.trim().toLowerCase());
    assert(exposed.includes('x-guest-session-id'), 'Access-Control-Expose-Headers lists X-Guest-Session-ID');
    assert(/^[0-9a-f-]{36}$/i.test(allowed.headers.get('x-guest-session-id') || ''), 'the guest session id header is sent with the response');
    const other = await get('/storefront/home', { headers: { Origin: 'https://evil.example' } });
    assert(!other.headers.get('access-control-allow-origin'), 'another origin gets no Access-Control-Allow-Origin (the browser blocks the response)');
    const preflight = await request('/products/by-slug/x', {
      method: 'OPTIONS',
      headers: { Origin: STOREFRONT_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-guest-session-id' },
    });
    const allowedHeaders = (preflight.headers.get('access-control-allow-headers') || '').toLowerCase();
    assert(preflight.status === 204 && allowedHeaders.includes('authorization') && allowedHeaders.includes('x-guest-session-id'), 'the preflight accepts Authorization and X-Guest-Session-ID');
    const adminOrigin = await get('/storefront/home', { headers: { Origin: 'http://localhost:5173' } });
    assert(adminOrigin.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'the admin origin is allowed too');
    const cookie = allowed.headers.get('set-cookie') || '';
    assert(/SameSite=Lax/i.test(cookie) && !/Domain=/i.test(cookie), 'the guest cookie stays host-only and SameSite=Lax');
  } finally {
    try {
      if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
      if (created.categoryIds.length) await db.delete(categories).where(inArray(categories.id, created.categoryIds));
      const leftProducts = created.productIds.length ? await db.select({ id: products.id }).from(products).where(inArray(products.id, created.productIds)) : [];
      const leftCategories = created.categoryIds.length ? await db.select({ id: categories.id }).from(categories).where(inArray(categories.id, created.categoryIds)) : [];
      assert(leftProducts.length + leftCategories.length === 0, 'every inserted row (categories, products) was removed');
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
