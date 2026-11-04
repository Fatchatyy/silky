import '../config/env.js';
import './helpers/parcel_guard_off.js';
import { pool } from '../db/pool.js';
import { runExchangesMigration } from '../db/migrations/add_exchanges.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as inventoryService from '../services/inventory.service.js';
import * as adminService from '../services/admin.service.js';
import { orderRepository } from '../repositories/order.repository.js';
import { exchangeRepository } from '../repositories/exchange.repository.js';

async function runTests() {
  console.log('================================================================');
  console.log('Starting Exchange PDF Selection & Historical Data Verification');
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

  // --- Step 1: Create and Confirm Base Order ---
  console.log('--- Step 1: Create and Confirm Base Order ---');
  const order = await adminService.createManualOrder({
    customerName: 'Amina Ben Ali',
    phoneNumber: '20123456',
    orderSource: 'phone',
    customerEmail: 'amina.benali@example.com',
    governorate: 'Tunis',
    shippingAddress: '12 Rue de la Paix',
    deliveryFee: 8.0,
    items: [{ variantId: varA.id, quantity: 1 }],
  });

  const confirmedOrder = await orderService.confirmOrder(order.id);
  console.log(`Base order created and confirmed: ${confirmedOrder.orderNumber} (Status: ${confirmedOrder.status})`);
  if (confirmedOrder.status !== 'completed') {
    throw new Error(`Expected confirmed status 'completed', got ${confirmedOrder.status}`);
  }

  // --- Step 2: Create Multi-Step Historical Exchange Chain (A -> B -> C -> A) ---
  console.log('\n--- Step 2: Create Multi-Step Historical Exchange Chain ---');
  
  // Exchange #1: customer_paid (Var A -> Var B)
  const orderAfterEx1 = await exchangeService.createExchange({
    orderId: confirmedOrder.id,
    customer: {
      customerName: 'Amina Ben Ali',
      phoneNumber: '20123456',
      customerEmail: 'amina.benali@example.com',
      shippingAddress: 'Tunis — 12 Rue de la Paix',
    },
    deliveryFee: 8.0,
    paymentResponsibility: 'customer_paid',
    items: [{ variantId: varB.id, action: 'add', quantity: 1 }],
  });
  console.log('Exchange #1 (customer_paid) created.');

  // Exchange #2: silky_paid (Var B -> Var C)
  const orderAfterEx2 = await exchangeService.createExchange({
    orderId: confirmedOrder.id,
    customer: {
      customerName: 'Amina Ben Ali - Bureau',
      phoneNumber: '20123456',
      customerEmail: 'amina.benali@example.com',
      shippingAddress: 'Ariana — 45 Avenue Habib Bourguiba',
    },
    deliveryFee: 0.0,
    paymentResponsibility: 'silky_paid',
    items: [{ variantId: varC.id, action: 'add', quantity: 1 }],
  });
  console.log('Exchange #2 (silky_paid) created.');

  // Exchange #3: customer_paid (Var C -> Var A)
  const orderAfterEx3 = await exchangeService.createExchange({
    orderId: confirmedOrder.id,
    customer: {
      customerName: 'Amina Ben Ali',
      phoneNumber: '20123456',
      customerEmail: 'amina.benali@example.com',
      shippingAddress: 'Tunis — 12 Rue de la Paix',
    },
    deliveryFee: 8.0,
    paymentResponsibility: 'customer_paid',
    items: [{ variantId: varA.id, action: 'add', quantity: 1 }],
  });
  console.log('Exchange #3 (customer_paid) created.');

  // --- Step 3: Verify Independent Identifiers & Sequence Numbers ---
  console.log('\n--- Step 3: Verify Independent Identifiers & Sequence Numbers ---');
  const fetchedOrder = await orderRepository.findById(confirmedOrder.id);
  const exchanges = fetchedOrder.exchanges || [];

  if (exchanges.length !== 3) {
    throw new Error(`Expected 3 exchanges on order, found ${exchanges.length}`);
  }

  // Sort ascending by sequence for verification
  const sortedExchanges = [...exchanges].sort((a, b) => a.exchangeSequence - b.exchangeSequence);
  const [ex1, ex2, ex3] = sortedExchanges;

  console.log(`Ex #1: ID=${ex1.id}, Seq=${ex1.exchangeSequence}, Number=${ex1.exchangeNumber}, Resp=${ex1.paymentResponsibility}`);
  console.log(`Ex #2: ID=${ex2.id}, Seq=${ex2.exchangeSequence}, Number=${ex2.exchangeNumber}, Resp=${ex2.paymentResponsibility}`);
  console.log(`Ex #3: ID=${ex3.id}, Seq=${ex3.exchangeSequence}, Number=${ex3.exchangeNumber}, Resp=${ex3.paymentResponsibility}`);

  if (!ex1.id || !ex2.id || !ex3.id) throw new Error('Each exchange must have a valid distinct ID');
  if (ex1.id === ex2.id || ex2.id === ex3.id || ex1.id === ex3.id) throw new Error('Exchange IDs must be unique');
  if (ex1.exchangeSequence !== 1 || ex2.exchangeSequence !== 2 || ex3.exchangeSequence !== 3) {
    throw new Error('Exchange sequences must be 1, 2, and 3');
  }

  // --- Step 4: Verify Payment Responsibility Persistence ---
  console.log('\n--- Step 4: Verify Payment Responsibility Persistence ---');
  if (ex1.paymentResponsibility !== 'customer_paid') throw new Error(`Ex #1 expected customer_paid, got ${ex1.paymentResponsibility}`);
  if (ex2.paymentResponsibility !== 'silky_paid') throw new Error(`Ex #2 expected silky_paid, got ${ex2.paymentResponsibility}`);
  if (ex3.paymentResponsibility !== 'customer_paid') throw new Error(`Ex #3 expected customer_paid, got ${ex3.paymentResponsibility}`);

  if (ex1.deliveryFee !== 8) throw new Error(`Ex #1 deliveryFee expected 8, got ${ex1.deliveryFee}`);
  if (ex2.deliveryFee !== 0) throw new Error(`Ex #2 deliveryFee expected 0, got ${ex2.deliveryFee}`);
  if (ex3.deliveryFee !== 8) throw new Error(`Ex #3 deliveryFee expected 8, got ${ex3.deliveryFee}`);
  console.log('✓ Payment responsibility and financial delivery fees correctly preserved.');

  // --- Step 5: Verify Historical Exchange Item & Customer Data Preservation ---
  console.log('\n--- Step 5: Verify Historical Data Preservation (A -> B -> C -> A) ---');
  if (ex1.items[0].variantId !== varB.id) throw new Error(`Ex #1 item expected Var B (${varB.id}), got ${ex1.items[0].variantId}`);
  if (ex2.items[0].variantId !== varC.id) throw new Error(`Ex #2 item expected Var C (${varC.id}), got ${ex2.items[0].variantId}`);
  if (ex3.items[0].variantId !== varA.id) throw new Error(`Ex #3 item expected Var A (${varA.id}), got ${ex3.items[0].variantId}`);

  if (!ex2.customer.address.includes('Ariana')) {
    throw new Error(`Ex #2 address expected to contain 'Ariana', got ${ex2.customer.address}`);
  }
  if (!ex1.customer.address.includes('Tunis')) {
    throw new Error(`Ex #1 address expected to contain 'Tunis', got ${ex1.customer.address}`);
  }
  console.log('✓ Historical exchange items and customer addresses remain distinct and authoritative.');

  // --- Step 6: Verify Zero Side-Effects on Repeated Data Retrieval / Re-download ---
  console.log('\n--- Step 6: Verify Idempotency & Zero Side-Effects on Read/Re-download ---');
  const stockABefore = await getStock(varA.id);
  const stockBBefore = await getStock(varB.id);
  const stockCBefore = await getStock(varC.id);

  // Simulate multiple reads / re-downloads of historical exchanges
  for (let i = 0; i < 5; i++) {
    const reFetchedOrder = await orderRepository.findById(confirmedOrder.id);
    const reFetchedEx1 = reFetchedOrder.exchanges.find((e) => e.id === ex1.id);
    const reFetchedEx2 = reFetchedOrder.exchanges.find((e) => e.id === ex2.id);
    if (!reFetchedEx1 || !reFetchedEx2) throw new Error('Failed to retrieve exchange during re-read');
  }

  const stockAAfter = await getStock(varA.id);
  const stockBAfter = await getStock(varB.id);
  const stockCAfter = await getStock(varC.id);

  if (stockABefore !== stockAAfter || stockBBefore !== stockBAfter || stockCBefore !== stockCAfter) {
    throw new Error('Stock changed during exchange read / re-download!');
  }

  const finalOrder = await orderRepository.findById(confirmedOrder.id);
  if (finalOrder.status !== 'exchanged') {
    throw new Error(`Order status changed to ${finalOrder.status}`);
  }
  if (finalOrder.exchanges.length !== 3) {
    throw new Error(`Exchange count changed to ${finalOrder.exchanges.length}`);
  }
  console.log('✓ Zero side-effects confirmed: stock, order status, and exchange count remain unchanged.');

  // --- Step 7: Verify Deterministic Document Construction Simulation ---
  console.log('\n--- Step 7: Verify Deterministic Document Construction Simulation ---');
  
  function buildDocumentsToDownload(orderList, selectedOrderIds, selectedExchangeIds) {
    const documents = [];
    orderList.forEach((ord) => {
      if (selectedOrderIds.includes(ord.id) && ord.status !== 'cancelled') {
        documents.push({ type: 'order', data: ord });
      }
      if (Array.isArray(ord.exchanges) && ord.status !== 'cancelled') {
        const sorted = [...ord.exchanges].sort((a, b) => {
          const seqA = a.exchangeSequence || 0;
          const seqB = b.exchangeSequence || 0;
          if (seqA !== seqB) return seqA - seqB;
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        });
        sorted.forEach((ex) => {
          if (selectedExchangeIds.includes(ex.id)) {
            documents.push({
              type: 'exchange',
              data: { ...ex, orderNumber: ex.orderNumber || ord.orderNumber },
            });
          }
        });
      }
    });
    return documents;
  }

  // Simulation A: Select Only Exchange #2
  const docListA = buildDocumentsToDownload([fetchedOrder], [], [ex2.id]);
  if (docListA.length !== 1 || docListA[0].type !== 'exchange' || docListA[0].data.id !== ex2.id) {
    throw new Error('Simulation A failed: expected single Exchange #2 document');
  }

  // Simulation B: Select Order + Exchange #1 + Exchange #3
  const docListB = buildDocumentsToDownload([fetchedOrder], [fetchedOrder.id], [ex1.id, ex3.id]);
  if (
    docListB.length !== 3 ||
    docListB[0].type !== 'order' ||
    docListB[1].data.id !== ex1.id ||
    docListB[2].data.id !== ex3.id
  ) {
    throw new Error('Simulation B failed: expected Order, then Ex #1, then Ex #3 in deterministic order');
  }

  // Simulation C: Select All 3 Exchanges (Exchange-only combined)
  const docListC = buildDocumentsToDownload([fetchedOrder], [], [ex3.id, ex1.id, ex2.id]); // passed in unordered
  if (
    docListC.length !== 3 ||
    docListC[0].data.id !== ex1.id ||
    docListC[1].data.id !== ex2.id ||
    docListC[2].data.id !== ex3.id
  ) {
    throw new Error('Simulation C failed: expected Ex #1 -> Ex #2 -> Ex #3 sorted deterministically by sequence');
  }

  console.log('✓ Document compilation simulations verified deterministic ordering in all cases.');

  console.log('\n================================================================');
  console.log('✅ ALL EXCHANGE PDF SELECTION & DATA INTEGRITY TESTS PASSED!');
  console.log('================================================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
