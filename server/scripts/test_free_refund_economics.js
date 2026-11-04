/**
 * Focused Verification Suite for Free Refund ("Remboursement gratuit") Economics & Security
 *
 * Covers:
 * A. Normal Refund (8 TND fee, 7 TND carrier cost, +1 TND margin)
 * B. Free Refund (0 TND fee, 7 TND carrier cost, -7 TND margin)
 * C. Security & Anti-Tampering (frontend deliveryFee parameter ignored)
 * D. Stock Integrity & Restoration (normal order and post-exchange order)
 * E. Lifecycle & Atomicity (no double refund, no cancel on refunded, zero mutation on failure)
 * F. Full Analytics Integration (Revenue, Expense, Margin, Net Revenue)
 */

import '../config/env.js';
import './helpers/parcel_guard_off.js';
import { pool } from '../db/pool.js';
import { runExchangesMigration } from '../db/migrations/add_exchanges.js';
import { runRefundsMigration } from '../db/migrations/add_refunds.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as inventoryService from '../services/inventory.service.js';
import * as analyticsService from '../services/analytics.service.js';
import * as adminService from '../services/admin.service.js';
import { DELIVERY_ECONOMICS } from '../config/delivery.js';

async function runFreeRefundTests() {
  console.log('========================================================================');
  console.log('FREE REFUND ("Remboursement gratuit") ECONOMICS & SECURITY TEST SUITE');
  console.log('========================================================================\n');

  // Run migrations
  await runExchangesMigration(pool);
  await runRefundsMigration(pool);

  // Fetch 3 active variants
  const { rows: allVariantRows } = await pool.query(`
    SELECT
      p.id AS product_id, p.title,
      (p.price - p.discount_amount) AS effective_price,
      pv.id AS variant_id, pv.sku
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.is_active = TRUE
    ORDER BY p.price DESC, p.id, pv.id
    LIMIT 3
  `);

  if (allVariantRows.length < 3) {
    console.error('Test requires at least 3 distinct active variants in DB.');
    process.exit(1);
  }

  const varA = {
    variantId: allVariantRows[0].variant_id,
    productId: allVariantRows[0].product_id,
    title: allVariantRows[0].title,
    price: Number(allVariantRows[0].effective_price),
  };

  const varB = {
    variantId: allVariantRows[1].variant_id,
    productId: allVariantRows[1].product_id,
    title: allVariantRows[1].title,
    price: Number(allVariantRows[1].effective_price),
  };

  const varC = {
    variantId: allVariantRows[2].variant_id,
    productId: allVariantRows[2].product_id,
    title: allVariantRows[2].title,
    price: Number(allVariantRows[2].effective_price),
  };

  console.log('Test Variants:');
  console.log(`- Var A: ${varA.title} — ${varA.price} TND (${varA.variantId})`);
  console.log(`- Var B: ${varB.title} — ${varB.price} TND (${varB.variantId})`);
  console.log(`- Var C: ${varC.title} — ${varC.price} TND (${varC.variantId})\n`);

  async function getStock(variantId) {
    const inv = await inventoryService.getInventory();
    const item = inv.find((v) => (v.variantId || v.id) === variantId);
    return item ? item.stockQuantity : null;
  }

  async function setStock(variantId, qty) {
    await inventoryService.updateVariantStock(variantId, qty);
  }

  const cleanupOrderIds = [];
  let passedCount = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`  ❌ FAILED: ${message}`);
      throw new Error(message);
    }
    passedCount++;
    console.log(`  ✓ Passed: ${message}`);
  }

  // ========================================================================
  // PART A: NORMAL REFUND VERIFICATION
  // ========================================================================
  console.log('--- PART A: NORMAL REFUND VERIFICATION ---');
  await setStock(varA.variantId, 30);

  const ordNormal = await adminService.createManualOrder({
    customerName: 'Normal Refund Customer',
    phoneNumber: '91000001',
    orderSource: 'phone',
    customerEmail: 'norm_ref@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue de la Liberté',
    deliveryFee: 8.0,
    items: [{ variantId: varA.variantId, quantity: 2 }],
  });
  await orderService.confirmOrder(ordNormal.id);
  cleanupOrderIds.push(ordNormal.id);

  assert(await getStock(varA.variantId) === 28, 'Stock of A deducted by 2 (30 -> 28)');

  const refundedNormal = await orderService.refundOrder(ordNormal.id, { paymentResponsibility: 'customer_paid' });
  assert(refundedNormal.status === 'refunded', 'Order status transitioned to refunded');

  const refRecordNormal = refundedNormal.refunds[0];
  assert(refRecordNormal.paymentResponsibility === 'customer_paid', 'Responsibility is customer_paid');
  assert(refRecordNormal.deliveryFee === 8.0, 'Customer delivery fee is 8.0 TND');
  assert(refRecordNormal.carrierCost === 7.0, 'Carrier cost is 7.0 TND');
  assert(refRecordNormal.deliveryFee - refRecordNormal.carrierCost === 1.0, 'Delivery margin is +1.0 TND');
  assert(refRecordNormal.refundAmount === varA.price * 2, `Refund amount ${refRecordNormal.refundAmount} matches product subtotal (${varA.price * 2})`);
  assert(refundedNormal.exchanges.length === 0, 'No exchange record created by refund');
  assert(await getStock(varA.variantId) === 30, 'Stock of A restored back to 30');

  // ========================================================================
  // PART B: FREE REFUND ("Remboursement gratuit") VERIFICATION
  // ========================================================================
  console.log('\n--- PART B: FREE REFUND ("Remboursement gratuit") VERIFICATION ---');
  await setStock(varB.variantId, 30);

  const ordFree = await adminService.createManualOrder({
    customerName: 'Free Refund Customer',
    phoneNumber: '92000001',
    orderSource: 'phone',
    customerEmail: 'free_ref@example.com',
    governorate: 'Sousse',
    shippingAddress: 'Boulevard 14 Janvier',
    deliveryFee: 8.0,
    items: [{ variantId: varB.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordFree.id);
  cleanupOrderIds.push(ordFree.id);

  assert(await getStock(varB.variantId) === 29, 'Stock of B deducted by 1 (30 -> 29)');

  const refundedFree = await orderService.refundOrder(ordFree.id, { paymentResponsibility: 'silky_paid' });
  assert(refundedFree.status === 'refunded', 'Order status transitioned to refunded');

  const refRecordFree = refundedFree.refunds[0];
  assert(refRecordFree.paymentResponsibility === 'silky_paid', 'Responsibility is silky_paid');
  assert(refRecordFree.deliveryFee === 0.0, 'Customer delivery fee is 0.0 TND for free refund');
  assert(refRecordFree.carrierCost === 7.0, 'Carrier cost is 7.0 TND for free refund');
  assert(refRecordFree.deliveryFee - refRecordFree.carrierCost === -7.0, 'Delivery margin is -7.0 TND for free refund');
  assert(refRecordFree.refundAmount === varB.price, `Refund amount ${refRecordFree.refundAmount} matches product subtotal (${varB.price})`);
  assert(refundedFree.exchanges.length === 0, 'No exchange record created by free refund');
  assert(await getStock(varB.variantId) === 30, 'Stock of B restored back to 30');

  // ========================================================================
  // PART C: SECURITY & ANTI-TAMPERING VERIFICATION
  // ========================================================================
  console.log('\n--- PART C: SECURITY & ANTI-TAMPERING VERIFICATION ---');
  // Attempting to send customer_paid with deliveryFee: 0 must still resolve to 8 TND
  const ordTamper1 = await adminService.createManualOrder({
    customerName: 'Tamper Cust 1',
    phoneNumber: '93000001',
    orderSource: 'phone',
    customerEmail: 'tamper1@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue de la Paix',
    deliveryFee: 8.0,
    items: [{ variantId: varA.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordTamper1.id);
  cleanupOrderIds.push(ordTamper1.id);

  const refTamper1 = await orderService.refundOrder(ordTamper1.id, {
    paymentResponsibility: 'customer_paid',
    deliveryFee: 0.0, // Attempted tamper
  });
  assert(refTamper1.refunds[0].deliveryFee === 8.0, 'Security: customer_paid + deliveryFee: 0 still enforces 8.0 TND');
  assert(refTamper1.refunds[0].carrierCost === 7.0, 'Carrier cost remains 7.0 TND');

  // Attempting to send silky_paid with deliveryFee: 99 must still resolve to 0 TND
  const ordTamper2 = await adminService.createManualOrder({
    customerName: 'Tamper Cust 2',
    phoneNumber: '93000002',
    orderSource: 'phone',
    customerEmail: 'tamper2@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue de la Paix',
    deliveryFee: 8.0,
    items: [{ variantId: varB.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordTamper2.id);
  cleanupOrderIds.push(ordTamper2.id);

  const refTamper2 = await orderService.refundOrder(ordTamper2.id, {
    paymentResponsibility: 'silky_paid',
    deliveryFee: 99.0, // Attempted tamper
  });
  assert(refTamper2.refunds[0].deliveryFee === 0.0, 'Security: silky_paid resolves authoritatively to 0.0 TND');
  assert(refTamper2.refunds[0].carrierCost === 7.0, 'Carrier cost remains 7.0 TND');

  // ========================================================================
  // PART D: STOCK INTEGRITY AFTER EXCHANGES -> FREE REFUND
  // ========================================================================
  console.log('\n--- PART D: STOCK INTEGRITY AFTER EXCHANGES -> FREE REFUND ---');
  await setStock(varA.variantId, 20);
  await setStock(varB.variantId, 20);
  await setStock(varC.variantId, 20);

  const ordExRefund = await adminService.createManualOrder({
    customerName: 'Exch-to-FreeRefund Cust',
    phoneNumber: '94000001',
    orderSource: 'phone',
    customerEmail: 'exch_ref@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue Habib Bourguiba',
    deliveryFee: 8.0,
    items: [{ variantId: varA.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordExRefund.id);
  cleanupOrderIds.push(ordExRefund.id);

  // Exchange 1: A -> B
  await exchangeService.createExchange({
    orderId: ordExRefund.id,
    customer: { customerName: 'Exch-to-FreeRefund Cust', phoneNumber: '94000001', shippingAddress: 'Tunis' },
    paymentResponsibility: 'customer_paid',
    deliveryFee: 8.0,
    items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
  });

  // Exchange 2: B -> C
  await exchangeService.createExchange({
    orderId: ordExRefund.id,
    customer: { customerName: 'Exch-to-FreeRefund Cust', phoneNumber: '94000001', shippingAddress: 'Tunis' },
    paymentResponsibility: 'silky_paid',
    deliveryFee: 0.0,
    items: [{ variantId: varC.variantId, action: 'add', quantity: 1 }],
  });

  // Stocks prior to refund: A=20, B=20, C=19
  assert(await getStock(varA.variantId) === 20, 'Stock of A is 20 before refund');
  assert(await getStock(varB.variantId) === 20, 'Stock of B is 20 before refund');
  assert(await getStock(varC.variantId) === 19, 'Stock of C is 19 before refund');

  // Perform Free Refund on the order
  const refExResult = await orderService.refundOrder(ordExRefund.id, { paymentResponsibility: 'silky_paid' });
  assert(refExResult.status === 'refunded', 'Order is refunded');
  assert(refExResult.refunds[0].paymentResponsibility === 'silky_paid', 'Refund record is silky_paid');
  assert(refExResult.refunds[0].deliveryFee === 0.0, 'Refund customer delivery fee is 0.0 TND');
  assert(refExResult.refunds[0].carrierCost === 7.0, 'Refund carrier cost is 7.0 TND');
  assert(refExResult.refunds[0].refundAmount === varC.price, `Refund amount matches final active variant C price (${varC.price})`);

  // Verify stock restoration: ONLY C restored to 20, historical A and B remain at 20
  assert(await getStock(varA.variantId) === 20, 'Stock of historical A remains 20 (not double restored)');
  assert(await getStock(varB.variantId) === 20, 'Stock of historical B remains 20 (not double restored)');
  assert(await getStock(varC.variantId) === 20, 'Stock of final active C restored to 20');

  // ========================================================================
  // PART E: LIFECYCLE, DOUBLE-REFUND REJECTION & ATOMICITY
  // ========================================================================
  console.log('\n--- PART E: LIFECYCLE, DOUBLE-REFUND REJECTION & ATOMICITY ---');

  // Cannot refund already refunded order
  let doubleRefundCaught = false;
  try {
    await orderService.refundOrder(ordExRefund.id, { paymentResponsibility: 'silky_paid' });
  } catch (err) {
    doubleRefundCaught = true;
    console.log(`  Caught expected duplicate refund error: ${err.message}`);
  }
  assert(doubleRefundCaught, 'Duplicate free refund rejected');

  // Cannot cancel refunded order
  let cancelRefundedCaught = false;
  try {
    await orderService.cancelOrder(ordExRefund.id);
  } catch (err) {
    cancelRefundedCaught = true;
    console.log(`  Caught expected cancel on refunded order error: ${err.message}`);
  }
  assert(cancelRefundedCaught, 'Cancelling refunded order rejected');

  // Cannot refund cancelled order
  const ordCancelled = await adminService.createManualOrder({
    customerName: 'Cancel Cust',
    phoneNumber: '95000001',
    orderSource: 'phone',
    customerEmail: 'cancel_cust@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue de la Paix',
    deliveryFee: 8.0,
    items: [{ variantId: varA.variantId, quantity: 1 }],
  });
  await orderService.cancelOrder(ordCancelled.id);
  cleanupOrderIds.push(ordCancelled.id);

  let refundCancelledCaught = false;
  try {
    await orderService.refundOrder(ordCancelled.id, { paymentResponsibility: 'silky_paid' });
  } catch (err) {
    refundCancelledCaught = true;
    console.log(`  Caught expected refund on cancelled order error: ${err.message}`);
  }
  assert(refundCancelledCaught, 'Refunding cancelled order rejected');

  // ========================================================================
  // PART F: ANALYTICS & ACCOUNTING VERIFICATION
  // ========================================================================
  console.log('\n--- PART F: ANALYTICS & ACCOUNTING VERIFICATION ---');

  // Base snapshot before controlled test orders
  const baseStats = await analyticsService.getAnalytics();

  // 1. Create order 1 -> Normal Refund
  const ordAnalyticsNorm = await adminService.createManualOrder({
    customerName: 'Analytics Norm Cust',
    phoneNumber: '96000001',
    orderSource: 'phone',
    customerEmail: 'ana_norm@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue de Marseille',
    deliveryFee: 8.0,
    items: [{ variantId: varA.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordAnalyticsNorm.id);
  await orderService.refundOrder(ordAnalyticsNorm.id, { paymentResponsibility: 'customer_paid' });
  cleanupOrderIds.push(ordAnalyticsNorm.id);

  // 2. Create order 2 -> Free Refund
  const ordAnalyticsFree = await adminService.createManualOrder({
    customerName: 'Analytics Free Cust',
    phoneNumber: '96000002',
    orderSource: 'phone',
    customerEmail: 'ana_free@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue de Rome',
    deliveryFee: 8.0,
    items: [{ variantId: varB.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordAnalyticsFree.id);
  await orderService.refundOrder(ordAnalyticsFree.id, { paymentResponsibility: 'silky_paid' });
  cleanupOrderIds.push(ordAnalyticsFree.id);

  const statsAfter = await analyticsService.getAnalytics();

  // Normal Refund Order economics:
  // - Initial delivery revenue = 8, carrier expense = 7
  // - Product revenue = varA.price - varA.price (refunded) = 0
  // - Return delivery revenue = 8, return carrier expense = 7
  // Order 1 Gross Total Revenue = 8 + 8 = 16
  // Order 1 Carrier Expense = 7 + 7 = 14
  // Order 1 Delivery Margin = (8 - 7) + (8 - 7) = +2
  // Order 1 Net Revenue = 16 - 14 = +2

  // Free Refund Order economics:
  // - Initial delivery revenue = 8, carrier expense = 7
  // - Product revenue = varB.price - varB.price (refunded) = 0
  // - Return delivery revenue = 0 (Free!), return carrier expense = 7 (Silky absorbs)
  // Order 2 Gross Total Revenue = 8 + 0 = 8
  // Order 2 Carrier Expense = 7 + 7 = 14
  // Order 2 Delivery Margin = (8 - 7) + (0 - 7) = 1 - 7 = -6
  // Order 2 Net Revenue = 8 - 14 = -6

  // Total Combined Increments:
  // Gross Revenue Delta = 16 + 8 = +24 TND
  // Carrier Expense Delta = 14 + 14 = +28 TND
  // Delivery Margin Delta = +2 + (-6) = -4 TND
  // Net Revenue Delta = +24 - 28 = -4 TND

  const incGross = statsAfter.kpi.totalRevenue - baseStats.kpi.totalRevenue;
  const incCarrier = statsAfter.delivery.deliveryCompanyExpense - baseStats.delivery.deliveryCompanyExpense;
  const incMargin = statsAfter.delivery.deliveryMargin - baseStats.delivery.deliveryMargin;
  const incNet = statsAfter.kpi.netRevenue - baseStats.kpi.netRevenue;

  console.log(`  Analytics Increments:`);
  console.log(`  - Gross Revenue Delta: ${incGross} TND (Expected: 24.0)`);
  console.log(`  - Carrier Expense Delta: ${incCarrier} TND (Expected: 28.0)`);
  console.log(`  - Delivery Margin Delta: ${incMargin} TND (Expected: -4.0)`);
  console.log(`  - Net Revenue Delta: ${incNet} TND (Expected: -4.0)`);

  assert(incGross === 24.0, `Analytics: Total gross revenue delta is 24.0 TND (got ${incGross})`);
  assert(incCarrier === 28.0, `Analytics: Total carrier expense delta is 28.0 TND (got ${incCarrier})`);
  assert(incMargin === -4.0, `Analytics: Total delivery margin delta is -4.0 TND (got ${incMargin})`);
  assert(incNet === -4.0, `Analytics: Net revenue delta is -4.0 TND (got ${incNet})`);

  // Verify breakdown fields in delivery analytics
  const del = statsAfter.delivery;
  assert(del.customerPaidRefunds !== undefined, 'Analytics includes customerPaidRefunds breakdown');
  assert(del.silkyPaidRefunds !== undefined, 'Analytics includes silkyPaidRefunds breakdown');
  assert(del.customerPaidRefunds.margin === del.customerPaidRefunds.count * 1.0, 'Customer-paid refunds margin is +1.0 TND per refund');
  assert(del.silkyPaidRefunds.margin === del.silkyPaidRefunds.count * -7.0, 'Silky-paid free refunds margin is -7.0 TND per refund');

  console.log('\n========================================================================');
  console.log(`✅ ALL ${passedCount} / ${totalTests} FREE REFUND ASSERTIONS PASSED PERFECTLY!`);
  console.log('========================================================================\n');

  // Clean up test orders
  if (cleanupOrderIds.length > 0) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS pending FROM order_email_deliveries WHERE order_id = ANY($1::uuid[]) AND status = 'pending'`,
        [cleanupOrderIds]
      );
      if (Number(rows[0]?.pending || 0) === 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [cleanupOrderIds]);
  }
}

runFreeRefundTests()
  .catch((err) => {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
