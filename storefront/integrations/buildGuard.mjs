// Fails the build when the generated site is not complete. Runs after Astro has written dist/client. A failed build deploys
// nothing (npm run publish stops, and Cloudflare's build does not deploy), so the previous site keeps serving.
//
// It checks what a visitor or a crawler would meet, not what the code intended:
//   - every page the site must have exists (products and collections from the snapshot's own map, fixed pages from src/pages);
//   - none of them is a stub: a redirect page, an empty file, an unrendered template ("undefined", "[object Object]");
//   - every product page has one title, one canonical, one h1 and parseable Product JSON-LD; every page has a canonical on the
//     same site address;
//   - every URL in sitemap.xml has a file, and the sitemap lists every product (so a page cannot be missing from it);
//   - the control files are there (_headers with the security headers, _redirects, redirects-map.json, 404 pages, robots.txt).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_PAGE_BYTES = 2048;

/** The static pages src/pages generates: every .astro file without a [param] and without `prerender = false`, as dist/client paths. */
export function fixedPagePaths(pagesDir) {
  const out = [];
  (function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.includes('[')) walk(path.join(dir, entry.name), next);
      } else if (entry.name.endsWith('.astro') && !entry.name.includes('[')) {
        if (/export const prerender = false/.test(fs.readFileSync(path.join(dir, entry.name), 'utf8'))) continue;
        const route = next.replace(/\.astro$/, '');
        out.push(route === 'index' ? 'index.html' : route.endsWith('/index') ? `${route.slice(0, -'/index'.length)}.html` : `${route}.html`);
      }
    }
  })(pagesDir, '');
  return out;
}

