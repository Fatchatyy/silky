/**
 * Proves the real-provider gate: no request can reach the real GOODEX host from a test run
 * or from a non-opted-in run, even when a real-looking token is configured.
 *
 * Hermetic: no database, no server, no network. global fetch is replaced by a counter that
 * records every attempted call and never sends anything.
 *
 * Usage: node server/scripts/test_goodex_live_guard.js
 */
import { env } from '../config/env.js';
import { liveCallBlockReason } from '../config/goodex.js';
import * as client from '../services/goodex.client.js';

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  FAIL: ${label}`);
  }
}

const REAL = 'https://transport.goodex.tn';
const DEV_DB = 'postgres://u:p@localhost:5432/silky';
const TEST_DB = 'postgres://u:p@localhost:5432/silky_test';

// ---- 1. the pure rule ---------------------------------------------------------------
const rule = (over) => liveCallBlockReason({ baseUrl: REAL, enableLive: true, nodeEnv: 'development', databaseUrl: DEV_DB, ...over });

assert(rule({}) === null, 'opted in, non-test run, real host: allowed');
assert(rule({ enableLive: false }) !== null, 'real host without GOODEX_ENABLE_LIVE: blocked');
assert(rule({ nodeEnv: 'test' }) !== null, 'NODE_ENV=test blocks even when opted in');
assert(rule({ databaseUrl: TEST_DB }) !== null, 'a test database name blocks even when opted in');
assert(rule({ databaseUrl: 'postgres://u:p@h/Silky_TEST_2' }) !== null, 'test database name is case-insensitive');
assert(rule({ databaseUrl: 'not a url' }) === null, 'unparsable DATABASE_URL is not mistaken for a test DB');
assert(rule({ baseUrl: 'not a url' }) !== null, 'invalid base URL blocked');
for (const base of ['http://127.0.0.1:5555', 'http://localhost:5555', 'http://[::1]:5555']) {
  assert(liveCallBlockReason({ baseUrl: base, enableLive: false, nodeEnv: 'test', databaseUrl: TEST_DB }) === null, `loopback mock allowed: ${base}`);
}
for (const base of ['http://127.0.0.1.evil.example', 'http://localhost.evil.example', 'http://evil.example/127.0.0.1', 'http://127.0.0.1@evil.example']) {
  assert(liveCallBlockReason({ baseUrl: base, enableLive: false, nodeEnv: 'development', databaseUrl: DEV_DB }) !== null, `look-alike host is not loopback: ${base}`);
}

// ---- 2. every client entry point, with a real-looking token configured ---------------
const calls = [];
const inits = [];
const realFetch = globalThis.fetch;
let nextBody = {};
globalThis.fetch = async (url, init) => {
  calls.push(String(url));
  inits.push(init);
  return new Response(JSON.stringify(nextBody), { status: 200, headers: { 'content-type': 'application/json' } });
};

const saved = { ...env.goodex };
const savedDb = env.databaseUrl;
const savedNodeEnv = process.env.NODE_ENV;
function configure({ base, enableLive, nodeEnv, db }) {
  Object.assign(env.goodex, saved, { baseUrl: base, apiToken: 'tok_not_a_real_token', userId: '1', enableLive });
  env.databaseUrl = db;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
}

const entryPoints = {
  createParcel: () => client.createParcel({ client: 'x', cod: '10.000' }),
  trackParcel: () => client.trackParcel('EAN123'),
  fetchClaimTypes: () => client.fetchClaimTypes(),
  createClaim: () => client.createClaim({ ean: 'EAN123', type: 'x' }),
  listClaims: () => client.listClaims({}),
  fetchClaimCounts: () => client.fetchClaimCounts(),
  getClaimDetails: () => client.getClaimDetails(1),
  cancelClaimRemote: () => client.cancelClaimRemote(1),
};

try {
  const blockedScenarios = [
    ['real host, not opted in', { base: REAL, enableLive: false, nodeEnv: 'development', db: DEV_DB }],
    ['real host, opted in but NODE_ENV=test', { base: REAL, enableLive: true, nodeEnv: 'test', db: DEV_DB }],
    ['real host, opted in but test database', { base: REAL, enableLive: true, nodeEnv: 'development', db: TEST_DB }],
    ['real host, NODE_ENV unset, not opted in', { base: REAL, enableLive: false, nodeEnv: undefined, db: DEV_DB }],
  ];
  for (const [label, cfg] of blockedScenarios) {
    configure(cfg);
    calls.length = 0;
    for (const [name, run] of Object.entries(entryPoints)) {
      const r = await run();
      assert(r.ok === false && r.configError === true, `${label}: ${name} refused as a configuration error`);
      assert(/réels bloqués/.test(String(r.error)), `${label}: ${name} explains the block`);
      assert(!String(r.error).includes('tok_not_a_real_token'), `${label}: ${name} does not leak the token`);
      if (name === 'createParcel' || name === 'createClaim' || name === 'cancelClaimRemote') assert(r.outcome === 'failed', `${label}: ${name} is a clean failure (safe to retry)`);
    }
    assert(calls.length === 0, `${label}: no request was attempted (${calls.length})`);
  }

  // Allowed: opted-in non-test run reaches fetch (mocked here, so nothing leaves the process).
  configure({ base: REAL, enableLive: true, nodeEnv: 'development', db: DEV_DB });
  calls.length = 0;
  await client.fetchClaimTypes();
  assert(calls.length === 1 && calls[0].startsWith(REAL), 'opted-in non-test run does reach the (mocked) provider call');

  // Requests built for the verified provider host (fetch is mocked: nothing is sent).
  // The check on the default only holds when GOODEX_BASE_URL is not overridden in the environment.
  if (!process.env.GOODEX_BASE_URL) assert(saved.baseUrl === REAL, 'default GOODEX base URL is https://transport.goodex.tn');
  configure({ base: REAL, enableLive: true, nodeEnv: 'development', db: DEV_DB });
  calls.length = 0;
  inits.length = 0;
  nextBody = { id: 7, ean: 'SOU0000000000000', user_id: 5, last_statut: 12 };
  const created = await client.createParcel({ client: 'Test test', cod: '40.000', adresse: 'Sahloul', governorat: 'Sousse', gsm1: '55899090', designation: 'Produit', nbre: 1, remarque: 'test', echange: '0', decharge: '0' });
  assert(created.ok === true && created.ean === 'SOU0000000000000', 'create response: ean is read from the flat object');
  assert(calls[0] === 'https://transport.goodex.tn/api/v1/colis/create', 'create hits POST /api/v1/colis/create on transport.goodex.tn');
  assert(inits[0].method === 'POST' && inits[0].body instanceof FormData, 'create body is a FormData (multipart), not JSON or urlencoded');
  assert(!('Content-Type' in (inits[0].headers || {})), 'no hand-set Content-Type (fetch adds the multipart boundary)');
  assert(inits[0].body.get('token') === 'tok_not_a_real_token' && inits[0].body.get('user_id') === '1', 'token and user_id are sent as form fields');
  assert(inits[0].body.get('echange') === '0' && inits[0].body.get('decharge') === '0', 'echange=0 / decharge=0 are sent as given');
  assert(inits[0].body.get('last_statut') === '12', 'last_statut=12 is sent (live API: 422 without it)');
  assert(!inits[0].body.has('ean') && !inits[0].body.has('id'), 'API-generated fields are never sent');

  calls.length = 0;
  inits.length = 0;
  nextBody = { ean: 'SOU0000000000000', statut: 'En Attente', has_motif: 0, motif: '' };
  const tracked = await client.trackParcel('SOU0000000000000');
  assert(tracked.ok === true && tracked.notFound === false && tracked.statut === 'En Attente' && tracked.hasMotif === false, 'tracking: En Attente is an ordinary status (has_motif 0 -> false)');
  assert(calls[0] === 'https://transport.goodex.tn/api/v1/colis/etat/SOU0000000000000?token=tok_not_a_real_token', 'tracking hits GET /api/v1/colis/etat/{ean}?token= on transport.goodex.tn');
  assert(inits[0].method === 'GET' && inits[0].body === undefined, 'tracking is a body-less GET');

  // Allowed: loopback mock under a test run, flag off.
  configure({ base: 'http://127.0.0.1:59999', enableLive: false, nodeEnv: 'test', db: TEST_DB });
  calls.length = 0;
  await client.fetchClaimTypes();
  assert(calls.length === 1 && calls[0].startsWith('http://127.0.0.1:59999'), 'loopback mock stays reachable in a test run');
} finally {
  globalThis.fetch = realFetch;
  Object.assign(env.goodex, saved);
  env.databaseUrl = savedDb;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
}

console.log(`\ntest_goodex_live_guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
