import assert from 'assert';
import http from 'http';
import { validateJwtSecret, parseCorsOrigins } from '../config/env.js';
import { app } from '../app.js';
import { MAX_ITEM_QUANTITY, MAX_ORDER_ITEMS, MAX_BULK_ORDER_IDS, validateOrderQuantity } from '../config/orderLimits.js';
import { validateIdempotencyKey, generateRequestFingerprint } from '../utils/idempotency.js';
import {
  adminLoginLimiter,
  checkoutLimiter,
  orderCreationLimiter,
  orderMutationLimiter,
  authLoginLimiter,
  authRegisterLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from '../middleware/rateLimiter.js';
import { upload } from '../utils/upload.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\n--- 1. JWT PRODUCTION STARTUP PROTECTION ---');

test('Development: allows default fallback when JWT_SECRET is unset', () => {
  const secret = validateJwtSecret('', false);
  assert.strictEqual(secret, 'silky-dev-jwt-secret-change-me');
});

test('Development: allows custom dev secret', () => {
  const secret = validateJwtSecret('my-dev-secret', false);
  assert.strictEqual(secret, 'my-dev-secret');
});

test('Production: throws if JWT_SECRET is missing/empty', () => {
  assert.throws(() => validateJwtSecret('', true), /\[FATAL\] JWT_SECRET must be set in production/);
  assert.throws(() => validateJwtSecret('   ', true), /\[FATAL\] JWT_SECRET must be set in production/);
  assert.throws(() => validateJwtSecret(null, true), /\[FATAL\] JWT_SECRET must be set in production/);
});

test('Production: throws if JWT_SECRET uses known dev defaults', () => {
  assert.throws(() => validateJwtSecret('silky-dev-jwt-secret-change-me', true), /\[FATAL\] JWT_SECRET is using an insecure or default development value/);
  assert.throws(() => validateJwtSecret('silky-dev-jwt-secret-change-me-in-production', true), /\[FATAL\] JWT_SECRET is using an insecure or default development value/);
  assert.throws(() => validateJwtSecret('change-me-to-a-long-random-secret', true), /\[FATAL\] JWT_SECRET is using an insecure or default development value/);
});

test('Production: throws if JWT_SECRET is too short (< 16 chars)', () => {
  assert.throws(() => validateJwtSecret('short-secret-12', true), /insecure or default development value/);
});

test('Production: accepts valid strong secret (>= 16 chars)', () => {
  const validSecret = 'super-secure-production-random-jwt-key-2026';
  const secret = validateJwtSecret(validSecret, true);
  assert.strictEqual(secret, validSecret);
});

console.log('\n--- 2. CORS ALLOWLIST PARSING ---');

test('Development: defaults to localhost:4321 when CORS_ALLOWED_ORIGINS is unset', () => {
  const origins = parseCorsOrigins(undefined, false, 'http://localhost:4321');
  assert.ok(origins.includes('http://localhost:4321'));
  assert.ok(origins.includes('http://127.0.0.1:4321'));
});

test('Development/Staging: parses comma-separated origins, trims whitespace, filters empty', () => {
  const origins = parseCorsOrigins('  https://silky.tn , https://admin.silky.tn ,  , https://app.silky.tn ', false);
  assert.deepStrictEqual(origins, ['https://silky.tn', 'https://admin.silky.tn', 'https://app.silky.tn']);
});

test('Production: throws if CORS_ALLOWED_ORIGINS is missing or empty', () => {
  assert.throws(() => parseCorsOrigins('', true), /\[FATAL\] CORS_ALLOWED_ORIGINS must be set and non-empty in production/);
  assert.throws(() => parseCorsOrigins(null, true), /\[FATAL\] CORS_ALLOWED_ORIGINS must be set and non-empty in production/);
  assert.throws(() => parseCorsOrigins('   ,   ', true), /\[FATAL\] CORS_ALLOWED_ORIGINS must be set and non-empty in production/);
});

test('Production: accepts valid configured comma-separated origins', () => {
  const origins = parseCorsOrigins('https://silky.tn, https://admin.silky.tn', true);
  assert.deepStrictEqual(origins, ['https://silky.tn', 'https://admin.silky.tn']);
});

console.log('\n--- 3. HTTP SERVER INTEGRATION (CORS & JSON BODY LIMITS) ---');

