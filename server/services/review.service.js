import { reviewRepository } from '../repositories/review.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import * as notificationService from './notification.service.js';
import { AppError } from '../utils/errors.js';

const MAX_REVIEW_LENGTH = 3000;

export async function getPublishedStoreReviews() {
  return reviewRepository.getPublishedStoreReviews();
}

export async function getAllStoreReviews() {
  return reviewRepository.getAllStoreReviews();
}

export async function createStoreReview({ authorName, email, body, rating, userId = null, guestSessionId = null }) {
  if (!authorName?.trim() || !body?.trim()) {
    throw new AppError('Le nom et l\'avis sont requis', 400);
  }
  if (body.trim().length > MAX_REVIEW_LENGTH) {
    throw new AppError(`L'avis ne doit pas dépasser ${MAX_REVIEW_LENGTH} caractères`, 400);
  }
  const ratingNum = parseInt(rating, 10);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    throw new AppError('La note doit être entre 1 et 5', 400);
  }

  const review = await reviewRepository.createStoreReview({
    authorName: authorName.trim(),
    email: email?.trim() || '',
    body: body.trim(),
    rating: ratingNum,
    userId,
    guestSessionId,
  });
  await notificationService.createReviewNotification(review);
  return { message: 'Review submitted for approval', id: review.id };
}

export async function updateStoreReviewStatus(id, status) {
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    throw new AppError('Statut invalide', 400);
  }

  const updated = await reviewRepository.updateStoreReviewStatus(id, status);
  if (!updated) {
    throw new AppError('Avis non trouvé', 404);
  }
  return updated;
}

export async function deleteStoreReview(id) {
  const deleted = await reviewRepository.deleteStoreReview(id);
  if (!deleted) {
    throw new AppError('Avis non trouvé', 404);
  }
  return deleted;
}

export async function getProductReviews(productId) {
  const result = await reviewRepository.getProductReviews(productId);
  if (result === null) throw new AppError('Produit non trouvé', 404);
  return result;
}

export async function getAllProductReviews(productId) {
  return reviewRepository.getAllProductReviews(productId);
}

export async function createProductReview({ productId, userId = null, guestSessionId = null, email = null, authorName, rating, comment }) {
  if (!comment?.trim()) {
    throw new AppError('Le commentaire est requis', 400);
  }
  if (comment.trim().length > MAX_REVIEW_LENGTH) {
    throw new AppError(`Le commentaire ne doit pas dépasser ${MAX_REVIEW_LENGTH} caractères`, 400);
  }
  const ratingNum = parseInt(rating, 10);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    throw new AppError('La note doit être entre 1 et 5', 400);
  }

  const product = await productRepository.findById(productId);
  if (!product || !product.is_active) {
    throw new AppError('Produit non trouvé', 404);
  }

  const review = await reviewRepository.createProductReview({
    productId,
    userId,
    guestSessionId,
    email,
    authorName: authorName?.trim() || 'Client',
    rating: ratingNum,
    comment: comment.trim(),
  });

  await notificationService.createProductReviewNotification(review, productId);
  return review;
}

export async function updateProductReview(id, { status, showInGeneral }) {
  const updated = await reviewRepository.updateProductReview(id, { status, showInGeneral });
  if (!updated) {
    throw new AppError('Avis non trouvé', 404);
  }
  return updated;
}

export async function deleteProductReview(id) {
  const deleted = await reviewRepository.deleteProductReview(id);
  if (!deleted) {
    throw new AppError('Avis non trouvé', 404);
  }
  return deleted;
}
