/**
 * Only a logged-in customer can write a review (store review and product review); the contact form stays open to
 * guests. A review always belongs to the account: its author name is the account's full name (never typed) and a
 * guest session is never stored on it.
 *
 * Database safety: refuses to run unless DATABASE_URL is set in the environment to exactly "silky_test" on a
 * loopback host (helpers/silky_test_guard.js), re-checked on the live connection before the first write. Every row
 * it creates (customer, product, category, reviews, contact messages) is deleted in a finally block and the cleanup
 * is verified.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_reviews_customers_only.js
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { createAccount, removeAccounts } from './helpers/test_accounts.js';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();

process.env.SMTP_HOST = process.env.SMTP_HOST || '127.0.0.1';
process.env.SMTP_PORT = process.env.SMTP_PORT || '1';
process.env.GOODEX_ENABLE_LIVE = 'false';

const { app } = await import('../app.js');
const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products, reviews, storeReviews, contactMessages, users } = await import('../models/index.js');
const { default: jwt } = await import('jsonwebtoken');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

let BASE = '';
async function call(method, path, { token, body, guest } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (guest) headers['X-Guest-Session-Id'] = guest;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, text, data };
}

async function runTests() {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);

  const marker = `cust${crypto.randomBytes(4).toString('hex')}`;
  const created = { categoryId: null, productId: null, userId: null, storeReviewIds: [], contactIds: [] };

  try {
    const [category] = await db.insert(categories).values({ name: `Cat ${marker}`, slug: marker }).returning();
    created.categoryId = category.id;
    const [product] = await db
      .insert(products)
      .values({ title: `Produit ${marker}`, slug: marker, description: 'Fixture', price: '10.000', categoryId: category.id, isActive: true })
      .returning();
    created.productId = product.id;

    const reviewCountBefore = (await pool.query('SELECT count(*)::int AS n FROM store_reviews')).rows[0].n;
    const productReviewCountBefore = (await pool.query('SELECT count(*)::int AS n FROM reviews WHERE product_id = $1', [product.id])).rows[0].n;

    console.log('\n--- Guests cannot review ---');
    const guestId = crypto.randomUUID();
    let res = await call('POST', '/reviews', { guest: guestId, body: { authorName: 'Invité', email: 'guest@example.test', rating: 5, body: 'Avis invité' } });
    assert(res.status === 401 && res.data?.error === 'Veuillez vous connecter pour continuer.', 'guest store review -> 401 with a French message');
    res = await call('POST', `/products/${product.id}/reviews`, { guest: guestId, body: { authorName: 'Invité', rating: 5, comment: 'Avis invité' } });
    assert(res.status === 401, 'guest product review -> 401');
    res = await call('POST', '/products/not-a-uuid/reviews', { guest: guestId, body: { rating: 5, comment: 'x' } });
    assert(res.status === 404, 'a malformed product id is still a 404 before the login check');
    res = await call('POST', '/reviews', { token: 'not-a-valid-token', body: { rating: 5, body: 'x' } });
    assert(res.status === 401 && res.data?.error === 'Session expirée. Veuillez vous reconnecter.', 'an invalid token is refused with a French "session expired" message');
    const reviewCountAfterGuests = (await pool.query('SELECT count(*)::int AS n FROM store_reviews')).rows[0].n;
    const productReviewCountAfterGuests = (await pool.query('SELECT count(*)::int AS n FROM reviews WHERE product_id = $1', [product.id])).rows[0].n;
    assert(reviewCountAfterGuests === reviewCountBefore && productReviewCountAfterGuests === productReviewCountBefore, 'refused guest attempts created no row');

    console.log('\n--- Admins still cannot review ---');
    const adminToken = jwt.sign({ sub: await createAccount(pool, 'admin', 'customers-only'), email: 'admin@customers-only.test', role: 'admin' }, env.jwtSecret, { expiresIn: 600 });
    res = await call('POST', '/reviews', { token: adminToken, body: { rating: 5, body: 'x' } });
    assert(res.status === 403, 'admin store review -> 403');
    res = await call('POST', `/products/${product.id}/reviews`, { token: adminToken, body: { rating: 5, comment: 'x' } });
    assert(res.status === 403, 'admin product review -> 403');

    console.log('\n--- A logged-in customer can review, as themselves ---');
    const email = `${marker}@customers-only.test`;
    const fullName = 'Cliente Test';
    const registered = await call('POST', '/auth/register', { body: { fullName, email, password: 'Password123!' } });
    assert(registered.status === 201 && registered.data?.token, 'customer account created');
    const token = registered.data?.token;
    created.userId = registered.data?.user?.id;

    res = await call('POST', '/reviews', { token, guest: guestId, body: { authorName: 'Nom Tapé', email: 'typed@example.test', rating: 4, body: 'Très bien' } });
    assert(res.status === 201, 'customer store review -> 201');
    if (res.data?.id) created.storeReviewIds.push(res.data.id);
    const [storeRow] = await db.select().from(storeReviews).where(eq(storeReviews.id, res.data?.id || crypto.randomUUID()));
    assert(storeRow && storeRow.userId === created.userId && storeRow.guestSessionId === null, 'store review belongs to the account, no guest session');
    assert(storeRow && storeRow.authorName === fullName && storeRow.email === email, 'store review name and e-mail are the account\'s, not the typed ones');

    res = await call('POST', `/products/${product.id}/reviews`, { token, guest: guestId, body: { authorName: 'Nom Tapé', email: 'typed@example.test', rating: 5, comment: 'Superbe produit' } });
    assert(res.status === 201, 'customer product review -> 201');
    const [productRow] = await db.select().from(reviews).where(eq(reviews.productId, product.id));
    assert(productRow && productRow.userId === created.userId && productRow.guestSessionId === null && productRow.email === null, 'product review belongs to the account, no guest session, no typed e-mail');
    assert(productRow && productRow.authorName === fullName && productRow.status === 'pending', 'product review name is the account\'s and it waits for approval');

        res = await call('POST', `/products/${crypto.randomUUID()}/reviews`, { token, body: { rating: 5, comment: 'Produit inconnu' } });
    assert(res.status === 404 && res.data?.error === 'Produit non trouvé', 'a review for an unknown product -> 404 with a French message (no English text for customers)');

    console.log('\n--- Contact stays open to guests ---');
    const guestContact = await call('POST', '/contact', { guest: guestId, body: { prenom: 'Invite', nom: 'Contact', email: `guest.${marker}@example.test`, message: 'Bonjour, une question.' } });
    assert(guestContact.status === 201 || guestContact.status === 200, `guest contact message accepted (${guestContact.status})`);
    const [guestRow] = await pool.query('SELECT id, user_id, guest_session_id FROM contact_messages WHERE email = $1', [`guest.${marker}@example.test`]).then((r) => r.rows);
    if (guestRow) created.contactIds.push(guestRow.id);
    assert(guestRow && guestRow.user_id === null && guestRow.guest_session_id === guestId, 'guest contact message is attributed to the guest session');

    const customerContact = await call('POST', '/contact', { token, body: { prenom: 'Cliente', nom: 'Test', email, message: 'Bonjour, une question.' } });
    assert(customerContact.status === 201 || customerContact.status === 200, `customer contact message accepted (${customerContact.status})`);
    const [customerRow] = await pool.query('SELECT id, user_id, guest_session_id FROM contact_messages WHERE email = $1', [email]).then((r) => r.rows);
    if (customerRow) created.contactIds.push(customerRow.id);
    assert(customerRow && customerRow.user_id === created.userId && customerRow.guest_session_id === null, 'customer contact message is attributed to the account');
  } finally {
    console.log('\n--- Cleanup ---');
    try {
      if (created.contactIds.length) await db.delete(contactMessages).where(inArray(contactMessages.id, created.contactIds));
      if (created.storeReviewIds.length) await db.delete(storeReviews).where(inArray(storeReviews.id, created.storeReviewIds));
      if (created.userId) await db.delete(users).where(eq(users.id, created.userId));
      if (created.productId) await db.delete(products).where(eq(products.id, created.productId));
      if (created.categoryId) await db.delete(categories).where(eq(categories.id, created.categoryId));
      const left = await Promise.all([
        created.userId ? db.select({ id: users.id }).from(users).where(eq(users.id, created.userId)) : [],
        created.productId ? db.select({ id: reviews.id }).from(reviews).where(eq(reviews.productId, created.productId)) : [],
        created.productId ? db.select({ id: products.id }).from(products).where(eq(products.id, created.productId)) : [],
        created.categoryId ? db.select({ id: categories.id }).from(categories).where(eq(categories.id, created.categoryId)) : [],
        created.storeReviewIds.length ? db.select({ id: storeReviews.id }).from(storeReviews).where(inArray(storeReviews.id, created.storeReviewIds)) : [],
        created.contactIds.length ? db.select({ id: contactMessages.id }).from(contactMessages).where(inArray(contactMessages.id, created.contactIds)) : [],
      ]);
      assert(left.every((rows) => rows.length === 0), 'every row this test created (customer, product, category, reviews, contact messages) was removed');
    } catch (err) {
      failed++;
      console.error('✗ FAIL: cleanup error:', err.message);
    }
  }
}

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
BASE = `http://127.0.0.1:${server.address().port}/api`;
try {
  await runTests();
} catch (err) {
  failed++;
  console.error('✗ FAIL: unexpected error:', err);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await removeAccounts(pool).catch(() => {});
  await pool.end().catch(() => {});
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
