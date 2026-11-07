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
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importFromServer } from './lib/server_deps.mjs';
import { assertSilkyTestUrl } from '../server/scripts/helpers/silky_test_guard.js';

assertSilkyTestUrl();
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:4321';
process.env.GOODEX_ENABLE_LIVE = 'false';
process.env.GOODEX_BASE_URL = 'http://127.0.0.1:1';

const STOREFRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../storefront');
const SITE = 'https://silky.test';
// Collection pages hold this many products in the test build (the production default is 48): a small catalogue still gets several pages.
const PAGE_SIZE = '30';
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
  // The CSS of a page: its linked stylesheets and its inline <style> blocks (Astro inlines the small ones).
  const stylesheetText = async (html) => [...(await Promise.all([...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => get(m[1]).then((r) => r.text)))), ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])].join('\n');
  const frCss = await stylesheetText(home);
  const arCss = await stylesheetText(homeAr);
  // Astro bundles CSS by import, not by what a page renders, so the French pages may carry the Cairo @font-face rules too; a browser
  // downloads a font file only when text uses it, and no French text uses Cairo. What matters: the Arabic pages have the faces.
  assert(/cairo-arabic-400-normal/.test(arCss) && /cairo-latin-700-normal/.test(arCss), 'Arabic pages carry the Cairo font faces, served from this site');
  assert(/playfair-display-latin-400-normal/.test(frCss) && /playfair-display-latin-400-italic/.test(frCss), 'Playfair Display is served from this site');
  assert(!/googleapis|gstatic/.test(home + homeAr + frCss + arCss), 'no page or stylesheet mentions Google Fonts (no third-party request, no render-blocking font stylesheet)');
  const fontUrl = frCss.match(/url\(([^)]*playfair-display-latin-400-normal[^)]*\.woff2)\)/)?.[1]?.replace(/["']/g, '');
  const fontFile = fontUrl ? await get(fontUrl.startsWith('http') ? new URL(fontUrl).pathname : fontUrl) : null;
  assert(fontFile && fontFile.status === 200 && !fontFile.headers.get('x-silky-worker') && /immutable/.test(fontFile.headers.get('cache-control') || ''), 'a font file is a static file, cached as immutable');
  assert(home.includes('data-coverflow') && (home.match(/class="coverflow_card_link"/g) || []).length >= 1 && /class="coverflow_card coverflow_card_active"[^>]*data-offset="0"/.test(home), 'the home carousel is static HTML: its cards are real links in the first response and the first paint is already the coverflow (offset 0 active)');
  assert(!/astro-island[^>]*component-url="[^"]*Carousel/.test(home), 'the home carousel is not a JavaScript island any more');
  const carouselLinks = [...home.matchAll(/<a href="(\/product\/[^"]+)" class="coverflow_card_link"[^>]*>/g)].map((m) => m[1]);
  assert(carouselLinks.length >= 1 && carouselLinks.length <= 5 && carouselLinks.includes(`/product/${fixtures.robe.slug}`), 'the carousel links the newest products (at most 5, like the old coverflow), each to its product page');
  assert(/<img[^>]*class="coverflow_card_img"[^>]*loading="eager"[^>]*fetchpriority="high"|<img[^>]*fetchpriority="high"[^>]*class="coverflow_card_img"/.test(home) || /fetchpriority="high"[^>]*loading="eager"|loading="eager"[^>]*fetchpriority="high"/.test(home), 'the first carousel photo is loaded at once, with high priority (it is the largest thing on the page)');
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
  for (const p of ['cart', 'checkout', 'account', 'login', 'signup', 'password-reset', 'favorites', 'search', 'admin']) assert(robots.text.includes(`Disallow: /${p}\n`), `robots.txt disallows /${p}`);
  assert(robots.text.includes(`Sitemap: ${SITE}/sitemap.xml`), 'robots.txt announces the sitemap');

  const sitemap = await get('/sitemap.xml');
  assert(sitemap.status === 200 && /^application\/xml/.test(sitemap.headers.get('content-type')), 'sitemap.xml is XML');
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert(locs.includes(`${SITE}/product/${robe.slug}`) && locs.includes(`${SITE}/ar/product/${robe.slug}`), 'sitemap lists a product and its Arabic twin');
  assert(locs.includes(`${SITE}/product/${fixtures.chemise.slug}`) && !locs.includes(`${SITE}/ar/product/${fixtures.chemise.slug}`), 'sitemap lists no Arabic URL for a product without Arabic text');
  assert(!locs.some((l) => l.includes(fixtures.hidden.slug)), 'sitemap never lists a hidden product');
  assert(locs.includes(`${SITE}/collection/femme`) && locs.includes(`${SITE}/`) && locs.includes(`${SITE}/faq`), 'sitemap lists collections and fixed pages');
  assert(!locs.some((l) => /\/(cart|checkout|account|login|signup|search|favorites|admin)/.test(l)), 'sitemap lists no private page and no /admin');
  assert(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap.text) && /xhtml:link rel="alternate" hreflang="ar"/.test(sitemap.text), 'sitemap has lastmod and hreflang alternates');
  let bad = [];
  for (const loc of locs) {
    const res = await get(new URL(loc).pathname);
    if (res.status !== 200 || count(res.text, /<title>[^<]+<\/title>/g) !== 1) bad.push(`${new URL(loc).pathname} -> ${res.status}`);
  }
  assert(bad.length === 0, `crawling all ${locs.length} sitemap URLs: no 404/500 and no page without a title${bad.length ? ` (${bad.slice(0, 5).join(', ')})` : ''}`);

  console.log('\n--- Admin panel (/admin) ---');
  const adminShells = [];
  for (const route of ['/admin', '/admin/login', '/admin/orders', '/admin/anything/deep']) {
    const first = await get(route);
    const again = await get(route);
    adminShells.push(first.text);
    assert(first.status === 200 && again.status === 200, `${route} answers 200`);
    assert(/<meta name="robots" content="noindex,nofollow"/.test(first.text) && /noindex, nofollow/.test(first.headers.get('x-robots-tag') || ''), `${route}: noindex, nofollow in the meta tag and in X-Robots-Tag`);
    assert(first.headers.get('cache-control') === 'no-store' && !first.headers.get('x-silky-cache') && !again.headers.get('x-silky-cache'), `${route}: Cache-Control no-store and never stored by or served from the page cache (no x-silky-cache)`);
    assert(!/rel="canonical"|hreflang=|application\/ld\+json/.test(first.text), `${route}: no canonical, hreflang or JSON-LD (not an SEO page)`);
    assert(count(first.text, /<title>[^<]+<\/title>/g) === 1, `${route}: one title`);
  }
  assert(adminShells.every((html) => html === adminShells[0]), 'every address under /admin answers the same shell');
  assert(/AdminApp/.test(adminShells[0]) && /client="only"/.test(adminShells[0]), 'the admin shell mounts the AdminApp island client-side only (nothing of the admin is server-rendered)');
  assert((await get('/admin/')).status === 301, '/admin/ redirects once to /admin');
  assert((await get('/ar/admin')).status === 404, '/ar/admin stays a 404');

  console.log('\n--- A1. Normal pages are files: they never start the Worker ---');
  const WORKER = 'x-silky-worker';
  const filePaths = [
    '/', '/ar', '/collection/femme', '/ar/collection/femme', `/product/${robe.slug}`, `/ar/product/${robe.slug}`, `/product/${fixtures.chemise.slug}`, `/product/${fixtures.evil.slug}`,
    '/faq', '/ar/faq', '/livraison-retours', '/service-client', '/about', '/contact', '/ar/about', '/ar/contact',
    '/cart', '/checkout', '/account', '/login', '/signup', '/register', '/search', '/favorites', '/order-confirmation', '/leave-review', '/password-reset', '/ar/cart', '/ar/search',
    '/sitemap.xml', '/robots.txt', '/redirects-map.json', '/build-info.json', '/search-index.json', '/favicon.svg',
  ];
  const lacking = [];
  for (const route of filePaths) {
    const res = await get(route);
    if (res.status !== 200 || res.headers.get(WORKER)) lacking.push(`${route} -> ${res.status}${res.headers.get(WORKER) ? ' (ran the Worker)' : ''}`);
  }
  assert(lacking.length === 0, `${filePaths.length} pages and files answer 200 without the Worker (no ${WORKER} header)${lacking.length ? `: ${lacking.join(', ')}` : ''}`);
  const scriptSrc = (await get('/')).text.match(/(?:src|component-url|renderer-url)="(\/_astro\/[^"]+\.js)"/)?.[1];
  const asset = scriptSrc ? await get(scriptSrc) : null;
  assert(asset && asset.status === 200 && !asset.headers.get(WORKER) && /immutable/.test(asset.headers.get('cache-control') || ''), 'a hashed script in /_astro is a file, cached as immutable');
  for (const route of ['/about/', '/index.html', `/product/${robe.slug}/`, '/collection/femme/']) {
    const res = await get(route);
    assert(res.status === 301 && !res.headers.get(WORKER), `${route} -> one 301 from public/_redirects, without the Worker`);
  }
  const pageHeaders = await get(`/product/${fixtures.enfantProduct.slug}`);
  assert(!/s-maxage|stale-while-revalidate/.test(pageHeaders.headers.get('cache-control') || '') && !pageHeaders.headers.get('x-silky-cache'), 'a page is a file revalidated with its ETag: no s-maxage, no page cache');
  assert(pageHeaders.headers.get('etag'), 'a page has an ETag (conditional requests are answered with 304 by the platform)');
  for (const [name, value] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY']]) assert(pageHeaders.headers.get(name) === value, `file header ${name}: ${value} (from public/_headers)`);
  assert(/strict-origin/.test(pageHeaders.headers.get('referrer-policy') || '') && /camera=\(\)/.test(pageHeaders.headers.get('permissions-policy') || ''), 'Referrer-Policy and Permissions-Policy are set on files');
  assert(/max-age=\d+/.test(pageHeaders.headers.get('strict-transport-security') || ''), 'HSTS is set when the site address is https (production)');
  const csp = pageHeaders.headers.get('content-security-policy-report-only') || '';
  assert(csp.includes("frame-ancestors 'none'") && csp.includes(`connect-src 'self' http://127.0.0.1:${new URL(api.url).port}`) && !/googleapis|gstatic/.test(csp) && !pageHeaders.headers.get('content-security-policy'), `CSP is report-only and allows this build's API and media origins and no font origin (got: ${csp})`);
  const notFoundFile = await get('/404');
  assert(/noindex/.test(notFoundFile.text), 'the not-found file, if someone requests /404 directly, is noindex');

  console.log('\n--- A2. The only requests that run the Worker ---');
  for (const route of ['/admin', '/admin/login', '/admin/orders', '/admin/anything/deep']) {
    const res = await get(route);
    assert(res.status === 200 && res.headers.get(WORKER) === '1' && res.headers.get('cache-control') === 'no-store' && /noindex/.test(res.headers.get('x-robots-tag') || ''), `${route}: rendered by the Worker, no-store, noindex`);
  }
  const resetRes = await get('/password-reset/abc123token');
  assert(resetRes.status === 200 && resetRes.headers.get(WORKER) === '1' && resetRes.headers.get('referrer-policy') === 'no-referrer', '/password-reset/<token>: rendered by the Worker (the token is in the address), no referrer');
  const arResetRes = await get('/ar/password-reset/abc123token');
  assert(arResetRes.status === 200 && arResetRes.headers.get(WORKER) === '1', '/ar/password-reset/<token>: rendered by the Worker');

  console.log('\n--- A3. Old product addresses: one 301 from the map, nothing else ---');
  const hop = async (route, expectedPath) => {
    const res = await get(route);
    assert(res.status === 301 && res.headers.get(WORKER) === '1' && new URL(res.location, BASE).pathname === expectedPath, `${route} -> 301 ${expectedPath}`);
    return res;
  };
  const viaId = await hop(`/product/${robe.id}`, `/product/${robe.slug}`);
  assert(/public, max-age=\d+/.test(viaId.headers.get('cache-control') || ''), 'the redirect is cacheable by browsers and crawlers');
  await hop(`/product/${robe.id.toUpperCase()}`, `/product/${robe.slug}`);
  await hop(`/ar/product/${robe.id}`, `/ar/product/${robe.slug}`);
  const slashId = await get(`/ar/product/${robe.id}/`, { redirect: 'follow' });
  assert(slashId.status === 200 && slashId.text.includes(`Robe Satin ${M}`), 'an old id address with a trailing slash ends on the product page (two hops: slash, then id)');
  await hop(`/product/${robe.slug.toUpperCase()}`, `/product/${robe.slug}`);
  await hop('/collection/FEMME', '/collection/femme');
  await hop('/ar/collection/Femme', '/ar/collection/femme');
  await hop('/collection/FEMME/2', '/collection/femme/2');
  const withQuery = await get(`/product/${robe.id}?utm_source=facebook`);
  assert(withQuery.status === 301 && withQuery.location.endsWith(`/product/${robe.slug}?utm_source=facebook`), 'the query string survives the redirect');
  const followedAll = await get(`/product/${robe.id}`, { redirect: 'follow' });
  assert(followedAll.status === 200 && followedAll.text.includes(`Robe Satin ${M}`), 'following an old id address ends on the product page in one hop');
  assert((await get(`/product/${robe.slug}`)).status === 200 && !(await get(`/product/${robe.slug}`)).location, 'a canonical address is never redirected (no loop)');
  assert((await get(`/product/${fixtures.hidden.id}`)).status === 404, 'the id of a HIDDEN product is not in the map: 404, not a redirect that would confirm the product exists');
  assert((await get(`/product/${fixtures.hidden.slug.toUpperCase()}`)).status === 404, 'a hidden slug in capitals: 404');
  assert((await get('/product/00000000-0000-4000-8000-000000000000')).status === 404, 'an unknown id: 404');
  assert((await get('/product/%E0%A4%A')).status === 404, 'a malformed escape in the address: 404, not an error');
  const redirectMap = JSON.parse((await get('/redirects-map.json')).text);
  assert(redirectMap.ids[robe.id] === robe.slug && !(fixtures.hidden.id in redirectMap.ids) && !redirectMap.products.includes(fixtures.hidden.slug), 'redirects-map.json holds published products only');

  console.log('\n--- A4. Unknown addresses are genuine 404s ---');
  const unknowns = [
    `/product/${M}-nope`, '/product', '/collection/nope-nothing', '/collection', '/xyz', '/a/b/c/d/e', '/ar/xyz', '/ar/product/zzz',
    `/product/${fixtures.hidden.slug}`, `/ar/product/${fixtures.hidden.slug}`, '/collection/femme/1', '/collection/femme/0', '/collection/femme/abc', '/collection/femme/99999',
    '/internal/purge', '/admin-fake', '/ar/admin', '/product/..%2f..%2fetc%2fpasswd', '/ar/' + 'x'.repeat(300), '/404x',
  ];
  const wrong = [];
  for (const route of unknowns) {
    const res = await get(route);
    const isPage = /text\/html/.test(res.headers.get('content-type') || '');
    if (res.status !== 404 || !res.headers.get(WORKER) || !isPage || !/noindex/.test(res.text) || !/<h1/.test(res.text) || /products_grid|product_card/.test(res.text)) wrong.push(`${route.slice(0, 50)} -> ${res.status}`);
  }
  assert(wrong.length === 0, `${unknowns.length} unknown addresses: status 404, the not-found page (title, h1, noindex, no catalogue content), from the Worker${wrong.length ? `: ${wrong.join(', ')}` : ''}`);
  const filesMissing = [];
  for (const route of ['/wp-login.php', '/index.php', '/.env', '/_astro/missing.js', '/pictures/missing.png', '/favicon-nope.ico']) {
    const res = await get(route);
    if (res.status !== 404 || !/text\/plain/.test(res.headers.get('content-type') || '') || res.text.length > 20) filesMissing.push(`${route} -> ${res.status}`);
  }
  assert(filesMissing.length === 0, `a missing file (script, photo, probe) is a small plain 404, not a full page${filesMissing.length ? `: ${filesMissing.join(', ')}` : ''}`);
  for (const route of ['/product/', '/collection/']) {
    const slashed = await get(route, { redirect: 'follow' });
    assert(slashed.status === 404 && /noindex/.test(slashed.text), `${route} (an address with no slug): the slash is removed, then a genuine 404`);
  }
  const headRes = await fetch(`${BASE}/product/${M}-nope`, { method: 'HEAD' });
  assert(headRes.status === 404 && (await headRes.text()) === '', 'HEAD on an unknown address: 404 with no body');
  const postRes = await fetch(`${BASE}/product/${M}-nope`, { method: 'POST', body: '{}' });
  assert(postRes.status === 404, 'POST on an unknown address: 404');
  const postPurge = await fetch(`${BASE}/internal/purge`, { method: 'POST', body: '{}' });
  assert(postPurge.status === 404, 'the old cache-purge endpoint is gone (404)');
  const arabic404 = await get('/ar/does-not-exist');
  assert(arabic404.status === 404 && /<html lang="ar" dir="rtl">/.test(arabic404.text), 'an unknown address under /ar answers the Arabic 404 page');
  assert(/<html lang="fr" dir="ltr">/.test((await get('/does-not-exist')).text), 'an unknown French address answers the French 404 page');

  console.log('\n--- Collection pages (pagination) ---');
  const snapshot = await (await fetch(`${api.url}/api/storefront/snapshot`)).json();
  const buildInfo = JSON.parse((await get('/build-info.json')).text);
  assert(buildInfo.fingerprint === snapshot.fingerprint && buildInfo.products === snapshot.products.length && !Number.isNaN(Date.parse(buildInfo.builtAt)), 'build-info.json carries the fingerprint of the snapshot the pages were built from (the admin compares it with the API to show "changes not published")');
  assert(/noindex/.test((await get('/build-info.json')).headers.get('x-robots-tag') || ''), 'build-info.json is noindex');
  const searchIndex = JSON.parse((await get('/search-index.json')).text);
  const published = new Set(snapshot.products.map((p) => p.slug));
  assert(Array.isArray(searchIndex) && searchIndex.length === snapshot.products.length && searchIndex.every((p) => published.has(p.slug)), 'search-index.json lists every published product (and only those)');
  assert(!searchIndex.some((p) => p.slug === fixtures.hidden.slug || p.id === fixtures.hidden.id), 'the search index never lists a hidden product');
  assert(searchIndex.every((p) => p.id && p.name && Number.isFinite(p.price) && typeof p.category === 'string' && (p.description || '').length <= 300 && (p.descriptionAr || '').length <= 300), 'every search line has what a card and a match need, with descriptions cut to 300 characters');
  const robeLine = searchIndex.find((p) => p.slug === robe.slug);
  assert(robeLine && !('variants' in robeLine) && !('colors' in robeLine) && /Une pièce élégante/.test(robeLine.description), 'a search line is light (no variants or colours) but its description is searchable');
  assert(JSON.stringify(searchIndex).length < JSON.stringify(snapshot.products).length / 3, `the search index is much smaller than the product list it replaces (${JSON.stringify(searchIndex).length} against ${JSON.stringify(snapshot.products).length} characters)`);
  assert(/noindex/.test((await get('/search-index.json')).headers.get('x-robots-tag') || ''), 'search-index.json is noindex');
  const firstCollectionPage = (await get('/collection/femme')).text;
  // (split on the card markup: a product text may contain ">", the evil fixture has </script>)
  const cardImages = firstCollectionPage.split('<img ').slice(1).map((chunk) => chunk.match(/class="product_img" loading="(eager|lazy)"( fetchpriority="(\w+)")?/)).filter(Boolean).map((m) => ({ loading: m[1], priority: m[3] }));
  assert(cardImages.length >= 5 && cardImages.slice(0, 4).every((c) => c.loading === 'eager') && cardImages.slice(4).every((c) => c.loading === 'lazy'), `collection page: the first four card photos load at once, the rest are lazy (${cardImages.slice(0, 6).map((c) => c.loading).join(',')})`);
  assert(cardImages[0].priority === 'high' && cardImages.slice(1).every((c) => !c.priority), 'only the very first card photo has high priority');
  const pageSize = Number(PAGE_SIZE);
  const femmeSlugs = snapshot.summaries.filter((p) => p.category === 'femme').map((p) => p.slug);
  const pagesExpected = Math.max(1, Math.ceil(femmeSlugs.length / pageSize));
  console.log(`  femme: ${femmeSlugs.length} published products, ${pageSize} per page -> ${pagesExpected} page(s)`);
  const seen = new Set();
  let duplicates = 0;
  for (let n = 1; n <= pagesExpected; n++) {
    const res = await get(n === 1 ? '/collection/femme' : `/collection/femme/${n}`);
    assert(res.status === 200 && !res.headers.get(WORKER), `collection page ${n} is a file`);
    for (const m of res.text.matchAll(/class="product_card_link"[^>]*href="\/product\/([^"]+)"|href="\/product\/([^"]+)"[^>]*class="product_card_link"/g)) {
      const slug = m[1] || m[2];
      if (seen.has(slug)) duplicates++;
      seen.add(slug);
    }
    assert(res.text.includes(`<link rel="canonical" href="${SITE}/collection/femme${n === 1 ? '' : `/${n}`}">`), `collection page ${n}: its own canonical`);
    if (pagesExpected > 1) {
      assert(/<nav class="pagination"/.test(res.text), `collection page ${n}: pagination links in the HTML`);
      assert(n === 1 ? !/rel="prev"/.test(res.text) : res.text.includes(`rel="prev"`), `collection page ${n}: ${n === 1 ? 'no previous link' : 'a previous link'}`);
      assert(n === pagesExpected ? !/rel="next"/.test(res.text) : res.text.includes(`rel="next"`), `collection page ${n}: ${n === pagesExpected ? 'no next link' : 'a next link'}`);
    }
    if (n === 2) {
      assert(/<title>[^<]*Page 2[^<]*<\/title>/.test(res.text) && /index,follow/.test(res.text) && res.text.includes(`hreflang="ar" href="${SITE}/ar/collection/femme/2"`), 'page 2: its own title, indexable, hreflang to the Arabic page 2');
    }
  }
  assert(seen.size === femmeSlugs.length && duplicates === 0 && femmeSlugs.every((s) => seen.has(s)), `every one of the ${femmeSlugs.length} products of the collection is linked from exactly one page (no cap, no duplicate)`);
  assert((await get(`/collection/femme/${pagesExpected + 1}`)).status === 404 && (await get('/collection/femme/1')).status === 404, 'a page past the last one, and /1 (a duplicate of page 1), are 404');
  assert(pagesExpected === 1 || (await get('/ar/collection/femme/2')).status === 200, 'the Arabic collection is paginated too');
  assert(!/collection\/femme\/\d/.test((await get('/sitemap.xml')).text), 'the sitemap lists page 1 of a collection only');
  assert((await get('/')).text.split('class="product_card_link"').length - 1 <= 8, 'the home page shows 4 products per collection (its carousel is capped, the page stays small)');
  console.log('\n--- Admin code never reaches a visitor ---');
  const adminTraces = /ProductAdminLoader|AdminProductReviewsSection|AdminApp|admin-app|admin\/styles\.css|adminStyles|adminApi|admin_product_bar|Masqué du site/;
  for (const route of [`/product/${robe.slug}`, `/ar/product/${robe.slug}`, '/', '/collection/femme', `/product/${fixtures.hidden.slug}`]) {
    const res = await get(route);
    assert(!adminTraces.test(res.text) && !/<link[^>]+admin/i.test(res.text), `${route}: no admin code, style or content in the visitor HTML`);
    assert(!/<!--[^>]*(admin|src\/)/i.test(res.text), `${route}: no source comment about admin tooling leaks into the page`);
  }
  const hiddenPage = await get(`/product/${fixtures.hidden.slug}`);
  assert(hiddenPage.text.includes('data-admin-hidden-product') && !hiddenPage.text.includes('Produit Cache'), 'the hidden product 404 only carries an empty marker (the admin island fills it client-side)');
  const recs = page.text.match(/<section[^>]*data-admin-recs[^>]*>/);
  assert(recs && !/Produit Cache/.test(page.text), 'recommendations carry the marker and never the hidden product');
  assert(/<nav[^>]*class="product_breadcrumb"/.test(page.text) && !/<nav[^>]*class="product_breadcrumb"[^>]*(hidden|visually-hidden)/.test(page.text), 'the breadcrumb is a visible nav (not hidden)');
  assert((page.text.match(/<nav[^>]*class="product_breadcrumb"[\s\S]*?<\/nav>/)?.[0].match(/<li/g) || []).length === 3 && /aria-current="page"/.test(page.text), 'breadcrumb: Accueil, collection, product (current page marked)');
  assert(/<nav[^>]*class="product_breadcrumb"/.test(arPage.text) && arPage.text.includes('الرئيسية'), 'the Arabic breadcrumb is in the HTML, in Arabic');
  assert(/<section class="product_reviews_section product_geo_info"[^>]*>/.test(page.text), 'the delivery and returns block uses the site\'s product section style');

  console.log('\n--- A5. Hidden products stay protected ---');
  // 1. A hidden product is in no file of the build.
  const distClient = path.join(STOREFRONT, 'dist', 'client');
  const leaks = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'pictures') walk(full);
      } else if (/\.(html|json|xml|txt|js|css)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const needle of [fixtures.hidden.slug, fixtures.hidden.id, 'Produit Cache']) if (text.includes(needle)) leaks.push(`${path.relative(distClient, full)} contains ${needle.slice(0, 24)}`);
      }
    }
  })(distClient);
  assert(leaks.length === 0, `the hidden product (slug, id, name) is in no file of the build (html, json, xml, js, css)${leaks.length ? `: ${leaks.slice(0, 4).join('; ')}` : ''}`);

  // 2. Its address is a 404 for a visitor, and the 404 page only carries the hook the admin tools use.
  const hiddenFr = await get(`/product/${fixtures.hidden.slug}`);
  assert(hiddenFr.status === 404 && /id="not_found_main"/.test(hiddenFr.text) && /location\.pathname\.match/.test(hiddenFr.text), 'a hidden product address: the 404 page with the inline script that hands the slug to the admin tools');
  assert(!/data-admin-hidden-product="[^"]+"/.test(hiddenFr.text), 'the slug is not written into the HTML by the server (the script reads the address in the browser)');
  assert(!adminTraces.test(hiddenFr.text), 'no admin code in the 404 page: a visitor downloads nothing of the admin');

  // 3. The product itself is only returned to an admin token, by the API.
  const { createAccount: createAdminAccount, removeAccounts: removeAdminAccounts } = await import('../server/scripts/helpers/test_accounts.js');
  const { pool: adminPool } = await import('../server/db/pool.js');
  const { env: adminEnv } = await import('../server/config/env.js');
  const { default: adminJwt } = await importFromServer('jsonwebtoken');
  const customerId = await createAdminAccount(adminPool, 'customer', 'storefront-test');
  const adminId = await createAdminAccount(adminPool, 'admin', 'storefront-test');
  try {
    const sign = (id, role) => adminJwt.sign({ sub: id, email: `${role}@storefront-test.invalid`, role }, adminEnv.jwtSecret, { expiresIn: 600 });
    const bySlug = (token) => fetch(`${api.url}/api/products/by-slug/${fixtures.hidden.slug}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert((await bySlug()).status === 404, 'the API gives a visitor no hidden product');
    assert((await bySlug(sign(customerId, 'customer'))).status === 404, 'the API gives a customer no hidden product');
    assert((await bySlug('not.a.token')).status === 404, 'the API gives an invalid token no hidden product');
    const adminCall = await bySlug(sign(adminId, 'admin'));
    const adminProduct = await adminCall.json();
    assert(adminCall.status === 200 && adminProduct.isHidden === true && adminProduct.slug === fixtures.hidden.slug, 'the API gives an admin token the hidden product (what the preview in the browser loads)');
  } finally {
    await removeAdminAccounts(adminPool).catch(() => {});
  }
  assert(!(await get(`/product/${fixtures.hidden.slug}`)).text.includes('Produit Cache'), 'the preview needs the admin token: without it the page never shows the product');
  assert(/Disallow: \/admin\n/.test(robots.text), 'robots.txt disallows /admin');
  console.log('\n--- The API is down: the published site does not notice ---');
  await api.stop();
  for (const route of ['/', '/ar', `/product/${robe.slug}`, `/ar/product/${robe.slug}`, '/collection/femme', '/faq', '/cart', '/sitemap.xml', '/robots.txt']) {
    const res = await get(route);
    assert(res.status === 200 && !res.headers.get(WORKER), `API down: ${route} still answers 200 as a file`);
  }
  const downRedirect = await get(`/product/${robe.id}`);
  assert(downRedirect.status === 301, 'API down: an old id address is still redirected (the map is a file)');
  assert((await get(`/product/${M}-never-existed`)).status === 404, 'API down: an unknown address is still a 404 (not a 503)');
  assert((await get('/admin')).status === 200, 'API down: the admin shell is still served (its calls fail in the browser, not on the server)');
  assert((await get('/password-reset/sometoken')).status === 200, 'API down: the password-reset page falls back to the default theme');
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
  assert(offenders.length === 0, `no file of storefront/src mentions the old SEO layer (SeoManager, useSeo, applyHead, renderBody or its two folders)${offenders.length ? ` (${offenders.map((f) => path.relative(STOREFRONT, f)).join(', ')})` : ''}`);
  const headWriters = files.filter((file) => /<title|name="description"|rel="canonical"|hreflang=|property="og:|application\/ld\+json/.test(fs.readFileSync(file, 'utf8')));
  const allowed = new Set(['components/seo/Seo.astro', 'views/NotFoundView.astro'].map((p) => path.join(STOREFRONT, 'src', p)));
  const writers = headWriters.filter((file) => !file.endsWith('Seo.astro') && !file.includes(`${path.sep}lib${path.sep}seo${path.sep}`) && !file.endsWith('Header.astro') && !allowed.has(file));
  assert(writers.length === 0, `only Seo.astro writes title, description, canonical, hreflang, Open Graph and JSON-LD${writers.length ? ` (also: ${writers.map((f) => path.relative(STOREFRONT, f)).join(', ')})` : ''}`);
}

// --- B. The build and a sleeping or unusable API: it either publishes a complete site or fails, never a half-filled one. ---
async function runBuildScenarios(fixtures) {
  console.log('\n--- B. Build scenarios (the API asleep, never waking, wrong or incomplete data) ---');
  const live = await startApi(0); // a running API only to take a real snapshot from (the main run stopped its own)
  const publishDry = (env, onOutput = () => {}) =>
    new Promise((resolve) => {
      const child = spawn('node', ['scripts/publish.mjs', '--dry-run'], { cwd: STOREFRONT, shell: false, env: { ...process.env, ...env, NODE_ENV: 'production', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
      let out = '';
      const take = (d) => {
        out += d;
        onOutput(out);
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('close', (code) => resolve({ code, out }));
    });
  const baseEnv = (snapshotUrl, extra = {}) => ({ PUBLIC_API_URL: snapshotUrl, PUBLIC_MEDIA_URL: snapshotUrl, PUBLIC_SITE_URL: SITE, API_URL: snapshotUrl, SNAPSHOT_API_URL: snapshotUrl, ALLOW_LOCAL_API_FOR_BUILD: '1', COLLECTION_PAGE_SIZE: PAGE_SIZE, ...extra });

  // B1. The API is asleep when the build asks for the catalogue, and wakes up only after the build has been refused twice (a real
  // Render cold start is 30-60 s: the retry schedule is the same, only shorter here). The build must wait, then publish a
  // COMPLETE site. The API is started when the build's own log shows the second refusal, so the timing cannot drift.
  const wakePort = await freePort();
  const wakeUrl = `http://127.0.0.1:${wakePort}`;
  let wakeApi = null;
  let waking = false;
  const slept = await publishDry(baseEnv(wakeUrl), (out) => {
    if (!waking && /snapshot attempt 2 failed/.test(out)) {
      waking = true;
      startApi(wakePort).then((started) => (wakeApi = started));
    }
  });
  assert(slept.code === 0, `B1 API asleep when the build asks (refused twice), awake after that: the build waits and succeeds${slept.code === 0 ? '' : `\n${slept.out.slice(-1500)}`}`);
  assert(/\[snapshot\] snapshot attempt 1 failed \(no connection/.test(slept.out) && /snapshot received after [3-9]\d* attempt/.test(slept.out), `B1 the log shows a refused attempt, a pause, then the snapshot${/snapshot attempt 1 failed/.test(slept.out) ? '' : `\n${slept.out.split('\n').filter((l) => /snapshot/.test(l)).join('\n')}`}`);
  assert(/build guard: \d+ pages checked/.test(slept.out) && /DRY RUN: the site was built and checked/.test(slept.out), 'B1 the build guard ran and the deploy step was reached');
  const builtProduct = path.join(STOREFRONT, 'dist', 'client', 'product', `${fixtures.robe.slug}.html`);
  assert(fs.existsSync(builtProduct) && fs.statSync(builtProduct).size > 5000, 'B1 the site that was built is complete (the fixture product page is a real page)');
  if (wakeApi) await wakeApi.stop();

  // B2. The API never wakes: the build gives up inside its budget, with a clear message, and deploys nothing.
  const deadPort = await freePort();
  const started = Date.now();
  const never = await publishDry(baseEnv(`http://127.0.0.1:${deadPort}`, { SNAPSHOT_BUDGET_MS: '9000', SNAPSHOT_ATTEMPT_TIMEOUT_MS: '2000' }));
  assert(never.code !== 0 && /Could not get the catalogue snapshot/.test(never.out) && /Nothing was built/.test(never.out), 'B2 API never wakes: the build fails with a clear message');
  assert(/STOPPED: "2\/3 build the site/.test(never.out) && !/DRY RUN: the site was built/.test(never.out) && !/Deployed/.test(never.out), 'B2 the publish script stops at the build: the deploy step is never reached');
  assert(Date.now() - started < 60_000, `B2 it gave up within its time budget (${Math.round((Date.now() - started) / 1000)} s, not an endless wait)`);

  // B3. The API answers, but with something that must not be published.
  const realSnapshot = await (await fetch(`${live.url}/api/storefront/snapshot`)).json();
  const serveJson = async (body, status = 200) => {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((resolve) => (server.closeAllConnections?.(), server.close(resolve))) };
  };
  const refused = async (label, body, pattern, status = 200) => {
    const server = await serveJson(body, status);
    try {
      const result = await publishDry(baseEnv(server.url, { SNAPSHOT_BUDGET_MS: '20000', SNAPSHOT_ATTEMPT_TIMEOUT_MS: '5000' }));
      assert(result.code !== 0 && pattern.test(result.out) && !/DRY RUN: the site was built/.test(result.out), `B3 ${label}: the build fails and nothing is deployed`);
    } finally {
      await server.stop();
    }
  };
  await refused('an empty catalogue', { ...realSnapshot, products: [], summaries: [], categories: [], reviews: {} }, /near-empty/);
  await refused('a hidden product inside the snapshot', { ...realSnapshot, products: realSnapshot.products.map((p, i) => (i === 0 ? { ...p, isHidden: true } : p)) }, /hidden product is in the snapshot/);
  await refused('summaries that do not match the products', { ...realSnapshot, summaries: realSnapshot.summaries.slice(1) }, /card summaries for/);
  await refused('an answer that is not a snapshot', { error: 'Internal server error' }, /cannot be published/);
  await refused('the endpoint does not exist (404)', { error: 'not found' }, /404/, 404);

  // B4. A production-looking build (https site address) must not read a database on this machine.
  const local = await publishDry({ ...baseEnv(live.url), ALLOW_LOCAL_API_FOR_BUILD: '' });
  assert(local.code !== 0 && /Refusing to publish a site built from a local database/.test(local.out), 'B4 a build for the https site address refuses an API on this machine (a developer database)');
  await live.stop();
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

  console.log('Building the storefront (npm run build: headers, snapshot, pages, build guard)...');
  const build = await new Promise((resolve) => {
    // Asynchronous on purpose: the API of this test runs in THIS process and must answer the build's snapshot request.
    const child = spawn('npm', ['run', 'build'], {
      cwd: STOREFRONT,
      shell: true,
      // The API's .env says NODE_ENV=development; the storefront must be built as production (like a deploy).
      env: { ...process.env, NODE_ENV: 'production', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', PUBLIC_API_URL: apiUrl, PUBLIC_MEDIA_URL: apiUrl, PUBLIC_SITE_URL: SITE, API_URL: apiUrl, SNAPSHOT_API_URL: apiUrl, ALLOW_LOCAL_API_FOR_BUILD: '1', COLLECTION_PAGE_SIZE: PAGE_SIZE },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (status) => resolve({ status, stdout: out, stderr: '' }));
  });
  assert(build.status === 0, 'npm run build succeeds');
  assert(/build guard: \d+ pages checked/.test(build.stdout) && /\[snapshot\] snapshot received after 1 attempt/.test(build.stdout), 'the build took ONE snapshot and the build guard passed');
  if (build.status !== 0) throw new Error(build.stdout.slice(-3000));

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
  killTree(worker);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await runBuildScenarios(fixtures);
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
