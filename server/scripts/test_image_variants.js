/**
 * Resized copies of uploaded photos: file naming, the three WebP copies, EXIF orientation, transparency, no
 * upscaling, untouched original, fallback when a file cannot be resized, deletion, and the upload route wiring.
 * Works on synthetic images in a temporary folder. No database, no network, nothing in server/uploads.
 *
 * Usage: node server/scripts/test_image_variants.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { IMAGE_VARIANTS, hasImageVariants, imageVariantPath } from '../../shared/imageVariants.js';
import { createImageVariants, removeImageVariants, resizeUploadedImage, uploadFilename } from '../utils/imageVariants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-img-'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const names = Object.keys(IMAGE_VARIANTS);
// Read through a buffer so the test itself holds no file open (Windows cannot delete an open file).
const meta = (file) => sharp(fs.readFileSync(file)).metadata();
const variantsOf = (file) => names.map((n) => file.replace(/\.[^.]+$/, `.${n}.webp`));
const noise = (width, height, channels = 3) => ({ create: { width, height, channels, background: { r: 120, g: 90, b: 70 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } });

try {
  console.log('--- Names ---');
  const marked = uploadFilename('image/jpeg', '.jpg', 1786391497273, '243dfd2a');
  assert(marked === '1786391497273-243dfd2a-r.jpg' && hasImageVariants(`/uploads/${marked}`), 'resizable uploads carry the -r marker');
  assert(uploadFilename('image/gif', '.gif', 1, 'abcdef12') === '1-abcdef12.gif', 'GIF keeps a plain name (never resized)');
  assert(uploadFilename('image/avif', '.avif', 1, 'abcdef12') === '1-abcdef12.avif', 'AVIF keeps a plain name');
  assert(uploadFilename('video/mp4', '.mp4', 1, 'abcdef12') === '1-abcdef12.mp4', 'videos keep a plain name');
  assert(imageVariantPath('/uploads/1786391497273-243dfd2a-r.jpg', 'large') === '/uploads/1786391497273-243dfd2a-r.large.webp', 'large copy path');
  assert(imageVariantPath('/uploads/1786391497273-243dfd2a-r.PNG', 'card') === '/uploads/1786391497273-243dfd2a-r.card.webp', 'card copy path, any extension case');
  for (const old of ['/uploads/1786391497273-243dfd2a.jpg', '/pictures/blushmarron.jpg', 'data:image/png;base64,AAAA', 'https://x.test/a-r.jpg', '/uploads/../1-abcd1234-r.jpg', '', null, undefined]) {
    assert(imageVariantPath(old, 'card') === old, `unmarked or foreign image is used as is: ${String(old).slice(0, 40)}`);
  }
  assert(imageVariantPath('/uploads/1-abcd1234-r.card.webp', 'large') === '/uploads/1-abcd1234-r.card.webp', 'a copy is never mapped again');
  assert(imageVariantPath('/uploads/1-abcd1234-r.jpg', 'nope') === '/uploads/1-abcd1234-r.jpg', 'unknown variant name leaves the url alone');

  console.log('\n--- Copies of a large photo ---');
  const big = path.join(dir, '1-aaaaaaaa-r.jpg');
  await sharp(noise(3000, 4000)).jpeg({ quality: 90 }).toFile(big);
  const bigHash = sha(big);
  assert((await createImageVariants(big)) === true, 'createImageVariants succeeds');
  const bigCopies = variantsOf(big);
  assert(bigCopies.every((f) => fs.existsSync(f)), 'card, share and large copies exist next to the original');
  const widths = [];
  for (const f of bigCopies) {
    const m = await meta(f);
    widths.push(`${m.format}:${m.width}`);
  }
  assert(widths.join() === 'webp:600,webp:1200,webp:2400', `copies are WebP at 600, 1200 and 2400 px wide (got ${widths.join()})`);
  assert(sha(big) === bigHash, 'the original file is byte-for-byte unchanged');
  assert(fs.statSync(bigCopies[2]).size < fs.statSync(big).size, 'the large copy is smaller than the original');

  console.log('\n--- Orientation, transparency, no upscaling ---');
  const rotated = path.join(dir, '2-bbbbbbbb-r.jpg');
  await sharp(noise(3000, 2000)).jpeg().withMetadata({ orientation: 6 }).toFile(rotated);
  await createImageVariants(rotated);
  const rm = await meta(variantsOf(rotated)[0]);
  assert(rm.height > rm.width && rm.width === 600, `EXIF-rotated photo comes out upright (${rm.width}x${rm.height})`);
  const alpha = path.join(dir, '3-cccccccc-r.png');
  await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.3 } } }).png().toFile(alpha);
  await createImageVariants(alpha);
  const am = await meta(variantsOf(alpha)[1]);
  assert(am.hasAlpha === true, 'PNG transparency is kept');
  const small = path.join(dir, '4-dddddddd-r.jpg');
  await sharp(noise(400, 300)).jpeg().toFile(small);
  await createImageVariants(small);
  const sm = await meta(variantsOf(small)[2]);
  assert(sm.width === 400, 'a small photo is never enlarged');

  console.log('\n--- A file that cannot be resized ---');
  const broken = path.join(dir, '5-eeeeeeee-r.jpg');
  fs.writeFileSync(broken, 'this is not an image');
  assert((await createImageVariants(broken)) === false, 'createImageVariants reports failure');
  assert(variantsOf(broken).every((f) => !fs.existsSync(f)), 'no partial copies are left behind');

  console.log('\n--- Upload middleware ---');
  const run = async (file) => {
    const req = { file };
    let nextCalled = false;
    await resizeUploadedImage(req, {}, () => { nextCalled = true; });
    return { req, nextCalled };
  };
  const goodPath = path.join(dir, '6-ffffffff-r.jpg');
  await sharp(noise(1500, 1000)).jpeg().toFile(goodPath);
  let out = await run({ filename: '6-ffffffff-r.jpg', path: goodPath, mimetype: 'image/jpeg' });
  assert(out.nextCalled && out.req.file.filename === '6-ffffffff-r.jpg' && variantsOf(goodPath).every((f) => fs.existsSync(f)), 'valid photo: copies made, name kept');
  const badPath = path.join(dir, '7-99999999-r.jpg');
  fs.writeFileSync(badPath, 'broken');
  out = await run({ filename: '7-99999999-r.jpg', path: badPath, mimetype: 'image/jpeg' });
  assert(out.nextCalled && out.req.file.filename === '7-99999999.jpg' && fs.existsSync(path.join(dir, '7-99999999.jpg')) && !fs.existsSync(badPath), 'unreadable photo: renamed without the marker, so the original is used');
  const gifPath = path.join(dir, '8-12345678.gif');
  fs.writeFileSync(gifPath, 'GIF89a');
  out = await run({ filename: '8-12345678.gif', path: gifPath, mimetype: 'image/gif' });
  assert(out.nextCalled && out.req.file.filename === '8-12345678.gif' && fs.readdirSync(dir).every((f) => !f.startsWith('8-12345678.') || f === '8-12345678.gif'), 'GIF: untouched');
  out = await run(undefined);
  assert(out.nextCalled, 'no file (a url was sent instead): passes through');

  console.log('\n--- Real multipart upload (temp folder) ---');
  const uploadDir = path.join(dir, 'uploads');
  fs.mkdirSync(uploadDir);
  const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, uploadFilename(file.mimetype, path.extname(file.originalname) || '.jpg', Date.now(), crypto.randomBytes(4).toString('hex'))),
  });
  const app = express();
  app.post('/upload', multer({ storage }).single('image'), resizeUploadedImage, (req, res) => res.json({ url: `/uploads/${req.file.filename}` }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const photo = await sharp(noise(3072, 4096)).jpeg({ quality: 90 }).toBuffer();
    const form = new FormData();
    form.append('image', new Blob([photo], { type: 'image/jpeg' }), 'IMG_2041.JPG');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/upload`, { method: 'POST', body: form });
    const { url } = await res.json();
    const saved = path.join(uploadDir, path.basename(url));
    assert(res.status === 200 && hasImageVariants(url) && fs.existsSync(saved) && sha(saved) === crypto.createHash('sha256').update(photo).digest('hex'), `phone photo saved untouched as ${path.basename(url)}`);
    const copies = ['card', 'share', 'large'].map((v) => path.join(uploadDir, path.basename(imageVariantPath(url, v))));
    assert(copies.every((f) => fs.existsSync(f)), 'the URL returned to the admin maps to three existing copies');
    assert(fs.statSync(copies[0]).size < photo.length / 10, `card copy is more than 10 times smaller than the original (${(fs.statSync(copies[0]).size / 1024).toFixed(0)} KB vs ${(photo.length / 1048576).toFixed(1)} MB)`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n--- Browser caching of /uploads ---');
  process.env.UPLOADS_DIR = path.join(dir, 'served');
  process.env.DATABASE_URL = 'postgres://x:x@127.0.0.1:1/none'; // never connected: only static files are requested
  fs.mkdirSync(process.env.UPLOADS_DIR);
  for (const f of ['1786391497273-243dfd2a-r.jpg', '1786391497273-243dfd2a-r.card.webp', '1786391497273-243dfd2a-r.large.webp', '1786391497273-243dfd2a.jpg']) {
    fs.writeFileSync(path.join(process.env.UPLOADS_DIR, f), 'x');
  }
  const { app: realApp } = await import('../app.js');
  const realServer = http.createServer(realApp);
  await new Promise((resolve) => realServer.listen(0, '127.0.0.1', resolve));
  try {
    const cache = async (name) => (await fetch(`http://127.0.0.1:${realServer.address().port}/uploads/${name}`)).headers.get('cache-control');
    assert(/immutable/.test(await cache('1786391497273-243dfd2a-r.large.webp')) && /max-age=31536000/.test(await cache('1786391497273-243dfd2a-r.card.webp')), 'resized copies are cached for a year');
    assert(/immutable/.test(await cache('1786391497273-243dfd2a-r.jpg')), 'a new original (marker in its name) is cached for a year');
    assert(!/immutable/.test((await cache('1786391497273-243dfd2a.jpg')) || ''), 'an older upload keeps the default caching');
  } finally {
    realServer.closeAllConnections?.();
    await new Promise((resolve) => realServer.close(resolve));
  }

  console.log('\n--- Deleting a photo removes its copies ---');
  await removeImageVariants(big);
  assert(variantsOf(big).every((f) => !fs.existsSync(f)) && fs.existsSync(big), 'copies removed, original left to the caller');
  await removeImageVariants(path.join(dir, 'never-existed.jpg'));
  assert(true, 'removing copies of a file without any does not throw');

  console.log('\n--- Wiring ---');
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  for (const route of ['products.routes.js', 'theme.routes.js', 'gallery.routes.js']) {
    assert(/upload[\s\S]{0,200}resizeUploadedImage/.test(read(`../routes/${route}`)), `${route}: image uploads pass through resizeUploadedImage`);
  }
  assert(!/resizeUploadedImage/.test(read('../routes/products.routes.js').split('uploadVideo.single')[1] || ''), 'video uploads are not resized');
  assert(/removeImageVariants\(filePath\)/.test(read('../services/product.service.js')), 'deleting a product also removes the copies of its files');
} finally {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
