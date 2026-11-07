/**
 * The publish BUTTON end to end, on silky_test: nothing in the API starts a build by itself (edits, orders, reviews, stock), the
 * button (POST /api/publish) calls the deploy hook exactly once, a second click while the first call is on its way is not a second
 * call, a failing hook is reported and retried by pressing again, the monthly counter only counts accepted calls and starts again
 * each month, the status and the button are admin-only, and the hook URL (a secret) never leaves the server.
 *
 * The hook is a local mock server. The theme is saved back at the end and the publish settings of the test database are reset.
 * Safety: refuses to run unless DATABASE_URL is exactly the silky_test database on a loopback host.
 *
 * Usage: DATABASE_URL=postgres://.../silky_test node integration/test_publish_trigger.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { assertSilkyTestUrl } from '../server/scripts/helpers/silky_test_guard.js';
import { importFromServer } from './lib/server_deps.mjs';

assertSilkyTestUrl();
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:4321';
process.env.GOODEX_ENABLE_LIVE = 'false';
process.env.GOODEX_BASE_URL = 'http://127.0.0.1:1';
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-publish-uploads-'));
process.env.PUBLISH_HOOK_TIMEOUT_MS = '3000';

const SECRET = 'secrettoken1234567890';

// ---- the mock deploy hook ----
const hook = { calls: [], status: 200, delayMs: 0 };
const hookServer = http.createServer((req, res) => {
  hook.calls.push({ method: req.method, url: req.url });
  setTimeout(() => {
    res.writeHead(hook.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: { id: 'build-1' } }));
  }, hook.delayMs);
});
await new Promise((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
const hookUrl = `http://127.0.0.1:${hookServer.address().port}/hooks/${SECRET}`;
process.env.PUBLISH_HOOK_URL = hookUrl;

// Everything the server prints, to prove the secret never appears in it.
const printed = [];
for (const name of ['log', 'warn', 'error']) {
  const original = console[name].bind(console);
  console[name] = (...args) => {
    printed.push(args.map(String).join(' '));
    original(...args);
  };
}

const { startApi, createFixtures } = await import('./lib/fixtures.mjs');
const { createAccount, removeAccounts } = await import('../server/scripts/helpers/test_accounts.js');
const { pool } = await import('../server/db/pool.js');
const { env } = await import('../server/config/env.js');
const publishService = await import('../server/services/publish.service.js');
const { _resetRateLimits } = await import('../server/middleware/rateLimiter.js');
const { default: jwt } = await importFromServer('jsonwebtoken');
const { runPublishStateMigration } = await import('../server/db/migrations/add_publish_state.js');

let passed = 0;
let failed = 0;
const seenBodies = [];
async function check(label, fn) {
  try {
    await fn();
    console.log(`✓ PASS: ${label}`);
    passed++;
  } catch (err) {
    console.error(`✗ FAIL: ${label}\n   ${String(err.message).split('\n').join('\n   ')}`);
    failed++;
  }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let api;
let fixtures;
let theme0;
try {
  api = await startApi(0);
  fixtures = await createFixtures();
  const customerId = await createAccount(pool, 'customer', 'publish-test');
  const adminId = await createAccount(pool, 'admin', 'publish-test');
  const sign = (id, role) => jwt.sign({ sub: id, email: `${role}@publish-test.invalid`, role }, env.jwtSecret, { expiresIn: 900 });
  const adminToken = sign(adminId, 'admin');
  const customerToken = sign(customerId, 'customer');
  const call = async (pathname, { method = 'GET', body, token, headers = {} } = {}) => {
    const res = await fetch(`${api.url}/api${pathname}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    seenBodies.push(text);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  };
  await runPublishStateMigration(pool); // idempotent; the start-up migration of the API does the same on a real database
  const reset = () => pool.query('UPDATE site_settings SET publish_hook_fingerprint = NULL, publish_hook_at = NULL, publish_hook_ok = NULL, publish_hook_message = NULL, publish_month = NULL, publish_month_count = NULL WHERE id = 1');
  await reset();
  theme0 = (await call('/theme')).json;
  const putTheme = (over = {}) => call('/theme', { method: 'PUT', token: adminToken, body: { ...theme0, ...over } });
  const hookCalls = () => hook.calls.length;
  const status = async () => (await call('/publish/status', { token: adminToken })).json;
  // The button is limited to 6 presses a minute per IP; the tests press far more, so each press starts with a fresh count
  // (one test below checks the limit itself).
  const press = () => {
    _resetRateLimits();
    return call('/publish', { method: 'POST', token: adminToken });
  };

  console.log('\n--- Status and the button are admin-only ---');
  await check('GET /api/publish/status: 401 without a token, 403 for a customer, 200 for an admin', async () => {
    assert.equal((await call('/publish/status')).status, 401);
    assert.equal((await call('/publish/status', { token: customerToken })).status, 403);
    const ok = await call('/publish/status', { token: adminToken });
    assert.equal(ok.status, 200);
    assert.match(ok.json.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(ok.json.hookConfigured, true);
    assert.equal(ok.json.lastHook, null);
    assert.deepEqual(ok.json.builds, { month: new Date().toISOString().slice(0, 7), thisMonth: 0, limit: 500 });
  });
  await check('POST /api/publish: 401 without a token, 403 for a customer (and nothing was called)', async () => {
    assert.equal((await call('/publish', { method: 'POST' })).status, 401);
    assert.equal((await call('/publish', { method: 'POST', token: customerToken })).status, 403);
    assert.equal(hookCalls(), 0);
  });
  await check('the snapshot and the status agree on the fingerprint, and it is stable between calls', async () => {
    const a = (await call('/storefront/snapshot')).json.fingerprint;
    const b = (await call('/storefront/snapshot')).json.fingerprint;
    assert.equal(a, b);
    assert.equal((await status()).fingerprint, a);
  });

  console.log('\n--- NOTHING publishes by itself ---');
  await check('edits, orders, stock and review changes call the hook zero times, and the status says the site is behind', async () => {
    const fingerprint0 = (await status()).fingerprint;
    // a visible theme change, a product hidden and shown, the last units sold, a review un-approved
    assert.equal((await putTheme({ primary: '#112233' })).status, 200);
    await pool.query('UPDATE products SET is_active = false WHERE id = $1', [fixtures.chemise.id]);
    await call(`/admin/inventory/${(await pool.query('SELECT id FROM product_variants WHERE product_id = $1 LIMIT 1', [fixtures.robe.id])).rows[0].id}`, { method: 'PATCH', token: adminToken, body: { stockQuantity: 0 } });
    const [{ id: reviewId }] = (await pool.query('SELECT id FROM reviews WHERE product_id = $1', [fixtures.robe.id])).rows;
    assert.equal((await call(`/products/reviews/${reviewId}`, { method: 'PATCH', token: adminToken, body: { status: 'pending' } })).status, 200);
    await wait(2500); // longer than any waiting period the old automatic publishing used (30 s default was 1 s in the old tests)
    assert.equal(hookCalls(), 0, 'no edit may start a build');
    const s = await status();
    assert.notEqual(s.fingerprint, fingerprint0, 'the live catalogue changed');
    assert.equal(s.lastHook, null, 'and the hook was never called');
    await pool.query('UPDATE products SET is_active = true WHERE id = $1', [fixtures.chemise.id]);
    await call(`/products/reviews/${reviewId}`, { method: 'PATCH', token: adminToken, body: { status: 'approved' } });
  });
  await check('a restart of the API (a fresh start of the app) calls nothing either', async () => {
    publishService._resetPublishState();
    await wait(300);
    assert.equal(hookCalls(), 0);
    assert.equal(typeof publishService.scheduleCheck, 'undefined', 'the timer is gone');
    assert.equal(typeof publishService.scheduleStartupCheck, 'undefined', 'and so is the start-up look');
  });

  console.log('\n--- The button: one press, one call ---');
  await check('pressing the button calls the hook once (POST), remembers it for the current catalogue and counts it', async () => {
    const res = await press();
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.match(res.json.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(hookCalls(), 1);
    assert.equal(hook.calls[0].method, 'POST');
    const s = await status();
    assert.ok(s.lastHook.ok && s.lastHook.forCurrentCatalogue && s.lastHook.message === 'HTTP 200');
    assert.equal(s.builds.thisMonth, 1);
  });
  await check('one press covers every edit made before it (many edits, one call)', async () => {
    const before = hookCalls();
    for (const colour of ['#111111', '#222222', '#333333', '#444444', '#555555']) await putTheme({ primary: colour });
    assert.equal(hookCalls(), before, 'five edits, nothing called');
    assert.equal((await press()).status, 200);
    assert.equal(hookCalls(), before + 1, 'one press, one call');
    assert.ok((await status()).lastHook.forCurrentCatalogue);
  });
  await check('pressing again when nothing changed still works (the button is always there) and is counted', async () => {
    const before = hookCalls();
    assert.equal((await press()).status, 200);
    assert.equal(hookCalls(), before + 1);
    assert.equal((await status()).builds.thisMonth, 3);
  });
  await check('a double click (two presses while the first call is on its way) is ONE call, both get the answer', async () => {
    hook.delayMs = 800;
    const before = hookCalls();
    const countBefore = (await status()).builds.thisMonth;
    const [a, b] = await Promise.all([press(), press()]);
    hook.delayMs = 0;
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(hookCalls(), before + 1, 'one call');
    assert.equal((await status()).builds.thisMonth, countBefore + 1, 'counted once');
    // and the guard does not stay stuck: a later press works
    assert.equal((await press()).status, 200);
  });

  console.log('\n--- The hook fails ---');
  await check('a hook answering 500: 502 with the reason, remembered as failed, NOT counted; pressing again is the retry', async () => {
    const counted = (await status()).builds.thisMonth;
    hook.status = 500;
    const before = hookCalls();
    const res = await press();
    assert.equal(res.status, 502);
    assert.match(res.json.error, /HTTP 500/);
    assert.equal(hookCalls(), before + 1);
    const s = await status();
    assert.ok(s.lastHook.ok === false && s.lastHook.message === 'HTTP 500' && s.lastHook.forCurrentCatalogue === true);
    assert.equal(s.builds.thisMonth, counted, 'a failed call starts no build, so it is not counted');
    hook.status = 200;
    assert.equal((await press()).status, 200);
    const after = await status();
    assert.ok(after.lastHook.ok);
    assert.equal(after.builds.thisMonth, counted + 1);
  });
  await check('a hook that cannot be reached: 502 with the reason, never the URL; the failure is remembered', async () => {
    const realUrl = env.publish.hookUrl;
    env.publish.hookUrl = 'http://127.0.0.1:9/hooks/' + SECRET; // nothing listens on port 9
    const res = await press();
    env.publish.hookUrl = realUrl;
    assert.equal(res.status, 502);
    assert.match(res.json.error, /no connection|timeout/);
    assert.ok(!res.text.includes(SECRET) && !res.text.includes('127.0.0.1'));
    assert.equal((await status()).lastHook.ok, false);
  });
  await check('no hook configured: the button answers 409 naming the setting, the status says so, nothing is called', async () => {
    const realUrl = env.publish.hookUrl;
    env.publish.hookUrl = '';
    try {
      const before = hookCalls();
      const res = await press();
      assert.equal(res.status, 409);
      assert.match(res.json.error, /PUBLISH_HOOK_URL/);
      assert.equal((await status()).hookConfigured, false);
      assert.equal(hookCalls(), before);
    } finally {
      env.publish.hookUrl = realUrl;
    }
  });

  await check('the button is rate limited (6 presses a minute): the 7th is refused with 429 and calls nothing', async () => {
    _resetRateLimits();
    const before = hookCalls();
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await call('/publish', { method: 'POST', token: adminToken })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429]);
    assert.equal(hookCalls(), before + 6);
    _resetRateLimits();
  });

  console.log('\n--- The monthly counter ---');
  await check('the counter starts again each month: a count kept from another month shows as 0 and the next accepted call makes it 1', async () => {
    await pool.query("UPDATE site_settings SET publish_month = '2000-01', publish_month_count = 7 WHERE id = 1");
    assert.equal((await status()).builds.thisMonth, 0, 'last month does not count');
    assert.equal((await press()).status, 200);
    const s = await status();
    assert.equal(s.builds.thisMonth, 1);
    assert.equal(s.builds.month, new Date().toISOString().slice(0, 7));
  });
  await check('the allowance shown is the one set on the API (PUBLISH_MONTHLY_BUILD_LIMIT)', async () => {
    const realLimit = env.publish.monthlyBuildLimit;
    env.publish.monthlyBuildLimit = 120;
    try {
      assert.equal((await status()).builds.limit, 120);
    } finally {
      env.publish.monthlyBuildLimit = realLimit;
    }
  });

  console.log('\n--- The hook URL is a secret ---');
  await check('it appears in no response and in nothing the server printed', async () => {
    assert.ok(seenBodies.every((text) => !text.includes(SECRET) && !text.includes('/hooks/')), 'a response mentions the hook URL');
    const leaked = printed.filter((line) => line.includes(SECRET) || line.includes('/hooks/'));
    assert.deepEqual(leaked, [], 'the server printed the hook URL');
    assert.ok(printed.some((line) => /\[publish\] deploy hook (called|FAILED)/.test(line)), 'the outcome is logged (without the URL)');
  });
} catch (err) {
  failed++;
  console.error('✗ FAIL: unexpected error:', err);
} finally {
  publishService._resetPublishState();
  try {
    if (theme0) {
      const adminId = await createAccount(pool, 'admin', 'publish-test-restore');
      await fetch(`${api.url}/api/theme`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: adminId, email: 'x@publish-test.invalid', role: 'admin' }, env.jwtSecret, { expiresIn: 60 })}` }, body: JSON.stringify(theme0) });
    }
    await pool.query('UPDATE site_settings SET publish_hook_fingerprint = NULL, publish_hook_at = NULL, publish_hook_ok = NULL, publish_hook_message = NULL, publish_month = NULL, publish_month_count = NULL WHERE id = 1');
    await pool.query('UPDATE product_variants SET stock_quantity = stock_quantity WHERE false');
  } catch (err) {
    console.error('cleanup (theme, publish state):', err.message);
  }
  await removeAccounts(pool).catch(() => {});
  if (fixtures) console.log((await fixtures.cleanup().catch(() => false)) ? 'Fixtures removed.' : 'WARNING: fixtures left behind.');
  if (api) await api.stop().catch(() => {});
  hookServer.closeAllConnections?.();
  await new Promise((resolve) => hookServer.close(resolve));
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200);
}
