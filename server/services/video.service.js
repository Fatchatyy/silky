import path from 'path';
import { productRepository } from '../repositories/product.repository.js';
import { storage, uploadKey } from './storage.service.js';
import { AppError } from '../utils/errors.js';

export async function getProductVideos(productId) {
  if (!productId) {
    throw new AppError('ID du produit requis', 400);
  }
  return productRepository.findVideosByProductId(productId);
}

export async function addProductVideo({ productId, videoUrl, sortOrder = null }) {
  if (!productId) {
    throw new AppError('ID du produit requis', 400);
  }
  if (!videoUrl || typeof videoUrl !== 'string') {
    throw new AppError('URL de la vidéo requise', 400);
  }

  const product = await productRepository.findById(productId);
  if (!product) {
    throw new AppError('Produit non trouvé', 404);
  }

  const created = await productRepository.addProductVideo({
    productId,
    videoUrl: videoUrl.trim(),
    sortOrder,
  });

  return created;
}

export async function deleteProductVideo({ productId, videoId }) {
  if (!videoId) {
    throw new AppError('ID de la vidéo requis', 400);
  }

  const video = await productRepository.findProductVideo(videoId);
  if (!video) {
    throw new AppError('Vidéo non trouvée', 404);
  }

  if (productId && video.productId !== productId) {
    throw new AppError('Cette vidéo n\'appartient pas à ce produit', 400);
  }

  const deleted = await productRepository.deleteProductVideo(videoId);

  // Clean up the stored file (local disk or R2) if not referenced elsewhere
  if (video.videoUrl) {
    const trimmed = video.videoUrl.trim();
    if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
      const isStillReferenced = await productRepository.isImageReferencedElsewhere(trimmed);
      if (!isStillReferenced) {
        try {
          await storage.deleteObject(uploadKey(path.basename(trimmed)));
        } catch {
          // File may already have been deleted, or the storage may be unreachable: never fail for it
        }
      }
    }
  }

  return deleted;
}
