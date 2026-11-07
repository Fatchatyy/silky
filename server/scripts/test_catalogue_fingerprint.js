/**
 * The catalogue fingerprint (services/catalogue.fingerprint.js) and the publish settings (config/env.js parsePublishConfig).
 * Pure: no database, no network. The fingerprint must change exactly when a rebuild of the public site would produce
 * something different, and not otherwise.
 *
 * Usage: node server/scripts/test_catalogue_fingerprint.js
 */
import assert from 'node:assert/strict';
import { canonicalSnapshot, snapshotFingerprint } from '../services/catalogue.fingerprint.js';
import { parsePublishConfig } from '../config/env.js';

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

const variant = (id, quantity, extra = {}) => ({ id, size: 'M', colorSlug: 'noir', colorName: 'Noir', stockQuantity: quantity, sku: `sku-${id}`, ...extra });
const product = (id, over = {}) => ({
  id,
  slug: `produit-${id}`,
  name: `Produit ${id}`,
  price: 79.9,
  discount: 0,
  category: 'femme',
  mainImage: `/uploads/${id}.jpg`,
  thumbnails: [`/uploads/${id}-a.jpg`, `/uploads/${id}-b.jpg`],
  colors: [{ id: 'noir', name: 'Noir' }],
  variants: [variant(`${id}-v1`, 5), variant(`${id}-v2`, 3, { size: 'L' })],
  stock: { 'noir-M': 5, 'noir-L': 3 },
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...over,
});
const snapshot = (over = {}) => ({
  generatedAt: '2026-11-06T10:00:00.000Z',
  products: [product('a'), product('b'), product('c')],
  summaries: [{ id: 'a', soldOut: false }, { id: 'b', soldOut: false }, { id: 'c', soldOut: false }],
  categories: [{ slug: 'enfant', name: 'Enfant' }, { slug: 'femme', name: 'Femme' }],
  reviews: { a: { reviews: [{ id: 'r1', rating: 5, comment: 'Superbe' }], summary: { average: 5, count: 1 } } },
  theme: { primary: '#8D191C', secondary: '#F3EBEC', announcements: [{ text: 'Livraison' }] },
  settings: { deliveryFee: 8 },
  ...over,
});
const fp = (s) => snapshotFingerprint(s);
const edit = (mutate) => {
  const s = snapshot();
  mutate(s);
  return s;
};

check('a fingerprint is a stable SHA-256 hex string', () => {
  assert.match(fp(snapshot()), /^[0-9a-f]{64}$/);
  assert.equal(fp(snapshot()), fp(snapshot()));
});

