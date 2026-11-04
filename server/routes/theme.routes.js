import { Router } from 'express';
import * as themeController from '../controllers/theme.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { upload, verifyImageUpload } from '../utils/upload.js';
import { resizeUploadedImage } from '../utils/imageVariants.js';

const router = Router();
const admin = [authMiddleware, adminMiddleware];

router.get('/', themeController.get);
router.put('/', admin, themeController.update);
router.post('/upload', admin, upload.single('image'), verifyImageUpload, resizeUploadedImage, themeController.uploadImage);

export default router;
