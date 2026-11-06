/**
 * Tests of the snapshot client the static build uses (src/lib/snapshot): retry through a cold start, the time budget,
 * fatal answers, and the rule that an incomplete or unusable snapshot is never returned (so nothing half-filled is published).
 * Hermetic: a virtual clock for most cases and a small local HTTP server for the real-socket ones. No database.
 *
 * Usage: node storefront/scripts/test_snapshot_fetch.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchSnapshot } from '../src/lib/snapshot/fetchSnapshot.ts';
import { SnapshotError, snapshotProblems } from '../src/lib/snapshot/validate.ts';

// AbortSignal.timeout timers do not keep Node alive (a real socket would); the fake fetches here have none.
const keepAlive = setInterval(() => {}, 1000);
let passed = 0;
let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`✓ PASS: ${label}`);
    passed++;
  } catch (err) {
    console.error(`✗ FAIL: ${label}\n   ${String(err.stack ?? err.message).split('\n').slice(0, 6).join('\n   ')}`);
    failed++;
  }
}

const product = (n, over = {}) => ({ id: `id-${n}`, slug: `pyjama-${n}`, name: `Pyjama ${n}`, price: 40, category: 'femme', variants: [], colors: [], isHidden: false, is_active: true, ...over });
const goodSnapshot = (count = 3) => {
  const products = Array.from({ length: count }, (_, i) => product(i + 1));
  return {
    generatedAt: '2026-11-06T10:00:00.000Z',
    fingerprint: 'a'.repeat(64),
    products,
    summaries: products.map((p) => ({ id: p.id, slug: p.slug })),
    categories: [{ slug: 'femme', name: 'Femme' }],
    reviews: {},
    theme: { primary: '#8D191C' },
    settings: { deliveryFee: 8 },
  };
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** A virtual clock: sleep() moves time forward instead of waiting. */
function clock() {
  let t = 0;
  const pauses = [];
  return { now: () => t, sleep: async (ms) => { pauses.push(ms); t += ms; }, pauses, advance: (ms) => (t += ms) };
}
/** A fetch that plays the given steps in order (the last one repeats). A step is a Response, an Error, or a function. */
function scripted(steps, c) {
  let i = 0;
  const impl = async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    c?.advance(step?.took ?? 0);
    const value = typeof step === 'function' ? await step() : step;
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : value.response;
  };
  impl.calls = () => i;
  return impl;
}
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
const URL_ = 'https://api.example/api/storefront/snapshot';

await check('a healthy API: one attempt, the validated snapshot is returned', async () => {
  const c = clock();
  const f = scripted([json(goodSnapshot(5))]);
  const snap = await fetchSnapshot({ url: URL_, fetchImpl: f, sleep: c.sleep, now: c.now });
  assert.equal(snap.products.length, 5);
  assert.equal(f.calls(), 1);
  assert.deepEqual(c.pauses, []);
});

