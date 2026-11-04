/**
 * What a crawler without JavaScript receives from the storefront: builds the storefront, runs it with `wrangler dev`
 * (the Workers runtime, like production) against the API on silky_test, and fetches pages with plain fetch.
 * Checks status codes (200/301/404/503), the single <title>/canonical/h1, hreflang, JSON-LD (parses, escapes), the
 * product name, price and description in the HTML, robots.txt, sitemap.xml (and crawls every URL of it), the page
 * cache, the security headers, and that the storefront imports nothing from the old SEO layer.
 *
 * Safety: refuses to run unless DATABASE_URL is set in the environment to exactly "silky_test" on a loopback host.
 * Test products are created through the product service and removed at the end (the removal is verified).
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node storefront/scripts/test_rendered_pages.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSilkyTestUrl } from '../../server/scripts/helpers/silky_test_guard.js';

assertSilkyTestUrl();
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:4321,http://localhost:5173';
process.env.GOODEX_ENABLE_LIVE = 'false';
process.env.GOODEX_BASE_URL = 'http://127.0.0.1:1';

const STOREFRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://silky.test';
const { startApi, createFixtures } = await import('./lib/fixtures.mjs');

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

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const killTree = (child) => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
};

let BASE = '';
async function get(pathname, { redirect = 'manual', headers = {} } = {}) {
  const res = await fetch(`${BASE}${pathname}`, { redirect, headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
}

const hasAlternates = (html) => html.includes("<link rel=\"alternate\" hreflang=");
const count = (html, pattern) => (html.match(pattern) || []).length;
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const meta = (html, attr, name) => (html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)) || [])[1];

function checkHead(html, label, { indexable = true } = {}) {
  assert(count(html, /<title>[^<]+<\/title>/g) === 1 && count(html, /<title/g) === 1, `${label}: exactly one non-empty <title>`);
  assert(count(html, /<link rel="canonical"/g) === 1, `${label}: exactly one canonical`);
  assert(count(html, /<h1[\s>]/g) === 1, `${label}: exactly one h1`);
  assert(count(html, /<main[\s>]/g) === 1, `${label}: one <main>`);
  const robots = meta(html, 'name', 'robots');
  assert(indexable ? robots === 'index,follow' : /^noindex/.test(robots || ''), `${label}: robots is ${robots}`);
}

async function runTests(fixtures, api) {
  const M = fixtures.marker;
  const robe = fixtures.robe;

  console.log('\n--- Home ---');
  const home = (await get('/')).text;
  const homeRes = await get('/');
  assert(homeRes.status === 200, 'home answers 200');
  assert(/<html lang="fr" dir="ltr">/.test(home), 'home: lang="fr" dir="ltr"');
  checkHead(home, 'home');
  assert(meta(home, 'name', 'description')?.length > 50, 'home has a description');
  assert(home.includes(`<link rel="canonical" href="${SITE}/">`), 'home canonical is the public address');
  for (const hreflang of ['fr', 'ar', 'x-default']) assert(home.includes(`hreflang="${hreflang}"`), `home has hreflang ${hreflang}`);
  const organization = jsonLd(home).find((d) => d['@type'] === 'Organization');
  assert(organization && organization.name === 'Silky' && organization.telephone && !organization.address, 'home: Organization JSON-LD without an address');
  assert(home.includes(`href="/product/${fixtures.robe.slug}"`) && home.includes(`Robe Satin ${M}`), 'home lists product names as real links in the HTML');
  assert(/79,900 TND/.test(home), 'home shows the discounted price of a product');
  assert(!home.includes(fixtures.hidden.slug), 'home never mentions a hidden product');

  const homeAr = (await get('/ar')).text;
  assert(/<html lang="ar" dir="rtl">/.test(homeAr), 'Arabic home: lang="ar" dir="rtl"');
  assert(/family=Cairo/.test(homeAr) && !/family=Cairo/.test(home), 'Arabic pages load the Cairo font, French pages do not');
  assert(meta(homeAr, 'property', 'og:locale') === 'ar_AR' && meta(home, 'property', 'og:locale') === 'fr_FR', 'og:locale is ar_AR / fr_FR');
  assert(homeAr.includes(`<link rel="canonical" href="${SITE}/ar">`), 'Arabic home canonical is /ar');
  checkHead(homeAr, 'Arabic home');

  console.log('\n--- Collections ---');
  const femme = await get('/collection/femme');
  assert(femme.status === 200, 'collection femme answers 200');
  checkHead(femme.text, 'collection femme');
  assert(femme.text.includes(`Robe Satin ${M}`) && femme.text.includes(`/product/${robe.slug}`) && /79,900 TND/.test(femme.text), 'collection lists product names, prices and links in the HTML');
  assert(!femme.text.includes(fixtures.hidden.slug) && !femme.text.includes(`Ensemble Enfant ${M}`), 'collection shows no hidden product and none of another collection');
  assert(jsonLd(femme.text).some((d) => d['@type'] === 'BreadcrumbList'), 'collection has BreadcrumbList JSON-LD');
  const custom = await get(`/collection/${fixtures.customCategory.slug}`);
  assert(custom.status === 200 && /index,follow/.test(custom.text), 'a collection that exists in the database is indexable');
  const customAr = await get(`/ar/collection/${fixtures.customCategory.slug}`);
  assert(customAr.status === 200 && /noindex/.test(customAr.text) && !hasAlternates(customAr.text), 'its Arabic page is noindex without hreflang (no Arabic title)');
  const unknownCollection = await get('/collection/nope-nothing');
  assert(unknownCollection.status === 404 && /noindex/.test(unknownCollection.text), 'an unknown collection answers a real 404 with noindex');

  console.log('\n--- Product ---');
  const page = await get(`/product/${robe.slug}`);
  assert(page.status === 200, 'product answers 200');
  checkHead(page.text, 'product');
  assert(page.text.includes(`<title>Robe Satin ${M} | Silky</title>`), 'product title is name | Silky');
  assert(page.text.includes(`<link rel="canonical" href="${SITE}/product/${robe.slug}">`), 'product canonical is /product/<slug>');
  assert(new RegExp(`<h1[^>]*>Robe Satin ${M}</h1>`).test(page.text), 'product name is the h1 in the HTML');
  assert(/79,900 TND/.test(page.text) && /89,900 TND/.test(page.text), 'price and discounted price are in the HTML');
  assert(page.text.includes('Une pièce élégante en tissu fluide'), 'product description is in the HTML');
  assert(/Très belle robe/.test(page.text), 'an approved review is in the HTML');
  assert(/<img[^>]+class="main_product_img"[^>]+fetchpriority="high"/i.test(page.text) || /fetchPriority|fetchpriority="high"/.test(page.text), 'main photo has fetchpriority high');
  assert(!/class="main_product_img"[^>]*loading="lazy"/.test(page.text), 'main photo is not lazy');
  assert(/loading="lazy"/.test(page.text), 'other photos are lazy');
  assert(/<img[^>]+alt="Robe Satin [^"]*Noir[^"]*"/.test(page.text), 'photo alt text names the product and colour');
  assert(/>S</.test(page.text) && />M</.test(page.text), 'sizes are in the HTML');
  assert(/<nav[^>]*><ol>/.test(page.text) && /Collection Femme/.test(page.text), 'breadcrumb nav is in the HTML');
  assert(/frais de livraison/i.test(page.text) && /48 heures/.test(page.text) && /remboursement/i.test(page.text), 'delivery fee, delay and exchange/refund conditions are in the HTML');
  const ld = jsonLd(page.text);
  const group = ld.find((d) => ['Product', 'ProductGroup'].includes(d['@type']));
  assert(group && group.name === `Robe Satin ${M}` && group.brand.name === 'Silky', 'Product JSON-LD parses and names the product');
  const offer = (group.offers || group.hasVariant?.[0]?.offers);
  assert(offer && offer.priceCurrency === 'TND' && offer.price === 79.9 && /InStock|OutOfStock/.test(offer.availability), 'offer: price as number in TND, availability');
  assert(offer.shippingDetails.shippingDestination.addressCountry === 'TN' && offer.shippingDetails.deliveryTime.transitTime.maxValue === 2, 'offer: shipping to TN in 1-2 days');
  assert(group.aggregateRating && group.aggregateRating.reviewCount === 1, 'aggregateRating present because the product has a review');
  assert(ld.some((d) => d['@type'] === 'BreadcrumbList'), 'BreadcrumbList JSON-LD present');
  assert(!JSON.stringify(ld).includes('hasMerchantReturnPolicy'), 'no return policy in the JSON-LD (facts not confirmed)');
  assert(meta(page.text, 'property', 'og:type') === 'product' && /og:image/.test(page.text), 'Open Graph product type and image');
  for (const hreflang of ['fr', 'ar', 'x-default']) assert(page.text.includes(`hreflang="${hreflang}"`), `product has hreflang ${hreflang} (it has a real Arabic text)`);

  const arPage = await get(`/ar/product/${robe.slug}`);
  assert(arPage.status === 200 && /<html lang="ar" dir="rtl">/.test(arPage.text), 'Arabic product answers 200 with rtl');
  assert(arPage.text.includes('<title>فستان ساتان | Silky</title>') && /<h1[^>]*>فستان ساتان<\/h1>/.test(arPage.text), 'Arabic product: Arabic title and h1');
  assert(arPage.text.includes('فستان ساتان أنيق بقصة مستقيمة'), 'Arabic product: Arabic description');
  assert(/د\.ت/.test(arPage.text), 'Arabic product: prices end with د.ت');
  assert(arPage.text.includes('أسود'), 'Arabic product: its own Arabic colour name is used');
  assert(arPage.text.includes(`<link rel="canonical" href="${SITE}/ar/product/${robe.slug}">`) && /index,follow/.test(arPage.text), 'Arabic product: own canonical, indexable');
  const arFallback = await get(`/ar/product/${fixtures.chemise.slug}`);
  assert(arFallback.status === 200 && /noindex/.test(arFallback.text) && !hasAlternates(arFallback.text), 'Arabic page of a product without Arabic text: noindex, no hreflang');
  assert(arFallback.text.includes(`Chemise Lin ${M}`), 'it still shows the French text as a fallback');
  const frNoTwin = await get(`/product/${fixtures.chemise.slug}`);
  assert(!hasAlternates(frNoTwin.text) && /index,follow/.test(frNoTwin.text), 'French page of that product: indexable, no hreflang pointing to a noindex page');

  const evil = await get(`/product/${fixtures.evil.slug}`);
  assert(evil.status === 200, 'product whose text contains </script> answers 200');
  // Inside a quoted attribute or the escaped <title> the text is inert; anywhere else it would be a script element.
  const outsideAttributes = evil.text.replace(/="[^"]*"/g, '=""').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  assert(!/<script>\s*(alert|window\.__pwned)/.test(outsideAttributes), 'a product text containing </script> never becomes a script element');
  assert(count(evil.text, /<script type="application\/ld\+json">/g) === 2, 'only the two JSON-LD scripts carry the product text (data, not code)');
  const evilLd = jsonLd(evil.text).find((d) => ['Product', 'ProductGroup'].includes(d['@type']));
  assert(evilLd && evilLd.description.includes('</script><script>window.__pwned=1</script>'), 'its JSON-LD still parses and carries the exact text');
  assert(!/<title>[^<]*<\/script>/.test(evil.text), 'the title is escaped');

  console.log('\n--- Redirects, 404 and 503 ---');
  const byId = await get(`/product/${robe.id}`);
  assert(byId.status === 301 && new URL(byId.location, BASE).pathname === `/product/${robe.slug}`, 'product id -> one 301 to the slug address');
  const byIdUpper = await get(`/product/${robe.id.toUpperCase()}`);
  assert(byIdUpper.status === 301 && new URL(byIdUpper.location, BASE).pathname === `/product/${robe.slug}`, 'uppercase id -> 301 to the slug address');
  const arById = await get(`/ar/product/${robe.id}`);
  assert(arById.status === 301 && new URL(arById.location, BASE).pathname === `/ar/product/${robe.slug}`, 'Arabic id address keeps its /ar prefix');
  const upper = await get(`/product/${robe.slug.toUpperCase()}`);
  assert(upper.status === 301 && new URL(upper.location, BASE).pathname === `/product/${robe.slug}`, 'uppercase slug -> 301');
  const slash = await get(`/product/${robe.slug}/`);
  assert(slash.status === 301 && new URL(slash.location, BASE).pathname === `/product/${robe.slug}`, 'trailing slash -> 301');
  const slashCollection = await get('/collection/femme/');
  assert(slashCollection.status === 301 && new URL(slashCollection.location, BASE).pathname === '/collection/femme', 'trailing slash on a collection -> 301');
  const indexHtml = await get('/index.html');
  assert(indexHtml.status === 301 && new URL(indexHtml.location, BASE).pathname === '/', '/index.html -> 301 /');
  const followed = await get(`/product/${robe.id}`, { redirect: 'follow' });
  assert(followed.status === 200, 'following the id redirect ends on a 200 (one hop, no chain)');

  const hidden = await get(`/product/${fixtures.hidden.slug}`);
  assert(hidden.status === 404 && /noindex/.test(hidden.text) && !hidden.text.includes('Produit Cache'), 'hidden product: real 404, noindex, no product text');
  const hiddenById = await get(`/product/${fixtures.hidden.id}`);
  assert(hiddenById.status === 404, 'hidden product by id: 404 (no redirect that would confirm it exists)');
  const missing = await get(`/product/${M}-does-not-exist`);
  assert(missing.status === 404 && /<title>[^<]*<\/title>/.test(missing.text), 'unknown product: real 404 with the 404 page');
  assert((await get('/ar/product/does-not-exist')).status === 404, 'Arabic unknown product: 404');
  assert((await get('/ar/admin')).status === 404, '/ar/admin is a 404');
  const nowhere = await get('/nowhere/at/all');
  assert(nowhere.status === 404 && /noindex/.test(nowhere.text), 'unknown page: real 404 with noindex');
  assert((await get('/ar/nowhere')).status === 404 && /lang="ar"/.test((await get('/ar/nowhere')).text), 'Arabic unknown page: 404 in Arabic');
  assert(hidden.headers.get("cache-control") === "no-store" && !nowhere.headers.get("x-silky-cache"), "a 404 is never cached");

  console.log('\n--- Other pages ---');
  for (const route of ['/faq', '/livraison-retours', '/service-client', '/about', '/contact']) {
    const res = await get(route);
    assert(res.status === 200, `${route} answers 200`);
    checkHead(res.text, route);
    const arRes = await get(`/ar${route}`);
    assert(arRes.status === 200 && /<html lang="ar" dir="rtl">/.test(arRes.text), `/ar${route} answers 200 in Arabic`);
    checkHead(arRes.text, `/ar${route}`);
  }
  const faq = await get('/faq');
  const faqLd = jsonLd(faq.text).find((d) => d['@type'] === 'FAQPage');
  assert(faqLd && faqLd.mainEntity.length >= 8, 'FAQ: FAQPage JSON-LD with every question');
  assert(faqLd.mainEntity.every((q) => faq.text.includes(q.name)), 'FAQ: every JSON-LD question is also visible in the HTML');
  assert(jsonLd((await get('/ar/faq')).text).some((d) => d['@type'] === 'FAQPage'), 'Arabic FAQ has FAQPage JSON-LD');
  for (const route of ['/search', '/cart', '/checkout', '/order-confirmation', '/login', '/signup', '/register', '/password-reset', '/password-reset/sometoken', '/favorites', '/account', '/leave-review']) {
    const res = await get(route);
    assert(res.status === 200 && /<meta name="robots" content="noindex/.test(res.text), `${route}: noindex`);
    assert(!hasAlternates(res.text), `${route}: no hreflang alternates`);
    assert(count(res.text, /<title>[^<]+<\/title>/g) === 1, `${route}: has one title`);
  }
  const reset = await get('/password-reset/secrettoken123');
  assert(!reset.text.includes('rel="canonical" href="' + SITE + '/password-reset/secrettoken123"'), 'password-reset canonical does not contain the token');
  assert(reset.headers.get('referrer-policy') === 'no-referrer', 'password-reset with a token sends no referrer');

  console.log('\n--- robots.txt and sitemap.xml ---');
  const robots = await get('/robots.txt');
  assert(robots.status === 200 && /^text\/plain/.test(robots.headers.get('content-type')), 'robots.txt is plain text');
  assert(robots.text.startsWith('User-agent: *\nAllow: /') && count(robots.text, /User-agent:/g) === 1, 'robots.txt: a single group for every crawler');
  assert(!/GPTBot|ClaudeBot|Google-Extended|CCBot|anthropic/i.test(robots.text), 'robots.txt blocks no AI crawler');
  for (const p of ['cart', 'checkout', 'account', 'login', 'signup', 'password-reset', 'favorites', 'search']) assert(robots.text.includes(`Disallow: /${p}\n`), `robots.txt disallows /${p}`);
  assert(robots.text.includes(`Sitemap: ${SITE}/sitemap.xml`), 'robots.txt announces the sitemap');

  const sitemap = await get('/sitemap.xml');
  assert(sitemap.status === 200 && /^application\/xml/.test(sitemap.headers.get('content-type')), 'sitemap.xml is XML');
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert(locs.includes(`${SITE}/product/${robe.slug}`) && locs.includes(`${SITE}/ar/product/${robe.slug}`), 'sitemap lists a product and its Arabic twin');
  assert(locs.includes(`${SITE}/product/${fixtures.chemise.slug}`) && !locs.includes(`${SITE}/ar/product/${fixtures.chemise.slug}`), 'sitemap lists no Arabic URL for a product without Arabic text');
  assert(!locs.some((l) => l.includes(fixtures.hidden.slug)), 'sitemap never lists a hidden product');
  assert(locs.includes(`${SITE}/collection/femme`) && locs.includes(`${SITE}/`) && locs.includes(`${SITE}/faq`), 'sitemap lists collections and fixed pages');
  assert(!locs.some((l) => /\/(cart|checkout|account|login|signup|search|favorites)/.test(l)), 'sitemap lists no private page');
  assert(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap.text) && /xhtml:link rel="alternate" hreflang="ar"/.test(sitemap.text), 'sitemap has lastmod and hreflang alternates');
  let bad = [];
  for (const loc of locs) {
    const res = await get(new URL(loc).pathname);
    if (res.status !== 200 || count(res.text, /<title>[^<]+<\/title>/g) !== 1) bad.push(`${new URL(loc).pathname} -> ${res.status}`);
  }
  assert(bad.length === 0, `crawling all ${locs.length} sitemap URLs: no 404/500 and no page without a title${bad.length ? ` (${bad.slice(0, 5).join(', ')})` : ''}`);

  console.log('\n--- Cache and headers ---');
  // The sitemap crawl above already fetched this page, so it may be a HIT; the next request must be one.
  const first = await get(`/product/${fixtures.enfantProduct.slug}`);
  const second = await get(`/product/${fixtures.enfantProduct.slug}?utm_source=x`);
  assert(['MISS', 'HIT'].includes(first.headers.get('x-silky-cache')) && second.headers.get('x-silky-cache') === 'HIT', 'a repeated request is a cache HIT (the query string does not bypass it)');
  assert(second.text === first.text, 'the cached page is the same page');
  assert(first.headers.get('cache-control') === 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400', 'visitor pages carry the s-maxage cache header');
  const authed = await get(`/product/${fixtures.enfantProduct.slug}`, { headers: { Authorization: 'Bearer x' } });
  assert(!authed.headers.get('x-silky-cache'), 'a request with an Authorization header skips the cache');
  assert((await get('/cart')).headers.get('x-silky-cache') === null, 'the cart shell is not cached');
  for (const [name, value] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY']]) assert(second.headers.get(name) === value, `header ${name}: ${value}`);
  assert(/strict-origin/.test(second.headers.get('referrer-policy') || '') && /camera=\(\)/.test(second.headers.get('permissions-policy') || ''), 'Referrer-Policy and Permissions-Policy are set');
  assert(/max-age=\d+/.test(second.headers.get('strict-transport-security') || ''), 'HSTS is set when the site address is https (production)');
  const csp = second.headers.get('content-security-policy-report-only') || '';
  assert(csp.includes("frame-ancestors 'none'") && csp.includes(`connect-src 'self' http://127.0.0.1:${new URL(api.url).port}`) && csp.includes('fonts.googleapis.com') && !second.headers.get('content-security-policy'), `CSP is report-only and allows the API, media and Google Fonts origins (got: ${csp})`);

  console.log('\n--- API down -> 503 ---');
  await api.stop();
  const never = await get(`/product/${M}-never-requested`);
  assert(never.status === 503 && never.headers.get('cache-control') === 'no-store' && /noindex/.test(never.text), 'API unreachable: the product page answers 503 (not 404), no-store, noindex');
  const robotsDown = await get('/robots.txt');
  assert(robotsDown.status === 200, 'robots.txt does not need the API');

  console.log('\n--- No dependency on the old SEO layer ---');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(astro|jsx?|tsx?|mjs)$/.test(entry.name)) files.push(full);
    }
  })(path.join(STOREFRONT, 'src'));
  const offenders = files.filter((file) => /src\/seo|server\/seo|SeoManager|useSeo|applyHead|renderBody/.test(fs.readFileSync(file, 'utf8')));
  assert(offenders.length === 0, `no file of storefront/src mentions src/seo, server/seo, SeoManager, useSeo or applyHead${offenders.length ? ` (${offenders.map((f) => path.relative(STOREFRONT, f)).join(', ')})` : ''}`);
  const headWriters = files.filter((file) => /<title|name="description"|rel="canonical"|hreflang=|property="og:|application\/ld\+json/.test(fs.readFileSync(file, 'utf8')));
  const allowed = new Set(['components/seo/Seo.astro', 'views/NotFoundView.astro'].map((p) => path.join(STOREFRONT, 'src', p)));
  const writers = headWriters.filter((file) => !file.endsWith('Seo.astro') && !file.includes(`${path.sep}lib${path.sep}seo${path.sep}`) && !file.endsWith('Header.astro') && !allowed.has(file));
  assert(writers.length === 0, `only Seo.astro writes title, description, canonical, hreflang, Open Graph and JSON-LD${writers.length ? ` (also: ${writers.map((f) => path.relative(STOREFRONT, f)).join(', ')})` : ''}`);
}

let api;
let fixtures;
let worker;
try {
  api = await startApi(0);
  fixtures = await createFixtures();
  const apiUrl = api.url;
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;

  console.log('Building the storefront...');
  const build = spawnSync('npx', ['astro', 'build'], {
    cwd: STOREFRONT,
    shell: true,
    encoding: 'utf8',
    // The API's .env says NODE_ENV=development; the storefront must be built as production (like a deploy).
    env: { ...process.env, NODE_ENV: 'production', PUBLIC_API_URL: apiUrl, PUBLIC_MEDIA_URL: apiUrl, PUBLIC_SITE_URL: SITE, API_URL: apiUrl },
  });
  assert(build.status === 0, 'astro build succeeds');
  if (build.status !== 0) throw new Error(`${build.stdout}\n${build.stderr}`.slice(-3000));

  console.log(`Starting wrangler dev on ${BASE} ...`);
  worker = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(port), '--persist-to', fs.mkdtempSync(path.join(os.tmpdir(), 'silky-wrangler-')), '--var', `API_URL:${apiUrl}`, '--var', `PUBLIC_API_URL:${apiUrl}`, '--var', `PUBLIC_SITE_URL:${SITE}`, '--var', `PUBLIC_MEDIA_URL:${apiUrl}`],
    { cwd: STOREFRONT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  worker.stdout.on('data', (d) => (log += d));
  worker.stderr.on('data', (d) => (log += d));
  const started = Date.now();
  while (!/Ready on/.test(log) && Date.now() - started < 90_000 && worker.exitCode === null) await new Promise((r) => setTimeout(r, 500));
  assert(/Ready on/.test(log), 'wrangler dev is ready');
  if (!/Ready on/.test(log)) throw new Error(log.slice(-2000));

  await runTests(fixtures, api);
} catch (err) {
  failed++;
  console.error('✗ FAIL: unexpected error:', err);
} finally {
  killTree(worker);
  if (api) await api.stop().catch(() => {});
  if (fixtures) {
    try {
      const clean = await fixtures.cleanup();
      assert(clean, 'every fixture row was removed');
    } catch (err) {
      failed++;
      console.error('✗ FAIL: cleanup error:', err.message);
    }
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
