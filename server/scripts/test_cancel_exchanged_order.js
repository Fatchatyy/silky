import '../config/env.js';
import './helpers/parcel_guard_off.js';
import { pool } from '../db/pool.js';
import { runExchangesMigration } from '../db/migrations/add_exchanges.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as inventoryService from '../services/inventory.service.js';
import * as adminService from '../services/admin.service.js';

async function runTests() {
  console.log('--- Starting Cancellation Inventory Restoration Tests ---\n');

  await runExchangesMigration(pool);

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

  async function getStock(variantId) {
    const inv = await inventoryService.getInventory();
    const item = inv.find((v) => (v.variantId || v.id) === variantId);
    return item ? item.stockQuantity : null;
  }

  async function resetStocks(stockA = 20, stockB = 20, stockC = 20) {
    await inventoryService.updateVariantStock(varA.id, stockA);
    await inventoryService.updateVariantStock(varB.id, stockB);
    await inventoryService.updateVariantStock(varC.id, stockC);
  }

  // --- Test 1: Normal order cancellation ---
  console.log('--- Test 1: Normal order cancellation (A x 2) ---');
  await resetStocks(20, 20, 20);

  const order1 = await adminService.createManualOrder({
    customerName: 'Test Normal Cancel',
    phoneNumber: '11111111',
    orderSource: 'phone',
    customerEmail: 'test1@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue 123',
    items: [{ variantId: varA.id, quantity: 2 }],
  });

  let sA = await getStock(varA.id);
  console.log(`After order creation (A x 2): Stock A = ${sA} (Expected: 18)`);
  if (sA !== 18) throw new Error('Order creation stock deduction failed');

  const cancelled1 = await orderService.cancelOrder(order1.id);
  sA = await getStock(varA.id);
  console.log(`After cancelOrder: Stock A = ${sA} (Expected: 20), Status = ${cancelled1.status}`);
  if (sA !== 20) throw new Error(`Stock A not restored correctly! Got: ${sA}, Expected: 20`);
  if (cancelled1.status !== 'cancelled') throw new Error(`Order status not cancelled! Got: ${cancelled1.status}`);
  console.log('✓ Test 1 Passed!\n');

  // --- Test 2: Single exchange (A x 2 -> B x 3) followed by cancellation ---
  console.log('--- Test 2: Single exchange (A x 2 -> B x 3) -> cancel ---');
  await resetStocks(20, 20, 20);

  const order2 = await adminService.createManualOrder({
    customerName: 'Test Exch One Cancel',
    phoneNumber: '22222222',
    orderSource: 'phone',
    customerEmail: 'test2@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue 123',
    items: [{ variantId: varA.id, quantity: 2 }],
  });
  await orderService.updateOrderStatus(order2.id, 'completed');

  console.log(`After initial order: Stock A = ${await getStock(varA.id)} (18), Stock B = ${await getStock(varB.id)} (20)`);

  await exchangeService.createExchange({
    orderId: order2.id,
    customer: { customerName: 'Test Exch One Cancel', phoneNumber: '22222222', shippingAddress: 'Tunis' },
    items: [{ variantId: varB.id, action: 'add', quantity: 3 }],
  });

  console.log(`After exchange #1: Stock A = ${await getStock(varA.id)} (20), Stock B = ${await getStock(varB.id)} (17)`);

  const cancelled2 = await orderService.cancelOrder(order2.id);
  sA = await getStock(varA.id);
  let sB = await getStock(varB.id);
  console.log(`After cancelOrder: Stock A = ${sA} (Expected: 20), Stock B = ${sB} (Expected: 20), Status = ${cancelled2.status}`);

  if (sA !== 20) throw new Error(`Stock A incorrectly changed! Got: ${sA}, Expected: 20 (A was already returned during exchange)`);
  if (sB !== 20) throw new Error(`Stock B not restored correctly! Got: ${sB}, Expected: 20 (B should be restored on cancellation)`);
  if (cancelled2.status !== 'cancelled') throw new Error(`Order status not cancelled! Got: ${cancelled2.status}`);
  console.log('✓ Test 2 Passed!\n');

  // --- Test 3: Multiple exchanges (A x 2 -> B x 3 -> C x 1) followed by cancellation ---
  console.log('--- Test 3: Multiple exchanges (A x 2 -> B x 3 -> C x 1) -> cancel ---');
  await resetStocks(20, 20, 20);

  const order3 = await adminService.createManualOrder({
    customerName: 'Test MultiExch Cancel',
    phoneNumber: '33333333',
    orderSource: 'phone',
    customerEmail: 'test3@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue 123',
    items: [{ variantId: varA.id, quantity: 2 }],
  });
  await orderService.updateOrderStatus(order3.id, 'completed');

  // Exchange 1: A x 2 -> B x 3
  await exchangeService.createExchange({
    orderId: order3.id,
    customer: { customerName: 'Test MultiExch Cancel', phoneNumber: '33333333', shippingAddress: 'Tunis' },
    items: [{ variantId: varB.id, action: 'add', quantity: 3 }],
  });

  // Exchange 2: B x 3 -> C x 1
  await exchangeService.createExchange({
    orderId: order3.id,
    customer: { customerName: 'Test MultiExch Cancel', phoneNumber: '33333333', shippingAddress: 'Tunis' },
    items: [{ variantId: varC.id, action: 'add', quantity: 1 }],
  });

  console.log(`After exchange #2: Stock A = ${await getStock(varA.id)} (20), Stock B = ${await getStock(varB.id)} (20), Stock C = ${await getStock(varC.id)} (19)`);

  const cancelled3 = await orderService.cancelOrder(order3.id);
  sA = await getStock(varA.id);
  sB = await getStock(varB.id);
  let sC = await getStock(varC.id);
  console.log(`After cancelOrder: Stock A = ${sA} (Expected: 20), Stock B = ${sB} (Expected: 20), Stock C = ${sC} (Expected: 20), Status = ${cancelled3.status}`);

  if (sA !== 20) throw new Error(`Stock A incorrectly modified! Got: ${sA}, Expected: 20`);
  if (sB !== 20) throw new Error(`Stock B incorrectly modified! Got: ${sB}, Expected: 20`);
  if (sC !== 20) throw new Error(`Stock C not restored correctly! Got: ${sC}, Expected: 20`);
  if (cancelled3.status !== 'cancelled') throw new Error(`Order status not cancelled! Got: ${cancelled3.status}`);
  console.log('✓ Test 3 Passed!\n');

  // --- Test 4: Multi-item final exchange: A x 2 -> final state A x 2 + B x 1 -> cancel ---
  console.log('--- Test 4: Multi-item final exchange (A x 2 -> A x 2 + B x 1) -> cancel ---');
  await resetStocks(20, 20, 20);

  const order4 = await adminService.createManualOrder({
    customerName: 'Test MultiItem Cancel',
    phoneNumber: '44444444',
    orderSource: 'phone',
    customerEmail: 'test4@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue 123',
    items: [{ variantId: varA.id, quantity: 2 }],
  });
  await orderService.updateOrderStatus(order4.id, 'completed');

  // Exchange to A x 2 and B x 1
  await exchangeService.createExchange({
    orderId: order4.id,
    customer: { customerName: 'Test MultiItem Cancel', phoneNumber: '44444444', shippingAddress: 'Tunis' },
    items: [
      { variantId: varA.id, action: 'keep', quantity: 2 },
      { variantId: varB.id, action: 'add', quantity: 1 },
    ],
  });

  console.log(`After exchange: Stock A = ${await getStock(varA.id)} (18), Stock B = ${await getStock(varB.id)} (19)`);

  const cancelled4 = await orderService.cancelOrder(order4.id);
  sA = await getStock(varA.id);
  sB = await getStock(varB.id);
  console.log(`After cancelOrder: Stock A = ${sA} (Expected: 20), Stock B = ${sB} (Expected: 20), Status = ${cancelled4.status}`);

  if (sA !== 20) throw new Error(`Stock A not restored correctly! Got: ${sA}, Expected: 20`);
  if (sB !== 20) throw new Error(`Stock B not restored correctly! Got: ${sB}, Expected: 20`);
  if (cancelled4.status !== 'cancelled') throw new Error(`Order status not cancelled! Got: ${cancelled4.status}`);
  console.log('✓ Test 4 Passed!\n');

  // --- Test 5: updateOrderStatus with status 'cancelled' behaves identically ---
  console.log('--- Test 5: updateOrderStatus(orderId, "cancelled") on exchanged order ---');
  await resetStocks(20, 20, 20);

  const order5 = await adminService.createManualOrder({
    customerName: 'Test Status Update Cancel',
    phoneNumber: '55555555',
    orderSource: 'phone',
    customerEmail: 'test5@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue 123',
    items: [{ variantId: varA.id, quantity: 2 }],
  });
  await orderService.updateOrderStatus(order5.id, 'completed');

  await exchangeService.createExchange({
    orderId: order5.id,
    customer: { customerName: 'Test Status Update Cancel', phoneNumber: '55555555', shippingAddress: 'Tunis' },
    items: [{ variantId: varB.id, action: 'add', quantity: 3 }],
  });

  const cancelled5 = await orderService.updateOrderStatus(order5.id, 'cancelled');
  sA = await getStock(varA.id);
  sB = await getStock(varB.id);
  console.log(`After updateOrderStatus cancelled: Stock A = ${sA} (Expected: 20), Stock B = ${sB} (Expected: 20), Status = ${cancelled5.status}`);

  if (sA !== 20 || sB !== 20 || cancelled5.status !== 'cancelled') {
    throw new Error('Test 5 failed!');
  }
  console.log('✓ Test 5 Passed!\n');

  // Cleanup test orders after background emails settle
  const testOrderIds = [order1.id, order2.id, order3.id, order4.id, order5.id];
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS pending FROM order_email_deliveries WHERE order_id = ANY($1::uuid[]) AND status = 'pending'`,
      [testOrderIds]
    );
    if (Number(rows[0]?.pending || 0) === 0) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [testOrderIds]);

  console.log('====================================================');
  console.log('✅ ALL CANCELLATION RESTORATION TESTS PASSED!');
  console.log('====================================================');
}

runTests()
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });

