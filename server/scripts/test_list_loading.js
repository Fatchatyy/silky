/**
 * The product list and the admin order list are loaded in a few queries (productRepository.findAll,
 * orderRepository.findAll). They must return exactly what loading each item one by one with findById returns, in the
 * same order, and the product list must leave out hidden products unless asked.
 *
 * Safety: refuses to run unless DATABASE_URL is exactly "silky_test" on a loopback host (helpers/silky_test_guard.js).
 * It inserts one hidden product with its own category and removes both in a finally block.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_list_loading.js
 */
import crypto from 'node:crypto';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();
process.env.GOODEX_ENABLE_LIVE = 'false';

const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq } = await import('drizzle-orm');
const { categories, products } = await import('../models/index.js');
const { productRepository } = await import('../repositories/product.repository.js');
const { orderRepository } = await import('../repositories/order.repository.js');
const productService = await import('../services/product.service.js');

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

let categoryId = null;
let hiddenId = null;

try {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);
  const marker = `list${crypto.randomBytes(4).toString('hex')}`;
  const [category] = await db.insert(categories).values({ name: `Cat ${marker}`, slug: marker }).returning();
  categoryId = category.id;
  const [hidden] = await db
    .insert(products)
    .values({ title: `Cache ${marker}`, slug: `${marker}-h`, description: 'd', price: '10.000', categoryId, isActive: false })
    .returning();
  hiddenId = hidden.id;

  console.log('\n--- Products ---');
  const all = await productRepository.findAll({ includeHidden: true });
  const oneByOne = [];
  for (const product of all) oneByOne.push(await productRepository.findById(product.id));
  assert(all.length > 0 && all.length === oneByOne.length, `the list has ${all.length} products`);
  assert(JSON.stringify(all) === JSON.stringify(oneByOne), 'the list is identical to loading each product with findById (fields, variants, images, videos, order of tied rows)');
  assert(all.some((p) => p.id === hiddenId && p.isHidden === true), 'includeHidden: true returns the hidden product');

  const published = await productRepository.findAll({ includeHidden: false });
  assert(!published.some((p) => p.id === hiddenId) && published.every((p) => p.isHidden === false), 'includeHidden: false leaves hidden products out');
  const byDefault = await productRepository.findAll();
  assert(!byDefault.some((p) => p.id === hiddenId), 'the repository default no longer includes hidden products');
  const serviceDefault = await productService.getAllProducts();
  assert(!serviceDefault.some((p) => p.id === hiddenId), 'the service default no longer includes hidden products');

  console.log('\n--- Orders ---');
  const orderList = await orderRepository.findAll();
  const sample = orderList.length > 60 ? [...orderList.slice(0, 30), ...orderList.slice(-30)] : orderList;
  let same = true;
  for (const order of sample) {
    const single = await orderRepository.findById(order.id);
    if (JSON.stringify(single) !== JSON.stringify(order)) {
      same = false;
      console.error(`  differs: ${order.id}`);
      break;
    }
  }
  assert(orderList.length > 0, `the order list has ${orderList.length} orders`);
  assert(same, `the first and last ${sample.length} orders of the list are identical to findById (items, exchanges, refunds, governorate)`);
  const stamps = orderList.map((o) => new Date(o.createdAt).getTime());
  assert(stamps.every((t, i) => i === 0 || stamps[i - 1] >= t), 'the order list is newest first');
  assert(orderList.some((o) => o.exchanges.length > 0) && orderList.some((o) => o.refunds.length > 0), 'the test data covers orders with exchanges and refunds');
} finally {
  console.log('\n--- Cleanup ---');
  try {
    if (hiddenId) await db.delete(products).where(eq(products.id, hiddenId));
    if (categoryId) await db.delete(categories).where(eq(categories.id, categoryId));
    const left = await pool.query('select count(*)::int as n from products where id = $1', [hiddenId]);
    assert(!hiddenId || left.rows[0].n === 0, 'the hidden test product is removed');
  } catch (err) {
    console.error('cleanup failed:', err.message);
    failed++;
  }
  await pool.end().catch(() => {});
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