/** Returns the list of problems found in a built site (empty = fine). `dist` is the client output folder. */
export function checkBuiltSite(dist, pagesDir, { collectionPageSize } = {}) {
  const problems = [];
  const add = (message) => problems.length < 40 && problems.push(message);
  const read = (file) => fs.readFileSync(path.join(dist, file), 'utf8');
  const exists = (file) => fs.existsSync(path.join(dist, file));

  for (const file of ['redirects-map.json', 'build-info.json', 'search-index.json', 'sitemap.xml', 'robots.txt', '404.html', 'ar/404.html', '_headers', '_redirects']) {
    if (!exists(file)) add(`missing ${file}`);
  }
  if (problems.length) return problems;

  let map;
  try {
    map = JSON.parse(read('redirects-map.json'));
  } catch {
    return ['redirects-map.json is not valid JSON'];
  }
  if (!Array.isArray(map.products) || !Array.isArray(map.collections) || typeof map.ids !== 'object') return ['redirects-map.json has the wrong shape'];
  if (map.products.length === 0) add('the site has no product pages');
  if (new Set(Object.values(map.ids)).size !== map.products.length) add('redirects-map.json: ids and products disagree');

  try {
    const info = JSON.parse(read('build-info.json'));
    if (!/^[0-9a-f]{64}$/.test(info.fingerprint ?? '') || info.products !== map.products.length) add('build-info.json has no valid fingerprint, or a product count that differs from the pages');
  } catch {
    add('build-info.json is not valid JSON');
  }

  try {
    const index = JSON.parse(read('search-index.json'));
    if (!Array.isArray(index) || index.length !== map.products.length) add('search-index.json does not list every product');
  } catch {
    add('search-index.json is not valid JSON');
  }

  const headers = read('_headers');
  for (const need of ['/*', 'X-Content-Type-Options', 'X-Frame-Options', 'Content-Security-Policy-Report-Only', '/admin/*']) {
    if (!headers.includes(need)) add(`_headers lacks ${need}`);
  }

  // Expected pages.
  const expected = new Set(['index.html', ...fixedPagePaths(pagesDir)]);
  for (const slug of map.products) for (const prefix of ['', 'ar/']) expected.add(`${prefix}product/${slug}.html`);
  for (const slug of map.collections) for (const prefix of ['', 'ar/']) expected.add(`${prefix}collection/${slug}.html`);
  for (const file of expected) if (!exists(file)) add(`missing page ${file}`);

  // Every generated page: not a stub, one title, a canonical on one site address.
  const canonicalHosts = new Set();
  const productFiles = new Set();
  for (const slug of map.products) for (const prefix of ['', 'ar/']) productFiles.add(`${prefix}product/${slug}.html`);
  const collectionPages = [];
  (function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== '_astro' && entry.name !== 'pictures' && entry.name !== 'admin') walk(path.join(dir, entry.name), next);
      } else if (entry.name.endsWith('.html')) collectionPages.push(next);
    }
  })(dist, '');

  for (const file of collectionPages) {
    const html = read(file);
    const label = file;
    if (/Redirecting to:|http-equiv="refresh"/i.test(html)) add(`${label} is a redirect stub`);
    if (Buffer.byteLength(html) < MIN_PAGE_BYTES) add(`${label} is only ${Buffer.byteLength(html)} bytes`);
    if (/\[object Object\]|>undefined<|NaN TND|>null</.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) add(`${label} shows an unrendered value (undefined / [object Object] / NaN)`);
    if ((html.match(/<title>[^<]+<\/title>/g) || []).length !== 1) add(`${label}: not exactly one <title>`);
    const canon = html.match(/<link rel="canonical" href="([^"]+)"/g) || [];
    if (file !== '404.html' && file !== 'ar/404.html' && canon.length !== 1) add(`${label}: ${canon.length} canonical links`);
    if (canon[0]) canonicalHosts.add(new URL(canon[0].match(/href="([^"]+)"/)[1]).origin);
    if (productFiles.has(file)) {
      if ((html.match(/<h1[\s>]/g) || []).length !== 1) add(`${label}: not exactly one <h1>`);
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      let hasProduct = false;
      for (const block of blocks) {
        try {
          const data = JSON.parse(block);
          if (['Product', 'ProductGroup'].includes(data['@type'])) hasProduct = true;
        } catch {
          add(`${label}: JSON-LD does not parse`);
        }
      }
      if (!hasProduct) add(`${label}: no Product JSON-LD`);
    }
  }
  if (canonicalHosts.size > 1) add(`pages disagree on the site address: ${[...canonicalHosts].join(', ')}`);

  // Collection pages beyond the first, when a collection is paginated: every page link on a collection page must exist.
  for (const file of collectionPages.filter((f) => /(^|\/)collection\/[^/]+\.html$/.test(f))) {
    const html = read(file);
    for (const m of html.matchAll(/<nav class="pagination"[\s\S]*?<\/nav>/g)) {
      for (const link of m[0].matchAll(/href="([^"]+)"/g)) {
        const target = link[1].replace(/^\//, '');
        if (!exists(`${target}.html`)) add(`${file}: pagination link ${link[1]} has no page`);
      }
    }
  }

  // Sitemap: every URL has a file; every product is listed.
  const sitemap = read('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  for (const pathname of locs) {
    const file = pathname === '/' ? 'index.html' : pathname === '/ar' ? 'ar.html' : `${pathname.replace(/^\//, '')}.html`;
    if (!exists(file)) add(`sitemap lists ${pathname} but there is no page for it`);
  }
  for (const slug of map.products) if (!locs.includes(`/product/${slug}`)) add(`sitemap does not list /product/${slug}`);
  if (/\/admin|\/cart|\/checkout/.test(locs.join(' '))) add('sitemap lists a private page');

  if (collectionPageSize !== undefined && !(Number.isInteger(collectionPageSize) && collectionPageSize >= 1)) add('bad collection page size');
  return problems;
}

/** The Astro integration. */
export default function buildGuard() {
  return {
    name: 'silky-build-guard',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const pagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/pages');
        const problems = checkBuiltSite(dist, pagesDir);
        if (problems.length) {
          throw new Error(`The built site is not complete, nothing may be published:\n  - ${problems.join('\n  - ')}`);
        }
        const count = fs.readdirSync(dist, { recursive: true }).filter((f) => String(f).endsWith('.html')).length;
        logger.info(`build guard: ${count} pages checked (titles, canonicals, JSON-LD, sitemap, control files): all fine`);
      },
    },
  };
}
