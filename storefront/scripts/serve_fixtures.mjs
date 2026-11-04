// Local browsing helper: creates the test fixtures in silky_test, starts the API on a fixed port with the right CORS
// origins, prints the product addresses and waits. Ctrl+C removes everything it created.
//
// Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node storefront/scripts/serve_fixtures.mjs [port]
import { assertSilkyTestUrl } from '../../server/scripts/helpers/silky_test_guard.js';

assertSilkyTestUrl();
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:4321,http://127.0.0.1:4321,http://localhost:5173';
process.env.GOODEX_ENABLE_LIVE = 'false';
process.env.GOODEX_BASE_URL = 'http://127.0.0.1:1';

const { startApi, createFixtures } = await import('./lib/fixtures.mjs');
const port = Number(process.argv[2]) || 3101;
const api = await startApi(port);
const fixtures = await createFixtures();
console.log(`API on ${api.url} (silky_test). Fixture marker: ${fixtures.marker}`);
console.log(`Product: /product/${fixtures.robe.slug}   Hidden: /product/${fixtures.hidden.slug}   Evil: /product/${fixtures.evil.slug}`);

const stop = async () => {
  const clean = await fixtures.cleanup();
  await api.stop();
  console.log(clean ? 'Fixtures removed.' : 'WARNING: some fixtures were left behind.');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
