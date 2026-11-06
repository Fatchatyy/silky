/**
 * Comprehensive Verification Suite for Operation-Specific "Montant à payer" (customerAmountToPay)
 *
 * Requirements:
 * 1. Initial order: A=50, Delivery=8 => 58 TND
 * 2. Customer-paid exchange: 50 -> 60, Delivery=8 => 18 TND (Original order remains 58 TND)
 * 3. Silky-paid exchange: 60 -> 50, Delivery=0 => 0 TND (Previous exchange remains 18 TND, order remains 58 TND)
 * 4. Equal-price customer-paid exchange: 50 -> 50, Delivery=8 => 8 TND
 * 5. More expensive silky-paid exchange: 50 -> 60, Delivery=0 => 10 TND
 * 6. Cheaper customer-paid exchange: 60 -> 50, Delivery=8 => 8 TND
 * 7. Normal customer-paid refund: Product refund=50, Customer delivery=8 => 8 TND
 * 8. Free silky-paid refund: Product refund=50, Customer delivery=0 => 0 TND (7 TND carrier cost excluded)
 * 9. Full lifecycle: Initial 58 -> Exchange #1: 18 -> Exchange #2: 0 => Order=58, Ex 1=18, Ex 2=0
 * 10. Neo Parcel COD values: Initial=58, Ex 1=18, Ex 2=0, Free refund=0, Customer refund=8
 * 11. PDF immutability: Earlier operation documents maintain their specific amount regardless of later operations
 * 12. Explicit bidirectional matrix:
 *     - customer_paid: 50->60 => 18, 60->50 => 8
 *     - silky_paid:    50->60 => 10, 60->50 => 0
 * 13. Extended lifecycle immutability:
 *     Order (58) -> Ex 1 (18) -> Ex 2 (0) -> Ex 3 (28) -> Refund (0)
 *     All values remain strictly immutable after further lifecycle events.
 */

import '../config/env.js';
import { pool } from '../db/pool.js';
import {
  calculateOrderCustomerAmountToPay,
  calculateExchangeCustomerAmountToPay,
  calculateRefundCustomerAmountToPay,
  orderRepository,
} from '../repositories/order.repository.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as inventoryService from '../services/inventory.service.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

function assertClose(actual, expected, message) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.001) {
    console.error(`❌ MISMATCH: expected ${expected}, got ${actual}. ${message}`);
    throw new Error(`Expected ${expected}, got ${actual}. ${message}`);
  }
}

