/**
 * GET /ping and the keep-awake Worker (server/keepalive).
 *
 * Hermetic: no real database (the pool is made to fail on purpose), no network (fetch is replaced by a fake), nothing
 * is sent to Render or Cloudflare. Proves that:
 *  - /ping answers `{ ok: true }` without a database query, without a cookie, uncached, and is not written to the log;
 *  - the Worker only pings inside 07:00 to midnight Tunis time, whatever the UTC cron tick, and fails loudly when the
 *    API answers wrongly.
 *
 * Usage: node server/scripts/test_ping_keepalive.js
 */
process.env.NODE_ENV = 'test';
process.env.LOG_REQUESTS = 'true';
await import('../config/env.js');
const { app } = await import('../app.js');
const { pool } = await import('../db/pool.js');
const { isInsideWindow, readWindow, hourIn, DEFAULT_WINDOW } = await import('../keepalive/src/window.js');
const worker = await import('../keepalive/src/index.js');

let pass = 0;
let fail = 0;
function assert(condition, label) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.error(`  FAIL: ${label}`);
  }
}

// ---- 1. the API route ----------------------------------------------------------------
let queries = 0;
pool.query = async () => {
  queries += 1;
  throw new Error('the database must not be used by /ping');
};
const logged = [];
const originalLog = console.log;
console.log = (...args) => logged.push(args.join(' '));

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const ping = await fetch(`${base}/ping`);
const body = await ping.json();
const head = await fetch(`${base}/ping`, { method: 'HEAD' });
await fetch(`${base}/`); // a normal route is logged, so the log capture is proven to work
await new Promise((resolve) => setTimeout(resolve, 50));
console.log = originalLog;

assert(ping.status === 200 && body.ok === true && Object.keys(body).length === 1, '/ping answers 200 {ok:true} and nothing else');
assert(head.status === 200, 'HEAD /ping answers 200 (uptime monitors use it)');
assert(queries === 0, '/ping runs no database query');
assert(!ping.headers.get('set-cookie'), '/ping sets no cookie');
assert(ping.headers.get('cache-control') === 'no-store', '/ping is never cached');
assert(!logged.some((line) => line.includes('/ping')), '/ping is not written to the request log');
assert(logged.some((line) => line.includes('GET /')), 'the log capture works (a normal request was logged)');
await new Promise((resolve) => server.close(resolve));

// ---- 2. the opening hours (Tunis is UTC+1 all year) -----------------------------------
const at = (iso) => Date.parse(iso);
assert(hourIn(at('2026-11-07T06:00:00Z'), 'Africa/Tunis') === 7, '06:00 UTC is 07:00 in Tunis');
assert(isInsideWindow(at('2026-11-07T05:50:00Z')) === false, '06:50 Tunis: before opening, skipped');
assert(isInsideWindow(at('2026-11-07T06:00:00Z')) === true, '07:00 Tunis: first ping');
assert(isInsideWindow(at('2026-11-07T12:00:00Z')) === true, 'midday: ping');
assert(isInsideWindow(at('2026-11-07T22:50:00Z')) === true, '23:50 Tunis: last ping');
assert(isInsideWindow(at('2026-11-07T23:00:00Z')) === false, '00:00 Tunis: skipped (the API may sleep)');
assert(isInsideWindow(at('2026-11-07T01:30:00Z')) === false, '02:30 Tunis: skipped');
assert(isInsideWindow(at('2026-07-15T06:00:00Z')) === true, 'summer: same hours (no daylight saving time in Tunisia)');

const defaults = readWindow({});
assert(defaults.fromHour === 7 && defaults.toHour === 24 && defaults.timeZone === 'Africa/Tunis', 'defaults: 07:00 to midnight, Tunis');
assert(JSON.stringify(readWindow({ KEEPALIVE_FROM_HOUR: '8', KEEPALIVE_TO_HOUR: '22' })) === JSON.stringify({ fromHour: 8, toHour: 22, timeZone: 'Africa/Tunis' }), 'the hours can be changed with variables');
assert(readWindow({ KEEPALIVE_FROM_HOUR: 'abc' }).fromHour === DEFAULT_WINDOW.fromHour, 'an invalid hour falls back to the default');
assert(readWindow({ KEEPALIVE_FROM_HOUR: '23', KEEPALIVE_TO_HOUR: '5' }).toHour === 24, 'an end hour not after the start falls back to the default');
assert(readWindow({ KEEPALIVE_TIMEZONE: 'Mars/Olympus' }).timeZone === 'Africa/Tunis', 'an unknown time zone falls back to Tunis');

// ---- 3. what a tick does --------------------------------------------------------------
const env = { PING_URL: 'https://api.example.test/ping' };
const inside = at('2026-11-07T10:00:00Z');
const outside = at('2026-11-07T00:10:00Z');
const fakeFetch = (respond) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  impl.calls = calls;
  return impl;
};
const okResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });

const f1 = fakeFetch(okResponse);
const r1 = await worker.runTick(env, inside, f1);
assert(f1.calls.length === 1 && f1.calls[0].url === env.PING_URL && /ping ok/.test(r1), 'inside the window: exactly one GET to PING_URL');
assert(f1.calls[0].init.method === undefined || f1.calls[0].init.method === 'GET', 'the ping is a GET');

const f2 = fakeFetch(okResponse);
const r2 = await worker.runTick(env, outside, f2);
assert(f2.calls.length === 0 && /skipped/.test(r2), 'outside the window: nothing is sent');

const rejects = async (promise) => promise.then(() => false, () => true);
assert(await rejects(worker.runTick(env, inside, fakeFetch(() => new Response('down', { status: 503 })))), 'an HTTP 503 from the API fails the run');
assert(await rejects(worker.runTick(env, inside, fakeFetch(() => new Response('<html>', { status: 200 })))), 'a 200 that is not {ok:true} fails the run (a loading page is not the API)');
assert(await rejects(worker.runTick(env, inside, fakeFetch(() => { throw new Error('network'); }))), 'a network error fails the run');
assert(await rejects(worker.runTick({}, inside, fakeFetch(okResponse))), 'a missing PING_URL fails the run');
assert(await rejects(worker.runTick({ PING_URL: 'http://api.example.test/ping' }, inside, fakeFetch(okResponse))), 'a plain http address (not loopback) is refused');

// The exported Worker: the scheduled handler runs the tick through ctx.waitUntil, using the tick's own time.
const realFetch = globalThis.fetch;
let workerCalls = 0;
globalThis.fetch = async () => {
  workerCalls += 1;
  return okResponse();
};
const silence = console.log;
console.log = () => {};
let waiting;
await worker.default.scheduled({ scheduledTime: outside }, env, { waitUntil: (p) => (waiting = p) });
await waiting;
await worker.default.scheduled({ scheduledTime: inside }, env, { waitUntil: (p) => (waiting = p) });
await waiting;
console.log = silence;
globalThis.fetch = realFetch;
assert(workerCalls === 1, 'the scheduled handler pings once for an inside tick and not for an outside one');

console.log(fail === 0 ? `PASS: ${pass} checks` : `FAILED: ${fail} of ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
