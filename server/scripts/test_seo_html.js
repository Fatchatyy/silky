/**
 * Server-written page head against the real app and the real database loaders: status codes, head tags, JSON-LD,
 * sitemap and the hidden-product rule, using fixtures it inserts and removes.
 *
 * Database safety: refuses to run unless DATABASE_URL is set in the environment to exactly "silky_test" on a
 * loopback host (helpers/silky_test_guard.js), re-checked on the live connection before the first write.
 * It also needs a fresh frontend build in FRONTEND_DIST_DIR (npx vite build --outDir <folder>), SEO_HTML=on and
 * SITE_URL, all set in the command, never taken from .env.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'
 *   $env:SEO_HTML='on'; $env:SITE_URL='https://shop.example'; $env:FRONTEND_DIST_DIR='<build folder>'
 *   $env:GOODEX_ENABLE_LIVE='false'; $env:GOODEX_BASE_URL='http://127.0.0.1:1'
 *   node server/scripts/test_seo_html.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();

const distDir = process.env.FRONTEND_DIST_DIR;
if (!distDir || !fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('Refusing to run: set FRONTEND_DIST_DIR to a fresh frontend build (it needs index.html).');
  process.exit(1);
}
if (process.env.SEO_HTML !== 'on' || !process.env.SITE_URL) {
  console.error('Refusing to run: set SEO_HTML=on and SITE_URL in the command.');
  process.exit(1);
}
if (process.env.GOODEX_ENABLE_LIVE === 'true') {
  console.error('Refusing to run with GOODEX_ENABLE_LIVE=true.');
  process.exit(1);
}

const { app } = await import('../app.js');
const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products, reviews } = await import('../models/index.js');

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

const SITE = env.seo.siteUrl;
let BASE = '';
const get = async (p) => {
  const res = await fetch(`${BASE}${p}`, { redirect: 'manual' });
  return { res, html: await res.text() };
};
const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

async function runTests() {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);

  const built = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  assert(/<!--seo-head-->[\s\S]*<!--\/seo-head-->/.test(built), 'the markers survive the production build');
  assert(env.seo.htmlEnabled && SITE === process.env.SITE_URL, 'SEO_HTML is on and SITE_URL is read from the environment');

  const marker = `seo${crypto.randomBytes(4).toString('hex')}`;
  const created = { categoryId: null, productIds: [] };
  const hiddenName = `Prototype Confidentiel ${marker}`;
  const hostileName = `Robe "Été" </script><script>alert(1)</script> $& $1 ${marker}`;

  try {
    const [category] = await db.insert(categories).values({ name: `Catégorie ${marker}`, slug: marker }).returning();
    created.categoryId = category.id;
    const insertProduct = async (values) => {
      const [row] = await db
        .insert(products)
        .values({ description: `Description ${marker}`, price: '30.000', categoryId: category.id, isActive: true, ...values })
        .returning();
      created.productIds.push(row.id);
      return row;
    };
    const active = await insertProduct({ title: `Pyjama ${marker}`, slug: `${marker}-a`, price: '45.000', discountAmount: '5.000' });
    const hidden = await insertProduct({ title: hiddenName, slug: `${marker}-h`, isActive: false });
    const hostile = await insertProduct({ title: hostileName, slug: `${marker}-x` });
    await db.insert(reviews).values({
      productId: active.id,
      guestSessionId: crypto.randomUUID(),
      authorName: 'Client',
      rating: 4,
      comment: `Avis ${marker}`,
      isApproved: true,
      status: 'approved',
    });
    await db.insert(reviews).values({
      productId: active.id,
      guestSessionId: crypto.randomUUID(),
      authorName: 'Client',
      rating: 1,
      comment: `Avis en attente ${marker}`,
      isApproved: false,
      status: 'pending',
    });

    console.log('\n--- Active product ---');
    let { res, html } = await get(`/product/${active.slug}`);
    assert(res.status === 200 && html.includes(`<title data-seo>Pyjama ${marker} | Silky</title>`), 'active product: 200 and its title in the raw HTML');
    assert(html.includes(`name="description" content="Description ${marker}"`), 'active product: description in the raw HTML');
    assert(html.includes(`<link rel="canonical" href="${SITE}/product/${active.slug}" data-seo>`), 'active product: absolute canonical');
    assert(html.includes('property="og:type" content="product"') && html.includes(`property="og:url" content="${SITE}/product/${active.slug}"`), 'active product: Open Graph tags');
    const blocks = ldBlocks(html);
    const productLd = blocks.find((b) => b['@type'] === 'Product');
    assert(productLd?.offers?.price === '40.000' && productLd.offers.priceCurrency === 'TND', 'active product: JSON-LD price is the discounted price in TND');
    assert(productLd?.aggregateRating?.reviewCount === 1 && productLd.aggregateRating.ratingValue === 4, 'active product: rating counts the approved review only');
    assert(blocks.some((b) => b['@type'] === 'BreadcrumbList' && b.itemListElement.length === 3), 'active product: breadcrumb');
    assert(!res.headers.get('set-cookie'), 'active product: no Set-Cookie on the HTML response');
    assert(html.includes('<div id="root">') && !html.includes('<!--seo-head-->'), 'active product: the app shell from the build is kept');

    console.log('\n--- Hidden product ---');
    ({ res, html } = await get(`/product/${hidden.id}`));
    assert(res.status === 404 && res.headers.get('x-robots-tag') === 'noindex' && html.includes('Produit introuvable | Silky'), 'hidden product: 404, noindex, "Produit introuvable"');
    assert(!html.includes(hiddenName) && !html.includes(marker) && !html.includes('application/ld+json'), 'hidden product: its name and data appear nowhere in the response');
    ({ res, html } = await get(`/product/${hidden.slug}`));
    assert(res.status === 404 && !html.includes(hiddenName), 'hidden product by slug: 404 as well, nothing leaks');

    console.log('\n--- Hostile product name ---');
    ({ res, html } = await get(`/product/${hostile.slug}`));
    const scripts = (html.match(/<script\b/g) || []).length;
    const builtScripts = (built.match(/<script\b/g) || []).length;
    assert(res.status === 200 && scripts === builtScripts + 2, 'hostile name: no script element added or closed early');
    assert(html.includes('&lt;/script&gt;&lt;script&gt;alert(1)') && html.includes('$&amp; $1'), 'hostile name: escaped in the head, "$&" and "$1" kept literally');
    assert(ldBlocks(html).find((b) => b['@type'] === 'Product')?.name === hostileName, 'hostile name: JSON-LD parses back to the exact name');

    console.log('\n--- Collections, uppercase ids, private pages ---');
    ({ res, html } = await get(`/collection/${marker}`));
    assert(res.status === 200 && html.includes(`href="${SITE}/collection/${marker}"`), 'category row in the database: 200 with canonical');
    const listed = html.match(/<div id="root">([\s\S]*?)<\/div>/); // the plain-text body has no inner div
    const listBody = listed ? listed[1] : '';
    assert(listBody.includes(`href="/product/${active.slug}">Pyjama ${marker}</a> - 40,000 TND`), 'collection page: the active product (discounted price) is listed from the database');
    assert(!listBody.includes(hiddenName), 'collection page: the hidden product is not listed');
    assert(listBody.includes('&lt;/script&gt;') && !listBody.includes('</script><script>alert(1)'), 'collection page: the hostile product name is escaped');
    ({ res, html } = await get('/'));
    assert(res.status === 200 && html.includes('<h1>Silky</h1>') && html.includes('"Organization"') && !html.includes(hiddenName), 'home page: shop name and Organization data in the raw HTML, no hidden product name');
    ({ res } = await get('/collection/zzz-unknown'));
    assert(res.status === 404 && res.headers.get('x-robots-tag') === 'noindex', 'unknown category: 404 noindex');
    ({ res } = await get(`/product/${active.id.toUpperCase()}`));
    assert(res.status === 301 && res.headers.get('location') === `/product/${active.slug}`, 'uppercase product id: one 301 to the slug address');
    ({ res } = await get(`/product/${active.id}`));
    assert(res.status === 301 && res.headers.get('location') === `/product/${active.slug}`, 'old id address: 301 to the slug address (real database)');
    ({ res } = await get('/product/not-a-uuid'));
    assert(res.status === 404, 'unknown slug: 404');
    ({ res } = await get('/cart'));
    assert(res.status === 200 && res.headers.get('x-robots-tag') === 'noindex', 'cart: 200 noindex');
    ({ res, html } = await get('/api/does-not-exist'));
    assert(!html.includes('<div id="root">'), '/api/does-not-exist does not return the HTML shell');

    console.log('\n--- robots.txt and sitemap.xml ---');
    ({ res, html } = await get('/robots.txt'));
    assert(res.status === 200 && html.includes(`Sitemap: ${SITE}/sitemap.xml`) && html.includes('User-agent: GPTBot') && (html.match(/Disallow/g) || []).length === 1, 'robots.txt names the sitemap and disallows only the AI training crawlers');
    ({ res, html } = await get('/sitemap.xml'));
    assert(res.status === 200 && html.includes(`<loc>${SITE}/product/${active.slug}</loc>`) && html.includes(`<loc>${SITE}/product/${hostile.slug}</loc>`), 'sitemap lists the active products');
    assert(!html.includes(hidden.id), 'sitemap does not list the hidden product');
    assert(html.includes(`<loc>${SITE}/collection/${marker}</loc>`), 'sitemap lists the category holding active products');
    assert(!html.includes('/cart') && !html.includes('/admin') && /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(html), 'sitemap lists no private page and has lastmod dates');
  } finally {
    console.log('\n--- Cleanup ---');
    try {
      if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds)); // cascades reviews
      if (created.categoryId) await db.delete(categories).where(eq(categories.id, created.categoryId));
      const leftProducts = created.productIds.length ? await db.select({ id: products.id }).from(products).where(inArray(products.id, created.productIds)) : [];
      const leftReviews = created.productIds.length ? await db.select({ id: reviews.id }).from(reviews).where(inArray(reviews.productId, created.productIds)) : [];
      const leftCategories = created.categoryId ? await db.select({ id: categories.id }).from(categories).where(eq(categories.id, created.categoryId)) : [];
      assert(leftProducts.length + leftReviews.length + leftCategories.length === 0, 'every inserted row (category, products, reviews) was removed');
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
  BASE = `http://127.0.0.1:${server.address().port}`;
  await runTests();
} catch (err) {
  failed++;
  console.error('✗ FAIL: unexpected error:', err);
} finally {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end().catch(() => {});
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
