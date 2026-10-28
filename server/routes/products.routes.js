import { Router } from 'express';
import * as productsController from '../controllers/products.controller.js';
import * as videoController from '../controllers/video.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { upload, uploadVideo } from '../utils/upload.js';

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

// Public reads: optionalAuthMiddleware only identifies admins (who may see hidden products);
// invalid or missing tokens are treated as a guest.
router.get('/', optionalAuthMiddleware, productsController.list);

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
}, productsController.uploadImage);

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
}, videoController.uploadVideo);
router.delete('/:id/videos/:videoId', admin, videoController.deleteVideo);

router.get('/:id/reviews', requireProductId, productsController.listReviews);
router.post('/:id/reviews', requireProductId, optionalAuthMiddleware, productsController.createReview);
router.get('/:id/admin-reviews', admin, productsController.listAdminProductReviews);
router.patch('/reviews/:id', admin, productsController.updateProductReview);
router.delete('/reviews/:id', admin, productsController.removeProductReview);
router.get('/:id', requireProductId, optionalAuthMiddleware, productsController.getById);
router.post('/', admin, productsController.create);
router.put('/:id', admin, productsController.update);
router.delete('/:id', admin, productsController.remove);

export default router;


