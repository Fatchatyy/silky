/**
 * Storage of uploaded photos and videos (services/storage.service.js): the disk driver, the R2 driver against a fake
 * S3 client (no network, no bucket), the STORAGE_DRIVER settings, and the upload / delete pipeline running on R2:
 * copies stored before the original, cleanup after a failure, videos streamed from a temporary file, deletes of a photo
 * and its copies. No database, nothing in server/uploads.
 *
 * Usage: node server/scripts/test_storage_service.js
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-storage-'));
process.env.UPLOADS_DIR = path.join(dir, 'default-uploads');
process.env.DATABASE_URL = 'postgres://x:x@127.0.0.1:1/none'; // never connected
const { createStorage, uploadKey, cacheControlFor, contentTypeFor } = await import('../services/storage.service.js');
const { parseStorageConfig } = await import('../config/env.js');
const { createResizeMiddleware, removeImageVariants } = await import('../utils/imageVariants.js');
const { verifyImageUpload, verifyVideoUpload, createVideoStoreMiddleware } = await import('../utils/upload.js');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

/** A fake S3 client: keeps objects in a Map and records every command. */
function fakeR2({ failOn } = {}) {
  const objects = new Map();
  const log = [];
  const client = {
    async send(command) {
      const type = command.constructor.name;
      const input = command.input;
      log.push({ type, input });
      if (failOn && failOn(type, input)) throw new Error('R2 is down');
      if (type === 'PutObjectCommand') {
        const body = Buffer.isBuffer(input.Body) ? input.Body : await new Promise((resolve, reject) => {
          const chunks = [];
          input.Body.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
        });
        objects.set(input.Key, { body, input });
        return {};
      }
      if (type === 'DeleteObjectCommand') {
        objects.delete(input.Key);
        return {};
      }
      if (type === 'HeadObjectCommand') {
        if (!objects.has(input.Key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        return { ContentLength: objects.get(input.Key).body.length };
      }
      throw new Error(`unexpected command ${type}`);
    },
  };
  const named = (name) => class { constructor(input) { this.input = input; } static get name() { return name; } };
  const sdk = async () => ({ PutObjectCommand: named('PutObjectCommand'), DeleteObjectCommand: named('DeleteObjectCommand'), HeadObjectCommand: named('HeadObjectCommand') });
  return { objects, log, client, sdk };
}
const r2Storage = (fake) => createStorage({ driver: 'r2', r2: { bucket: 'silky-media' }, r2Client: fake.client, sdk: fake.sdk });

try {
  console.log('--- Keys, content types, cache headers ---');
  assert(uploadKey('123-abcd1234-r.jpg') === 'uploads/123-abcd1234-r.jpg' && uploadKey('/uploads/x.png') === 'uploads/x.png' && uploadKey('../../etc/passwd') === 'uploads/passwd', 'upload keys are always uploads/<file name> (no path tricks)');
  assert(contentTypeFor('a.jpg') === 'image/jpeg' && contentTypeFor('a.PNG') === 'image/png' && contentTypeFor('a.card.webp') === 'image/webp' && contentTypeFor('v.mp4') === 'video/mp4' && contentTypeFor('v.mov') === 'video/quicktime' && contentTypeFor('x.bin') === 'application/octet-stream', 'content type comes from the extension');
  assert(/immutable/.test(cacheControlFor('uploads/1786391497273-243dfd2a-r.jpg')) && /immutable/.test(cacheControlFor('uploads/1786391497273-243dfd2a-r.large.webp')), 'a photo with copies, and its copies, are cached for a year');
  assert(cacheControlFor('uploads/1786391497273-243dfd2a.jpg') === 'public, max-age=3600' && cacheControlFor('uploads/1-abcdef12.mp4') === 'public, max-age=3600', 'older uploads and videos get a short cache');

  console.log('\n--- Disk driver ---');
  const disk = createStorage({ driver: 'disk', uploadsDir: path.join(dir, 'disk') });
  assert(disk.driver === 'disk' && (await disk.objectExists('uploads/a.jpg')) === false && (await disk.objectSize('uploads/a.jpg')) === null, 'a missing file does not exist');
  await disk.putObject('uploads/a.jpg', Buffer.from('hello'), 'image/jpeg');
  assert(fs.readFileSync(path.join(dir, 'disk', 'a.jpg'), 'utf8') === 'hello' && (await disk.objectSize('uploads/a.jpg')) === 5 && (await disk.objectExists('uploads/a.jpg')), 'put writes <uploadsDir>/<file> (folder created on demand)');
  await disk.putObject('uploads/b.mp4', Readable.from([Buffer.from('vid'), Buffer.from('eo')]), 'video/mp4', { contentLength: 5 });
  assert(fs.readFileSync(path.join(dir, 'disk', 'b.mp4'), 'utf8') === 'video', 'a stream is written to the file');
  await disk.deleteObject('uploads/a.jpg');
  await disk.deleteObject('uploads/a.jpg');
  assert(!fs.existsSync(path.join(dir, 'disk', 'a.jpg')), 'delete removes the file, deleting it twice does not throw');
  await disk.putObject('uploads/../escape.txt', Buffer.from('x'));
  assert(!fs.existsSync(path.join(dir, 'escape.txt')) && fs.existsSync(path.join(dir, 'disk', 'escape.txt')), 'a key with .. stays inside the uploads folder');
  let threw = false;
  try { createStorage({ driver: 'ftp' }); } catch { threw = true; }
  assert(threw, 'an unknown driver is refused');

  console.log('\n--- R2 driver (fake client) ---');
  const fake = fakeR2();
  const r2 = r2Storage(fake);
  await r2.putObject('uploads/1786391497273-243dfd2a-r.jpg', Buffer.from('photo'), 'image/jpeg');
  const put = fake.log[0].input;
  assert(fake.log[0].type === 'PutObjectCommand' && put.Bucket === 'silky-media' && put.Key === 'uploads/1786391497273-243dfd2a-r.jpg' && put.ContentType === 'image/jpeg' && /immutable/.test(put.CacheControl), 'put sends bucket, key, content type and the one-year cache header');
  await r2.putObject('uploads/1-abcdef12.gif', Buffer.from('g'), 'image/gif');
  assert(fake.objects.get('uploads/1-abcdef12.gif').input.CacheControl === 'public, max-age=3600', 'a plain upload gets the short cache header');
  await r2.putObject('uploads/2-abcdef12.mp4', Readable.from([Buffer.from('abc')]), 'video/mp4', { contentLength: 3 });
  assert(fake.objects.get('uploads/2-abcdef12.mp4').input.ContentLength === 3 && fake.objects.get('uploads/2-abcdef12.mp4').body.toString() === 'abc', 'a stream is sent with its length');
  let noLength = false;
  try { await r2.putObject('uploads/3.mp4', Readable.from(['x']), 'video/mp4'); } catch { noLength = true; }
  assert(noLength, 'a stream without a length is refused (R2 needs it)');
  assert((await r2.objectSize('uploads/1-abcdef12.gif')) === 1 && (await r2.objectExists('uploads/1-abcdef12.gif')) && (await r2.objectExists('uploads/nope.jpg')) === false, 'objectSize / objectExists use HEAD; a missing key is null / false');
  await r2.deleteObject('uploads/1-abcdef12.gif');
  await r2.deleteObject('uploads/1-abcdef12.gif');
  assert(!fake.objects.has('uploads/1-abcdef12.gif'), 'delete removes the object, and a missing one is not an error');
  const broken = r2Storage(fakeR2({ failOn: (type) => type === 'HeadObjectCommand' }));
  let headError = false;
  try { await broken.objectExists('uploads/x.jpg'); } catch { headError = true; }
  assert(headError, 'a real failure of HEAD (not "not found") is not hidden as "missing"');

  console.log('\n--- STORAGE_DRIVER settings ---');
  const cfg = parseStorageConfig({});
  assert(cfg.driver === 'disk' && cfg.mediaPublicUrl === '', 'default: disk');
  const full = { STORAGE_DRIVER: 'R2', R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'silky-media', MEDIA_PUBLIC_URL: 'https://media.silky.tn/' };
  const r2cfg = parseStorageConfig(full);
  assert(r2cfg.driver === 'r2' && r2cfg.r2.bucket === 'silky-media' && r2cfg.mediaPublicUrl === 'https://media.silky.tn', 'r2 with its four variables; the public address loses its trailing slash');
  let message = '';
  try { parseStorageConfig({ STORAGE_DRIVER: 'r2', R2_BUCKET: 'b' }); } catch (err) { message = err.message; }
  assert(/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/.test(message) && !/R2_BUCKET/.test(message), 'r2 without credentials stops the server, naming only what is missing');
  message = '';
  try { parseStorageConfig({ STORAGE_DRIVER: 's3' }); } catch (err) { message = err.message; }
  assert(/STORAGE_DRIVER must be/.test(message), 'an unknown STORAGE_DRIVER stops the server');

  console.log('\n--- Photo upload on R2 ---');
  const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 120, b: 200 }, noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).jpeg({ quality: 90 }).toBuffer();
  const upFake = fakeR2();
  const upApp = express();
  upApp.post('/upload', multer({ storage: multer.memoryStorage() }).single('image'), verifyImageUpload, createResizeMiddleware(r2Storage(upFake)), (req, res) => res.json({ url: `/uploads/${req.file.filename}` }));
  upApp.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  const upServer = http.createServer(upApp);
  await new Promise((resolve) => upServer.listen(0, '127.0.0.1', resolve));
  const post = async (bytes, type, name) => {
    const form = new FormData();
    form.append('image', new Blob([bytes], { type }), name);
    const res = await fetch(`http://127.0.0.1:${upServer.address().port}/upload`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };
  try {
    const ok = await post(photo, 'image/jpeg', 'IMG_1.JPG');
    const file = path.basename(ok.body.url); // the client's extension case is kept (IMG_1.JPG -> ...-r.JPG)
    const base = file.replace(/\.[^.]+$/, '');
    const keys = [...upFake.objects.keys()];
    assert(ok.status === 200 && /^\/uploads\/\d+-[0-9a-f]{8}-r\.jpg$/i.test(ok.body.url), `the admin still gets { url: "/uploads/<name>-r.jpg" } (${ok.body.url})`);
    assert(keys.length === 4 && ['card', 'share', 'large'].every((n) => keys.includes(`uploads/${base}.${n}.webp`)) && keys.includes(`uploads/${file}`), 'the original and its three copies are in the bucket');
    const putOrder = upFake.log.filter((l) => l.type === 'PutObjectCommand').map((l) => l.input.Key);
    assert(putOrder[putOrder.length - 1] === `uploads/${file}` && putOrder.slice(0, 3).every((k) => k.endsWith('.webp')), 'the copies are stored first, the original last');
    assert(upFake.objects.get(`uploads/${file}`).body.equals(photo) && upFake.objects.get(`uploads/${base}.card.webp`).input.ContentType === 'image/webp', 'the original is stored untouched; copies are WebP');

    const before = upFake.objects.size;
    const bad = await post(Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg', 'evil.jpg');
    assert(bad.status === 400 && upFake.objects.size === before, 'a file that is not an image is refused and nothing reaches the bucket');

    await removeImageVariants(file, r2Storage(upFake));
    await r2Storage(upFake).deleteObject(`uploads/${file}`);
    assert(upFake.objects.size === 0, 'deleting a photo removes the original and its three copies from the bucket');
  } finally {
    await new Promise((resolve) => upServer.close(resolve));
  }

  console.log('\n--- Failures while storing ---');
  const failFake = fakeR2({ failOn: (type, input) => type === 'PutObjectCommand' && /\.jpe?g$/i.test(input.Key) });
  const failApp = express();
  failApp.post('/upload', multer({ storage: multer.memoryStorage() }).single('image'), verifyImageUpload, createResizeMiddleware(r2Storage(failFake)), (req, res) => res.json({ url: `/uploads/${req.file.filename}` }));
  failApp.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  const failServer = http.createServer(failApp);
  await new Promise((resolve) => failServer.listen(0, '127.0.0.1', resolve));
  try {
    const form = new FormData();
    form.append('image', new Blob([photo], { type: 'image/jpeg' }), 'IMG_2.JPG');
    const res = await fetch(`http://127.0.0.1:${failServer.address().port}/upload`, { method: 'POST', body: form });
    assert(res.status === 500 && failFake.objects.size === 0, 'R2 refusing the original: the upload fails and the copies already stored are removed (no copies without an original)');
  } finally {
    await new Promise((resolve) => failServer.close(resolve));
  }

  console.log('\n--- Video upload on R2 (streamed from a temporary file) ---');
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(2000, 7)]);
  const tmpFile = path.join(dir, 'tmp-video');
  fs.writeFileSync(tmpFile, mp4);
  const vFake = fakeR2();
  const videoReq = { file: { path: tmpFile, filename: '1786-abcd1234.mp4', mimetype: 'video/mp4', size: mp4.length, originalname: 'clip.mp4' } };
  let videoNext;
  await createVideoStoreMiddleware(r2Storage(vFake))(videoReq, {}, (arg) => { videoNext = arg; });
  const stored = vFake.objects.get('uploads/1786-abcd1234.mp4');
  assert(videoNext === undefined && stored && stored.body.equals(mp4) && stored.input.ContentLength === mp4.length && stored.input.ContentType === 'video/mp4', 'the video is streamed to uploads/<name> with its length and type');
  assert(!fs.existsSync(tmpFile), 'the temporary file is removed afterwards');
  fs.writeFileSync(tmpFile, mp4);
  const downFake = fakeR2({ failOn: () => true });
  let videoErr;
  await createVideoStoreMiddleware(r2Storage(downFake))({ file: { ...videoReq.file } }, {}, (arg) => { videoErr = arg; });
  assert(videoErr instanceof Error && !fs.existsSync(tmpFile), 'a storage failure passes the error on and still removes the temporary file');
  const tmpBad = path.join(dir, 'tmp-bad');
  fs.writeFileSync(tmpBad, Buffer.from('<html>not a video at all, long enough to read a header</html>'));
  let status = 0;
  await verifyVideoUpload({ file: { path: tmpBad, mimetype: 'video/mp4', originalname: 'x.mp4' } }, { status(code) { status = code; return { json() {} }; } }, () => {});
  assert(status === 400 && !fs.existsSync(tmpBad), 'a fake video is refused and its temporary file removed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 300);
