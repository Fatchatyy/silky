// SPIKE test: GET /api/storefront/snapshot must agree with the separate endpoints the pages use today.
// silky_test only. Usage: DATABASE_URL=postgres://.../silky_test node integration/test_snapshot.mjs
import assert from 'node:assert/strict';
import { assertSilkyTestUrl } from '../server/scripts/helpers/silky_test_guard.js';

assertSilkyTestUrl();
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:4321';
process.env.GOODEX_ENABLE_LIVE = 'false';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-snapshot-uploads-'));

const { startApi, createFixtures } = await import('./lib/fixtures.mjs');
const api = await startApi(0);
const fixtures = await createFixtures();
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); } catch (err) { failed++; console.error(`FAIL ${name}: ${err.message.split('\n')[0]}`); }
};
const get = async (p) => {
  const res = await fetch(`${api.url}/api${p}`);
  return { status: res.status, body: await res.json().catch(() => null) };
};
try {
  const started = Date.now();
  const { status, body: snap } = await get('/storefront/snapshot');
  const ms = Date.now() - started;
  console.log(`snapshot: HTTP ${status}, ${ms} ms, ${(JSON.stringify(snap).length / 1024).toFixed(1)} KB, ${snap.products?.length} products`);
  check('status 200 and the expected keys', () => {
    assert.equal(status, 200);
    for (const k of ['generatedAt', 'fingerprint', 'products', 'summaries', 'categories', 'reviews', 'theme', 'settings']) assert.ok(k in snap, k);
  });
  check('every published product has a card summary (no cap)', () => assert.equal(snap.summaries.length, snap.products.length));
  check('the fingerprint is a SHA-256 and the same on every call (rows may come back in another order)', async () => {
    assert.match(snap.fingerprint, /^[0-9a-f]{64}$/);
  });
  const again = (await get('/storefront/snapshot')).body;
  check('a second snapshot has the same fingerprint', () => assert.equal(again.fingerprint, snap.fingerprint));
  check('hidden product is in no part of the snapshot', () => {
    const hiddenSlug = fixtures.hidden.slug;
    assert.ok(!snap.products.some((p) => p.slug === hiddenSlug), 'products');
    assert.ok(!snap.summaries.some((p) => p.slug === hiddenSlug), 'summaries');
    assert.ok(!(fixtures.hidden.id in snap.reviews), 'reviews');
  });
  const home = await get('/storefront/home');
  check('summaries equal /storefront/home', () => assert.deepEqual(snap.summaries.slice(0, 200), home.body.products));
  const sitemap = await get('/storefront/sitemap-entries');
  check('updatedAt and hasArabic equal /storefront/sitemap-entries', () => {
    const fromSnap = snap.products.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt && new Date(p.updatedAt).toISOString(), hasArabic: p.hasArabic }));
    const fromApi = sitemap.body.products.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt && new Date(p.updatedAt).toISOString(), hasArabic: p.hasArabic }));
    const key = (a) => [...a].sort((x, y) => x.slug.localeCompare(y.slug));
    assert.deepEqual(key(fromSnap), key(fromApi));
  });
  check('category slugs equal the sitemap categories', () =>
    assert.deepEqual(snap.categories.map((c) => c.slug).sort(), sitemap.body.categories.map((c) => c.slug).sort()));
  for (const c of snap.categories) {
    const col = await get(`/storefront/collections/${c.slug}`);
    check(`collection ${c.slug}: name and cards equal`, () => {
      assert.equal(c.name, col.body.name);
      assert.deepEqual(snap.summaries.filter((p) => p.category === c.slug).slice(0, 200), col.body.products);
    });
  }
  let compared = 0;
  for (const p of snap.products) {
    const one = await get(`/products/by-slug/${p.slug}`);
    const { updatedAt, hasArabic, ...rest } = p;
    check(`product ${p.slug} equals /products/by-slug`, () => assert.deepEqual(JSON.parse(JSON.stringify(rest)), one.body));
    const rev = await get(`/products/${p.id}/reviews`);
    check(`reviews of ${p.slug} equal /products/:id/reviews`, () =>
      assert.deepEqual(snap.reviews[p.id] ?? { reviews: [], summary: { average: 0, count: 0 } }, rev.body));
    compared++;
  }
  const theme = await get('/theme');
  check('theme equals /theme', () => assert.deepEqual(snap.theme, theme.body));
  const settings = await get('/storefront/settings');
  check('settings equal /storefront/settings', () => assert.deepEqual(snap.settings, settings.body));
  console.log(`compared ${compared} products`);
} finally {
  const clean = await fixtures.cleanup();
  await api.stop();
  console.log(clean ? 'Fixtures removed.' : 'WARNING: fixtures left behind.');
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
