// Local browsing helper for the admin panel (http://localhost:<storefront port>/admin) that never touches your own data:
// it starts the API on a fixed port against silky_test, with a stand-in for GOODEX (no real account, no real parcel), a
// throw-away uploads folder, test products, a few pending orders and a throw-away admin account whose password is
// generated for this run. Ctrl+C removes everything it created.
//
// Usage (PowerShell):
//   $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'
//   node storefront/scripts/serve_admin_session.mjs [apiPort=3101] [sessionFile] [storefrontOrigin=http://localhost:4399]
// The session file (JSON) gets { email, password, api, mockGoodex } so a browser test can sign in.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSilkyTestUrl } from '../../server/scripts/helpers/silky_test_guard.js';

assertSilkyTestUrl();
const port = Number(process.argv[2]) || 3101;
const sessionFile = process.argv[3];
const storefrontOrigin = process.argv[4] || 'http://localhost:4399';

const { startMockGoodex } = await import('./lib/mock_goodex.mjs');
const goodex = await startMockGoodex();

const adminEmail = `admin-ui-${crypto.randomBytes(3).toString('hex')}@silky-test.invalid`;
const adminPassword = crypto.randomBytes(9).toString('base64url');
process.env.ADMIN_EMAIL = adminEmail;
process.env.ADMIN_PASSWORD = adminPassword;
process.env.CORS_ALLOWED_ORIGINS = [storefrontOrigin, storefrontOrigin.replace('localhost', '127.0.0.1')].join(',');
// Uploads of a test session never go to server/uploads.
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-admin-uploads-'));
// The real-provider gate accepts only a loopback base URL in a test run; the token is not real.
process.env.GOODEX_ENABLE_LIVE = 'false';
process.env.GOODEX_BASE_URL = goodex.url;
process.env.GOODEX_API_TOKEN = 'test-token-not-real';
process.env.GOODEX_USER_ID = '1';
process.env.GOODEX_WEBHOOK_SECRET = 'test-webhook-secret-not-real';
// No real mailbox: with no SMTP credentials a development run uses the Ethereal fake inbox (see CLAUDE.md, e-mail).
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

const { startApi, createFixtures } = await import('./lib/fixtures.mjs');
const { pool } = await import('../../server/db/pool.js');
const { default: bcrypt } = await import('bcrypt');
const api = await startApi(port);
const fixtures = await createFixtures();

await pool.query("INSERT INTO users (email, password_hash, role, full_name, phone_number) VALUES ($1, $2, 'admin', 'Admin UI test', $3)", [adminEmail, await bcrypt.hash(adminPassword, 10), String(10000000 + crypto.randomInt(80000000))]);

// A few pending orders, placed the way a customer places them (so the admin sees what a real shop produces).
const { rows: variants } = await pool.query('SELECT id FROM product_variants WHERE product_id = $1 AND stock_quantity > 0 ORDER BY "position" LIMIT 2', [fixtures.robe.id]);
const orderIds = [];
for (const [index, who] of ['Salma Test', 'Nour Test', 'Amine Test'].entries()) {
  const res = await fetch(`${api.url}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer: { name: who, phone: `2000000${index}`, address: `${index + 1} Rue Test`, governorate: 'Tunis' }, items: [{ variantId: variants[index % variants.length].id, quantity: 1 }] }),
  });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`order creation failed: ${res.status} ${JSON.stringify(body)}`);
  orderIds.push(body.id);
}

if (sessionFile) fs.writeFileSync(sessionFile, JSON.stringify({ email: adminEmail, password: adminPassword, api: api.url, mockGoodex: goodex.url, marker: fixtures.marker, orderIds }));
console.log(`API on ${api.url} (silky_test), mock GOODEX on ${goodex.url}, uploads in ${process.env.UPLOADS_DIR}`);
console.log(`Fixture marker: ${fixtures.marker}; product /product/${fixtures.robe.slug}; ${orderIds.length} pending orders. Admin password: generated, in the session file.`);

const stop = async () => {
  try {
    await pool.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
    // Orders placed by the browser test carry the same fixture products: delete those too.
    await pool.query('DELETE FROM orders WHERE id IN (SELECT DISTINCT i.order_id FROM order_items i JOIN product_variants v ON v.id = i.variant_id WHERE v.product_id = ANY($1))', [[fixtures.robe.id, fixtures.chemise.id, fixtures.enfantProduct.id, fixtures.customProduct.id, fixtures.evil.id, fixtures.hidden.id]]).catch(() => {});
    await pool.query('DELETE FROM users WHERE email = $1', [adminEmail]);
  } catch (err) {
    console.warn('cleanup warning:', err.message);
  }
  const clean = await fixtures.cleanup();
  await api.stop();
  await goodex.stop();
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  console.log(clean ? 'Everything removed.' : 'WARNING: some fixtures were left behind.');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
