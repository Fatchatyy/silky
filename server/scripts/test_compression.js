/**
 * Response compression on the real app: photos, small responses and clients that do not ask are left alone, and
 * range requests on uploads still work. The API serves no pages or scripts any more (Phase 3 step 2), so only a temp
 * uploads folder and tiny JSON answers are exercised: no database is used.
 *
 * Usage: node server/scripts/test_compression.js
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-gzip-'));
const uploads = path.join(dir, 'uploads');
fs.mkdirSync(uploads);

const PHOTO = Buffer.alloc(50_000, 7); // stands in for a JPEG: not a compressible type, so it must be left alone
fs.writeFileSync(path.join(uploads, '1786391497273-243dfd2a-r.large.webp'), PHOTO);
fs.writeFileSync(path.join(uploads, '1786391497273-243dfd2a-r.jpg'), PHOTO);

process.env.UPLOADS_DIR = uploads;
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
  console.log('--- Left alone ---');
  let r = await request('/uploads/1786391497273-243dfd2a-r.large.webp', gzip);
  assert(!r.headers['content-encoding'] && r.body.equals(PHOTO), 'a WebP photo is not compressed and arrives byte for byte');
  r = await request('/uploads/1786391497273-243dfd2a-r.jpg', gzip);
  assert(!r.headers['content-encoding'] && r.body.equals(PHOTO) && r.headers['content-type'] === 'image/jpeg', 'a JPEG photo is not compressed and arrives byte for byte');
  r = await request('/uploads/1786391497273-243dfd2a-r.large.webp', { ...gzip, Range: 'bytes=0-99' });
  assert(r.status === 206 && r.body.length === 100, 'range requests on files still work');
  r = await request('/', gzip);
  assert(!r.headers['content-encoding'] && JSON.parse(r.body.toString()).ok === true, 'a tiny response is not compressed (the API root answers { ok: true })');
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
