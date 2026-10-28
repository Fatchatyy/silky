import * as videoService from '../services/video.service.js';
import * as productService from '../services/product.service.js';
import { AppError, sendError } from '../utils/errors.js';

export async function listVideos(req, res) {
  try {
    if (req.user?.role !== 'admin') {
      const product = await productService.getProductById(req.params.id);
      if (product.is_active === false) {
        throw new AppError('Produit non trouvé', 404);
      }
    }
    const videos = await videoService.getProductVideos(req.params.id);
    res.json(videos);
  } catch (err) {
    sendError(res, err);
  }
}

export async function uploadVideo(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Fichier vidéo requis' });
  }

  try {
    const videoUrl = `/uploads/${req.file.filename}`;
    const video = await videoService.addProductVideo({
      productId: req.params.id,
      videoUrl,
      sortOrder: req.body?.sortOrder !== undefined ? Number(req.body.sortOrder) : null,
    });

    const updatedProduct = await productService.getProductById(req.params.id);
    res.status(201).json({ video, product: updatedProduct });
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteVideo(req, res) {
  try {
    await videoService.deleteProductVideo({
      productId: req.params.id,
      videoId: req.params.videoId,
    });

    const updatedProduct = await productService.getProductById(req.params.id);
    res.json({ ok: true, videoId: req.params.videoId, product: updatedProduct });
  } catch (err) {
    sendError(res, err);
  }
}
