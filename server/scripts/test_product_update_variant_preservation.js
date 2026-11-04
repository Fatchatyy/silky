/**
 * Comprehensive test suite for product update variant preservation and data integrity.
 * Usage: node server/scripts/test_product_update_variant_preservation.js
 */
import http from 'http';
import { app } from '../app.js';
import { db } from '../db/orm.js';
import { eq, inArray } from 'drizzle-orm';
import {
  products,
  productVariants,
  productImages,
  categories,
  carts,
  cartItems,
  orders,
  orderItems,
  orderExchanges,
  exchangeItems,
  orderRefunds,
  refundItems,
  users,
} from '../models/index.js';
import * as inventoryService from '../services/inventory.service.js';
import { productRepository } from '../repositories/product.repository.js';
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
  console.log('=== Starting Product Update Variant Preservation Tests ===\n');

  // Start temporary test server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  BASE = `http://127.0.0.1:${port}/api`;
  console.log(`Test server running on ${BASE}`);

  // Create an admin token for authorized admin endpoints
  const [adminUser] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (adminUser) {
    adminToken = jwt.sign(
      { sub: adminUser.id, role: adminUser.role, email: adminUser.email },
      env.jwtSecret,
      { expiresIn: '1h' }
    );
  } else {
    // If no admin user in DB, create one
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

  // Ensure category exists
  let [testCategory] = await db.select().from(categories).where(eq(categories.slug, 'femme')).limit(1);
  if (!testCategory) {
    [testCategory] = await db.insert(categories).values({
      name: 'Femme',
      slug: 'femme',
    }).returning();
  }

  // 1. Create a fresh test product
  const testProductSlug = `test-dress-${Date.now()}`;
  const createRes = await request('/products', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Robe Test Preservation',
      slug: testProductSlug,
      description: 'Description initiale',
      price: 120.500,
      discount: 10,
      category: testCategory.slug,
      categoryId: testCategory.id,
      collectionImage: '/pictures/test_col.jpg',
      isFeatured: true,
      isHidden: false,
      colors: [
        { id: 'noir', name: 'Noir', image: '/pictures/noir.jpg', images: ['/pictures/noir.jpg', '/pictures/noir_2.jpg'] },
        { id: 'rouge', name: 'Rouge', image: '/pictures/rouge.jpg', images: ['/pictures/rouge.jpg'] },
      ],
      sizes: ['S', 'M'],
      stock: {
        'noir-S': 10,
        'noir-M': 5,
        'rouge-S': 8,
        'rouge-M': 12,
      },
    },
  });

  assert(createRes.status === 201, `Product creation status is 201 (Got: ${createRes.status})`);
  const productId = createRes.data?.id;
  assert(Boolean(productId), `Created test product ID: ${productId}`);

  // Fetch initial variants directly from DB
  const initialVariants = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  assert(initialVariants.length === 4, `Created exactly 4 initial variants (Got: ${initialVariants.length})`);

  const initialVariantMap = new Map();
  for (const v of initialVariants) {
    initialVariantMap.set(`${v.colorSlug}::${v.size}`, v);
  }

  const varNoirS = initialVariantMap.get('noir::S');
  const varNoirM = initialVariantMap.get('noir::M');
  const varRougeS = initialVariantMap.get('rouge::S');
  const varRougeM = initialVariantMap.get('rouge::M');

  assert(Boolean(varNoirS?.id), `Initial variant noir-S exists (ID: ${varNoirS?.id})`);
  assert(Boolean(varNoirM?.id), `Initial variant noir-M exists (ID: ${varNoirM?.id})`);
  assert(Boolean(varRougeS?.id), `Initial variant rouge-S exists (ID: ${varRougeS?.id})`);
  assert(Boolean(varRougeM?.id), `Initial variant rouge-M exists (ID: ${varRougeM?.id})`);

  // 2. Set up an active Cart Item pointing to varNoirS
  const [testCart] = await db.insert(carts).values({
    guestSessionId: '11111111-1111-4111-8111-111111111111',
  }).returning();

  const [testCartItem] = await db.insert(cartItems).values({
    cartId: testCart.id,
    variantId: varNoirS.id,
    quantity: 2,
  }).returning();

  assert(Boolean(testCartItem?.id), `Test cart item created pointing to variant noir-S (${varNoirS.id})`);

  // 3. Set up historical Order Item, Exchange Item, and Refund Item
  const [testOrder] = await db.insert(orders).values({
    orderNumber: `ORD-TEST-${Date.now()}`,
    customerName: 'Jean Dupont',
    customerPhone: '12345678',
    shippingAddress: 'Tunis',
    subtotal: '110.500',
    deliveryFee: '8.000',
    totalAmount: '118.500',
    status: 'completed',
  }).returning();

  const [testOrderItem] = await db.insert(orderItems).values({
    orderId: testOrder.id,
    variantId: varNoirS.id,
    productTitle: 'Robe Test Preservation',
    variantLabel: 'Noir / S',
    quantity: 1,
    unitPrice: '110.500',
  }).returning();

  const [testExchange] = await db.insert(orderExchanges).values({
    orderId: testOrder.id,
    exchangeNumber: `EX-TEST-${Date.now()}`,
    customerName: 'Jean Dupont',
    customerPhone: '12345678',
    shippingAddress: 'Tunis',
    subtotal: '110.500',
    deliveryFee: '0.000',
    totalAmount: '110.500',
  }).returning();

  const [testExchangeItem] = await db.insert(exchangeItems).values({
    exchangeId: testExchange.id,
    variantId: varNoirM.id,
    productTitle: 'Robe Test Preservation',
    variantLabel: 'Noir / M',
    quantity: 1,
    unitPrice: '110.500',
  }).returning();

  const [testRefund] = await db.insert(orderRefunds).values({
    orderId: testOrder.id,
    refundNumber: `REF-TEST-${Date.now()}`,
    customerName: 'Jean Dupont',
    customerPhone: '12345678',
    shippingAddress: 'Tunis',
    refundAmount: '110.500',
  }).returning();

  const [testRefundItem] = await db.insert(refundItems).values({
    refundId: testRefund.id,
    variantId: varRougeS.id,
    productTitle: 'Robe Test Preservation',
    variantLabel: 'Rouge / S',
    quantity: 1,
    unitPrice: '110.500',
  }).returning();

  assert(Boolean(testOrderItem?.id), `Order item created referencing noir-S`);
  assert(Boolean(testExchangeItem?.id), `Exchange item created referencing noir-M`);
  assert(Boolean(testRefundItem?.id), `Refund item created referencing rouge-S`);

  // =========================================================================
  // TEST 1: Product-only edit (Title only)
  // =========================================================================
  console.log('\n--- Test 1: Product-only edit (Title) ---');
  const resTitle = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      name: 'Robe Test Titre Modifie',
    },
  });

  assert(resTitle.status === 200, `PUT status is 200 (Got: ${resTitle.status})`);
  assert(resTitle.data?.name === 'Robe Test Titre Modifie', `Product title updated to 'Robe Test Titre Modifie'`);

  // Check variants in DB
  const varsAfterTitle = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  assert(varsAfterTitle.length === 4, `Variant count is still 4`);
  for (const v of varsAfterTitle) {
    const orig = initialVariantMap.get(`${v.colorSlug}::${v.size}`);
    assert(v.id === orig.id, `Variant ${v.colorSlug}-${v.size} UUID preserved (${v.id})`);
  }

  // Check cart item
  const [cartItemAfterTitle] = await db.select().from(cartItems).where(eq(cartItems.id, testCartItem.id));
  assert(Boolean(cartItemAfterTitle), `Cart item still exists after title edit`);
  assert(cartItemAfterTitle?.variantId === varNoirS.id, `Cart item variantId preserved (${cartItemAfterTitle?.variantId})`);

  // Check order, exchange, refund items
  const [orderItemAfterTitle] = await db.select().from(orderItems).where(eq(orderItems.id, testOrderItem.id));
  assert(orderItemAfterTitle?.variantId === varNoirS.id, `Order item variantId preserved (${orderItemAfterTitle?.variantId})`);

  const [exchangeItemAfterTitle] = await db.select().from(exchangeItems).where(eq(exchangeItems.id, testExchangeItem.id));
  assert(exchangeItemAfterTitle?.variantId === varNoirM.id, `Exchange item variantId preserved (${exchangeItemAfterTitle?.variantId})`);

  const [refundItemAfterTitle] = await db.select().from(refundItems).where(eq(refundItems.id, testRefundItem.id));
  assert(refundItemAfterTitle?.variantId === varRougeS.id, `Refund item variantId preserved (${refundItemAfterTitle?.variantId})`);

  // =========================================================================
  // TEST 2: Product-only edit (Price & Discount)
  // =========================================================================
  console.log('\n--- Test 2: Product-only edit (Price & Discount) ---');
  const resPrice = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      price: 145.000,
      discount: 15.000,
    },
  });

  assert(resPrice.status === 200, `PUT status is 200 (Got: ${resPrice.status})`);
  assert(resPrice.data?.price === 145, `Product price updated to 145 (Got: ${resPrice.data?.price})`);
  assert(resPrice.data?.discount === 15, `Product discount updated to 15 (Got: ${resPrice.data?.discount})`);

  const varsAfterPrice = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  for (const v of varsAfterPrice) {
    const orig = initialVariantMap.get(`${v.colorSlug}::${v.size}`);
    assert(v.id === orig.id, `Variant ${v.colorSlug}-${v.size} UUID preserved after price edit`);
  }

  // =========================================================================
  // TEST 3: Product-only edit (Description & Collection Image)
  // =========================================================================
  console.log('\n--- Test 3: Product-only edit (Description & Collection Image) ---');
  const resDesc = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      description: 'Nouvelle description mise à jour',
      collectionImage: '/pictures/updated_collection.jpg',
    },
  });

  assert(resDesc.status === 200, `PUT status is 200 (Got: ${resDesc.status})`);
  assert(resDesc.data?.description === 'Nouvelle description mise à jour', `Description updated`);
  assert(resDesc.data?.collectionImage === '/pictures/updated_collection.jpg', `Collection image updated`);

  const varsAfterDesc = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  for (const v of varsAfterDesc) {
    const orig = initialVariantMap.get(`${v.colorSlug}::${v.size}`);
    assert(v.id === orig.id, `Variant ${v.colorSlug}-${v.size} UUID preserved after description edit`);
  }

  // =========================================================================
  // TEST 4: Product-only edit (Visibility / isHidden)
  // =========================================================================
  console.log('\n--- Test 4: Product-only edit (Visibility / isHidden) ---');
  const resHide = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      isHidden: true,
    },
  });

  assert(resHide.status === 200, `PUT isHidden=true status is 200`);
  assert(resHide.data?.isHidden === true, `Product isHidden is true`);
  assert(resHide.data?.is_active === false, `Product is_active is false`);

  const resShow = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      isHidden: false,
    },
  });

  assert(resShow.status === 200, `PUT isHidden=false status is 200`);
  assert(resShow.data?.isHidden === false, `Product isHidden is false`);
  assert(resShow.data?.is_active === true, `Product is_active is true`);

  const varsAfterVis = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  for (const v of varsAfterVis) {
    const orig = initialVariantMap.get(`${v.colorSlug}::${v.size}`);
    assert(v.id === orig.id, `Variant ${v.colorSlug}-${v.size} UUID preserved after visibility toggle`);
  }

  // =========================================================================
  // TEST 5: Full form payload with unchanged variants (AdminProducts.jsx simulation)
  // =========================================================================
  console.log('\n--- Test 5: Full form payload from AdminProducts.jsx ---');
  const resFullAdmin = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      name: 'Robe Test Full Save',
      description: 'Description complete',
      price: 130.000,
      discount: 5.000,
      category: testCategory.slug,
      categoryId: testCategory.id,
      mainImage: '/pictures/noir.jpg',
      thumbnails: ['/pictures/noir.jpg', '/pictures/noir_2.jpg', '/pictures/rouge.jpg'],
      colors: [
        { id: 'noir', name: 'Noir', image: '/pictures/noir.jpg', images: ['/pictures/noir.jpg', '/pictures/noir_2.jpg'] },
        { id: 'rouge', name: 'Rouge', image: '/pictures/rouge.jpg', images: ['/pictures/rouge.jpg'] },
      ],
      sizes: ['S', 'M'],
      stock: {
        'noir-S': 10,
        'noir-M': 5,
        'rouge-S': 8,
        'rouge-M': 12,
      },
      collectionImage: '/pictures/noir.jpg',
      isHidden: false,
    },
  });

  assert(resFullAdmin.status === 200, `Full admin save status is 200`);
  const varsAfterFull = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  assert(varsAfterFull.length === 4, `Variant count after full save is 4`);
  for (const v of varsAfterFull) {
    const orig = initialVariantMap.get(`${v.colorSlug}::${v.size}`);
    assert(v.id === orig.id, `Variant ${v.colorSlug}-${v.size} UUID preserved on full form submission (${v.id})`);
  }

  // =========================================================================
  // TEST 6: In-place stock edit via product update
  // =========================================================================
  console.log('\n--- Test 6: In-place stock update via product update ---');
  const resStockUpdate = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      name: 'Robe Test Full Save',
      colors: [
        { id: 'noir', name: 'Noir', image: '/pictures/noir.jpg', images: ['/pictures/noir.jpg'] },
        { id: 'rouge', name: 'Rouge', image: '/pictures/rouge.jpg', images: ['/pictures/rouge.jpg'] },
      ],
      sizes: ['S', 'M'],
      stock: {
        'noir-S': 35, // updated from 10 to 35
        'noir-M': 5,
        'rouge-S': 8,
        'rouge-M': 12,
      },
    },
  });

  assert(resStockUpdate.status === 200, `Stock update status is 200`);
  const [updatedNoirS] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, varNoirS.id));

  assert(updatedNoirS?.id === varNoirS.id, `noir-S UUID preserved after stock edit`);
  assert(updatedNoirS?.stockQuantity === 35, `noir-S stockQuantity updated to 35 (Got: ${updatedNoirS?.stockQuantity})`);

  // =========================================================================
  // TEST 7: Adding a new variant
  // =========================================================================
  console.log('\n--- Test 7: Adding a new variant ---');
  const resAddVariant = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      name: 'Robe Test Full Save',
      colors: [
        { id: 'noir', name: 'Noir', image: '/pictures/noir.jpg', images: ['/pictures/noir.jpg'] },
        { id: 'rouge', name: 'Rouge', image: '/pictures/rouge.jpg', images: ['/pictures/rouge.jpg'] },
      ],
      sizes: ['S', 'M', 'L'], // Added size L
      stock: {
        'noir-S': 35,
        'noir-M': 5,
        'noir-L': 7, // New variant noir-L
        'rouge-S': 8,
        'rouge-M': 12,
        'rouge-L': 9, // New variant rouge-L
      },
    },
  });

  assert(resAddVariant.status === 200, `Add variant status is 200`);
  const varsAfterAdd = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  assert(varsAfterAdd.length === 6, `Total variants increased to 6 (Got: ${varsAfterAdd.length})`);

  // Existing variants must have original UUIDs
  const varMapAfterAdd = new Map();
  for (const v of varsAfterAdd) {
    varMapAfterAdd.set(`${v.colorSlug}::${v.size}`, v);
  }

  assert(varMapAfterAdd.get('noir::S')?.id === varNoirS.id, `noir-S preserved UUID after adding new sizes`);
  assert(varMapAfterAdd.get('noir::M')?.id === varNoirM.id, `noir-M preserved UUID after adding new sizes`);
  assert(varMapAfterAdd.get('rouge::S')?.id === varRougeS.id, `rouge-S preserved UUID after adding new sizes`);
  assert(varMapAfterAdd.get('rouge::M')?.id === varRougeM.id, `rouge-M preserved UUID after adding new sizes`);

  const newNoirL = varMapAfterAdd.get('noir::L');
  assert(Boolean(newNoirL?.id), `New variant noir-L has valid UUID (${newNoirL?.id})`);
  assert(newNoirL?.stockQuantity === 7, `New variant noir-L has correct stock (7)`);

  const newRougeL = varMapAfterAdd.get('rouge::L');
  assert(Boolean(newRougeL?.id), `New variant rouge-L has valid UUID (${newRougeL?.id})`);
  assert(newRougeL?.stockQuantity === 9, `New variant rouge-L has correct stock (9)`);

  // Cart item still intact
  const [cartItemAfterAdd] = await db.select().from(cartItems).where(eq(cartItems.id, testCartItem.id));
  assert(cartItemAfterAdd?.variantId === varNoirS.id, `Cart item still intact after adding new variants`);

  // =========================================================================
  // TEST 8: Explicitly removing variants
  // =========================================================================
  console.log('\n--- Test 8: Explicitly removing variants ---');
  // Remove color 'rouge' completely and size 'L'
  const resRemoveVariant = await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      name: 'Robe Test Only Noir S and M',
      colors: [
        { id: 'noir', name: 'Noir', image: '/pictures/noir.jpg', images: ['/pictures/noir.jpg'] },
      ],
      sizes: ['S', 'M'],
      stock: {
        'noir-S': 35,
        'noir-M': 5,
      },
    },
  });

  assert(resRemoveVariant.status === 200, `Remove variant status is 200`);
  const varsAfterRemove = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  assert(varsAfterRemove.length === 2, `Variants reduced to 2 (Got: ${varsAfterRemove.length})`);
  const varMapAfterRemove = new Map();
  for (const v of varsAfterRemove) {
    varMapAfterRemove.set(`${v.colorSlug}::${v.size}`, v);
  }

  assert(varMapAfterRemove.get('noir::S')?.id === varNoirS.id, `noir-S retained original UUID (${varNoirS.id})`);
  assert(varMapAfterRemove.get('noir::M')?.id === varNoirM.id, `noir-M retained original UUID (${varNoirM.id})`);

  // Removed variants should be gone from DB
  const [deletedRougeS] = await db.select().from(productVariants).where(eq(productVariants.id, varRougeS.id));
  assert(!deletedRougeS, `rouge-S was correctly removed from product_variants`);

  // Cart item for noir-S still intact
  const [cartItemAfterRemove] = await db.select().from(cartItems).where(eq(cartItems.id, testCartItem.id));
  assert(Boolean(cartItemAfterRemove), `Cart item for noir-S is still present`);
  assert(cartItemAfterRemove?.variantId === varNoirS.id, `Cart item references intact variant noir-S`);

  // Order item for noir-S still references varNoirS
  const [orderItemAfterRemove] = await db.select().from(orderItems).where(eq(orderItems.id, testOrderItem.id));
  assert(orderItemAfterRemove?.variantId === varNoirS.id, `Order item for noir-S still intact (${orderItemAfterRemove?.variantId})`);

  // Exchange item for noir-M still references varNoirM
  const [exchangeItemAfterRemove] = await db.select().from(exchangeItems).where(eq(exchangeItems.id, testExchangeItem.id));
  assert(exchangeItemAfterRemove?.variantId === varNoirM.id, `Exchange item for noir-M still intact (${exchangeItemAfterRemove?.variantId})`);

  // =========================================================================
  // TEST 9: Granular inventory stock endpoint (PATCH /api/admin/inventory/:variantId)
  // =========================================================================
  console.log('\n--- Test 9: Granular inventory stock endpoint ---');
  const resInv = await request(`/admin/inventory/${varNoirS.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: {
      stockQuantity: 99,
    },
  });

  assert(resInv.status === 200, `Inventory PATCH status is 200 (Got: ${resInv.status})`);
  assert(resInv.data?.stockQuantity === 99, `Inventory PATCH returned stockQuantity 99`);

  const [dbVarNoirS] = await db.select().from(productVariants).where(eq(productVariants.id, varNoirS.id));
  assert(dbVarNoirS?.stockQuantity === 99, `DB variant stockQuantity is 99 (Got: ${dbVarNoirS?.stockQuantity})`);

  // =========================================================================
  // TEST 10: Image preservation when image fields are omitted
  // =========================================================================
  console.log('\n--- Test 10: Image preservation when image fields omitted ---');
  // Add an image to the product
  await db.insert(productImages).values({
    productId: productId,
    imageUrl: '/pictures/custom_image.jpg',
    colorSlug: 'noir',
    sortOrder: 1,
    isPrimary: false,
  });

  const imagesBefore = await db.select().from(productImages).where(eq(productImages.productId, productId));
  assert(imagesBefore.length > 0, `Product has images before update`);

  // Update only title (images field omitted)
  await request(`/products/${productId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      name: 'Titre Final Sans Images',
    },
  });

  const imagesAfter = await db.select().from(productImages).where(eq(productImages.productId, productId));
  assert(imagesAfter.length === imagesBefore.length, `Image count preserved when image fields omitted (${imagesAfter.length})`);

  // Cleanup test data
  try {
    await db.delete(cartItems).where(eq(cartItems.id, testCartItem.id));
    await db.delete(carts).where(eq(carts.id, testCart.id));
    await db.delete(refundItems).where(eq(refundItems.id, testRefundItem.id));
    await db.delete(orderRefunds).where(eq(orderRefunds.id, testRefund.id));
    await db.delete(exchangeItems).where(eq(exchangeItems.id, testExchangeItem.id));
    await db.delete(orderExchanges).where(eq(orderExchanges.id, testExchange.id));
    await db.delete(orderItems).where(eq(orderItems.id, testOrderItem.id));
    await db.delete(orders).where(eq(orders.id, testOrder.id));
    await db.delete(productImages).where(eq(productImages.productId, productId));
    await db.delete(productVariants).where(eq(productVariants.productId, productId));
    await db.delete(products).where(eq(products.id, productId));
  } catch (err) {
    console.warn('Cleanup error (non-fatal):', err.message);
  }

  // Summary
  console.log(`\n=== Verification Results: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  if (server) server.close();
  process.exit(1);
});
