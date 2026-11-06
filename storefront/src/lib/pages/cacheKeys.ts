// Which cached pages show a given product, and the key they are stored under (shared by the cache in
// src/middleware.ts and the purge endpoint, so the two always agree).
import { productPath } from '../../../shared/urls.js';

export const cacheKeyFor = (origin: string, pathname: string) => new Request(`${origin}${pathname}`, { method: 'GET' });

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY = /^[a-z0-9-]+$/;

/**
 * Paths whose cached HTML can show a product: the product page, its collection (before and after a category change),
 * the home page, and the sitemap; French and Arabic. Values that do not look like a slug are ignored.
 */
export function pathsToPurge({ slug, category, previousCategory }: { slug?: string; category?: string; previousCategory?: string }): string[] {
  const french: string[] = ['/', '/sitemap.xml'];
  if (slug && SLUG.test(slug) && slug.length <= 255) french.push(productPath({ slug }));
  for (const name of new Set([category, previousCategory])) if (name && CATEGORY.test(name)) french.push(`/collection/${name}`);
  const arabic = french.filter((path) => path !== '/sitemap.xml').map((path) => (path === '/' ? '/ar' : `/ar${path}`));
  return [...new Set([...french, ...arabic])];
}

const TEXT_PAGES = ['/faq', '/livraison-retours', '/service-client', '/about', '/contact'];

/**
 * Every cacheable page, French and Arabic: for a change that shows on all of them (colours, announcement bar, hero).
 * Built from the sitemap data (published products and the collections that exist), so hidden products are never listed.
 */
export function pathsForSite(data: { products?: { slug?: string }[]; categories?: { slug?: string }[] }): string[] {
  const french: string[] = ['/', '/sitemap.xml', ...TEXT_PAGES];
  for (const category of data.categories ?? []) if (category?.slug && CATEGORY.test(category.slug)) french.push(`/collection/${category.slug}`);
  for (const product of data.products ?? []) if (product?.slug && SLUG.test(product.slug) && product.slug.length <= 255) french.push(productPath({ slug: product.slug }));
  const arabic = french.filter((path) => path !== '/sitemap.xml').map((path) => (path === '/' ? '/ar' : `/ar${path}`));
  return [...new Set([...french, ...arabic])];
}
