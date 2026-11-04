import multer from 'multer';
import fs from 'fs/promises';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { uploadFilename } from './imageVariants.js';
import { safeExtension, contentMatchesMime } from './fileSignature.js';

export const UPLOADS_DIR = env.uploadsDir;

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    // The extension decides how the file is served back, so it must fit the declared type (never ".html", ".svg"...).
    const ext = safeExtension(file.mimetype, file.originalname);
    // Photos that get resized copies carry a "-r" marker in their name (see imageVariants.js).
    cb(null, uploadFilename(file.mimetype, ext, Date.now(), crypto.randomBytes(4).toString('hex')));
  },
});

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

const fileFilter = (_req, file, cb) => {
  if (IMAGE_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Only JPEG, PNG, WebP, GIF, and AVIF images are allowed.`));
  }
};

const videoFileFilter = (_req, file, cb) => {
  if (VIDEO_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Type de fichier non supporté : ${file.mimetype}. Seuls les formats MP4, WebM et OGG sont autorisés.`));
  }
};

// 25 MB — covers high-resolution product photography.
export const upload = multer({ storage, fileFilter, limits: { fileSize: 25 * 1024 * 1024 } });

// 200 MB — covers product showcase videos.
export const uploadVideo = multer({ storage, fileFilter: videoFileFilter, limits: { fileSize: 200 * 1024 * 1024 } });

/**
 * Express middleware placed right after multer: the declared MIME type is only the client's word, so the first bytes
 * of the stored file must really be that format. A file that is not is deleted and answered with 400.
 */
function verifyUploadContent(message) {
  return async (req, res, next) => {
    const file = req.file;
    if (!file) return next();
    let head = Buffer.alloc(0);
    let handle;
    try {
      handle = await fs.open(file.path, 'r');
      const buffer = Buffer.alloc(64);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytesRead);
    } catch (err) {
      return next(err);
    } finally {
      await handle?.close().catch(() => {});
    }
    if (!contentMatchesMime(file.mimetype, head)) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: message });
    }
    next();
  };
}

export const verifyImageUpload = verifyUploadContent(
  "Fichier invalide : le contenu n'est pas une image JPEG, PNG, WebP, GIF ou AVIF valide.",
);
export const verifyVideoUpload = verifyUploadContent(
  'Fichier invalide : le contenu n\'est pas une vidéo MP4, WebM ou OGG valide.',
);
