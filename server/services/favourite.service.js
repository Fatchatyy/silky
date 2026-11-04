import { and, eq } from 'drizzle-orm';
import { favouriteRepository } from '../repositories/favourite.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { runInTransaction } from '../repositories/transaction.repository.js';
import { productVariants } from '../models/index.js';
import { AppError } from '../utils/errors.js';

export async function getFavourites(shopper) {
  const favouritesList = await favouriteRepository.findByShopper(shopper);
  const productIds = Array.from(new Set(favouritesList.map((f) => f.productId)));
  return {
    productIds,
    favourites: favouritesList,
    items: favouritesList,
  };
}

async function resolveCanonicalVariant(productId, variantId, colorId, size, tx) {
  // 1. If canonical variantId is provided, verify it and check product ownership
  if (variantId) {
    const variant = await productRepository.findVariantById(variantId, tx);
    if (!variant) {
      throw new AppError("Cette variante n'est plus disponible.", 404);
    }
    if (productId && variant.productId !== productId) {
      throw new AppError('La variante ne correspond pas au produit spécifié', 400);
    }
    return variant;
  }

  // 2. If productId + colorId + size provided, resolve using exact Cart logic
  if (productId && colorId && size) {
    const variant = await productRepository.findVariantForOrderItem(productId, colorId, size, tx);
    if (!variant) {
      throw new AppError("Cette variante n'est plus disponible.", 404);
    }
    return variant;
  }

  // 3. If productId + colorId provided, resolve first variant matching the color
  if (productId && colorId) {
    const [variant] = await tx
      .select()
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, productId),
          eq(productVariants.colorSlug, colorId)
        )
      )
      .limit(1);
    if (variant) {
      return variant;
    }
  }

  return null;
}

export async function toggleFavourite(shopper, payload) {
  const data = typeof payload === 'string' ? { productId: payload } : (payload || {});
  let { productId, variantId, colorId, size, favoriteId } = data;

  if (!productId && !variantId && !favoriteId) {
    throw new AppError('Identifiant du produit requis.', 400);
  }

  return runInTransaction(async (tx) => {
    // 1. Resolve canonical variant
    const resolvedVariant = await resolveCanonicalVariant(productId, variantId, colorId, size, tx);
    const finalVariantId = resolvedVariant ? resolvedVariant.id : (variantId || null);

    if (resolvedVariant && !productId) {
      productId = resolvedVariant.productId;
    }

    // 2. Verify product exists & is active
    if (productId) {
      const product = await productRepository.findById(productId, tx);
      if (!product || !product.is_active) {
        throw new AppError('Produit non trouvé', 404);
      }
    }

    // 3. Check existence for this shopper + variant
    const exists = await favouriteRepository.exists(
      shopper,
      { productId, variantId: finalVariantId, favoriteId },
      tx
    );

    let isFavourite = false;

    if (exists) {
      await favouriteRepository.remove(
        shopper,
        { productId, variantId: finalVariantId, favoriteId },
        tx
      );
      isFavourite = false;
    } else {
      if (!productId && resolvedVariant) {
        productId = resolvedVariant.productId;
      }
      await favouriteRepository.add(
        shopper,
        { productId, variantId: finalVariantId },
        tx
      );
      isFavourite = true;
    }

    const updatedFavourites = await favouriteRepository.findByShopper(shopper, tx);
    const productIds = Array.from(new Set(updatedFavourites.map((f) => f.productId)));

    return {
      productId,
      variantId: finalVariantId,
      isFavourite,
      productIds,
      favourites: updatedFavourites,
      items: updatedFavourites,
    };
  });
}
