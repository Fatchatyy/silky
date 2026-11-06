// URL rules shared by the browser and the server. Pure: no DOM, no React.

export const SITE_NAME = 'Silky';
export const DEFAULT_LOCALE = 'fr';

// Lowercase only: the storefront looks products up by exact id (ProductsContext getProduct), so an uppercase id
// would show "Produit non disponible" even though PostgreSQL would match it.
const CANONICAL_PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalProductId(id) {
  return CANONICAL_PRODUCT_ID.test(String(id ?? ''));
}

// A product's public address is its slug (made from its name when it was created, never changed afterwards, so links
// stay valid when the name is edited): /product/robe-satin-noire. The id still works and redirects to the slug.
const PRODUCT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isProductSlug(slug) {
  const value = String(slug ?? '');
  return value.length > 0 && value.length <= 255 && PRODUCT_SLUG.test(value) && !isCanonicalProductId(value);
}

/** `ref` is a product ({ slug, id }) or the text already placed in the URL. A product without a slug falls back to its id. */
export const productPath = (ref) => `/product/${typeof ref === 'object' && ref ? ref.slug || ref.id : ref}`;
export const categoryPath = (slug) => `/collection/${slug}`;

/** French keeps today's unprefixed URLs; other languages (Arabic is planned) live under /<locale>/. */
export function localizedPath(path, locale = DEFAULT_LOCALE) {
  if (locale === DEFAULT_LOCALE) return path;
  return `/${locale}${path === '/' ? '' : path}`;
}

/** Absolute URL on the configured site, or null while no valid http(s) site URL is configured. */
export function absoluteUrl(siteUrl, path) {
  let base;
  try {
    base = new URL(String(siteUrl ?? ''));
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const origin = base.origin;
  const normalizedPath = String(path ?? '/').startsWith('/') ? String(path ?? '/') : `/${path}`;
  return `${origin}${encodeURI(normalizedPath)}`;
}

/**
 * Only the site's own image folders may be published as preview or structured-data images. Rejects data: URLs
 * (the admin editor stores one when an upload fails), other hosts and path tricks.
 */
export function publicImagePath(url) {
  const value = String(url ?? '').trim();
  if (!/^\/(uploads|pictures)\/[^\s?#]+$/.test(value) || value.includes('..')) return null;
  return value;
}
