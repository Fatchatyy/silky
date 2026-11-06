/**
 * Pure tests for the modules in shared/ (urls, locales, productText, textPages, delivery): the assertions that
 * used to live in test_seo_builders.js and concern shared code rather than the old SEO layer.
 * No database, no server, no network.
 *
 * Usage: node server/scripts/test_shared_modules.js
 */
import { absoluteUrl, isCanonicalProductId, isProductSlug, localizedPath, productPath, publicImagePath } from '../shared/urls.js';
import { shortenSlug } from '../utils/slug.js';
import { hasArabicProduct, localizedProductView, productDescription, productImageAlt, productName } from '../shared/productText.js';
import { DELIVERY_FEE_TND } from '../shared/delivery.js';
import { DELIVERY_ECONOMICS } from '../config/delivery.js';
import { TEXT_PAGES, faqEntries } from '../shared/textPages.js';
import { dirOf, localizePath, splitLocale, switchLocalePath } from '../shared/locales.js';

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
const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';

console.log('--- URLs ---');
assert(isCanonicalProductId(ID) && !isCanonicalProductId(ID.toUpperCase()) && !isCanonicalProductId('abc'), 'only lowercase UUIDs are canonical product ids');
assert(localizedPath('/product/x') === '/product/x' && localizedPath('/product/x', 'ar') === '/ar/product/x' && localizedPath('/', 'ar') === '/ar', 'French unprefixed, Arabic under /ar');
assert(absoluteUrl(SITE, '/about') === 'https://shop.example/about', 'absoluteUrl joins site and path');
assert(absoluteUrl('https://shop.example/', 'about') === 'https://shop.example/about', 'absoluteUrl normalizes slashes');
assert(absoluteUrl(undefined, '/x') === null && absoluteUrl('javascript:alert(1)', '/x') === null && absoluteUrl('not a url', '/x') === null, 'absoluteUrl is null without a valid http(s) site');
assert(publicImagePath('/uploads/a.jpg') === '/uploads/a.jpg' && publicImagePath('/pictures/logo.png') === '/pictures/logo.png', 'own image folders allowed');
assert(
  ['data:image/png;base64,AAAA', 'https://evil.example/x.jpg', '/uploads/../.env', '/etc/passwd', '', null].every((v) => publicImagePath(v) === null),
  'data:, foreign, traversal and empty image URLs rejected',
);

console.log('\n--- Text pages ---');
assert(DELIVERY_FEE_TND === DELIVERY_ECONOMICS.DEFAULT_CUSTOMER_DELIVERY_FEE, 'the delivery fee shown in the text pages equals the fee charged on orders');
const faqFr = faqEntries('fr');
assert(faqFr.length >= 5 && faqFr.every((e) => e.question && e.answer && !e.answer.includes('<')) && faqFr.some((e) => e.answer.includes(`${DELIVERY_FEE_TND} TND`)), 'faqEntries: plain-text question/answer pairs with the shared delivery fee');
assert(faqEntries('ar').every((e) => !e.answer.includes(String.fromCharCode(0x2066)) && !e.answer.includes(String.fromCharCode(0x2069))), 'faqEntries (Arabic): the phone-number isolates are removed');
for (const [pageId, fr] of Object.entries(TEXT_PAGES.fr)) {
  const ar = TEXT_PAGES.ar[pageId];
  const shape = (page) => JSON.stringify({ items: page.items?.length, answers: page.items?.map((i) => i.answer.length), sections: page.sections?.map((x) => [x.id, x.paragraphs.length]), paragraphs: page.paragraphs?.length, intro: page.intro?.length, outro: page.outro?.length });
  assert(ar && shape(ar) === shape(fr) && /[؀-ۿ]/.test(ar.title), `Arabic ${pageId}: same structure as the French text and an Arabic title`);
}
assert(TEXT_PAGES.ar.delivery.sections[0].paragraphs[1][0].includes(String(DELIVERY_FEE_TND)), 'Arabic delivery text uses the shared delivery fee');

console.log('\n--- Languages (French and Arabic) ---');
assert(JSON.stringify(splitLocale('/ar/faq')) === '{"locale":"ar","path":"/faq"}' && JSON.stringify(splitLocale('/ar')) === '{"locale":"ar","path":"/"}' && splitLocale('/ar?x=1').path === '/?x=1', '/ar paths are Arabic, the rest of the path is kept');
assert(splitLocale('/arabic').locale === 'fr' && splitLocale('/faq').locale === 'fr' && splitLocale('/').path === '/' && splitLocale('/product/ar').locale === 'fr', 'only a leading /ar segment is Arabic');
assert(localizePath('/cart', 'ar') === '/ar/cart' && localizePath('/', 'ar') === '/ar' && localizePath('/search?q=a#x', 'ar') === '/ar/search?q=a#x' && localizePath('/cart', 'fr') === '/cart', 'internal paths get the language prefix, French stays unprefixed');
assert(['/ar/cart', 'https://x.test/a', '//evil.test/a', 'mailto:a@b.c', '#top', 'faq', ''].every((v) => localizePath(v, 'ar') === v), 'prefixed paths, external addresses and non-paths are left alone');
assert(switchLocalePath('/ar/collection/femme', '?a=1', 'fr') === '/collection/femme?a=1' && switchLocalePath('/faq', '', 'ar') === '/ar/faq' && switchLocalePath('/ar', '', 'fr') === '/', 'the language switcher points at the same page in the other language');
assert(dirOf('ar') === 'rtl' && dirOf('fr') === 'ltr', 'Arabic is right-to-left');

console.log('\n--- Product text (Arabic fallback) ---');
const translated = { id: ID, name: 'Robe', description: 'Une robe.', nameAr: ' فستان ', descriptionAr: 'فستان جميل', price: 30, discount: 0, stock: { default: 2 }, variants: [{ stockQuantity: 2 }], isHidden: false };
assert(productName(translated, 'fr') === 'Robe' && productName(translated, 'ar') === 'فستان' && productDescription(translated, 'ar') === 'فستان جميل', 'productName/productDescription: French by default, trimmed Arabic text on the Arabic page');
assert(productName({ name: 'Robe', nameAr: '   ' }, 'ar') === 'Robe' && productDescription({ description: 'Une robe.', descriptionAr: null }, 'ar') === 'Une robe.', 'a missing or blank Arabic text falls back to the French one');
assert(hasArabicProduct(translated) && !hasArabicProduct({ ...translated, descriptionAr: '' }) && !hasArabicProduct({ ...translated, nameAr: null }), 'hasArabicProduct needs both the Arabic name and the Arabic description');
assert(localizedProductView(translated, 'fr') === translated && localizedProductView(translated, 'ar').name === 'فستان', 'localizedProductView only changes the Arabic view');

console.log('\n--- Product slug addresses ---');
const LONG_NAME_SLUG = 'ensemble-pyjama-en-satin-de-soie-avec-broderie-main-pour-femme-collection-ete-2026-nouveaute';
assert(productPath({ id: ID, slug: 'robe-satin' }) === '/product/robe-satin' && productPath({ id: ID }) === `/product/${ID}` && productPath('robe-satin') === '/product/robe-satin', 'productPath: slug first, id as fallback, plain text accepted');
assert(isProductSlug('robe-satin-noire') && isProductSlug('p2-alpha-1793138736998') && !isProductSlug('Robe') && !isProductSlug('a--b') && !isProductSlug('-a') && !isProductSlug('') && !isProductSlug(ID), 'isProductSlug: lowercase words and digits joined by single hyphens, never an id');
assert(shortenSlug('robe-satin') === 'robe-satin' && shortenSlug(LONG_NAME_SLUG).length <= 80 && !shortenSlug(LONG_NAME_SLUG).endsWith('-') && LONG_NAME_SLUG.startsWith(shortenSlug(LONG_NAME_SLUG)), 'shortenSlug: cut at a word boundary');
assert(shortenSlug('a'.repeat(100)).length === 80, 'shortenSlug: a slug with no hyphen is cut as is');

console.log('\n--- Product photo alt text ---');
assert(productImageAlt('Robe satin', { colorName: 'Noir', positionText: 'photo 2 sur 5' }) === 'Robe satin – Noir, photo 2 sur 5', 'alt: name, colour and position');
assert(productImageAlt('Robe satin', { colorName: 'Noir' }) === 'Robe satin – Noir', 'alt: no position text when the colour has one photo');
assert(productImageAlt('  Robe satin ') === 'Robe satin', 'alt: name alone when there is no colour, whitespace trimmed');
assert(productImageAlt('فستان', { colorName: 'أسود', positionText: 'صورة 1 من 3' }) === 'فستان – أسود, صورة 1 من 3', 'alt: Arabic parts');
assert(!productImageAlt('Robe', { colorName: '', positionText: '' }).includes('–'), 'alt: no stray separators');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
