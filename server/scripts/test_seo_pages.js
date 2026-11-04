/**
 * HTTP tests of the server-written page head (server/seo/pageHandler.js) with the real router, a fixture build
 * folder and fake data loaders: status codes, redirects, head tags, robots.txt, sitemap.xml, the rollback switch.
 * No database, no .env, no network beyond 127.0.0.1.
 *
 * Usage: node server/scripts/test_seo_pages.js
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createSeoRouter } from '../seo/pageHandler.js';
import { AI_TRAINING_BOTS, buildRobotsTxt } from '../seo/robots.js';

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

const SITE = 'https://shop.example';
const ACTIVE = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const HOSTILE = '9a8b7c6d-1111-4222-8333-444455556666';
const MARKED = '5c5c5c5c-1111-4222-8333-444455556666';
const HIDDEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HIDDEN_NAME = 'Modèle Secret Prototype';
const TRANSLATED = 'bbbbbbbb-1111-4222-8333-444455556666';
const HALF = 'cccccccc-1111-4222-8333-444455556666';
const SLUGGED = 'dddddddd-1111-4222-8333-444455556666';
const SLUG = 'robe-lin-bleu';

const TEMPLATE =
  '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8" /><!--seo-head--><title>Silky</title><!--/seo-head--></head>' +
  '<body><div id="root"></div><script type="module" src="/assets/app-abc123.js"></script></body></html>';

const products = {
  [ACTIVE]: { id: ACTIVE, name: 'Pyjama Doux', description: 'Pyjama en coton doux.', price: 45, discount: 5, category: 'femme', mainImage: '/uploads/a.jpg', thumbnails: ['/uploads/a.jpg'], stock: { default: 3 }, variants: [{ stockQuantity: 3 }], isHidden: false, is_active: true },
  [HOSTILE]: { id: HOSTILE, name: 'Robe "Été" </script><script>alert(1)</script> $& $1', description: 'Texte <b>gras</b> & plus', price: 30, discount: 0, category: 'femme', mainImage: 'data:image/png;base64,AAAA', thumbnails: [], stock: { default: 1 }, variants: [{ stockQuantity: 1 }], isHidden: false, is_active: true },
};
products[MARKED] = { ...products[ACTIVE], id: MARKED, name: 'Photo Redimensionnée', mainImage: '/uploads/1786391497273-243dfd2a-r.jpg', thumbnails: ['/uploads/1786391497273-243dfd2a-r.jpg'] };
products[TRANSLATED] = { ...products[ACTIVE], id: TRANSLATED, name: 'Robe Satin', description: 'Robe en satin.', nameAr: 'فستان ساتان', descriptionAr: 'فستان من الساتان <b>&</b> الحرير.' };
products[HALF] = { ...products[ACTIVE], id: HALF, name: 'Haut Lin', description: 'Haut en lin.', nameAr: 'قميص كتان', descriptionAr: null };
products[SLUGGED] = { ...products[ACTIVE], id: SLUGGED, slug: SLUG, name: 'Robe Lin Bleu', description: 'Robe en lin bleu.' };
const loaderCalls = [];
const loaders = {
  async getProduct(id) {
    loaderCalls.push(['product', id]);
    return products[id] || null; // the hidden product is unpublished: the real loader answers null for it
  },
  async getProductBySlug(slug) {
    loaderCalls.push(['slug', slug]);
    return Object.values(products).find((p) => p.slug === slug) || null;
  },
  async getDeliveryFee() {
    return 9; // what customers are charged in this fixture (the shared default is 8)
  },
  async getRating(id) {
    return id === ACTIVE ? { average: 4.5, count: 2 } : { average: 0, count: 0 };
  },
  async getProductSummaries({ categorySlug = null } = {}) {
    const all = [
      { id: ACTIVE, name: 'Pyjama Doux', nameAr: null, price: 45, discount: 5, category: 'femme' },
      { id: TRANSLATED, name: 'Robe Satin', nameAr: 'فستان ساتان', price: 60, discount: 0, category: 'femme' },
      { id: SLUGGED, slug: SLUG, name: 'Robe Lin Bleu', nameAr: null, price: 70, discount: 0, category: 'femme' },
      { id: HOSTILE, name: 'Robe "Été" </script><script>alert(1)</script> $& $1', nameAr: null, price: 30, discount: 0, category: 'femme' },
      { id: '11111111-aaaa-4bbb-8ccc-222222222222', name: 'Ensemble Enfant', nameAr: null, price: 25, discount: 0, category: 'enfant' },
    ];
    return categorySlug ? all.filter((item) => item.category === categorySlug) : all;
  },
  async getCategory(slug) {
    loaderCalls.push(['category', slug]);
    return slug === 'femme' ? { slug: 'femme', name: 'Femme' } : null;
  },
  async listSitemapData() {
    return { products: [{ id: SLUGGED, slug: SLUG, updatedAt: '2026-10-04T10:00:00Z' }, { id: ACTIVE, updatedAt: '2026-10-01T10:00:00Z' }, { id: TRANSLATED, updatedAt: '2026-10-02T10:00:00Z', nameAr: 'فستان ساتان', descriptionAr: 'وصف' }, { id: HALF, updatedAt: '2026-10-03T10:00:00Z', nameAr: 'قميص كتان', descriptionAr: null }], categories: [{ slug: 'femme' }] };
  },
};

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-seo-dist-'));
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-seo-uploads-'));
fs.mkdirSync(path.join(dist, 'assets'));
fs.writeFileSync(path.join(dist, 'index.html'), TEMPLATE);
fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
fs.writeFileSync(path.join(dist, 'favicon.ico'), 'ico');
fs.writeFileSync(path.join(uploads, 'photo.jpg'), 'jpg');

const silentLog = { error() {} };
function makeApp(options) {
  const app = express();
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  app.use('/uploads', express.static(uploads));
  app.use(createSeoRouter({ siteUrl: SITE, htmlEnabled: true, distDir: dist, serveFrontend: true, loaders, log: silentLog, ...options }));
  return app;
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (base, p, init) => fetch(`${base}${p}`, { redirect: 'manual', ...init });
const count = (html, pattern) => (html.match(pattern) || []).length;
const rootOf = (page) => (page.match(/<div id="root">([\s\S]*?)<\/div><script/) || [])[1] || '';

const { server, base } = await listen(makeApp());
try {
  console.log('--- Fixed pages ---');
  let res = await get(base, '/about');
  let html = await res.text();
  assert(res.status === 200 && html.includes('<title data-seo>À propos | Silky</title>'), '/about: 200 with its title');
  assert(count(html, /<title\b/g) === 1 && count(html, /<link rel="canonical"/g) === 1 && html.includes(`href="${SITE}/about"`), '/about: one title, one absolute canonical');
  assert(html.includes('<div id="root">') && html.includes('<h1>À propos</h1>') && html.includes('/assets/app-abc123.js') && !html.includes('<!--seo-head-->'), '/about: the app shell is intact, the page text is inside the root, markers are gone');
  assert(!res.headers.get('set-cookie') && res.headers.get('cache-control') === 'no-cache' && !res.headers.get('x-robots-tag'), '/about: no cookie, no-cache, no X-Robots-Tag');
  res = await get(base, '/');
  html = await res.text();
  assert(res.status === 200 && html.includes('Boutique de mode en ligne en Tunisie') && html.includes(`href="${SITE}/"`), 'home: 200 with the full title and canonical "/"');
  const homeLd = [...html.matchAll(/<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert(homeLd.length === 1 && homeLd[0]['@type'] === 'Organization' && homeLd[0].telephone === '+216 25 274 800', 'home: Organization structured data');
  res = await get(base, '/about');
  assert(!(await res.text()).includes('"Organization"'), 'only the home page carries the Organization data');

  console.log('\n--- Products ---');
  loaderCalls.length = 0;
  res = await get(base, `/product/${ACTIVE}`);
  html = await res.text();
  assert(res.status === 200 && html.includes('<title data-seo>Pyjama Doux | Silky</title>') && html.includes('property="og:type" content="product"'), 'active product: 200, title, og:type product');
  assert(html.includes(`href="${SITE}/product/${ACTIVE}"`) && html.includes(`content="${SITE}/uploads/a.jpg"`), 'active product: absolute canonical and own image');
  const ld = [...html.matchAll(/<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert(ld.length === 2 && ld[0]['@type'] === 'Product' && ld[0].offers.price === '40.000' && ld[0].offers.priceCurrency === 'TND' && ld[0].offers.availability.endsWith('InStock'), 'active product: JSON-LD with price in TND and availability');
  assert(ld[0].aggregateRating.reviewCount === 2 && ld[1]['@type'] === 'BreadcrumbList' && ld[1].itemListElement.length === 3, 'active product: rating and 3-level breadcrumb');
  assert(rootOf(html).includes('<h1>Pyjama Doux</h1>') && rootOf(html).includes('Pyjama en coton doux.') && rootOf(html).includes('40,000 TND'), 'active product: name, price in TND and description are in the raw HTML');
  res = await get(base, `/product/${HOSTILE}`);
  html = await res.text();
  assert(res.status === 200 && count(html, /<script\b/g) === 3 && !html.includes('alert(1)</script>'),'hostile name: cannot add or close a script element');
  assert(html.includes('Robe &quot;Été&quot; &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; $1 | Silky'), 'hostile name: escaped, "$&" and "$1" kept literally');
  assert(html.includes(`content="${SITE}/pictures/logo.png"`) && !html.includes('data:image'), 'data: image never written (logo used)');

  res = await get(base, `/product/${MARKED}`);
  html = await res.text();
  assert(html.includes(`property="og:image" content="${SITE}/uploads/1786391497273-243dfd2a-r.share.webp"`), 'photo with copies: og:image is the 1200 px copy, not the original');

  console.log('\n--- Not found and hidden ---');
  for (const [p, label] of [[`/product/${HIDDEN}`, 'hidden product'], ['/product/not-a-uuid', 'unknown slug'], ['/product/Mal_Form%C3%A9', 'malformed key'], ['/product', 'no id'], ['/product/11111111-2222-4333-8444-555555555555', 'unknown id']]) {
    res = await get(base, p);
    html = await res.text();
    assert(res.status === 404 && html.includes('Produit introuvable | Silky') && res.headers.get('x-robots-tag') === 'noindex' && html.includes('name="robots" content="noindex"'), `${label}: 404, "Produit introuvable", noindex meta and header`);
    assert(!html.includes(HIDDEN_NAME) && !html.includes('canonical') && !html.includes('application/ld+json') && html.includes('<div id="root">'), `${label}: no product data, no canonical, app shell kept`);
  }
  loaderCalls.length = 0;
  await get(base, '/product/Mal_Form%C3%A9');
  assert(loaderCalls.length === 0, 'a malformed product key (neither slug nor id) never reaches the data loaders');
  res = await get(base, '/nimportequoi');
  html = await res.text();
  assert(res.status === 404 && html.includes('Page introuvable | Silky') && res.headers.get('x-robots-tag') === 'noindex', 'unknown path: 404, "Page introuvable", noindex');
  res = await get(base, '/ar/product/x');
  assert(res.status === 404, '/ar/... is 404 until Arabic exists');

  console.log('\n--- Collections ---');
  res = await get(base, '/collection/femme');
  html = await res.text();
  const crumbs = JSON.parse(html.match(/<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/)[1]);
  assert(res.status === 200 && html.includes('Collection Femme | Silky') && html.includes(`href="${SITE}/collection/femme"`) && crumbs.itemListElement.length === 2, 'known collection: 200, title, canonical, breadcrumb');
  res = await get(base, '/collection/enfant');
  html = await res.text();
  assert(res.status === 404 && html.includes('noindex'), 'collection without a category row: 404 noindex');
  res = await get(base, '/collection/zzz');
  assert(res.status === 404 && res.headers.get('x-robots-tag') === 'noindex', 'unknown collection: 404 noindex');
  res = await get(base, '/collection/FEMME');
  assert(res.status === 404, 'collection slug is case-sensitive like the database');

  console.log('\n--- Private pages ---');
  for (const [p, robots] of [['/cart', 'noindex'], ['/checkout', 'noindex'], ['/login', 'noindex'], ['/search?q=a', 'noindex'], ['/admin', 'noindex, nofollow'], ['/admin/login', 'noindex, nofollow']]) {
    res = await get(base, p);
    html = await res.text();
    assert(res.status === 200 && res.headers.get('x-robots-tag') === robots && html.includes(`name="robots" content="${robots}"`) && !html.includes('canonical') && !html.includes('og:title'), `${p}: 200, ${robots}, no canonical or share tags`);
  }

  res = await get(base, '/faq');
  html = await res.text();
  assert(res.status === 200 && html.includes('Questions fréquentes | Silky') && html.includes(`href="${SITE}/faq"`) && !res.headers.get('x-robots-tag'), '/faq: 200, indexable, with canonical');
  assert(rootOf(html).includes('<h2>Combien coûte la livraison ?</h2>') && rootOf(html).includes('Les frais de livraison sont de 8 TND.') && rootOf(html).includes('<a href="/contact">'), '/faq: the questions and answers are in the raw HTML, inside the root');
  const faqLd = (html.match(/<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/g) || []).map((x) => JSON.parse(x.replace(/<script[^>]*>|<\/script>/g, ''))).find((j) => j['@type'] === 'FAQPage');
  assert(faqLd && faqLd.mainEntity.length >= 5 && faqLd.mainEntity.every((q) => q['@type'] === 'Question' && q.name && q.acceptedAnswer.text) && faqLd.mainEntity.some((q) => q.acceptedAnswer.text.includes('Les frais de livraison sont de 8 TND.')) && !faqLd.mainEntity.some((q) => /<|\u2066/.test(q.acceptedAnswer.text)), '/faq: FAQPage structured data with the same questions and plain-text answers');
  res = await get(base, '/ar/faq');
  html = await res.text();
  const arFaqLd = (html.match(/<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/g) || []).map((x) => JSON.parse(x.replace(/<script[^>]*>|<\/script>/g, ''))).find((j) => j['@type'] === 'FAQPage');
  assert(arFaqLd && /[\u0600-\u06FF]/.test(arFaqLd.mainEntity[0].name) && !arFaqLd.mainEntity.some((q) => /[\u2066\u2069]/.test(q.acceptedAnswer.text)), '/ar/faq: FAQPage structured data in Arabic, without the invisible phone-number marks');
  res = await get(base, '/livraison-retours');
  html = await res.text();
  assert(rootOf(html).includes('Les frais de livraison sont de 8 TND.') && rootOf(html).includes('remboursement dans un délai de 2 jours'), '/livraison-retours: the delivery and refund text is in the raw HTML');
  for (const privatePath of ['/cart', '/checkout', '/login', '/admin']) {
    res = await get(base, privatePath);
    assert(rootOf(await res.text()) === '', `${privatePath}: root stays empty (no text written for private pages)`);
  }
  for (const gone of ['/conditions-generales-de-vente', '/politique-de-confidentialite']) {
    res = await get(base, gone);
    assert(res.status === 404 && res.headers.get('x-robots-tag') === 'noindex', `${gone}: removed page answers 404 noindex`);
  }

  console.log('\n--- Arabic pages ---');
  res = await get(base, '/ar');
  html = await res.text();
  assert(res.status === 200 && html.includes('<html lang="ar" dir="rtl">') && html.includes('Silky – متجر أزياء إلكتروني في تونس') && html.includes(`<link rel="canonical" href="${SITE}/ar" data-seo>`), '/ar: Arabic home, lang="ar" dir="rtl", Arabic title, canonical /ar');
  assert(['fr', 'ar', 'x-default'].every((l) => html.includes(`hreflang="${l}"`)) && html.includes('property="og:locale" content="ar_AR"'), '/ar: hreflang fr, ar and x-default, Arabic og:locale');
  assert(html.includes('"Organization"') && html.includes('silky26tn@gmail.com'), '/ar: the Organization data is also written on the Arabic home');
  assert(rootOf(html).includes('<h1>Silky</h1>') && rootOf(html).includes('تصاميم أصلية') && rootOf(html).includes(`href="/ar/product/${TRANSLATED}">فستان ساتان</a> - 60,000 د.ت`) && rootOf(html).includes('href="/ar/collection/femme"'), '/ar: plain-text home body in Arabic (tagline, collection links, Arabic product names, د.ت prices, links under /ar)');
  res = await get(base, '/ar/faq');
  html = await res.text();
  assert(res.status === 200 && rootOf(html).includes('<h1>الأسئلة الشائعة</h1>') && rootOf(html).includes('<a href="/ar/contact">') && html.includes(`<link rel="canonical" href="${SITE}/ar/faq" data-seo>`), '/ar/faq: Arabic questions in the raw HTML, links under /ar, canonical /ar/faq');
  res = await get(base, '/faq');
  html = await res.text();
  assert(html.includes('<html lang="fr">') && html.includes(`hreflang="ar" href="${SITE}/ar/faq"`), '/faq: still French and now points at its Arabic twin');
  res = await get(base, '/ar/cart');
  html = await res.text();
  assert(res.status === 200 && html.includes('السلة | Silky') && res.headers.get('x-robots-tag') === 'noindex' && rootOf(html) === '', '/ar/cart: Arabic title, noindex, no text written');
  res = await get(base, '/ar/admin');
  assert(res.status === 404, '/ar/admin: the admin exists in French only');
  res = await get(base, '/ar/nimportequoi');
  html = await res.text();
  assert(res.status === 404 && html.includes('الصفحة غير موجودة | Silky') && html.includes('<html lang="ar" dir="rtl">'), '/ar/unknown: 404 with the Arabic not-found title');
  res = await get(base, '/ar/');
  assert(res.status === 301 && res.headers.get('location') === '/ar', '/ar/ redirects to /ar');
  res = await get(base, '/ar/About/');
  assert(res.status === 301 && res.headers.get('location') === '/ar/about', '/ar/About/ redirects to /ar/about');
  res = await get(base, `/ar/product/${ACTIVE.toUpperCase()}`);
  assert(res.status === 301 && res.headers.get('location') === `/ar/product/${ACTIVE}`, 'uppercase product id under /ar: 301 to the lowercase /ar URL');
  res = await get(base, `/ar/product/${ACTIVE}`);
  html = await res.text();
  assert(res.status === 200 && res.headers.get('x-robots-tag') === 'noindex' && !html.includes('rel="canonical"') && !html.includes('application/ld+json') && !html.includes('hreflang'), '/ar/product: works for shoppers but is noindex, with no canonical, product data or hreflang while products have no Arabic text');
  res = await get(base, `/ar/product/${HIDDEN}`);
  html = await res.text();
  assert(res.status === 404 && html.includes('المنتج غير موجود | Silky') && !html.includes(HIDDEN_NAME), '/ar/product (hidden): 404, Arabic title, no product name');
  res = await get(base, `/ar/product/${TRANSLATED}`);
  html = await res.text();
  assert(res.status === 200 && html.includes('فستان ساتان | Silky</title>') && html.includes(`<link rel="canonical" href="${SITE}/ar/product/${TRANSLATED}" data-seo>`) && !(res.headers.get('x-robots-tag') || '').includes('noindex') && !html.includes('content="noindex'), '/ar/product (translated): Arabic title, its own /ar canonical, indexable');
  assert(html.includes(`hreflang="fr" href="${SITE}/product/${TRANSLATED}"`) && html.includes(`hreflang="ar" href="${SITE}/ar/product/${TRANSLATED}"`) && html.includes(`hreflang="x-default" href="${SITE}/product/${TRANSLATED}"`), '/ar/product (translated): hreflang links to the French twin');
  const arJson = html.match(/<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/g).map((s) => JSON.parse(s.replace(/<script[^>]*>|<\/script>/g, '')));
  const arProduct = arJson.find((j) => j['@type'] === 'Product');
  assert(arProduct && arProduct.offers.shippingDetails.shippingRate.value === 9 && arProduct.offers.shippingDetails.shippingRate.currency === 'TND', 'product data: the shipping rate follows the charged fee given by the loader (9 here)');
  assert(arProduct && arProduct.name === 'فستان ساتان' && arProduct.url === `${SITE}/ar/product/${TRANSLATED}` && arProduct.offers.priceCurrency === 'TND', '/ar/product (translated): Product JSON-LD in Arabic, pointing at the /ar URL, price in TND');
  assert(html.includes('<h1>فستان ساتان</h1>') && html.includes('&lt;b&gt;&amp;&lt;/b&gt;') && !html.includes('Robe Satin'), '/ar/product (translated): Arabic body text, escaped, no French name');
  res = await get(base, `/product/${TRANSLATED}`);
  html = await res.text();
  assert(html.includes('Robe Satin | Silky</title>') && html.includes(`hreflang="ar" href="${SITE}/ar/product/${TRANSLATED}"`), '/product (translated): French page unchanged and linked to its Arabic twin');
  res = await get(base, `/product/${ACTIVE}`);
  assert(!(await res.text()).includes('hreflang'), '/product (not translated): no hreflang');
  res = await get(base, `/ar/product/${HALF}`);
  html = await res.text();
  assert(res.status === 200 && res.headers.get('x-robots-tag') === 'noindex' && !html.includes('rel="canonical"') && !html.includes('hreflang'), '/ar/product (name only, no Arabic description): noindex, no canonical, no hreflang');
  res = await get(base, '/collection/femme');
  html = await res.text();
  assert(rootOf(html).includes('<h1>Collection Femme</h1>') && rootOf(html).includes(`href="/product/${ACTIVE}">Pyjama Doux</a> - 40,000 TND`) && !rootOf(html).includes('Ensemble Enfant') && !html.includes('</script><script>alert(1)'), '/collection/femme: its products (name, discounted price, link) are in the raw HTML, other collections are not, hostile names are escaped');
  res = await get(base, '/ar/collection/femme');
  html = await res.text();
  assert(rootOf(html).includes('<h1>مجموعة النساء</h1>') && rootOf(html).includes(`href="/ar/product/${TRANSLATED}">فستان ساتان</a>`) && rootOf(html).includes('>Pyjama Doux</a>'), '/ar/collection/femme: Arabic body, Arabic name where it exists, French name otherwise');
  res = await get(base, '/ar/collection/femme');
  html = await res.text();
  assert(res.status === 200 && html.includes('مجموعة النساء | Silky') && html.includes(`<link rel="canonical" href="${SITE}/ar/collection/femme" data-seo>`) && html.includes('hreflang="ar"'), '/ar/collection/femme: Arabic title, canonical and hreflang');
  res = await get(base, '/ar/collection/zzz');
  assert(res.status === 404 && res.headers.get('x-robots-tag') === 'noindex', '/ar/collection/zzz: 404 noindex');

  console.log('\n--- Redirects ---');
  res = await get(base, `/product/${ACTIVE.toUpperCase()}`);
  assert(res.status === 301 && res.headers.get('location') === `/product/${ACTIVE}`, 'uppercase product id: 301 to lowercase');
  res = await get(base, '/About/?utm=1');
  assert(res.status === 301 && res.headers.get('location') === '/about?utm=1', 'case and trailing slash: 301, query string kept');
  res = await get(base, '/collection/femme/');
  assert(res.status === 301 && res.headers.get('location') === '/collection/femme', 'collection trailing slash: 301');
  res = await get(base, '/cart/');
  assert(res.status === 200, 'private routes are not redirected');
  res = await get(base, `/product/${ACTIVE}?color=red`);
  assert(res.status === 200, 'a query string alone does not redirect');
  res = await get(base, '/index.html?utm=1');
  assert(res.status === 301 && res.headers.get('location') === '/?utm=1', '/index.html: 301 to the home page, query string kept');
  console.log('\n--- Product addresses (slug) ---');
  res = await get(base, `/product/${SLUG}`);
  html = await res.text();
  assert(res.status === 200 && html.includes(`<link rel="canonical" href="${SITE}/product/${SLUG}" data-seo>`) && html.includes('Robe Lin Bleu | Silky</title>'), 'slug URL: 200 with the slug as canonical');
  assert(html.includes(`"url":"${SITE}/product/${SLUG}"`) && html.includes(`"item":"${SITE}/product/${SLUG}"`), 'slug URL: Product and Breadcrumb JSON-LD use the slug address');
  res = await get(base, `/product/${SLUGGED}`);
  assert(res.status === 301 && res.headers.get('location') === `/product/${SLUG}`, 'old id URL: one 301 to the slug address');
  res = await get(base, `/product/${SLUGGED.toUpperCase()}?utm=1`);
  assert(res.status === 301 && res.headers.get('location') === `/product/${SLUG}?utm=1`, 'uppercase id URL: one 301 (no chain) to the slug, query string kept');
  res = await get(base, `/Product/Robe-Lin-Bleu/`);
  assert(res.status === 301 && res.headers.get('location') === `/product/${SLUG}`, 'uppercase slug and trailing slash: 301 to the canonical slug');
  res = await get(base, `/ar/product/${SLUGGED}`);
  assert(res.status === 301 && res.headers.get('location') === `/ar/product/${SLUG}`, '/ar id URL: 301 to the /ar slug address');
  res = await get(base, '/product/robe-inconnue');
  assert(res.status === 404 && /noindex/.test(`${res.headers.get('x-robots-tag')}`), 'unknown slug: 404, noindex');
  res = await get(base, '/product/Pas_Un_Slug');
  assert(res.status === 404, 'a text that is neither slug nor id: 404');
  res = await get(base, '/collection/femme');
  html = await res.text();
  assert(html.includes(`href="/product/${SLUG}">Robe Lin Bleu</a>`), 'collection page lists the product with its slug address');
  res = await get(base, '/sitemap.xml');
  html = await res.text();
  assert(html.includes(`<loc>${SITE}/product/${SLUG}</loc>`) && !html.includes(`/product/${SLUGGED}`), 'sitemap lists the slug address, not the id');

  res = await get(base, '//evil.example/about');
  assert(res.status !== 301 || !String(res.headers.get('location')).startsWith('//'), 'no open redirect through a double slash');

  console.log('\n--- Files, API and uploads ---');
  res = await get(base, '/assets/app-abc123.js');
  assert(res.status === 200 && /immutable/.test(res.headers.get('cache-control') || ''), 'hashed asset: served with immutable cache');
  res = await get(base, '/favicon.ico');
  assert(res.status === 200 && !/immutable/.test(res.headers.get('cache-control') || ''), 'other static file served without immutable cache');
  res = await get(base, '/missing.png');
  assert(res.status === 404 && !(await res.text()).includes('<div id="root">'), 'missing file: plain 404, not the app shell');
  res = await get(base, '/api/does-not-exist');
  assert(res.status === 404 && (res.headers.get('content-type') || '').includes('json'), '/api keeps its JSON answers');
  res = await get(base, '/uploads/photo.jpg');
  assert(res.status === 200 && (await res.text()) === 'jpg', '/uploads files are still served');
  res = await get(base, '/uploads/nope.jpg');
  assert(res.status === 404 && !(await res.text()).includes('<div id="root">'), 'missing upload: no app shell');
  res = await get(base, '/about', { method: 'HEAD' });
  assert(res.status === 200 && res.headers.get('content-type').includes('text/html'), 'HEAD works');
  res = await get(base, '/about', { method: 'POST' });
  assert(res.status === 404, 'POST is not answered by the page handler');

  console.log('\n--- robots.txt and sitemap.xml ---');
  res = await get(base, '/robots.txt');
  const robots = await res.text();
  assert(res.status === 200 && robots === buildRobotsTxt(SITE), 'robots.txt is served as built by buildRobotsTxt');
  assert(robots.includes('User-agent: *'+'\n'+'Allow: /') && robots.includes(`Sitemap: ${SITE}/sitemap.xml`), 'robots.txt allows everyone else and names the sitemap');
  const disallowed = robots.split('\n\n')[0];
  assert(AI_TRAINING_BOTS.every((bot) => disallowed.includes(`User-agent: ${bot}`)) && disallowed.trim().endsWith('Disallow: /'), 'AI training crawlers are disallowed');
  assert((robots.match(/Disallow/g) || []).length === 1, 'nothing else is disallowed (private pages carry noindex instead)');
  assert(['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Googlebot', 'Bingbot', 'facebookexternalhit', 'Meta-ExternalFetcher', 'Twitterbot', 'WhatsApp'].every((bot) => !robots.includes(bot)), 'search, assistant and link-preview crawlers are not named, so they stay allowed');
  res = await get(base, '/sitemap.xml');
  const xml = await res.text();
  assert(res.status === 200 && (res.headers.get('content-type') || '').includes('application/xml'), 'sitemap.xml: 200 application/xml');
  assert(xml.includes(`<loc>${SITE}/ar/product/${TRANSLATED}</loc>`) && !xml.includes(`/ar/product/${HALF}`) && !xml.includes(`/ar/product/${ACTIVE}`), 'sitemap lists the Arabic twin of a fully translated product only');
  assert(xml.includes(`<loc>${SITE}/product/${ACTIVE}</loc><lastmod>2026-10-01</lastmod>`) && xml.includes(`<loc>${SITE}/collection/femme</loc>`) && !xml.includes(HIDDEN), 'sitemap lists the active product and the collection, not the hidden one');
  assert(!xml.includes('/cart') && !xml.includes('/admin'), 'sitemap lists no private page');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('\n--- Rollback switch and failure modes ---');
{
  const off = await listen(makeApp({ htmlEnabled: false }));
  try {
    for (const p of ['/about', `/product/${ACTIVE}`, '/nimportequoi', '/cart']) {
      const res = await get(off.base, p);
      assert(res.status === 200 && (await res.text()) === TEMPLATE, `SEO_HTML off: ${p} sends the unchanged template`);
    }
    const robotsRes = await get(off.base, '/robots.txt');
    assert(robotsRes.status === 200, 'SEO_HTML off: robots.txt still served when SITE_URL is set');
  } finally {
    await new Promise((resolve) => off.server.close(resolve));
  }

  const noSite = await listen(makeApp({ siteUrl: '' }));
  try {
    const res = await get(noSite.base, '/about');
    assert(res.status === 200 && (await res.text()) === TEMPLATE, 'SEO_HTML on without SITE_URL behaves as off');
    assert((await get(noSite.base, '/robots.txt')).status === 404 && (await get(noSite.base, '/sitemap.xml')).status === 404, 'robots.txt and sitemap.xml are 404 without SITE_URL');
  } finally {
    await new Promise((resolve) => noSite.server.close(resolve));
  }

  const noMarkers = path.join(os.tmpdir(), `silky-seo-nomarkers-${process.pid}`);
  fs.mkdirSync(noMarkers);
  fs.writeFileSync(path.join(noMarkers, 'index.html'), '<html><head><title>Silky</title></head><body><div id="root"></div></body></html>');
  const plain = await listen(makeApp({ distDir: noMarkers }));
  try {
    const res = await get(plain.base, '/about');
    assert(res.status === 200 && (await res.text()).includes('<title>Silky</title>'), 'template without markers is sent unchanged');
  } finally {
    await new Promise((resolve) => plain.server.close(resolve));
    fs.rmSync(noMarkers, { recursive: true, force: true });
  }

  const feeBroken = await listen(makeApp({ loaders: { ...loaders, getDeliveryFee: async () => { throw new Error('db down'); } } }));
  try {
    const html = await (await get(feeBroken.base, `/product/${ACTIVE}`)).text();
    const product = JSON.parse(html.match(/<script type="application\/ld\+json" data-seo>(\{"@context":"https:\/\/schema.org","@type":"Product"[\s\S]*?)<\/script>/)[1]);
    assert(product.offers.shippingDetails.shippingRate.value === 8, 'a failing fee lookup only falls back to the stated 8 TND, the page is unaffected');
  } finally {
    await new Promise((resolve) => feeBroken.server.close(resolve));
  }

  const broken = await listen(makeApp({ loaders: { ...loaders, getProduct: async () => { throw new Error('db down'); } } }));
  try {
    const res = await get(broken.base, `/product/${ACTIVE}`);
    assert(res.status === 200 && (await res.text()) === TEMPLATE, 'a data failure falls back to the plain template (the shop keeps working)');
  } finally {
    await new Promise((resolve) => broken.server.close(resolve));
  }

  const missing = makeApp({ distDir: path.join(os.tmpdir(), 'silky-seo-does-not-exist') });
  const gone = await listen(missing);
  try {
    assert((await get(gone.base, '/about')).status === 404, 'missing build folder: nothing served, no crash');
  } finally {
    await new Promise((resolve) => gone.server.close(resolve));
  }

  const dev = await listen(makeApp({ serveFrontend: false }));
  try {
    assert((await get(dev.base, '/about')).status === 404, 'frontend serving off (default in development): pages are not answered');
  } finally {
    await new Promise((resolve) => dev.server.close(resolve));
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(uploads, { recursive: true, force: true });

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
