/**
 * Tests of the build guard (integrations/buildGuard.mjs): a complete fake site passes; every kind of damage a build could
 * produce (a missing page, a redirect stub, an empty file, an unrendered value, a missing control file, a sitemap that
 * lists a page that does not exist, a page without JSON-LD ...) is caught. No server, no database, no Astro.
 *
 * Usage: node storefront/scripts/test_build_guard.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBuiltSite, fixedPagePaths } from '../integrations/buildGuard.mjs';

const pagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/pages');
const SITE = 'https://silky.tn';

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`✓ PASS: ${label}`);
    passed++;
  } catch (err) {
    console.error(`✗ FAIL: ${label}\n   ${String(err.message).split('\n').join('\n   ')}`);
    failed++;
  }
}

const filler = '<p>' + 'x'.repeat(2200) + '</p>';
const pageHtml = (canonical, extra = '') =>
  `<!doctype html><html><head><title>Page | Silky</title><link rel="canonical" href="${canonical}"></head><body><main><h1>Titre</h1>${filler}${extra}</main></body></html>`;
const productHtml = (canonical) =>
  pageHtml(canonical, `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'P' })}</script>`);

/** A complete, valid site in a temp folder. */
function fakeSite() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-guard-'));
  const put = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dist, file)), { recursive: true });
    fs.writeFileSync(path.join(dist, file), content);
  };
  const products = ['robe-noire', 'chemise-lin'];
  const collections = ['femme', 'enfant'];
  const urlOf = (file) => `${SITE}/${file.replace(/\.html$/, '').replace(/^index$/, '')}`.replace(/\/$/, file === 'index.html' ? '/' : '');
  for (const file of fixedPagePaths(pagesDir)) put(file, file.includes('404') ? '<title>404</title>' + filler : pageHtml(urlOf(file)));
  put('index.html', pageHtml(`${SITE}/`));
  put('404.html', '<title>404</title>' + filler);
  put('ar/404.html', '<title>404</title>' + filler);
  for (const slug of products) for (const prefix of ['', 'ar/']) put(`${prefix}product/${slug}.html`, productHtml(`${SITE}/${prefix}product/${slug}`));
  for (const slug of collections) for (const prefix of ['', 'ar/']) put(`${prefix}collection/${slug}.html`, pageHtml(`${SITE}/${prefix}collection/${slug}`));
  put('redirects-map.json', JSON.stringify({ ids: { 'id-1': 'robe-noire', 'id-2': 'chemise-lin' }, products, collections }));
  put('build-info.json', JSON.stringify({ fingerprint: 'b'.repeat(64), snapshotGeneratedAt: '2026-11-06T10:00:00.000Z', builtAt: '2026-11-06T10:01:00.000Z', products: products.length }));
  put('search-index.json', JSON.stringify(products.map((slug) => ({ id: slug, slug, name: slug }))));
  put('robots.txt', 'User-agent: *\nAllow: /\n');
  put('_redirects', '/index.html / 301\n');
  put('_headers', '/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Content-Security-Policy-Report-Only: default-src \'self\'\n/admin/*\n  X-Robots-Tag: noindex\n');
  const locs = [`${SITE}/`, ...products.map((s) => `${SITE}/product/${s}`), ...collections.map((s) => `${SITE}/collection/${s}`)];
  put('sitemap.xml', `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`);
  return { dist, put, remove: (file) => fs.rmSync(path.join(dist, file)), read: (file) => fs.readFileSync(path.join(dist, file), 'utf8'), done: () => fs.rmSync(dist, { recursive: true, force: true }) };
}
const problemsOf = (site) => checkBuiltSite(site.dist, pagesDir);
const expectProblem = (label, damage, pattern) =>
  check(`caught: ${label}`, () => {
    const site = fakeSite();
    try {
      damage(site);
      const problems = problemsOf(site);
      assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
    } finally {
      site.done();
    }
  });

check('a complete site has no problem', () => {
  const site = fakeSite();
  try {
    assert.deepEqual(problemsOf(site), []);
  } finally {
    site.done();
  }
});

