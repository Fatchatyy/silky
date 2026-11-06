// Where uploaded photos and videos live. Callers never know whether files go to the local disk or to Cloudflare R2:
// they use putObject / deleteObject / objectExists / objectSize with a key like 'uploads/1786391497273-243dfd2a-r.jpg'.
//
//   STORAGE_DRIVER=disk (default)  writes to env.uploadsDir, exactly like before (local development, tests, offline)
//   STORAGE_DRIVER=r2              writes to a Cloudflare R2 bucket through its S3-compatible API
//
// The database keeps storing '/uploads/<file>'; the key is the same path without the leading slash.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env.js';

/** Key of a stored upload from its file name ('1786-ab12cd34-r.jpg' -> 'uploads/1786-ab12cd34-r.jpg'). */
export const uploadKey = (filename) => `uploads/${path.basename(String(filename))}`;

/** Photos that have resized copies (and the copies) are never overwritten, so they may be cached for a year. */
const IMMUTABLE_UPLOAD = /^uploads\/\d+-[0-9a-f]{8}-r(\.(card|share|large))?\.(jpe?g|png|webp)$/i;
export const cacheControlFor = (key) =>
  IMMUTABLE_UPLOAD.test(key) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
};
/** Content type of an upload from its extension (used when copying files that were stored before this module). */
export const contentTypeFor = (filename) => CONTENT_TYPES[path.extname(String(filename)).toLowerCase()] || 'application/octet-stream';

const isMissing = (err) =>
  err?.code === 'ENOENT' || err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;

/** body is a Buffer or a readable stream (then options.contentLength is required for R2). */
function diskDriver(uploadsDir) {
  const fileOf = (key) => path.join(uploadsDir, path.basename(key));
  return {
    name: 'disk',
    async putObject(key, body) {
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const file = fileOf(key);
      if (Buffer.isBuffer(body)) await fs.promises.writeFile(file, body);
      else await pipeline(body, fs.createWriteStream(file));
    },
    async deleteObject(key) {
      try {
        await fs.promises.unlink(fileOf(key));
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    },
    async objectSize(key) {
      try {
        return (await fs.promises.stat(fileOf(key))).size;
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    /** Every stored file as { key: 'uploads/<file>', size, lastModified (ms) }. Read-only. */
    async listObjects() {
      let names = [];
      try {
        names = await fs.promises.readdir(uploadsDir);
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
      const objects = [];
      for (const name of names) {
        const stat = await fs.promises.stat(path.join(uploadsDir, name)).catch(() => null);
        if (stat?.isFile()) objects.push({ key: `uploads/${name}`, size: stat.size, lastModified: stat.mtimeMs });
      }
      return objects;
    },
  };
}

/**
 * `client` is anything with send(command) (the AWS SDK S3Client, or a fake in tests); `sdk` holds the command classes
 * (the real ones are loaded on first use, so a disk-only install never needs them).
 */
function r2Driver({ bucket, client, sdk }) {
  return {
    name: 'r2',
    async putObject(key, body, contentType, options = {}) {
      const { PutObjectCommand } = await sdk();
      const input = {
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
        CacheControl: options.cacheControl || cacheControlFor(key),
      };
      if (!Buffer.isBuffer(body)) {
        if (!Number.isInteger(options.contentLength)) throw new Error('putObject with a stream needs options.contentLength');
        input.ContentLength = options.contentLength;
      }
      await (await client()).send(new PutObjectCommand(input));
    },
    async deleteObject(key) {
      const { DeleteObjectCommand } = await sdk();
      await (await client()).send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); // a missing key is not an error
    },
    async objectSize(key) {
      const { HeadObjectCommand } = await sdk();
      try {
        const head = await (await client()).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return Number(head.ContentLength ?? 0);
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    /** Every stored object under 'uploads/' as { key, size, lastModified (ms) }. Read-only (ListObjectsV2, one request per 1000). */
    async listObjects() {
      const { ListObjectsV2Command } = await sdk();
      const objects = [];
      let token;
      do {
        const res = await (await client()).send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'uploads/', ContinuationToken: token }));
        for (const o of res.Contents || []) objects.push({ key: o.Key, size: Number(o.Size ?? 0), lastModified: new Date(o.LastModified).getTime() });
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },
  };
}

/**
 * Builds a storage. For R2 the credentials come from `r2`; tests pass `r2Client` (a fake with send()) and `sdk`
 * (fake command classes) so nothing touches the network.
 */
export function createStorage({ driver = 'disk', uploadsDir, r2, r2Client, sdk } = {}) {
  let impl;
  if (driver === 'r2') {
    const loadSdk = sdk || (() => import('@aws-sdk/client-s3'));
    let cached;
    const client =
      r2Client
        ? async () => r2Client
        : async () => {
            if (!cached) {
              const { S3Client } = await loadSdk();
              cached = new S3Client({
                region: 'auto',
                endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
                credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
                // R2 does not support the SDK's newer default checksum headers: only send one when the API requires it.
                requestChecksumCalculation: 'WHEN_REQUIRED',
                responseChecksumValidation: 'WHEN_REQUIRED',
              });
            }
            return cached;
          };
    impl = r2Driver({ bucket: r2.bucket, client, sdk: loadSdk });
  } else if (driver === 'disk') {
    impl = diskDriver(uploadsDir);
  } else {
    throw new Error(`Unknown storage driver "${driver}"`);
  }

  return {
    driver: impl.name,
    putObject: impl.putObject,
    deleteObject: impl.deleteObject,
    objectSize: impl.objectSize,
    listObjects: impl.listObjects,
    objectExists: async (key) => (await impl.objectSize(key)) !== null,
  };
}

/** The storage the app uses, chosen by STORAGE_DRIVER. */
export const storage = createStorage({ driver: env.storage.driver, uploadsDir: env.uploadsDir, r2: env.storage.r2 });
