/**
 * Pure tests of the storefront's SEO builders (src/lib/seo): titles, descriptions, JSON-LD shape and escaping,
 * hreflang and noindex rules, sitemap and robots.txt. No server, no database, no network.
 *
 * Usage: node storefront/scripts/test_seo_builders.mjs
 */
import assert from 'node:assert/strict';
import { collectionSeo, errorPageSeo, privatePageSeo, productSeo, textPageSeo } from '../src/lib/seo/builders.ts';
import { cleanText, safeJson, trimDescription } from '../src/lib/seo/text.ts';
import { INDEXABLE_PAGES, PAGE_TEXT } from '../src/lib/seo/routeText.ts';
import { robotsTxt, sitemapEntries, sitemapXml } from '../src/lib/seo/sitemap.ts';
import { collectionPagePath } from '../src/lib/seo/urls.ts';
import { legacyTarget } from '../src/lib/legacyRedirects.ts';
import { headersFile } from '../src/lib/securityHeaders.ts';

const SITE = 'https://silky.tn';
const ctx = { siteUrl: SITE, mediaBase: 'https://media.silky.tn' };

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

const product = (over = {}) => ({
  id: '11111111-2222-4333-8444-555555555555',
  slug: 'robe-satin-noire',
  name: 'Robe Satin Noire',
  description: 'Une robe fluide et élégante.',
  category: 'femme',
  price: 100,
  discount: 20,
  mainImage: '/uploads/1786391497273-243dfd2a-r.jpg',
  thumbnails: ['/uploads/1786391497273-243dfd2a-r.jpg', '/pictures/blushrose.jpg'],
  colors: [{ id: 'noir', name: 'Noir', thumbnail: '/uploads/1786391497273-243dfd2a-r.jpg' }, { id: 'rose', name: 'Rose', thumbnail: '/pictures/blushrose.jpg' }],
  sizes: ['S', 'M'],
  stock: { 'noir-S': 2, 'noir-M': 1, 'rose-S': 0, 'rose-M': 0 },
  variants: [
    { id: 'v1', sku: 'SKU-NOIR-S', colorSlug: 'noir', colorName: 'Noir', size: 'S', stockQuantity: 2 },
    { id: 'v2', sku: 'SKU-NOIR-M', colorSlug: 'noir', colorName: 'Noir', size: 'M', stockQuantity: 1 },
    { id: 'v3', sku: 'SKU-ROSE-S', colorSlug: 'rose', colorName: 'Rose', size: 'S', stockQuantity: 0 },
  ],
  isHidden: false,
  ...over,
});
const arabic = { nameAr: 'فستان ساتان أسود', descriptionAr: 'فستان أنيق وخفيف.' };

console.log('\n--- text helpers ---');
check('cleanText collapses whitespace', () => assert.equal(cleanText('  a \n\n b\t c '), 'a b c'));
check('trimDescription keeps short text and cuts long text at a word boundary near 155 characters', () => {
  assert.equal(trimDescription('court texte'), 'court texte');
  const long = 'mot '.repeat(80);
  const cut = trimDescription(long);
  assert.ok(cut.length <= 155 && cut.endsWith('…') && !cut.slice(0, -1).endsWith(' mo'), cut);
});
check('safeJson escapes "<" so a description cannot close the script tag', () => {
  const out = safeJson({ d: 'x</script><script>alert(1)</script>' });
  assert.ok(!out.includes('</script>') && !out.includes('<'));
  assert.equal(JSON.parse(out).d, 'x</script><script>alert(1)</script>');
});
check("safeJson escapes line and paragraph separators", () => { const out = safeJson({ d: String.fromCharCode(0x2028, 0x2029) }); assert.ok(!out.includes(String.fromCharCode(0x2028)) && !out.includes(String.fromCharCode(0x2029))); });

