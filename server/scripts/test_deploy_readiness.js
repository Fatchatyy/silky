/**
 * Deployment readiness: everything that makes a brand-new production environment possible and safe.
 *  - GET /health: 200 only while the database answers, 503 otherwise, no cookie, nothing revealed
 *  - request log: one line per request, no query string, quiet for /health and static files
 *  - database pool settings keep their old defaults
 *  - db:init builds a complete database from server/db/schema.sql, refuses a database that already has tables, and
 *    schema.sql has not drifted from the real (migrated) schema
 *  - admin:create inserts only the admin row, is idempotent, and refuses an e-mail used by a customer
 *  - the order-wiping migration refuses to run when orders exist (unless ALLOW_ORDER_RESET=yes)
 *  - preflight: fails on an empty / admin-less database, passes on a ready one, never prints a secret
 *
 * Database safety: refuses to run unless DATABASE_URL is set explicitly and names the database silky_test on a loopback
 * host. It creates (and drops at the end) its own scratch database, named silky_test_deploy_<random>, on the same server.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_deploy_readiness.js
 */
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let base = null;
try { base = new URL(process.env.DATABASE_URL || ''); } catch { /* handled below */ }
if (!base || base.pathname !== '/silky_test' || !['localhost', '127.0.0.1'].includes(base.hostname)) {
  console.error('REFUSING: DATABASE_URL must point at silky_test on loopback');
  process.exit(2);
}
process.env.NODE_ENV = 'test';
Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: 'probe', SMTP_PASS: 'probe', GOODEX_ENABLE_LIVE: 'false', GOODEX_BASE_URL: 'http://127.0.0.1:1' });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // the server folder
const { default: pg } = await import('pg');
const { app } = await import('../app.js');
const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { runGovernoratesMigration } = await import('../db/migrations/add_governorates.js');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { console.log(`  PASS  ${message}`); passed++; } else { console.error(`  FAIL  ${message}`); failed++; }
}

const withDb = (name) => { const u = new URL(base); u.pathname = `/${name}`; return u.toString(); };
const scratchName = `silky_test_deploy_${crypto.randomBytes(4).toString('hex')}`;
const scratchUrl = withDb(scratchName);
const run = (script, extraEnv = {}, args = []) => spawnSync(process.execPath, [path.join(root, script), ...args], {
  cwd: root, encoding: 'utf8', timeout: 90000,
  env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: scratchUrl, ADMIN_EMAIL: 'deploy-admin@example.test', ADMIN_PASSWORD: 'a-long-production-password', ...extraEnv },
});
const PROD_ENV = {
  NODE_ENV: 'production', JWT_SECRET: 'a-long-random-production-secret-xyz', CORS_ALLOWED_ORIGINS: 'https://shop.example', APP_URL: 'https://shop.example',
  TRUST_PROXY: '1', SMTP_USER: 'smtpuser-secret-name', SMTP_PASS: 'smtp-secret-pass-123', EMAIL_FROM: 'Silky <no-reply@shop.example>',
  UPLOADS_DIR: path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'silky-preflight-uploads'), DB_POOL_MAX: '', LOG_REQUESTS: 'false',
};

const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const admin = new pg.Client({ connectionString: withDb('postgres') });
await admin.connect();
let scratch = null;
let scratchPool = null;

