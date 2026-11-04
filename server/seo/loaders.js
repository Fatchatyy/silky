// Database access of the server-written pages. Every loader reads only what the public API already exposes.
import { productRepository } from '../repositories/product.repository.js';
import * as productService from '../services/product.service.js';
import * as reviewService from '../services/review.service.js';
import { themeRepository } from '../repositories/theme.repository.js';
import { AppError } from '../utils/errors.js';

const isNotFound = (err) => err instanceof AppError && err.status === 404;

export const databaseLoaders = {
  /** The product as the API returns it, or null when it does not exist or is unpublished (same rule as the API). */
  async getProduct(id) {
    try {
      const product = await productService.getProductById(id);
      return product.is_active === false ? null : product;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  /** Same as getProduct, found by the slug used in the product's URL. */
  async getProductBySlug(slug) {
    try {
      const product = await productService.getProductBySlug(slug);
      return product.is_active === false ? null : product;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  /** Approved-review summary of an active product ({ average, count }), the numbers the product page shows. */
  async getRating(id) {
    try {
      return (await reviewService.getProductReviews(id)).summary;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  async getCategory(slug) {
    const category = await productRepository.findCategoryBySlug(slug);
    return category ? { slug: category.slug, name: category.name } : null;
  },

  /** The delivery fee customers are charged (site_settings.delivery_fee), in TND. */
  async getDeliveryFee() {
    return themeRepository.getDeliveryFee();
  },

  /** Published products as light summaries (one query), optionally of one category. */
  async getProductSummaries(options) {
    return productRepository.listPublishedProductSummaries(options);
  },

  /** Active products (id, updatedAt) and the slugs of categories holding at least one of them. */
  async listSitemapData() {
    const [products, categories] = await Promise.all([
      productRepository.listPublishedProductStamps(),
      productRepository.listCategorySlugsWithPublishedProducts(),
    ]);
    return {
      products: products.map(({ titleAr, ...rest }) => ({ ...rest, nameAr: titleAr })),
      categories,
    };
  },
};
