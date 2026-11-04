import * as reviewService from '../services/review.service.js';
import { sendError } from '../utils/errors.js';

export async function listPublished(_req, res) {
  try {
    const data = await reviewService.getPublishedStoreReviews();
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
}

export async function submit(req, res) {
  if (req.user?.role === 'admin') {
    return res.status(403).json({ error: 'Les administrateurs ne peuvent pas soumettre d\'avis.' });
  }

  // The route requires a logged-in customer: the author is always the account (name from the account, never typed).
  const { body, rating } = req.body;
  const finalAuthorName = req.user.fullName || req.body.authorName;
  if (typeof finalAuthorName !== 'string' || typeof body !== 'string' || !finalAuthorName.trim() || !body.trim()) {
    return res.status(400).json({ error: "Le nom et l'avis sont requis" });
  }

  try {
    const result = await reviewService.createStoreReview({
      authorName: finalAuthorName,
      email: req.user.email || '',
      body,
      rating: rating || 5,
      userId: req.user.id,
      guestSessionId: null,
    });
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function listAll(_req, res) {
  try {
    const reviews = await reviewService.getAllStoreReviews();
    res.json(reviews);
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateStatus(req, res) {
  const { status } = req.body;

  try {
    const review = await reviewService.updateStoreReviewStatus(req.params.id, status);
    res.json(review);
  } catch (err) {
    sendError(res, err);
  }
}

export async function remove(req, res) {
  try {
    await reviewService.deleteStoreReview(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
