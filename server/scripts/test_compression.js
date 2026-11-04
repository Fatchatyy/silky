/**
 * Response compression on the real app: text is gzipped when the browser asks for it and decompresses to exactly
 * the same bytes; photos, small responses and clients that do not ask are left alone.
 * Static files only (a fixture build and a temp uploads folder): no database is used.
 *
 * Usage: node server/scripts/test_compression.js
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-gzip-'));
const dist = path.join(dir, 'dist');
const uploads = path.join(dir, 'uploads');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.mkdirSync(uploads);

const BIG_JS = `${'console.log("silky storefront code");\n'.repeat(400)}`;
const BIG_HTML = `<!DOCTYPE html><html lang="fr"><head><!--seo-head--><title>Silky</title><!--/seo-head--></head><body><div id="root"></div>${'<p>texte</p>'.repeat(200)}</body></html>`;
const PHOTO = Buffer.alloc(50_000, 7); // stands in for a JPEG: not a compressible type, so it must be left alone
fs.writeFileSync(path.join(dist, 'index.html'), BIG_HTML);
fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), BIG_JS);
fs.writeFileSync(path.join(dist, 'tiny.txt'), 'hello');
fs.writeFileSync(path.join(uploads, '1786391497273-243dfd2a-r.large.webp'), PHOTO);
fs.writeFileSync(path.join(uploads, '1786391497273-243dfd2a-r.jpg'), PHOTO);

process.env.UPLOADS_DIR = uploads;
process.env.FRONTEND_DIST_DIR = dist;
process.env.SEO_HTML = 'off';
process.env.DATABASE_URL = 'postgres://x:x@127.0.0.1:1/none'; // never connected
process.env.GOODEX_ENABLE_LIVE = 'false';
const { app } = await import('../app.js');

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

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const request = (p, headers = {}) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
const gzip = { 'Accept-Encoding': 'gzip' };

try {
  console.log('--- Text is compressed ---');
  let r = await request('/assets/app-abc123.js', gzip);
  assert(r.headers['content-encoding'] === 'gzip' && r.body.length < BIG_JS.length / 5, `script is gzipped (${BIG_JS.length} -> ${r.body.length} bytes)`);
  assert(zlib.gunzipSync(r.body).toString() === BIG_JS, 'the script decompresses to exactly the same bytes');
  assert(/Accept-Encoding/i.test(r.headers.vary || ''), 'Vary: Accept-Encoding is set (caches keep compressed and plain copies apart)');
  assert(/immutable/.test(r.headers['cache-control'] || ''), 'the long-cache header of hashed assets is kept');
  r = await request('/about', gzip);
  assert(r.headers['content-encoding'] === 'gzip' && zlib.gunzipSync(r.body).toString() === BIG_HTML, 'a page is gzipped and decompresses to the same HTML');

  console.log('\n--- Left alone ---');
  r = await request('/assets/app-abc123.js');
  assert(!r.headers['content-encoding'] && r.body.toString() === BIG_JS, 'no Accept-Encoding: sent plain');
  r = await request('/uploads/1786391497273-243dfd2a-r.large.webp', gzip);
  assert(!r.headers['content-encoding'] && r.body.equals(PHOTO), 'a WebP photo is not compressed and arrives byte for byte');
  r = await request('/uploads/1786391497273-243dfd2a-r.jpg', gzip);
  assert(!r.headers['content-encoding'] && r.body.equals(PHOTO) && r.headers['content-type'] === 'image/jpeg', 'a JPEG photo is not compressed and arrives byte for byte');
  r = await request('/uploads/1786391497273-243dfd2a-r.large.webp', { ...gzip, Range: 'bytes=0-99' });
  assert(r.status === 206 && r.body.length === 100, 'range requests on files still work');
  r = await request('/tiny.txt', gzip);
  assert(!r.headers['content-encoding'] && r.body.toString() === 'hello', 'a tiny response is not compressed');
  r = await request('/api/does-not-exist', gzip);
  assert(r.status === 404, 'the API still answers as before');
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 300);