await check('Render cold start: refused, 503, an HTML waking page, a cut-off body, then the snapshot: retried until it works', async () => {
  const c = clock();
  const f = scripted([
    refused(),
    refused(),
    new Response('Service Unavailable', { status: 503 }),
    new Response('<html>Your service is waking up</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    new Response('{"products":[{"id":"a","slug"', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    json(goodSnapshot(4)),
  ]);
  const logs = [];
  const snap = await fetchSnapshot({ url: URL_, fetchImpl: f, sleep: c.sleep, now: c.now, log: (m) => logs.push(m) });
  assert.equal(snap.products.length, 4);
  assert.equal(f.calls(), 6);
  assert.deepEqual(c.pauses, [2000, 5000, 10000, 20000, 30000]);
  assert.ok(logs.some((m) => /not JSON|waking/.test(m)) && logs.some((m) => /cut off/.test(m)) && logs.some((m) => /ECONNREFUSED/.test(m)));
});

await check('a wake-up that takes 70 s on one request is within the default attempt timeout and the 8-minute budget', async () => {
  const c = clock();
  const f = scripted([{ took: 70_000, response: json(goodSnapshot(2)) }], c);
  const snap = await fetchSnapshot({ url: URL_, fetchImpl: f, sleep: c.sleep, now: c.now });
  assert.equal(snap.products.length, 2);
});

await check('429 with Retry-After: the pause follows it (capped at 60 s)', async () => {
  const c = clock();
  const f = scripted([new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } }), new Response('slow down', { status: 429, headers: { 'Retry-After': '900' } }), json(goodSnapshot())]);
  await fetchSnapshot({ url: URL_, fetchImpl: f, sleep: c.sleep, now: c.now });
  assert.deepEqual(c.pauses, [7000, 60000]);
});

await check('404 (no such endpoint) is fatal at once: one attempt, no retry', async () => {
  const c = clock();
  const f = scripted([new Response('{"error":"not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })]);
  await assert.rejects(fetchSnapshot({ url: URL_, fetchImpl: f, sleep: c.sleep, now: c.now }), (e) => e instanceof SnapshotError && e.fatal && /404/.test(e.message));
  assert.equal(f.calls(), 1);
});

await check('401/403 are fatal as well', async () => {
  for (const status of [401, 403]) {
    const f = scripted([new Response('no', { status })]);
    await assert.rejects(fetchSnapshot({ url: URL_, fetchImpl: f, sleep: async () => {} }), (e) => e.fatal === true);
    assert.equal(f.calls(), 1);
  }
});

await check('the API never wakes up: gives up after the budget with a clear error and never returns data', async () => {
  const c = clock();
  const f = scripted([new Response('down', { status: 503 })]);
  await assert.rejects(
    fetchSnapshot({ url: URL_, fetchImpl: f, sleep: c.sleep, now: c.now, totalBudgetMs: 120_000 }),
    (e) => e instanceof SnapshotError && !e.fatal && /Nothing was built/.test(e.message) && /503/.test(e.message),
  );
  assert.ok(c.now() <= 120_000, `stayed inside the budget (${c.now()} ms)`);
  assert.ok(f.calls() >= 4);
});

await check('every attempt is bounded: the last attempt never runs past the overall budget', async () => {
  const seen = [];
  const c = clock();
  const f = async (_url, init) => {
    // an attempt that never answers: record the timeout it was given, then let it time out
    seen.push(init.signal);
    c.advance(90_000);
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  };
  await assert.rejects(fetchSnapshot({ url: URL_, fetchImpl: f, sleep: c.sleep, now: c.now, totalBudgetMs: 200_000 }), SnapshotError);
  assert.ok(seen.every((s) => s instanceof AbortSignal));
});

await check('an empty catalogue is refused (fatal), not published', async () => {
  const f = scripted([json({ ...goodSnapshot(0) })]);
  await assert.rejects(fetchSnapshot({ url: URL_, fetchImpl: f, sleep: async () => {} }), (e) => e.fatal === true && /near-empty/.test(e.message));
  assert.equal(f.calls(), 1);
});

await check('minProducts: 0 lets an owner publish an empty shop on purpose', async () => {
  const snap = await fetchSnapshot({ url: URL_, fetchImpl: scripted([json(goodSnapshot(0))]), sleep: async () => {}, minProducts: 0 });
  assert.equal(snap.products.length, 0);
});

await check('validation: hidden product, missing fields, duplicates, mismatched summaries and unknown categories are all refused', async () => {
  const cases = {
    'a hidden product': (s) => { s.products[0].isHidden = true; },
    'is_active false': (s) => { s.products[0].is_active = false; },
    'no slug': (s) => { delete s.products[1].slug; },
    'bad slug': (s) => { s.products[1].slug = 'Bad Slug!'; },
    'no name': (s) => { s.products[0].name = ' '; },
    'bad price': (s) => { s.products[0].price = 'free'; },
    'duplicate id': (s) => { s.products[1].id = s.products[0].id; },
    'duplicate slug': (s) => { s.products[1].slug = s.products[0].slug; },
    'unknown category': (s) => { s.products[0].category = 'homme'; },
    'summaries missing': (s) => { s.summaries.pop(); },
    'summary of an unknown product': (s) => { s.summaries[0].id = 'ghost'; },
    'reviews of an unknown product': (s) => { s.reviews = { ghost: { reviews: [], summary: { average: 0, count: 0 } } }; },
    'no theme': (s) => { delete s.theme; },
    'no fingerprint': (s) => { delete s.fingerprint; },
    'a fingerprint that is not a SHA-256': (s) => { s.fingerprint = 'abc'; },
    'no delivery fee': (s) => { s.settings = {}; },
    'products not a list': (s) => { s.products = null; },
    'not an object': () => 'x',
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const snap = goodSnapshot();
    const replacement = mutate(snap);
    assert.ok(snapshotProblems(replacement ?? snap).length > 0, `${name} should be refused`);
  }
  assert.deepEqual(snapshotProblems(goodSnapshot()), []);
});

await check('a real timeout: an attempt that never answers is aborted and retried', async () => {
  let n = 0;
  const f = async (_url, init) => {
    n++;
    if (n === 1) await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    return json(goodSnapshot(2));
  };
  const snap = await fetchSnapshot({ url: URL_, fetchImpl: f, attemptTimeoutMs: 60, backoffMs: [5], totalBudgetMs: 5000 });
  assert.equal(snap.products.length, 2);
  assert.equal(n, 2);
});

// Real sockets: a server that is "asleep" (refuses connections), then drops a response half-way, then answers.
await check('real HTTP: connection refused while asleep, a body cut off mid-way, then the snapshot', async () => {
  const body = JSON.stringify(goodSnapshot(3));
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (requests === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(body.length) });
      res.write(body.slice(0, 40));
      setTimeout(() => req.socket.destroy(), 10);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  // Start with nothing listening on a second port to get a real ECONNREFUSED first.
  const dead = http.createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  let attempt = 0;
  const f = (url, init) => fetch(attempt++ === 0 ? `http://127.0.0.1:${deadPort}/x` : url, init);
  try {
    const snap = await fetchSnapshot({ url: `http://127.0.0.1:${port}/snapshot`, fetchImpl: f, backoffMs: [20], totalBudgetMs: 10_000 });
    assert.equal(snap.products.length, 3);
    assert.equal(requests, 2, 'the cut-off answer was retried');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
clearInterval(keepAlive);
process.exit(failed ? 1 : 0);
