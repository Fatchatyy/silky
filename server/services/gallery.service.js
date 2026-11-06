import { galleryRepository } from '../repositories/gallery.repository.js';
import { AppError } from '../utils/errors.js';
import { removeUploadIfUnused } from './product.service.js';

export async function getGallery() {
  return galleryRepository.findAll();
}

export async function addGalleryItem({ src, alt }) {
  if (!src?.trim()) {
    throw new AppError('Image URL (src) is required', 400);
  }
  return galleryRepository.create({ src: src.trim(), alt: alt?.trim() });
}

export async function deleteGalleryItem(id) {
  const deleted = await galleryRepository.delete(id);
  if (!deleted) {
    throw new AppError('Gallery item not found', 404);
  }
  // The photo file (and its copies) goes with the item, unless something else still uses it. Never fails the delete.
  try {
    await removeUploadIfUnused(deleted.imageUrl);
  } catch (err) {
    console.error('[gallery] could not delete the photo file:', String(err?.message ?? err).slice(0, 160));
  }
  return deleted;
}