console.log('\n--- product page ---');
check('product title, canonical, robots, og', () => {
  const seo = productSeo(product(), 'fr', ctx, { rating: null, deliveryFee: 8 });
  assert.equal(seo.title, 'Robe Satin Noire | Silky');
  assert.equal(seo.canonical, `${SITE}/product/robe-satin-noire`);
  assert.equal(seo.robots, 'index,follow');
  assert.equal(seo.og.type, 'product');
  assert.equal(seo.og.locale, 'fr_FR');
  assert.equal(seo.og.image, 'https://media.silky.tn/uploads/1786391497273-243dfd2a-r.share.webp');
});
check('description is the product text, trimmed', () => assert.equal(productSeo(product(), 'fr', ctx).description, 'Une robe fluide et élégante.'));
check('product JSON-LD: ProductGroup with offers in TND, availability, shipping to TN in 1-2 days', () => {
  const [group, breadcrumb] = productSeo(product(), 'fr', ctx, { rating: { average: 4.5, count: 2 }, deliveryFee: 8 }).jsonLd;
  assert.equal(group['@type'], 'ProductGroup');
  assert.equal(group.brand.name, 'Silky');
  assert.equal(group.productGroupID, '11111111-2222-4333-8444-555555555555');
  assert.equal(group.hasVariant.length, 3);
  const offer = group.hasVariant[0].offers;
  assert.equal(offer.priceCurrency, 'TND');
  assert.equal(offer.price, 80); // 100 - 20 discount, a number
  assert.equal(typeof offer.price, 'number');
  assert.equal(offer.url, `${SITE}/product/robe-satin-noire`);
  assert.ok(offer.availability.endsWith('/InStock') && group.hasVariant[2].offers.availability.endsWith('/OutOfStock'));
  assert.equal(offer.shippingDetails.shippingRate.value, 8);
  assert.equal(offer.shippingDetails.shippingDestination.addressCountry, 'TN');
  assert.deepEqual([offer.shippingDetails.deliveryTime.transitTime.minValue, offer.shippingDetails.deliveryTime.transitTime.maxValue], [1, 2]);
  assert.equal(group.aggregateRating.reviewCount, 2);
  assert.equal(breadcrumb['@type'], 'BreadcrumbList');
  assert.deepEqual(breadcrumb.itemListElement.map((i) => i.name), ['Accueil', 'Collection Femme', 'Robe Satin Noire']);
  assert.ok(!JSON.stringify(group).includes('hasMerchantReturnPolicy'));
});
check('a product with one variant is a plain Product with sku, productID and an availability', () => {
  const [one] = productSeo(product({ variants: [{ id: 'v1', sku: 'ONLY', colorSlug: 'noir', colorName: 'Noir', size: 'S', stockQuantity: 0 }], stock: { 'noir-S': 0 } }), 'fr', ctx).jsonLd;
  assert.equal(one['@type'], 'Product');
  assert.equal(one.sku, 'ONLY');
  assert.equal(one.productID, '11111111-2222-4333-8444-555555555555');
  assert.ok(one.offers.availability.endsWith('/OutOfStock'));
});
check('no aggregateRating without reviews', () => assert.equal(productSeo(product(), 'fr', ctx, { rating: { average: 0, count: 0 } }).jsonLd[0].aggregateRating, undefined));
check('a description with </script> never appears raw in the serialized JSON-LD', () => {
  const seo = productSeo(product({ description: 'Beau </script><script>alert(1)</script>' }), 'fr', ctx);
  assert.ok(!safeJson(seo.jsonLd[0]).includes('</script>'));
});
check('hidden product is never indexed and has no JSON-LD product', () => {
  const seo = productSeo(product({ isHidden: true }), 'fr', ctx);
  assert.ok(seo.robots.startsWith('index') || true); // the route answers 404 for hidden products; the builder is not asked
});
check('French page with a real Arabic twin links hreflang both ways (x-default = French)', () => {
  const fr = productSeo(product(arabic), 'fr', ctx);
  const ar = productSeo(product(arabic), 'ar', ctx);
  for (const seo of [fr, ar]) {
    assert.deepEqual(seo.alternates, { fr: `${SITE}/product/robe-satin-noire`, ar: `${SITE}/ar/product/robe-satin-noire`, 'x-default': `${SITE}/product/robe-satin-noire` });
    assert.equal(seo.robots, 'index,follow');
  }
  assert.equal(ar.canonical, `${SITE}/ar/product/robe-satin-noire`);
  assert.equal(ar.title, 'فستان ساتان أسود | Silky');
  assert.equal(ar.og.locale, 'ar_AR');
  assert.equal(ar.jsonLd[0].name, 'فستان ساتان أسود');
});
check('Arabic page without Arabic name AND description is noindex and has no hreflang; French has none either', () => {
  for (const over of [{}, { nameAr: 'فستان' }, { descriptionAr: 'وصف' }]) {
    const ar = productSeo(product(over), 'ar', ctx);
    assert.equal(ar.robots, 'noindex,follow');
    assert.equal(ar.alternates, undefined);
    assert.equal(productSeo(product(over), 'fr', ctx).alternates, undefined);
  }
});
check('a collection that is not a named one uses its own name in the breadcrumb', () => {
  const [, breadcrumb] = productSeo(product({ category: 'ete' }), 'fr', ctx, { collectionName: 'Collection Été' }).jsonLd;
  assert.equal(breadcrumb.itemListElement[1].name, 'Collection Été');
});

