import multer from 'multer';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import os from 'os';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { uploadFilename } from './imageVariants.js';
import { safeExtension, contentMatchesMime } from './fileSignature.js';
import { storage, uploadKey } from '../services/storage.service.js';

export const UPLOADS_DIR = env.uploadsDir;

// Nothing is stored by multer itself. Photos (25 MB at most) stay in memory until they are verified, resized and handed
// to the storage service (disk or R2). Videos (up to 200 MB) go to a temporary file instead of memory, and are streamed
// to the storage afterwards. The stored name is chosen after the content check (see verifyUploadContent).
const photoStorage = multer.memoryStorage();
const videoTempStorage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_req, _file, cb) => cb(null, `silky-upload-${crypto.randomBytes(8).toString('hex')}`),
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
export const upload = multer({ storage: photoStorage, fileFilter, limits: { fileSize: 25 * 1024 * 1024 } });

// 200 MB — covers product showcase videos.
export const uploadVideo = multer({ storage: videoTempStorage, fileFilter: videoFileFilter, limits: { fileSize: 200 * 1024 * 1024 } });

/**
 * Express middleware placed right after multer: the declared MIME type is only the client's word, so the first bytes
 * of the upload must really be that format. A file that is not is dropped and answered with 400. A file that passes
 * gets its stored name here: the extension must fit the declared type (never ".html", ".svg"...), and photos that
 * will get resized copies carry a "-r" marker (see imageVariants.js).
 */
function verifyUploadContent(message) {
  return async (req, res, next) => {
    const file = req.file;
    if (!file) return next();
    let head = Buffer.alloc(0);
    if (file.buffer) {
      head = file.buffer.subarray(0, 64);
    } else {
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
    }
    if (!contentMatchesMime(file.mimetype, head)) {
      if (file.path) await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: message });
    }
    const ext = safeExtension(file.mimetype, file.originalname);
    file.filename = uploadFilename(file.mimetype, ext, Date.now(), crypto.randomBytes(4).toString('hex'));
    next();
  };
}

export const verifyImageUpload = verifyUploadContent(
  "Fichier invalide : le contenu n'est pas une image JPEG, PNG, WebP, GIF ou AVIF valide.",
);
export const verifyVideoUpload = verifyUploadContent(
  'Fichier invalide : le contenu n\'est pas une vidéo MP4, WebM ou OGG valide.',
);

/**
 * Last step of the video upload route: streams the verified temporary file to the storage (disk or R2) under
 * 'uploads/<name>', then removes the temporary file. Photos are stored by resizeUploadedImage instead.
 */
export function createVideoStoreMiddleware(store) {
  return async function storeUploadedVideo(req, _res, next) {
    const file = req.file;
    if (!file) return next();
    const stream = createReadStream(file.path);
    // A stream opens its file late. If the storage fails first and the temporary file is removed, the open fails with no
    // one listening: that unhandled 'error' would crash the process. Failures reach us through putObject instead.
    stream.on('error', () => {});
    try {
      await store.putObject(uploadKey(file.filename), stream, file.mimetype, { contentLength: file.size });
    } catch (err) {
      stream.destroy();
      await fs.unlink(file.path).catch(() => {});
      return next(err);
    }
    await fs.unlink(file.path).catch(() => {});
    next();
  };
}

export const storeUploadedVideo = createVideoStoreMiddleware(storage);
