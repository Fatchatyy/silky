/**
 * Pre-launch check of ONE environment (npm run preflight): "is this server, with this configuration and this database,
 * ready to serve customers?" Run it on the host with the production variables set, before the first start and after
 * every deploy.
 *
 * It only reads: it connects to the database with SELECT queries and looks at files. It sends no e-mail, calls no
 * external service, and never prints a secret (only whether it is set). Exit code 1 when any check FAILS.
 *
 * Usage (on the host, with the production environment): NODE_ENV=production npm run preflight
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

const results = [];
const add = (level, area, text) => {
  results.push({ level, area, text });
  console.log(`${{ ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[info]' }[level]} ${area}: ${text}`);
};

let env;
try {
  ({ env } = await import('../config/env.js'));
} catch (err) {
  // env.js stops on an invalid or missing required setting (JWT secret, CORS, database, admin password...).
  add('fail', 'configuration', String(err.message).replace(/^.*?\[FATAL\]\s*/, ''));
  console.log('\nFix the setting above first; the other checks need a valid configuration.');
  process.exit(1);
}

const isProd = env.isProduction;
add(isProd ? 'ok' : 'warn', 'mode', isProd ? 'NODE_ENV=production' : `NODE_ENV=${env.nodeEnv}: run with NODE_ENV=production to check what the live server will really use`);
add('ok', 'configuration', 'JWT secret, CORS origins, database url and admin password pass the server\'s own start-up checks');

