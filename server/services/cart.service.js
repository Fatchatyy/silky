import { cartRepository } from '../repositories/cart.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { themeRepository } from '../repositories/theme.repository.js';
import { runInTransaction } from '../repositories/transaction.repository.js';
import { AppError } from '../utils/errors.js';

function buildDetails(colorName, size) {
  const parts = [];
  if (colorName) parts.push(colorName);
  if (size) parts.push(`Taille ${size}`);
  return parts.join(' · ') || 'Standard';
}

function serializeCartItem(row) {
  const price = Number(row.price) - Number(row.discountAmount || 0);
  const quantity = row.quantity;

  return {
    id: row.id,
    variantId: row.variantId,
    productId: row.productId,
    name: row.productTitle,
    nameAr: row.productTitleAr || null,
    price,
    quantity,
    image: row.colorImageUrl || row.collectionImageUrl || '',
    colorId: row.colorSlug,
    colorName: row.colorName,
    size: row.size,
    details: buildDetails(row.colorName, row.size),
    lineTotal: price * quantity,
  };
}

async function buildCartResponse(cartId, tx) {
  const rawItems = await cartRepository.getCartItems(cartId, tx);
  const items = rawItems.filter(r => r.isActive).map(serializeCartItem);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryFee = items.length ? await themeRepository.getDeliveryFee(tx) : 0;
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: cartId,
    items,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    itemCount,
  };
}

async function resolveVariantId(payload, tx) {
  if (payload.variantId) {
    const variant = await productRepository.findVariantById(payload.variantId, tx);
    if (!variant) {
      throw new AppError("Cette variante n'est plus disponible.", 404);
    }
    return variant.id;
  }

  const { productId, colorId, size } = payload;
  if (!productId || !colorId || !size) {
    throw new AppError('Veuillez sélectionner une couleur et une taille.', 400);
  }

  const variant = await productRepository.findVariantForOrderItem(productId, colorId, size, tx);
  if (!variant) {
    throw new AppError("Cette variante n'est plus disponible.", 404);
  }
  return variant.id;
}

export async function getCart(shopper) {
  const cart = await cartRepository.findOrCreateCart(shopper);
  return buildCartResponse(cart.id);
}

export async function addCartItem(shopper, payload) {
  return runInTransaction(async (tx) => {
    const cart = await cartRepository.findOrCreateCart(shopper, tx);
    const variantId = await resolveVariantId(payload, tx);
    const quantity = Math.max(1, Number(payload.quantity) || 1);

    const variant = await productRepository.findVariantById(variantId, tx);
    if (!variant) {
      throw new AppError("Cette variante n'est plus disponible.", 404);
    }

    const product = await productRepository.findById(variant.productId, tx);
    if (!product || !product.is_active) {
      throw new AppError("Cette variante n'est plus disponible.", 404);
    }

    const currentItems = await cartRepository.getCartItems(cart.id, tx);
    const existing = currentItems.find(i => i.variantId === variantId);
    const nextQuantity = (existing?.quantity || 0) + quantity;

    if (nextQuantity > variant.stockQuantity) {
      throw new AppError(
        `${product.name}: stock insuffisant (${variant.stockQuantity} disponible(s))`,
        400
      );
    }

    if (existing) {
      await cartRepository.updateItemQuantity(existing.id, nextQuantity, tx);
    } else {
      await cartRepository.addItem(cart.id, variantId, quantity, tx);
    }

    return buildCartResponse(cart.id, tx);
  });
}

export async function removeCartItem(shopper, cartItemId) {
  return runInTransaction(async (tx) => {
    const cart = await cartRepository.findOrCreateCart(shopper, tx);
    const deleted = await cartRepository.removeItem(cart.id, cartItemId, tx);

    if (!deleted) {
      throw new AppError('Cart item not found', 404);
    }

    return buildCartResponse(cart.id, tx);
  });
}

export async function getCartItemsForCheckout(shopper, tx) {
  const cart = await cartRepository.findOrCreateCart(shopper, tx);
  const rawItems = await cartRepository.getCartItems(cart.id, tx);
  const items = rawItems.filter(r => r.isActive).map(serializeCartItem);
  return { cartId: cart.id, items };
}

export async function clearCart(cartId, tx) {
  await cartRepository.clearCart(cartId, tx);
}
