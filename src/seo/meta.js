// Page metadata (title, description, robots) built from real application data. Pure: no DOM, no React.
import { SITE_NAME } from '../../shared/urls.js';
import { AR_COLLECTION_TITLE, AR_NOT_FOUND_TITLE, AR_PRODUCT_NOT_FOUND_TITLE, AR_ROUTE_TEXT } from './arabic.js';

const DESCRIPTION_MAX_LENGTH = 160;
const NOINDEX = 'noindex';

/** Collapses whitespace (descriptions are typed in the admin with line breaks). */
export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Shortens at a word boundary and marks the cut with an ellipsis. */
export function truncate(text, max = DESCRIPTION_MAX_LENGTH) {
  const value = cleanText(text);
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const withSiteName = (title) => `${title} | ${SITE_NAME}`;

/** Metadata of a fixed route from src/seo/routes.js ('page' or 'private'). */
export function routeMeta(route, locale = 'fr') {
  const text = locale === 'ar' ? { ...route, ...AR_ROUTE_TEXT[route.path] } : route;
  const meta = { title: text.fullTitle || withSiteName(text.title) };
  if (text.description) meta.description = text.description;
  if (route.kind === 'private') meta.robots = route.robots || NOINDEX;
  return meta;
}

/** The route has an Arabic version of its fixed text (so an /ar page may be indexed and linked with hreflang). */
export const hasArabicRouteText = (route) => Boolean(AR_ROUTE_TEXT[route.path]?.description || AR_ROUTE_TEXT[route.path]?.fullTitle);

export function notFoundMeta(locale = 'fr') {
  return { title: withSiteName(locale === 'ar' ? AR_NOT_FOUND_TITLE : 'Page introuvable'), robots: NOINDEX };
}

/**
 * Product page metadata. A missing product, or a hidden one (only an admin can open it), is never indexed.
 * Hidden products keep their name in the title so the admin still sees which product is open.
 */
export function productMeta(product, locale = 'fr') {
  if (!product) return { title: withSiteName(locale === 'ar' ? AR_PRODUCT_NOT_FOUND_TITLE : 'Produit introuvable'), robots: NOINDEX };
  const meta = { title: withSiteName(cleanText(product.name)) };
  const description = truncate(product.description);
  if (description) meta.description = description;
  if (product.isHidden || product.is_active === false) meta.robots = NOINDEX;
  return meta;
}

/** Collection page metadata; an unknown collection is not indexed. */
export function categoryMeta({ name, description, exists, locale = 'fr' }) {
  const meta = { title: withSiteName(cleanText(name) || (locale === 'ar' ? AR_COLLECTION_TITLE : 'Collection')) };
  if (!exists) {
    meta.robots = NOINDEX;
    return meta;
  }
  const text = truncate(description);
  if (text) meta.description = text;
  return meta;
}