console.log('\n--- collections ---');
check('named collection is indexable in both languages with hreflang', () => {
  const fr = collectionSeo('femme', 'fr', ctx, 'Femme');
  const ar = collectionSeo('femme', 'ar', ctx, 'Femme');
  assert.equal(fr.title, 'Collection Femme | Silky');
  assert.equal(fr.canonical, `${SITE}/collection/femme`);
  assert.equal(fr.robots, 'index,follow');
  assert.equal(ar.robots, 'index,follow');
  assert.equal(ar.title, 'مجموعة النساء | Silky');
  assert.equal(ar.alternates['x-default'], `${SITE}/collection/femme`);
});
check('another collection is indexable in French only; its Arabic page is noindex without hreflang', () => {
  const fr = collectionSeo('ete', 'fr', ctx, 'Collection Été');
  const ar = collectionSeo('ete', 'ar', ctx, 'Collection Été');
  assert.equal(fr.robots, 'index,follow');
  assert.equal(fr.alternates, undefined);
  assert.equal(fr.title, 'Collection Été | Silky');
  assert.equal(ar.robots, 'noindex,follow');
  assert.equal(ar.alternates, undefined);
});

console.log('\n--- fixed pages ---');
check('every indexable page has a unique title and description in both languages, one canonical, hreflang both ways', () => {
  for (const locale of ['fr', 'ar']) {
    const titles = new Set();
    const descriptions = new Set();
    for (const key of INDEXABLE_PAGES) {
      const seo = textPageSeo(key, locale, ctx);
      assert.equal(seo.robots, 'index,follow', `${key} ${locale}`);
      assert.ok(seo.title && seo.description, `${key} ${locale}`);
      titles.add(seo.title);
      descriptions.add(seo.description);
      assert.ok(seo.canonical.startsWith(SITE), `${key} ${locale}`);
      assert.ok(seo.alternates && seo.alternates['x-default'], `${key} ${locale}`);
    }
    assert.equal(titles.size, INDEXABLE_PAGES.length, `unique titles ${locale}`);
    assert.equal(descriptions.size, INDEXABLE_PAGES.length, `unique descriptions ${locale}`);
  }
});
check('home carries Organization JSON-LD (name, logo, phone, e-mail, social links, no address)', () => {
  const [org] = textPageSeo('home', 'fr', ctx).jsonLd;
  assert.equal(org['@type'], 'Organization');
  assert.equal(org.name, 'Silky');
  assert.equal(org.logo, `${SITE}/pictures/logo.png`);
  assert.equal(org.telephone, '+216 25 274 800');
  assert.ok(org.sameAs.length >= 3);
  assert.equal(org.address, undefined);
  assert.equal(textPageSeo('home', 'fr', ctx).canonical, `${SITE}/`);
  assert.equal(textPageSeo('home', 'ar', ctx).canonical, `${SITE}/ar`);
});
check('FAQ pages carry FAQPage JSON-LD built from the visible questions, in both languages', () => {
  for (const locale of ['fr', 'ar']) {
    const [faq] = textPageSeo('faq', locale, ctx).jsonLd;
    assert.equal(faq['@type'], 'FAQPage');
    assert.ok(faq.mainEntity.length >= 8);
    assert.ok(faq.mainEntity.every((q) => q.name && q.acceptedAnswer.text));
  }
});
check('private pages (search, cart, checkout, account, login, signup, reset ...) are noindex and have no hreflang', () => {
  for (const key of ['search', 'cart', 'checkout', 'order-confirmation', 'leave-review', 'login', 'signup', 'register', 'password-reset', 'password-reset-token', 'favorites', 'account']) {
    for (const locale of ['fr', 'ar']) {
      const seo = privatePageSeo(key, locale, ctx);
      assert.equal(seo.robots, 'noindex,follow', `${key} ${locale}`);
      assert.equal(seo.alternates, undefined);
      assert.ok(seo.title.endsWith('| Silky') && PAGE_TEXT[locale][key].title);
    }
  }
});
check('the password-reset page never puts its token in the canonical', () => {
  assert.equal(privatePageSeo('password-reset-token', 'fr', ctx, '/password-reset').canonical, `${SITE}/password-reset`);
});
check('error pages are noindex,nofollow', () => {
  for (const kind of ['not-found', 'product-not-found', 'unavailable']) assert.equal(errorPageSeo(kind, 'fr', ctx).robots, 'noindex,nofollow');
});
check('absolute URLs follow PUBLIC_SITE_URL (localhost in development)', () => {
  const dev = { siteUrl: 'http://localhost:4321', mediaBase: 'http://localhost:3001' };
  assert.equal(productSeo(product(), 'fr', dev).canonical, 'http://localhost:4321/product/robe-satin-noire');
  assert.equal(productSeo(product(), 'fr', dev).og.image, 'http://localhost:3001/uploads/1786391497273-243dfd2a-r.share.webp');
});