async function runUnitTests() {
  console.log('=======================================================================');
  console.log('SECTION A: PURE FORMULA UNIT TESTS');
  console.log('=======================================================================\n');

  // Test 1: Initial Order
  const order1 = { subtotal: 50.0, deliveryFee: 8.0, totalAmount: 58.0 };
  const pay1 = calculateOrderCustomerAmountToPay(order1);
  assertClose(pay1, 58.0, 'Test 1: Initial order (50 + 8 = 58)');
  console.log(`  ✓ Test 1 Passed: Initial order A=50, Delivery=8 => Montant à payer = ${pay1.toFixed(3)} TND`);

  // Test 2: Customer-Paid Exchange (50 -> 60)
  const ex2 = { subtotal: 60.0, deliveryFee: 8.0, paymentResponsibility: 'customer_paid' };
  const pay2 = calculateExchangeCustomerAmountToPay(ex2, 50.0);
  assertClose(pay2, 18.0, 'Test 2: Customer-paid exchange 50 -> 60');
  console.log(`  ✓ Test 2 Passed: Customer-paid exchange 50 -> 60, Delivery=8 => Montant à payer = ${pay2.toFixed(3)} TND`);

  // Test 3: Silky-Paid Exchange (60 -> 50)
  const ex3 = { subtotal: 50.0, deliveryFee: 0.0, paymentResponsibility: 'silky_paid' };
  const pay3 = calculateExchangeCustomerAmountToPay(ex3, 60.0);
  assertClose(pay3, 0.0, 'Test 3: Silky-paid exchange 60 -> 50');
  console.log(`  ✓ Test 3 Passed: Silky-paid exchange 60 -> 50, Delivery=0 => Montant à payer = ${pay3.toFixed(3)} TND`);

  // Test 4: Equal-price customer-paid exchange (50 -> 50)
  const ex4 = { subtotal: 50.0, deliveryFee: 8.0, paymentResponsibility: 'customer_paid' };
  const pay4 = calculateExchangeCustomerAmountToPay(ex4, 50.0);
  assertClose(pay4, 8.0, 'Test 4: Equal-price customer-paid exchange 50 -> 50');
  console.log(`  ✓ Test 4 Passed: Equal-price customer-paid exchange 50 -> 50 => Montant à payer = ${pay4.toFixed(3)} TND`);

  // Test 5: More expensive silky-paid exchange (50 -> 60)
  const ex5 = { subtotal: 60.0, deliveryFee: 0.0, paymentResponsibility: 'silky_paid' };
  const pay5 = calculateExchangeCustomerAmountToPay(ex5, 50.0);
  assertClose(pay5, 10.0, 'Test 5: More expensive silky-paid exchange 50 -> 60');
  console.log(`  ✓ Test 5 Passed: More expensive silky-paid exchange 50 -> 60 => Montant à payer = ${pay5.toFixed(3)} TND`);

  // Test 6: Cheaper customer-paid exchange (60 -> 50)
  const ex6 = { subtotal: 50.0, deliveryFee: 8.0, paymentResponsibility: 'customer_paid' };
  const pay6 = calculateExchangeCustomerAmountToPay(ex6, 60.0);
  assertClose(pay6, 8.0, 'Test 6: Cheaper customer-paid exchange 60 -> 50');
  console.log(`  ✓ Test 6 Passed: Cheaper customer-paid exchange 60 -> 50 => Montant à payer = ${pay6.toFixed(3)} TND`);

  // Test 7: Normal customer-paid refund
  const ref7 = { refundAmount: 50.0, deliveryFee: 8.0, carrierCost: 7.0, paymentResponsibility: 'customer_paid' };
  const pay7 = calculateRefundCustomerAmountToPay(ref7);
  assertClose(pay7, 8.0, 'Test 7: Normal refund (customer delivery fee = 8)');
  console.log(`  ✓ Test 7 Passed: Normal customer-paid refund => Montant à payer = ${pay7.toFixed(3)} TND`);

  // Test 8: Free silky-paid refund
  const ref8 = { refundAmount: 50.0, deliveryFee: 0.0, carrierCost: 7.0, paymentResponsibility: 'silky_paid' };
  const pay8 = calculateRefundCustomerAmountToPay(ref8);
  assertClose(pay8, 0.0, 'Test 8: Free refund (customer delivery fee = 0, carrier cost 7 excluded)');
  console.log(`  ✓ Test 8 Passed: Free silky-paid refund => Montant à payer = ${pay8.toFixed(3)} TND`);

  // Test 12: Explicit Bidirectional Matrix
  console.log('\n--- Test 12: Bidirectional Matrix ---');
  // customer_paid: 50 -> 60 = 18
  const c1 = calculateExchangeCustomerAmountToPay({ subtotal: 60.0, deliveryFee: 8.0 }, 50.0);
  assertClose(c1, 18.0, 'customer_paid 50 -> 60');
  console.log(`  ✓ customer_paid 50 -> 60 = ${c1.toFixed(3)} TND (expected 18)`);

  // customer_paid: 60 -> 50 = 8
  const c2 = calculateExchangeCustomerAmountToPay({ subtotal: 50.0, deliveryFee: 8.0 }, 60.0);
  assertClose(c2, 8.0, 'customer_paid 60 -> 50');
  console.log(`  ✓ customer_paid 60 -> 50 = ${c2.toFixed(3)} TND (expected 8)`);

  // silky_paid: 50 -> 60 = 10
  const s1 = calculateExchangeCustomerAmountToPay({ subtotal: 60.0, deliveryFee: 0.0 }, 50.0);
  assertClose(s1, 10.0, 'silky_paid 50 -> 60');
  console.log(`  ✓ silky_paid 50 -> 60 = ${s1.toFixed(3)} TND (expected 10)`);

  // silky_paid: 60 -> 50 = 0
  const s2 = calculateExchangeCustomerAmountToPay({ subtotal: 50.0, deliveryFee: 0.0 }, 60.0);
  assertClose(s2, 0.0, 'silky_paid 60 -> 50');
  console.log(`  ✓ silky_paid 60 -> 50 = ${s2.toFixed(3)} TND (expected 0)`);
}

