// Decides, for a request path, the HTTP status, redirect and head content of a storefront page. The route list and
// all metadata come from src/seo (shared with the browser); data comes from injected loaders, so this module has
// no database or Express dependency.
//
// loaders: {
//   getProduct(id)   -> product (as the API returns it) or null when missing OR unpublished
//   getProductBySlug(slug) -> same, found by the slug used in the product's URL
//   getRating(id)    -> { average, count } of approved reviews, or null
//   getCategory(slug)-> { slug, name } or null
//   getDeliveryFee() -> the fee customers are charged, in TND (optional; the shared default is used without it)
// }
import { buildBreadcrumbJsonLd, buildFaqJsonLd, buildOrganizationJsonLd, buildProductJsonLd } from '../../src/seo/jsonld.js';
import { faqEntries } from '../../shared/textPages.js';
import { collectionMeta, isNamedCollection, localizedCollectionMeta } from '../../src/seo/collections.js';
import { ARABIC_ENABLED, localizePath, splitLocale } from '../../shared/locales.js';
import { categoryMeta, hasArabicRouteText, notFoundMeta, productMeta, routeMeta } from '../../src/seo/meta.js';
import { matchRoute } from '../../src/seo/routes.js';
import { hasArabicProduct, localizedProductView } from '../../shared/productText.js';
import { imageVariantPath } from '../../shared/imageVariants.js';
import { renderCollectionBody, renderHomeBody, renderProductBody, renderTextPageBody } from './renderBody.js';
import { categoryPath, isCanonicalProductId, isProductSlug, productPath, publicImagePath } from '../../shared/urls.js';

const CATEGORY_SLUG = /^[a-z0-9-]+$/;

/** The path a public route is served at: fixed segments as written in the route list, parameters as requested. */
function canonicalPathOf(route, params) {
  const path = route.path
    .split('/')
    .filter(Boolean)
    .map((part) => {
      if (!part.startsWith(':')) return part;
      return params[part.slice(1)];
    })
    .join('/');
  return `/${path}`;
}

const notFound = (meta) => ({ status: 404, page: { meta } });

// Product summaries for the plain-text lists; a failure only removes the list, never the page.
// The delivery fee written in the product data follows what customers are actually charged; any failure falls back to
// the shared default (the amount the delivery page states).
async function deliveryFeeOf(loaders) {
  if (typeof loaders.getDeliveryFee !== 'function') return null;
  try {
    const fee = Number(await loaders.getDeliveryFee());
    return Number.isFinite(fee) && fee >= 0 ? fee : null;
  } catch {
    return null;
  }
}

async function summariesOf(loaders, options) {
  if (typeof loaders.getProductSummaries !== 'function') return [];
  try {
    return (await loaders.getProductSummaries(options)) || [];
  } catch {
    return [];
  }
}

// hreflang links between the French page and its Arabic twin (only for pages that exist in both languages).
const alternatesFor = (frPath) =>
  ARABIC_ENABLED
    ? [
        { hreflang: 'fr', path: frPath },
        { hreflang: 'ar', path: localizePath(frPath, 'ar') },
        { hreflang: 'x-default', path: frPath },
      ]
    : [];
const noindexed = (meta) => ({ ...meta, robots: 'noindex' });

async function resolveProduct(key, pathname, siteUrl, loaders, locale) {
  // The URL holds the product's slug; its id is accepted too (links written before slugs were public) and redirected.
  const wanted = String(key ?? '').toLowerCase();
  const byId = isCanonicalProductId(wanted);
  if (!byId && !isProductSlug(wanted)) return notFound(productMeta(null, locale));
  const product = byId
    ? await loaders.getProduct(wanted)
    : typeof loaders.getProductBySlug === 'function'
      ? await loaders.getProductBySlug(wanted)
      : null;
  if (!product) return notFound(productMeta(null, locale));

  // One permanent redirect to the canonical address: slug instead of id, lowercase, no trailing slash.
  const canonicalPath = localizePath(productPath(product), locale);
  if (pathname !== canonicalPath) return { status: 301, redirect: canonicalPath };
  const id = product.id;

  // The Arabic page is a real translation only when the admin wrote both the Arabic name and description. Otherwise it
  // still works for shoppers (French text shown) but is not indexed and not linked with hreflang (it would be a
  // duplicate of the French page at another URL).
  const arabicIndexable = hasArabicProduct(product);
  if (locale === 'ar' && !arabicIndexable) {
    return { status: 200, page: { meta: noindexed(productMeta(localizedProductView(product, 'ar'), 'ar')) } };
  }

  const view = localizedProductView(product, locale);
  const rating = await loaders.getRating(id);
  const deliveryFee = await deliveryFeeOf(loaders);
  const slug = product.category;
  let collectionName = null;
  if (slug) {
    collectionName = isNamedCollection(slug)
      ? localizedCollectionMeta(slug, locale).title
      : (await loaders.getCategory(slug))?.name || slug;
  }

  const breadcrumb = [
    { name: locale === 'ar' ? 'الرئيسية' : 'Accueil', path: localizePath('/', locale) },
    ...(collectionName ? [{ name: collectionName, path: localizePath(categoryPath(slug), locale) }] : []),
    { name: view.name, path: localizePath(productPath(product), locale) },
  ];
  const ownImage = [product.mainImage, ...(product.thumbnails || [])].map(publicImagePath).find(Boolean);
  const imagePath = ownImage ? imageVariantPath(ownImage, 'share') : null;

  return {
    status: 200,
    page: {
      meta: productMeta(view, locale),
      canonicalPath,
      alternates: arabicIndexable ? alternatesFor(productPath(product)) : [],
      ogType: 'product',
      imagePath,
      jsonLd: [
        buildProductJsonLd(view, { siteUrl, rating, locale, deliveryFee }),
        buildBreadcrumbJsonLd(breadcrumb, { siteUrl }),
      ],
      bodyHtml: renderProductBody(product, locale),
    },
  };
}

