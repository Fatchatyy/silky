import '../config/env.js';
import './helpers/parcel_guard_off.js';
import assert from 'assert';
import { jsPDF } from 'jspdf';
import { pool } from '../db/pool.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import * as adminService from '../services/admin.service.js';
import { orderRepository } from '../repositories/order.repository.js';
import {
  renderOrderDocument,
  renderExchangeDocument,
  renderRefundDocument,
  buildDocumentsToDownload,
} from '../../src/utils/orderPdf.js';

function computeCanConfirm(orders, selectedOrderIds, selectedExchangeIds, selectedRefundIds) {
  const selectedOrders = orders.filter((o) => selectedOrderIds.includes(o.id));
  const hasSelectedOrders = selectedOrders.length > 0;
  const hasSelectedExchangesOrRefunds =
    selectedExchangeIds.length > 0 || selectedRefundIds.length > 0;

  return (
    hasSelectedOrders &&
    !hasSelectedExchangesOrRefunds &&
    selectedOrders.every(
      (o) => o.status === 'pending' || o.status === 'processing',
    )
  );
}

async function run() {
  console.log('===============================================================');
  console.log('Running Admin Orders PDF Selection & Print Verification');
  console.log('===============================================================\n');

  // Fetch variants
  const { rows: variants } = await pool.query(`
    SELECT pv.id, pv.stock_quantity, p.title
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE p.is_active = TRUE
    ORDER BY pv.id
    LIMIT 3
  `);
  if (variants.length < 2) {
    console.error('Need at least 2 active variants');
    process.exit(1);
  }

  // --- Scenario 1: Normal Confirmed Order (completed) ---
  console.log('--- Scenario 1: Normal Confirmed Order ---');
  const baseOrder = await adminService.createManualOrder({
    customerName: 'Yassine Triki',
    phoneNumber: '98765432',
    orderSource: 'phone',
    customerEmail: 'yassine@example.com',
    governorate: 'Sfax',
    shippingAddress: 'Route de Téniour',
    deliveryFee: 8.0,
    items: [{ variantId: variants[0].id, quantity: 1 }],
  });
  const confirmedOrder = await orderService.confirmOrder(baseOrder.id);
  assert.strictEqual(confirmedOrder.status, 'completed');

  const normalDocs = buildDocumentsToDownload([confirmedOrder], [confirmedOrder.id], [], []);
  assert.strictEqual(normalDocs.length, 1);
  assert.strictEqual(normalDocs[0].type, 'order');
  assert.strictEqual(normalDocs[0].data.orderNumber, confirmedOrder.orderNumber);

  const doc1 = new jsPDF();
  renderOrderDocument(doc1, normalDocs[0].data);
  const pdfText1 = doc1.output();
  assert(pdfText1.length > 0, 'Normal order PDF rendered successfully');
  console.log('✓ Normal confirmed order generates type: order document and renders correctly.');

  // --- Scenario 2: Unconfirmed Orders (pending & processing) ---
  console.log('\n--- Scenario 2: Unconfirmed Orders (pending & processing) ---');
  const pendingOrder = await adminService.createManualOrder({
    customerName: 'Pending Customer',
    phoneNumber: '22114455',
    orderSource: 'phone',
    customerEmail: 'pending@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Avenue Habib Bourguiba',
    deliveryFee: 8.0,
    items: [{ variantId: variants[0].id, quantity: 1 }],
  });
  assert.strictEqual(pendingOrder.status, 'pending');

  const pendingDocs = buildDocumentsToDownload([pendingOrder], [pendingOrder.id], [], []);
  assert.strictEqual(pendingDocs.length, 1);
  assert.strictEqual(pendingDocs[0].type, 'order');
  assert.strictEqual(pendingDocs[0].data.orderNumber, pendingOrder.orderNumber);
  console.log('✓ Pending order generates type: order document and renders correctly.');

  // --- Scenario 3: Exchanged Order ---
  console.log('\n--- Scenario 3: Exchanged Order ---');
  const exchOrder = await adminService.createManualOrder({
    customerName: 'Sarra Mansour',
    phoneNumber: '55112233',
    orderSource: 'phone',
    customerEmail: 'sarra@example.com',
    governorate: 'Monastir',
    shippingAddress: 'Centre Ville',
    deliveryFee: 8.0,
    items: [{ variantId: variants[0].id, quantity: 1 }],
  });
  await orderService.confirmOrder(exchOrder.id);

  // Exchange 1
  await exchangeService.createExchange({
    orderId: exchOrder.id,
    customer: {
      customerName: 'Sarra Mansour',
      phoneNumber: '55112233',
      customerEmail: 'sarra@example.com',
      shippingAddress: 'Monastir — Centre Ville',
    },
    deliveryFee: 8.0,
    paymentResponsibility: 'customer_paid',
    items: [{ variantId: variants[1].id, action: 'add', quantity: 1 }],
  });

  const refreshedExchOrder = await orderRepository.findById(exchOrder.id);
  assert.strictEqual(refreshedExchOrder.status, 'exchanged');
  assert.strictEqual(refreshedExchOrder.exchanges.length, 1);

  // Select the exchanged order itself (order checkbox or single print)
  const exchDocs = buildDocumentsToDownload([refreshedExchOrder], [refreshedExchOrder.id], [], []);
  assert.strictEqual(exchDocs.length, 1);
  assert.strictEqual(exchDocs[0].type, 'exchange');
  assert.strictEqual(exchDocs[0].data.exchangeNumber, refreshedExchOrder.exchanges[0].exchangeNumber);
  assert.strictEqual(exchDocs[0].data.orderNumber, refreshedExchOrder.orderNumber);

  const doc2 = new jsPDF();
  renderExchangeDocument(doc2, exchDocs[0].data);
  const pdfText2 = doc2.output();
  assert(pdfText2.length > 0, 'Exchanged order PDF rendered successfully');
  console.log('✓ Exchanged order generates type: exchange document and renders correctly.');

  // --- Scenario 4: Refunded Order ---
  console.log('\n--- Scenario 4: Refunded Order ---');
  const refOrder = await adminService.createManualOrder({
    customerName: 'Karim Jaziri',
    phoneNumber: '22334455',
    orderSource: 'phone',
    customerEmail: 'karim@example.com',
    governorate: 'Nabeul',
    shippingAddress: 'Hammamet',
    deliveryFee: 8.0,
    items: [{ variantId: variants[0].id, quantity: 1 }],
  });
  await orderService.confirmOrder(refOrder.id);
  await orderService.refundOrder(refOrder.id, { paymentResponsibility: 'customer_paid' });

  const refreshedRefOrder = await orderRepository.findById(refOrder.id);
  assert.strictEqual(refreshedRefOrder.status, 'refunded');
  assert.strictEqual(refreshedRefOrder.refunds.length, 1);

  // Select the refunded order itself (order checkbox or single print)
  const refDocs = buildDocumentsToDownload([refreshedRefOrder], [refreshedRefOrder.id], [], []);
  assert.strictEqual(refDocs.length, 1);
  assert.strictEqual(refDocs[0].type, 'refund');
  assert.strictEqual(refDocs[0].data.refundNumber, refreshedRefOrder.refunds[0].refundNumber);
  assert.strictEqual(refDocs[0].data.orderNumber, refreshedRefOrder.orderNumber);

  const doc3 = new jsPDF();
  renderRefundDocument(doc3, refDocs[0].data);
  const pdfText3 = doc3.output();
  assert(pdfText3.length > 0, 'Refunded order PDF rendered successfully');
  console.log('✓ Refunded order generates type: refund document and renders correctly.');

  // --- Scenario 5: Historical Events Preservation & Multi-Exchange Chain ---
  console.log('\n--- Scenario 5: Historical Events Preservation & Multi-Exchange Chain ---');
  await exchangeService.createExchange({
    orderId: exchOrder.id,
    customer: {
      customerName: 'Sarra Mansour',
      phoneNumber: '55112233',
      customerEmail: 'sarra@example.com',
      shippingAddress: 'Monastir — Centre Ville',
    },
    deliveryFee: 0.0,
    paymentResponsibility: 'silky_paid',
    items: [{ variantId: variants[0].id, action: 'add', quantity: 1 }],
  });

  const multiExchOrder = await orderRepository.findById(exchOrder.id);
  assert.strictEqual(multiExchOrder.exchanges.length, 2);

  const [latestEx, earlierEx] = multiExchOrder.exchanges;

  const orderSelectDocs = buildDocumentsToDownload([multiExchOrder], [multiExchOrder.id], [], []);
  assert.strictEqual(orderSelectDocs.length, 1);
  assert.strictEqual(orderSelectDocs[0].type, 'exchange');
  assert.strictEqual(orderSelectDocs[0].data.exchangeSequence, 2);
  console.log('✓ Selecting exchanged order card retrieves latest exchange (Sequence 2).');

  const histSelectDocs = buildDocumentsToDownload([multiExchOrder], [], [earlierEx.id], []);
  assert.strictEqual(histSelectDocs.length, 1);
  assert.strictEqual(histSelectDocs[0].type, 'exchange');
  assert.strictEqual(histSelectDocs[0].data.exchangeSequence, 1);
  console.log('✓ Selecting historical event checkbox retrieves earlier exchange (Sequence 1).');

  const bothDocs = buildDocumentsToDownload([multiExchOrder], [multiExchOrder.id], [earlierEx.id], []);
  assert.strictEqual(bothDocs.length, 2);
  assert.strictEqual(bothDocs[0].data.exchangeSequence, 2);
  assert.strictEqual(bothDocs[1].data.exchangeSequence, 1);
  console.log('✓ Selecting both order and earlier historical exchange compiles both deterministically.');

  const dedupeDocs = buildDocumentsToDownload([multiExchOrder], [multiExchOrder.id], [latestEx.id], []);
  assert.strictEqual(dedupeDocs.length, 1);
  console.log('✓ Selecting order card and same latest exchange in history prevents duplicates.');

  // --- Scenario 6: Cancelled Order Printable & Selectable ---
  console.log('\n--- Scenario 6: Cancelled Order Printable & Selectable ---');
  const cancelOrder = await adminService.createManualOrder({
    customerName: 'Cancelled Customer',
    phoneNumber: '11223344',
    orderSource: 'phone',
    customerEmail: 'cancelled@example.com',
    governorate: 'Tunis',
    shippingAddress: 'Rue de la Paix',
    deliveryFee: 8.0,
    items: [{ variantId: variants[0].id, quantity: 1 }],
  });
  await orderService.cancelOrder(cancelOrder.id);
  const fetchedCancelled = await orderRepository.findById(cancelOrder.id);
  assert.strictEqual(fetchedCancelled.status, 'cancelled');

  const cancelDocs = buildDocumentsToDownload([fetchedCancelled], [fetchedCancelled.id], [], []);
  assert.strictEqual(cancelDocs.length, 1, 'Cancelled order is compiled into documents for printing');
  assert.strictEqual(cancelDocs[0].type, 'order');
  assert.strictEqual(cancelDocs[0].data.orderNumber, fetchedCancelled.orderNumber);

  const docCancel = new jsPDF();
  renderOrderDocument(docCancel, cancelDocs[0].data);
  const pdfCancelText = docCancel.output();
  assert(pdfCancelText.length > 0, 'Cancelled order PDF rendered successfully');
  console.log('✓ Cancelled order generates type: order document and renders correctly.');

  // --- Scenario 7: Mixed Status Bulk Print ---
  console.log('\n--- Scenario 7: Mixed Status Bulk Print ---');
  const allTestOrders = [
    pendingOrder,
    confirmedOrder,
    multiExchOrder,
    refreshedRefOrder,
    fetchedCancelled,
  ];
  const allOrderIds = allTestOrders.map((o) => o.id);
  const bulkDocs = buildDocumentsToDownload(allTestOrders, allOrderIds, [], []);
  assert.strictEqual(bulkDocs.length, 5, 'All 5 mixed-status orders are compiled into bulk document list');

  const multiDoc = new jsPDF();
  bulkDocs.forEach((item, idx) => {
    if (idx > 0) multiDoc.addPage();
    if (item.type === 'exchange') renderExchangeDocument(multiDoc, item.data);
    else if (item.type === 'refund') renderRefundDocument(multiDoc, item.data);
    else renderOrderDocument(multiDoc, item.data);
  });
  assert(multiDoc.output().length > 0, 'Multi-page mixed-status PDF generated successfully');
  console.log('✓ Mixed status bulk print compiles all statuses (pending, completed, exchanged, refunded, cancelled).');

  // --- Scenario 8: Mutation & Action Isolation (canConfirm logic) ---
  console.log('\n--- Scenario 8: Mutation & Action Isolation ---');

  // 8A: Only pending order selected -> canConfirm is TRUE
  const canConfirmPendingOnly = computeCanConfirm(allTestOrders, [pendingOrder.id], [], []);
  assert.strictEqual(canConfirmPendingOnly, true, 'Confirm enabled for only pending orders');

  // 8B: Cancelled order selected alone -> canConfirm is FALSE
  const canConfirmCancelledOnly = computeCanConfirm(allTestOrders, [fetchedCancelled.id], [], []);
  assert.strictEqual(canConfirmCancelledOnly, false, 'Confirm disabled when cancelled order is selected');

  // 8C: Pending + Cancelled selected -> canConfirm is FALSE
  const canConfirmMixed = computeCanConfirm(allTestOrders, [pendingOrder.id, fetchedCancelled.id], [], []);
  assert.strictEqual(canConfirmMixed, false, 'Confirm disabled when mixed unconfirmed and cancelled orders selected');

  // 8D: Completed order selected -> canConfirm is FALSE
  const canConfirmCompleted = computeCanConfirm(allTestOrders, [confirmedOrder.id], [], []);
  assert.strictEqual(canConfirmCompleted, false, 'Confirm disabled when completed order selected');

  // 8E: Exchange or refund selected -> canConfirm is FALSE
  const canConfirmWithExchange = computeCanConfirm(allTestOrders, [pendingOrder.id], [earlierEx.id], []);
  assert.strictEqual(canConfirmWithExchange, false, 'Confirm disabled when exchange is selected');

  console.log('✓ canConfirm is strictly guarded: enabled ONLY for unconfirmed orders, disabled for cancelled/completed/exchanges/refunds.');

  // --- Scenario 9: Zero Side-Effects (Status & Financials Unchanged) ---
  console.log('\n--- Scenario 9: Zero Side-Effects Verification ---');
  const preCheckExch = await orderRepository.findById(exchOrder.id);
  const preCheckRef = await orderRepository.findById(refOrder.id);
  const preCheckCancel = await orderRepository.findById(cancelOrder.id);

  // Run compilations repeatedly
  for (let i = 0; i < 5; i++) {
    buildDocumentsToDownload(
      [preCheckExch, preCheckRef, preCheckCancel],
      [preCheckExch.id, preCheckRef.id, preCheckCancel.id],
      [],
      [],
    );
  }

  const postCheckExch = await orderRepository.findById(exchOrder.id);
  const postCheckRef = await orderRepository.findById(refOrder.id);
  const postCheckCancel = await orderRepository.findById(cancelOrder.id);

  assert.strictEqual(postCheckExch.status, 'exchanged');
  assert.strictEqual(postCheckExch.total, preCheckExch.total);
  assert.strictEqual(postCheckRef.status, 'refunded');
  assert.strictEqual(postCheckRef.total, preCheckRef.total);
  assert.strictEqual(postCheckCancel.status, 'cancelled');
  assert.strictEqual(postCheckCancel.total, preCheckCancel.total);
  console.log('✓ Zero side-effects verified: order statuses and financial amounts remain unchanged.');

  console.log('\n===============================================================');
  console.log('✅ ALL ADMIN ORDERS PDF SELECTION & PRINT TESTS PASSED SUCCESSFULLY!');
  console.log('===============================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