check('the fixed pages come from src/pages: static ones only, no [param] route, no admin, no password-reset token', () => {
  const pages = fixedPagePaths(pagesDir);
  for (const file of ['index.html', 'ar.html', 'about.html', 'ar/about.html', 'cart.html', 'ar/cart.html', 'password-reset.html', '404.html', 'ar/404.html', 'faq.html']) assert.ok(pages.includes(file), file);
  assert.ok(!pages.some((f) => /admin|\[|token|product\/|collection\//.test(f)), pages.join(', '));
});

expectProblem('a product page is missing', (s) => s.remove('product/robe-noire.html'), /missing page product\/robe-noire\.html/);
expectProblem('an Arabic product page is missing', (s) => s.remove('ar/product/chemise-lin.html'), /missing page ar\/product\/chemise-lin\.html/);
expectProblem('a collection page is missing', (s) => s.remove('collection/femme.html'), /missing page collection\/femme\.html/);
expectProblem('the home page is missing', (s) => s.remove('index.html'), /missing page index\.html/);
expectProblem('a fixed page is missing', (s) => s.remove('faq.html'), /missing page faq\.html/);
expectProblem('a product page is a redirect stub (the failure the first spike build had)', (s) => s.put('product/robe-noire.html', '<!doctype html><title>Redirecting to: /product/robe-noire</title><meta http-equiv="refresh" content="0;url=/product/robe-noire">' + filler), /redirect stub/);
expectProblem('a page is almost empty', (s) => s.put('about.html', '<title>x</title><link rel="canonical" href="https://silky.tn/about">'), /only \d+ bytes/);
expectProblem('a page shows "undefined"', (s) => s.put('about.html', pageHtml(`${SITE}/about`, '<p>Prix: <span>undefined</span></p>').replace('<span>undefined</span>', '>undefined<')), /unrendered value/);
expectProblem('a page shows [object Object]', (s) => s.put('about.html', pageHtml(`${SITE}/about`, '<p>[object Object]</p>')), /unrendered value/);
expectProblem('a product page has no h1', (s) => s.put('product/robe-noire.html', productHtml(`${SITE}/product/robe-noire`).replace('<h1>Titre</h1>', '')), /not exactly one <h1>/);
expectProblem('a product page has no Product JSON-LD', (s) => s.put('product/robe-noire.html', pageHtml(`${SITE}/product/robe-noire`)), /no Product JSON-LD/);
expectProblem('a product page has broken JSON-LD', (s) => s.put('product/robe-noire.html', pageHtml(`${SITE}/product/robe-noire`, '<script type="application/ld+json">{oops</script>')), /JSON-LD does not parse/);
expectProblem('a page has two canonical links', (s) => s.put('about.html', pageHtml(`${SITE}/about`).replace('</head>', `<link rel="canonical" href="${SITE}/other"></head>`)), /2 canonical/);
expectProblem('a page has no title', (s) => s.put('about.html', pageHtml(`${SITE}/about`).replace('<title>Page | Silky</title>', '')), /not exactly one <title>/);
expectProblem('pages disagree on the site address (a build with the wrong PUBLIC_SITE_URL)', (s) => s.put('about.html', pageHtml('http://localhost:4321/about')), /disagree on the site address/);
expectProblem('the sitemap lists a page that does not exist', (s) => s.put('sitemap.xml', s.read('sitemap.xml').replace('</urlset>', `<url><loc>${SITE}/product/ghost</loc></url></urlset>`)), /sitemap lists \/product\/ghost/);
expectProblem('the sitemap does not list a product', (s) => s.put('sitemap.xml', s.read('sitemap.xml').replace(`<url><loc>${SITE}/product/chemise-lin</loc></url>`, '')), /does not list \/product\/chemise-lin/);
expectProblem('the sitemap lists a private page', (s) => { s.put('cart.html', pageHtml(`${SITE}/cart`)); s.put('sitemap.xml', s.read('sitemap.xml').replace('</urlset>', `<url><loc>${SITE}/cart</loc></url></urlset>`)); }, /private page/);
for (const file of ['redirects-map.json', 'build-info.json', 'search-index.json', 'sitemap.xml', 'robots.txt', '404.html', 'ar/404.html', '_headers', '_redirects']) {
  expectProblem(`${file} is missing`, (s) => s.remove(file), new RegExp(`missing ${file.replace('.', '\\.')}`));
}
expectProblem('build-info.json has no fingerprint', (s) => s.put('build-info.json', JSON.stringify({ products: 2 })), /build-info.json has no valid fingerprint/);
expectProblem('build-info.json counts other products than the pages', (s) => s.put('build-info.json', JSON.stringify({ fingerprint: 'c'.repeat(64), products: 99 })), /product count/);
expectProblem('the search index misses a product', (s) => s.put('search-index.json', JSON.stringify([{ slug: 'robe-noire' }])), /does not list every product/);
expectProblem('the search index is not JSON', (s) => s.put('search-index.json', 'oops'), /search-index.json is not valid JSON/);
expectProblem('the redirect map is not JSON', (s) => s.put('redirects-map.json', 'Not found'), /not valid JSON/);
expectProblem('the redirect map has no products (an empty catalogue)', (s) => s.put('redirects-map.json', JSON.stringify({ ids: {}, products: [], collections: [] })), /no product pages/);
expectProblem('_headers lacks the security headers', (s) => s.put('_headers', '/admin/*\n  X-Robots-Tag: noindex\n'), /_headers lacks/);
expectProblem('a pagination link points to a page that does not exist', (s) => s.put('collection/femme.html', pageHtml(`${SITE}/collection/femme`, '<nav class="pagination"><a href="/collection/femme/9">9</a></nav>')), /pagination link \/collection\/femme\/9 has no page/);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
