// Local browsing helper: creates the test fixtures in silky_test, starts the API on a fixed port with the right CORS
// origins, prints the product addresses and waits. Ctrl+C removes everything it created.
//
// Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node storefront/scripts/serve_fixtures.mjs [port]
import { assertSilkyTestUrl } from '../../server/scripts/helpers/silky_test_guard.js';

assertSilkyTestUrl();
// 4399 is the port the storefront scripts use for wrangler dev.
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:4321,http://127.0.0.1:4321,http://localhost:4399,http://127.0.0.1:4399,http://localhost:5173';
process.env.GOODEX_ENABLE_LIVE = 'false';
// Uploads of a test session never go to server/uploads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-fixture-uploads-'));
process.env.GOODEX_BASE_URL = 'http://127.0.0.1:1';

const { startApi, createFixtures } = await import('./lib/fixtures.mjs');
const port = Number(process.argv[2]) || 3101;
const api = await startApi(port);
const fixtures = await createFixtures();
console.log(`API on ${api.url} (silky_test). Fixture marker: ${fixtures.marker}`);
console.log(`Product: /product/${fixtures.robe.slug}   Hidden: /product/${fixtures.hidden.slug}   Evil: /product/${fixtures.evil.slug}`);

// Optional: node serve_fixtures.mjs 3001 <file> writes a short-lived admin token and user JSON for the browser tests (silky_test only).
if (process.argv[3]) {
  const { createAccount } = await import('../../server/scripts/helpers/test_accounts.js');
  const { pool } = await import('../../server/db/pool.js');
  const { env } = await import('../../server/config/env.js');
  const { default: jwt } = await import('jsonwebtoken');
  const id = await createAccount(pool, 'admin', 'storefront-test');
  const token = jwt.sign({ sub: id, email: 'admin@storefront-test.invalid', role: 'admin' }, env.jwtSecret, { expiresIn: 7200 });
  fs.writeFileSync(process.argv[3], JSON.stringify({ token, user: { id, email: 'admin@storefront-test.invalid', role: 'admin', fullName: 'Test admin' } }));
  fixtures.adminId = id;
}

const stop = async () => {
  if (fixtures.adminId) {
    const { removeAccounts } = await import('../../server/scripts/helpers/test_accounts.js');
    const { pool } = await import('../../server/db/pool.js');
    await removeAccounts(pool).catch(() => {});
  }
  const clean = await fixtures.cleanup();
  await api.stop();
  console.log(clean ? 'Fixtures removed.' : 'WARNING: some fixtures were left behind.');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
