/**
 * The publish trigger end to end, on silky_test: a change to what the public site shows makes the API call the deploy hook
 * ONCE (a burst of edits is one call), changes that do not alter the site call nothing, a failing hook is remembered and retried,
 * "publish now" and the status are admin-only, and the hook URL (a secret) never leaves the server.
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
process.env.PUBLISH_CHECK_DELAY_SECONDS = '1';
process.env.PUBLISH_HOOK_TIMEOUT_MS = '3000';

const SECRET = 'secrettoken1234567890';

// ---- the mock deploy hook ----
const hook = { calls: [], status: 200 };
const hookServer = http.createServer((req, res) => {
  hook.calls.push({ method: req.method, url: req.url });
  res.writeHead(hook.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ result: { id: 'build-1' } }));
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
const { publishWatcher } = await import('../server/middleware/publishWatcher.js');
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
/** Longer than the 1 s check delay plus the time a check takes. */
const settle = () => wait(2200);

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
  const call = async (pathname, { method = 'GET', body, token } = {}) => {
    const res = await fetch(`${api.url}/api${pathname}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  const reset = () => pool.query('UPDATE site_settings SET publish_hook_fingerprint = NULL, publish_hook_at = NULL, publish_hook_ok = NULL, publish_hook_message = NULL WHERE id = 1');
  await reset();
  theme0 = (await call('/theme')).json;
  const putTheme = (over = {}) => call('/theme', { method: 'PUT', token: adminToken, body: { ...theme0, ...over } });
  const hookCalls = () => hook.calls.length;
  const status = async () => (await call('/publish/status', { token: adminToken })).json;

  console.log('\n--- Status and publish-now are admin-only ---');
  await check('GET /api/publish/status: 401 without a token, 403 for a customer, 200 for an admin', async () => {
    assert.equal((await call('/publish/status')).status, 401);
    assert.equal((await call('/publish/status', { token: customerToken })).status, 403);
    const ok = await call('/publish/status', { token: adminToken });
    assert.equal(ok.status, 200);
    assert.match(ok.json.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(ok.json.hookConfigured, true);
    assert.equal(ok.json.lastHook, null);
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

  console.log('\n--- A change calls the hook once; no change calls nothing ---');
  await check('the first look after a write: the hook is called (POST, no body needed) and the result is remembered', async () => {
    assert.equal((await putTheme()).status, 200);
    await settle();
    assert.equal(hookCalls(), 1);
    assert.equal(hook.calls[0].method, 'POST');
    const s = await status();
    assert.ok(s.lastHook.ok && s.lastHook.forCurrentCatalogue && s.lastHook.message === 'HTTP 200');
  });
  await check('a write that changes nothing calls nothing', async () => {
    await putTheme();
    await settle();
    assert.equal(hookCalls(), 1);
  });
  await check('a visible change (the shop colour) calls the hook', async () => {
    await putTheme({ primary: '#112233' });
    await settle();
    assert.equal(hookCalls(), 2);
    assert.ok((await status()).lastHook.forCurrentCatalogue);
  });
  await check('a BURST of five edits within the delay is ONE call, for the final state', async () => {
    for (const colour of ['#111111', '#222222', '#333333', '#444444', '#555555']) await putTheme({ primary: colour });
    await settle();
    assert.equal(hookCalls(), 3, `calls: ${hookCalls()}`);
    assert.ok((await status()).lastHook.forCurrentCatalogue, 'the call was for the last state');
  });

  console.log('\n--- Stock: only selling out (or coming back) starts a build ---');
  const variants = (await pool.query('SELECT id, stock_quantity FROM product_variants WHERE product_id = $1 ORDER BY id', [fixtures.robe.id])).rows;
  await check('an order that leaves the product in stock calls nothing', async () => {
    const before = hookCalls();
    // every variant keeps stock: raise them all to at least 5 first (that may itself change the site: settle), then take 1
    await pool.query('UPDATE product_variants SET stock_quantity = 9 WHERE product_id = $1', [fixtures.robe.id]);
    await putTheme({ primary: '#555555' });
    await settle();
    const afterRestock = hookCalls();
    await pool.query('UPDATE product_variants SET stock_quantity = stock_quantity - 1 WHERE product_id = $1', [fixtures.robe.id]);
    await putTheme({ primary: '#555555' });
    await settle();
    assert.equal(hookCalls(), afterRestock, `a decrement that keeps stock must not call the hook (before ${before}, after restock ${afterRestock}, now ${hookCalls()})`);
  });
  await check('selling the last item of every variant calls the hook; restocking calls it again', async () => {
    const before = hookCalls();
    await pool.query('UPDATE product_variants SET stock_quantity = 0 WHERE product_id = $1', [fixtures.robe.id]);
    await putTheme({ primary: '#555555' });
    await settle();
    assert.equal(hookCalls(), before + 1, 'sold out');
    await pool.query('UPDATE product_variants SET stock_quantity = 4 WHERE product_id = $1', [fixtures.robe.id]);
    await putTheme({ primary: '#555555' });
    await settle();
    assert.equal(hookCalls(), before + 2, 'back in stock');
  });

  console.log('\n--- Moderating a review, hiding a product ---');
  const [{ id: reviewId }] = (await pool.query('SELECT id FROM reviews WHERE product_id = $1', [fixtures.robe.id])).rows;
  await check('un-approving then approving a product review: each calls the hook (through the real admin route)', async () => {
    const before = hookCalls();
    assert.equal((await call(`/products/reviews/${reviewId}`, { method: 'PATCH', token: adminToken, body: { status: 'pending' } })).status, 200);
    await settle();
    assert.equal(hookCalls(), before + 1);
    assert.equal((await call(`/products/reviews/${reviewId}`, { method: 'PATCH', token: adminToken, body: { status: 'approved' } })).status, 200);
    await settle();
    assert.equal(hookCalls(), before + 2);
  });
  await check('hiding a product calls the hook (and showing it again)', async () => {
    const before = hookCalls();
    await pool.query('UPDATE products SET is_active = false WHERE id = $1', [fixtures.chemise.id]);
    await putTheme({ primary: '#555555' });
    await settle();
    assert.equal(hookCalls(), before + 1);
    await pool.query('UPDATE products SET is_active = true WHERE id = $1', [fixtures.chemise.id]);
    await putTheme({ primary: '#555555' });
    await settle();
    assert.equal(hookCalls(), before + 2);
  });

  console.log('\n--- The hook fails ---');
  await check('a hook answering 500 is remembered as failed, retried by the next look, and stops being retried once it works', async () => {
    hook.status = 500;
    const before = hookCalls();
    await putTheme({ primary: '#666666' });
    await settle();
    assert.equal(hookCalls(), before + 1);
    let s = await status();
    assert.ok(s.lastHook.ok === false && s.lastHook.message === 'HTTP 500' && s.lastHook.forCurrentCatalogue === true);
    await putTheme({ primary: '#666666' }); // nothing changed, but the last call failed: look again
    await settle();
    assert.equal(hookCalls(), before + 2, 'retried although the catalogue did not change again');
    hook.status = 200;
    await putTheme({ primary: '#666666' });
    await settle();
    assert.equal(hookCalls(), before + 3, 'succeeded');
    assert.ok((await status()).lastHook.ok);
    await putTheme({ primary: '#666666' });
    await settle();
    assert.equal(hookCalls(), before + 3, 'and no more calls once it worked');
  });

  console.log('\n--- Publish now ---');
  await check('POST /api/publish calls the hook even though nothing changed, and answers the fingerprint', async () => {
    const before = hookCalls();
    const res = await call('/publish', { method: 'POST', token: adminToken });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.match(res.json.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(hookCalls(), before + 1);
  });
  await check('a hook that cannot be reached: 502 with the reason, never the URL; the failure is remembered', async () => {
    const realUrl = env.publish.hookUrl;
    env.publish.hookUrl = 'http://127.0.0.1:9/hooks/' + SECRET; // nothing listens on port 9
    const res = await call('/publish', { method: 'POST', token: adminToken });
    env.publish.hookUrl = realUrl;
    assert.equal(res.status, 502);
    assert.match(res.json.error, /no connection|timeout/);
    assert.ok(!res.text.includes(SECRET) && !res.text.includes('127.0.0.1'));
    assert.equal((await status()).lastHook.ok, false);
  });
  await check('no hook configured: publish-now answers 409, the status says so, and a write schedules nothing', async () => {
    const realUrl = env.publish.hookUrl;
    env.publish.hookUrl = '';
    try {
      const before = hookCalls();
      const res = await call('/publish', { method: 'POST', token: adminToken });
      assert.equal(res.status, 409);
      assert.match(res.json.error, /PUBLISH_HOOK_URL/);
      assert.equal((await status()).hookConfigured, false);
      publishService._resetPublishState();
      assert.equal(publishService.scheduleCheck(), false);
      await putTheme({ primary: '#777777' });
      await settle();
      assert.equal(hookCalls(), before, 'nothing was called');
    } finally {
      env.publish.hookUrl = realUrl;
    }
  });

  console.log('\n--- Which requests are looked at ---');
  await check('the watcher: a successful product/order/theme write schedules a look; reads, failures, cart, sign-in, favourites, contact, notifications do not', async () => {
    const trial = (method, reqPath, statusCode) => {
      publishService._resetPublishState();
      let onFinish = () => {};
      const res = { statusCode, on: (event, fn) => event === 'finish' && (onFinish = fn) };
      publishWatcher({ method, path: reqPath }, res, () => {});
      onFinish();
      const scheduled = publishService._checkScheduled();
      publishService._resetPublishState();
      return scheduled;
    };
    for (const [method, p] of [['POST', '/orders/checkout'], ['PUT', '/products/abc'], ['DELETE', '/products/abc'], ['PUT', '/theme'], ['PATCH', '/orders/1/status'], ['POST', '/products/abc/videos']]) assert.equal(trial(method, p, 200), true, `${method} ${p}`);
    for (const [method, p, code] of [['GET', '/products', 200], ['PUT', '/theme', 400], ['PUT', '/theme', 500], ['POST', '/cart/items', 200], ['POST', '/auth/login', 200], ['POST', '/favourites/toggle', 200], ['POST', '/contact', 200], ['PATCH', '/notifications/1/read', 200], ['POST', '/publish', 200], ['OPTIONS', '/products', 204]]) assert.equal(trial(method, p, code), false, `${method} ${p} ${code}`);
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
    await pool.query('UPDATE site_settings SET publish_hook_fingerprint = NULL, publish_hook_at = NULL, publish_hook_ok = NULL, publish_hook_message = NULL WHERE id = 1');
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