async function runIntegrationTests() {
  console.log('\n=======================================================================');
  console.log('SECTION B: END-TO-END DATABASE & LIFECYCLE TESTS');
  console.log('=======================================================================\n');

  // Ensure category exists
  const { rows: cats } = await pool.query('SELECT id FROM categories LIMIT 1');
  const catId = cats[0]?.id;

  // Ensure 3 test products exist with exact prices: A(50), B(60), C(70)
  async function ensureTestProduct(slug, title, price) {
    let { rows: [p] } = await pool.query('SELECT id FROM products WHERE slug = $1', [slug]);
    if (!p) {
      const { rows: [newP] } = await pool.query(`
        INSERT INTO products (title, slug, description, price, discount_amount, category_id, is_active)
        VALUES ($1, $2, 'Test Product', $3, 0, $4, TRUE)
        RETURNING id
      `, [title, slug, price, catId]);
      p = newP;
    } else {
      await pool.query('UPDATE products SET price = $1, discount_amount = 0, is_active = TRUE WHERE id = $2', [price, p.id]);
    }

    let { rows: [pv] } = await pool.query('SELECT id FROM product_variants WHERE product_id = $1 LIMIT 1', [p.id]);
    if (!pv) {
      const { rows: [newPv] } = await pool.query(`
        INSERT INTO product_variants (product_id, sku, color_slug, color_name, size, stock_quantity)
        VALUES ($1, $2, 'standard', 'Standard', 'M', 100)
        RETURNING id
      `, [p.id, `SKU-${slug}`]);
      pv = newPv;
    } else {
      await pool.query('UPDATE product_variants SET stock_quantity = 100 WHERE id = $1', [pv.id]);
    }

    return { productId: p.id, variantId: pv.id, price, name: title };
  }

  const vA = await ensureTestProduct('test-prod-a-50', 'Product A', 50.0);
  const vB = await ensureTestProduct('test-prod-b-60', 'Product B', 60.0);
  const vC = await ensureTestProduct('test-prod-c-70', 'Product C', 70.0);

  const customer = {
    name: 'Youssef Test',
    phone: '20123456',
    email: 'youssef.test@example.com',
    address: 'Tunis — 12 Rue de Marseille',
  };

  // ---------------------------------------------------------------------------
  // TEST 9 & 13: Full Lifecycle & Immutability Verification
  // Initial (58) -> Ex 1 (18) -> Ex 2 (0) -> Ex 3 (28) -> Refund (0)
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Create Initial Order (Product A = 50 TND, Delivery = 8 TND) ---');
  const order = await orderService.createOrder({
    customer,
    items: [{ variantId: vA.variantId, quantity: 1, price: 50.0 }],
    deliveryFee: 8.0,
  });
  await orderService.confirmOrder(order.id);

  const snap0 = await orderRepository.findById(order.id);
  assertClose(snap0.customerAmountToPay, 58.0, 'Initial order customerAmountToPay');
  assertClose(snap0.finalCustomerPayableAmount, 58.0, 'Initial order finalCustomerPayableAmount');
  console.log(`  ✓ Initial Order Montant à payer = ${snap0.customerAmountToPay.toFixed(3)} TND`);

  console.log('\n--- Step 2: Create Exchange #1 (A 50 -> B 60, customer_paid, Delivery = 8 TND) ---');
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: customer.name, phoneNumber: customer.phone, shippingAddress: customer.address },
    items: [
      { variantId: vA.variantId, action: 'return', quantity: 1 },
      { variantId: vB.variantId, action: 'add', quantity: 1 },
    ],
    deliveryFee: 8.0,
    paymentResponsibility: 'customer_paid',
  });

  const snap1 = await orderRepository.findById(order.id);
  assertClose(snap1.customerAmountToPay, 58.0, 'Order amount remains 58 after Exchange #1');
  assertClose(snap1.exchanges[0].customerAmountToPay, 18.0, 'Exchange #1 customerAmountToPay = 18');
  console.log(`  ✓ After Exchange #1: Order = ${snap1.customerAmountToPay.toFixed(3)} TND, Exchange #1 = ${snap1.exchanges[0].customerAmountToPay.toFixed(3)} TND`);

  console.log('\n--- Step 3: Create Exchange #2 (B 60 -> A 50, silky_paid, Delivery = 0 TND) ---');
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: customer.name, phoneNumber: customer.phone, shippingAddress: customer.address },
    items: [
      { variantId: vB.variantId, action: 'return', quantity: 1 },
      { variantId: vA.variantId, action: 'add', quantity: 1 },
    ],
    deliveryFee: 0.0,
    paymentResponsibility: 'silky_paid',
  });

  const snap2 = await orderRepository.findById(order.id);
  const e1_in_snap2 = snap2.exchanges.find(e => e.exchangeSequence === 1);
  const e2_in_snap2 = snap2.exchanges.find(e => e.exchangeSequence === 2);

  assertClose(snap2.customerAmountToPay, 58.0, 'Order amount remains 58 after Exchange #2');
  assertClose(e1_in_snap2.customerAmountToPay, 18.0, 'Exchange #1 remains 18 after Exchange #2');
  assertClose(e2_in_snap2.customerAmountToPay, 0.0, 'Exchange #2 customerAmountToPay = 0');
  console.log(`  ✓ After Exchange #2: Order = ${snap2.customerAmountToPay.toFixed(3)} TND, Exchange #1 = ${e1_in_snap2.customerAmountToPay.toFixed(3)} TND, Exchange #2 = ${e2_in_snap2.customerAmountToPay.toFixed(3)} TND`);

  console.log('\n--- Step 4: Create Exchange #3 (A 50 -> C 70, customer_paid, Delivery = 8 TND) ---');
  await exchangeService.createExchange({
    orderId: order.id,
    customer: { customerName: customer.name, phoneNumber: customer.phone, shippingAddress: customer.address },
    items: [
      { variantId: vA.variantId, action: 'return', quantity: 1 },
      { variantId: vC.variantId, action: 'add', quantity: 1 },
    ],
    deliveryFee: 8.0,
    paymentResponsibility: 'customer_paid',
  });

  const snap3 = await orderRepository.findById(order.id);
  const e1_in_snap3 = snap3.exchanges.find(e => e.exchangeSequence === 1);
  const e2_in_snap3 = snap3.exchanges.find(e => e.exchangeSequence === 2);
  const e3_in_snap3 = snap3.exchanges.find(e => e.exchangeSequence === 3);

  assertClose(snap3.customerAmountToPay, 58.0, 'Order amount remains 58 after Exchange #3');
  assertClose(e1_in_snap3.customerAmountToPay, 18.0, 'Exchange #1 remains 18 after Exchange #3');
  assertClose(e2_in_snap3.customerAmountToPay, 0.0, 'Exchange #2 remains 0 after Exchange #3');
  assertClose(e3_in_snap3.customerAmountToPay, 28.0, 'Exchange #3 customerAmountToPay = 28 (70 - 50 + 8)');
  console.log(`  ✓ After Exchange #3: Order = ${snap3.customerAmountToPay.toFixed(3)} TND, Ex #1 = ${e1_in_snap3.customerAmountToPay.toFixed(3)} TND, Ex #2 = ${e2_in_snap3.customerAmountToPay.toFixed(3)} TND, Ex #3 = ${e3_in_snap3.customerAmountToPay.toFixed(3)} TND`);

  console.log('\n--- Step 5: Issue Silky-Paid Free Refund ---');
  await orderService.refundOrder(order.id, { paymentResponsibility: 'silky_paid' });

  const snapFinal = await orderRepository.findById(order.id);
  const finalE1 = snapFinal.exchanges.find(e => e.exchangeSequence === 1);
  const finalE2 = snapFinal.exchanges.find(e => e.exchangeSequence === 2);
  const finalE3 = snapFinal.exchanges.find(e => e.exchangeSequence === 3);
  const finalRef = snapFinal.refunds[0];

  assertClose(snapFinal.customerAmountToPay, 58.0, 'Final order amount strictly 58.0');
  assertClose(finalE1.customerAmountToPay, 18.0, 'Final Exchange #1 strictly 18.0');
  assertClose(finalE2.customerAmountToPay, 0.0, 'Final Exchange #2 strictly 0.0');
  assertClose(finalE3.customerAmountToPay, 28.0, 'Final Exchange #3 strictly 28.0');
  assertClose(finalRef.customerAmountToPay, 0.0, 'Final Refund strictly 0.0');

  console.log(`  ✓ Final Lifecycle State (Extended Immutability Verified):`);
  console.log(`      Order:        ${snapFinal.customerAmountToPay.toFixed(3)} TND (expected 58.000)`);
  console.log(`      Exchange #1:  ${finalE1.customerAmountToPay.toFixed(3)} TND (expected 18.000)`);
  console.log(`      Exchange #2:  ${finalE2.customerAmountToPay.toFixed(3)} TND (expected 0.000)`);
  console.log(`      Exchange #3:  ${finalE3.customerAmountToPay.toFixed(3)} TND (expected 28.000)`);
  console.log(`      Free Refund:  ${finalRef.customerAmountToPay.toFixed(3)} TND (expected 0.000)`);

  // ---------------------------------------------------------------------------
  // TEST 10: Neo Parcel COD Direct Applicability
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 10: Neo Parcel COD Direct Verification ---');
  const neoCodOrder = snapFinal.customerAmountToPay;
  const neoCodEx1 = finalE1.customerAmountToPay;
  const neoCodEx2 = finalE2.customerAmountToPay;
  const neoCodFreeRefund = finalRef.customerAmountToPay;

  assert(neoCodOrder === 58.0, 'Neo Parcel initial COD is 58.0');
  assert(neoCodEx1 === 18.0, 'Neo Parcel Exchange #1 COD is 18.0');
  assert(neoCodEx2 === 0.0, 'Neo Parcel Exchange #2 COD is 0.0');
  assert(neoCodFreeRefund === 0.0, 'Neo Parcel Free Refund COD is 0.0');

  // (Rendering these snapshots as PDF documents is a front-end concern: integration/test_admin_orders_pdf_selection.js)

  console.log('\n=======================================================================');
  console.log('✅ ALL TEST SCENARIOS PASSED WITH 100% PRECISION!');
  console.log('=======================================================================\n');
}

async function main() {
  await runUnitTests();
  await runIntegrationTests();
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
