import { Router } from 'express';
import * as productsController from '../controllers/products.controller.js';
import * as videoController from '../controllers/video.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { upload, uploadVideo, verifyImageUpload, verifyVideoUpload } from '../utils/upload.js';
import { reviewLimiter } from '../middleware/rateLimiter.js';
import { resizeUploadedImage } from '../utils/imageVariants.js';

const router = Router();
const admin = [authMiddleware, adminMiddleware];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed product id can never match a row: answer 404 like an unknown product instead of letting
// PostgreSQL reject the value. Applied to the public product-id routes.
function requireProductId(req, res, next) {
  if (!UUID_PATTERN.test(req.params.id)) {
    return res.status(404).json({ error: 'Produit non trouvé' });
  }
  next();
}

// Slugs are lowercase words joined by single hyphens (products.slug); anything else cannot match a row.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireProductSlug(req, res, next) {
  if (req.params.slug.length > 255 || !SLUG_PATTERN.test(req.params.slug)) {
    return res.status(404).json({ error: 'Produit non trouvé' });
  }
  next();
}

// Public reads: optionalAuthMiddleware only identifies admins (who may see hidden products);
// invalid or missing tokens are treated as a guest.
router.get('/', optionalAuthMiddleware, productsController.list);

// The address of a product page is its slug. Before every '/:id/...' route so no slug is read as an id.
router.get('/by-slug/:slug', requireProductSlug, optionalAuthMiddleware, productsController.getBySlug);

// Wrap upload route so Multer errors return clean JSON (e.g. FileTooLarge, wrong type)
router.post('/upload', admin, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        error: err.code === 'LIMIT_FILE_SIZE'
          ? 'File too large. Maximum allowed size is 25 MB.'
          : err.message || 'Upload failed.',
      });
    }
    next();
  });
}, verifyImageUpload, resizeUploadedImage, productsController.uploadImage);

// Product Videos routes
router.get('/:id/videos', requireProductId, optionalAuthMiddleware, videoController.listVideos);
router.post('/:id/videos', admin, (req, res, next) => {
  uploadVideo.single('video')(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        error: err.code === 'LIMIT_FILE_SIZE'
          ? 'Fichier trop volumineux. La taille maximale autorisée est de 200 Mo.'
          : err.message || 'Le téléversement de la vidéo a échoué.',
      });
    }
    next();
  });
}, verifyVideoUpload, videoController.uploadVideo);
router.delete('/:id/videos/:videoId', admin, videoController.deleteVideo);

router.get('/:id/reviews', requireProductId, productsController.listReviews);
// Only a logged-in customer can review a product (guests get 401); a malformed id is still a 404 first.
router.post('/:id/reviews', requireProductId, authMiddleware, reviewLimiter, productsController.createReview);
router.get('/:id/admin-reviews', admin, productsController.listAdminProductReviews);
router.patch('/reviews/:id', admin, productsController.updateProductReview);
router.delete('/reviews/:id', admin, productsController.removeProductReview);
router.get('/:id', requireProductId, optionalAuthMiddleware, productsController.getById);
router.post('/', admin, productsController.create);
router.put('/:id', admin, productsController.update);
router.delete('/:id', admin, productsController.remove);

export default router;