async function resolveCategory(slug, siteUrl, loaders, locale) {
  const category = CATEGORY_SLUG.test(String(slug)) ? await loaders.getCategory(slug) : null;
  if (!category) return notFound(categoryMeta({ name: localizedCollectionMeta(slug, locale).title, exists: false, locale }));

  const display = localizedCollectionMeta(category.slug, locale);
  const meta = categoryMeta({ name: display.title, description: display.heroText, exists: true, locale });
  // Only the named collections have an Arabic title and text; any other category stays out of the Arabic index.
  const hasArabic = isNamedCollection(category.slug);
  if (locale === 'ar' && !hasArabic) return { status: 200, page: { meta: noindexed(meta) } };

  return {
    status: 200,
    page: {
      meta,
      canonicalPath: localizePath(categoryPath(category.slug), locale),
      alternates: hasArabic ? alternatesFor(categoryPath(category.slug)) : [],
      bodyHtml: renderCollectionBody(category.slug, await summariesOf(loaders, { categorySlug: category.slug, limit: 200 }), locale),
      jsonLd: [
        buildBreadcrumbJsonLd(
          [
            { name: locale === 'ar' ? 'الرئيسية' : 'Accueil', path: localizePath('/', locale) },
            { name: display.title, path: localizePath(categoryPath(category.slug), locale) },
          ],
          { siteUrl },
        ),
      ],
    },
  };
}

/**
 * Returns { status, redirect?, page }. `redirect` is a path (no query string) for a permanent redirect to the
 * canonical form: trailing slash, letter case of fixed segments, uppercase product ids.
 * page = { meta, canonicalPath?, ogType?, imagePath?, jsonLd? } as expected by renderHead.
 */
export async function resolvePage(pathname, { siteUrl, loaders }) {
  const { locale, path } = splitLocale(pathname);
  const match = matchRoute(path);
  // The admin exists in French only.
  if (!match || (locale === 'ar' && match.route.path.startsWith('/admin'))) return notFound(notFoundMeta(locale));

  const { route, params } = match;
  const isPublic = route.kind === 'page' || route.kind === 'product' || route.kind === 'category';

  // Pages and collections are redirected to their canonical form here; a product's canonical address depends on its
  // slug, so resolveProduct decides it once the product is loaded (one redirect, never a chain).
  if (isPublic && route.kind !== 'product') {
    const expected = localizePath(canonicalPathOf(route, params), locale);
    if (expected !== pathname) return { status: 301, redirect: expected };
  }

  switch (route.kind) {
    case 'page': {
      const meta = routeMeta(route, locale);
      const hasArabic = hasArabicRouteText(route);
      if (locale === 'ar' && !hasArabic) return { status: 200, page: { meta: noindexed(meta) } };
      return {
        status: 200,
        page: {
          meta,
          canonicalPath: localizePath(route.path, locale),
          alternates: hasArabic ? alternatesFor(route.path) : [],
          jsonLd: [
            route.path === '/' ? buildOrganizationJsonLd({ siteUrl }) : null,
            route.path === '/faq' ? buildFaqJsonLd(faqEntries(locale), { siteUrl }) : null,
          ],
          bodyHtml: route.path === '/' ? renderHomeBody(await summariesOf(loaders, { limit: 200 }), locale) : renderTextPageBody(route.path, locale),
        },
      };
    }
    case 'private':
      return { status: 200, page: { meta: routeMeta(route, locale) } };
    case 'product':
      return resolveProduct(params.slug, pathname, siteUrl, loaders, locale);
    case 'category':
      return resolveCategory(params.category, siteUrl, loaders, locale);
    default:
      return notFound(notFoundMeta(locale));
  }
}