// ---------- configuration ----------
const looksLocal = (value) => /localhost|127\.0\.0\.1|yourdomain|example\.(com|tn)/i.test(value || '');
const urlCheck = (name, value, { required = true } = {}) => {
  if (!value) return add(required ? 'warn' : 'info', 'configuration', `${name} is not set`);
  if (looksLocal(value)) return add('warn', 'configuration', `${name} still looks like a placeholder or local address (${new URL(value, 'http://x').host})`);
  if (!/^https:\/\//i.test(value)) return add('warn', 'configuration', `${name} is not https`);
  add('ok', 'configuration', `${name} is ${value}`);
};
urlCheck('SITE_URL', env.seo.siteUrl);
urlCheck('APP_URL', process.env.APP_URL);
const origins = env.corsAllowedOrigins;
const badOrigin = origins.filter((o) => looksLocal(o) || !/^https:\/\//i.test(o));
add(badOrigin.length ? 'warn' : 'ok', 'configuration', badOrigin.length ? `CORS_ALLOWED_ORIGINS has local or non-https entries: ${badOrigin.join(', ')}` : `CORS_ALLOWED_ORIGINS: ${origins.join(', ')}`);
add(env.trustProxy ? 'ok' : 'warn', 'configuration', env.trustProxy ? `TRUST_PROXY=${env.trustProxy}` : 'TRUST_PROXY is not set: behind a reverse proxy every visitor would share one address for the rate limiters');
add(env.seo.htmlEnabled ? 'ok' : 'warn', 'configuration', env.seo.htmlEnabled ? 'SEO_HTML=on' : 'SEO_HTML is not "on": page titles, canonical links, robots.txt and sitemap.xml are not written for search engines');
add(env.cspMode === 'enforce' ? 'ok' : 'info', 'configuration', `CSP_MODE=${env.cspMode}${env.cspMode === 'report-only' ? ' (blocks nothing; switch to enforce after browsing the live site with no report)' : ''}`);
add(env.smtpUser && env.smtpPass ? 'ok' : 'fail', 'e-mail', env.smtpUser && env.smtpPass ? `SMTP credentials set (host ${env.smtpHost}:${env.smtpPort})` : 'SMTP_USER / SMTP_PASS missing: no order confirmation, password reset, welcome or contact reply e-mail would be sent');
add(/yourdomain|silky\.tn|@/.test(env.emailFrom) && !/yourdomain/.test(env.emailFrom) ? 'ok' : 'warn', 'e-mail', /yourdomain/.test(env.emailFrom) ? 'EMAIL_FROM still has the placeholder domain' : 'EMAIL_FROM is set');
const g = env.goodex;
const goodexMissing = [!g.apiToken && 'GOODEX_API_TOKEN', !g.userId && 'GOODEX_USER_ID', !g.webhookSecret && 'GOODEX_WEBHOOK_SECRET'].filter(Boolean);
add(goodexMissing.length ? 'warn' : 'ok', 'GOODEX', goodexMissing.length ? `not set: ${goodexMissing.join(', ')} (confirming an order still works; its parcel is recorded as failed until configured)` : 'API token, user id and webhook secret are set');
if (g.apiToken && g.webhookSecret && g.apiToken === g.webhookSecret) add('fail', 'GOODEX', 'GOODEX_WEBHOOK_SECRET must differ from GOODEX_API_TOKEN');
add(g.enableLive ? 'ok' : (isProd ? 'warn' : 'info'), 'GOODEX', g.enableLive ? 'GOODEX_ENABLE_LIVE=true (real parcels will be created)' : 'GOODEX_ENABLE_LIVE is not true: no real parcel will be created');
add(g.poll.intervalMinutes > 0 ? 'ok' : 'info', 'background jobs', g.poll.intervalMinutes > 0 ? `GOODEX status reconciliation every ${g.poll.intervalMinutes} min (run it on ONE instance only)` : 'GOODEX status reconciliation is off (GOODEX_POLL_INTERVAL_MINUTES unset): statuses change only by webhook or manual refresh');

// ---------- files ----------
const dist = env.seo.distDir;
add(fs.existsSync(path.join(dist, 'index.html')) ? 'ok' : 'fail', 'frontend', fs.existsSync(path.join(dist, 'index.html')) ? `built storefront found (${path.relative(root, dist) || dist})` : `no built storefront at ${dist}: run npm run build`);
const uploads = env.uploadsDir;
const insideApp = path.resolve(uploads).startsWith(root + path.sep);
try {
  fs.mkdirSync(uploads, { recursive: true });
  fs.accessSync(uploads, fs.constants.W_OK);
  add(insideApp && isProd ? 'warn' : 'ok', 'uploads', insideApp && isProd
    ? `${uploads} is inside the app folder: most hosts wipe it on every deploy. Set UPLOADS_DIR to a persistent disk`
    : `${uploads} is writable`);
} catch (err) {
  add('fail', 'uploads', `${uploads} is not writable (${err.code || err.message})`);
}

// ---------- database ----------
const { pool } = await import('../db/pool.js');
try {
  const started = Date.now();
  const { rows: [meta] } = await pool.query('SELECT current_database() AS db, version() AS version');
  add('ok', 'database', `connected to "${meta.db}" in ${Date.now() - started} ms (${meta.version.split(' ').slice(0, 2).join(' ')})`);
  if (/test|dev|local|staging/i.test(meta.db) && isProd) add('warn', 'database', `the database is named "${meta.db}": make sure this is the production database`);
  if (looksLocal(env.databaseUrl.replace(/^[^@]*@/, '')) && isProd) add('warn', 'database', 'DATABASE_URL points at localhost: fine only if the database really runs on this server');
  add(/sslmode=|ssl=true/.test(env.databaseUrl) || /localhost|127\.0\.0\.1/.test(env.databaseUrl) ? 'ok' : 'warn', 'database', /sslmode=|ssl=true/.test(env.databaseUrl) ? 'the connection asks for SSL' : (/localhost|127\.0\.0\.1/.test(env.databaseUrl) ? 'local connection' : 'DATABASE_URL has no sslmode: add ?sslmode=require if the database is on another machine'));
  add('info', 'database', `pool: ${env.dbPoolMax} connections max, ${env.dbConnectionTimeoutMs} ms wait${env.dbStatementTimeoutMs ? `, ${env.dbStatementTimeoutMs} ms per query` : ''}: keep it below your database plan's connection limit`);

  // all tables of schema.sql exist
  const schemaSql = fs.readFileSync(path.join(root, 'server/db/schema.sql'), 'utf8');
  const expected = [...schemaSql.matchAll(/^CREATE TABLE public\.(\w+)/gm)].map((m) => m[1]);
  const { rows: tableRows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  const have = new Set(tableRows.map((r) => r.table_name));
  const missing = expected.filter((t) => !have.has(t));
  if (missing.length === expected.length) {
    add('fail', 'schema', 'the database is empty: run npm run db:init, start the server once, then npm run admin:create');
  } else {
    add(missing.length ? 'fail' : 'ok', 'schema', missing.length ? `missing tables: ${missing.join(', ')} (older or partial database?)` : `all ${expected.length} tables exist`);
  }

  if (!missing.length) {
    const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
    const gov = await one('SELECT count(*)::int AS n FROM governorates');
    add(gov.n >= 24 ? 'ok' : 'fail', 'schema', gov.n >= 24 ? `${gov.n} governorates` : `governorates list has ${gov.n} rows: start the server once so its start-up migrations fill it`);
    const cols = await one(`SELECT
        bool_or(table_name = 'orders' AND column_name = 'governorate_id') AS gov,
        bool_or(table_name = 'users' AND column_name = 'tokens_valid_after') AS tok
      FROM information_schema.columns WHERE table_schema = 'public'`);
    add(cols.gov && cols.tok ? 'ok' : 'fail', 'schema', cols.gov && cols.tok ? 'the latest start-up migrations are applied' : 'start-up migrations are pending: start the server once');

    const admin = await one("SELECT count(*)::int AS n FROM users WHERE email = $1 AND role = 'admin'", [env.adminEmail.trim().toLowerCase()]);
    add(admin.n ? 'ok' : 'fail', 'admin', admin.n ? `admin account exists for ${env.adminEmail}` : `no admin account for ${env.adminEmail}: run npm run admin:create`);

    // what is in the database (also the numbers to compare after a restore test)
    const c = await one(`SELECT
        (SELECT count(*)::int FROM users WHERE role = 'customer') AS customers,
        (SELECT count(*)::int FROM users WHERE role = 'admin') AS admins,
        (SELECT count(*)::int FROM products) AS products,
        (SELECT count(*)::int FROM products WHERE is_active) AS active_products,
        (SELECT count(*)::int FROM orders) AS orders`);
    add('info', 'data', `${c.customers} customers, ${c.admins} admin(s), ${c.products} products (${c.active_products} published), ${c.orders} orders`);

    // leftovers of development
    const testProducts = await one("SELECT count(*)::int AS n FROM products WHERE title ~* '(test|exemple|example|demo|sample|lorem|evil|concurrence|preservation)'");
    add(testProducts.n ? 'warn' : 'ok', 'sample data', testProducts.n ? `${testProducts.n} product(s) look like test or sample data (name contains test, example, demo...)` : 'no product looks like test data');
    const testUsers = await one("SELECT count(*)::int AS n FROM users WHERE email ~* '(@silky\\.test|\\.test$|\\.invalid$|@example\\.|@test\\.|visibility|privacy|customers-only)'");
    add(testUsers.n ? 'warn' : 'ok', 'sample data', testUsers.n ? `${testUsers.n} account(s) look like test accounts (test, example or .invalid e-mail)` : 'no account looks like a test account');
    const demoOrders = await one("SELECT count(*)::int AS n FROM orders WHERE customer_name ~* '(test|demo|sample)'");
    add(demoOrders.n ? 'warn' : 'ok', 'sample data', demoOrders.n ? `${demoOrders.n} order(s) look like test orders` : 'no order looks like a test order');

    // files the database points at
    const { rows: refs } = await pool.query(`
      SELECT DISTINCT url FROM (
        SELECT image_url AS url FROM product_images
        UNION ALL SELECT color_image_url FROM product_variants
        UNION ALL SELECT collection_image_url FROM products
        UNION ALL SELECT video_url FROM product_videos
        UNION ALL SELECT hero_left_image FROM site_settings
        UNION ALL SELECT hero_right_image FROM site_settings
      ) u WHERE url LIKE '/uploads/%' OR url LIKE '/pictures/%'`);
    const absent = refs.map((r) => r.url).filter((url) => {
      const file = url.startsWith('/uploads/') ? path.join(uploads, url.slice('/uploads/'.length)) : path.join(root, 'public', url.slice(1));
      return !fs.existsSync(file);
    });
    add(absent.length ? 'warn' : 'ok', 'files', absent.length
      ? `${absent.length} image/video file(s) referenced by the database are missing on disk, for example ${absent.slice(0, 3).join(', ')}`
      : `all ${refs.length} image/video files referenced by the database exist`);
  }
} catch (err) {
  add('fail', 'database', `cannot query the database: ${err.message}`);
} finally {
  await pool.end().catch(() => {});
}

const count = (level) => results.filter((r) => r.level === level).length;
console.log(`\n${count('ok')} ok, ${count('warn')} warning(s), ${count('fail')} failure(s).`);
if (count('fail')) console.log('Not ready: fix every [FAIL] first.');
else if (count('warn')) console.log('Ready to start, but read each [WARN]: some are expected on a first deploy.');
else console.log('Ready.');
process.exit(count('fail') ? 1 : 0);
