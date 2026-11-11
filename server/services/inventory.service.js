import { eq, desc } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { products, productVariants, categories } from '../models/index.js';
import { productRepository } from '../repositories/product.repository.js';
import { AppError } from '../utils/errors.js';

const LOW_STOCK_THRESHOLD = 5;

export async function getInventory() {
  const rows = await db.select({
    variantId: productVariants.id,
    productId: products.id,
    productTitle: products.title,
    productIsActive: products.isActive,
    size: productVariants.size,
    colorSlug: productVariants.colorSlug,
    colorName: productVariants.colorName,
    sku: productVariants.sku,
    stockQuantity: productVariants.stockQuantity,
    colorImageUrl: productVariants.colorImageUrl,
    categoryName: categories.name,
    categorySlug: categories.slug,
  })
  .from(productVariants)
  .innerJoin(products, eq(productVariants.productId, products.id))
  .leftJoin(categories, eq(products.categoryId, categories.id));

  const result = rows.map((row) => ({
    variantId: row.variantId,
    productId: row.productId,
    productTitle: row.productTitle,
    productIsHidden: row.productIsActive === false,
    size: row.size,
    colorSlug: row.colorSlug,
    colorName: row.colorName,
    sku: row.sku,
    stockQuantity: row.stockQuantity,
    colorImageUrl: row.colorImageUrl,
    categoryName: row.categoryName || '',
    categorySlug: row.categorySlug || '',
    lowStock: row.stockQuantity <= LOW_STOCK_THRESHOLD,
  }));

  result.sort((a, b) => {
    if (a.lowStock !== b.lowStock) return a.lowStock ? -1 : 1;
    if (a.productTitle !== b.productTitle) return a.productTitle.localeCompare(b.productTitle);
    if (a.colorName !== b.colorName) return a.colorName.localeCompare(b.colorName);
    return a.size.localeCompare(b.size);
  });

  return result;
}

export async function updateVariantStock(variantId, stockQuantity) {
  const quantity = parseInt(stockQuantity, 10);
  if (isNaN(quantity) || quantity < 0) {
    throw new AppError('La quantité de stock doit être un nombre positif', 400);
  }

  const variant = await productRepository.findVariantById(variantId);
  if (!variant) {
    throw new AppError('Variant non trouvé', 404);
  }

  const updated = await productRepository.updateVariantStock(variantId, quantity);
  const product = await productRepository.findById(variant.productId);

  return {
    variantId: updated.id,
    productId: product.id,
    productTitle: product ? product.name : '',
    size: updated.size,
    colorSlug: updated.colorSlug,
    colorName: updated.colorName,
    sku: updated.sku,
    stockQuantity: updated.stockQuantity,
    colorImageUrl: updated.colorImageUrl,
    lowStock: updated.stockQuantity <= LOW_STOCK_THRESHOLD,
  };
}
