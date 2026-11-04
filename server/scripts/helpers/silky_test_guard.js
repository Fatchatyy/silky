// Database-test guard. Imports nothing, so it can run before any module that loads .env or opens a connection.
//   assertSilkyTestUrl()            before importing the app: DATABASE_URL must be set in the environment (never taken
//                                   from .env) and name exactly "silky_test" on a loopback host.
//   assertConnectedToSilkyTest(...) before the first write: the live connection must be that same database.

const REQUIRED_DB = 'silky_test';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function refuse(message) {
  console.error(`REFUSING TO RUN: ${message}`);
  process.exit(2);
}

export function assertSilkyTestUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) refuse('DATABASE_URL is not set. Set it explicitly to the silky_test database; .env is not used as the target.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    refuse('DATABASE_URL is not a valid URL.');
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (dbName !== REQUIRED_DB) refuse(`database name must be exactly "${REQUIRED_DB}" (got "${dbName}").`);
  if (!LOOPBACK_HOSTS.has(url.hostname)) refuse(`host must be loopback (got "${url.hostname}").`);
  console.log(`Target database: ${dbName} on ${url.hostname} (password not printed)`);
  return raw;
}

export async function assertConnectedToSilkyTest(pool, resolvedUrl, expectedUrl) {
  if (resolvedUrl !== expectedUrl) refuse('the application resolved a different DATABASE_URL than the one set in the environment.');
  const { rows } = await pool.query('SELECT current_database() AS name');
  if (rows[0].name !== REQUIRED_DB) refuse(`connected database is "${rows[0].name}", expected "${REQUIRED_DB}".`);
  console.log(`Connected database confirmed: ${rows[0].name}`);
}
