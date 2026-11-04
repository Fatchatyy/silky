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
  console.log('================================================================');
  console.log('Starting Delivery Economics & Status Decoupling Verification');
  console.log('================================================================\n');

  // 0. Ensure migration is applied
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

  async function getStock(variantId) {
    const inv = await inventoryService.getInventory();
    const item = inv.find((v) => (v.variantId || v.id) === variantId);
    return item ? item.stockQuantity : null;
  }

  async function resetStocks(sA = 20, sB = 20, sC = 20) {
    await inventoryService.updateVariantStock(varA.id, sA);
    await inventoryService.updateVariantStock(varB.id, sB);
    await inventoryService.updateVariantStock(varC.id, sC);
  }

  await resetStocks(20, 20, 20);

  // --- Test 1: Order Creation & Decoupled Explicit Confirmation ---
  console.log('--- Test 1: Order Creation & Decoupled Explicit Confirmation ---');
  const order1 = await adminService.createManualOrder({
    customerName: 'Test Decouple Customer',
    phoneNumber: '12345678',
    orderSource: 'phone',
    customerEmail: 'decouple1@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Avenue Habib Bourguiba',
    deliveryFee: 8.0,
    items: [{ variantId: varA.id, quantity: 2 }],
  });

  console.log(`Order created: ${order1.orderNumber}, status = ${order1.status} (Expected: pending)`);
  if (order1.status !== 'pending') throw new Error(`Expected initial status to be pending, got ${order1.status}`);

  // Confirm explicitly
  const confirmedOrder1 = await orderService.confirmOrder(order1.id);
  console.log(`Order explicitly confirmed: status = ${confirmedOrder1.status} (Expected: completed)`);
  if (confirmedOrder1.status !== 'completed') throw new Error(`Expected confirmed status to be completed, got ${confirmedOrder1.status}`);

  // Test bulk confirmation
  const order2 = await adminService.createManualOrder({
    customerName: 'Test Bulk Customer',
    phoneNumber: '87654321',
    orderSource: 'instagram',
    customerEmail: 'decouple2@example.com',
    governorate: 'Sousse',
    shippingAddress: 'Boulevard 14 Janvier',
    deliveryFee: 8.0,
    items: [{ variantId: varB.id, quantity: 1 }],
  });

  const bulkConfirmed = await orderService.confirmOrders([order2.id]);
  if (!bulkConfirmed.length || bulkConfirmed[0].status !== 'completed') {
    throw new Error('Bulk confirmOrder failed to confirm order2');
  }
  console.log('✓ Test 1 Passed: Explicit confirmation works independently from PDF.\n');

  // --- Test 2: Cannot Confirm Cancelled Orders ---
  console.log('--- Test 2: Cannot Confirm Cancelled Orders ---');
  await orderService.cancelOrder(order2.id);
  let errorCaught = false;
  try {
    await orderService.confirmOrder(order2.id);
  } catch (err) {
    errorCaught = true;
    console.log(`Successfully caught expected error: ${err.message}`);
  }
  if (!errorCaught) throw new Error('Expected confirming a cancelled order to throw an error');
  console.log('✓ Test 2 Passed: Cancelled orders cannot be confirmed.\n');

  // --- Test 3: Customer-paid Exchange (Echange) ---
  console.log('--- Test 3: Customer-paid Exchange (Echange) ---');
  // Order 1 has A x 2. Exchange to B x 2 (customer_paid)
  const exch1 = await exchangeService.createExchange({
    orderId: order1.id,
    customer: { customerName: 'Test Decouple Customer', phoneNumber: '12345678', shippingAddress: 'Tunis' },
    deliveryFee: 8.0,
    paymentResponsibility: 'customer_paid',
    items: [{ variantId: varB.id, action: 'add', quantity: 2 }],
  });

  const fetchedOrderAfterEx1 = await orderService.getOrderById(order1.id);
  const latestEx1 = fetchedOrderAfterEx1.exchanges[0];
  console.log(`Exchange 1: sequence = ${latestEx1.exchangeSequence}, paymentResponsibility = ${latestEx1.paymentResponsibility}, deliveryFee = ${latestEx1.deliveryFee}`);
  if (latestEx1.paymentResponsibility !== 'customer_paid') {
    throw new Error(`Expected paymentResponsibility to be customer_paid, got ${latestEx1.paymentResponsibility}`);
  }
  if (Number(latestEx1.deliveryFee) !== 8.0) {
    throw new Error(`Expected customer deliveryFee to be 8.0, got ${latestEx1.deliveryFee}`);
  }
  console.log('✓ Test 3 Passed: Customer-paid exchange correctly persisted.\n');

  // --- Test 4: Silky-paid Exchange (Echange payé) ---
  console.log('--- Test 4: Silky-paid Exchange (Echange payé) ---');
  // Second exchange: B x 2 -> C x 2 (silky_paid)
  const exch2 = await exchangeService.createExchange({
    orderId: order1.id,
    customer: { customerName: 'Test Decouple Customer', phoneNumber: '12345678', shippingAddress: 'Tunis' },
    paymentResponsibility: 'silky_paid',
    items: [{ variantId: varC.id, action: 'add', quantity: 2 }],
  });

  const fetchedOrderAfterEx2 = await orderService.getOrderById(order1.id);
  const latestEx2 = fetchedOrderAfterEx2.exchanges[0];
  console.log(`Exchange 2: sequence = ${latestEx2.exchangeSequence}, paymentResponsibility = ${latestEx2.paymentResponsibility}, deliveryFee = ${latestEx2.deliveryFee}`);
  if (latestEx2.paymentResponsibility !== 'silky_paid') {
    throw new Error(`Expected paymentResponsibility to be silky_paid, got ${latestEx2.paymentResponsibility}`);
  }
  if (Number(latestEx2.deliveryFee) !== 0.0) {
    throw new Error(`Expected Silky-paid customer deliveryFee to be 0, got ${latestEx2.deliveryFee}`);
  }
  console.log('✓ Test 4 Passed: Silky-paid exchange correctly persisted with 0 TND customer fee.\n');

  // --- Test 5: Multiple Successive Exchanges Stock & Cancellation ---
  console.log('--- Test 5: Multiple Successive Exchanges Stock & Cancellation ---');
  // Order 1 was: A x 2 -> Exch 1: B x 2 -> Exch 2: C x 2
  // Current stocks: A was restored to 20, B was restored to 20, C was deducted 2 (stock C = 18)
  const sA = await getStock(varA.id);
  const sB = await getStock(varB.id);
  let sC = await getStock(varC.id);
  console.log(`Current stocks: A = ${sA} (Expected: 20), B = ${sB} (Expected: 20), C = ${sC} (Expected: 18)`);
  if (sA !== 20 || sB !== 20 || sC !== 18) throw new Error('Stock levels mismatch before cancellation');

  // Cancelling order 1 must restore ONLY C x 2 (to 20), leaving A and B unchanged at 20
  await orderService.cancelOrder(order1.id);
  const sA_after = await getStock(varA.id);
  const sB_after = await getStock(varB.id);
  const sC_after = await getStock(varC.id);
  console.log(`Stocks after cancellation: A = ${sA_after} (20), B = ${sB_after} (20), C = ${sC_after} (20)`);
  if (sA_after !== 20 || sB_after !== 20 || sC_after !== 20) {
    throw new Error('Stock restoration on cancellation failed to restore only the final variant C!');
  }
  console.log('✓ Test 5 Passed: Multi-exchange stock integrity and cancellation restoration verified.\n');

  // --- Test 6: Delivery Analytics Economics Verification ---
  console.log('--- Test 6: Delivery Analytics Economics Verification ---');
  // Create clean isolated test orders for analytics
  // Order A (normal delivery only, 8 TND fee)
  const ordA = await adminService.createManualOrder({
    customerName: 'Analytics Customer One',
    phoneNumber: '11110000',
    orderSource: 'phone',
    customerEmail: 'deliv.test1@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Avenue Habib Bourguiba',
    deliveryFee: 8.0,
    items: [{ variantId: varA.id, quantity: 1 }],
  });
  await orderService.confirmOrder(ordA.id);

  // Order B (normal delivery 8 TND + Exchange 1 customer_paid 8 TND + Exchange 2 silky_paid 0 TND)
  const ordB = await adminService.createManualOrder({
    customerName: 'Analytics Customer Two',
    phoneNumber: '22220000',
    orderSource: 'phone',
    customerEmail: 'deliv.test2@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Avenue Habib Bourguiba',
    deliveryFee: 8.0,
    items: [{ variantId: varA.id, quantity: 1 }],
  });
  await orderService.confirmOrder(ordB.id);

  // Exch 1 on Ord B (customer_paid, 8 TND)
  await exchangeService.createExchange({
    orderId: ordB.id,
    customer: { customerName: 'Analytics Customer Two', phoneNumber: '22220000', shippingAddress: 'Tunis' },
    deliveryFee: 8.0,
    paymentResponsibility: 'customer_paid',
    items: [{ variantId: varB.id, action: 'add', quantity: 1 }],
  });

  // Exch 2 on Ord B (silky_paid, 0 TND)
  await exchangeService.createExchange({
    orderId: ordB.id,
    customer: { customerName: 'Analytics Customer Two', phoneNumber: '22220000', shippingAddress: 'Tunis' },
    paymentResponsibility: 'silky_paid',
    items: [{ variantId: varC.id, action: 'add', quantity: 1 }],
  });

  // Order C (cancelled order -> 0 TND delivery impact)
  const ordC = await adminService.createManualOrder({
    customerName: 'Analytics Customer Three',
    phoneNumber: '33330000',
    orderSource: 'phone',
    customerEmail: 'deliv.test3@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Avenue Habib Bourguiba',
    deliveryFee: 8.0,
    items: [{ variantId: varA.id, quantity: 1 }],
  });
  await orderService.cancelOrder(ordC.id);

  const stats = await analyticsService.getAnalytics();
  const del = stats.delivery;

  console.log('Delivery Analytics Results:');
  console.log(`- Customer Delivery Revenue: ${del.customerDeliveryRevenue} TND`);
  console.log(`- Delivery Company Expense: ${del.deliveryCompanyExpense} TND`);
  console.log(`- Net Delivery Margin: ${del.deliveryMargin} TND`);
  console.log(`- Normal Deliveries: ${del.normalDeliveries.count} orders, rev: ${del.normalDeliveries.revenue}, exp: ${del.normalDeliveries.expense}, margin: ${del.normalDeliveries.margin}`);
  console.log(`- Customer-Paid Exchanges: ${del.customerPaidExchanges.count} exchanges, rev: ${del.customerPaidExchanges.revenue}, exp: ${del.customerPaidExchanges.expense}, margin: ${del.customerPaidExchanges.margin}`);
  console.log(`- Silky-Paid Exchanges: ${del.silkyPaidExchanges.count} exchanges, rev: ${del.silkyPaidExchanges.revenue}, exp: ${del.silkyPaidExchanges.expense}, margin: ${del.silkyPaidExchanges.margin}`);
  console.log(`- Cancellations: ${del.cancellations.count} orders, impact: 0 TND`);

  // Verify normal delivery unit economics: 8 rev, 7 expense, +1 margin
  if (del.normalDeliveries.count < 2) throw new Error('Expected at least 2 active orders in normalDeliveries');
  if (del.customerPaidExchanges.count < 1) throw new Error('Expected at least 1 customer-paid exchange');
  if (del.silkyPaidExchanges.count < 1) throw new Error('Expected at least 1 silky-paid exchange');

  // Margin calculation verification:
  const expectedNormalMargin = del.normalDeliveries.revenue - del.normalDeliveries.count * 7.0;
  const expectedCustomerExchMargin = del.customerPaidExchanges.revenue - del.customerPaidExchanges.count * 7.0;
  const expectedSilkyExchMargin = del.silkyPaidExchanges.revenue - del.silkyPaidExchanges.count * 7.0;
  const expectedRefundMargin = del.refunds ? (del.refunds.revenue - del.refunds.count * 7.0) : 0;
  const expectedTotalMargin = expectedNormalMargin + expectedCustomerExchMargin + expectedSilkyExchMargin + expectedRefundMargin;

  if (del.normalDeliveries.margin !== expectedNormalMargin) {
    throw new Error(`Normal deliveries margin mismatch: got ${del.normalDeliveries.margin}, expected ${expectedNormalMargin}`);
  }
  if (del.customerPaidExchanges.margin !== expectedCustomerExchMargin) {
    throw new Error(`Customer-paid exchanges margin mismatch: got ${del.customerPaidExchanges.margin}, expected ${expectedCustomerExchMargin}`);
  }
  if (del.silkyPaidExchanges.margin !== expectedSilkyExchMargin) {
    throw new Error(`Silky-paid exchanges margin mismatch: got ${del.silkyPaidExchanges.margin}, expected ${expectedSilkyExchMargin}`);
  }
  if (del.deliveryMargin !== expectedTotalMargin) {
    throw new Error(`Total delivery margin mismatch: got ${del.deliveryMargin}, expected ${expectedTotalMargin}`);
  }

  // Verify Total Revenue vs Net Revenue distinction
  const kpi = stats.kpi;
  const expectedNetRevenue = kpi.totalRevenue - del.deliveryCompanyExpense;
  const expectedAvgOrderValue = kpi.totalOrders > 0 ? kpi.totalRevenue / kpi.totalOrders : 0;
  const expectedAvgOrderValueNet = kpi.totalOrders > 0 ? expectedNetRevenue / kpi.totalOrders : 0;

  console.log('KPI Revenue & Average Order Value Results:');
  console.log(`- Revenu Total (before carrier costs): ${kpi.totalRevenue} TND`);
  console.log(`- REVENU NET (after carrier costs): ${kpi.netRevenue} TND (Expected: ${expectedNetRevenue} TND)`);
  console.log(`- Panier Moyen (Total): ${kpi.averageOrderValue} TND (Expected: ${expectedAvgOrderValue} TND)`);
  console.log(`- PANIER MOYEN NET: ${kpi.averageOrderValueNet} TND (Expected: ${expectedAvgOrderValueNet} TND)`);

  if (kpi.netRevenue !== expectedNetRevenue) {
    throw new Error(`Net revenue mismatch: got ${kpi.netRevenue}, expected ${expectedNetRevenue}`);
  }
  if (Math.abs(kpi.averageOrderValue - expectedAvgOrderValue) > 0.001) {
    throw new Error(`Average order value mismatch: got ${kpi.averageOrderValue}, expected ${expectedAvgOrderValue}`);
  }
  if (Math.abs(kpi.averageOrderValueNet - expectedAvgOrderValueNet) > 0.001) {
    throw new Error(`Average order value net mismatch: got ${kpi.averageOrderValueNet}, expected ${expectedAvgOrderValueNet}`);
  }

  console.log('✓ Test 6 Passed: Delivery economics & Net Revenue calculations verified perfectly!\n');

  console.log('================================================================');
  console.log('✅ ALL DELIVERY ECONOMICS & DECOUPLING TESTS PASSED!');
  console.log('================================================================\n');

  // Wait for background email dispatches to settle before deleting orders and closing pool
  const cleanupIds = [order1.id, order2.id, ordA.id, ordB.id, ordC.id];
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS pending FROM order_email_deliveries WHERE order_id = ANY($1::uuid[]) AND status = 'pending'`,
      [cleanupIds]
    );
    if (Number(rows[0]?.pending || 0) === 0) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  // Clean up test orders
  await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [cleanupIds]);
}

runTests()
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });

