/**
 * Automated test suite verifying safe DELETE /api/products/:id behavior.
 * Usage: node server/scripts/test_product_deletion_safety.js
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { app } from '../app.js';
import { db } from '../db/orm.js';
import { eq } from 'drizzle-orm';
import {
  products,
  productVariants,
  productImages,
  categories,
  carts,
  cartItems,
  favourites,
  reviews,
  orders,
  orderItems,
  orderExchanges,
  exchangeItems,
  orderRefunds,
  refundItems,
  users,
} from '../models/index.js';
import { UPLOADS_DIR } from '../utils/upload.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

let passed = 0;
let failed = 0;
let server;
let BASE = '';
let adminToken = '';

function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

async function request(endpoint, { method = 'GET', body, token, guestSession } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (guestSession) headers['X-Guest-Session-ID'] = guestSession;

  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: res.status, data, headers: res.headers };
}

async function runTests() {
  console.log('=== Starting Safe Product Deletion Tests ===\n');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  BASE = `http://127.0.0.1:${port}/api`;
  console.log(`Test server running on ${BASE}`);

  // Create admin token
  const [adminUser] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (adminUser) {
    adminToken = jwt.sign(
      { sub: adminUser.id, role: adminUser.role, email: adminUser.email },
      env.jwtSecret,
      { expiresIn: '1h' }
    );
  } else {
    const [newAdmin] = await db.insert(users).values({
      email: `admin_${Date.now()}@silky.test`,
      passwordHash: 'dummy',
      fullName: 'Test Admin',
      role: 'admin',
    }).returning();
    adminToken = jwt.sign(
      { sub: newAdmin.id, role: newAdmin.role, email: newAdmin.email },
      env.jwtSecret,
      { expiresIn: '1h' }
    );
  }

  // Ensure category
  let [testCategory] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!testCategory) {
    [testCategory] = await db.insert(categories).values({
      name: 'Femme',
      slug: 'femme',
    }).returning();
  }

  // Ensure uploads directory exists
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // =========================================================================
  // TEST 1: Nonexistent product deletion
  // =========================================================================
  console.log('--- Test 1: Nonexistent product deletion ---');
  const fakeId = '00000000-0000-4000-8000-000000000000';
  const resNonExistent = await request(`/products/${fakeId}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert(resNonExistent.status === 404, `Deleting nonexistent product returns 404 (Got: ${resNonExistent.status})`);

  // =========================================================================
  // TEST 2: Cascade and Preservation verification on Product Deletion
  // =========================================================================
  console.log('\n--- Test 2: Cascade & Historical Preservation on Product Deletion ---');
  const createRes = await request('/products', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Robe Test Deletion Safety',
      slug: `test-del-${Date.now()}`,
      description: 'Product to be safely deleted',
      price: 150.000,
      category: testCategory.slug,
      categoryId: testCategory.id,
      collectionImage: '/pictures/noir.jpg',
      colors: [
        { id: 'noir', name: 'Noir', image: '/pictures/noir.jpg', images: ['/pictures/noir.jpg'] },
      ],
      sizes: ['S', 'M'],
      stock: { 'noir-S': 10, 'noir-M': 10 },
    },
  });

  assert(createRes.status === 201, `Product created with status 201`);
  const productId = createRes.data?.id;

  const initialVars = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  assert(initialVars.length === 2, `2 variants created`);
  const varS = initialVars.find((v) => v.size === 'S');
  const varM = initialVars.find((v) => v.size === 'M');

  // Add cart item
  const [testCart] = await db.insert(carts).values({
    guestSessionId: '22222222-2222-4222-8222-222222222222',
  }).returning();

  const [testCartItem] = await db.insert(cartItems).values({
    cartId: testCart.id,
    variantId: varS.id,
    quantity: 1,
  }).returning();

  // Add favourite
  const [testFav] = await db.insert(favourites).values({
    guestSessionId: '22222222-2222-4222-8222-222222222222',
    productId: productId,
  }).returning();

  // Add review
  const [testReview] = await db.insert(reviews).values({
    productId: productId,
    authorName: 'Acheteur Test',
    rating: 5,
    comment: 'Superbe robe',
  }).returning();

  // Add order with order_items
  const [testOrder] = await db.insert(orders).values({
    orderNumber: `ORD-DEL-${Date.now()}`,
    customerName: 'Client Historique',
    customerPhone: '99887766',
    shippingAddress: 'Sousse',
    subtotal: '150.000',
    deliveryFee: '8.000',
    totalAmount: '158.000',
    status: 'completed',
  }).returning();

  const [testOrderItem] = await db.insert(orderItems).values({
    orderId: testOrder.id,
    variantId: varS.id,
    productTitle: 'Robe Test Deletion Safety',
    variantLabel: 'Noir / S',
    quantity: 1,
    unitPrice: '150.000',
  }).returning();

  // Add exchange with exchange_items
  const [testExchange] = await db.insert(orderExchanges).values({
    orderId: testOrder.id,
    exchangeNumber: `EXCH-DEL-${Date.now()}`,
    customerName: 'Client Historique',
    customerPhone: '99887766',
    shippingAddress: 'Sousse',
    subtotal: '150.000',
    deliveryFee: '0.000',
    totalAmount: '150.000',
  }).returning();

  const [testExchangeItem] = await db.insert(exchangeItems).values({
    exchangeId: testExchange.id,
    variantId: varM.id,
    productTitle: 'Robe Test Deletion Safety',
    variantLabel: 'Noir / M',
    quantity: 1,
    unitPrice: '150.000',
  }).returning();

  // Add refund with refund_items
  const [testRefund] = await db.insert(orderRefunds).values({
    orderId: testOrder.id,
    refundNumber: `REF-DEL-${Date.now()}`,
    customerName: 'Client Historique',
    customerPhone: '99887766',
    shippingAddress: 'Sousse',
    refundAmount: '150.000',
  }).returning();

  const [testRefundItem] = await db.insert(refundItems).values({
    refundId: testRefund.id,
    variantId: varS.id,
    productTitle: 'Robe Test Deletion Safety',
    variantLabel: 'Noir / S',
    quantity: 1,
    unitPrice: '150.000',
  }).returning();

  // Now delete product
  const deleteRes = await request(`/products/${productId}`, {
    method: 'DELETE',
    token: adminToken,
  });

  assert(deleteRes.status === 200, `DELETE /products/:id returned 200 (Got: ${deleteRes.status})`);

  // Verify product is deleted from DB
  const [deletedProduct] = await db.select().from(products).where(eq(products.id, productId));
  assert(!deletedProduct, `Product record is deleted from products table`);

  // Verify variants are deleted
  const remainingVariants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  assert(remainingVariants.length === 0, `All product_variants records were cascade deleted`);

  // Verify cart item was cascade deleted
  const [remainingCartItem] = await db.select().from(cartItems).where(eq(cartItems.id, testCartItem.id));
  assert(!remainingCartItem, `Cart item was cascade deleted with variant`);

  // Verify favourite was cascade deleted
  const [remainingFav] = await db.select().from(favourites).where(eq(favourites.id, testFav.id));
  assert(!remainingFav, `Favourite record was cascade deleted`);

  // Verify review was cascade deleted
  const [remainingReview] = await db.select().from(reviews).where(eq(reviews.id, testReview.id));
  assert(!remainingReview, `Review record was cascade deleted`);

  // Verify orders row is NEVER deleted
  const [retainedOrder] = await db.select().from(orders).where(eq(orders.id, testOrder.id));
  assert(Boolean(retainedOrder), `Historical order record is strictly retained`);
  assert(retainedOrder?.totalAmount === '158.000', `Historical order total amount snapshot is intact`);

  // Verify order_items row is NEVER deleted
  const [retainedOrderItem] = await db.select().from(orderItems).where(eq(orderItems.id, testOrderItem.id));
  assert(Boolean(retainedOrderItem), `Historical order_items record is strictly retained`);
  assert(retainedOrderItem?.productTitle === 'Robe Test Deletion Safety', `order_items snapshot title is intact`);
  assert(retainedOrderItem?.variantId === null, `order_items.variantId is safely set to null via SET NULL`);

  // Verify exchange and exchange_items are NEVER deleted
  const [retainedExchange] = await db.select().from(orderExchanges).where(eq(orderExchanges.id, testExchange.id));
  assert(Boolean(retainedExchange), `Historical exchange record is strictly retained`);

  const [retainedExchangeItem] = await db.select().from(exchangeItems).where(eq(exchangeItems.id, testExchangeItem.id));
  assert(Boolean(retainedExchangeItem), `Historical exchange_items record is strictly retained`);
  assert(retainedExchangeItem?.variantId === null, `exchange_items.variantId is safely set to null via SET NULL`);

  // Verify refund and refund_items are NEVER deleted
  const [retainedRefund] = await db.select().from(orderRefunds).where(eq(orderRefunds.id, testRefund.id));
  assert(Boolean(retainedRefund), `Historical refund record is strictly retained`);

  const [retainedRefundItem] = await db.select().from(refundItems).where(eq(refundItems.id, testRefundItem.id));
  assert(Boolean(retainedRefundItem), `Historical refund_items record is strictly retained`);
  assert(retainedRefundItem?.variantId === null, `refund_items.variantId is safely set to null via SET NULL`);

  // =========================================================================
  // TEST 3: Filesystem cleanup - Orphaned physical upload deleted
  // =========================================================================
  console.log('\n--- Test 3: Filesystem cleanup - Orphan physical image deleted ---');
  const orphanFilename = `test_orphan_${Date.now()}.jpg`;
  const orphanPath = path.join(UPLOADS_DIR, orphanFilename);
  fs.writeFileSync(orphanPath, 'dummy-image-content');
  assert(fs.existsSync(orphanPath), `Dummy physical file created at ${orphanFilename}`);

  // Create product using this upload
  const prodOrphanRes = await request('/products', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Produit Image Orpheline',
      slug: `orphan-prod-${Date.now()}`,
      description: 'Description orphan',
      category: testCategory.slug,
      categoryId: testCategory.id,
      price: 100,
      collectionImage: `/uploads/${orphanFilename}`,
      colors: [
        { id: 'noir', name: 'Noir', image: `/uploads/${orphanFilename}`, images: [`/uploads/${orphanFilename}`] },
      ],
      sizes: ['S'],
      stock: { 'noir-S': 5 },
    },
  });

  const orphanProdId = prodOrphanRes.data?.id;
  assert(Boolean(orphanProdId), `Product with orphaned image created`);

  // Delete product
  await request(`/products/${orphanProdId}`, {
    method: 'DELETE',
    token: adminToken,
  });

  // Verify physical file is unlinked
  assert(!fs.existsSync(orphanPath), `Orphaned physical upload ${orphanFilename} was safely unlinked from disk`);

  // =========================================================================
  // TEST 4: Filesystem cleanup - Shared physical upload NOT deleted
  // =========================================================================
  console.log('\n--- Test 4: Filesystem cleanup - Shared physical image NOT deleted ---');
  const sharedFilename = `test_shared_${Date.now()}.jpg`;
  const sharedPath = path.join(UPLOADS_DIR, sharedFilename);
  fs.writeFileSync(sharedPath, 'shared-image-content');

  // Create Product A with shared image
  const prodARes = await request('/products', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Produit Partage A',
      slug: `shared-a-${Date.now()}`,
      description: 'Description shared A',
      category: testCategory.slug,
      categoryId: testCategory.id,
      price: 100,
      collectionImage: `/uploads/${sharedFilename}`,
      colors: [{ id: 'noir', name: 'Noir', image: `/uploads/${sharedFilename}` }],
      sizes: ['S'],
      stock: { 'noir-S': 5 },
    },
  });
  const prodAId = prodARes.data?.id;

  // Create Product B with same shared image
  const prodBRes = await request('/products', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Produit Partage B',
      slug: `shared-b-${Date.now()}`,
      description: 'Description shared B',
      category: testCategory.slug,
      categoryId: testCategory.id,
      price: 100,
      collectionImage: `/uploads/${sharedFilename}`,
      colors: [{ id: 'noir', name: 'Noir', image: `/uploads/${sharedFilename}` }],
      sizes: ['S'],
      stock: { 'noir-S': 5 },
    },
  });
  const prodBId = prodBRes.data?.id;

  // Delete Product A
  await request(`/products/${prodAId}`, {
    method: 'DELETE',
    token: adminToken,
  });

  // Physical file must STILL exist because Product B uses it
  assert(fs.existsSync(sharedPath), `Shared physical upload ${sharedFilename} STILL exists after deleting Product A`);

  // Delete Product B
  await request(`/products/${prodBId}`, {
    method: 'DELETE',
    token: adminToken,
  });

  // Now physical file must be unlinked
  assert(!fs.existsSync(sharedPath), `Shared physical upload ${sharedFilename} is deleted once all references are gone`);

  // Cleanup test orders & carts
  try {
    await db.delete(cartItems).where(eq(cartItems.id, testCartItem.id));
    await db.delete(carts).where(eq(carts.id, testCart.id));
    await db.delete(refundItems).where(eq(refundItems.id, testRefundItem.id));
    await db.delete(orderRefunds).where(eq(orderRefunds.id, testRefund.id));
    await db.delete(exchangeItems).where(eq(exchangeItems.id, testExchangeItem.id));
    await db.delete(orderExchanges).where(eq(orderExchanges.id, testExchange.id));
    await db.delete(orderItems).where(eq(orderItems.id, testOrderItem.id));
    await db.delete(orders).where(eq(orders.id, testOrder.id));
  } catch (err) {
    console.warn('Cleanup warning:', err.message);
  }

  // Summary
  console.log(`\n=== Verification Results: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  if (server) server.close();
  process.exit(1);
});
