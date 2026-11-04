import { eq, and, or, desc, sql } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { reviews, storeReviews, reviewGallery, products, users } from '../models/index.js';

// Public serializers (published reviews on the home and product pages): never include the reviewer's email or user
// id. Admin screens read the full rows through their own admin-only queries.
function serializeStoreReview(row) {
  return {
    id: row.id,
    authorName: row.authorName,
    body: row.body,
    rating: row.rating,
    status: row.status,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt ?? new Date().toISOString()),
    type: 'general',
  };
}

function serializeProductReview(row) {
  return {
    id: row.id,
    productId: row.productId,
    authorName: row.authorName || 'Client',
    rating: row.rating,
    comment: row.comment,
    body: row.comment,
    status: row.status || (row.isApproved ? 'approved' : 'pending'),
    showInGeneral: Boolean(row.showInGeneral),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt ?? new Date().toISOString()),
    type: 'product',
  };
}

function buildRatingSummary(reviewsList) {
  if (!reviewsList.length) return { average: 0, count: 0 };
  const total = reviewsList.reduce((sum, r) => sum + r.rating, 0);
  return {
    average: Math.round((total / reviewsList.length) * 10) / 10,
    count: reviewsList.length,
  };
}

export const reviewRepository = {
  async getPublishedStoreReviews(tx = db) {
    const storeRows = await tx.select().from(storeReviews)
      .where(eq(storeReviews.status, 'approved'))
      .orderBy(desc(storeReviews.createdAt));

    const productRows = await tx.select().from(reviews)
      .where(and(
        or(eq(reviews.status, 'approved'), eq(reviews.isApproved, true)),
        eq(reviews.showInGeneral, true),
      ))
      .orderBy(desc(reviews.createdAt));

    const combined = [
      ...storeRows.map(serializeStoreReview),
      ...productRows.map(serializeProductReview),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const galleryRows = await tx.select().from(reviewGallery)
      .orderBy(desc(reviewGallery.createdAt));

    return {
      reviews: combined,
      summary: buildRatingSummary(combined),
      gallery: galleryRows.map((g) => ({
        id: g.id,
        src: g.imageUrl,
        alt: g.altText || '',
        createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt,
      })),
    };
  },

  async getAllStoreReviews(tx = db) {
    return tx.select().from(storeReviews).orderBy(desc(storeReviews.createdAt));
  },

  async createStoreReview({ authorName, email = '', body, rating = 5, userId = null, guestSessionId = null }, tx = db) {
    let finalAuthorName = authorName?.trim() || 'Client';
    if (userId) {
      const [userRow] = await tx.select({ fullName: users.fullName })
        .from(users).where(eq(users.id, userId));
      if (userRow?.fullName) finalAuthorName = userRow.fullName;
    }

    const [review] = await tx.insert(storeReviews).values({
      userId: userId || null,
      guestSessionId: userId ? null : (guestSessionId || null),
      authorName: finalAuthorName,
      email: email ? email.trim() : '',
      body: body.trim(),
      rating,
      status: 'pending',
    }).returning();
    return review;
  },

  async updateStoreReviewStatus(id, status, tx = db) {
    const [updated] = await tx.update(storeReviews)
      .set({ status, updatedAt: new Date() })
      .where(eq(storeReviews.id, id))
      .returning();
    return updated || null;
  },

  async deleteStoreReview(id, tx = db) {
    const [deleted] = await tx.delete(storeReviews).where(eq(storeReviews.id, id)).returning();
    return deleted || null;
  },

  async getProductReviews(productId, tx = db) {
    const [prod] = await tx.select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.isActive, true)));

    if (!prod) return null;

    const rows = await tx.select().from(reviews)
      .where(and(
        eq(reviews.productId, productId),
        or(eq(reviews.status, 'approved'), eq(reviews.isApproved, true)),
      ))
      .orderBy(desc(reviews.createdAt));

    const serialized = rows.map(serializeProductReview);

    return {
      reviews: serialized,
      summary: buildRatingSummary(serialized),
    };
  },

  async getAllProductReviews(productId, tx = db) {
    return tx.select().from(reviews).where(eq(reviews.productId, productId)).orderBy(desc(reviews.createdAt));
  },

  async createProductReview({ productId, userId = null, guestSessionId = null, email = null, authorName = 'Client', rating, comment }, tx = db) {
    let finalAuthorName = authorName?.trim() || 'Client';
    let finalEmail = email?.trim() || null;
    let finalGuestSessionId = guestSessionId || null;

    if (userId) {
      const [userRow] = await tx.select({ fullName: users.fullName })
        .from(users).where(eq(users.id, userId));
      if (userRow?.fullName) finalAuthorName = userRow.fullName;
      finalGuestSessionId = null;
      finalEmail = null;
    }

    const [review] = await tx.insert(reviews).values({
      productId,
      userId: userId || null,
      guestSessionId: finalGuestSessionId,
      email: finalEmail,
      authorName: finalAuthorName,
      rating,
      comment: comment.trim(),
      isApproved: false,
      status: 'pending',
      showInGeneral: false,
    }).returning();
    return review;
  },

  async updateProductReview(id, { status, showInGeneral }, tx = db) {
    const updateFields = { updatedAt: new Date() };
    if (status !== undefined) {
      updateFields.status = status;
      updateFields.isApproved = status === 'approved';
    }
    if (showInGeneral !== undefined) {
      updateFields.showInGeneral = !!showInGeneral;
    }

    const [updated] = await tx.update(reviews)
      .set(updateFields)
      .where(eq(reviews.id, id))
      .returning();
    return updated || null;
  },

  async deleteProductReview(id, tx = db) {
    const [deleted] = await tx.delete(reviews).where(eq(reviews.id, id)).returning();
    return deleted || null;
  }
};
