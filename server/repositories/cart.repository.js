import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { carts, cartItems, productVariants, products, productImages } from '../models/index.js';

export const cartRepository = {
  async findCartByUserId(userId, tx = db) {
    if (!userId) return null;
    const [cart] = await tx.select().from(carts).where(eq(carts.userId, userId));
    return cart || null;
  },

  async findCartByGuestSessionId(guestSessionId, tx = db) {
    if (!guestSessionId) return null;
    const [cart] = await tx.select().from(carts).where(eq(carts.guestSessionId, guestSessionId));
    return cart || null;
  },

  async findOrCreateCart({ userId = null, guestSessionId = null }, tx = db) {
    if (userId) {
      let cart = await this.findCartByUserId(userId, tx);
      if (!cart) {
        const [newCart] = await tx.insert(carts).values({ userId }).returning();
        cart = newCart;
      }
      return cart;
    }
    if (guestSessionId) {
      let cart = await this.findCartByGuestSessionId(guestSessionId, tx);
      if (!cart) {
        const [newCart] = await tx.insert(carts).values({ guestSessionId }).returning();
        cart = newCart;
      }
      return cart;
    }
    throw new Error('Neither userId nor guestSessionId provided');
  },

  async getCartItems(cartId, tx = db) {
    if (!cartId) return [];
    const rows = await tx.select({
      id: cartItems.id,
      cartId: cartItems.cartId,
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      createdAt: cartItems.createdAt,
      updatedAt: cartItems.updatedAt,
      size: productVariants.size,
      colorSlug: productVariants.colorSlug,
      colorName: productVariants.colorName,
      colorImageUrl: productVariants.colorImageUrl,
      stockQuantity: productVariants.stockQuantity,
      sku: productVariants.sku,
      productId: products.id,
      productTitle: products.title,
      productTitleAr: products.titleAr,
      productSlug: products.slug,
      price: products.price,
      discountAmount: products.discountAmount,
      isFeatured: products.isFeatured,
      isActive: products.isActive,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(cartItems.cartId, cartId));

    return rows;
  },

  async addItem(cartId, variantId, quantity, tx = db) {
    const [item] = await tx.insert(cartItems).values({
      cartId,
      variantId,
      quantity,
    })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.variantId],
      set: {
        quantity: sql`${cartItems.quantity} + ${quantity}`,
        updatedAt: new Date(),
      },
    })
    .returning();
    return item;
  },

  async updateItemQuantity(cartItemId, quantity, tx = db) {
    const [updated] = await tx.update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, cartItemId))
      .returning();
    return updated || null;
  },

  async removeItem(cartId, cartItemId, tx = db) {
    const [deleted] = await tx.delete(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.id, cartItemId)))
      .returning();
    return deleted || null;
  },

  async clearCart(cartId, tx = db) {
    if (!cartId) return;
    await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
  },

  async deleteCart(cartId, tx = db) {
    if (!cartId) return;
    await tx.delete(carts).where(eq(carts.id, cartId));
  },

  async updateCartUserId(cartId, userId, tx = db) {
    const [updated] = await tx.update(carts)
      .set({ userId, guestSessionId: null, updatedAt: new Date() })
      .where(eq(carts.id, cartId))
      .returning();
    return updated || null;
  },

  async mergeGuestItemsIntoUserCart(guestCartId, userCartId, tx = db) {
    await tx.execute(sql`
      INSERT INTO cart_items (cart_id, variant_id, quantity)
      SELECT ${userCartId}, variant_id, quantity
      FROM cart_items
      WHERE cart_id = ${guestCartId}
      ON CONFLICT (cart_id, variant_id) DO UPDATE SET
        quantity = GREATEST(cart_items.quantity, EXCLUDED.quantity),
        updated_at = NOW()
    `);
  }
};