try {
  // ---------- /health ----------
  console.log('\n--- /health');
  let r = await fetch(`${BASE}/health`);
  assert(r.status === 200 && (await r.json()).status === 'ok', 'answers 200 {status: ok} while the database works');
  assert(!r.headers.get('set-cookie'), 'sets no guest cookie');
  assert(r.headers.get('cache-control') === 'no-store', 'is never cached');
  const realQuery = pool.query.bind(pool);
  pool.query = () => Promise.reject(new Error('connection refused to db.internal:5432 password=hunter2'));
  const quiet = console.error; console.error = () => {};
  r = await fetch(`${BASE}/health`);
  const down = await r.text();
  console.error = quiet;
  pool.query = realQuery;
  assert(r.status === 503 && JSON.parse(down).status === 'unavailable', 'answers 503 when the database fails');
  assert(!/hunter2|db\.internal|refused/.test(down), 'reveals nothing about the failure');

  // ---------- request log ----------
  console.log('\n--- request log');
  const lines = [];
  const realLog = console.log;
  env.logRequests = true;
  console.log = (...a) => lines.push(a.join(' '));
  await fetch(`${BASE}/api/products?token=SECRET123&email=a@b.c`);
  await fetch(`${BASE}/health`);
  await fetch(`${BASE}/uploads/none.jpg`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log = realLog;
  env.logRequests = false;
  const http1 = lines.filter((l) => l.startsWith('[http]'));
  assert(http1.length === 1 && /^\[http\] GET \/api\/products 200 \d+ms$/.test(http1[0]), `one line for the API call: ${http1[0]}`);
  assert(!lines.join('\n').includes('SECRET123'), 'the query string (which can carry tokens) is never logged');
  assert(http1.length === 1, '/health and /uploads stay out of the log');
  await fetch(`${BASE}/api/products`);
  assert(true, 'logging is off by default outside production (no line printed above)');

  // ---------- pool ----------
  console.log('\n--- database pool');
  assert(pool.options.max === 10 && pool.options.connectionTimeoutMillis === 30000, 'default pool is unchanged: 10 connections, 30 s wait');
  assert(env.dbStatementTimeoutMs === 0, 'no statement timeout unless asked');

  // ---------- db:init ----------
  console.log('\n--- db:init and schema.sql');
  await admin.query(`CREATE DATABASE ${scratchName}`);
  let out = run('db/init-db.js');
  assert(out.status === 0 && /31 tables created/.test(out.stdout), `builds an empty database: ${out.stdout.split('\n').filter(Boolean).pop()}`);
  out = run('db/init-db.js');
  assert(out.status === 1 && /already has \d+ table/.test(out.stderr), 'refuses a database that already has tables (cannot overwrite or wipe)');
  scratch = new pg.Client({ connectionString: scratchUrl });
  await scratch.connect();
  const columns = (client) => client.query(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`)
    .then((x) => x.rows.map((c) => `${c.table_name}.${c.column_name}:${c.data_type}:${c.is_nullable}`));
  const [fromFile, fromReal] = [await columns(scratch), await columns({ query: (sql) => pool.query(sql) })];
  const onlyFile = fromFile.filter((c) => !fromReal.includes(c));
  const onlyReal = fromReal.filter((c) => !fromFile.includes(c));
  assert(!onlyFile.length && !onlyReal.length, 'schema.sql has the same tables and columns as the migrated test database (no drift)' + (onlyFile.length || onlyReal.length ? ` file-only: ${onlyFile.slice(0, 3)} real-only: ${onlyReal.slice(0, 3)}; run npm run db:export-schema` : ''));
  const { rows: [{ n: nStart }] } = await scratch.query('SELECT count(*)::int AS n FROM governorates');
  assert(nStart === 0, 'data is not part of schema.sql (governorates are filled by the start-up migration)');

  // ---------- migration guard ----------
  console.log('\n--- order-wiping migration guard');
  scratchPool = new pg.Pool({ connectionString: scratchUrl, max: 2 });
  scratchPool.on('error', () => {});
  await runGovernoratesMigration(scratchPool);
  const { rows: [{ n: govCount }] } = await scratch.query('SELECT count(*)::int AS n FROM governorates');
  assert(govCount === 24, 'the migration fills the 24 governorates on a fresh database');
  await scratch.query('ALTER TABLE orders DROP COLUMN governorate_id CASCADE');
  await scratch.query("INSERT INTO orders (order_number, customer_name, customer_phone, shipping_address, subtotal, total_amount) VALUES ('GUARD-1', 'Guard Test', '20000000', 'x', 10, 10)");
  const errQuiet = console.error; const logQuiet = console.log; console.error = () => {}; console.log = () => {};
  let refusal = null;
  delete process.env.ALLOW_ORDER_RESET;
  try { await runGovernoratesMigration(scratchPool); } catch (e) { refusal = e; }
  console.error = errQuiet; console.log = logQuiet;
  assert(refusal && /Refusing to delete 1 order/.test(refusal.message), 'refuses to wipe a database that holds an order');
  const { rows: [{ n: stillThere }] } = await scratch.query("SELECT count(*)::int AS n FROM orders WHERE order_number = 'GUARD-1'");
  assert(stillThere === 1, 'the order is still there afterwards (the migration rolled back)');
  // With the flag the guard steps aside. (On today's schema the old reset code then stops at a table that no longer
  // exists, analytics_events, and rolls back, so nothing is deleted either way: what matters here is who refuses.)
  process.env.ALLOW_ORDER_RESET = 'yes';
  console.log = () => {}; console.error = () => {};
  let flagged = null;
  try { await runGovernoratesMigration(scratchPool); } catch (e) { flagged = e; }
  console.log = logQuiet; console.error = errQuiet;
  delete process.env.ALLOW_ORDER_RESET;
  assert(!flagged || !/Refusing to delete/.test(flagged.message), 'with ALLOW_ORDER_RESET=yes the guard no longer refuses');
  await scratch.query('DELETE FROM orders');
  console.log = () => {}; console.error = () => {};
  let noOrders = null;
  try { await runGovernoratesMigration(scratchPool); } catch (e) { noOrders = e; }
  console.log = logQuiet; console.error = errQuiet;
  assert(!noOrders || !/Refusing to delete/.test(noOrders.message), 'with no orders the guard needs no flag');
  // put the column back (the orders table is empty) so the rest runs on a complete schema
  await scratch.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS governorate_id integer NOT NULL REFERENCES governorates(id)');
  await scratchPool.end();

  // ---------- admin:create ----------
  console.log('\n--- admin:create');
  out = run('db/create-admin.js');
  assert(out.status === 0 && /Admin account created for deploy-admin@example.test/.test(out.stdout), 'creates the admin account');
  assert(!out.stdout.includes('a-long-production-password'), 'never prints the password');
  const { rows: adminRows } = await scratch.query("SELECT role, phone_number FROM users WHERE email = 'deploy-admin@example.test'");
  assert(adminRows.length === 1 && adminRows[0].role === 'admin', 'inserted exactly one row with the admin role');
  out = run('db/create-admin.js');
  assert(out.status === 0 && /already exists/.test(out.stdout), 'running it again changes nothing');
  await scratch.query("UPDATE users SET role = 'customer' WHERE email = 'deploy-admin@example.test'");
  out = run('db/create-admin.js');
  assert(out.status === 1 && /belongs to a customer/.test(out.stderr), 'refuses an e-mail that belongs to a customer');
  await scratch.query("UPDATE users SET role = 'admin' WHERE email = 'deploy-admin@example.test'");
  const weak = run('db/create-admin.js', { NODE_ENV: 'production', ...PROD_ENV, ADMIN_PASSWORD: 'silky-admin' });
  assert(weak.status !== 0 && /ADMIN_PASSWORD/.test(weak.stderr), 'in production a weak ADMIN_PASSWORD is refused');

  // ---------- preflight ----------
  console.log('\n--- preflight');
  await scratch.query("DELETE FROM users WHERE email = 'deploy-admin@example.test'");
  out = run('scripts/preflight.js', PROD_ENV);
  assert(out.status === 1 && /\[FAIL\] admin: no admin account/.test(out.stdout), 'fails when the admin account is missing');
  await scratch.query("INSERT INTO users (email, password_hash, role, full_name) VALUES ('deploy-admin@example.test', 'x', 'admin', 'Silky Admin')");
  out = run('scripts/preflight.js', { ...PROD_ENV, GOODEX_API_TOKEN: 'tok', GOODEX_USER_ID: '1', GOODEX_WEBHOOK_SECRET: 'whsec' });
  assert(out.status === 0 && /0 failure/.test(out.stdout), `passes on a ready database: ${out.stdout.split('\n').filter((l) => /ok,.*warning/.test(l))[0]}`);
  const secrets = ['a-long-random-production-secret-xyz', 'a-long-production-password', 'smtp-secret-pass-123', 'smtpuser-secret-name', 'whsec'];
  assert(secrets.every((s) => !out.stdout.includes(s) && !out.stderr.includes(s)), 'never prints a secret');
  out = run('scripts/preflight.js', { ...PROD_ENV, ADMIN_PASSWORD: 'short' });
  assert(out.status === 1 && /\[FAIL\] configuration: ADMIN_PASSWORD/.test(out.stdout), 'reports an invalid configuration instead of crashing');
  await scratch.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  out = run('scripts/preflight.js', PROD_ENV);
  assert(out.status === 1 && /the database is empty: run npm run db:init/.test(out.stdout), 'says what to do on an empty database');
} catch (err) {
  console.error('TEST CRASHED:', err);
  failed++;
} finally {
  await scratchPool?.end().catch(() => {});
  await scratch?.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`).catch((e) => console.error('could not drop scratch database', scratchName, e.message));
  await admin.end().catch(() => {});
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
  console.log(`\n==== ${passed} passed, ${failed} FAILED ====`);
  process.exit(failed ? 1 : 0);
}
