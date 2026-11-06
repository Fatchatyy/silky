import * as productService from '../services/product.service.js';
import * as reviewService from '../services/review.service.js';
import { AppError, sendError } from '../utils/errors.js';

export async function list(req, res) {
  try {
    const { category, search, page, limit, includeHidden } = req.query;
    // Hidden (unpublished) products are admin-only; for everyone else the flag is ignored.
    const shouldIncludeHidden =
      req.user?.role === 'admin' && (includeHidden === 'true' || includeHidden === true);
    const hasFilters = category || search || page || limit;

    if (!hasFilters) {
      const products = await productService.getAllProducts({ includeHidden: shouldIncludeHidden });
      return res.json(products);
    }

    const result = await productService.listProducts({
      category,
      search,
      page,
      limit,
      includeHidden: shouldIncludeHidden,
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Image file required' });
  res.json({ url: `/uploads/${req.file.filename}` });
}

// The editors report the photos they uploaded in this session; the ones nothing uses are deleted (never a used one).
export async function discardUploads(req, res) {
  try {
    res.json(await productService.discardUnusedUploads(req.body?.urls));
  } catch (err) {
    sendError(res, err);
  }
}

// 404 (not 403) so a hidden product's existence is not confirmed to non-admins.
function serveVisibleProduct(load) {
  return async (req, res) => {
    try {
      const product = await load(req);
      if (product.is_active === false && req.user?.role !== 'admin') {
        throw new AppError('Produit non trouvé', 404);
      }
      res.json(product);
    } catch (err) {
      sendError(res, err);
    }
  };
}

export const getById = serveVisibleProduct((req) => productService.getProductById(req.params.id));
export const getBySlug = serveVisibleProduct((req) => productService.getProductBySlug(req.params.slug));

export async function create(req, res) {
  const { name, title } = req.body;
  const hasText = (value) => typeof value === 'string' && value.trim() !== '';
  if (!hasText(name) && !hasText(title)) {
    return res.status(400).json({ error: 'Product name is required' });
  }

  try {
    const product = await productService.createProduct({
      ...req.body,
      title: title || name,
    });
    res.status(201).json(product);
  } catch (err) {
    sendError(res, err);
  }
}

export async function update(req, res) {
  try {
    const product = await productService.updateProduct(req.params.id, req.body);
    res.json(product);
  } catch (err) {
    sendError(res, err);
  }
}

export async function remove(req, res) {
  try {
    await productService.deleteProduct(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}

export async function listReviews(req, res) {
  try {
    const data = await reviewService.getProductReviews(req.params.id);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
}

export async function createReview(req, res) {
  if (req.user?.role === 'admin') {
    return res.status(403).json({ error: 'Les administrateurs ne peuvent pas soumettre d\'avis.' });
  }

  // The route requires a logged-in customer: the review belongs to the account, whose name is used (never typed).
  const { rating, comment } = req.body;

  try {
    const result = await reviewService.createProductReview({
      productId: req.params.id,
      userId: req.user.id,
      guestSessionId: null,
      email: null,
      authorName: req.user.fullName,
      rating,
      comment,
    });
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function listAdminProductReviews(req, res) {
  try {
    const reviews = await reviewService.getAllProductReviews(req.params.id);
    res.json(reviews);
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateProductReview(req, res) {
  const { status, showInGeneral } = req.body;
  try {
    const review = await reviewService.updateProductReview(req.params.id, { status, showInGeneral });
    res.json(review);
  } catch (err) {
    sendError(res, err);
  }
}

export async function removeProductReview(req, res) {
  try {
    await reviewService.deleteProductReview(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}