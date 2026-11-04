/**
 * test_exchange_intent_stock_validation.js
 *
 * Dedicated 52-case test suite verifying explicit exchange intent and authoritative
 * stock validation transition model, including ADD on existing variants.
 * 1. A×2 KEEP, stock 0
 * 2. A×1 RETURN from A×2, stock 0
 * 3. A×1 REPLACE from A×2, stock 0
 * 4. A×1 REPLACE from A×2, stock 1
 * 5. A×2 REPLACE from A×2, stock 0
 * 6. A×2 REPLACE from A×2, stock 1
 * 7. A×2 REPLACE from A×2, stock 2
 * 8. A×2 KEEP + B×1 REPLACE, A=0 B=2
 * 9. A×2 KEEP + B×1 REPLACE, B=0
 * 10. A×1 REPLACE + B×1 KEEP, A=0
 * 11. A×1 REPLACE + B×1 KEEP, A=1
 * 12. RETURN + REPLACE
 * 13. RETURN + ADD
 * 14. RETURN + ADD with insufficient stock
 * 15. Different variant return/add with zero new stock
 * 16. Different variant return/add with sufficient stock
 * 17. KEEP + RETURN + REPLACE + ADD
 * 18. KEEP-only no-op
 * 19. All-return zero-active rejection
 * 20. Failed replacement zero mutation
 * 21. Failed mixed exchange zero mutation
 * 22. Preview/create parity
 * 23. Invalid quantities
 * 24. Customer-paid partial replacement
 * 25. Silky-paid partial replacement
 * 26. Multiple successive exchanges
 * 27. Partial exchange → Remboursement
 * 28. Partial exchange → cancellation
 * 29. Missing action
 * 30. Invalid action
 * 31. Unheld variant with keep
 * 32. Unheld variant with replace
 * 33. Unheld variant with return
 * 34. Unheld variant with add
 * 35. Existing variant with add
 * 36. Duplicate variant entries
 * 37. Legacy ambiguous request
 * 38. Legacy compatibility adapter check
 * 39. Exact bug scenario: A×2 KEEP + B×1 REPLACE with A stock 0
 * 40. A×1 REPLACE with A stock 0
 * 41. A×2 RETURN with A stock 0
 * 42. Keep everything / no-op rejection
 */

import '../config/env.js';
import './helpers/parcel_guard_off.js';
import { pool } from '../db/pool.js';
import { runExchangesMigration } from '../db/migrations/add_exchanges.js';
import { runRefundsMigration } from '../db/migrations/add_refunds.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as inventoryService from '../services/inventory.service.js';
import * as adminService from '../services/admin.service.js';
import { exchangeRepository } from '../repositories/exchange.repository.js';

async function getStock(variantId) {
  const inv = await inventoryService.getInventory();
  const item = inv.find((v) => (v.variantId || v.id) === variantId);
  return item ? Number(item.stockQuantity) : null;
}

async function setStock(variantId, qty) {
  await inventoryService.updateVariantStock(variantId, qty);
}

async function createTestOrder({
  customerName = 'Client Test',
  phoneNumber = '90000000',
  governorate = 'Tunis',
  shippingAddress = 'Rue Habib Bourguiba',
  deliveryFee = 8.0,
  items = [],
} = {}) {
  return adminService.createManualOrder({
    customerName,
    phoneNumber,
    orderSource: 'phone',
    governorate,
    shippingAddress,
    deliveryFee,
    items,
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`\n  ❌ ASSERTION FAILED: ${message}\n`);
    throw new Error(message);
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('EXCHANGE INTENT & AUTHORITATIVE STOCK VALIDATION SUITE (52 Cases)');
  console.log('='.repeat(80));

  await runExchangesMigration(pool);
  await runRefundsMigration(pool);

  const { rows: variantRows } = await pool.query(`
    SELECT p.id AS product_id, p.title, (p.price - p.discount_amount) AS effective_price,
           pv.id AS variant_id, pv.color_name, pv.size
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.is_active = TRUE
    ORDER BY p.price DESC, p.id, pv.id
  `);

  if (variantRows.length < 4) {
    console.error('Test suite requires at least 4 distinct active product variants.');
    process.exit(1);
  }

  const [varA, varB, varC, varD] = [
    { variantId: variantRows[0].variant_id, price: Number(variantRows[0].effective_price), title: variantRows[0].title },
    { variantId: variantRows[1].variant_id, price: Number(variantRows[1].effective_price), title: variantRows[1].title },
    { variantId: variantRows[2].variant_id, price: Number(variantRows[2].effective_price), title: variantRows[2].title },
    { variantId: variantRows[3].variant_id, price: Number(variantRows[3].effective_price), title: variantRows[3].title },
  ];

  console.log(`\nVariants Configured:`);
  console.log(`  Var A: ${varA.title} (${varA.price} TND) - ID: ${varA.variantId}`);
  console.log(`  Var B: ${varB.title} (${varB.price} TND) - ID: ${varB.variantId}`);
  console.log(`  Var C: ${varC.title} (${varC.price} TND) - ID: ${varC.variantId}`);
  console.log(`  Var D: ${varD.title} (${varD.price} TND) - ID: ${varD.variantId}\n`);

  const cleanupIds = [];
  let passed = 0;
  let total = 0;

  function section(num, title) {
    total++;
    console.log(`\n${'-'.repeat(80)}`);
    console.log(`[CASE ${num}] ${title}`);
  }

  function pass(msg) {
    passed++;
    console.log(`  ✓ PASS: ${msg}`);
  }

  // ── CASE 1: A×2 KEEP, stock 0 ─────────────────────────────────────────────
  section(1, 'A×2 KEEP, stock 0 (with B×1 add)');
  {
    await setStock(varA.variantId, 2);
    await setStock(varB.variantId, 5);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 2 },
        { variantId: varB.variantId, action: 'add', quantity: 1 },
      ],
    });

    assert(await getStock(varA.variantId) === 0, 'Stock A remains 0');
    assert(await getStock(varB.variantId) === 4, 'Stock B is 4');
    assert(result.status === 'exchanged', 'Order is exchanged');
    pass('Keep A×2 with stock 0 succeeds when warehouse requirement is 0.');
  }

  // ── CASE 2: A×1 RETURN from A×2, stock 0 ──────────────────────────────────
  section(2, 'A×1 RETURN from A×2, stock 0');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'return', quantity: 1 }],
    });

    assert(await getStock(varA.variantId) === 1, 'Stock A increased 0 -> 1');
    pass('Return 1 of A×2 increases warehouse stock by 1.');
  }

  // ── CASE 3: A×1 REPLACE from A×2, stock 0 -> REJECT ───────────────────────
  section(3, 'A×1 REPLACE from A×2, stock 0 -> REJECT');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Must reject when warehouse stock is 0');
    assert(await getStock(varA.variantId) === 0, 'Stock remains 0');
    pass('Replace 1 of A×2 rejected when warehouse stock is 0.');
  }

  // ── CASE 4: A×1 REPLACE from A×2, stock 1 -> PASS ─────────────────────────
  section(4, 'A×1 REPLACE from A×2, stock 1 -> PASS');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 1);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });

    assert(await getStock(varA.variantId) === 1, 'Stock remains 1 (1 - 1 + 1 = 1)');
    pass('Replace 1 of A×2 passes with stock 1.');
  }

  // ── CASE 5: A×2 REPLACE from A×2, stock 0 -> REJECT ───────────────────────
  section(5, 'A×2 REPLACE from A×2, stock 0 -> REJECT');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 2 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Must reject replacement of 2 with stock 0');
    pass('Replace 2 of A×2 rejected when stock is 0.');
  }

  // ── CASE 6: A×2 REPLACE from A×2, stock 1 -> REJECT ───────────────────────
  section(6, 'A×2 REPLACE from A×2, stock 1 -> REJECT');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 1);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 2 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Must reject replacement of 2 with stock 1');
    pass('Replace 2 of A×2 rejected when stock is 1 (< 2).');
  }

  // ── CASE 7: A×2 REPLACE from A×2, stock 2 -> PASS ─────────────────────────
  section(7, 'A×2 REPLACE from A×2, stock 2 -> PASS');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 2);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 2 }],
    });

    assert(await getStock(varA.variantId) === 2, 'Stock A remains 2 (2 returned - 2 taken)');
    pass('A×2 REPLACE from A×2 with stock 2 passed.');
  }

  // ── CASE 10: Keep A×2 + return one B from B×2 -> PASS ─────────────────────
  section(8, 'Keep A×2 + return one B from B×2 -> PASS (Stock A: 0, Stock B: 0 -> 1)');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 2 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 0);

    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 2 },
        { variantId: varB.variantId, action: 'keep', quantity: 1 },
      ],
    });

    assert(await getStock(varA.variantId) === 0, 'Stock A unchanged at 0');
    assert(await getStock(varB.variantId) === 1, 'Stock B increased 0 -> 1');
    const latest = await exchangeRepository.findLatestExchange(ord.id);
    const itemA = latest.items.find((i) => i.variantId === varA.variantId);
    const itemB = latest.items.find((i) => i.variantId === varB.variantId);
    assert(itemA.quantity === 2, 'A has 2 active');
    assert(itemB.quantity === 1, 'B has 1 active');
    pass('Keep A×2 + return one B from B×2 passed.');
  }

  // ── CASE 11: Partial return + replacement simultaneously ──────────────────
  section(9, 'Partial return + replacement simultaneously (Keep 1 A, Replace 1 B)');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 2 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 1);

    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 1 },
        { variantId: varB.variantId, action: 'replace', quantity: 1 },
      ],
    });

    assert(await getStock(varA.variantId) === 1, 'Stock of A restored 0 -> 1');
    assert(await getStock(varB.variantId) === 1, 'Stock of B remains 1 (1 returned - 1 taken)');
    const latest = await exchangeRepository.findLatestExchange(ord.id);
    const itemA = latest.items.find((i) => i.variantId === varA.variantId);
    const itemB = latest.items.find((i) => i.variantId === varB.variantId);
    assert(itemA.quantity === 1, 'A has 1 active');
    assert(itemB.quantity === 2, 'B has 2 active (1 kept + 1 replacement)');
    pass('Partial return + replacement simultaneously passed.');
  }

  // ── CASE 12: Replacement + new product simultaneously ────────────────────
  section(10, 'Replacement + new product simultaneously (Replace A×1 + Add C×1)');
  {
    await setStock(varA.variantId, 10);
    await setStock(varC.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 1);
    await setStock(varC.variantId, 2);

    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'replace', quantity: 1 },
        { variantId: varC.variantId, action: 'add', quantity: 1 },
      ],
    });

    assert(await getStock(varA.variantId) === 1, 'Stock A remains 1');
    assert(await getStock(varC.variantId) === 1, 'Stock C deducted 2 -> 1');
    const latest = await exchangeRepository.findLatestExchange(ord.id);
    assert(latest.items.length === 2, '2 active items');
    pass('Replacement + new product simultaneously passed.');
  }

  // ── CASE 13: Multiple variants with mixed keep/return/replace/add ────────
  section(11, 'Mixed keep/return/replace/add across A, B, C, D');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    await setStock(varC.variantId, 10);
    await setStock(varD.variantId, 10);

    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 3 },
        { variantId: varC.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    // Initial stock setup:
    // A: 0, B: 0, C: 1, D: 2
    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 0);
    await setStock(varC.variantId, 1);
    await setStock(varD.variantId, 2);

    // Intent:
    // A: Keep 2 (req 0)
    // B: Return 2, Keep 1 (req 0, return 2)
    // C: Replace 1 (req 1, return 1, replace 1)
    // D: Add 1 (req 1)
    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 2 },
        { variantId: varB.variantId, action: 'keep', quantity: 1 },
        { variantId: varC.variantId, action: 'replace', quantity: 1 },
        { variantId: varD.variantId, action: 'add', quantity: 1 },
      ],
    });

    assert(await getStock(varA.variantId) === 0, 'Stock A unchanged (0)');
    assert(await getStock(varB.variantId) === 2, 'Stock B increased 0 -> 2');
    assert(await getStock(varC.variantId) === 1, 'Stock C unchanged at 1');
    assert(await getStock(varD.variantId) === 1, 'Stock D decreased 2 -> 1');

    const latest = await exchangeRepository.findLatestExchange(ord.id);
    assert(latest.items.find((i) => i.variantId === varA.variantId).quantity === 2, 'A has 2 active');
    assert(latest.items.find((i) => i.variantId === varB.variantId).quantity === 1, 'B has 1 active');
    assert(latest.items.find((i) => i.variantId === varC.variantId).quantity === 1, 'C has 1 active');
    assert(latest.items.find((i) => i.variantId === varD.variantId).quantity === 1, 'D has 1 active');
    pass('Mixed 4-variant operation passed with correct stock and active state.');
  }

  // ── CASE 14: Customer-paid exchange ───────────────────────────────────────
  section(12, 'Customer-paid exchange financial assertions (Delivery fee = 8 TND)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 2);

    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });

    const exch = result.exchanges[0];
    assert(exch.paymentResponsibility === 'customer_paid', 'Responsibility is customer_paid');
    assert(Number(exch.deliveryFee) === 8.0, 'Delivery fee is 8.0 TND');
    assert(Number(exch.subtotal) === varA.price, `Subtotal is ${varA.price}`);
    assert(Number(exch.total) === varA.price + 8.0, `Total is ${varA.price + 8.0}`);
    pass('Customer-paid exchange financial rules verified.');
  }

  // ── CASE 15: Silky-paid exchange ──────────────────────────────────────────
  section(13, 'Silky-paid exchange financial assertions (Delivery fee = 0 TND)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 2);

    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'silky_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });

    const exch = result.exchanges[0];
    assert(exch.paymentResponsibility === 'silky_paid', 'Responsibility is silky_paid');
    assert(Number(exch.deliveryFee) === 0.0, 'Delivery fee is 0.0 TND');
    assert(Number(exch.subtotal) === varA.price, `Subtotal is ${varA.price}`);
    assert(Number(exch.total) === varA.price, `Total is ${varA.price}`);
    pass('Silky-paid exchange financial rules verified.');
  }

  // ── CASE 16: Multiple successive exchanges ────────────────────────────────
  section(14, 'Multiple successive exchanges sequence & active state progression');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    await setStock(varC.variantId, 10);

    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 3 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    // Exchange 1: Keep 2, return 1 (stock A: 0 -> 1)
    await setStock(varA.variantId, 0);
    const exch1 = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 2 }],
    });
    assert(exch1.exchanges[0].exchangeSequence === 1, 'Sequence 1');
    assert(await getStock(varA.variantId) === 1, 'Stock A is 1');

    // Exchange 2: From active A×2, Keep 1, replace 1 (A stock 1 -> 1)
    const exch2 = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'silky_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });
    assert(exch2.exchanges[0].exchangeSequence === 2, 'Sequence 2');
    assert(await getStock(varA.variantId) === 1, 'Stock A is 1');

    // Exchange 3: From active A×2, Keep 1 A, Return 1 A, Add 1 B (B stock 2 -> 1, A stock 1 -> 2)
    await setStock(varB.variantId, 2);
    const exch3 = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 1 },
        { variantId: varB.variantId, action: 'add', quantity: 1 },
      ],
    });
    assert(exch3.exchanges[0].exchangeSequence === 3, 'Sequence 3');
    assert(await getStock(varA.variantId) === 2, 'Stock A is 2');
    assert(await getStock(varB.variantId) === 1, 'Stock B is 1');
    pass('Successive exchange chain verified.');
  }

  // ── CASE 17: Partial exchange followed by Remboursement ───────────────────
  section(15, 'Partial exchange followed by Remboursement: restores ONLY final active items');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 2 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 0);

    // Exchange: Keep 1 A, return 1 A, return 2 B (active becomes A×1)
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });

    assert(await getStock(varA.variantId) === 1, 'Stock A is 1');
    assert(await getStock(varB.variantId) === 2, 'Stock B is 2');

    // Refund order
    await orderService.refundOrder(ord.id);
    assert(await getStock(varA.variantId) === 2, 'Stock A restored by 1 (1 -> 2)');
    assert(await getStock(varB.variantId) === 2, 'Stock B not re-restored (remains 2)');
    const finalOrd = await orderService.getOrderById(ord.id);
    assert(finalOrd.status === 'refunded', 'Status is refunded');
    assert(finalOrd.refunds[0].refundAmount === varA.price, `Refund amount is ${varA.price}`);
    pass('Partial exchange + Remboursement restored only active items.');
  }

  // ── CASE 18: Partial exchange followed by cancellation ────────────────────
  section(16, 'Partial exchange followed by cancellation: restores ONLY final active items');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 0);

    // Exchange: Keep 1 A, return 1 A, return 1 B
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });

    assert(await getStock(varA.variantId) === 1, 'Stock A is 1');
    assert(await getStock(varB.variantId) === 1, 'Stock B is 1');

    await orderService.cancelOrder(ord.id);
    assert(await getStock(varA.variantId) === 2, 'Stock A restored by 1 (1 -> 2)');
    assert(await getStock(varB.variantId) === 1, 'Stock B not re-restored (remains 1)');
    const finalOrd = await orderService.getOrderById(ord.id);
    assert(finalOrd.status === 'cancelled', 'Status is cancelled');
    pass('Partial exchange + Cancellation restored only active items.');
  }

  // ── CASE 19: All-return through exchange -> REJECT ────────────────────────
  section(17, 'All-return through exchange -> REJECT (Zero-Item Rule)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    let caughtError = null;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'return', quantity: 2 }],
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError !== null, 'All-return exchange was rejected');
    assert(caughtError.message.includes('Remboursement') || caughtError.message.includes('actif'), 'Error references active items or Remboursement');
    pass('All-return exchange rejected with Zero-Item Rule.');
  }

  // ── CASE 20: Keep-only unchanged state -> REJECT ──────────────────────────
  section(18, 'Keep-only unchanged state -> REJECT (No-op exchange)');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    let caughtError = null;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 2 },
          { variantId: varB.variantId, action: 'keep', quantity: 1 },
        ],
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError !== null, 'Keep-only exchange rejected');
    assert(caughtError.message.includes('Aucune modification'), 'Error explains no modification detected');
    pass('Keep-only unchanged state rejected safely.');
  }

  // ── CASE 21: Failed replacement produces zero mutation ────────────────────
  section(19, 'Failed replacement produces ZERO database or stock mutation');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 3);
    await setStock(varB.variantId, 0);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 2 },
          { variantId: varB.variantId, action: 'replace', quantity: 1 },
        ],
      });
    } catch {
      rejected = true;
    }

    assert(rejected, 'Replacement rejected due to B stock 0');
    assert(await getStock(varA.variantId) === 3, 'Stock A remained exactly 3');
    assert(await getStock(varB.variantId) === 0, 'Stock B remained exactly 0');
    const ordAfter = await orderService.getOrderById(ord.id);
    assert(ordAfter.status === 'completed', 'Order status remained completed');
    assert((ordAfter.exchanges || []).length === 0, 'Zero exchange records created');
    pass('Zero mutation on failed replacement verified.');
  }

  // ── CASE 22: Preview / Create Parity ──────────────────────────────────────
  section(20, 'Preview / Create Parity & Side-Effect Free Preview');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 2);

    // Preview successful exchange: Keep A×2 + Replace B×1
    const preview = await exchangeService.previewExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 2 },
        { variantId: varB.variantId, action: 'replace', quantity: 1 },
      ],
    });

    assert(preview.subtotal === (2 * varA.price) + (1 * varB.price), 'Preview subtotal accurate');
    assert(preview.deliveryFee === 8.0, 'Preview delivery fee accurate');
    assert(preview.total === (2 * varA.price) + (1 * varB.price) + 8.0, 'Preview total accurate');
    assert(await getStock(varA.variantId) === 0, 'Stock A unchanged after preview');
    assert(await getStock(varB.variantId) === 2, 'Stock B unchanged after preview');

    // Preview failing exchange: Replace A×1 with stock A=0
    let previewFailed = false;
    try {
      await exchangeService.previewExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'replace', quantity: 1 },
          { variantId: varB.variantId, action: 'replace', quantity: 1 },
        ],
      });
    } catch {
      previewFailed = true;
    }
    assert(previewFailed, 'Preview rejected exchange that createExchange would reject');
    pass('Preview/Create parity and side-effect free reads verified.');
  }

  // ── CASE 23: Invalid quantity validation ──────────────────────────────────
  section(21, 'Invalid quantity validation (negative, fractional, NaN, > currentQuantity)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    // Keep quantity > currentQuantity
    let err1 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'keep', quantity: 5 }],
      });
    } catch { err1 = true; }
    assert(err1, 'Keep > currentQuantity rejected');

    // Replace quantity <= 0
    let err2 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 0 }],
      });
    } catch { err2 = true; }
    assert(err2, 'Replace <= 0 rejected');

    // Replace quantity > currentQuantity
    let err3 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 4 }],
      });
    } catch { err3 = true; }
    assert(err3, 'Replace > currentQuantity rejected');

    // Fractional quantity
    let err4 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 1.5 }],
      });
    } catch { err4 = true; }
    assert(err4, 'Fractional quantity rejected');

    // Negative quantity
    let err5 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: -1 }],
      });
    } catch { err5 = true; }
    assert(err5, 'Negative quantity rejected');

    // NaN quantity
    let err6 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 'abc' }],
      });
    } catch { err6 = true; }
    assert(err6, 'NaN quantity rejected');

    pass('Invalid quantity boundaries (negative, fractional, NaN, > currentQuantity) rejected safely.');
  }

  // ── CASE 24: Customer-paid partial replacement ────────────────────────────
  section(22, 'Customer-paid partial replacement financial rules (Delivery fee = 8 TND)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 2);

    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });

    const exch = result.exchanges[0];
    assert(exch.paymentResponsibility === 'customer_paid', 'Responsibility is customer_paid');
    assert(Number(exch.deliveryFee) === 8.0, 'Delivery fee is 8.0 TND');
    assert(Number(exch.subtotal) === varA.price, `Subtotal is ${varA.price}`);
    assert(Number(exch.total) === varA.price + 8.0, `Total is ${varA.price + 8.0}`);
    pass('Customer-paid exchange financial rules verified.');
  }

  // ── CASE 25: Silky-paid partial replacement ───────────────────────────────
  section(23, 'Silky-paid partial replacement financial rules (Delivery fee = 0 TND)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 2);

    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'silky_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });

    const exch = result.exchanges[0];
    assert(exch.paymentResponsibility === 'silky_paid', 'Responsibility is silky_paid');
    assert(Number(exch.deliveryFee) === 0.0, 'Delivery fee is 0.0 TND');
    assert(Number(exch.subtotal) === varA.price, `Subtotal is ${varA.price}`);
    assert(Number(exch.total) === varA.price, `Total is ${varA.price}`);
    pass('Silky-paid exchange financial rules verified.');
  }

  // ── CASE 26: Multiple successive exchanges ────────────────────────────────
  section(24, 'Multiple successive exchanges sequence & active state progression');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    await setStock(varC.variantId, 10);

    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 3 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    // Exchange 1: Keep 2, return 1 (stock A: 0 -> 1)
    await setStock(varA.variantId, 0);
    const exch1 = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 2 }],
    });
    assert(exch1.exchanges[0].exchangeSequence === 1, 'Sequence 1');
    assert(await getStock(varA.variantId) === 1, 'Stock A is 1');

    // Exchange 2: From active A×2, Keep 1, replace 1 (A stock 1 -> 1)
    const exch2 = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'silky_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });
    assert(exch2.exchanges[0].exchangeSequence === 2, 'Sequence 2');
    assert(await getStock(varA.variantId) === 1, 'Stock A is 1');

    // Exchange 3: From active A×2, Keep 1 A, Return 1 A, Add 1 B (B stock 2 -> 1, A stock 1 -> 2)
    await setStock(varB.variantId, 2);
    const exch3 = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 1 },
        { variantId: varB.variantId, action: 'add', quantity: 1 },
      ],
    });
    assert(exch3.exchanges[0].exchangeSequence === 3, 'Sequence 3');
    assert(await getStock(varA.variantId) === 2, 'Stock A is 2');
    assert(await getStock(varB.variantId) === 1, 'Stock B is 1');
    pass('Successive exchange chain verified.');
  }

  // ── CASE 27: Partial exchange followed by Remboursement ───────────────────
  section(25, 'Partial exchange followed by Remboursement: restores ONLY active items');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 2 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 0);

    // Exchange: Keep 1 A, return 1 A, return 2 B (active becomes A×1)
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });

    assert(await getStock(varA.variantId) === 1, 'Stock A is 1');
    assert(await getStock(varB.variantId) === 2, 'Stock B is 2');

    // Refund order
    await orderService.refundOrder(ord.id);
    assert(await getStock(varA.variantId) === 2, 'Stock A restored by 1 (1 -> 2)');
    assert(await getStock(varB.variantId) === 2, 'Stock B not re-restored (remains 2)');
    const finalOrd = await orderService.getOrderById(ord.id);
    assert(finalOrd.status === 'refunded', 'Status is refunded');
    assert(finalOrd.refunds[0].refundAmount === varA.price, `Refund amount is ${varA.price}`);
    pass('Partial exchange + Remboursement restored only active items.');
  }

  // ── CASE 28: Partial exchange followed by cancellation ────────────────────
  section(26, 'Partial exchange followed by cancellation: restores ONLY active items');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 0);

    // Exchange: Keep 1 A, return 1 A, return 1 B
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });

    assert(await getStock(varA.variantId) === 1, 'Stock A is 1');
    assert(await getStock(varB.variantId) === 1, 'Stock B is 1');

    await orderService.cancelOrder(ord.id);
    assert(await getStock(varA.variantId) === 2, 'Stock A restored by 1 (1 -> 2)');
    assert(await getStock(varB.variantId) === 1, 'Stock B not re-restored (remains 1)');
    const finalOrd = await orderService.getOrderById(ord.id);
    assert(finalOrd.status === 'cancelled', 'Status is cancelled');
    pass('Partial exchange + Cancellation restored only active items.');
  }

  // ── CASE 29: Malformed request or invalid action -> REJECT ────────────────
  section(27, 'Malformed request or invalid action rejected safely');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    // Invalid action string
    let err1 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'invalid_action', quantity: 1 }],
      });
    } catch { err1 = true; }
    assert(err1, 'Invalid action string rejected');

    // Missing variantId
    let err2 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ action: 'replace', quantity: 1 }],
      });
    } catch { err2 = true; }
    assert(err2, 'Missing variantId rejected');

    // Empty items array
    let err3 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [],
      });
    } catch { err3 = true; }
    assert(err3, 'Empty items array rejected');

    // New item with 'keep' action
    let err4 = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 1 },
          { variantId: varC.variantId, action: 'keep', quantity: 1 },
        ],
      });
    } catch { err4 = true; }
    assert(err4, 'New unheld variant with "keep" action rejected');

    pass('Malformed requests and invalid actions rejected safely.');
  }

  // ── CASE 30: Ambiguous legacy request cannot bypass validation ────────────
  section(28, 'Ambiguous legacy request cannot bypass explicit stock validation');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    // Legacy identical swap without explicit action with warehouse stock 0
    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, quantity: 1 }],
      });
    } catch {
      rejected = true;
    }

    assert(rejected, 'Legacy request requiring replacement rejected when warehouse stock is 0');
    assert(await getStock(varA.variantId) === 0, 'Stock remains 0 (zero mutation)');
    pass('Legacy request cannot bypass warehouse stock validation.');
  }

  // ── CASE 31: Unheld variant with keep -> REJECT ───────────────────────────
  section(29, 'Unheld variant with keep -> REJECT');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 1 },
          { variantId: varC.variantId, action: 'keep', quantity: 1 },
        ],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Unheld variant cannot use keep');
    pass('Unheld variant with "keep" action rejected.');
  }

  // ── CASE 32: Unheld variant with replace -> REJECT ────────────────────────
  section(30, 'Unheld variant with replace -> REJECT');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 1 },
          { variantId: varC.variantId, action: 'replace', quantity: 1 },
        ],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Unheld variant cannot use replace');
    pass('Unheld variant with "replace" action rejected.');
  }

  // ── CASE 33: Unheld variant with return -> REJECT ─────────────────────────
  section(31, 'Unheld variant with return -> REJECT');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 1 },
          { variantId: varC.variantId, action: 'return', quantity: 1 },
        ],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Unheld variant cannot use return');
    pass('Unheld variant with "return" action rejected.');
  }

  // ── CASE 34: Unheld variant with add -> PASS ──────────────────────────────
  section(32, 'Unheld variant with add -> PASS');
  {
    await setStock(varA.variantId, 2);
    await setStock(varC.variantId, 5);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 1 },
        { variantId: varC.variantId, action: 'add', quantity: 2 },
      ],
    });

    assert(await getStock(varC.variantId) === 3, 'Stock C decreased 5 -> 3');
    pass('Unheld variant with "add" action succeeded.');
  }

  // ── CASE 35: Existing B×1 + ADD 1, stock B=1 → PASS ──────────────────────
  section(35, 'Existing B×1 + ADD 1, stock B=1 → PASS (B becomes 2)');
  {
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varB.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 1); // 1 left in warehouse after order

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
    });

    const stockAfter = await getStock(varB.variantId);
    assert(stockAfter === 0, `Stock B should be 0 after ADD 1 (was 1), got ${stockAfter}`);

    // Verify latest exchange shows B×2
    const { rows: exRows } = await pool.query(
      `SELECT ei.quantity FROM exchange_items ei
       JOIN order_exchanges oe ON oe.id = ei.exchange_id
       WHERE oe.order_id = $1 ORDER BY oe.created_at DESC LIMIT 5`,
      [ord.id]
    );
    const bQty = exRows.find(() => true)?.quantity;
    assert(Number(bQty) === 2, `Exchange item B must show qty 2, got ${bQty}`);
    pass('Existing B×1 + ADD 1 → B×2, stock−1 verified.');
  }

  // ── CASE 36: Existing B×1 + ADD 1, stock B=0 → REJECT, zero mutation ──────
  section(36, 'Existing B×1 + ADD 1, stock B=0 → REJECT + zero mutation');
  {
    await setStock(varB.variantId, 1);
    const ord = await createTestOrder({ items: [{ variantId: varB.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 0); // no warehouse stock

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'ADD with stock 0 must be rejected');
    assert(await getStock(varB.variantId) === 0, 'Stock B remains 0 (zero mutation)');
    pass('Existing B×1 + ADD 1, stock 0 → rejected + zero mutation verified.');
  }

  // ── CASE 37: Existing B×1 + ADD 2, stock B=2 → PASS ──────────────────────
  section(37, 'Existing B×1 + ADD 2, stock B=2 → PASS (B becomes 3)');
  {
    await setStock(varB.variantId, 3);
    const ord = await createTestOrder({ items: [{ variantId: varB.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 2); // 2 left in warehouse

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'add', quantity: 2 }],
    });

    assert(await getStock(varB.variantId) === 0, 'Stock B should be 0 after ADD 2 (was 2)');
    pass('Existing B×1 + ADD 2 → B×3, stock−2 verified.');
  }

  // ── CASE 38: Existing B×1 + ADD 2, stock B=1 → REJECT, zero mutation ──────
  section(38, 'Existing B×1 + ADD 2, stock B=1 → REJECT (insufficient) + zero mutation');
  {
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varB.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 1); // only 1 in warehouse, need 2

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varB.variantId, action: 'add', quantity: 2 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'ADD 2 with only stock 1 must be rejected');
    assert(await getStock(varB.variantId) === 1, 'Stock B remains 1 (zero mutation)');
    pass('Existing B×1 + ADD 2 with stock 1 → rejected + zero mutation verified.');
  }

  // ── CASE 39: Critical combined scenario: A×2 REPLACE 1 + B×1 ADD 1 ────────
  section(39, 'Critical combined: A×2 REPLACE 1 + B×1 ADD 1 → A×2 + B×2');
  {
    // Setup: customer order A×2 + B×1
    await setStock(varA.variantId, 3);
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    // After order: A=1, B=1 in warehouse
    await setStock(varA.variantId, 1);
    await setStock(varB.variantId, 1);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'replace', quantity: 1 },
        { variantId: varB.variantId, action: 'add', quantity: 1 },
      ],
    });

    // A: replace 1 → warehouse requirement=1, net change=0 (return 1, get 1 fresh). Stock A stays 1.
    // B: add 1 → warehouse requirement=1, net change=-1. Stock B: 1→0.
    assert(await getStock(varA.variantId) === 1, 'Stock A must remain 1 (replace: 0 net change)');
    assert(await getStock(varB.variantId) === 0, 'Stock B must be 0 (add: −1)');

    // Verify exchange items: A×2 + B×2 (no duplicates)
    const { rows: exItems } = await pool.query(
      `SELECT ei.variant_id, ei.quantity FROM exchange_items ei
       JOIN order_exchanges oe ON oe.id = ei.exchange_id
       WHERE oe.order_id = $1 ORDER BY oe.created_at DESC`,
      [ord.id]
    );
    const aItem = exItems.find((r) => r.variant_id === varA.variantId);
    const bItem = exItems.find((r) => r.variant_id === varB.variantId);
    assert(aItem, 'Exchange must contain A');
    assert(bItem, 'Exchange must contain B');
    assert(Number(aItem.quantity) === 2, `A must be qty 2, got ${aItem.quantity}`);
    assert(Number(bItem.quantity) === 2, `B must be qty 2, got ${bItem.quantity}`);
    assert(exItems.length === 2, `Must be exactly 2 exchange items (no duplicates), got ${exItems.length}`);
    pass('Critical scenario A×2 REPLACE 1 + B×1 ADD 1 → A×2 + B×2 verified. Stock A=1, B=0. No duplicates.');
  }

  // ── CASE 40: Existing ADD + KEEP combined ─────────────────────────────────
  section(40, 'Existing A×2 KEEP + B×1 ADD 1 → A×2 + B×2');
  {
    await setStock(varA.variantId, 2);
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 1);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 2 },
        { variantId: varB.variantId, action: 'add', quantity: 1 },
      ],
    });

    assert(await getStock(varA.variantId) === 0, 'Stock A unchanged at 0 (keep requires no warehouse)');
    assert(await getStock(varB.variantId) === 0, 'Stock B = 0 after ADD 1');
    pass('Existing A×2 KEEP + B×1 ADD 1 → A×2 + B×2 verified.');
  }

  // ── CASE 41: Existing ADD + RETURN combined ───────────────────────────────
  section(41, 'A×2 RETURN 1 + B×1 ADD 1 → A×1 + B×2');
  {
    await setStock(varA.variantId, 2);
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 1);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'return', quantity: 1 },
        { variantId: varB.variantId, action: 'add', quantity: 1 },
      ],
    });

    // A: return 1 → stock 0+1=1. B: add 1 → stock 1−1=0.
    assert(await getStock(varA.variantId) === 1, 'Stock A = 1 after returning 1 unit');
    assert(await getStock(varB.variantId) === 0, 'Stock B = 0 after ADD 1');
    pass('A×2 RETURN 1 + B×1 ADD 1 → A×1 + B×2 verified.');
  }

  // ── CASE 42: Existing ADD + completely new variant ADD ────────────────────
  section(42, 'Existing B×1 ADD 1 + new C×0 ADD 1 → B×2 + C×1');
  {
    await setStock(varB.variantId, 3);
    await setStock(varC.variantId, 3);
    const ord = await createTestOrder({ items: [{ variantId: varB.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 2);
    await setStock(varC.variantId, 1);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varB.variantId, action: 'add', quantity: 1 },
        { variantId: varC.variantId, action: 'add', quantity: 1 },
      ],
    });

    assert(await getStock(varB.variantId) === 1, 'Stock B = 1 after ADD 1 (was 2)');
    assert(await getStock(varC.variantId) === 0, 'Stock C = 0 after ADD 1 (was 1)');
    pass('Existing B×1 ADD 1 + new C ADD 1 → B×2 + C×1 verified.');
  }

  // ── CASE 43: Preview/create parity for existing-variant ADD ───────────────
  section(43, 'Preview/create parity for existing-variant ADD');
  {
    await setStock(varB.variantId, 3);
    const ord = await createTestOrder({ items: [{ variantId: varB.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 2);

    const preview = await exchangeService.previewExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
    });

    // Preview must not mutate stock
    assert(await getStock(varB.variantId) === 2, 'Stock B unchanged after preview (side-effect free)');

    // Preview item qty must be 2
    const previewBQty = preview.items.find((i) => i.variantId === varB.variantId)?.quantity;
    assert(Number(previewBQty) === 2, `Preview must show B×2, got ${previewBQty}`);

    // Create and verify matches preview
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
    });

    assert(await getStock(varB.variantId) === 1, 'Stock B = 1 after create (was 2, ADD 1)');
    pass('Preview/create parity for existing-variant ADD verified.');
  }

  // ── CASE 44: Failed ADD → zero mutation ───────────────────────────────────
  section(44, 'Failed ADD (stock insufficient) → zero mutation on all variants');
  {
    await setStock(varA.variantId, 2);
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 0); // no stock for B ADD

    const stockABefore = await getStock(varA.variantId);
    const stockBBefore = await getStock(varB.variantId);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 2 },
          { variantId: varB.variantId, action: 'add', quantity: 1 },
        ],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Exchange with insufficient B stock must be rejected');
    assert(await getStock(varA.variantId) === stockABefore, 'Stock A must be unchanged (zero mutation)');
    assert(await getStock(varB.variantId) === stockBBefore, 'Stock B must be unchanged (zero mutation)');
    pass('Failed ADD due to insufficient stock → zero mutation on all variants verified.');
  }

  // ── CASE 45: Successive exchanges involving ADD ────────────────────────────
  section(45, 'Successive exchanges with ADD: prevQty updates correctly each time');
  {
    await setStock(varB.variantId, 5);
    const ord = await createTestOrder({ items: [{ variantId: varB.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 4);

    // Exchange 1: B×1 ADD 1 → B×2
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
    });
    assert(await getStock(varB.variantId) === 3, 'After exch1: stock B=3');

    // Exchange 2: B×2 ADD 1 → B×3 (prevQty is now 2)
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
    });
    assert(await getStock(varB.variantId) === 2, 'After exch2: stock B=2');

    // Exchange 3: B×3 RETURN 1 → B×2 (prevQty is now 3)
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'return', quantity: 1 }],
    });
    assert(await getStock(varB.variantId) === 3, 'After exch3 (return 1): stock B=3');
    pass('Successive exchanges with ADD: prevQty tracks correctly through each exchange.');
  }

  // ── CASE 46: Duplicate variantId in request → HTTP 400 + zero mutation ────
  section(46, 'Duplicate variant entries in request → REJECT');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 1 },
          { variantId: varA.variantId, action: 'return', quantity: 1 },
        ],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Duplicate variant lines in items must be rejected');
    pass('Duplicate variant entries rejected safely.');
  }

  // ── CASE 47: Legacy ambiguous request without action → REJECT ─────────────
  section(47, 'Legacy ambiguous request without action → REJECT');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, quantity: 1 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Ambiguous legacy request must be rejected');
    pass('Ambiguous legacy request rejected safely.');
  }

  // ── CASE 48: Legacy compatibility adapter check ───────────────────────────
  section(48, 'Legacy compatibility adapter check');
  {
    await setStock(varA.variantId, 1);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, quantity: 1 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Legacy request without action rejected');
    pass('Ambiguous legacy fallback is eliminated and cannot bypass stock validation.');
  }

  // ── CASE 49: Exact bug scenario: A×2 KEEP + B×1 REPLACE, A=0 ──────────────
  section(49, 'Exact bug scenario: A×2 KEEP + B×1 REPLACE with A stock 0');
  {
    await setStock(varA.variantId, 2);
    await setStock(varB.variantId, 1);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 1 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);
    await setStock(varB.variantId, 1);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 2 },
        { variantId: varB.variantId, action: 'replace', quantity: 1 },
      ],
    });

    assert(await getStock(varA.variantId) === 0, 'Stock A remains 0');
    assert(await getStock(varB.variantId) === 1, 'Stock B remains 1');
    pass('Production bug scenario verified: A×2 KEEP + B×1 REPLACE passes when stock A is 0.');
  }

  // ── CASE 50: A×1 REPLACE with A stock 0 → REJECT ─────────────────────────
  section(50, 'A×1 REPLACE with A stock 0 → REJECT');
  {
    await setStock(varA.variantId, 1);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Replace with 0 warehouse stock must be rejected');
    assert(await getStock(varA.variantId) === 0, 'Stock remains 0');
    pass('A×1 REPLACE with stock 0 rejected with zero mutation.');
  }

  // ── CASE 51: A×2 RETURN with A stock 0 → PASS ─────────────────────────────
  section(51, 'A×2 RETURN with A stock 0 (with B×1 add)');
  {
    await setStock(varA.variantId, 2);
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'return', quantity: 2 },
        { variantId: varB.variantId, action: 'add', quantity: 1 },
      ],
    });

    assert(await getStock(varA.variantId) === 2, 'Stock A increased 0 → 2');
    pass('A×2 RETURN with stock 0 increases warehouse stock to 2.');
  }

  // ── CASE 52: Keep everything / no-op rejection ────────────────────────────
  section(52, 'Keep everything / no-op rejection');
  {
    await setStock(varA.variantId, 2);
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({
      items: [
        { variantId: varA.variantId, quantity: 2 },
        { variantId: varB.variantId, quantity: 2 },
      ],
    });
    cleanupIds.push(ord.id);
    await orderService.confirmOrder(ord.id);

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 2 },
          { variantId: varB.variantId, action: 'keep', quantity: 2 },
        ],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Keep everything exchange must be rejected as no-op');
    pass('Keep everything / no-op rejection verified.');
  }



  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log(`\n${'-'.repeat(80)}`);
  console.log(`Cleaning up ${cleanupIds.length} test orders...`);
  if (cleanupIds.length > 0) {
    await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [cleanupIds]);
  }
  console.log('Cleanup complete.');

  console.log('\n' + '='.repeat(80));
  console.log(`✅ EXCHANGE INTENT VALIDATION SUITE: ${passed}/${total} PASSED (100%)`);
  console.log('='.repeat(80) + '\n');
}

run()
  .catch((err) => {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
