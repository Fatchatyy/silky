import '../config/env.js';
import './helpers/parcel_guard_off.js';
import { pool } from '../db/pool.js';
import { runExchangesMigration } from '../db/migrations/add_exchanges.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as inventoryService from '../services/inventory.service.js';
import * as analyticsService from '../services/analytics.service.js';
import * as adminService from '../services/admin.service.js';

async function runTests() {
  console.log('--- Starting Exchange Feature Verification Tests ---');

  // 0. Ensure schema migration is applied
  await runExchangesMigration(pool);

  // Fetch 3 distinct active variants for testing
  const { rows: variants } = await pool.query(`
    SELECT pv.id, pv.stock_quantity, p.title
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE p.is_active = TRUE
    ORDER BY pv.id
    LIMIT 3
  `);

  if (variants.length < 3) {
    console.error('Test requires at least 3 active variants in DB.');
    process.exit(1);
  }

  const varA = variants[0];
  const varB = variants[1];
  const varC = variants[2];

  console.log(`Variant A (${varA.title}): ID ${varA.id}, Initial stock: ${varA.stock_quantity}`);
  console.log(`Variant B (${varB.title}): ID ${varB.id}, Initial stock: ${varB.stock_quantity}`);
  console.log(`Variant C (${varC.title}): ID ${varC.id}, Initial stock: ${varC.stock_quantity}`);

  // Set predictable stock levels for test
  await inventoryService.updateVariantStock(varA.id, 10);
  await inventoryService.updateVariantStock(varB.id, 10);
  await inventoryService.updateVariantStock(varC.id, 10);

  console.log('Set initial stocks of A, B, C to 10.');

  // Create an initial manual order with A x 2 (uses variantId directly, deducts stock)
  const initialOrder = await adminService.createManualOrder({
    customerName: 'Jean Dupont',
    phoneNumber: '12345678',
    orderSource: 'phone',
    customerEmail: 'jean.dupont@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue 123',
    items: [{ variantId: varA.id, quantity: 2 }],
  });

  // Mark status as 'completed' (the DB value for "Confirmée") so exchanges are allowed
  await orderService.updateOrderStatus(initialOrder.id, 'completed');

  async function getStock(variantId) {
    const inv = await inventoryService.getInventory();
    const item = inv.find((v) => (v.variantId || v.id) === variantId);
    return item ? item.stockQuantity : null;
  }

  const stockAfterOrderA = await getStock(varA.id);
  console.log(`[Order Created] A x 2. Stock of A now: ${stockAfterOrderA} (Expected: 8)`);
  if (stockAfterOrderA !== 8) throw new Error('Initial order stock deduction failed');

  // Capture baseline analytics
  const baselineAnalytics = await analyticsService.getAnalytics();

  // Test 1: Exchange #1: A x 2 -> B x 3
  console.log('\n--- Test 1: A x 2 -> B x 3 ---');
  const ex1 = await exchangeService.createExchange({
    orderId: initialOrder.id,
    customer: { customerName: 'Jean Dupont', phoneNumber: '12345678', shippingAddress: 'Tunis — Rue 123' },
    items: [{ variantId: varB.id, action: 'add', quantity: 3 }],
  });

  const stockEx1A = await getStock(varA.id);
  const stockEx1B = await getStock(varB.id);
  console.log(`Stock A: ${stockEx1A} (Expected: 10)`);
  console.log(`Stock B: ${stockEx1B} (Expected: 7)`);
  if (stockEx1A !== 10 || stockEx1B !== 7) throw new Error('Test 1 failed!');
  if (ex1.status !== 'exchanged') throw new Error('Order status should be exchanged');

  // Test 2: Exchange #2: B x 3 -> C x 1
  console.log('\n--- Test 2: B x 3 -> C x 1 ---');
  const ex2 = await exchangeService.createExchange({
    orderId: initialOrder.id,
    customer: { customerName: 'Jean Dupont', phoneNumber: '12345678', shippingAddress: 'Tunis — Rue 123' },
    items: [{ variantId: varC.id, action: 'add', quantity: 1 }],
  });

  const stockEx2A = await getStock(varA.id);
  const stockEx2B = await getStock(varB.id);
  const stockEx2C = await getStock(varC.id);
  console.log(`Stock A: ${stockEx2A} (Expected: 10)`);
  console.log(`Stock B: ${stockEx2B} (Expected: 10)`);
  console.log(`Stock C: ${stockEx2C} (Expected: 9)`);
  if (stockEx2A !== 10 || stockEx2B !== 10 || stockEx2C !== 9) throw new Error('Test 2 failed!');

  // Test 3: Same-variant exchange: C x 1 -> C x 1
  console.log('\n--- Test 3: Same-variant C x 1 -> C x 1 ---');
  await exchangeService.createExchange({
    orderId: initialOrder.id,
    customer: { customerName: 'Jean Dupont', phoneNumber: '12345678', shippingAddress: 'Tunis — Rue 123' },
    items: [{ variantId: varC.id, action: 'replace', quantity: 1 }],
  });
  const stockEx3C = await getStock(varC.id);
  console.log(`Stock C: ${stockEx3C} (Expected: 9 - unchanged)`);
  if (stockEx3C !== 9) throw new Error('Test 3 failed!');

  // Test 4: C x 1 -> B x 3 (Stock B decreases from 10 to 7)
  console.log('\n--- Test 4: C x 1 -> B x 3 ---');
  await exchangeService.createExchange({
    orderId: initialOrder.id,
    customer: { customerName: 'Jean Dupont', phoneNumber: '12345678', shippingAddress: 'Tunis — Rue 123' },
    items: [{ variantId: varB.id, action: 'add', quantity: 3 }],
  });
  const stockEx4B = await getStock(varB.id);
  console.log(`Stock B: ${stockEx4B} (Expected: 7)`);
  if (stockEx4B !== 7) throw new Error('Test 4 failed!');

  // Test 5: B x 3 -> B x 1 via Return 2 (Stock B increases by 2: 7 -> 9)
  console.log('\n--- Test 5: B x 3 -> B x 1 (Return 2) ---');
  await exchangeService.createExchange({
    orderId: initialOrder.id,
    customer: { customerName: 'Jean Dupont', phoneNumber: '12345678', shippingAddress: 'Tunis — Rue 123' },
    items: [{ variantId: varB.id, action: 'return', quantity: 2 }],
  });
  const stockEx5B = await getStock(varB.id);
  console.log(`Stock B: ${stockEx5B} (Expected: 9)`);
  if (stockEx5B !== 9) throw new Error('Test 5 failed!');

  // Test 7: Insufficient stock check
  console.log('\n--- Test 7: Insufficient Stock ---');
  let errorCaught = false;
  try {
    await exchangeService.createExchange({
      orderId: initialOrder.id,
      customer: { customerName: 'Jean Dupont', phoneNumber: '12345678', shippingAddress: 'Tunis — Rue 123' },
      items: [{ variantId: varA.id, action: 'add', quantity: 9999 }],
    });
  } catch (err) {
    errorCaught = true;
    console.log(`Successfully caught expected error: ${err.message}`);
  }
  if (!errorCaught) throw new Error('Test 7 failed: Should have thrown insufficient stock error');

  // Check Order Exchanges History in getOrderById
  console.log('\n--- Test Order Details & Chronological Exchanges ---');
  const fetchedOrder = await orderService.getOrderById(initialOrder.id);
  console.log(`Original order number: ${fetchedOrder.orderNumber}`);
  console.log(`Status: ${fetchedOrder.status}`);
  console.log(`Number of exchanges recorded: ${fetchedOrder.exchanges.length}`);
  fetchedOrder.exchanges.forEach((ex) => {
    console.log(`  - Exchange #${ex.exchangeSequence}: ${ex.exchangeNumber} (${ex.items.length} items, Total: ${ex.total} TND)`);
  });

  if (fetchedOrder.exchanges.length !== 5) throw new Error('Expected 5 recorded exchanges');

  // Check analytics integrity
  console.log('\n--- Test Analytics Integrity ---');
  const postAnalytics = await analyticsService.getAnalytics();
  console.log(`Baseline Orders: ${baselineAnalytics.kpi.totalOrders}, Post-Exchange Orders: ${postAnalytics.kpi.totalOrders}`);
  console.log(`Baseline Revenue: ${baselineAnalytics.kpi.totalRevenue}, Post-Exchange Revenue: ${postAnalytics.kpi.totalRevenue}`);
  if (baselineAnalytics.kpi.totalOrders !== postAnalytics.kpi.totalOrders) {
    throw new Error('Order count changed unexpectedly!');
  }
  const latestExchange = fetchedOrder.exchanges[0];
  const totalExchangeDeliveryFees = fetchedOrder.exchanges.reduce((sum, ex) => sum + Number(ex.deliveryFee || 0), 0);
  const activeProductSubtotal = Number(latestExchange.subtotal || 0);
  const expectedOrderRevenue = activeProductSubtotal + Number(initialOrder.deliveryFee || 0) + totalExchangeDeliveryFees;
  const expectedPostRevenue = baselineAnalytics.kpi.totalRevenue + (expectedOrderRevenue - initialOrder.total);
  if (Math.abs(postAnalytics.kpi.totalRevenue - expectedPostRevenue) > 0.01) {
    throw new Error(`Analytics revenue incorrect! Expected ${expectedPostRevenue}, got ${postAnalytics.kpi.totalRevenue}`);
  }



  console.log('\n✅ ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');

  // Cleanup test order after background emails settle
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS pending FROM order_email_deliveries WHERE order_id = $1::uuid AND status = 'pending'`,
      [initialOrder.id]
    );
    if (Number(rows[0]?.pending || 0) === 0) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  await pool.query('DELETE FROM orders WHERE id = $1::text::uuid', [initialOrder.id]);
}

runTests()
  .catch((err) => {
    console.error('❌ Test execution failed:', err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });


