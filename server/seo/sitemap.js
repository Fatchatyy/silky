// sitemap.xml built from the route list and published data. Not served yet: Step 2 publishes it once the production
// domain is known. Only indexable URLs are listed; hidden products and private routes never are.
import { ROUTES } from '../../src/seo/routes.js';
import { absoluteUrl, categoryPath, isCanonicalProductId, productPath } from '../../shared/urls.js';
import { isNamedCollection } from '../../src/seo/collections.js';
import { ARABIC_ENABLED, localizePath } from '../../shared/locales.js';
import { hasArabicRouteText } from '../../src/seo/meta.js';
import { hasArabicProduct } from '../../shared/productText.js';

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * products:   [{ id, isActive | is_active | isHidden, updatedAt }]
 * categories: [{ slug }]
 * Returns [{ path, lastmod }] for the fixed public pages, the categories and the published products.
 */
export function buildSitemapEntries({ products = [], categories = [] } = {}) {
  // A page that exists in French and Arabic is listed twice, each entry pointing at both (hreflang alternates).
  const withTwin = (frPath, hasArabic) => {
    if (!ARABIC_ENABLED || !hasArabic) return [{ path: frPath }];
    const alternates = [
      { hreflang: 'fr', path: frPath },
      { hreflang: 'ar', path: localizePath(frPath, 'ar') },
      { hreflang: 'x-default', path: frPath },
    ];
    return [
      { path: frPath, alternates },
      { path: localizePath(frPath, 'ar'), alternates },
    ];
  };

  const pages = ROUTES.filter((route) => route.kind === 'page').flatMap((route) => withTwin(route.path, hasArabicRouteText(route)));
  const collections = categories
    .filter((category) => /^[a-z0-9-]+$/.test(String(category?.slug ?? '')))
    .flatMap((category) => withTwin(categoryPath(category.slug), isNamedCollection(category.slug)));
  const published = products
    .filter((product) => product && product.isActive !== false && product.is_active !== false && !product.isHidden)
    .filter((product) => isCanonicalProductId(product.id))
    .flatMap((product) =>
      // Only a product with both an Arabic name and description gets an Arabic twin.
      withTwin(productPath(product), hasArabicProduct(product)).map((entry) => ({ ...entry, lastmod: product.updatedAt })),
    );
  return [...pages, ...collections, ...published];
}

export function buildSitemapXml(entries, siteUrl) {
  if (!absoluteUrl(siteUrl, '/')) throw new Error('buildSitemapXml needs a valid http(s) site URL');
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod ? toDate(entry.lastmod) : null;
    const alternates = (entry.alternates || [])
      .map((alt) => `<xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(absoluteUrl(siteUrl, alt.path))}"/>`)
      .join('');
    return `  <url><loc>${escapeXml(absoluteUrl(siteUrl, entry.path))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${alternates}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}
