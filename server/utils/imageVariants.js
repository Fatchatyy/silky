// Makes the resized copies of a freshly uploaded photo (names and sizes: shared/imageVariants.js).
// The original is never modified. Nothing here throws: a photo that cannot be resized is simply kept as it is.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_VARIANTS, RESIZED_MARKER } from '../../shared/imageVariants.js';

// Only these formats are resized. GIF (may be animated), AVIF and anything else are kept as uploaded.
export const RESIZABLE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const MAX_INPUT_PIXELS = 120_000_000;

const variantFile = (filePath, name) => `${filePath.replace(/\.[^./\\]+$/, '')}.${name}.webp`;

/** File name for an upload: images that will be resized carry the marker, everything else keeps the plain name. */
export function uploadFilename(mimetype, ext, now = Date.now(), random = '') {
  const marker = RESIZABLE_MIME_TYPES.includes(mimetype) ? RESIZED_MARKER : '';
  return `${now}-${random}${marker}${ext}`;
}

export async function removeImageVariants(filePath) {
  await Promise.all(
    Object.keys(IMAGE_VARIANTS).map((name) => fs.unlink(variantFile(filePath, name)).catch(() => {})),
  );
}

/** Writes the copies next to the original. Returns true only when every copy exists afterwards. */
export async function createImageVariants(filePath) {
  try {
    // sharp gets the bytes, not the path: on Windows it would otherwise keep the file open and block a rename or delete.
    const input = await fs.readFile(filePath);
    await Promise.all(
      Object.entries(IMAGE_VARIANTS).map(([name, { width, quality }]) =>
        sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate() // apply the camera's EXIF orientation: the copies carry no metadata
          .resize({ width, withoutEnlargement: true })
          .webp({ quality })
          .toFile(variantFile(filePath, name)),
      ),
    );
    return true;
  } catch (err) {
    console.error('[images] could not resize an upload, keeping the original only:', String(err?.message ?? err).slice(0, 160));
    await removeImageVariants(filePath);
    return false;
  }
}

/**
 * Express middleware, placed after multer on the image upload routes. When the copies cannot be made, the file is
 * renamed without the marker so the storefront keeps using the original (a marked name always has its copies).
 */
export async function resizeUploadedImage(req, _res, next) {
  const file = req.file;
  if (file && file.filename.includes(RESIZED_MARKER + '.') && RESIZABLE_MIME_TYPES.includes(file.mimetype)) {
    const ok = await createImageVariants(file.path);
    if (!ok) {
      const plainName = file.filename.replace(RESIZED_MARKER + '.', '.');
      const plainPath = path.join(path.dirname(file.path), plainName);
      try {
        await fs.rename(file.path, plainPath);
        file.filename = plainName;
        file.path = plainPath;
      } catch (err) {
        console.error('[images] could not rename an unresized upload:', String(err?.message ?? err).slice(0, 160));
      }
    }
  }
  next();
}
