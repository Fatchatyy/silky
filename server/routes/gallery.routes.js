import { Router } from 'express';
import * as galleryController from '../controllers/gallery.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { upload, verifyImageUpload } from '../utils/upload.js';
import { resizeUploadedImage } from '../utils/imageVariants.js';

const router = Router();
const admin = [authMiddleware, adminMiddleware];

router.get('/', admin, galleryController.list);
router.post('/', admin, upload.single('image'), verifyImageUpload, resizeUploadedImage, galleryController.add);
router.delete('/:id', admin, galleryController.remove);

export default router;