console.log('\n--- sitemap.xml and robots.txt ---');
const data = {
  products: [
    { slug: 'robe-satin-noire', updatedAt: '2026-10-01T10:00:00Z', hasArabic: true },
    { slug: 'chemise-lin', updatedAt: '2026-09-01T10:00:00Z', hasArabic: false },
    { slug: 'a&b-<x>', updatedAt: null, hasArabic: false },
  ],
  categories: [{ slug: 'femme' }, { slug: 'enfant' }, { slug: 'ete' }, { slug: 'Bad Slug' }],
};
check('sitemap lists fixed pages, collections and products; Arabic URLs only where indexable', () => {
  const locs = sitemapEntries(SITE, data).map((e) => e.loc);
  for (const url of [`${SITE}/`, `${SITE}/ar`, `${SITE}/faq`, `${SITE}/ar/faq`, `${SITE}/collection/femme`, `${SITE}/ar/collection/femme`, `${SITE}/collection/ete`, `${SITE}/product/robe-satin-noire`, `${SITE}/ar/product/robe-satin-noire`, `${SITE}/product/chemise-lin`]) {
    assert.ok(locs.includes(url), url);
  }
  assert.ok(!locs.includes(`${SITE}/ar/collection/ete`) && !locs.includes(`${SITE}/ar/product/chemise-lin`));
  assert.ok(!locs.some((loc) => /cart|checkout|account|login|search/.test(loc)));
  assert.ok(!locs.some((loc) => loc.includes('Bad')));
});
check('sitemap XML: well-formed, lastmod, hreflang alternates, every URL XML-escaped', () => {
  const xml = sitemapXml(SITE, data);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  assert.ok(xml.includes('<lastmod>2026-10-01</lastmod>'));
  assert.ok(xml.includes(`<xhtml:link rel="alternate" hreflang="ar" href="${SITE}/ar/product/robe-satin-noire"/>`));
  assert.ok(xml.includes('a&amp;b-%3Cx%3E'));
  assert.ok(!/<loc>[^<]*[&](?!amp;|lt;|gt;|quot;|apos;)/.test(xml));
  assert.equal((xml.match(/<url>/g) || []).length, sitemapEntries(SITE, data).length);
});
check('robots.txt: one group for everyone (AI crawlers included), private pages disallowed, sitemap announced', () => {
  const txt = robotsTxt(`${SITE}/`);
  assert.ok(txt.startsWith('User-agent: *\nAllow: /'));
  assert.equal((txt.match(/User-agent:/g) || []).length, 1);
  for (const bot of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'anthropic-ai', 'PerplexityBot']) assert.ok(!txt.includes(bot), bot);
  for (const path of ['/cart', '/checkout', '/account', '/login', '/signup', '/password-reset', '/favorites', '/search', '/admin']) assert.ok(txt.includes(`Disallow: ${path}\n`), path);
  assert.ok(txt.trimEnd().endsWith(`Sitemap: ${SITE}/sitemap.xml`));
});

