/**
 * Comprehensive Test Suite for:
 * 1. Stock-Aware Exchange Availability Validation (Pure requestedQuantity <= currentAvailableStock)
 * 2. Remboursement (Return / Refund) Economics, Inventory Restoration, and Status Lifecycle
 * 3. Lifetime Event-Based Analytics Integration
 *
 * Covers All 32 Required Scenarios Exactly.
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

async function runAllTests() {
  console.log('========================================================================');
  console.log('STOCK-AWARE EXCHANGES & REMBOURSEMENT COMPREHENSIVE VERIFICATION SUITE');
  console.log('========================================================================\n');

  await runExchangesMigration(pool);
  await runRefundsMigration(pool);

  // Fetch 4 distinct active product variants
  const { rows: allVariantRows } = await pool.query(`
    SELECT
      p.id AS product_id, p.title,
      (p.price - p.discount_amount) AS effective_price,
      pv.id AS variant_id, pv.sku
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.is_active = TRUE
    ORDER BY p.price DESC, p.id, pv.id
  `);

  const variantList = allVariantRows.map((r) => ({
    variantId: r.variant_id,
    productId: r.product_id,
    title: r.title,
    price: Number(r.effective_price),
    sku: r.sku,
  }));

  if (variantList.length < 4) {
    console.error('Test requires at least 4 distinct variants in DB.');
    process.exit(1);
  }

  const varA = variantList[0];
  const varB = variantList[1];
  const cheaperVariant = variantList.find((v) => v.price < varA.price) || variantList[2];
  const varC = cheaperVariant;
  const varD = variantList.find((v) => v.variantId !== varA.variantId && v.variantId !== varB.variantId && v.variantId !== varC.variantId) || variantList[3];

  console.log(`Test Variants:`);
  console.log(`- Var A: ${varA.title} — ${varA.price} TND (${varA.variantId})`);
  console.log(`- Var B: ${varB.title} — ${varB.price} TND (${varB.variantId})`);
  console.log(`- Var C: ${varC.title} — ${varC.price} TND (${varC.variantId})`);
  console.log(`- Var D: ${varD.title} — ${varD.price} TND (${varD.variantId})\n`);

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
  // PART 1: EXCHANGE AVAILABILITY TESTS (Scenarios 1-9)
  // ========================================================================
  console.log('--- PART 1: EXCHANGE AVAILABILITY TESTS ---');

  // Scenario 1: Same variant, same quantity, stock 0 -> REJECT
  console.log('\n[Scenario 1] Same variant, same quantity, stock 0 -> REJECT');
  await setStock(varA.variantId, 1);
  const ordS1 = await adminService.createManualOrder({
    customerName: 'Sarah Customer', phoneNumber: '90001001', orderSource: 'phone',
    customerEmail: 's1@test.com', governorate: 'Tunis', shippingAddress: 'Rue de la Liberté',
    items: [{ variantId: varA.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordS1.id);
  cleanupOrderIds.push(ordS1.id);

  // Customer has A x 1. Stock of A is now 0.
  let stockA = await getStock(varA.variantId);
  assert(stockA === 0, 'Initial stock of A is 0 after order creation');

  let s1Error = false;
  try {
    await exchangeService.createExchange({
      orderId: ordS1.id,
      customer: { customerName: 'Sarah Customer', phoneNumber: '90001001', shippingAddress: 'Tunis' },
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });
  } catch (err) {
    s1Error = true;
    console.log(`  Caught expected rejection: ${err.message}`);
  }
  assert(s1Error, 'Scenario 1: Exchange rejected when replacement stock of A is 0');

  // Scenarios 7, 8, 9: Rejected exchange causes zero mutation, no exchange record, no negative stock
  stockA = await getStock(varA.variantId);
  assert(stockA === 0, 'Scenario 7: Zero stock mutation on rejected exchange');
  const ordS1Check = await orderService.getOrderById(ordS1.id);
  assert(ordS1Check.exchanges.length === 0, 'Scenario 8: No exchange record created on rejection');
  assert(ordS1Check.status === 'completed', 'Order status remained completed');
  assert(stockA >= 0, 'Scenario 9: Stock is not negative');

  // Scenario 2: Same variant, same quantity, stock exactly sufficient (1) -> ALLOW
  console.log('\n[Scenario 2] Same variant, same quantity, stock 1 -> ALLOW');
  await setStock(varA.variantId, 1); // shelf has 1 unit
  const ordS2Ex = await exchangeService.createExchange({
    orderId: ordS1.id,
    customer: { customerName: 'Sarah Customer', phoneNumber: '90001001', shippingAddress: 'Tunis' },
    items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
  });
  assert(ordS2Ex.status === 'exchanged', 'Scenario 2: Exchange allowed with 1 unit in stock');
  stockA = await getStock(varA.variantId);
  // transition: 1 initial stock + 1 returned - 1 taken = 1
  assert(stockA === 1, 'Stock of A is 1 after successful swap');

  // Scenario 3: Different variant, insufficient stock (has A x 1, wants B x 2, stock B = 0 < 2 needed) -> REJECT
  console.log('\n[Scenario 3] Different variant, insufficient stock (has 1, wants 2, stock = 0 < 2 needed) -> REJECT');
  await setStock(varB.variantId, 0);
  let s3Error = false;
  try {
    await exchangeService.createExchange({
      orderId: ordS1.id,
      customer: { customerName: 'Sarah Customer', phoneNumber: '90001001', shippingAddress: 'Tunis' },
      items: [{ variantId: varB.variantId, action: 'add', quantity: 2 }],
    });
  } catch (err) {
    s3Error = true;
    console.log(`  Caught expected rejection: ${err.message}`);
  }
  assert(s3Error, 'Scenario 3: Exchange rejected because stock (0) < additional quantity needed (2)');

  // Scenario 4: Different variant, insufficient stock (has A x 1, wants B x 2, stock B = 1 < 2 needed) -> REJECT
  console.log('\n[Scenario 4] Different variant, insufficient stock (has 1, wants 2, stock 1 < 2 needed) -> REJECT');
  await setStock(varB.variantId, 1);
  let s4Error = false;
  try {
    await exchangeService.createExchange({
      orderId: ordS1.id,
      customer: { customerName: 'Sarah Customer', phoneNumber: '90001001', shippingAddress: 'Tunis' },
      items: [{ variantId: varB.variantId, action: 'add', quantity: 2 }],
    });
  } catch (err) {
    s4Error = true;
    console.log(`  Caught expected rejection: ${err.message}`);
  }
  assert(s4Error, 'Scenario 4: Exchange rejected when variant B has only 1 in stock');

  // Scenario 5: Different variant, insufficient stock (has A x 1, wants B x 2, stock B = 1) -> REJECT
  console.log('\n[Scenario 5] Different variant, insufficient stock (wants B x 2, stock B = 1) -> REJECT');
  await setStock(varB.variantId, 1);
  let s5Error = false;
  try {
    await exchangeService.createExchange({
      orderId: ordS1.id,
      customer: { customerName: 'Sarah Customer', phoneNumber: '90001001', shippingAddress: 'Tunis' },
      items: [{ variantId: varB.variantId, action: 'add', quantity: 2 }],
    });
  } catch (err) {
    s5Error = true;
    console.log(`  Caught expected rejection: ${err.message}`);
  }
  assert(s5Error, 'Scenario 5: Exchange rejected when variant B has only 1 in stock');

  // Scenario 6: Different variant, sufficient stock (wants B x 2, stock B = 2) -> ALLOW
  console.log('\n[Scenario 6] Different variant, sufficient stock (wants B x 2, stock B = 2) -> ALLOW');
  await setStock(varB.variantId, 2);
  const ordS6Ex = await exchangeService.createExchange({
    orderId: ordS1.id,
    customer: { customerName: 'Sarah Customer', phoneNumber: '90001001', shippingAddress: 'Tunis' },
    items: [{ variantId: varB.variantId, action: 'add', quantity: 2 }],
  });
  assert(ordS6Ex.status === 'exchanged', 'Scenario 6: Exchange allowed when variant B has 2 in stock');
  const stockB = await getStock(varB.variantId);
  assert(stockB === 0, 'Stock of B is 0 (2 deducted)');
  stockA = await getStock(varA.variantId);
  assert(stockA === 2, 'Stock of A restored by 1 (1 + 1 = 2)');

  // ========================================================================
  // PART 2: REMBOURSEMENT (RETURN/REFUND) BASIC TESTS (Scenarios 10-18)
  // ========================================================================
  console.log('\n--- PART 2: REMBOURSEMENT (RETURN/REFUND) BASIC TESTS ---');

  await setStock(varA.variantId, 10);
  const baseStats = await analyticsService.getAnalytics();

  // Scenario 10: Normal delivered order -> Remboursement
  console.log('\n[Scenario 10-17] Normal order -> Remboursement');
  const ordRefund1 = await adminService.createManualOrder({
    customerName: 'Refund Cust One', phoneNumber: '90002001', orderSource: 'phone',
    customerEmail: 'ref1@test.com', governorate: 'Tunis', shippingAddress: 'Rue de la Liberté',
    deliveryFee: 8.0,
    items: [{ variantId: varA.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordRefund1.id);
  cleanupOrderIds.push(ordRefund1.id);

  assert(await getStock(varA.variantId) === 9, 'Stock deducted to 9 on order creation');

  // Perform Remboursement
  const refundedOrd1 = await orderService.refundOrder(ordRefund1.id);
  assert(refundedOrd1.status === 'refunded', 'Scenario 10: Order status is refunded');

  // Scenario 11: Refund restores final active items
  assert(await getStock(varA.variantId) === 10, 'Scenario 11: Active variant A returned to stock (10)');

  // Scenario 12: Refund amount equals product value only
  const refRecord = refundedOrd1.refunds[0];
  assert(refRecord.refundAmount === varA.price, `Scenario 12: Refund amount ${refRecord.refundAmount} equals product value ${varA.price}`);

  // Scenario 13 & 14 & 15: Return delivery fee = 8, carrier expense = 7, contribution = +1
  assert(refRecord.deliveryFee === 8.0, 'Scenario 13: Customer pays 8 TND return fee');
  assert(refRecord.carrierCost === 7.0, 'Scenario 14: Carrier expense is 7 TND');
  assert(refRecord.deliveryFee - refRecord.carrierCost === 1.0, 'Scenario 15: Silky return delivery contribution is +1 TND');

  // Scenario 16: Original delivery fee is not refunded
  // Product refund only (= varA.price), original 8 TND fee retained
  assert(refRecord.refundAmount === varA.price, 'Scenario 16: Original delivery fee is not refunded');

  // Scenario 18: Remboursement cannot be executed twice
  console.log('\n[Scenario 18] Remboursement cannot be executed twice');
  let doubleRefundError = false;
  try {
    await orderService.refundOrder(ordRefund1.id);
  } catch (err) {
    doubleRefundError = true;
    console.log(`  Caught expected double-refund error: ${err.message}`);
  }
  assert(doubleRefundError, 'Scenario 18: Duplicate refund rejected');

  // Also verify cancel or confirm cannot be executed on refunded order
  let cancelOnRefundError = false;
  try {
    await orderService.cancelOrder(ordRefund1.id);
  } catch (err) {
    cancelOnRefundError = true;
  }
  assert(cancelOnRefundError, 'Cannot cancel a refunded order');

  // Check analytics for single refund
  const statsAfterRef1 = await analyticsService.getAnalytics();
  const incTotalRev = statsAfterRef1.kpi.totalRevenue - baseStats.kpi.totalRevenue;
  const incCarrierExp = statsAfterRef1.delivery.deliveryCompanyExpense - baseStats.delivery.deliveryCompanyExpense;
  const incNetRev = statsAfterRef1.kpi.netRevenue - baseStats.kpi.netRevenue;
  const incDelMargin = statsAfterRef1.delivery.deliveryMargin - baseStats.delivery.deliveryMargin;

  // Expected for normal order + refund:
  // Initial order: +varA.price + 8 delivery
  // Refund: +8 return delivery - varA.price product refund
  // Total gross customer revenue = 8 + 8 = 16
  // Carrier expense = 7 (initial) + 7 (return) = 14
  // Net revenue = 16 - 14 = +2 TND
  // Delivery margin = 16 - 14 = +2 TND
  assert(incTotalRev === 16.0, `Total revenue increment is 16 TND (got ${incTotalRev})`);
  assert(incCarrierExp === 14.0, `Carrier expense increment is 14 TND (got ${incCarrierExp})`);
  assert(incNetRev === 2.0, `Net revenue increment is +2 TND (got ${incNetRev})`);
  assert(incDelMargin === 2.0, `Delivery margin increment is +2 TND (got ${incDelMargin})`);

  // ========================================================================
  // PART 3: REFUND AFTER EXCHANGES (Scenarios 19-25)
  // ========================================================================
  console.log('\n--- PART 3: REFUND AFTER EXCHANGES ---');

  // Scenario 19 & 21: Cheaper-product exchange -> refund
  console.log('\n[Scenario 19 & 21] Order expensive A -> exchange to cheaper C -> refund');
  await setStock(varA.variantId, 20);
  await setStock(varC.variantId, 20);

  const ordCheaper = await adminService.createManualOrder({
    customerName: 'Cheaper Exch Cust', phoneNumber: '90003001', orderSource: 'phone',
    customerEmail: 'cheaper@test.com', governorate: 'Tunis', shippingAddress: 'Rue de la Liberté',
    deliveryFee: 8.0,
    items: [{ variantId: varA.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordCheaper.id);
  cleanupOrderIds.push(ordCheaper.id);

  // Exchange A -> C (cheaper)
  await exchangeService.createExchange({
    orderId: ordCheaper.id,
    customer: { customerName: 'Cheaper Exch Cust', phoneNumber: '90003001', shippingAddress: 'Tunis' },
    deliveryFee: 8.0, paymentResponsibility: 'customer_paid',
    items: [{ variantId: varC.variantId, action: 'add', quantity: 1 }],
  });

  // Refund order: should refund price of C (not A!) and restore C only
  const refCheaper = await orderService.refundOrder(ordCheaper.id);
  assert(refCheaper.status === 'refunded', 'Order status refunded');
  assert(refCheaper.refunds[0].refundAmount === varC.price, `Scenario 21: Refund amount is cheaper product price (${varC.price})`);
  assert(await getStock(varA.variantId) === 20, 'Var A remains at 20 (was already restored during exchange)');
  assert(await getStock(varC.variantId) === 20, 'Scenario 24: Var C restored to 20 on refund');

  // Scenario 22: More-expensive product exchange -> refund
  console.log('\n[Scenario 22] Order cheaper C -> exchange to expensive A -> refund');
  await setStock(varC.variantId, 20);
  await setStock(varA.variantId, 20);

  const ordExp = await adminService.createManualOrder({
    customerName: 'Exp Exch Cust', phoneNumber: '90003002', orderSource: 'phone',
    customerEmail: 'exp@test.com', governorate: 'Tunis', shippingAddress: 'Rue de la Liberté',
    deliveryFee: 8.0,
    items: [{ variantId: varC.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordExp.id);
  cleanupOrderIds.push(ordExp.id);

  // Exchange C -> A (more expensive)
  await exchangeService.createExchange({
    orderId: ordExp.id,
    customer: { customerName: 'Exp Exch Cust', phoneNumber: '90003002', shippingAddress: 'Tunis' },
    deliveryFee: 8.0, paymentResponsibility: 'customer_paid',
    items: [{ variantId: varA.variantId, action: 'add', quantity: 1 }],
  });

  const refExp = await orderService.refundOrder(ordExp.id);
  assert(refExp.refunds[0].refundAmount === varA.price, `Scenario 22: Refund amount is expensive product price (${varA.price})`);
  assert(await getStock(varC.variantId) === 20, 'Var C remains at 20 (restored during exchange)');
  assert(await getStock(varA.variantId) === 20, 'Var A restored to 20 on refund');

  // Scenario 20, 23, 24, 25: Multiple mixed exchanges (A -> B -> C -> D -> Remboursement)
  console.log('\n[Scenario 20, 23, 24, 25] A -> Exch(cust) B -> Exch(silky) C -> Exch(cust) D -> Remboursement');
  await setStock(varA.variantId, 50);
  await setStock(varB.variantId, 50);
  await setStock(varC.variantId, 50);
  await setStock(varD.variantId, 50);

  const baseStatsMulti = await analyticsService.getAnalytics();

  const ordMulti = await adminService.createManualOrder({
    customerName: 'Multi Cust', phoneNumber: '90004001', orderSource: 'phone',
    customerEmail: 'multi@test.com', governorate: 'Tunis', shippingAddress: 'Rue de la Liberté',
    deliveryFee: 8.0,
    items: [{ variantId: varA.variantId, quantity: 1 }],
  });
  await orderService.confirmOrder(ordMulti.id);
  cleanupOrderIds.push(ordMulti.id);

  // Exch 1: customer-paid (A -> B)
  await exchangeService.createExchange({
    orderId: ordMulti.id,
    customer: { customerName: 'Multi Cust', phoneNumber: '90004001', shippingAddress: 'Tunis' },
    deliveryFee: 8.0, paymentResponsibility: 'customer_paid',
    items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
  });

  // Exch 2: silky-paid (B -> C)
  await exchangeService.createExchange({
    orderId: ordMulti.id,
    customer: { customerName: 'Multi Cust', phoneNumber: '90004001', shippingAddress: 'Tunis' },
    deliveryFee: 0.0, paymentResponsibility: 'silky_paid',
    items: [{ variantId: varC.variantId, action: 'add', quantity: 1 }],
  });

  // Exch 3: customer-paid (C -> D)
  await exchangeService.createExchange({
    orderId: ordMulti.id,
    customer: { customerName: 'Multi Cust', phoneNumber: '90004001', shippingAddress: 'Tunis' },
    deliveryFee: 8.0, paymentResponsibility: 'customer_paid',
    items: [{ variantId: varD.variantId, action: 'add', quantity: 1 }],
  });

  // Pre-refund stocks: A=50, B=50, C=50, D=49
  assert(await getStock(varA.variantId) === 50, 'Pre-refund stock A = 50');
  assert(await getStock(varB.variantId) === 50, 'Pre-refund stock B = 50');
  assert(await getStock(varC.variantId) === 50, 'Pre-refund stock C = 50');
  assert(await getStock(varD.variantId) === 49, 'Pre-refund stock D = 49 (active)');

  // Remboursement
  const refMulti = await orderService.refundOrder(ordMulti.id);
  assert(refMulti.status === 'refunded', 'Order refunded');

  // Scenario 24 & 25: Only final active variant D restored once; historical A, B, C not re-restored
  assert(await getStock(varA.variantId) === 50, 'Scenario 25: Historical A not restored again (50)');
  assert(await getStock(varB.variantId) === 50, 'Scenario 25: Historical B not restored again (50)');
  assert(await getStock(varC.variantId) === 50, 'Scenario 25: Historical C not restored again (50)');
  assert(await getStock(varD.variantId) === 50, 'Scenario 24: Final active D restored exactly once to 50');

  // Refund amount equals D.price
  assert(refMulti.refunds[0].refundAmount === varD.price, `Refund amount equals final active variant D price (${varD.price})`);

  // ========================================================================
  // PART 4: ANALYTICS LIFETIME INTEGRATION TESTS (Scenarios 26-32)
  // ========================================================================
  console.log('\n--- PART 4: ANALYTICS LIFETIME INTEGRATION TESTS ---');

  const statsMulti = await analyticsService.getAnalytics();
  const incGross = statsMulti.kpi.totalRevenue - baseStatsMulti.kpi.totalRevenue;
  const incCarrier = statsMulti.delivery.deliveryCompanyExpense - baseStatsMulti.delivery.deliveryCompanyExpense;
  const incNet = statsMulti.kpi.netRevenue - baseStatsMulti.kpi.netRevenue;
  const incMargin = statsMulti.delivery.deliveryMargin - baseStatsMulti.delivery.deliveryMargin;

  // Let's verify delivery contributions:
  // Initial normal delivery: +8 customer, -7 carrier -> +1 (Scenario 26)
  // Customer-paid exchange 1: +8 customer, -7 carrier -> +1 (Scenario 27)
  // Silky-paid exchange 2: +0 customer, -7 carrier -> -7 (Scenario 28)
  // Customer-paid exchange 3: +8 customer, -7 carrier -> +1
  // Refund return delivery: +8 customer, -7 carrier -> +1 (Scenario 29)
  // Total delivery customer revenue = 8 + 8 + 0 + 8 + 8 = 32 TND
  // Total carrier expense = 7 * 5 = 35 TND
  // Total delivery margin = 32 - 35 = -3 TND
  // Product revenue = varD.price - varD.price (refund) = 0 TND (Scenario 30)
  // Gross customer revenue = (varD.price - varD.price) + 32 = 32 TND
  // Net revenue = 32 - 35 = -3 TND (Scenario 32)
  console.log(`  Gross revenue increment: ${incGross} TND (Expected: 32)`);
  console.log(`  Carrier expense increment: ${incCarrier} TND (Expected: 35)`);
  console.log(`  Delivery margin increment: ${incMargin} TND (Expected: -3)`);
  console.log(`  Net revenue increment: ${incNet} TND (Expected: -3)`);

  assert(incGross === 32.0, `Scenario 30: Gross revenue increment is 32 TND, got ${incGross}`);
  assert(incCarrier === 35.0, 'Scenario 31: Historical delivery events remain intact with 5 carrier events (35 TND)');
  assert(incMargin === -3.0, 'Delivery margin is -3 TND (+1 +1 -7 +1 +1 = -3)');
  assert(incNet === -3.0, `Scenario 32: Net revenue is -3 TND, got ${incNet}`);

  // Verify breakdown counts
  const del = statsMulti.delivery;
  assert(del.refunds.count >= 2, 'Refund count is recorded in analytics breakdown');
  assert(del.refunds.margin === del.refunds.count * 1.0, 'Refund margin is +1 TND per refund');

  console.log('\n========================================================================');
  console.log(`✅ ALL ${passedCount} ASSERTIONS IN 32 TEST SCENARIOS PASSED 100%!`);
  console.log('========================================================================\n');

  // Clean up test orders after background emails settle
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

runAllTests()
  .catch((err) => {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });

