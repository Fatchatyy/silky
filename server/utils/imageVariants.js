// Makes the resized copies of a freshly uploaded photo (names and sizes: shared/imageVariants.js) and hands the original
// and its copies to the storage service (local disk or R2). The original is never modified. A photo that cannot be
// resized is simply kept as it is.
import sharp from 'sharp';
import { IMAGE_VARIANTS, RESIZED_MARKER } from '../shared/imageVariants.js';
import { storage as defaultStorage, uploadKey } from '../services/storage.service.js';

// Only these formats are resized. GIF (may be animated), AVIF and anything else are kept as uploaded.
export const RESIZABLE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const MAX_INPUT_PIXELS = 120_000_000;

/** File name of a copy: '123-ab12cd34-r.jpg' + 'card' -> '123-ab12cd34-r.card.webp'. */
export const variantFilename = (filename, name) => `${String(filename).replace(/\.[^./\\]+$/, '')}.${name}.webp`;

/** File name for an upload: images that will be resized carry the marker, everything else keeps the plain name. */
export function uploadFilename(mimetype, ext, now = Date.now(), random = '') {
  const marker = RESIZABLE_MIME_TYPES.includes(mimetype) ? RESIZED_MARKER : '';
  return `${now}-${random}${marker}${ext}`;
}

/** Deletes the resized copies of a stored photo (by the photo's file name). Never throws. */
export async function removeImageVariants(filename, store = defaultStorage) {
  await Promise.all(
    Object.keys(IMAGE_VARIANTS).map((name) => store.deleteObject(uploadKey(variantFilename(filename, name))).catch(() => {})),
  );
}

/** The three WebP copies of an image as buffers ({ card, share, large }), or null when the image cannot be resized. */
export async function createImageVariants(input) {
  try {
    const copies = await Promise.all(
      Object.entries(IMAGE_VARIANTS).map(async ([name, { width, quality }]) => [
        name,
        await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate() // apply the camera's EXIF orientation: the copies carry no metadata
          .resize({ width, withoutEnlargement: true })
          .webp({ quality })
          .toBuffer(),
      ]),
    );
    return Object.fromEntries(copies);
  } catch (err) {
    console.error('[images] could not resize an upload, keeping the original only:', String(err?.message ?? err).slice(0, 160));
    return null;
  }
}

/**
 * Express middleware factory for the image upload routes, placed after multer and verifyImageUpload (which give the
 * upload its buffer and its stored name). It makes the copies and stores them first, the original last, so a name with
 * the marker never exists without its copies. When the copies cannot be made, the original is stored under the name
 * without the marker, so the storefront keeps using the original. A storage failure removes what was already stored
 * and passes the error on.
 */
export function createResizeMiddleware(store) {
  return async function resizeUploadedImage(req, _res, next) {
    const file = req.file;
    if (!file) return next();
    const written = [];
    try {
      if (file.filename.includes(RESIZED_MARKER + '.') && RESIZABLE_MIME_TYPES.includes(file.mimetype)) {
        const copies = await createImageVariants(file.buffer);
        if (copies) {
          for (const [name, buffer] of Object.entries(copies)) {
            const key = uploadKey(variantFilename(file.filename, name));
            written.push(key);
            await store.putObject(key, buffer, 'image/webp');
          }
        } else {
          file.filename = file.filename.replace(RESIZED_MARKER + '.', '.');
        }
      }
      const key = uploadKey(file.filename);
      written.push(key);
      await store.putObject(key, file.buffer, file.mimetype);
    } catch (err) {
      await Promise.all(written.map((key) => store.deleteObject(key).catch(() => {})));
      console.error('[images] could not store an upload:', String(err?.message ?? err).slice(0, 160));
      return next(err);
    }
    next();
  };
}

export const resizeUploadedImage = createResizeMiddleware(defaultStorage);
