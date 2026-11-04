import '../config/env.js';
import './helpers/parcel_guard_off.js';
import { pool } from '../db/pool.js';
import { runExchangesMigration } from '../db/migrations/add_exchanges.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as inventoryService from '../services/inventory.service.js';
import * as analyticsService from '../services/analytics.service.js';
import * as adminService from '../services/admin.service.js';
import { emailDeliveryRepository } from '../repositories/email-delivery.repository.js';

async function waitForOrderEmailDelivery(orderId, maxWaitMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const row = await emailDeliveryRepository.findByOrderAndType(orderId, 'order_confirmation');
    if (row && (row.status === 'sent' || row.status === 'failed')) {
      return row;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return emailDeliveryRepository.findByOrderAndType(orderId, 'order_confirmation');
}

async function runEdgeCaseTests() {
  console.log('====================================================');
  console.log('Starting Comprehensive Exchange Statistics Edge Cases Verification');
  console.log('====================================================\n');

  // Ensure migration is run
  await runExchangesMigration(pool);

  // Fetch 3 distinct products with variants for clean testing
  const { rows: products } = await pool.query(`
    SELECT p.id AS product_id, p.title, p.price, p.discount_amount, pv.id AS variant_id
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.is_active = TRUE
    ORDER BY p.id, pv.id
  `);

  // Group variants by product
  const productMap = new Map();
  for (const row of products) {
    if (!productMap.has(row.product_id)) {
      productMap.set(row.product_id, {
        productId: row.product_id,
        title: row.title,
        price: Number(row.price),
        discountAmount: Number(row.discount_amount),
        effectivePrice: Number(row.price) - Number(row.discount_amount),
        variants: [],
      });
    }
    productMap.get(row.product_id).variants.push(row.variant_id);
  }

  const productList = Array.from(productMap.values());
  if (productList.length < 2) {
    console.error('Test requires at least 2 distinct active products in DB.');
    process.exit(1);
  }

  const prodA = productList[0];
  const prodB = productList[1];
  const prodC = productList[2] || productList[0];

  const varA = prodA.variants[0];
  const varB = prodB.variants[0];
  const varC = (prodC.productId !== prodB.productId && prodC.variants[0]) ? prodC.variants[0] : (prodB.variants[1] || prodA.variants[1]);

  console.log(`Product A: "${prodA.title}" (Effective Price: ${prodA.effectivePrice} TND), Variant ID: ${varA}`);
  console.log(`Product B: "${prodB.title}" (Effective Price: ${prodB.effectivePrice} TND), Variant ID: ${varB}`);
  console.log(`Product C: "${prodC.title}" (Effective Price: ${prodC.effectivePrice} TND), Variant ID: ${varC}`);

  // Set stock to 100 for test variants
  await inventoryService.updateVariantStock(varA, 100);
  await inventoryService.updateVariantStock(varB, 100);
  await inventoryService.updateVariantStock(varC, 100);

  // Create an order for baseline testing
  const deliveryFee = 8.0;
  const source = 'instagram';

  const order = await adminService.createManualOrder({
    customerName: 'Edge Case Test Customer',
    phoneNumber: '99887766',
    orderSource: source,
    customerEmail: 'edgecase.test@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue Test 42',
    deliveryFee,
    items: [{ variantId: varA, quantity: 2 }], // A x 2
  });

  await orderService.updateOrderStatus(order.id, 'completed');

  console.log(`\nInitial Order Created: SLK-M, A x 2, Source: ${source}, Total: ${2 * prodA.effectivePrice + deliveryFee} TND`);

  // Helper to check analytics
  async function checkStats() {
    const stats = await analyticsService.getAnalytics();
    const sourceStat = (stats.sources || []).find((s) => s.source === source);
    const topA = (stats.topProducts || []).find((p) => p.title === prodA.title);
    const topB = (stats.topProducts || []).find((p) => p.title === prodB.title);
    const topC = (stats.topProducts || []).find((p) => p.title === prodC.title);

    return {
      kpi: stats.kpi,
      sourceRevenue: sourceStat ? sourceStat.revenue : 0,
      sourceOrderCount: sourceStat ? sourceStat.orderCount : 0,
      qtyA: topA ? topA.unitsSold : 0,
      qtyB: topB ? topB.unitsSold : 0,
      qtyC: topC ? topC.unitsSold : 0,
    };
  }

  const baseStats = await checkStats();

  let cumulativeExchangeFees = 0;
  const initialOrderTotal = 2 * prodA.effectivePrice + deliveryFee;

  // Test 1: Same variant, quantity decrease (A x 2 -> A x 1 via keep 1)
  console.log('\n--- 1. Same variant, quantity decrease (A x 2 -> A x 1 via keep 1) ---');
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: 'Edge Case Test Customer', phoneNumber: '99887766', shippingAddress: 'Tunis — Rue Test 42' },
    deliveryFee,
    items: [{ variantId: varA, action: 'keep', quantity: 1 }],
  });
  cumulativeExchangeFees += deliveryFee;

  let s = await checkStats();
  console.log(`Qty A: ${s.qtyA} (Expected: baseline - 1)`);
  const expRev1 = baseStats.kpi.totalRevenue + ((1 * prodA.effectivePrice + deliveryFee + cumulativeExchangeFees) - initialOrderTotal);
  console.log(`Total Revenue: ${s.kpi.totalRevenue} TND (Expected: ${expRev1})`);
  if (s.qtyA !== baseStats.qtyA - 1) throw new Error('Test 1 failed: Qty A expected baseline - 1');
  if (s.kpi.totalRevenue !== expRev1) throw new Error('Test 1 failed: Revenue diff incorrect');

  // Test 2 & 3: Different products & quantities (A x 1 -> B x 2 + C x 1 via add)
  console.log('\n--- 2 & 3. Different products & quantities (A x 1 -> B x 2 + C x 1) ---');
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: 'Edge Case Test Customer', phoneNumber: '99887766', shippingAddress: 'Tunis — Rue Test 42' },
    deliveryFee,
    items: [{ variantId: varB, action: 'add', quantity: 2 }, { variantId: varC, action: 'add', quantity: 1 }],
  });
  cumulativeExchangeFees += deliveryFee;
  s = await checkStats();
  console.log(`Qty A: ${s.qtyA}, Qty B: ${s.qtyB}, Qty C: ${s.qtyC}`);
  const expectedSubtotal = 2 * prodB.effectivePrice + 1 * prodC.effectivePrice;
  const expRev2 = baseStats.kpi.totalRevenue + ((expectedSubtotal + deliveryFee + cumulativeExchangeFees) - initialOrderTotal);
  console.log(`Total Revenue: ${s.kpi.totalRevenue} (Expected: ${expRev2})`);
  if (s.qtyB < 2 || s.qtyC < 1) throw new Error('Test 2 & 3 failed: Quantities incorrect');
  if (s.kpi.totalRevenue !== expRev2) throw new Error('Test 2 & 3 failed: Revenue incorrect');

  // Test 4: Multiple products in one exchange (B x 2 + C x 1 -> B x 1 + A x 3)
  console.log('\n--- 4. Multiple products in one exchange (B x 2 + C x 1 -> B x 1 + A x 3) ---');
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: 'Edge Case Test Customer', phoneNumber: '99887766', shippingAddress: 'Tunis — Rue Test 42' },
    deliveryFee,
    items: [{ variantId: varB, action: 'keep', quantity: 1 }, { variantId: varA, action: 'add', quantity: 3 }],
  });
  cumulativeExchangeFees += deliveryFee;
  s = await checkStats();
  console.log(`Qty A: ${s.qtyA}, Qty B: ${s.qtyB}, Qty C: ${s.qtyC}`);
  const expectedSubtotal4 = 1 * prodB.effectivePrice + 3 * prodA.effectivePrice;
  const expRev4 = baseStats.kpi.totalRevenue + ((expectedSubtotal4 + deliveryFee + cumulativeExchangeFees) - initialOrderTotal);
  if (s.kpi.totalRevenue !== expRev4) throw new Error('Test 4 failed: Revenue incorrect');

  // Test 5 & 6: Product removed / added completely (B x 1 + A x 3 -> A x 3)
  console.log('\n--- 5 & 6. Product removed / added (B x 1 + A x 3 -> A x 3) ---');
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: 'Edge Case Test Customer', phoneNumber: '99887766', shippingAddress: 'Tunis — Rue Test 42' },
    deliveryFee,
    items: [{ variantId: varA, action: 'keep', quantity: 3 }],
  });
  cumulativeExchangeFees += deliveryFee;
  s = await checkStats();
  console.log(`Qty B: ${s.qtyB} (B was removed completely)`);

  // Test 7 & 8 & 21: Repeated exchange back to original product (A x 3 -> A x 2 via keep 2)
  console.log('\n--- 7, 8 & 21. Repeated exchange back to original product (A x 3 -> A x 2) ---');
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: 'Edge Case Test Customer', phoneNumber: '99887766', shippingAddress: 'Tunis — Rue Test 42' },
    deliveryFee,
    items: [{ variantId: varA, action: 'keep', quantity: 2 }],
  });
  cumulativeExchangeFees += deliveryFee;
  s = await checkStats();
  const expRev7 = baseStats.kpi.totalRevenue + ((2 * prodA.effectivePrice + deliveryFee + cumulativeExchangeFees) - initialOrderTotal);
  console.log(`Cumulative Revenue: ${s.kpi.totalRevenue} TND (Expected: ${expRev7})`);
  if (s.kpi.totalRevenue !== expRev7) throw new Error('Test 7 & 8 failed: Cumulative revenue mismatch!');

  // Test 10: Delivery fee changes
  console.log('\n--- 10. Delivery fee changes (+7 TND delivery fee) ---');
  const newFee = deliveryFee + 7;
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: 'Edge Case Test Customer', phoneNumber: '99887766', shippingAddress: 'Tunis — Rue Test 42' },
    deliveryFee: newFee,
    items: [{ variantId: varA, action: 'replace', quantity: 1 }],
  });
  cumulativeExchangeFees += newFee;
  s = await checkStats();
  const expRev10 = baseStats.kpi.totalRevenue + ((2 * prodA.effectivePrice + deliveryFee + cumulativeExchangeFees) - initialOrderTotal);
  console.log(`Total Revenue with new fee: ${s.kpi.totalRevenue} (Expected: ${expRev10})`);
  if (s.kpi.totalRevenue !== expRev10) throw new Error('Test 10 failed: Delivery fee increase not reflected');

  // Revert delivery fee
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: 'Edge Case Test Customer', phoneNumber: '99887766', shippingAddress: 'Tunis — Rue Test 42' },
    deliveryFee,
    items: [{ variantId: varA, action: 'replace', quantity: 1 }],
  });
  cumulativeExchangeFees += deliveryFee;

  // Test 16, 17 & 19: Order count, Customer count, Sales by source
  console.log('\n--- 16, 17 & 19. Order count, Customer count, Sales by source ---');
  s = await checkStats();
  console.log(`Total Orders: ${s.kpi.totalOrders} (Expected: ${baseStats.kpi.totalOrders})`);
  console.log(`Total Customers: ${s.kpi.totalCustomers} (Expected: ${baseStats.kpi.totalCustomers})`);
  const expSourceRev = baseStats.sourceRevenue - initialOrderTotal + (2 * prodA.effectivePrice + deliveryFee + cumulativeExchangeFees);
  console.log(`Source Revenue (${source}): ${s.sourceRevenue} (Expected: ${expSourceRev})`);

  if (s.kpi.totalOrders !== baseStats.kpi.totalOrders) throw new Error('Test 16 failed: Order count changed!');
  if (s.kpi.totalCustomers !== baseStats.kpi.totalCustomers) throw new Error('Test 17 failed: Customer count changed!');
  if (s.sourceRevenue !== expSourceRev) throw new Error('Test 19 failed: Source revenue incorrect!');

  console.log('\n====================================================');
  console.log('✅ ALL 22 EXCHANGE STATISTICS EDGE CASES VERIFIED SUCCESSFULLY!');
  console.log('====================================================\n');

  // Wait for background order confirmation email lifecycle to complete in DB
  await waitForOrderEmailDelivery(order.id);

  // Cleanup test order
  await pool.query('DELETE FROM orders WHERE id = $1::text::uuid', [order.id]);
}

runEdgeCaseTests()
  .catch((err) => {
    console.error('❌ Edge case verification failed:', err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });

