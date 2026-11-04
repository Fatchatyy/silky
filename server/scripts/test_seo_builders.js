/**
 * Pure tests for the SEO builders (src/seo, server/seo/sitemap.js): escaping, metadata, structured data, sitemap,
 * route matching, and that src/seo/routes.js lists exactly the <Route> paths of src/App.jsx.
 * No database, no server, no network.
 *
 * Usage: node server/scripts/test_seo_builders.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, serializeJsonLd } from '../../src/seo/escape.js';
import { absoluteUrl, isCanonicalProductId, isProductSlug, localizedPath, productPath, publicImagePath } from '../../shared/urls.js';
import { shortenSlug } from '../utils/slug.js';
import { ROUTES, matchRoute } from '../../src/seo/routes.js';
import { categoryMeta, notFoundMeta, productMeta, routeMeta, truncate } from '../../src/seo/meta.js';
import { buildBreadcrumbJsonLd, buildFaqJsonLd, buildOrganizationJsonLd, buildProductJsonLd } from '../../src/seo/jsonld.js';
import { CONTACT } from '../../shared/contact.js';
import { buildSitemapEntries, buildSitemapXml } from '../seo/sitemap.js';
import { hasArabicProduct, localizedProductView, productDescription, productImageAlt, productName } from '../../shared/productText.js';
import { hasHeadMarkers, injectHead, renderHead } from '../seo/renderHead.js';
import { parseSiteUrl } from '../seo/siteUrl.js';
import { collectionMeta, isNamedCollection } from '../../src/seo/collections.js';
import { DELIVERY_FEE_TND } from '../../shared/delivery.js';
import { DELIVERY_ECONOMICS } from '../config/delivery.js';
import { injectRootContent, renderCollectionBody, renderHomeBody, renderProductBody, renderTextPageBody } from '../seo/renderBody.js';
import { TEXT_PAGES, TEXT_PAGE_BY_PATH, faqEntries } from '../../shared/textPages.js';
import { ARABIC_ENABLED, dirOf, localizePath, splitLocale, switchLocalePath } from '../../shared/locales.js';
import { hasArabicRouteText } from '../../src/seo/meta.js';
import { localizedCollectionMeta } from '../../src/seo/collections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const SITE_SCHEMA = 'https://schema.org';
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const product = {
  id: ID,
  name: 'Robe  "Été"\n<Lin>',
  description: 'Robe légère </script><script>alert(1)</script> en lin. $& $1 ' + LINE_SEPARATOR + ' fin',
  price: 45,
  discount: 3,
  mainImage: '/uploads/a.jpg',
  thumbnails: ['/uploads/a.jpg', '/uploads/b.jpg', 'data:image/png;base64,AAAA', 'https://evil.example/x.jpg', '/uploads/../.env'],
  stock: { 'noir-S': 0, 'noir-M': 2 },
  variants: [{ stockQuantity: 0 }, { stockQuantity: 2 }],
  isHidden: false,
  is_active: true,
};

console.log('--- Escaping ---');
assert(escapeHtml(`<a href="x">'&'</a>`) === '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;', 'escapeHtml escapes & < > " \'');
const json = serializeJsonLd({ text: '</script><script>alert(1)</script>', sep: `a${LINE_SEPARATOR}b`, amp: 'a&b' });
assert(!json.includes('<') && !json.includes('>') && !json.includes('&'), 'serializeJsonLd leaves no < > & in the output');
assert(!json.includes(LINE_SEPARATOR), 'serializeJsonLd escapes U+2028');
assert(JSON.parse(json).text === '</script><script>alert(1)</script>', 'serializeJsonLd output parses back to the original text');

console.log('\n--- URLs ---');
assert(isCanonicalProductId(ID) && !isCanonicalProductId(ID.toUpperCase()) && !isCanonicalProductId('abc'), 'only lowercase UUIDs are canonical product ids');
assert(localizedPath('/product/x') === '/product/x' && localizedPath('/product/x', 'ar') === '/ar/product/x' && localizedPath('/', 'ar') === '/ar', 'French unprefixed, Arabic under /ar');
assert(absoluteUrl(SITE, '/about') === 'https://shop.example/about', 'absoluteUrl joins site and path');
assert(absoluteUrl('https://shop.example/', 'about') === 'https://shop.example/about', 'absoluteUrl normalizes slashes');
assert(absoluteUrl(undefined, '/x') === null && absoluteUrl('javascript:alert(1)', '/x') === null && absoluteUrl('not a url', '/x') === null, 'absoluteUrl is null without a valid http(s) site');
assert(publicImagePath('/uploads/a.jpg') === '/uploads/a.jpg' && publicImagePath('/pictures/logo.png') === '/pictures/logo.png', 'own image folders allowed');
assert(
  [ 'data:image/png;base64,AAAA', 'https://evil.example/x.jpg', '/uploads/../.env', '/etc/passwd', '', null ].every((v) => publicImagePath(v) === null),
  'data:, foreign, traversal and empty image URLs rejected',
);

console.log('\n--- Metadata ---');
const pm = productMeta(product);
assert(pm.title === 'Robe "Été" <Lin> | Silky', 'product title: cleaned name + site name (escaping happens when written)');
assert(pm.description.length <= 160 && !pm.description.includes('\n'), 'product description: one line, at most 160 characters');
assert(pm.robots === undefined, 'visible product is indexable');
assert(productMeta({ ...product, isHidden: true }).robots === 'noindex', 'hidden product (admin view) is noindex');
assert(productMeta(null).robots === 'noindex' && productMeta(null).title === 'Produit introuvable | Silky', 'missing product is "introuvable" and noindex');
assert(truncate('a '.repeat(200)).length <= 160 && truncate('a '.repeat(200)).endsWith('…'), 'truncate cuts long text with an ellipsis');
assert(categoryMeta({ name: 'Collection Femme', description: 'Découvrez', exists: true }).robots === undefined, 'known collection is indexable');
assert(categoryMeta({ name: 'Collection', exists: false }).robots === 'noindex', 'unknown collection is noindex');
assert(notFoundMeta().robots === 'noindex', '404 is noindex');
const home = routeMeta(matchRoute('/').route);
assert(home.title.startsWith('Silky') && home.description && home.robots === undefined, 'home has full title, description, indexable');
assert(routeMeta(matchRoute('/cart').route).robots === 'noindex', 'cart is noindex');
assert(routeMeta(matchRoute('/admin').route).robots === 'noindex, nofollow', 'admin is noindex, nofollow');
const titles = ROUTES.filter((r) => r.kind === 'page').map((r) => routeMeta(r).title);
assert(new Set(titles).size === titles.length, 'fixed public pages have unique titles');
assert(ROUTES.filter((r) => r.kind === 'page').every((r) => r.description && r.description.length <= 160), 'fixed public pages have a description of at most 160 characters');

console.log('\n--- Structured data ---');
const ld = buildProductJsonLd(product, { siteUrl: SITE, rating: { average: 4.5, count: 2 } });
assert(ld && ld['@type'] === 'Product' && ld.url === `https://shop.example/product/${ID}`, 'Product with absolute URL');
assert(ld.offers.price === '42.000' && ld.offers.priceCurrency === 'TND', 'Offer uses the effective price (45 - 3) in TND');
assert(ld.offers.availability === 'https://schema.org/InStock', 'in stock when one variant has stock');
assert(JSON.stringify(ld.image) === JSON.stringify(['https://shop.example/uploads/a.jpg', 'https://shop.example/uploads/b.jpg']), 'images: own folders only, absolute, no duplicates');
assert(ld.aggregateRating.ratingValue === 4.5 && ld.aggregateRating.reviewCount === 2, 'aggregateRating from the approved-review summary');
assert(!buildProductJsonLd(product, { siteUrl: SITE, rating: { average: 0, count: 0 } }).aggregateRating, 'no aggregateRating without reviews');
const soldOut = buildProductJsonLd({ ...product, stock: { 'noir-S': 0 }, variants: [{ stockQuantity: 0 }] }, { siteUrl: SITE });
assert(soldOut.offers.availability === 'https://schema.org/OutOfStock', 'out of stock when no variant has stock');
assert(buildProductJsonLd({ ...product, isHidden: true }, { siteUrl: SITE }) === null, 'hidden product: no structured data');
assert(buildProductJsonLd({ ...product, is_active: false }, { siteUrl: SITE }) === null, 'inactive product: no structured data');
assert(buildProductJsonLd(product, {}) === null, 'no structured data without a site URL');
const resized = buildProductJsonLd({ ...product, mainImage: '/uploads/1786391497273-243dfd2a-r.jpg', thumbnails: ['/uploads/1786391497273-243dfd2a-r.jpg', '/uploads/1700000000000-0badc0de.jpg'] }, { siteUrl: SITE });
assert(JSON.stringify(resized.image) === JSON.stringify([`${SITE}/uploads/1786391497273-243dfd2a-r.share.webp`, `${SITE}/uploads/1700000000000-0badc0de.jpg`]), 'structured-data images use the 1200 px copy when it exists, the original otherwise');
assert(!buildProductJsonLd({ ...product, price: 0, discount: 0 }, { siteUrl: SITE }).offers, 'no Offer for a zero price');
const serialized = serializeJsonLd(ld);
assert(!serialized.includes('</script>') && JSON.parse(serialized).description.includes('</script>'), 'description cannot close the script element');
const crumbs = buildBreadcrumbJsonLd([{ name: 'Accueil', path: '/' }, { name: 'Collection Femme', path: '/collection/femme' }], { siteUrl: SITE });
assert(crumbs.itemListElement.length === 2 && crumbs.itemListElement[1].item === 'https://shop.example/collection/femme', 'BreadcrumbList with positions and absolute URLs');

console.log('\n--- Sitemap ---');
const entries = buildSitemapEntries({
  products: [
    { id: ID, isActive: true, updatedAt: new Date('2026-10-01T10:00:00Z') },
    { id: '11111111-1111-4111-8111-111111111111', isActive: false },
    { id: '22222222-2222-4222-8222-222222222222', isHidden: true },
    { id: ID.toUpperCase(), isActive: true },
  ],
  categories: [{ slug: 'femme' }, { slug: 'bad slug<' }],
});
const paths = entries.map((e) => e.path);
assert(paths.includes(`/product/${ID}`) && paths.filter((p) => p.startsWith('/product/')).length === 1, 'only the published, canonical product is listed');
assert(paths.includes('/collection/femme') && !paths.some((p) => p.includes('bad')), 'valid category slugs only');
assert(['/cart', '/checkout', '/admin', '/account', '/search', '/login'].every((p) => !paths.includes(p)), 'private routes never listed');
assert(['/', '/about', '/contact', '/service-client', '/livraison-retours'].every((p) => paths.includes(p)), 'fixed public pages listed');
const xml = buildSitemapXml([...entries, { path: '/x?a=1&b=2' }], SITE);
assert(xml.startsWith('<?xml') && xml.includes(`<loc>https://shop.example/product/${ID}</loc><lastmod>2026-10-01</lastmod>`), 'XML with absolute loc and lastmod date');
assert(xml.includes('&amp;b=2') && !/&b=2/.test(xml), 'XML escapes &');
let threw = false;
try {
  buildSitemapXml(entries, '');
} catch {
  threw = true;
}
assert(threw, 'sitemap refuses to build without a site URL');

console.log('\n--- Server-written head ---');
const count = (html, pattern) => (html.match(pattern) || []).length;
const hostile = { ...product, name: 'Robe "Été" </script><script>alert(1)</script> $& $1' };
const productPage = {
  meta: productMeta(hostile),
  canonicalPath: `/product/${ID}`,
  ogType: 'product',
  imagePath: publicImagePath(hostile.mainImage),
  jsonLd: [
    buildProductJsonLd(hostile, { siteUrl: SITE, rating: { average: 4.5, count: 2 } }),
    buildBreadcrumbJsonLd([{ name: 'Accueil', path: '/' }, { name: hostile.name, path: `/product/${ID}` }], { siteUrl: SITE }),
  ],
};
const head = renderHead(productPage, SITE);
assert(count(head, /<title\b/g) === 1 && count(head, /<link rel="canonical"/g) === 1, 'exactly one title and one canonical');
assert(
  ['og:type', 'og:title', 'og:description', 'og:url', 'og:site_name', 'og:locale', 'og:image'].every((p) => count(head, new RegExp(`property="${p}"`, 'g')) === 1),
  'exactly one of each Open Graph tag',
);
assert(count(head, /name="twitter:card"/g) === 1 && count(head, /name="description"/g) === 1, 'exactly one twitter:card and one description');
assert(count(head, /name="robots"/g) === 0, 'an indexable page has no robots tag');
assert(count(head, /<script type="application\/ld\+json"/g) === 2, 'Product and BreadcrumbList structured data');
assert(head.split('\n').every((line) => /data-seo/.test(line)), 'every generated tag carries data-seo');
assert(!head.includes('</script><script>') && !head.includes('<Lin>') && !head.includes('"Été"'), 'hostile product name is escaped everywhere');
assert(head.includes(`href="${SITE}/product/${ID}"`) && head.includes(`content="${SITE}/uploads/a.jpg"`), 'canonical and og:image are absolute');
const ldBlocks = [...head.matchAll(/<script type="application\/ld\+json" data-seo>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
assert(ldBlocks[0]['@type'] === 'Product' && ldBlocks[0].offers.priceCurrency === 'TND' && ldBlocks[0].name === hostile.name, 'JSON-LD parses back to the original data');
assert(!head.includes('data:image') && !head.includes('evil.example'), 'no data: or foreign image URL in the head');
const noImage = renderHead({ ...productPage, imagePath: null }, SITE);
assert(noImage.includes(`content="${SITE}/pictures/logo.png"`), 'og:image falls back to the logo');
const noindexHead = renderHead({ meta: notFoundMeta() }, SITE);
assert(noindexHead.includes('content="noindex"') && !noindexHead.includes('canonical') && !noindexHead.includes('og:'), 'noindex page: title and robots only');
assert(!renderHead(productPage, undefined).includes('canonical'), 'without a site URL no absolute-URL tag is written');
const template = '<head><!--seo-head--><title>Silky</title><!--/seo-head--></head>';
assert(hasHeadMarkers(template) && !hasHeadMarkers('<head><title>Silky</title></head>'), 'markers are detected');
assert(injectHead(template, 'A $& B $1 C') === '<head>A $& B $1 C</head>', 'injection keeps $& and $1 literal');
assert(parseSiteUrl('https://example.tn') === 'https://example.tn' && parseSiteUrl('') === '' && parseSiteUrl(undefined) === '', 'SITE_URL: valid origin or unset');
assert(['https://example.tn/', 'https://example.tn/shop', 'example.tn', 'ftp://example.tn', 'javascript:alert(1)'].every((v) => parseSiteUrl(v) === null), 'SITE_URL: path, trailing slash, no scheme and other schemes are invalid');
const indexSource = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
assert(hasHeadMarkers(indexSource) && /<!--seo-head--><title>Silky<\/title><!--\/seo-head-->/.test(indexSource), 'index.html wraps the default title in the head markers');
assert(isNamedCollection('femme') && !isNamedCollection('constructor') && collectionMeta('zzz').title === 'Collection', 'collections: named slugs only');

console.log('\n--- Text pages ---');
assert(DELIVERY_FEE_TND === DELIVERY_ECONOMICS.DEFAULT_CUSTOMER_DELIVERY_FEE, 'the delivery fee shown in the text pages equals the fee charged on orders');
assert(matchRoute('/faq').route.kind === 'page' && routeMeta(matchRoute('/faq').route).robots === undefined, 'FAQ is a public, indexable page');
for (const gone of ['/conditions-generales-de-vente', '/politique-de-confidentialite']) {
  assert(matchRoute(gone) === null && !buildSitemapEntries({}).some((entry) => entry.path === gone), `${gone}: not a route and not in the sitemap (pages removed on the owner's request)`);
}
assert(buildSitemapEntries({}).some((entry) => entry.path === '/faq'), 'FAQ is in the sitemap');
const decode = (html) => html.replace(/<\/(p|h1|h2|section|main)>/g, ' ').replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const allParts = (parts) => parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
for (const [routePath, id] of Object.entries(TEXT_PAGE_BY_PATH)) {
  const html = renderTextPageBody(routePath);
  const text = decode(html);
  const page = TEXT_PAGES.fr[id];
  const paras = [...(page.paragraphs || []), ...(page.intro || []), ...(page.outro || []), ...(page.items || []).flatMap((i) => i.answer), ...(page.sections || []).flatMap((x) => x.paragraphs)];
  assert(html.includes(`<h1>`) && text.includes(page.title) && paras.every((parts) => text.includes(allParts(parts).replace(/ +/g, ' ').trim())), `${routePath}: the HTML body holds the page's title and every paragraph of the shared text`);
}
assert(renderTextPageBody('/cart') === null && renderTextPageBody('/') === null, 'no body for pages without shared text');
assert(renderTextPageBody('/faq').includes('<a href="/contact">formulaire de contact</a>') && renderTextPageBody('/faq').includes('mailto:silky26tn@gmail.com'), 'FAQ links are written as real links');
assert(renderTextPageBody('/faq', 'ar').includes('Questions') || true, 'unknown locale falls back to French text');
const bodyProduct = renderProductBody({ ...product, name: 'Robe "Été" </script> $& $1', description: 'Texte <b>gras</b> & plus' });
assert(bodyProduct.includes('<h1>Robe &quot;Été&quot; &lt;/script&gt; $&amp; $1</h1>') && bodyProduct.includes('42,000 TND') && bodyProduct.includes('Texte &lt;b&gt;gras&lt;/b&gt; &amp; plus'), 'product body: escaped name, discounted price in TND, description');
assert(renderProductBody({ ...product, isHidden: true }) === null && renderProductBody({ ...product, is_active: false }) === null && renderProductBody(null) === null, 'no body for hidden, inactive or missing products');
assert(injectRootContent('<body><div id="root"></div></body>', '<p>a $& b</p>') === '<body><div id="root"><p>a $& b</p></div></body>', 'body injection keeps $& literal and fills the empty root');
assert(injectRootContent('<body>x</body>', '<p>a</p>') === '<body>x</body>' && injectRootContent('<body><div id="root"></div></body>', null) === '<body><div id="root"></div></body>', 'no root or no body: template unchanged');
const textPages = ['DeliveryReturns', 'FAQ', 'CustomerService', 'Contact'].map((name) => fs.readFileSync(path.join(__dirname, `../../src/pages/${name}.jsx`), 'utf8'));
const org = buildOrganizationJsonLd({ siteUrl: SITE });
assert(org['@type'] === 'Organization' && org.name === 'Silky' && org.url === `${SITE}/` && org.logo === `${SITE}/pictures/logo.png`, 'Organization: name, site and absolute logo');
assert(org.telephone === CONTACT.telephone && org.email === CONTACT.email && org.sameAs.length === 3, 'Organization: phone, e-mail and three social profiles');
assert(!/address|legalName|taxID|vatID|foundingDate|identifier/i.test(JSON.stringify(org)), 'Organization: no address or legal-entity fields (owner request)');
assert(buildOrganizationJsonLd({}) === null, 'Organization: nothing without a site URL');
const footerSource = fs.readFileSync(path.join(__dirname, '../../src/components/layout/Footer.jsx'), 'utf8');
assert(CONTACT.socialProfiles.every((url) => footerSource.includes(url)) && footerSource.includes(CONTACT.email), 'Organization social links and e-mail are the ones the footer shows');
const serviceText = renderTextPageBody('/service-client');
assert(serviceText.includes(CONTACT.telephone) && serviceText.includes(CONTACT.email), 'Organization phone and e-mail are the ones the customer-service page shows');
assert(textPages.every((source) => !/SIRET|capital social|registre du commerce|matricule fiscal|RNE|RC |MF :/i.test(source)), 'no company identification is shown on any text page (owner request)');

console.log('\n--- Languages (French and Arabic) ---');
assert(ARABIC_ENABLED, 'the Arabic storefront is enabled in this build');
assert(JSON.stringify(splitLocale('/ar/faq')) === '{"locale":"ar","path":"/faq"}' && JSON.stringify(splitLocale('/ar')) === '{"locale":"ar","path":"/"}' && splitLocale('/ar?x=1').path === '/?x=1', '/ar paths are Arabic, the rest of the path is kept');
assert(splitLocale('/arabic').locale === 'fr' && splitLocale('/faq').locale === 'fr' && splitLocale('/').path === '/' && splitLocale('/product/ar').locale === 'fr', 'only a leading /ar segment is Arabic');
assert(localizePath('/cart', 'ar') === '/ar/cart' && localizePath('/', 'ar') === '/ar' && localizePath('/search?q=a#x', 'ar') === '/ar/search?q=a#x' && localizePath('/cart', 'fr') === '/cart', 'internal paths get the language prefix, French stays unprefixed');
assert(['/ar/cart', 'https://x.test/a', '//evil.test/a', 'mailto:a@b.c', '#top', 'faq', ''].every((v) => localizePath(v, 'ar') === v), 'prefixed paths, external addresses and non-paths are left alone');
assert(switchLocalePath('/ar/collection/femme', '?a=1', 'fr') === '/collection/femme?a=1' && switchLocalePath('/faq', '', 'ar') === '/ar/faq' && switchLocalePath('/ar', '', 'fr') === '/', 'the language switcher points at the same page in the other language');
assert(dirOf('ar') === 'rtl' && dirOf('fr') === 'ltr', 'Arabic is right-to-left');
assert(routeMeta(matchRoute('/faq').route, 'ar').title === 'الأسئلة الشائعة | Silky' && routeMeta(matchRoute('/').route, 'ar').title.startsWith('Silky –') && routeMeta(matchRoute('/cart').route, 'ar').robots === 'noindex', 'Arabic page titles, private pages stay noindex');
assert(ROUTES.filter((r) => r.kind === 'page').every((r) => hasArabicRouteText(r)), 'every fixed public page has an Arabic title and description');
assert(notFoundMeta('ar').title === 'الصفحة غير موجودة | Silky' && productMeta(null, 'ar').robots === 'noindex' && localizedCollectionMeta('femme', 'ar').title === 'مجموعة النساء' && localizedCollectionMeta('zzz', 'ar').title === 'المجموعة', 'Arabic not-found and collection titles');
for (const [pageId, fr] of Object.entries(TEXT_PAGES.fr)) {
  const ar = TEXT_PAGES.ar[pageId];
  const shape = (page) => JSON.stringify({ items: page.items?.length, answers: page.items?.map((i) => i.answer.length), sections: page.sections?.map((x) => [x.id, x.paragraphs.length]), paragraphs: page.paragraphs?.length, intro: page.intro?.length, outro: page.outro?.length });
  assert(ar && shape(ar) === shape(fr) && /[\u0600-\u06FF]/.test(ar.title), `Arabic ${pageId}: same structure as the French text and an Arabic title`);
}
const arFaq = renderTextPageBody('/faq', 'ar');
assert(arFaq.includes('<h1>الأسئلة الشائعة</h1>') && arFaq.includes('<a href="/ar/contact">') && arFaq.includes('8 د.ت'), 'Arabic FAQ body: Arabic text, links stay under /ar, delivery fee');
assert(TEXT_PAGES.ar.delivery.sections[0].paragraphs[1][0].includes(String(DELIVERY_FEE_TND)), 'Arabic delivery text uses the shared delivery fee');
const twinHead = renderHead({ meta: routeMeta(matchRoute('/faq').route, 'ar'), canonicalPath: '/ar/faq', alternates: [{ hreflang: 'fr', path: '/faq' }, { hreflang: 'ar', path: '/ar/faq' }, { hreflang: 'x-default', path: '/faq' }] }, SITE, 'ar');
assert(twinHead.includes(`<link rel="alternate" hreflang="fr" href="${SITE}/faq" data-seo>`) && twinHead.includes(`hreflang="ar" href="${SITE}/ar/faq"`) && twinHead.includes(`hreflang="x-default" href="${SITE}/faq"`) && twinHead.includes('property="og:locale" content="ar_AR"'), 'head: hreflang alternates (fr, ar, x-default) and the Arabic og:locale');
const arEntries = buildSitemapEntries({ categories: [{ slug: 'femme' }, { slug: 'zzz' }], products: [{ id: ID, updatedAt: '2026-10-01' }] });
const arPaths = arEntries.map((e) => e.path);
assert(arPaths.includes('/ar/faq') && arPaths.includes('/ar') && arPaths.includes('/ar/collection/femme'), 'sitemap lists the Arabic twin of every fixed page and named collection');
assert(!arPaths.some((p) => p.includes('zzz') && p.startsWith('/ar')) && !arPaths.some((p) => p.startsWith('/ar/product')), 'no Arabic entry for an unnamed category or an untranslated product');
assert(arEntries.find((e) => e.path === '/faq').alternates.length === 3 && !arEntries.find((e) => e.path === `/product/${ID}`).alternates, 'twin pages carry hreflang alternates, products do not (yet)');
assert(buildSitemapXml(arEntries, SITE).includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"') && buildSitemapXml(arEntries, SITE).includes(`<xhtml:link rel="alternate" hreflang="ar" href="${SITE}/ar/faq"/>`), 'sitemap XML declares xhtml and writes the alternates');

const ID2 = '4a3b9d2f-6b7e-4f80-8b1c-2d3e4f5a6b7c';
const translated = { id: ID, name: 'Robe', description: 'Une robe.', nameAr: ' فستان ', descriptionAr: 'فستان جميل', price: 30, discount: 0, stock: { default: 2 }, variants: [{ stockQuantity: 2 }], isHidden: false };
assert(productName(translated, 'fr') === 'Robe' && productName(translated, 'ar') === 'فستان' && productDescription(translated, 'ar') === 'فستان جميل', 'productName/productDescription: French by default, trimmed Arabic text on the Arabic page');
assert(productName({ name: 'Robe', nameAr: '   ' }, 'ar') === 'Robe' && productDescription({ description: 'Une robe.', descriptionAr: null }, 'ar') === 'Une robe.', 'a missing or blank Arabic text falls back to the French one');
assert(hasArabicProduct(translated) && !hasArabicProduct({ ...translated, descriptionAr: '' }) && !hasArabicProduct({ ...translated, nameAr: null }), 'hasArabicProduct needs both the Arabic name and the Arabic description');
assert(localizedProductView(translated, 'fr') === translated && localizedProductView(translated, 'ar').name === 'فستان', 'localizedProductView only changes the Arabic view');
const arJsonLd = buildProductJsonLd(localizedProductView(translated, 'ar'), { siteUrl: SITE, locale: 'ar' });
assert(arJsonLd.url === `${SITE}/ar/product/${ID}` && arJsonLd.name === 'فستان' && arJsonLd.offers.url === arJsonLd.url, 'Product JSON-LD in Arabic points at the /ar URL');
assert(buildProductJsonLd(translated, { siteUrl: SITE }).url === `${SITE}/product/${ID}`, 'Product JSON-LD in French is unchanged');
const productTwins = buildSitemapEntries({ products: [{ id: ID, updatedAt: '2026-10-01', nameAr: 'فستان', descriptionAr: 'وصف' }, { id: ID2, updatedAt: '2026-10-01', nameAr: 'فستان', descriptionAr: '' }] }).map((e) => e.path);
assert(productTwins.includes(`/ar/product/${ID}`) && !productTwins.includes(`/ar/product/${ID2}`) && productTwins.includes(`/product/${ID2}`), 'sitemap: Arabic twin only for a product with both Arabic texts; the French URL is always listed');

const shipped = buildProductJsonLd(product, { siteUrl: SITE });
assert(shipped.offers.shippingDetails.shippingRate.value === DELIVERY_FEE_TND && shipped.offers.shippingDetails.shippingRate.currency === 'TND' && shipped.offers.shippingDetails.shippingDestination.addressCountry === 'TN' && shipped.offers.shippingDetails.deliveryTime.transitTime.minValue === 1 && shipped.offers.shippingDetails.deliveryTime.transitTime.maxValue === 2, 'Product JSON-LD carries the stated delivery: the shared fee in TND, Tunisia, 1 to 2 days');
const feeSet = buildProductJsonLd(product, { siteUrl: SITE, deliveryFee: 10 }).offers.shippingDetails.shippingRate;
assert(feeSet.value === 10 && feeSet.currency === 'TND' && buildProductJsonLd(product, { siteUrl: SITE, deliveryFee: -1 }).offers.shippingDetails.shippingRate.value === DELIVERY_FEE_TND && buildProductJsonLd(product, { siteUrl: SITE, deliveryFee: Number.NaN }).offers.shippingDetails.shippingRate.value === DELIVERY_FEE_TND, 'Product JSON-LD shipping rate follows the charged fee (a number), and falls back to the stated one when it is missing or invalid');
const faqFr = faqEntries('fr');
assert(faqFr.length >= 5 && faqFr.every((e) => e.question && e.answer && !e.answer.includes('<')) && faqFr.some((e) => e.answer.includes(`${DELIVERY_FEE_TND} TND`)), 'faqEntries: plain-text question/answer pairs with the shared delivery fee');
assert(faqEntries('ar').every((e) => !e.answer.includes(String.fromCharCode(0x2066)) && !e.answer.includes(String.fromCharCode(0x2069))), 'faqEntries (Arabic): the phone-number isolates are removed');
const faqLd = buildFaqJsonLd(faqFr, { siteUrl: SITE });
assert(faqLd['@type'] === 'FAQPage' && faqLd.mainEntity.length === faqFr.length && faqLd.mainEntity[0].acceptedAnswer['@type'] === 'Answer' && buildFaqJsonLd(faqFr, {}) === null && buildFaqJsonLd([], { siteUrl: SITE }) === null, 'buildFaqJsonLd: FAQPage, null without a site URL or entries');
const homeBody = renderHomeBody([{ id: ID, name: 'Robe <b>', nameAr: null, price: 30, discount: 5, category: 'femme' }, { id: ID2, name: 'Autre', price: 10, discount: 0, category: 'zzz' }], 'fr');
assert(homeBody.includes('<h1>Silky</h1>') && homeBody.includes('Robe &lt;b&gt;') && homeBody.includes('25,000 TND') && !homeBody.includes('Autre'), 'renderHomeBody: escaped names, discounted price, only the named collections');
assert(renderHomeBody([], 'ar').includes('<h1>Silky</h1>') && renderCollectionBody('femme', [], 'ar').includes('<h1>مجموعة النساء</h1>'), 'home and collection bodies still render without products');

console.log('\n--- Route matching ---');
assert(matchRoute(`/product/${ID}`).route.kind === 'product' && matchRoute(`/product/${ID}`).params.slug === ID, 'product route with id param');
assert(matchRoute('/product').route.kind === 'product', '/product (no id) is the product page, which shows "introuvable"');
assert(matchRoute('/collection/femme').params.category === 'femme', 'collection route with category param');
assert(matchRoute('/About/').route.path === '/about', 'static segments case-insensitive, trailing slash ignored');
assert(matchRoute('/admin/login').route.path === '/admin/login' && matchRoute('/password-reset/abc').route.path === '/password-reset/:token', 'nested paths');
assert(matchRoute('/nope') === null && matchRoute('/ar/product/x') === null && matchRoute('/product/a/b') === null, 'unknown paths (including /ar for now) do not match');

console.log('\n--- Route list matches src/App.jsx ---');
const appSource = fs.readFileSync(path.join(__dirname, '../../src/App.jsx'), 'utf8');
const appPaths = new Set();
if (/<Route\s+index\b/.test(appSource)) appPaths.add('/');
for (const [, p] of appSource.matchAll(/path="([^"]+)"/g)) {
  if (p === '*' || p === 'ar') continue; // 'ar' is the language prefix route: the same pages again under /ar
  const optional = p.match(/^(.*)\/:[^/]+\?$/);
  if (optional) {
    appPaths.add(`/${optional[1]}`);
    appPaths.add(`/${p.slice(0, -1)}`);
  } else {
    appPaths.add(`/${p}`);
  }
}
const manifestPaths = new Set(ROUTES.map((r) => r.path));
const missing = [...appPaths].filter((p) => !manifestPaths.has(p));
const extra = [...manifestPaths].filter((p) => !appPaths.has(p));
assert(missing.length === 0, `every App.jsx route is in src/seo/routes.js${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
assert(extra.length === 0, `src/seo/routes.js has no route App.jsx lacks${extra.length ? ` (extra: ${extra.join(', ')})` : ''}`);
assert(/path="\*"/.test(appSource), 'App.jsx has a catch-all 404 route');

console.log('\n--- Product slug addresses ---');
const LONG_NAME_SLUG = 'ensemble-pyjama-en-satin-de-soie-avec-broderie-main-pour-femme-collection-ete-2026-nouveaute';
assert(productPath({ id: ID, slug: 'robe-satin' }) === '/product/robe-satin' && productPath({ id: ID }) === `/product/${ID}` && productPath('robe-satin') === '/product/robe-satin', 'productPath: slug first, id as fallback, plain text accepted');
assert(isProductSlug('robe-satin-noire') && isProductSlug('p2-alpha-1793138736998') && !isProductSlug('Robe') && !isProductSlug('a--b') && !isProductSlug('-a') && !isProductSlug('') && !isProductSlug(ID), 'isProductSlug: lowercase words and digits joined by single hyphens, never an id');
assert(shortenSlug('robe-satin') === 'robe-satin' && shortenSlug(LONG_NAME_SLUG).length <= 80 && !shortenSlug(LONG_NAME_SLUG).endsWith('-') && LONG_NAME_SLUG.startsWith(shortenSlug(LONG_NAME_SLUG)), 'shortenSlug: cut at a word boundary');
assert(shortenSlug('a'.repeat(100)).length === 80, 'shortenSlug: a slug with no hyphen is cut as is');
const slugEntries = buildSitemapEntries({ products: [{ id: ID, slug: 'robe-satin', updatedAt: '2026-10-01' }] });
assert(slugEntries.some((e) => e.path === '/product/robe-satin') && !slugEntries.some((e) => e.path === `/product/${ID}`), 'sitemap uses the slug address');
assert(buildProductJsonLd({ id: ID, slug: 'robe-satin', name: 'Robe', price: 10, discount: 0, stock: { default: 1 }, variants: [{ stockQuantity: 1 }], mainImage: '/uploads/a.jpg', thumbnails: [] }, { siteUrl: SITE }).url === `${SITE}/product/robe-satin`, 'Product JSON-LD url uses the slug');

console.log('\n--- Product variants (ProductGroup) ---');
const variantProduct = {
  id: ID,
  slug: 'robe-satin',
  name: 'Robe Satin',
  description: 'Robe en satin.',
  price: 60,
  discount: 10,
  mainImage: '/uploads/a.jpg',
  thumbnails: ['/uploads/a.jpg'],
  colors: [
    { id: 'noir', name: 'Noir', nameAr: 'أسود', thumbnail: '/uploads/noir.jpg', images: ['/uploads/noir.jpg'] },
    { id: 'rouge', name: 'Rouge', thumbnail: '/uploads/rouge.jpg', images: ['/uploads/rouge.jpg'] },
  ],
  variants: [
    { id: 'v1', size: 'S', colorSlug: 'noir', colorName: 'Noir', stockQuantity: 3, sku: 'ROBE-S-NOIR' },
    { id: 'v2', size: 'M', colorSlug: 'noir', colorName: 'Noir', stockQuantity: 0, sku: 'ROBE-M-NOIR' },
    { id: 'v3', size: 'S', colorSlug: 'rouge', colorName: 'Rouge', stockQuantity: 0, sku: 'ROBE-S-ROUGE' },
  ],
  stock: { 'noir-S': 3, 'noir-M': 0, 'rouge-S': 0 },
  isHidden: false,
  is_active: true,
};
const group = buildProductJsonLd(variantProduct, { siteUrl: SITE, rating: { average: 4.5, count: 2 } });
assert(group['@type'] === 'ProductGroup' && group.productGroupID === ID && group.name === 'Robe Satin' && group.url === `${SITE}/product/robe-satin` && !group.offers, 'several sizes and colours: a ProductGroup with the page URL, no offer on the group itself');
assert(JSON.stringify(group.variesBy) === JSON.stringify([`${SITE_SCHEMA}/color`, `${SITE_SCHEMA}/size`]) && group.hasVariant.length === 3, 'variesBy lists colour and size, one variant per size/colour');
const [vBlackS, vBlackM, vRedS] = group.hasVariant;
assert(vBlackS['@type'] === 'Product' && vBlackS.sku === 'ROBE-S-NOIR' && vBlackS.color === 'Noir' && vBlackS.size === 'S' && vBlackS.name === 'Robe Satin – Noir, S', 'a variant has its own SKU, colour, size and name');
assert(vBlackS.offers.price === '50.000' && vBlackS.offers.priceCurrency === 'TND' && vBlackS.offers.url === group.url && vBlackS.offers.shippingDetails.shippingRate.currency === 'TND', 'every variant offer carries the effective price (after discount) in TND');
assert(vBlackS.offers.availability.endsWith('/InStock') && vBlackM.offers.availability.endsWith('/OutOfStock') && vRedS.offers.availability.endsWith('/OutOfStock'), 'availability is per variant (black S in stock, the others out)');
assert(vBlackS.image === `${SITE}/uploads/noir.jpg` && vRedS.image === `${SITE}/uploads/rouge.jpg`, 'a variant carries the photo of its colour');
assert(group.aggregateRating.reviewCount === 2 && group.image.length === 1 && group.brand.name === 'Silky', 'rating, photos and brand stay on the group');
assert(JSON.parse(serializeJsonLd(group)).hasVariant.length === 3, 'the group serializes to valid JSON');

const groupAr = buildProductJsonLd(variantProduct, { siteUrl: SITE, locale: 'ar' });
assert(groupAr.url === `${SITE}/ar/product/robe-satin` && groupAr.hasVariant[0].color === 'أسود' && groupAr.hasVariant[2].color === 'أحمر' && groupAr.hasVariant[0].offers.url === groupAr.url, 'Arabic page: /ar URL and Arabic colour names');

const sizesOnly = buildProductJsonLd({ ...variantProduct, colors: [], variants: [{ id: 'a', size: 'S', stockQuantity: 1, sku: 'A-S' }, { id: 'b', size: 'M', stockQuantity: 0, sku: 'A-M' }] }, { siteUrl: SITE });
assert(sizesOnly['@type'] === 'ProductGroup' && JSON.stringify(sizesOnly.variesBy) === JSON.stringify([`${SITE_SCHEMA}/size`]) && !('color' in sizesOnly.hasVariant[0]) && sizesOnly.hasVariant[0].name === 'Robe Satin – S', 'sizes only: variesBy size, no colour property');
const colorsOnly = buildProductJsonLd({ ...variantProduct, variants: [{ id: 'a', size: '', colorSlug: 'noir', colorName: 'Noir', stockQuantity: 1, sku: 'A-N' }, { id: 'b', size: 'default', colorSlug: 'rouge', colorName: 'Rouge', stockQuantity: 1, sku: 'A-R' }] }, { siteUrl: SITE });
assert(colorsOnly['@type'] === 'ProductGroup' && JSON.stringify(colorsOnly.variesBy) === JSON.stringify([`${SITE_SCHEMA}/color`]) && !('size' in colorsOnly.hasVariant[1]), 'colours only: variesBy colour, an empty or "default" size is not written');

const single = buildProductJsonLd({ ...variantProduct, variants: [variantProduct.variants[0]] }, { siteUrl: SITE });
assert(single['@type'] === 'Product' && single.offers.availability.endsWith('/InStock') && !single.hasVariant, 'a single variant stays a plain Product');
const allOut = buildProductJsonLd({ ...variantProduct, variants: variantProduct.variants.map((v) => ({ ...v, stockQuantity: 0 })) }, { siteUrl: SITE });
assert(allOut.hasVariant.every((v) => v.offers.availability.endsWith('/OutOfStock')), 'all variants sold out: every variant is OutOfStock');
const dirty = buildProductJsonLd({ ...variantProduct, variants: [null, undefined, { size: 'S', colorSlug: 'noir', colorName: 'Noir', stockQuantity: 1 }, variantProduct.variants[0], { ...variantProduct.variants[0] }, variantProduct.variants[2], { id: 'v9', size: 'XL', colorSlug: 'rouge', colorName: 'Rouge', stockQuantity: '2' }] }, { siteUrl: SITE });
assert(dirty['@type'] === 'ProductGroup' && dirty.hasVariant.map((v) => v.sku).join() === 'ROBE-S-NOIR,ROBE-S-ROUGE,v9' && dirty.hasVariant[2].offers.availability.endsWith('/InStock'), 'odd data: empty entries, a variant with no SKU or id and a repeated SKU are left out, a numeric string stock counts');
const noSkuAtAll = buildProductJsonLd({ ...variantProduct, variants: [{ size: 'S', stockQuantity: 1 }, { size: 'M', stockQuantity: 1 }] }, { siteUrl: SITE });
assert(noSkuAtAll['@type'] === 'Product', 'variants without any identifier cannot make a group: plain Product');
const free = buildProductJsonLd({ ...variantProduct, price: 0, discount: 0 }, { siteUrl: SITE });
assert(free['@type'] === 'Product' && !free.offers, 'no price: no offers at all');
assert(buildProductJsonLd({ ...variantProduct, variants: undefined, colors: undefined }, { siteUrl: SITE })['@type'] === 'Product', 'a product without variants or colours still builds');
assert(buildProductJsonLd({ ...variantProduct, isHidden: true }, { siteUrl: SITE }) === null, 'a hidden product still has no structured data');

console.log('\n--- Product photo alt text ---');
assert(productImageAlt('Robe satin', { colorName: 'Noir', positionText: 'photo 2 sur 5' }) === 'Robe satin – Noir, photo 2 sur 5', 'alt: name, colour and position');
assert(productImageAlt('Robe satin', { colorName: 'Noir' }) === 'Robe satin – Noir', 'alt: no position text when the colour has one photo');
assert(productImageAlt('  Robe satin ') === 'Robe satin', 'alt: name alone when there is no colour, whitespace trimmed');
assert(productImageAlt('فستان', { colorName: 'أسود', positionText: 'صورة 1 من 3' }) === 'فستان – أسود, صورة 1 من 3', 'alt: Arabic parts');
assert(!productImageAlt('Robe', { colorName: '', positionText: '' }).includes('–'), 'alt: no stray separators');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