async function runHttpTests() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function makeRequest({ method = 'GET', path = '/', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(path, baseUrl);
      const req = http.request(
        parsedUrl,
        {
          method,
          headers: {
            ...headers,
            ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
        }
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  await asyncTest('CORS: sets allow-origin and credentials for configured origin', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/theme',
      headers: { Origin: 'http://localhost:4321' },
    });
    assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:4321');
    assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
  });

  await asyncTest('CORS: rejects unlisted origin (no allow-origin header returned)', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/theme',
      headers: { Origin: 'https://malicious-attacker.com' },
    });
    assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  });

  await asyncTest('CORS: preflight OPTIONS request returns 204 for allowed origin', async () => {
    const res = await makeRequest({
      method: 'OPTIONS',
      path: '/api/orders',
      headers: {
        Origin: 'http://localhost:4321',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Idempotency-Key',
      },
    });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:4321');
    assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
  });

  await asyncTest('JSON Body Limit: normal JSON request (<100kb) passes parser', async () => {
    const normalBody = JSON.stringify({
      password: 'wrong-password-test',
    });
    const res = await makeRequest({
      method: 'POST',
      path: '/api/admin/login',
      headers: {
        'Content-Type': 'application/json',
      },
      body: normalBody,
    });
    // Should NOT be 413. Will be 401/400 (normal controller rejection)
    assert.notStrictEqual(res.status, 413);
  });

  await asyncTest('JSON Body Limit: oversized JSON request (>100kb) returns 413 Payload Too Large', async () => {
    const largeData = 'A'.repeat(120 * 1024); // 120 KB string
    const oversizedBody = JSON.stringify({ largeField: largeData });
    const res = await makeRequest({
      method: 'POST',
      path: '/api/admin/login',
      headers: {
        'Content-Type': 'application/json',
      },
      body: oversizedBody,
    });
    assert.strictEqual(res.status, 413);
  });

  await asyncTest('Upload Limit Isolation: Multer configuration has 25MB limit', async () => {
    assert.strictEqual(upload.limits.fileSize, 25 * 1024 * 1024);
  });

  await new Promise((resolve) => server.close(resolve));
}

console.log('\n--- 4. PHASE 1 & PHASE 2 SAFEGUARDS PRESERVATION ---');

test('Order Limits: MAX_ITEM_QUANTITY, MAX_ORDER_ITEMS, MAX_BULK_ORDER_IDS are preserved', () => {
  assert.strictEqual(MAX_ITEM_QUANTITY, 50);
  assert.strictEqual(MAX_ORDER_ITEMS, 50);
  assert.strictEqual(MAX_BULK_ORDER_IDS, 100);
  assert.strictEqual(validateOrderQuantity(10), 10);
  assert.throws(() => validateOrderQuantity(51), /dépasse la limite autorisée/);
  assert.throws(() => validateOrderQuantity(-1), /entier positif/);
  assert.throws(() => validateOrderQuantity(0), /entier positif/);
});

test('Idempotency: key validation and fingerprint generation intact', () => {
  assert.strictEqual(validateIdempotencyKey('idem-key-12345'), 'idem-key-12345');
  assert.throws(() => validateIdempotencyKey(''), /longueur entre 1 et 255/);
  const fp1 = generateRequestFingerprint('test:op', { customer: { name: 'Test' } });
  const fp2 = generateRequestFingerprint('test:op', { customer: { name: 'Test' } });
  assert.strictEqual(typeof fp1, 'string');
  assert.strictEqual(fp1, fp2);
});

test('Rate Limiters: all rate limiters are instantiated and active', () => {
  assert.strictEqual(typeof adminLoginLimiter, 'function');
  assert.strictEqual(typeof checkoutLimiter, 'function');
  assert.strictEqual(typeof orderCreationLimiter, 'function');
  assert.strictEqual(typeof orderMutationLimiter, 'function');
  assert.strictEqual(typeof authLoginLimiter, 'function');
  assert.strictEqual(typeof authRegisterLimiter, 'function');
  assert.strictEqual(typeof forgotPasswordLimiter, 'function');
  assert.strictEqual(typeof resetPasswordLimiter, 'function');
});

runHttpTests().then(() => {
  console.log(`\n========================================`);
  console.log(`VERIFICATION SUMMARY: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
});
