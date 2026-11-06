// Read-only data for the public storefront (the Astro app). Published products only; nothing here exposes a hidden
// product, a private field or anything an admin screen would show.
import { productRepository } from '../repositories/product.repository.js';
import { themeRepository } from '../repositories/theme.repository.js';
import { reviewRepository } from '../repositories/review.repository.js';
import { snapshotFingerprint } from './catalogue.fingerprint.js';
import { AppError } from '../utils/errors.js';

const CATEGORY_SLUG = /^[a-z0-9-]+$/;
const LIST_LIMIT = 200;

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

/** Published products as light summaries (name, Arabic name, price, discount, category), newest first. */
export async function getHome() {
  return { products: await productRepository.listPublishedProductSummaries({ limit: LIST_LIMIT }) };
}

/** A category and its published products, or a 404 when the category does not exist. */
export async function getCollection(slug) {
  const category = CATEGORY_SLUG.test(String(slug ?? '')) ? await productRepository.findCategoryBySlug(slug) : null;
  if (!category) throw new AppError('Collection non trouvée', 404);
  const products = await productRepository.listPublishedProductSummaries({ categorySlug: category.slug, limit: LIST_LIMIT });
  return { slug: category.slug, name: category.name, products };
}

/** Settings pages need that are not part of a product: the delivery fee customers are charged, in TND. */
export async function getSettings() {
  return { deliveryFee: await themeRepository.getDeliveryFee() };
}

/**
 * What the sitemap lists: published products (slug, last change, whether the Arabic page is a real translation: both
 * the Arabic name and description exist) and the categories that hold at least one published product.
 */
export async function getSitemapEntries() {
  const [stamps, categories] = await Promise.all([
    productRepository.listPublishedProductStamps(),
    productRepository.listCategorySlugsWithPublishedProducts(),
  ]);
  return {
    products: stamps.map((product) => ({
      slug: product.slug,
      updatedAt: product.updatedAt,
      hasArabic: hasText(product.titleAr) && hasText(product.descriptionAr),
    })),
    categories: categories.map((category) => ({ slug: category.slug })),
  };
}

/**
 * Everything the static build needs, in ONE response (SPIKE): the same data the separate endpoints give, taken in one pass so
 * every page and the sitemap come from the same moment. Published products only; a hidden product is in none of the parts.
 *  - products: the full product (what /api/products/by-slug returns) plus updatedAt and hasArabic
 *  - summaries: the light card summaries, exactly as /api/storefront/home returns them
 *  - categories: slug + name of the categories that hold a published product
 *  - reviews: { [productId]: { reviews, summary } } approved reviews
 *  - theme, settings: /api/theme and /api/storefront/settings
 */
export async function getSnapshot() {
  const [fullProducts, stamps, summaries, categories, reviews, theme, deliveryFee] = await Promise.all([
    productRepository.findAll({ includeHidden: false }),
    productRepository.listPublishedProductStamps(),
    productRepository.listPublishedProductSummaries({ limit: 'all' }),
    productRepository.listCategoriesWithPublishedProducts(),
    reviewRepository.getApprovedReviewsForPublishedProducts(),
    themeRepository.getSettings(),
    themeRepository.getDeliveryFee(),
  ]);
  const stampById = new Map(stamps.map((stamp) => [stamp.id, stamp]));
  const snapshot = {
    generatedAt: new Date().toISOString(),
    products: fullProducts.map((product) => {
      const stamp = stampById.get(product.id);
      return { ...product, updatedAt: stamp?.updatedAt ?? null, hasArabic: hasText(product.nameAr) && hasText(product.descriptionAr) };
    }),
    summaries,
    categories,
    reviews,
    theme,
    settings: { deliveryFee },
  };
  // What a rebuild would change: lets the admin tell whether the live site is behind, and the publish trigger whether to fire (services/publish.service.js).
  return { ...snapshot, fingerprint: snapshotFingerprint(snapshot) };
}