check('what must NOT change it: generatedAt, an existing fingerprint field, the order of rows and of keys', () => {
  const base = fp(snapshot());
  assert.equal(fp({ ...snapshot(), generatedAt: '2030-01-01T00:00:00.000Z' }), base);
  assert.equal(fp({ ...snapshot(), fingerprint: 'anything' }), base);
  const shuffled = snapshot();
  shuffled.products.reverse();
  shuffled.summaries.reverse();
  shuffled.products.forEach((p) => p.variants.reverse());
  shuffled.categories.reverse();
  assert.equal(fp(shuffled), base, 'rows in another order');
  const keys = JSON.parse(JSON.stringify(snapshot()), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.equal(fp(keys), base, 'keys in another order');
});

check('stock QUANTITIES that leave a variant in stock do not change it (an ordinary order must not start a build)', () => {
  const base = fp(snapshot());
  assert.equal(fp(edit((s) => { s.products[0].variants[0].stockQuantity = 2; s.products[0].stock['noir-M'] = 2; })), base, '5 -> 2');
  assert.equal(fp(edit((s) => { s.products[0].variants[1].stockQuantity = 40; s.products[0].stock['noir-L'] = 40; })), base, '3 -> 40');
});

check('a variant selling out, or coming back, DOES change it', () => {
  const base = fp(snapshot());
  const soldOut = edit((s) => { s.products[0].variants[0].stockQuantity = 0; s.products[0].stock['noir-M'] = 0; });
  assert.notEqual(fp(soldOut), base, 'in stock -> out of stock');
  const back = edit((s) => { s.products[0].variants[0].stockQuantity = 0; s.products[0].stock['noir-M'] = 0; });
  back.products[0].variants[0].stockQuantity = 7;
  back.products[0].stock['noir-M'] = 7;
  assert.equal(fp(back), base, 'and back in stock: the same site as before');
  const wholeProduct = edit((s) => { s.summaries[0].soldOut = true; });
  assert.notEqual(fp(wholeProduct), base, 'the card summary sold-out flag');
});

check('everything a page shows changes it: price, discount, name, text, photos, a variant, category, hidden/removed product, review, theme, delivery fee', () => {
  const base = fp(snapshot());
  const changes = {
    price: (s) => { s.products[1].price = 89.9; },
    discount: (s) => { s.products[1].discount = 10; },
    name: (s) => { s.products[1].name = 'Autre nom'; },
    updatedAt: (s) => { s.products[1].updatedAt = '2026-11-02T00:00:00.000Z'; },
    photo: (s) => { s.products[1].thumbnails = ['/uploads/other.jpg']; },
    'photo order': (s) => { s.products[1].thumbnails.reverse(); },
    'new variant': (s) => { s.products[1].variants.push(variant('b-v3', 1, { size: 'XL' })); },
    size: (s) => { s.products[1].variants[0].size = 'S'; },
    category: (s) => { s.products[1].category = 'enfant'; },
    'unpublished product': (s) => { s.products.pop(); s.summaries.pop(); },
    'new product': (s) => { s.products.push(product('d')); s.summaries.push({ id: 'd' }); },
    review: (s) => { s.reviews.a.reviews.push({ id: 'r2', rating: 4, comment: 'Bien' }); },
    'review text': (s) => { s.reviews.a.reviews[0].comment = 'Modifié'; },
    colour: (s) => { s.theme.primary = '#000000'; },
    announcement: (s) => { s.theme.announcements[0].text = 'Autre'; },
    'delivery fee': (s) => { s.settings.deliveryFee = 9; },
    'category name': (s) => { s.categories[0].name = 'Garçons'; },
  };
  for (const [name, mutate] of Object.entries(changes)) assert.notEqual(fp(edit(mutate)), base, `${name} should change the fingerprint`);
});

check('canonicalSnapshot reduces stock to booleans and leaves the input untouched', () => {
  const s = snapshot();
  const before = JSON.stringify(s);
  const canonical = canonicalSnapshot(s);
  assert.equal(JSON.stringify(s), before, 'the input snapshot is not modified');
  assert.deepEqual(Object.values(canonical.products[0].stock), [true, true]);
  assert.ok(canonical.products[0].variants.every((v) => v.inStock === true && !('stockQuantity' in v)));
  assert.ok(!('generatedAt' in canonical));
});

check('publish settings: unset, valid, invalid, and http in production', () => {
  assert.deepEqual(parsePublishConfig({}, false), { hookUrl: '', monthlyBuildLimit: 500, hookTimeoutMs: 10000 });
  const ok = parsePublishConfig({ PUBLISH_HOOK_URL: ' https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abc ', PUBLISH_MONTHLY_BUILD_LIMIT: '300', PUBLISH_HOOK_TIMEOUT_MS: '2000' }, true);
  assert.equal(ok.hookUrl, 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abc');
  assert.equal(ok.monthlyBuildLimit, 300);
  assert.equal(ok.hookTimeoutMs, 2000);
  assert.equal(parsePublishConfig({ PUBLISH_MONTHLY_BUILD_LIMIT: 'abc', PUBLISH_HOOK_TIMEOUT_MS: '5' }, false).monthlyBuildLimit, 500, 'junk falls back to the default');
  assert.ok(!('checkDelayMs' in ok), 'there is no waiting delay any more: nothing publishes by itself');
  assert.throws(() => parsePublishConfig({ PUBLISH_HOOK_URL: 'not a url' }, false), /not a valid URL/);
  assert.throws(() => parsePublishConfig({ PUBLISH_HOOK_URL: 'http://example.com/hook' }, true), /https/);
  assert.doesNotThrow(() => parsePublishConfig({ PUBLISH_HOOK_URL: 'http://127.0.0.1:9999/hook' }, false));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
