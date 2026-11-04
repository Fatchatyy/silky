// Data loading of the server-rendered pages. Each loader returns a small tagged result so the route file can pick the
// HTTP status: a missing thing is a real 404, an unreachable API a 503 (search engines retry a 503, they drop a 404),
// and a stale or odd URL a single 301 to the canonical address.
import { isCanonicalProductId, isProductSlug, productPath } from '../../../../shared/urls.js';
import { localizePath } from '../../../../shared/locales.js';
import { ApiNotFound, ApiUnavailable, getCached, getJson, getJsonOrNull } from '../serverApi';
import { normalizeProduct } from '../normalizeProduct';
import { loadTheme } from '../theme';
import type { Locale } from '../seo/types.ts';

export type Loaded<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'redirect'; to: string }
  | { kind: 'notfound' }
  | { kind: 'unavailable' };

/** Maps an API failure to a result; anything unexpected is treated as the API being unavailable. */
function failure(err: unknown): { kind: 'notfound' } | { kind: 'unavailable' } {
  if (err instanceof ApiNotFound) return { kind: 'notfound' };
  if (!(err instanceof ApiUnavailable)) console.error('[storefront] unexpected error while loading a page:', err);
  return { kind: 'unavailable' };
}

/** All published products, normalized. Kept for 30 seconds per Worker instance (crawlers read many pages in a row). */
export async function loadProducts(): Promise<any[]> {
  const list = await getCached('products', 5_000, () => getJson<any[]>('/products'));
  return (list || []).map(normalizeProduct).filter((p) => !p.isHidden);
}

export async function loadHome(): Promise<Loaded<{ products: any[]; theme: any }>> {
  try {
    const [products, theme] = await Promise.all([loadProducts(), loadTheme()]);
    return { kind: 'ok', data: { products, theme } };
  } catch (err) {
    return failure(err);
  }
}

export async function loadCollection(slug: string): Promise<Loaded<{ slug: string; name: string; products: any[] }>> {
  if (!/^[a-z0-9-]+$/.test(slug)) return { kind: 'notfound' };
  try {
    const [collection, products] = await Promise.all([getJson<any>(`/storefront/collections/${slug}`), loadProducts()]);
    return { kind: 'ok', data: { slug: collection.slug, name: collection.name, products: products.filter((p) => p.category === collection.slug) } };
  } catch (err) {
    return failure(err);
  }
}

/**
 * A product page. The URL holds the product's slug; its id (an old share link) or a different letter case is
 * answered with one 301 to `/product/<slug>` (keeping the /ar prefix), as the old server did.
 */
export async function loadProductPage(rawKey: string, locale: Locale, pathname: string) {
  const key = String(rawKey || '').toLowerCase();
  const byId = isCanonicalProductId(key);
  if (!byId && !isProductSlug(key)) return { kind: 'notfound' } as const;

  let product: any;
  try {
    product = normalizeProduct(await getJson(byId ? `/products/${key}` : `/products/by-slug/${key}`));
  } catch (err) {
    return failure(err);
  }
  if (!product || product.isHidden) return { kind: 'notfound' } as const;

  const canonicalPath = localizePath(productPath(product), locale);
  if (pathname.replace(/\/+$/, '') !== canonicalPath) return { kind: 'redirect', to: canonicalPath } as const;

  // Side data: a failure only removes the part it feeds (rating, delivery fee, collection name, other products).
  const [reviews, settings, collection, products] = await Promise.all([
    getJsonOrNull<any>(`/products/${product.id}/reviews`).catch(() => null),
    getJsonOrNull<any>('/storefront/settings').catch(() => null),
    product.category ? getJsonOrNull<any>(`/storefront/collections/${product.category}`).catch(() => null) : null,
    loadProducts().catch(() => []),
  ]);
  return {
    kind: 'ok',
    data: {
      product,
      reviews: reviews?.reviews ?? null,
      rating: reviews?.summary ?? null,
      deliveryFee: typeof settings?.deliveryFee === 'number' ? settings.deliveryFee : null,
      collectionName: collection?.name ?? null,
      recommendations: products.filter((p: any) => p.category === product.category && p.id !== product.id).slice(0, 4),
    },
  } as const;
}

export async function loadSitemapEntries() {
  return getJson<{ products: { slug: string; updatedAt: string; hasArabic: boolean }[]; categories: { slug: string }[] }>('/storefront/sitemap-entries');
}
