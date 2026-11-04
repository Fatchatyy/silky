// Read-only data for the public storefront (the Astro app). Published products only; nothing here exposes a hidden
// product, a private field or anything an admin screen would show.
import { productRepository } from '../repositories/product.repository.js';
import { themeRepository } from '../repositories/theme.repository.js';
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
