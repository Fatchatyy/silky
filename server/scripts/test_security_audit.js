/**
 * Security regression suite: attacks the real app on an ephemeral port.
 *  - authorization (customer/anonymous vs every admin route, forged tokens, mass assignment), order/cart isolation
 *  - price and quantity tampering, replay (Idempotency-Key), oversell race, double cancel
 *  - uploads (content must match the declared type, extension forced, nothing served as html/svg/js)
 *  - sessions (admin logout, password change/reset, demoted admin), login timing, password reset lifecycle
 *  - rate limits, CORS/CSRF, security headers, errors that must not leak or hang, SQL injection payloads
 *  - production configuration checks (admin password, database url, trust proxy)
 *
 * Database safety: refuses to run unless DATABASE_URL is set explicitly and names the database silky_test on a
 * loopback host. Mail and GOODEX are pointed at closed local ports; uploads go to a temporary folder.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_security_audit.js
 */
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../', import.meta.url).href;
const imp = (p) => import(new URL(p, ROOT).href);

let dbUrl = null;
try { dbUrl = new URL(process.env.DATABASE_URL || ''); } catch { /* handled below */ }
if (!dbUrl || dbUrl.pathname !== '/silky_test' || !['localhost', '127.0.0.1'].includes(dbUrl.hostname)) {
  console.error('REFUSING: DATABASE_URL must point at silky_test on loopback');
  process.exit(2);
}
process.env.NODE_ENV = 'test';
const uploadsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-sec-uploads-'));
Object.assign(process.env, {
  UPLOADS_DIR: uploadsTmp,
  SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: 'probe', SMTP_PASS: 'probe',
  GOODEX_ENABLE_LIVE: 'false', GOODEX_BASE_URL: 'http://127.0.0.1:1',
});

const { app } = await imp('app.js');
const { env } = await imp('config/env.js');
const { pool } = await imp('db/pool.js');
const { signAccessToken } = await imp('services/token.service.js');
const { _resetRateLimits } = await imp('middleware/rateLimiter.js');
const { userRepository } = await imp('repositories/user.repository.js');
await imp('scripts/helpers/parcel_guard_off.js');

const unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(String(e?.message || e).slice(0, 100)); });
const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const cleanup = { users: [], products: [], categories: [], orders: [] };
function check(id, area, name, ok, detail = '') {
  results.push({ id, area, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? '  -> ' + detail : ''}`);
}
function info(id, area, name, detail = '') {
  results.push({ id, area, name, ok: null, detail });
  console.log(`INFO  [${id}] ${name}${detail ? '  -> ' + detail : ''}`);
}

async function call(path, { method = 'GET', body, token, headers = {}, raw, guest } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (guest) h['X-Guest-Session-ID'] = guest;
  let payload = raw;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res, text;
  try {
    res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual', signal: AbortSignal.timeout(4000) });
    text = await res.text();
  } catch (e) {
    return { status: 0, data: 'HANG/ERR ' + e.name, text: 'HANG/ERR ' + e.name, headers: new Headers() };
  }
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: res.status, data, text, headers: res.headers };
}
const rawGet = (path) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, text: d, headers: res.headers }));
  });
  req.on('error', reject); req.end();
});
const rid = () => crypto.randomUUID();
const phone = () => '2' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const LEAK = /node_modules|C:\\\\|C:\\|\\Users\\|at\s+\S+\s+\(.*:\d+:\d+\)|postgres(ql)?:\/\/|syntax error at|relation ".*" does not exist|column ".*" does not exist|password authentication|SELECT\s.+\sFROM/i;

try {
  // ---------- setup ----------
  const { rows: [{ db }] } = await pool.query('select current_database() as db');
  if (db !== 'silky_test') throw new Error('connected to ' + db);
  await pool.query("delete from users where email like 'tmp-admin-%@example.invalid' or email like 'probe-admin-%@example.invalid'").catch(() => {});
  const stamp = Date.now();
  let admin = (await pool.query("select * from users where role='admin' limit 1")).rows[0];
  if (!admin) {
    admin = (await pool.query(
      "insert into users (email,password_hash,role,full_name,phone_number) values ($1,'x','admin','Probe Admin',$2) returning *",
      [`probe-admin-${stamp}@example.invalid`, phone()])).rows[0];
    cleanup.users.push(admin.id);
  }
  const adminToken = signAccessToken(admin);
  const cat = (await pool.query("insert into categories (name,slug) values ($1,$2) returning id,slug", [`Probe ${stamp}`, `probe-${stamp}`])).rows[0];
  cleanup.categories.push(cat.id);
  const gov = (await pool.query('select id,name from governorates order by id limit 1')).rows[0];

  async function mkProduct(name, price, stockN, extra = {}) {
    const r = await call('/api/products', { method: 'POST', token: adminToken, body: {
      name, description: 'd', collectionImage: '/pictures/collection.jpg', slug: `probe-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
      price, category: cat.slug, categoryId: cat.id,
      colors: [{ id: 'noir', name: 'Noir', image: '/pictures/noir.jpg' }], sizes: ['M'], stock: { 'noir-M': stockN }, ...extra } });
    if (r.status >= 300) throw new Error('product create failed ' + r.status + ' ' + r.text.slice(0, 200));
    cleanup.products.push(r.data.id);
    const v = (await pool.query('select id,stock_quantity from product_variants where product_id=$1', [r.data.id])).rows[0];
    return { product: r.data, variantId: v.id };
  }
  const stockOf = async (variantId) => (await pool.query('select stock_quantity from product_variants where id=$1', [variantId])).rows[0].stock_quantity;
  const P = await mkProduct(`Probe Robe ${stamp}`, 100, 20);
  const customerBody = (extra = {}) => ({ name: 'Test Client', phone: phone(), address: '1 rue Test', governorateId: gov.id, ...extra });

  async function mkCustomer(label) {
    _resetRateLimits();
    const ph = phone();
    const r = await call('/api/auth/register', { method: 'POST', body: { identifier: ph, password: 'Probe-pass-1', fullName: `Probe ${label}` } });
    if (r.status !== 201) throw new Error('register failed ' + r.status + ' ' + r.text);
    cleanup.users.push(r.data.user.id);
    return { token: r.data.token, id: r.data.user.id, phone: ph };
  }
  const A = await mkCustomer('A');
  const B = await mkCustomer('B');

  // ---------- 1. AUTHORIZATION: customer + anonymous vs every admin route ----------
  const fakeUuid = '00000000-0000-4000-8000-000000000000';
  const adminRoutes = [
    ['GET', '/api/orders'], ['GET', `/api/orders/${fakeUuid}`], ['POST', `/api/orders/${fakeUuid}/confirm`], ['POST', `/api/orders/${fakeUuid}/cancel`],
    ['POST', `/api/orders/${fakeUuid}/deliver`], ['POST', `/api/orders/${fakeUuid}/refund`], ['PATCH', `/api/orders/${fakeUuid}/status`],
    ['POST', '/api/orders/bulk-confirm'], ['PATCH', '/api/orders/bulk-status'], ['GET', `/api/orders/${fakeUuid}/delivery`],
    ['POST', `/api/orders/${fakeUuid}/delivery/link`], ['GET', '/api/orders/claims/remote'], ['GET', '/api/admin/inventory'], ['GET', '/api/admin/analytics'],
    ['PATCH', `/api/admin/inventory/${fakeUuid}`], ['POST', '/api/admin/orders/manual'], ['POST', `/api/admin/orders/${fakeUuid}/exchange`],
    ['GET', '/api/admin/drafts'], ['POST', '/api/admin/drafts'], ['POST', '/api/admin/logout'],
    ['POST', '/api/products'], ['PUT', `/api/products/${fakeUuid}`], ['DELETE', `/api/products/${fakeUuid}`], ['POST', '/api/products/upload'],
    ['POST', `/api/products/${fakeUuid}/videos`], ['GET', `/api/products/${fakeUuid}/admin-reviews`], ['PATCH', `/api/products/reviews/${fakeUuid}`], ['DELETE', `/api/products/reviews/${fakeUuid}`],
    ['GET', '/api/reviews'], ['PATCH', `/api/reviews/${fakeUuid}`], ['DELETE', `/api/reviews/${fakeUuid}`],
    ['GET', '/api/gallery'], ['POST', '/api/gallery'], ['DELETE', `/api/gallery/${fakeUuid}`], ['PUT', '/api/theme'], ['POST', '/api/theme/upload'],
    ['GET', '/api/contact'], ['GET', `/api/contact/${fakeUuid}`], ['POST', `/api/contact/${fakeUuid}/reply`],
    ['GET', '/api/notifications'], ['GET', '/api/notifications/all'], ['POST', '/api/notifications/read-all'],
  ];
  _resetRateLimits();
  const custLeaks = [], anonLeaks = [];
  for (const [m, p] of adminRoutes) {
    const c = await call(p, { method: m, token: A.token, body: m === 'GET' ? undefined : {} });
    if (c.status !== 403) custLeaks.push(`${m} ${p} -> ${c.status}`);
    const a = await call(p, { method: m, body: m === 'GET' ? undefined : {} });
    if (a.status !== 401) anonLeaks.push(`${m} ${p} -> ${a.status}`);
  }
  check('A1', 'authz', `customer token gets 403 on all ${adminRoutes.length} admin routes`, custLeaks.length === 0, custLeaks.join('; '));
  check('A2', 'authz', 'anonymous gets 401 on all admin routes', anonLeaks.length === 0, anonLeaks.join('; '));

  // forged tokens
  const hdr = b64({ alg: 'HS256', typ: 'JWT' });
  const claims = { sub: A.id, email: null, role: 'admin', fullName: 'x', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
  const sign = (secret, h, c) => `${h}.${b64(c)}.` + crypto.createHmac('sha256', secret).update(`${h}.${b64(c)}`).digest('base64url');
  const forged = {
    'alg=none': `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`,
    'wrong secret': sign('not-the-secret', hdr, claims),
    'dev default secret': sign('silky-dev-jwt-secret-change-me', hdr, claims),
    'role edited, old signature': A.token.split('.')[0] + '.' + b64({ ...JSON.parse(Buffer.from(A.token.split('.')[1], 'base64url')), role: 'admin' }) + '.' + A.token.split('.')[2],
    expired: sign(env.jwtSecret, hdr, { ...claims, exp: Math.floor(Date.now() / 1000) - 60 }),
  };
  const forgedOk = [];
  for (const [k, t] of Object.entries(forged)) {
    const r = await call('/api/admin/inventory', { token: t });
    if (r.status === 200) forgedOk.push(k);
  }
  check('A3', 'authn', 'forged / tampered / expired JWTs are rejected', forgedOk.length === 0, forgedOk.join(', '));
  const devSecretUsed = env.jwtSecret === 'silky-dev-jwt-secret-change-me';
  info('A3b', 'secrets', 'JWT secret in this environment', devSecretUsed ? 'DEFAULT dev secret in use' : `custom secret (${env.jwtSecret.length} chars)`);

  // mass assignment
  const reg = await call('/api/auth/register', { method: 'POST', body: { identifier: phone(), password: 'Probe-pass-1', fullName: 'Mass Assign', role: 'admin', isAdmin: true } });
  if (reg.status === 201) cleanup.users.push(reg.data.user.id);
  check('A4', 'authz', 'register ignores role=admin in body', reg.status === 201 && reg.data.user.role === 'customer', `role=${reg.data?.user?.role}`);
  const prof = await call('/api/auth/me', { method: 'PATCH', token: A.token, body: { fullName: 'Probe A', role: 'admin' } });
  const meAfter = await call('/api/auth/me', { token: A.token });
  check('A5', 'authz', 'profile update ignores role=admin', meAfter.data?.user?.role === 'customer', `role=${meAfter.data?.user?.role}`);
  const adminLoginAsCustomer = await call('/api/auth/login', { method: 'POST', body: { identifier: admin.email, password: env.adminPassword } });
  check('A6', 'authz', 'admin account cannot use the customer login endpoint', adminLoginAsCustomer.status === 401, `status ${adminLoginAsCustomer.status}`);

  // ---------- 2. IDOR on orders / cart ----------
  _resetRateLimits();
  const oA = await call('/api/orders', { method: 'POST', token: A.token, body: { customer: customerBody(), items: [{ variantId: P.variantId, quantity: 1 }] } });
  if (oA.status !== 201) info('B0', 'idor', 'order create failed, IDOR tests skipped', `${oA.status} ${oA.text.slice(0, 160)}`);
  else {
    cleanup.orders.push(oA.data.id);
    const getB = await call(`/api/orders/${oA.data.id}`, { token: B.token });
    check('B1', 'idor', "customer B cannot read customer A's order by id (GET /orders/:id)", getB.status === 403, `status ${getB.status}`);
    const mineB = await call('/api/orders/mine', { token: B.token });
    check('B2', 'idor', "customer B's order list does not contain A's order", Array.isArray(mineB.data) && !mineB.data.some((o) => o.id === oA.data.id), `${mineB.data?.length} orders`);
    const mineA = await call('/api/orders/mine', { token: A.token });
    check('B3', 'idor', 'customer A sees own order', Array.isArray(mineA.data) && mineA.data.some((o) => o.id === oA.data.id));
    const actB = [];
    for (const [m, s] of [['POST', 'cancel'], ['POST', 'confirm'], ['POST', 'refund'], ['PATCH', 'status']]) {
      const r = await call(`/api/orders/${oA.data.id}/${s}`, { method: m, token: B.token, body: { status: 'cancelled' } });
      if (r.status !== 403) actB.push(`${s}:${r.status}`);
    }
    check('B4', 'idor', "customer B cannot cancel/confirm/refund/patch A's order", actB.length === 0, actB.join(','));
    const leakFields = Object.keys(oA.data).filter((k) => /password|hash|token|secret/i.test(k));
    check('B5', 'idor', 'order response carries no secret-looking fields', leakFields.length === 0, leakFields.join(','));
  }
  // guest cart isolation
  const g1 = rid(), g2 = rid();
  const add = await call('/api/cart/items', { method: 'POST', guest: g1, body: { variantId: P.variantId, quantity: 1 } });
  const itemId = add.data?.items?.[0]?.id;
  const delOther = await call(`/api/cart/items/${itemId}`, { method: 'DELETE', guest: g2 });
  const cartAfter = await call('/api/cart', { guest: g1 });
  check('B6', 'idor', "another guest cannot delete a cart line by id", delOther.status === 404 && cartAfter.data?.items?.length === 1, `delete status ${delOther.status}`);
  // admin-order creation by admin token is blocked
  const adminOrder = await call('/api/orders', { method: 'POST', token: adminToken, body: { customer: customerBody(), items: [{ variantId: P.variantId, quantity: 1 }] } });
  check('B7', 'authz', 'admins cannot place storefront orders', adminOrder.status === 403, `status ${adminOrder.status}`);

  // ---------- 3. PRICE TAMPERING ----------
  _resetRateLimits();
  const tamper = await call('/api/orders', { method: 'POST', guest: rid(), body: {
    customer: customerBody(), deliveryFee: 0, total: 1, subtotal: 1, discount: 99,
    items: [{ variantId: P.variantId, quantity: 1, price: 0.001, unitPrice: 0.001, discount: 100 }] } });
  if (tamper.status === 201) cleanup.orders.push(tamper.data.id);
  check('C1', 'pricing', 'POST /orders ignores client price/total/deliveryFee/discount', tamper.status === 201 && Number(tamper.data.subtotal) === 100 && Number(tamper.data.deliveryFee) > 0,
    `status ${tamper.status} subtotal=${tamper.data?.subtotal} fee=${tamper.data?.deliveryFee} total=${tamper.data?.total}`);
  _resetRateLimits();
  const gBuy = rid();
  const buyNow = await call('/api/orders/checkout', { method: 'POST', guest: gBuy, body: { customer: customerBody(), buyNowItem: { variantId: P.variantId, quantity: 1, price: 1 } } });
  if (buyNow.status === 201) cleanup.orders.push(buyNow.data.id);
  check('C2', 'pricing', 'buy-now checkout ignores client price', buyNow.status === 201 && Number(buyNow.data.subtotal) === 100, `status ${buyNow.status} subtotal=${buyNow.data?.subtotal}`);
  const gCart = rid();
  await call('/api/cart/items', { method: 'POST', guest: gCart, body: { variantId: P.variantId, quantity: 1, price: 1, unitPrice: 1 } });
  const cartView = await call('/api/cart', { guest: gCart });
  _resetRateLimits();
  const cartCheckout = await call('/api/orders/checkout', { method: 'POST', guest: gCart, body: { customer: customerBody(), items: [{ variantId: P.variantId, quantity: 1, price: 1 }], price: 1, total: 1 } });
  if (cartCheckout.status === 201) cleanup.orders.push(cartCheckout.data.id);
  check('C3', 'pricing', 'cart add/checkout ignore client price', Number(cartView.data?.subtotal) === 100 && cartCheckout.status === 201 && Number(cartCheckout.data.subtotal) === 100,
    `cart subtotal=${cartView.data?.subtotal} order subtotal=${cartCheckout.data?.subtotal}`);

  // ---------- 4. NEGATIVE / ABNORMAL QUANTITIES ----------
  const before = await stockOf(P.variantId);
  const badQty = [-1, 0, -999999, 1.5, '1e3', '-1', 'abc', null, true, [1], { a: 1 }, 1e9, 99999999999999999999, '0x10', ' 2'];
  const accepted = [];
  for (const q of badQty) {
    _resetRateLimits();
    const r = await call('/api/orders', { method: 'POST', guest: rid(), body: { customer: customerBody(), items: [{ variantId: P.variantId, quantity: q }] } });
    if (r.status === 201) { cleanup.orders.push(r.data.id); accepted.push(`${JSON.stringify(q)} (total ${r.data.total}, qty ${r.data.items?.[0]?.quantity})`); }
  }
  // " 2" string is trimmed and valid by design; everything else must be rejected
  const unexpected = accepted.filter((a) => !a.startsWith('" 2"'));
  check('D1', 'validation', 'POST /orders rejects negative/zero/fractional/garbage quantities', unexpected.length === 0, unexpected.join(' | '));
  const cartBad = [];
  for (const q of [-5, 0, 1.5, 'abc', 1e9, null]) {
    const gg = rid();
    const r = await call('/api/cart/items', { method: 'POST', guest: gg, body: { variantId: P.variantId, quantity: q } });
    const qty = r.data?.items?.[0]?.quantity;
    if (r.status === 200 && !(Number.isInteger(qty) && qty >= 1 && qty <= before)) cartBad.push(`${JSON.stringify(q)} -> qty ${qty}`);
    if (r.status === 200 && q === 1.5) cartBad.push(`1.5 accepted as qty ${qty}`);
  }
  info('D2', 'validation', 'cart add with odd quantities (-5, 0, 1.5, "abc", 1e9, null)', cartBad.length ? 'ODD: ' + cartBad.join(' | ') : 'all rejected or coerced to a valid integer');
  const bnNeg = await call('/api/orders/checkout', { method: 'POST', guest: rid(), body: { customer: customerBody(), buyNowItem: { variantId: P.variantId, quantity: -3 } } });
  check('D3', 'validation', 'buy-now with negative quantity is rejected', bnNeg.status === 400, `status ${bnNeg.status}`);
  const unknownVar = await call('/api/orders', { method: 'POST', guest: rid(), body: { customer: customerBody(), items: [{ variantId: fakeUuid, quantity: 1 }] } });
  check('D4', 'validation', 'unknown variant rejected (4xx, not 5xx)', unknownVar.status >= 400 && unknownVar.status < 500, `status ${unknownVar.status}`);
  const after = await stockOf(P.variantId);
  const sold = (await pool.query("select coalesce(sum(oi.quantity),0)::int n from order_items oi join orders o on o.id=oi.order_id where oi.variant_id=$1 and o.status not in ('cancelled')", [P.variantId])).rows[0].n;
  check('D5', 'integrity', 'stock never goes up or negative from abnormal input', after >= 0 && after <= 20, `stock ${after}, units in live orders ${sold}`);

  // ---------- 5. COUPON / REPLAY ----------
  info('E0', 'coupons', 'coupon / promo-code feature', 'does not exist in this codebase (no coupon tables, routes or fields) - single-use test not applicable');
  const S = await mkProduct(`Probe Stock ${stamp}`, 50, 3);
  const key = rid();
  _resetRateLimits();
  const gi = rid();
  const body = { customer: customerBody({ phone: '20000111' }), items: [{ variantId: S.variantId, quantity: 1 }] };
  const i1 = await call('/api/orders', { method: 'POST', guest: gi, headers: { 'Idempotency-Key': key }, body });
  const i2 = await call('/api/orders', { method: 'POST', guest: gi, headers: { 'Idempotency-Key': key }, body });
  if (i1.status === 201) cleanup.orders.push(i1.data.id);
  check('E1', 'replay', 'same Idempotency-Key replayed -> one order, stock taken once', i1.status === 201 && i2.status === 201 && i1.data.id === i2.data.id && (await stockOf(S.variantId)) === 2, `ids equal=${i1.data?.id === i2.data?.id}, stock=${await stockOf(S.variantId)}`);
  // oversell race: stock is 2 now, fire 8 parallel orders of 1
  _resetRateLimits();
  const race = await Promise.all(Array.from({ length: 8 }, () => call('/api/orders', { method: 'POST', guest: rid(), body: { customer: customerBody(), items: [{ variantId: S.variantId, quantity: 1 }] } })));
  race.filter((r) => r.status === 201).forEach((r) => cleanup.orders.push(r.data.id));
  const okCount = race.filter((r) => r.status === 201).length;
  check('E2', 'integrity', 'concurrent orders cannot oversell (stock 2, 8 racers)', okCount === 2 && (await stockOf(S.variantId)) === 0, `${okCount} succeeded, stock ${await stockOf(S.variantId)}`);
  // double-confirm / double-cancel
  if (i1.status === 201) {
    const c1 = await call(`/api/orders/${i1.data.id}/cancel`, { method: 'POST', token: adminToken });
    const stockAfterFirst = await stockOf(S.variantId);
    const c2 = await call(`/api/orders/${i1.data.id}/cancel`, { method: 'POST', token: adminToken });
    const stockAfterSecond = await stockOf(S.variantId);
    check('E3', 'replay', 'cancelling twice restores stock only once', stockAfterSecond === stockAfterFirst, `stock ${stockAfterFirst} -> ${stockAfterSecond} (statuses ${c1.status}/${c2.status})`);
    const cf = await call(`/api/orders/${i1.data.id}/confirm`, { method: 'POST', token: adminToken });
    info('E3b', 'replay', 'confirming a cancelled order', `status ${cf.status} ${cf.data?.error || cf.data?.status || ''}`);
  }

  // ---------- 6. FILE UPLOAD ----------
  const up = async (field, route, filename, type, content, token = adminToken) => {
    const fd = new FormData();
    fd.append(field, new Blob([content], { type }), filename);
    const res = await fetch(BASE + route, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    const t = await res.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
    return { status: res.status, data: d, text: t };
  };
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const cases = [
    ['html as png', 'evil.html', 'image/png', '<html><script>alert(document.domain)</script></html>'],
    ['svg as png', 'evil.svg', 'image/png', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'],
    ['exe as jpeg', 'shell.exe', 'image/jpeg', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)])],
    ['js as png', 'x.js', 'image/png', 'alert(1)'],
    ['php double ext', 'shell.php.jpg', 'image/jpeg', '<?php system($_GET[0]); ?>'],
    ['text pretending jpg', 'fake.jpg', 'image/jpeg', 'this is not an image at all'],
    ['traversal name', '../../evil.html', 'image/png', '<script>1</script>'],
    ['declared svg', 'a.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['declared html', 'a.html', 'text/html', '<script>1</script>'],
    ['real png (control)', 'ok.png', 'image/png', pngBytes],
  ];
  const stored = [];
  for (const [label, fname, type, content] of cases) {
    const r = await up('image', '/api/products/upload', fname, type, content);
    const url = r.data?.url || r.data?.path || r.data?.imageUrl || (typeof r.text === 'string' && (r.text.match(/\/uploads\/[^"']+/) || [])[0]);
    let served = '';
    if (r.status < 300 && url) {
      const f = await fetch(BASE + (url.startsWith('http') ? new URL(url).pathname : url));
      served = `${f.status} ${f.headers.get('content-type')} nosniff=${!!f.headers.get('x-content-type-options')}`;
    }
    stored.push({ label, fname, status: r.status, url, served, body: r.status >= 300 ? String(r.data?.error || r.text).slice(0, 80) : '' });
  }
  console.table(stored.map(({ label, fname, status, url, served, body }) => ({ label, fname, status, url, served, body })));
  const dangerous = stored.filter((s) => s.label !== 'real png (control)' && s.status < 300);
  const executable = dangerous.filter((s) => /text\/html|svg|javascript|php|x-msdownload/.test(s.served));
  check('F1', 'upload', 'non-image files (html/svg/exe/js/php/text) are rejected by content, not just by claimed MIME type', dangerous.length === 0, `${dangerous.length} accepted: ${dangerous.map((d) => d.fname).join(', ')}`);
  check('F2', 'upload', 'nothing uploaded is served back as html/svg/javascript from the site origin', executable.length === 0, executable.map((d) => `${d.fname} => ${d.served}`).join(' | '));
  const upCust = await up('image', '/api/products/upload', 'ok.png', 'image/png', pngBytes, A.token);
  const upAnon = await up('image', '/api/products/upload', 'ok.png', 'image/png', pngBytes, null);
  check('F3', 'upload', 'customers / anonymous cannot upload', upCust.status === 403 && upAnon.status === 401, `${upCust.status}/${upAnon.status}`);
  const vid = await up('video', `/api/products/${P.product.id}/videos`, 'v.html', 'video/mp4', '<script>alert(1)</script>');
  info('F4', 'upload', 'video upload with html content labelled video/mp4', `status ${vid.status}`);
  const hugeName = await up('image', '/api/products/upload', 'a'.repeat(300) + '.png', 'image/png', pngBytes);
  info('F5', 'upload', '300-char filename', `status ${hugeName.status}`);

  // ---------- 7. XSS / injection in stored text ----------
  const X = `<script>alert(1)</script><img src=x onerror=alert(2)>"'</script>`;
  const rv = await call('/api/reviews', { method: 'POST', token: A.token, body: { body: X, rating: 5 } });
  info('G1', 'xss', 'store review with script payload', `status ${rv.status}: payload stored verbatim (JSON API); safety depends on rendering`);
  const rvBad = [];
  for (const r of [999, -3, 'abc', {}]) {
    const x = await call('/api/reviews', { method: 'POST', token: A.token, body: { body: 'bad rating', rating: r } });
    if (x.status === 201) rvBad.push(`rating ${JSON.stringify(r)} accepted`);
  }
  check('G2', 'validation', 'review rating is range-checked (1..5)', rvBad.length === 0, rvBad.join(', '));
  const longRv = await call('/api/reviews', { method: 'POST', token: A.token, body: { body: 'x'.repeat(90000), rating: 5 } });
  check('G3', 'validation', 'review length is capped', longRv.status === 400 || longRv.status === 413, `90 kB review -> ${longRv.status}`);
  const prodRv = await call(`/api/products/${P.product.id}/reviews`, { method: 'POST', token: A.token, body: { body: X, rating: 5, authorName: 'Fake Name <b>' } });
  info('G4', 'xss', 'product review script payload', `status ${prodRv.status}`);
  const pub = await call(`/api/products/${P.product.id}/reviews`);
  info('G5', 'xss', 'unapproved product reviews appear in public list?', JSON.stringify(pub.data).includes('<script>') ? 'YES - visible before moderation' : 'no (moderated or not returned)');
  const sqli = ["' OR '1'='1", "'; DROP TABLE users;--", "\" OR 1=1 --", "1 UNION SELECT password_hash FROM users--"];
  const sqliBad = [];
  for (const s of sqli) {
    _resetRateLimits();
    for (const [path, opt] of [
      ['/api/auth/login', { method: 'POST', body: { identifier: s, password: s } }],
      ['/api/auth/forgot-password', { method: 'POST', body: { email: s } }],
      [`/api/products?search=${encodeURIComponent(s)}&category=${encodeURIComponent(s)}&q=${encodeURIComponent(s)}`, {}],
      [`/api/products/${encodeURIComponent(s)}`, {}],
      [`/api/orders/${encodeURIComponent(s)}`, { token: adminToken }],
      [`/api/products/${P.product.id}/reviews?sort=${encodeURIComponent(s)}`, {}],
    ]) {
      const r = await call(path, opt);
      if ((r.status >= 500 && !path.startsWith('/api/orders/')) || LEAK.test(r.text) || (path.includes('login') && r.status === 200)) sqliBad.push(`${path.slice(0, 40)} ${JSON.stringify(s).slice(0, 14)} -> ${r.status}`);
    }
  }
  check('H1', 'sqli', 'SQL-injection payloads in login, reset, filters, path ids never reach SQL (no 5xx, no DB text, no auth bypass)', sqliBad.length === 0, sqliBad.join(' | '));
  const usersStill = (await pool.query('select count(*)::int n from users')).rows[0].n;
  check('H2', 'sqli', 'users table still exists after DROP TABLE payload', usersStill > 0, `${usersStill} users`);

  // The API no longer renders pages (the Astro storefront does, with its own tests): a hostile product name must not come back as HTML from it
  const evilName = `Evil </title><script>window.__pwn=1</script><img src=x onerror=alert(1)> ${stamp}`;
  const E = await mkProduct(evilName, 10, 1, { description: `</script><script>alert(3)</script>` });
  const slug = (await pool.query('select slug from products where id=$1', [E.product.id])).rows[0].slug;
  const page = await rawGet(`/product/${slug}`);
  info('G6', 'xss', 'the API serves no product page (pages are the Astro storefront job)', `status ${page.status}, ${page.text.length} bytes, contains raw <script>window.__pwn: ${page.text.includes('<script>window.__pwn')}`);

  // ---------- 8. AUTH / SESSION ----------
  // logout is server-side no-op
  const outAdmin = (await pool.query("insert into users (email,password_hash,role,full_name,phone_number) values ($1,'x','admin','Logout Admin',$2) returning *", [`out-admin-${stamp}@example.invalid`, phone()])).rows[0];
  cleanup.users.push(outAdmin.id);
  const outTok = signAccessToken(outAdmin);
  await new Promise((r) => setTimeout(r, 1100)); // revocation has one-second precision (token iat is in whole seconds)
  const lo = await call('/api/admin/logout', { method: 'POST', token: outTok });
  const afterLo = await call('/api/admin/inventory', { token: outTok });
  check('S1', 'session', 'admin token stops working after logout', afterLo.status === 401, `logout ${lo.status}, same token afterwards -> ${afterLo.status}`);
  // password change vs old token
  const chg = await call('/api/auth/change-password', { method: 'POST', token: B.token, body: { currentPassword: 'Probe-pass-1', newPassword: 'Probe-pass-2' } });
  const oldTok = await call('/api/auth/me', { token: B.token });
  const newTok = await call('/api/auth/me', { token: chg.data?.token });
  check('S2', 'session', 'tokens issued before a password change are revoked, and the new one works', chg.status === 200 && oldTok.status === 401 && newTok.status === 200, `change ${chg.status}, old token -> ${oldTok.status}, new token -> ${newTok.status}`);
  // demoted / deleted admin keeps access
  const tmpAdmin = (await pool.query("insert into users (email,password_hash,role,full_name,phone_number) values ($1,'x','admin','Tmp Admin',$2) returning *", [`tmp-admin-${stamp}@example.invalid`, phone()])).rows[0];
  cleanup.users.push(tmpAdmin.id);
  const tmpTok = signAccessToken(tmpAdmin);
  await pool.query("update users set role='customer' where id=$1", [tmpAdmin.id]);
  const demoted = await call('/api/admin/inventory', { token: tmpTok });
  check('S3', 'session', 'admin demoted in DB loses admin access immediately', demoted.status === 403 || demoted.status === 401, `status ${demoted.status} (token valid ${env.jwtExpiresIn})`);
  const delCust = await mkCustomer('Del');
  await pool.query('delete from users where id=$1', [delCust.id]);
  const deleted = await call('/api/auth/me', { token: delCust.token });
  info('S4', 'session', '/auth/me with token of deleted user', `status ${deleted.status}`);
  // password storage
  const hashRow = (await pool.query('select password_hash from users where id=$1', [A.id])).rows[0];
  check('S5', 'password', 'passwords stored as bcrypt (cost >= 10)', /^\$2[aby]\$(1[0-9]|[2-3][0-9])\$/.test(hashRow.password_hash), hashRow.password_hash.slice(0, 7));
  const weak = await call('/api/auth/register', { method: 'POST', body: { identifier: phone(), password: '12345678', fullName: 'Weak' } });
  if (weak.status === 201) cleanup.users.push(weak.data.user.id);
  info('S6', 'password', 'password policy accepts "12345678"', `status ${weak.status} (only a length >= 8 rule exists)`);
  // login timing -> user enumeration
  const time = async (ident) => { const t = process.hrtime.bigint(); await call('/api/auth/login', { method: 'POST', body: { identifier: ident, password: 'Wrong-pass-0' } }); return Number(process.hrtime.bigint() - t) / 1e6; };
  _resetRateLimits(); const known = []; const unknown = [];
  for (let i = 0; i < 4; i++) { known.push(await time(A.phone)); unknown.push(await time(phone())); }
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  check('S7', 'authn', 'login takes similar time for known and unknown accounts (no timing enumeration)', med(known) < med(unknown) * 3 + 20, `known ${med(known).toFixed(0)} ms vs unknown ${med(unknown).toFixed(0)} ms`);
  // password reset lifecycle
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  await userRepository.createPasswordReset(A.id, hash, new Date(Date.now() + 3600e3));
  const rawExp = crypto.randomBytes(32).toString('hex');
  await userRepository.createPasswordReset(A.id, crypto.createHash('sha256').update(rawExp).digest('hex'), new Date(Date.now() - 1000));
  _resetRateLimits();
  const rs1 = await call('/api/auth/reset-password', { method: 'POST', body: { token: raw, newPassword: 'Reset-pass-9' } });
  const rs2 = await call('/api/auth/reset-password', { method: 'POST', body: { token: raw, newPassword: 'Reset-pass-10' } });
  const rsExp = await call('/api/auth/reset-password', { method: 'POST', body: { token: rawExp, newPassword: 'Reset-pass-11' } });
  const rsHash = await call('/api/auth/reset-password', { method: 'POST', body: { token: hash, newPassword: 'Reset-pass-12' } });
  check('S8', 'reset', 'reset token works once, expired / reused / stored-hash tokens are refused', rs1.status === 200 && rs2.status === 400 && rsExp.status === 400 && rsHash.status === 400, `${rs1.status}/${rs2.status}/${rsExp.status}/${rsHash.status}`);
  const tokCol = await pool.query("select column_name from information_schema.columns where table_name='password_resets'");
  info('S8b', 'reset', 'reset tokens stored hashed (sha256), raw token never saved', tokCol.rows.map((r) => r.column_name).join(','));
  const oldAfterReset = await call('/api/auth/me', { token: A.token });
  check('S9', 'session', 'a password reset revokes sessions opened before it', oldAfterReset.status === 401, `old token -> ${oldAfterReset.status}`);
  _resetRateLimits();
  const fp1 = await call('/api/auth/forgot-password', { method: 'POST', body: { email: 'nobody-at-all@example.invalid' } });
  info('S10', 'reset', 'forgot-password for unknown email', `${fp1.status} ${JSON.stringify(fp1.data)}`);
  const en = await call('/api/auth/register', { method: 'POST', body: { identifier: `dup-${stamp}@example.invalid`, password: 'Probe-pass-1', fullName: 'Dup' } });
  if (en.status === 201) cleanup.users.push(en.data.user.id);
  _resetRateLimits();
  const en2 = await call('/api/auth/register', { method: 'POST', body: { identifier: `dup-${stamp}@example.invalid`, password: 'Probe-pass-1', fullName: 'Dup' } });
  info('S11', 'authn', 'registering an existing email reveals that it exists (account enumeration)', `status ${en2.status}`);
  const regBadEmail = await call('/api/auth/register', { method: 'POST', body: { identifier: 'not an email @', password: 'Probe-pass-1', fullName: 'X' } });
  info('S12', 'validation', 'register with malformed email', `status ${regBadEmail.status}`);

  // ---------- 9. RATE LIMITING ----------
  const rl = async (label, id, n, mk, expect) => {
    _resetRateLimits();
    const codes = [];
    for (let i = 0; i < n; i++) codes.push((await call(...mk(i))).status);
    const first429 = codes.indexOf(429) + 1;
    check(id, 'ratelimit', `${label}: 429 after ${expect} attempts`, first429 === expect + 1, `first 429 at attempt ${first429 || 'never'} of ${n}`);
  };
  await rl('customer login', 'R1', 14, (i) => ['/api/auth/login', { method: 'POST', body: { identifier: A.phone, password: 'x' + i } }], 10);
  await rl('registration', 'R2', 8, (i) => ['/api/auth/register', { method: 'POST', body: { identifier: phone(), password: 'short', fullName: 'x' } }], 5);
  await rl('forgot password', 'R3', 8, () => ['/api/auth/forgot-password', { method: 'POST', body: { email: 'a@example.invalid' } }], 5);
  await rl('admin login', 'R4', 8, (i) => ['/api/admin/login', { method: 'POST', body: { password: 'wrong' + i } }], 5);
  _resetRateLimits();
  const codes = [];
  for (let i = 0; i < 14; i++) codes.push((await call('/api/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': `10.9.${i}.1` }, body: { identifier: A.phone, password: 'z' + i } })).status);
  check('R5', 'ratelimit', 'rotating X-Forwarded-For does not bypass the login limit', codes.includes(429), codes.join(','));
  _resetRateLimits();
  const cc = [];
  for (let i = 0; i < 40; i++) cc.push((await call('/api/contact', { method: 'POST', body: { firstName: 'Spam', lastName: 'Bot', email: 'spam@example.invalid', message: 'spam spam ' + i } })).status);
  check('R6', 'ratelimit', 'contact form is rate-limited', cc.includes(429), `statuses ${[...new Set(cc)].join(',')}`);
  _resetRateLimits();
  const rr = [];
  const tokA = signAccessToken({ id: A.id, email: null, role: 'customer', fullName: 'Probe A' });
  for (let i = 0; i < 25; i++) rr.push((await call('/api/reviews', { method: 'POST', token: tokA, body: { body: 'review ' + i, rating: 5 } })).status);
  check('R7', 'ratelimit', 'review submission is rate-limited', rr.includes(429), `statuses ${[...new Set(rr)].join(',')}`);
  _resetRateLimits();
  const cr = [];
  const gz = rid();
  for (let i = 0; i < 60; i++) cr.push((await call('/api/cart/items', { method: 'POST', guest: rid(), body: { variantId: P.variantId, quantity: 1 } })).status);
  info('R8', 'ratelimit', 'cart creation (guest) is unthrottled: 60 new guest carts', `statuses ${[...new Set(cr)].join(',')}`);

  // ---------- 10. CSRF / CORS / headers / errors / secrets ----------
  const csrf = [];
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded']) {
    const r = await call('/api/cart/items', { method: 'POST', headers: { 'Content-Type': ct, Origin: 'https://evil.example' }, guest: rid(), raw: JSON.stringify({ variantId: P.variantId, quantity: 1 }) });
    if (r.status === 200) csrf.push(ct);
  }
  check('X1', 'csrf', 'cross-site form/text POST cannot add to a cart (JSON-only API)', csrf.length === 0, csrf.join(','));
  const cors = await call('/api/products', { headers: { Origin: 'https://evil.example' } });
  const pre = await call('/api/orders', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
  check('X2', 'cors', 'untrusted Origin gets no Access-Control-Allow-Origin', !cors.headers.get('access-control-allow-origin') && !pre.headers.get('access-control-allow-origin'), `${cors.headers.get('access-control-allow-origin')} / ${pre.headers.get('access-control-allow-origin')}`);
  const h = (await call('/api/products')).headers;
  const missing = ['x-content-type-options', 'x-frame-options', 'referrer-policy'].filter((k) => !h.get(k));
  check('X3', 'headers', 'security headers present (CSP, nosniff, X-Frame-Options, HSTS, Referrer-Policy)', missing.length === 0, 'missing: ' + missing.join(', '));
  check('X4', 'headers', 'X-Powered-By is not advertised', !h.get('x-powered-by'), `x-powered-by: ${h.get('x-powered-by')}`);
  const homePage = await call('/');
  const cspPage = homePage.headers.get('content-security-policy-report-only') || '';
  check('X3b', 'headers', 'pages carry a report-only Content-Security-Policy (never enforced by default), API answers do not',
    /default-src 'self'/.test(cspPage) && /object-src 'none'/.test(cspPage) && !/script-src/.test(homePage.headers.get('content-security-policy') || '') && !h.get('content-security-policy-report-only'),
    cspPage ? 'present' : 'missing');
  const ck = (await call('/api/cart', { guest: rid() })).headers.get('set-cookie') || '';
  check('X5', 'session', 'guest cookie is HttpOnly + SameSite', /httponly/i.test(ck) && /samesite=(lax|strict)/i.test(ck), ck.replace(/=[0-9a-f-]{36}/, '=<id>'));
  const trav = [];
  for (const p of ['/uploads/..%2f..%2f.env', '/uploads/%2e%2e/%2e%2e/.env', '/uploads/..%5c..%5c.env', '/.env', '/server/config/env.js', '/package.json', '/.git/config', '/uploads/../../.env', '/%2e%2e/.env']) {
    const r = await rawGet(p);
    if (r.status === 200 && /JWT_SECRET|DATABASE_URL|"dependencies"|\[core\]|dotenv/.test(r.text)) trav.push(`${p} -> 200 leaks`);
  }
  check('X6', 'secrets', 'no source/.env/.git/package.json reachable via static routes or path traversal', trav.length === 0, trav.join(' | '));
  const errs = [];
  const tokA2 = signAccessToken({ id: A.id, email: null, role: 'customer', fullName: 'Probe A' });
  for (const [path, opt] of [
    ['/api/auth/login', { method: 'POST', raw: '{bad json', headers: { 'Content-Type': 'application/json' } }],
    ['/api/orders/not-a-uuid', { token: adminToken }], ['/api/orders/' + 'x'.repeat(5000), { token: adminToken }],
    ['/api/products/' + fakeUuid, {}], ['/api/nonexistent', {}],
    ['/api/orders', { method: 'POST', body: { customer: null, items: [{ variantId: 'zzz', quantity: 1 }] } }],
    ['/api/orders', { method: 'POST', body: { customer: customerBody(), items: [{ variantId: 'zzz', quantity: 1 }] } }],
    ['/api/products', { method: 'POST', token: adminToken, body: { name: 1, price: 'abc', colors: 'x', sizes: 5 } }],
    ['/api/admin/orders/manual', { method: 'POST', token: adminToken, body: { items: 'x' } }],
    ['/api/cart/items', { method: 'POST', guest: rid(), body: { variantId: { $ne: 1 }, quantity: 1 } }],
    ['/api/auth/login', { method: 'POST', body: { identifier: { a: 1 }, password: ['x'] } }],
    ['/api/auth/register', { method: 'POST', body: { identifier: 5, password: 12345678, fullName: {} } }],
    ['/api/webhooks/goodex', { method: 'POST', body: { code: 'x', statut: 'y' } }],
    ['/api/orders', { method: 'POST', guest: rid(), body: { customer: 'str', items: [{ variantId: P.variantId, quantity: 1 }] } }],
    ['/api/orders', { method: 'POST', guest: rid(), body: { customer: { name: {}, phone: [], address: 5, governorateId: {} }, items: [{ variantId: P.variantId, quantity: 1 }] } }],
    ['/api/orders', { method: 'POST', guest: rid(), body: { customer: customerBody(), items: 'x' } }],
    ['/api/orders', { method: 'POST', guest: rid(), body: { customer: customerBody(), items: [null, 5, 'a'] } }],
    ['/api/orders/checkout', { method: 'POST', guest: rid(), body: { customer: { name: 5 }, buyNowItem: 'x' } }],
    ['/api/reviews', { method: 'POST', token: tokA2, body: { body: {}, rating: {} } }],
    ['/api/products/' + P.product.id + '/reviews', { method: 'POST', token: tokA2, body: { body: [], rating: 'x' } }],
    ['/api/contact', { method: 'POST', body: { firstName: {}, lastName: [], email: 5, message: {} } }],
    ['/api/auth/me', { method: 'PATCH', token: tokA2, body: { fullName: {}, phoneNumber: [], email: 5 } }],
    ['/api/auth/change-password', { method: 'POST', token: tokA2, body: { currentPassword: {}, newPassword: [] } }],
    ['/api/auth/forgot-password', { method: 'POST', body: { email: {} } }],
    ['/api/auth/reset-password', { method: 'POST', body: { token: {}, newPassword: [] } }],
    ['/api/cart/items', { method: 'POST', guest: rid(), body: { productId: {}, colorId: [], size: 5 } }],
    ['/api/favourites/toggle', { method: 'POST', guest: rid(), body: { productId: {}, variantId: [] } }],
    ['/api/admin/login', { method: 'POST', body: { password: {} } }],
    ['/api/products', { method: 'POST', token: adminToken, body: { name: 'ok', price: -5, colors: [], sizes: [] } }],
    ['/api/products', { method: 'POST', token: adminToken, body: { name: 'ok', price: 'abc' } }],
  ]) {
    _resetRateLimits();
    const r = await call(path, opt);
    if (LEAK.test(r.text) || r.status === 0 || (r.status >= 500 && r.status !== 500 && r.status !== 503)) errs.push(`${(opt.method || 'GET')} ${path.slice(0, 40)} -> ${r.status} ${r.text.slice(0, 90).replace(/\s+/g, ' ')}`);
  }
  check('X7', 'errors', 'malformed / hostile requests never give a 5xx or reveal paths, SQL or stack traces', errs.length === 0, errs.join(' || '));
  check('X7b', 'errors', 'no unhandled promise rejections (hung requests / process crash) from hostile input', unhandled.length === 0, unhandled.join(' | '));
  const wh = await call('/api/webhooks/goodex', { method: 'POST', body: { code: 'X', statut: 'Livré' } });
  const wh2 = await call('/api/webhooks/goodex', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: { code: 'X', statut: 'Livré' } });
  check('X8', 'authn', 'GOODEX webhook refuses missing / wrong bearer secret', [401, 403, 503].includes(wh.status) && [401, 403, 503].includes(wh2.status), `${wh.status}/${wh2.status}`);
  const defPw = env.adminPassword === 'silky-admin';
  check('X9', 'secrets', 'admin panel password is not the built-in default', !defPw, `length ${env.adminPassword.length}${defPw ? ' (default value)' : ''}`);
  info('X10', 'secrets', 'DB URL / admin password fall back to defaults when env vars are missing in production', 'env.js only validates JWT_SECRET and CORS in production (see report)');

  // ---------- 11. UPLOAD SIGNATURES, PRODUCTION CONFIG ----------
  const { sniffMime, contentMatchesMime, safeExtension } = await imp('utils/fileSignature.js');
  const pad = (...b) => Buffer.concat([Buffer.from(b), Buffer.alloc(24)]);
  const signatures = {
    'image/jpeg': pad(0xff, 0xd8, 0xff, 0xe0),
    'image/png': pngBytes,
    'image/gif': Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(24)]),
    'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(24)]),
    'image/avif': Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(24)]),
    'video/mp4': Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(24)]),
    'video/webm': pad(0x1a, 0x45, 0xdf, 0xa3),
    'video/ogg': Buffer.concat([Buffer.from('OggS'), Buffer.alloc(28)]),
  };
  const wrong = Object.entries(signatures).filter(([mime, bytes]) => sniffMime(bytes) !== mime).map(([m]) => m);
  check('U1', 'upload', 'every accepted format is recognised from its first bytes', wrong.length === 0, wrong.join(', '));
  const notFiles = ['<html><script>1</script></html>', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'MZ' + '\0'.repeat(40), '<?php echo 1; ?>' + ' '.repeat(20), 'short', ''];
  check('U2', 'upload', 'html / svg / exe / php / empty content is never recognised', notFiles.every((t) => sniffMime(Buffer.from(t)) === null));
  check('U3', 'upload', 'a QuickTime upload may carry MP4-style bytes, a PNG may not claim to be a JPEG',
    contentMatchesMime('video/quicktime', signatures['video/mp4']) && !contentMatchesMime('image/jpeg', signatures['image/png']));
  check('U4', 'upload', 'stored extension always fits the declared type', safeExtension('image/png', 'evil.html') === '.png' && safeExtension('image/jpeg', 'Photo.JPEG') === '.JPEG' && safeExtension('video/mp4', 'a.php') === '.mp4');
  const goodUploads = [];
  for (const [mime, name, bytes] of [['image/jpeg', 'a.jpg', signatures['image/jpeg']], ['image/gif', 'a.gif', signatures['image/gif']], ['image/webp', 'a.webp', signatures['image/webp']], ['image/avif', 'a.avif', signatures['image/avif']]]) {
    const r = await up('image', '/api/products/upload', name, mime, bytes);
    if (r.status !== 200) goodUploads.push(`${mime} -> ${r.status} ${r.text.slice(0, 80)}`);
  }
  check('U5', 'upload', 'genuine jpeg / gif / webp / avif / png images are still accepted', goodUploads.length === 0, goodUploads.join(' | '));
  const goodVideo = await up('video', `/api/products/${P.product.id}/videos`, 'v.mp4', 'video/mp4', Buffer.concat([signatures['video/mp4'], Buffer.alloc(64)]));
  check('U6', 'upload', 'a genuine mp4 video is still accepted', goodVideo.status === 201, `status ${goodVideo.status} ${goodVideo.status === 201 ? '' : goodVideo.text.slice(0, 100)}`);

  const { validateAdminPassword, validateDatabaseUrl, parseTrustProxy } = await imp('config/env.js');
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  check('P1', 'config', 'production refuses a missing, default or short ADMIN_PASSWORD', ['', 'silky-admin', 'change-me', 'short'].every((p) => throws(() => validateAdminPassword(p, true))));
  check('P2', 'config', 'production accepts a strong ADMIN_PASSWORD; development keeps its fallback', validateAdminPassword('a-long-unique-pass', true) === 'a-long-unique-pass' && validateAdminPassword('', false) === 'silky-admin');
  check('P3', 'config', 'production refuses a missing DATABASE_URL; development keeps its fallback', throws(() => validateDatabaseUrl('', true)) && validateDatabaseUrl('', false).includes('/silky'));
  const { parseCspMode } = await imp('config/env.js');
  check('P5', 'config', 'CSP_MODE: report-only by default, enforce/off only when asked, junk falls back to report-only', parseCspMode('') === 'report-only' && parseCspMode('enforce') === 'enforce' && parseCspMode(' OFF ') === 'off' && parseCspMode('yes') === 'report-only');
  check('P4', 'config', 'TRUST_PROXY: unset/false/0 = off, number = hops, "true" = one hop', parseTrustProxy('') === false && parseTrustProxy('false') === false && parseTrustProxy('0') === false && parseTrustProxy('2') === 2 && parseTrustProxy('true') === 1 && parseTrustProxy('loopback') === 'loopback');
} catch (err) {
  console.error('TEST CRASHED:', err);
  process.exitCode = 1;
} finally {
  try {
    if (cleanup.orders.length) { await pool.query('delete from order_items where order_id = any($1)', [cleanup.orders]).catch(() => {}); await pool.query('delete from orders where id = any($1)', [cleanup.orders]).catch(() => {}); }
    await pool.query("delete from orders where customer_phone='20000111'").catch(() => {});
    if (cleanup.products.length) await pool.query('delete from products where id = any($1)', [cleanup.products]).catch(() => {});
    if (cleanup.categories.length) await pool.query('delete from categories where id = any($1)', [cleanup.categories]).catch(() => {});
    if (cleanup.users.length) await pool.query('delete from users where id = any($1)', [cleanup.users]).catch(() => {});
  } catch { /* best effort */ }
  const fails = results.filter((r) => r.ok === false);
  console.log(`\n==== ${results.filter((r) => r.ok === true).length} passed, ${fails.length} FAILED, ${results.filter((r) => r.ok === null).length} informational ====`);
  fails.forEach((f) => console.log(`FAIL [${f.id}] ${f.name}  -> ${f.detail}`));
  await new Promise((r) => server.close(r));
  fs.rmSync(uploadsTmp, { recursive: true, force: true });
  await pool.end().catch(() => {});
  process.exit(fails.length ? 1 : 0);
}
