import '../config/env.js';
import './helpers/parcel_guard_off.js';
import { pool } from '../db/pool.js';
import { runExchangesMigration } from '../db/migrations/add_exchanges.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as analyticsService from '../services/analytics.service.js';
import * as adminService from '../services/admin.service.js';
import { DELIVERY_ECONOMICS } from '../config/delivery.js';

import * as inventoryService from '../services/inventory.service.js';

async function runRevenueTests() {
  console.log('================================================================');
  console.log('Verifying Total Revenue vs. Net Revenue & Basket Value Analytics');
  console.log('================================================================\n');

  await runExchangesMigration(pool);

  const { rows: variants } = await pool.query(`
    SELECT pv.id, pv.stock_quantity, p.title, p.price, p.discount_amount
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

  const [varA, varB, varC] = variants;
  const priceA = Number(varA.price) - Number(varA.discount_amount);
  const priceB = Number(varB.price) - Number(varB.discount_amount);
  const priceC = Number(varC.price) - Number(varC.discount_amount);

  await inventoryService.updateVariantStock(varA.id, 50);
  await inventoryService.updateVariantStock(varB.id, 50);
  await inventoryService.updateVariantStock(varC.id, 50);

  console.log(`Using Variants:`);
  console.log(`- Variant A (${varA.title}): ${priceA} TND`);
  console.log(`- Variant B (${varB.title}): ${priceB} TND`);
  console.log(`- Variant C (${varC.title}): ${priceC} TND\n`);

  // Baseline analytics before test orders
  const baseline = await analyticsService.getAnalytics();
  const baseTotalRev = baseline.kpi.totalRevenue;
  const baseNetRev = baseline.kpi.netRevenue;
  const baseOrders = baseline.kpi.totalOrders;
  const baseCarrierExp = baseline.delivery.deliveryCompanyExpense;

  console.log(`Baseline: Orders=${baseOrders}, Total Rev=${baseTotalRev} TND, Net Rev=${baseNetRev} TND, Carrier Exp=${baseCarrierExp} TND\n`);

  const createdOrderIds = [];

  // Order 1: Normal delivery (Product A x 1, delivery fee 8 TND)
  // Expected Total Rev: priceA + 8
  // Expected Carrier Exp: 7
  // Expected Net Rev: priceA + 8 - 7 = priceA + 1
  const ord1 = await adminService.createManualOrder({
    customerName: 'Rev Test Customer One',
    phoneNumber: '90000001',
    orderSource: 'phone',
    customerEmail: 'rev1@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Avenue Habib Bourguiba',
    deliveryFee: 8.0,
    items: [{ variantId: varA.id, quantity: 1 }],
  });
  await orderService.confirmOrder(ord1.id);
  createdOrderIds.push(ord1.id);

  // Order 2: Customer-paid exchange (Order B x 1 -> exchanged to C x 1 with customer_paid 8 TND fee)
  // Initial order: priceB + 8
  // Exchanged to: priceC + 8 (customer_paid)
  // Expected Effective Order Total: priceC + 8
  // Expected Carrier Exp: 7 (initial delivery) + 7 (exchange) = 14
  // Expected Net Contribution: (priceC + 8) - 14 = priceC - 6 (or: priceC + 1 normal delivery + 1 exchange delivery - 8)
  const ord2 = await adminService.createManualOrder({
    customerName: 'Rev Test Customer Two',
    phoneNumber: '90000002',
    orderSource: 'phone',
    customerEmail: 'rev2@example.com',
    governorate: 'Ariana',
    shippingAddress: 'Rue de la Rose',
    deliveryFee: 8.0,
    items: [{ variantId: varB.id, quantity: 1 }],
  });
  await orderService.confirmOrder(ord2.id);
  createdOrderIds.push(ord2.id);

  await exchangeService.createExchange({
    orderId: ord2.id,
    customer: { customerName: 'Rev Test Customer Two', phoneNumber: '90000002', shippingAddress: 'Ariana' },
    deliveryFee: 8.0,
    paymentResponsibility: 'customer_paid',
    items: [{ variantId: varC.id, action: 'add', quantity: 1 }],
  });

  // Order 3: Silky-paid exchange (Order A x 1 -> exchanged to B x 1 with silky_paid 0 TND fee)
  // Exchanged to: priceB + 0 = priceB
  // Expected Carrier Exp: 7 (initial delivery) + 7 (exchange) = 14
  // Expected Net Contribution: priceB - 14
  const ord3 = await adminService.createManualOrder({
    customerName: 'Rev Test Customer Three',
    phoneNumber: '90000003',
    orderSource: 'phone',
    customerEmail: 'rev3@example.com',
    governorate: 'Sfax',
    shippingAddress: 'Route de Téniour',
    deliveryFee: 8.0,
    items: [{ variantId: varA.id, quantity: 1 }],
  });
  await orderService.confirmOrder(ord3.id);
  createdOrderIds.push(ord3.id);

  await exchangeService.createExchange({
    orderId: ord3.id,
    customer: { customerName: 'Rev Test Customer Three', phoneNumber: '90000003', shippingAddress: 'Sfax' },
    paymentResponsibility: 'silky_paid',
    items: [{ variantId: varB.id, action: 'add', quantity: 1 }],
  });

  // Order 4: Cancelled order (Product A x 1, delivery fee 8 TND -> cancelled)
  // Expected contribution: 0 revenue, 0 carrier expense
  const ord4 = await adminService.createManualOrder({
    customerName: 'Rev Test Customer Four',
    phoneNumber: '90000004',
    orderSource: 'phone',
    customerEmail: 'rev4@example.com',
    governorate: 'Sousse',
    shippingAddress: 'Boulevard 14 Janvier',
    deliveryFee: 8.0,
    items: [{ variantId: varA.id, quantity: 1 }],
  });
  await orderService.cancelOrder(ord4.id);
  createdOrderIds.push(ord4.id);

  const stats = await analyticsService.getAnalytics();
  const kpi = stats.kpi;
  const del = stats.delivery;

  console.log('--- Verification Results ---');
  console.log(`Active Orders: ${kpi.totalOrders} (Expected: ${baseOrders + 3})`);
  if (kpi.totalOrders !== baseOrders + 3) {
    throw new Error(`Expected ${baseOrders + 3} active orders, got ${kpi.totalOrders}`);
  }

  // Expected increments from our 3 active test orders:
  // Order 1 total: priceA + 8 (initial delivery)
  // Order 2 total: priceC + 8 (initial delivery) + 8 (exchange delivery)
  // Order 3 total: priceB + 8 (initial delivery) + 0 (exchange delivery)
  const expectedTotalRevInc = (priceA + 8) + (priceC + 8 + 8) + (priceB + 8 + 0);
  const actualTotalRevInc = kpi.totalRevenue - baseTotalRev;

  console.log(`Total Revenue: ${kpi.totalRevenue} TND (Increment: ${actualTotalRevInc}, Expected: ${expectedTotalRevInc})`);
  if (Math.abs(actualTotalRevInc - expectedTotalRevInc) > 0.01) {
    throw new Error(`Total revenue increment mismatch: got ${actualTotalRevInc}, expected ${expectedTotalRevInc}`);
  }

  // Expected carrier expense increment:
  // 3 active normal orders * 7 = 21
  // 1 customer-paid exchange * 7 = 7
  // 1 silky-paid exchange * 7 = 7
  // Total carrier exp inc = 35
  const expectedCarrierExpInc = (3 * 7.0) + (1 * 7.0) + (1 * 7.0);
  const actualCarrierExpInc = del.deliveryCompanyExpense - baseCarrierExp;

  console.log(`Carrier Expense: ${del.deliveryCompanyExpense} TND (Increment: ${actualCarrierExpInc}, Expected: ${expectedCarrierExpInc})`);
  if (Math.abs(actualCarrierExpInc - expectedCarrierExpInc) > 0.01) {
    throw new Error(`Carrier expense increment mismatch: got ${actualCarrierExpInc}, expected ${expectedCarrierExpInc}`);
  }

  // Expected Net Revenue increment = expectedTotalRevInc - expectedCarrierExpInc
  const expectedNetRevInc = expectedTotalRevInc - expectedCarrierExpInc;
  const actualNetRevInc = kpi.netRevenue - baseNetRev;

  console.log(`Net Revenue: ${kpi.netRevenue} TND (Increment: ${actualNetRevInc}, Expected: ${expectedNetRevInc})`);
  if (Math.abs(actualNetRevInc - expectedNetRevInc) > 0.01) {
    throw new Error(`Net revenue increment mismatch: got ${actualNetRevInc}, expected ${expectedNetRevInc}`);
  }

  // Verify formula: Net Revenue = Total Revenue - Carrier Expense
  if (Math.abs(kpi.netRevenue - (kpi.totalRevenue - del.deliveryCompanyExpense)) > 0.01) {
    throw new Error(`Net revenue does not equal totalRevenue - deliveryCompanyExpense!`);
  }

  // Verify Panier Moyen & Panier Moyen Net formulas
  const expectedPanierMoyen = kpi.totalRevenue / kpi.totalOrders;
  const expectedPanierMoyenNet = kpi.netRevenue / kpi.totalOrders;

  console.log(`Panier Moyen: ${kpi.averageOrderValue} TND (Expected: ${expectedPanierMoyen})`);
  console.log(`Panier Moyen Net: ${kpi.averageOrderValueNet} TND (Expected: ${expectedPanierMoyenNet})`);

  if (Math.abs(kpi.averageOrderValue - expectedPanierMoyen) > 0.001) {
    throw new Error(`Panier moyen formula mismatch: got ${kpi.averageOrderValue}, expected ${expectedPanierMoyen}`);
  }
  if (Math.abs(kpi.averageOrderValueNet - expectedPanierMoyenNet) > 0.001) {
    throw new Error(`Panier moyen net formula mismatch: got ${kpi.averageOrderValueNet}, expected ${expectedPanierMoyenNet}`);
  }

  console.log('\n================================================================');
  console.log('✅ ALL TOTAL REVENUE VS NET REVENUE TESTS PASSED PERFECTLY!');
  console.log('================================================================\n');

  // Clean up — wait for background emails to settle
  if (createdOrderIds.length > 0) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS pending FROM order_email_deliveries WHERE order_id = ANY($1::uuid[]) AND status = 'pending'`,
        [createdOrderIds]
      );
      if (Number(rows[0]?.pending || 0) === 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [createdOrderIds]);
  }
}

runRevenueTests()
  .catch((err) => {
    console.error('❌ Revenue verification failed:', err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });

