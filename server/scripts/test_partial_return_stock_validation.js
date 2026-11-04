/**
 * test_partial_return_stock_validation.js
 *
 * Tests the precise stock-validation fix introduced in exchange.service.js.
 *
 * Business rule (corrected):
 *   For each variant:
 *     additionalWarehouseQty = max(newQty - prevQty, 0)
 *   Only additionalWarehouseQty is checked against warehouse stock.
 *   A quantity decrease (partial return) never requires warehouse stock.
 *   A new or increased variant always requires independent warehouse stock.
 *   Returned quantities from one variant cannot satisfy stock for another.
 *
 * 23 cases covering the complete specification.
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

async function getStock(variantId) {
  const inv = await inventoryService.getInventory();
  const item = inv.find((v) => (v.variantId || v.id) === variantId);
  return item ? Number(item.stockQuantity) : null;
}
async function setStock(variantId, qty) { await inventoryService.updateVariantStock(variantId, qty); }
async function createTestOrder({ customerName = 'Test', phoneNumber = '90000000', governorate = 'Tunis', shippingAddress = 'Rue Habib Bourguiba', deliveryFee = 8.0, items = [] } = {}) {
  return adminService.createManualOrder({ customerName, phoneNumber, orderSource: 'phone', governorate, shippingAddress, deliveryFee, items });
}
function assert(condition, message) {
  if (!condition) { console.error(`\n  ❌ ASSERTION FAILED: ${message}\n`); throw new Error(message); }
}

async function run() {
  console.log('='.repeat(80));
  console.log('PARTIAL RETURN STOCK VALIDATION TEST SUITE (23 Cases)');
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
  if (variantRows.length < 4) { console.error('Need at least 4 active variants.'); process.exit(1); }

  const allV = variantRows.map((r) => ({
    variantId: r.variant_id, productId: r.product_id, title: r.title,
    price: Number(r.effective_price), colorName: r.color_name, size: r.size,
  }));
  const varA = allV[0];
  const varB = allV.find((v) => v.productId !== varA.productId) || allV[1];
  const varC = allV.find((v) => v.variantId !== varA.variantId && v.variantId !== varB.variantId) || allV[2];

  console.log(`\nVariants:`);
  console.log(`  A: "${varA.title}" (${varA.colorName}/${varA.size}) ${varA.price} TND`);
  console.log(`  B: "${varB.title}" (${varB.colorName}/${varB.size}) ${varB.price} TND`);
  console.log(`  C: "${varC.title}" (${varC.colorName}/${varC.size}) ${varC.price} TND\n`);

  const cleanupIds = [];
  let passed = 0;
  let total = 0;
  function section(num, title) { total++; console.log(`\n${'-'.repeat(80)}`); console.log(`[CASE ${num}] ${title}`); }
  function pass(msg) { passed++; console.log(`  ✓ PASS: ${msg}`); }

  // ── CASE 1: A×1 → A×1, stock 0 -> REJECT ─────────────────────────────────
  // ── CASE 1: A×1 → A×1, stock 0 -> REJECT ─────────────────────────────────
  section(1, 'A×1 → A×1, stock=0 -> REJECT (identical state, genuine replacement needs 1 warehouse unit)');
  {
    await setStock(varA.variantId, 1);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);
    assert(await getStock(varA.variantId) === 0, 'Stock of A is 0');

    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
      });
    } catch { rejected = true; }
    assert(rejected, 'Identical swap rejected when warehouse stock is 0');
    assert(await getStock(varA.variantId) === 0, 'Stock remains 0 (zero mutation)');
    pass(`A×1→A×1 with stock=0 rejected correctly. Zero mutation.`);
  }

  // ── CASE 2: A×1 → A×1, stock 1 -> PASS ───────────────────────────────────
  section(2, 'A×1 → A×1, stock=1 -> PASS (swaps 1 held unit with 1 warehouse unit)');
  {
    await setStock(varA.variantId, 1);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 1);
    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
    });
    const sa = await getStock(varA.variantId);
    assert(sa === 1, `Stock remains 1 after swap (1 - 1 + 1 = 1). Got ${sa}`);
    assert(result.status === 'exchanged', 'Order status exchanged');
    pass(`A×1→A×1 with stock=1 passed. Stock 1→1.`);
  }

  // ── CASE 3: A×2 → A×2, stock 1 -> REJECT ─────────────────────────────────
  section(3, 'A×2 → A×2, stock=1 -> REJECT (identical state needs 2 warehouse units)');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 1);
    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 2 }],
      });
    } catch { rejected = true; }
    assert(rejected, 'A×2→A×2 rejected when warehouse stock is 1 (< 2)');
    assert(await getStock(varA.variantId) === 1, 'Stock remains 1');
    pass(`A×2→A×2 with stock=1 rejected correctly.`);
  }

  // ── CASE 4: A×2 → A×2, stock 2 -> PASS ───────────────────────────────────
  section(4, 'A×2 → A×2, stock=2 -> PASS (swaps 2 held units with 2 warehouse units)');
  {
    await setStock(varA.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 2);
    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'replace', quantity: 2 }],
    });
    const sa = await getStock(varA.variantId);
    assert(sa === 2, `Stock remains 2 after swap. Got ${sa}`);
    pass(`A×2→A×2 with stock=2 passed. Stock 2→2.`);
  }

  // ── CASE 5: A×2 → A×1, stock 0 -> PASS ───────────────────────────────────
  section(5, 'A×2 → A×1, stock=0 -> PASS (partial return: customer keeps 1, returns 1, stock increases 0 -> 1)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);
    const result = await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    const sa = await getStock(varA.variantId);
    assert(sa === 1, `Stock 0→1 (returned 1). Got ${sa}`);
    assert(result.exchanges[0].subtotal === varA.price, 'Subtotal = 1×price');
    pass(`A×2→A×1 with stock=0 passed. Stock 0→1.`);
  }

  // ── CASE 6: A×2 → A×1, stock 5 -> PASS ───────────────────────────────────
  section(6, 'A×2 → A×1, stock=5 -> PASS (warehouse stock increases 5 -> 6)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 5);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    const sa = await getStock(varA.variantId);
    assert(sa === 6, `Stock 5→6. Got ${sa}`);
    pass(`A×2→A×1 with stock=5 passed. Stock 5→6.`);
  }

  // ── CASE 7: A×1 + B×1, B stock 0 -> REJECT ─────────────────────────────────
  section(7, 'A×1 + B×1, B stock=0 -> REJECT (needs 1 warehouse unit of B)');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 0);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 0);
    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 1 },
          { variantId: varB.variantId, action: 'add', quantity: 1 },
        ],
      });
    } catch { rejected = true; }
    assert(rejected, 'Exchange rejected');
    assert(await getStock(varB.variantId) === 0, 'Stock B unchanged (0)');
    pass(`A×1+B×1 B stock=0 rejected correctly. Zero mutation.`);
  }

  // ── CASE 8: A×1 + B×1, B stock 1 -> PASS ───────────────────────────────────
  section(8, 'A×1 + B×1, B stock=1 -> PASS (customer keeps 1 A, adds 1 B from warehouse: B stock 1 -> 0)');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 1);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 1);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 1 },
        { variantId: varB.variantId, action: 'add', quantity: 1 },
      ],
    });
    const sb = await getStock(varB.variantId);
    assert(sb === 0, `Stock B 1→0 (deducted 1). Got ${sb}`);
    pass(`A×1+B×1 B stock=1 passed. Stock B 1→0.`);
  }

  // ── CASE 9: A×3 → A×1, stock 0 -> PASS ───────────────────────────────────
  section(9, 'A×3 → A×1, stock=0 -> PASS (partial return of 2 units: stock 0 -> 2)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 3 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    const sa = await getStock(varA.variantId);
    assert(sa === 2, `Stock 0→2 (returned 2). Got ${sa}`);
    pass(`A×3→A×1 stock=0 passed. Stock 0→2.`);
  }

  // ── CASE 10: A×3 → A×2, stock 0 -> PASS ──────────────────────────────────
  section(10, 'A×3 → A×2, stock=0 -> PASS (partial return of 1 unit: stock 0 -> 1)');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 3 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 2 }],
    });
    const sa = await getStock(varA.variantId);
    assert(sa === 1, `Stock 0→1 (returned 1). Got ${sa}`);
    pass(`A×3→A×2 stock=0 passed. Stock 0→1.`);
  }

  // ── CASE 11: A×1 + B×2, B stock 1 -> REJECT ────────────────────────────────
  section(11, 'A×1 + B×2, B stock=1 -> REJECT (needs 2 additional warehouse units, only 1 available)');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 1);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 1);
    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [
          { variantId: varA.variantId, action: 'keep', quantity: 1 },
          { variantId: varB.variantId, action: 'add', quantity: 2 },
        ],
      });
    } catch { rejected = true; }
    assert(rejected, 'Exchange rejected');
    assert(await getStock(varB.variantId) === 1, 'Stock B unchanged (1)');
    pass(`A×1+B×2 B stock=1 rejected correctly. Zero mutation.`);
  }

  // ── CASE 12: A×1 + B×2, B stock 2 -> PASS ──────────────────────────────────
  section(12, 'A×1 + B×2, B stock=2 -> PASS (needs 2 additional: B stock 2 -> 0)');
  {
    await setStock(varA.variantId, 10);
    await setStock(varB.variantId, 2);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varB.variantId, 2);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [
        { variantId: varA.variantId, action: 'keep', quantity: 1 },
        { variantId: varB.variantId, action: 'add', quantity: 2 },
      ],
    });
    const sb = await getStock(varB.variantId);
    assert(sb === 0, `Stock B 2→0. Got ${sb}`);
    pass(`A×1+B×2 B stock=2 passed. Stock B 2→0.`);
  }

  // ── CASE 13: Red×2 → Blue×1, Blue stock 0 -> REJECT ──────────────────────
  section(13, 'Red(A)×2 → Blue(B)×1, Blue stock=0 -> REJECT (different variant: needs 1 unit of Blue)');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 5);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 0);
    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
      });
    } catch { rejected = true; }
    assert(rejected, 'Exchange rejected');
    assert(await getStock(varA.variantId) === 10, 'Stock A unchanged (10)');
    assert(await getStock(varB.variantId) === 0, 'Stock B unchanged (0)');
    pass(`Red(A)×2→Blue(B)×1 B stock=0 rejected correctly. Zero mutation.`);
  }

  // ── CASE 14: Red×2 → Blue×1, Blue stock 1 -> PASS ────────────────────────
  section(14, 'Red(A)×2 → Blue(B)×1, Blue stock=1 -> PASS (Blue stock 1 -> 0, Red stock +2)');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 5);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 1);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
    });
    const sA = await getStock(varA.variantId); const sB = await getStock(varB.variantId);
    assert(sA === 12, `Stock A 10→12 (returned 2). Got ${sA}`);
    assert(sB === 0, `Stock B 1→0 (deducted 1). Got ${sB}`);
    pass(`Red(A)×2→Blue(B)×1 B stock=1 passed. A:10→12, B:1→0.`);
  }

  // ── CASE 15: A×2 + B×3 → A×2 + B×1, B stock 0 -> PASS ────────────────────
  section(15, 'A×2 + B×3 → A×2 + B×1, B stock=0 -> PASS (partial return of B: keeps A×2 & B×1, returns B×2)');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [{ variantId: varA.variantId, quantity: 2 }, { variantId: varB.variantId, quantity: 3 }],
    });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 5); await setStock(varB.variantId, 0);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 2 }, { variantId: varB.variantId, action: 'keep', quantity: 1 }],
    });
    const sA = await getStock(varA.variantId); const sB = await getStock(varB.variantId);
    assert(sA === 5, `Stock A unchanged at 5. Got ${sA}`);
    assert(sB === 2, `Stock B 0→2 (returned 2). Got ${sB}`);
    pass(`A×2+B×3→A×2+B×1 B stock=0 passed. A:5, B:0→2.`);
  }

  // ── CASE 16: A×2 + B×3 → A×1 + B×1, A stock 0, B stock 0 -> PASS ─────────
  section(16, 'A×2 + B×3 → A×1 + B×1, A stock=0, B stock=0 -> PASS (partial return of both: A 0->1, B 0->2)');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [{ variantId: varA.variantId, quantity: 2 }, { variantId: varB.variantId, quantity: 3 }],
    });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0); await setStock(varB.variantId, 0);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }, { variantId: varB.variantId, action: 'keep', quantity: 1 }],
    });
    const sA = await getStock(varA.variantId); const sB = await getStock(varB.variantId);
    assert(sA === 1, `Stock A 0→1. Got ${sA}`);
    assert(sB === 2, `Stock B 0→2. Got ${sB}`);
    pass(`A×2+B×3→A×1+B×1 stocks=0 passed. A:0→1, B:0→2.`);
  }

  // ── CASE 17: A×2 + B×2 → A×1 + C×1, C stock 1 -> PASS ────────────────────
  section(17, 'A×2 + B×2 → A×1 + C×1, C stock=1 -> PASS (A partial return, B full return, C new product)');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 10); await setStock(varC.variantId, 5);
    const ord = await createTestOrder({
      items: [{ variantId: varA.variantId, quantity: 2 }, { variantId: varB.variantId, quantity: 2 }],
    });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0); await setStock(varB.variantId, 0); await setStock(varC.variantId, 1);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }, { variantId: varC.variantId, action: 'add', quantity: 1 }],
    });
    const sA = await getStock(varA.variantId); const sB = await getStock(varB.variantId); const sC = await getStock(varC.variantId);
    assert(sA === 1, `Stock A 0→1. Got ${sA}`);
    assert(sB === 2, `Stock B 0→2. Got ${sB}`);
    assert(sC === 0, `Stock C 1→0. Got ${sC}`);
    pass(`A×2+B×2→A×1+C×1 C stock=1 passed. A:0→1, B:0→2, C:1→0.`);
  }

  // ── CASE 18: A×2 + B×2 → A×1 + C×1, C stock 0 -> REJECT ──────────────────
  section(18, 'A×2 + B×2 → A×1 + C×1, C stock=0 -> REJECT (new product C has no warehouse stock)');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 10); await setStock(varC.variantId, 5);
    const ord = await createTestOrder({
      items: [{ variantId: varA.variantId, quantity: 2 }, { variantId: varB.variantId, quantity: 2 }],
    });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 3); await setStock(varB.variantId, 3); await setStock(varC.variantId, 0);
    let rejected = false;
    try {
      await exchangeService.createExchange({
        orderId: ord.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }, { variantId: varC.variantId, action: 'add', quantity: 1 }],
      });
    } catch { rejected = true; }
    assert(rejected, 'Exchange rejected');
    assert(await getStock(varA.variantId) === 3, 'Stock A unchanged (3)');
    assert(await getStock(varB.variantId) === 3, 'Stock B unchanged (3)');
    assert(await getStock(varC.variantId) === 0, 'Stock C unchanged (0)');
    pass(`A×2+B×2→A×1+C×1 C stock=0 rejected correctly. Zero mutation.`);
  }

  // ── CASE 19: Successive exchanges: A×3 → A×2 -> A×1 -> B×1 ────────────────
  section(19, 'Successive exchanges: A×3 → A×2 (stock 0->1) -> A×1 (stock 1->2) -> B×1 (B stock 1->0, A stock 2->3)');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 3 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);

    // Step 1: A×3 → A×2 (stock 0 -> 1)
    await setStock(varA.variantId, 0);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 2 }],
    });
    assert(await getStock(varA.variantId) === 1, 'After Step 1: A stock=1');

    // Step 2: A×2 → A×1 (stock 1 -> 2)
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    assert(await getStock(varA.variantId) === 2, 'After Step 2: A stock=2');

    // Step 3: A×1 → B×1 (B stock 1 -> 0, A stock 2 -> 3)
    await setStock(varB.variantId, 1);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varB.variantId, action: 'add', quantity: 1 }],
    });
    assert(await getStock(varA.variantId) === 3, 'After Step 3: A stock=3');
    assert(await getStock(varB.variantId) === 0, 'After Step 3: B stock=0');
    pass(`Successive exchanges A×3→A×2→A×1→B×1 verified. Final A:3, B:0.`);
  }

  // ── CASE 20: Customer-paid vs silky-paid on partial returns ───────────────
  section(20, 'Customer-paid vs silky-paid on partial returns: same stock behavior, delivery fees differ');
  {
    // Customer-paid partial: A×2 → A×1, fee=8
    await setStock(varA.variantId, 10);
    const ord1 = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord1.id); await orderService.confirmOrder(ord1.id);
    await setStock(varA.variantId, 0);
    const rCust = await exchangeService.createExchange({
      orderId: ord1.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    assert(rCust.exchanges[0].paymentResponsibility === 'customer_paid', 'Resp is customer_paid');
    assert(Number(rCust.exchanges[0].deliveryFee) === 8.0, 'Delivery fee is 8.0');
    assert(await getStock(varA.variantId) === 1, 'Stock 0→1');

    // Silky-paid partial: A×2 → A×1, fee=0
    await setStock(varA.variantId, 10);
    const ord2 = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord2.id); await orderService.confirmOrder(ord2.id);
    await setStock(varA.variantId, 0);
    const rSilky = await exchangeService.createExchange({
      orderId: ord2.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'silky_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    assert(rSilky.exchanges[0].paymentResponsibility === 'silky_paid', 'Resp is silky_paid');
    assert(Number(rSilky.exchanges[0].deliveryFee) === 0.0, 'Delivery fee is 0.0');
    assert(await getStock(varA.variantId) === 1, 'Stock 0→1');
    pass(`Customer-paid vs silky-paid partial: identical stock transition, distinct fees.`);
  }

  // ── CASE 21: Partial exchange followed by Remboursement ───────────────────
  section(21, 'Partial exchange followed by Remboursement: refund restores ONLY active items');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [{ variantId: varA.variantId, quantity: 2 }, { variantId: varB.variantId, quantity: 2 }],
    });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0); await setStock(varB.variantId, 0);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    assert(await getStock(varA.variantId) === 1, 'After exchange: A stock=1');
    assert(await getStock(varB.variantId) === 2, 'After exchange: B stock=2');

    // Refund restores ONLY the currently active A×1
    await orderService.refundOrder(ord.id);
    assert(await getStock(varA.variantId) === 2, 'After refund: A stock=2');
    assert(await getStock(varB.variantId) === 2, 'After refund: B stock=2 (not re-restored)');
    const finalOrder = await orderService.getOrderById(ord.id);
    assert(finalOrder.status === 'refunded', 'Status is refunded');
    assert(finalOrder.refunds[0].refundAmount === varA.price, `Refund amount is ${varA.price}`);
    pass(`Partial exchange + Remboursement: only active items restored.`);
  }

  // ── CASE 22: Partial exchange followed by Cancel ──────────────────────────
  section(22, 'Partial exchange followed by Cancel: cancel restores ONLY active items');
  {
    await setStock(varA.variantId, 10); await setStock(varB.variantId, 10);
    const ord = await createTestOrder({
      items: [{ variantId: varA.variantId, quantity: 2 }, { variantId: varB.variantId, quantity: 1 }],
    });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0); await setStock(varB.variantId, 0);
    await exchangeService.createExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    assert(await getStock(varA.variantId) === 1, 'After exchange: A stock=1');
    assert(await getStock(varB.variantId) === 1, 'After exchange: B stock=1');

    // Cancel restores ONLY the currently active A×1
    await orderService.cancelOrder(ord.id);
    assert(await getStock(varA.variantId) === 2, 'After cancel: A stock=2');
    assert(await getStock(varB.variantId) === 1, 'After cancel: B stock=1 (not re-restored)');
    const finalOrder = await orderService.getOrderById(ord.id);
    assert(finalOrder.status === 'cancelled', 'Status is cancelled');
    pass(`Partial exchange + Cancel: only active items restored.`);
  }

  // ── CASE 23: Preview uses same validation as createExchange ───────────────
  section(23, 'previewExchange uses same corrected validation as createExchange');
  {
    await setStock(varA.variantId, 10);
    const ord = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 2 }] });
    cleanupIds.push(ord.id); await orderService.confirmOrder(ord.id);
    await setStock(varA.variantId, 0);

    // Preview partial return A×2 → A×1 with stock=0: should succeed
    const previewResult = await exchangeService.previewExchange({
      orderId: ord.id,
      customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
      paymentResponsibility: 'customer_paid',
      items: [{ variantId: varA.variantId, action: 'keep', quantity: 1 }],
    });
    assert(previewResult.subtotal === varA.price, 'Preview subtotal correct');
    assert(previewResult.deliveryFee === 8.0, 'Preview delivery fee correct');

    // Preview identical swap A×1 → A×1 with stock=0 on fresh order: should fail
    await setStock(varA.variantId, 10);
    const ord2 = await createTestOrder({ items: [{ variantId: varA.variantId, quantity: 1 }] });
    cleanupIds.push(ord2.id); await orderService.confirmOrder(ord2.id);
    await setStock(varA.variantId, 0);
    let previewIdenticalRejected = false;
    try {
      await exchangeService.previewExchange({
        orderId: ord2.id,
        customer: { customerName: 'Test', phoneNumber: '90000000', shippingAddress: 'Tunis' },
        paymentResponsibility: 'customer_paid',
        items: [{ variantId: varA.variantId, action: 'replace', quantity: 1 }],
      });
    } catch { previewIdenticalRejected = true; }
    assert(previewIdenticalRejected, 'Preview rejected identical swap with stock=0');
    pass(`Preview: partial return succeeds at stock=0, identical swap fails at stock=0`);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log(`\n${'-'.repeat(80)}`);
  console.log(`Cleaning up ${cleanupIds.length} test orders...`);
  if (cleanupIds.length > 0) {
    await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [cleanupIds]);
  }
  console.log('Cleanup complete.');

  console.log('\n' + '='.repeat(80));
  console.log(`✅ PARTIAL RETURN VALIDATION SUITE: ${passed}/${total} PASSED`);
  console.log('='.repeat(80) + '\n');
}

run()
  .catch((err) => { console.error('\n❌ Test suite failed:', err); process.exit(1); })
  .finally(() => pool.end());