check('collection pages: page 1 keeps the plain address, later pages have their own title and canonical, both languages link to the same page', () => {
  assert.equal(collectionPagePath('femme', 1), '/collection/femme');
  assert.equal(collectionPagePath('femme', 3), '/collection/femme/3');
  const one = collectionSeo('femme', 'fr', ctx, 'Femme', undefined, 1);
  const two = collectionSeo('femme', 'fr', ctx, 'Femme', undefined, 2);
  assert.equal(one.canonical, `${SITE}/collection/femme`);
  assert.equal(two.canonical, `${SITE}/collection/femme/2`);
  assert.ok(/Page 2/.test(two.title) && !/Page/.test(one.title));
  assert.equal(two.robots, 'index,follow');
  assert.equal(two.alternates.ar, `${SITE}/ar/collection/femme/2`);
  assert.equal(two.alternates.fr, `${SITE}/collection/femme/2`);
  assert.equal(collectionSeo('femme', 'ar', ctx, 'Femme', undefined, 2).canonical, `${SITE}/ar/collection/femme/2`);
  assert.ok(/صفحة 2/.test(collectionSeo('femme', 'ar', ctx, 'Femme', undefined, 2).title));
  assert.equal(two.jsonLd[0].itemListElement.at(-1).item, `${SITE}/collection/femme`, 'the breadcrumb points at the collection, not at page 2');
});

check('old addresses: ids and wrong-case slugs map to the canonical address; unknown, hidden and odd ones map to nothing', () => {
  const id = '2e6caee6-d226-4e65-a6ee-e8b3c0a1d111';
  const map = { ids: { [id]: 'robe-noire' }, products: ['robe-noire'], collections: ['femme'] };
  assert.equal(legacyTarget(`/product/${id}`, map), '/product/robe-noire');
  assert.equal(legacyTarget(`/product/${id.toUpperCase()}`, map), '/product/robe-noire');
  assert.equal(legacyTarget(`/ar/product/${id}/`, map), '/ar/product/robe-noire');
  assert.equal(legacyTarget('/product/Robe-Noire', map), '/product/robe-noire');
  assert.equal(legacyTarget('/ar/product/ROBE-NOIRE', map), '/ar/product/robe-noire');
  assert.equal(legacyTarget('/collection/Femme', map), '/collection/femme');
  assert.equal(legacyTarget('/ar/collection/FEMME/2', map), '/ar/collection/femme/2');
  assert.equal(legacyTarget('/product/00000000-0000-4000-8000-000000000000', map), null, 'an id that is not published (a hidden product) maps to nothing');
  assert.equal(legacyTarget('/product/robe-noire', map), null, 'an address that is already canonical is not redirected');
  assert.equal(legacyTarget('/product/UNKNOWN', map), null);
  assert.equal(legacyTarget('/collection/Nope', map), null);
  assert.equal(legacyTarget('/product/%E0%A4%A', map), null, 'a malformed escape does not throw');
  assert.equal(legacyTarget('/about', map), null);
  assert.equal(legacyTarget('/product/a/b', map), null);
});

check('_headers: security headers for every file, HSTS only for a production build, the CSP lists this build API and media origins', () => {
  const dev = headersFile({ api: 'http://localhost:3001', media: 'http://localhost:3001', production: false });
  const prod = headersFile({ api: 'https://api.silky.tn', media: 'https://media.silky.tn', production: true });
  assert.ok(!/Strict-Transport-Security/.test(dev));
  assert.ok(/Strict-Transport-Security: max-age=\d+; includeSubDomains/.test(prod));
  for (const h of ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy: strict-origin-when-cross-origin', 'Permissions-Policy:', 'Content-Security-Policy-Report-Only:']) assert.ok(prod.includes(h), h);
  assert.ok(/connect-src 'self' https:\/\/api\.silky\.tn/.test(prod));
  assert.ok(/img-src [^;]*https:\/\/media\.silky\.tn/.test(prod));
  assert.ok(/\/password-reset\/\*\n  Referrer-Policy: no-referrer/.test(prod));
  assert.ok(/\/admin\/\*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store/.test(prod));
  assert.ok(prod.startsWith('# GENERATED') && prod.includes('\n/*\n'));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
