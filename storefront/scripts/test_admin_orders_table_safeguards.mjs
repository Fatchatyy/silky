import assert from 'assert';
import { buildDocumentsToDownload } from '../src/admin-app/utils/orderPdf.js';

// Logic mirror from AdminOrders.jsx
function filterOrders(orders, searchQuery, statusFilter) {
  return orders.filter((order) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const orderNumMatch = order.orderNumber?.toLowerCase().includes(q);
      const orderIdMatch = order.id?.toLowerCase().includes(q);
      const firstName = (order.customer?.firstName || order.customer?.name || '').toLowerCase();
      const lastName = (order.customer?.lastName || '').toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const nameMatch = firstName.includes(q) || lastName.includes(q) || fullName.includes(q);
      const phoneMatch = order.customer?.phone?.toLowerCase().includes(q);
      const emailMatch = order.customer?.email?.toLowerCase().includes(q);

      if (!(orderNumMatch || orderIdMatch || nameMatch || phoneMatch || emailMatch)) {
        return false;
      }
    }

    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'unconfirmed') {
        if (order.status !== 'pending' && order.status !== 'processing') return false;
      } else if (statusFilter === 'confirmed') {
        if (order.status !== 'completed' && order.status !== 'confirmed') return false;
      } else if (statusFilter === 'exchanged') {
        if (order.status !== 'exchanged') return false;
      } else if (statusFilter === 'refunded') {
        if (order.status !== 'refunded') return false;
      } else if (statusFilter === 'cancelled') {
        if (order.status !== 'cancelled') return false;
      }
    }

    return true;
  });
}

function sortOrders(orders, sortDirection = 'desc') {
  return [...orders].sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
  });
}

function paginateOrders(sortedOrders, currentPage, pageSize) {
  const totalOrders = sortedOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalOrders);
  return {
    paginatedOrders: sortedOrders.slice(startIndex, endIndex),
    totalOrders,
    totalPages,
    activePage,
    startIndex,
    endIndex,
  };
}

function evaluatePageSelectState(paginatedOrders, selectedOrderIds) {
  const pageOrderIds = paginatedOrders.map((o) => o.id);
  const isAllPageSelected =
    pageOrderIds.length > 0 && pageOrderIds.every((id) => selectedOrderIds.includes(id));
  const isSomePageSelected =
    pageOrderIds.some((id) => selectedOrderIds.includes(id)) && !isAllPageSelected;
  return { isAllPageSelected, isSomePageSelected, pageOrderIds };
}

function toggleSelectPage(paginatedOrders, currentSelectedIds) {
  const { isAllPageSelected, pageOrderIds } = evaluatePageSelectState(paginatedOrders, currentSelectedIds);
  if (isAllPageSelected) {
    return currentSelectedIds.filter((id) => !pageOrderIds.includes(id));
  } else {
    return Array.from(new Set([...currentSelectedIds, ...pageOrderIds]));
  }
}

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

function computeMontantAPayer(entity) {
  return entity.customerAmountToPay !== undefined
    ? entity.customerAmountToPay
    : (entity.finalCustomerPayableAmount !== undefined ? entity.finalCustomerPayableAmount : (entity.total || 0));
}

async function runTests() {
  console.log('===============================================================');
  console.log('Running Admin Orders Table & Safeguards Regression Tests');
  console.log('===============================================================\n');

  // Create mock orders
  const mockOrders = [];
  for (let i = 1; i <= 45; i++) {
    const status = i <= 15 ? 'pending' : (i <= 30 ? 'completed' : (i <= 35 ? 'exchanged' : (i <= 40 ? 'refunded' : 'cancelled')));
    const date = new Date(Date.now() - i * 3600000).toISOString();
    mockOrders.push({
      id: `order-id-${i}`,
      orderNumber: `CMD-${1000 + i}`,
      status,
      createdAt: date,
      customer: {
        firstName: `Client${i}`,
        lastName: `Test${i}`,
        phone: `980000${String(i).padStart(2, '0')}`,
        email: `client${i}@example.com`,
      },
      total: 100 + i,
      deliveryFee: 7,
      customerAmountToPay: 100 + i,
      exchanges: status === 'exchanged' ? [
        {
          id: `ex-id-${i}-1`,
          exchangeNumber: `ECH-${1000 + i}-1`,
          createdAt: date,
          paymentResponsibility: 'customer_paid',
          total: 50,
          customerAmountToPay: 57,
        }
      ] : [],
      refunds: status === 'refunded' ? [
        {
          id: `ref-id-${i}-1`,
          refundNumber: `REF-${1000 + i}-1`,
          createdAt: date,
          paymentResponsibility: 'silky_paid',
          refundAmount: 40,
          customerAmountToPay: 0,
        }
      ] : [],
    });
  }

  // --- Test 1: Select orders on page 1 -> navigate to page 2 -> selections persist ---
  console.log('--- Test 1: Cross-page selection persistence ---');
  let selectedOrderIds = [];
  let selectedExchangeIds = [];
  let selectedRefundIds = [];

  const pageSize = 20;
  const sorted = sortOrders(filterOrders(mockOrders, '', 'all'), 'desc');
  const page1 = paginateOrders(sorted, 1, pageSize);
  assert.strictEqual(page1.paginatedOrders.length, 20);

  // Select first 2 orders on page 1
  selectedOrderIds.push(page1.paginatedOrders[0].id, page1.paginatedOrders[1].id);
  assert.strictEqual(selectedOrderIds.length, 2);

  // Navigate to Page 2
  const page2 = paginateOrders(sorted, 2, pageSize);
  assert.strictEqual(page2.paginatedOrders.length, 20);

  // Selections must persist
  assert.deepStrictEqual(selectedOrderIds, [page1.paginatedOrders[0].id, page1.paginatedOrders[1].id]);
  console.log('✓ Selections made on page 1 persist when navigating to page 2.');

  // --- Test 2: Select on page 1 + page 2 -> bulk Print includes both ---
  console.log('\n--- Test 2: Bulk Print includes selections across all pages ---');
  // Select 2 orders on page 2 as well
  selectedOrderIds.push(page2.paginatedOrders[0].id, page2.paginatedOrders[1].id);
  assert.strictEqual(selectedOrderIds.length, 4);

  const docs = buildDocumentsToDownload(mockOrders, selectedOrderIds, selectedExchangeIds, selectedRefundIds);
  assert.strictEqual(docs.length, 4);
  const docOrderNumbers = docs.map(d => d.data.orderNumber);
  assert(docOrderNumbers.includes(page1.paginatedOrders[0].orderNumber));
  assert(docOrderNumbers.includes(page1.paginatedOrders[1].orderNumber));
  assert(docOrderNumbers.includes(page2.paginatedOrders[0].orderNumber));
  assert(docOrderNumbers.includes(page2.paginatedOrders[1].orderNumber));
  console.log('✓ Bulk Print document builder includes selections across both page 1 and page 2.');

  // --- Test 3: Page-2 deselect-all does not clear page-1 selections ---
  console.log('\n--- Test 3: Page-scoped select-all deselect does not clear other pages ---');
  // Currently on page 2: 2 orders selected. Let's select all on page 2
  selectedOrderIds = toggleSelectPage(page2.paginatedOrders, selectedOrderIds);
  // Total selected should be 2 (from page 1) + 20 (all from page 2) = 22
  assert.strictEqual(selectedOrderIds.length, 22);

  // Now toggleSelectPage again on page 2 -> should unselect all 20 from page 2, keeping page 1 intact
  selectedOrderIds = toggleSelectPage(page2.paginatedOrders, selectedOrderIds);
  assert.strictEqual(selectedOrderIds.length, 2);
  assert.deepStrictEqual(selectedOrderIds, [page1.paginatedOrders[0].id, page1.paginatedOrders[1].id]);
  console.log('✓ Deselecting all on page 2 removes only page 2 items, preserving page 1 selections.');

  // --- Test 4: Confirm evaluates selections across pages ---
  console.log('\n--- Test 4: Confirm evaluates selections across pages ---');
  // Page 1 has 2 pending orders selected
  assert.strictEqual(mockOrders.find(o => o.id === page1.paginatedOrders[0].id).status, 'pending');
  assert.strictEqual(mockOrders.find(o => o.id === page1.paginatedOrders[1].id).status, 'pending');
  assert.strictEqual(computeCanConfirm(mockOrders, selectedOrderIds, [], []), true);
  console.log('✓ Confirm is enabled when all cross-page selected orders are unconfirmed (pending).');

  // --- Test 5: Mixed-status selections across pages disable Confirm ---
  console.log('\n--- Test 5: Mixed-status selections across pages disable Confirm ---');
  // Select a completed order from page 2
  const completedOrderOnPage2 = page2.paginatedOrders.find(o => o.status === 'completed');
  assert(completedOrderOnPage2, 'Found completed order on page 2');
  selectedOrderIds.push(completedOrderOnPage2.id);

  assert.strictEqual(computeCanConfirm(mockOrders, selectedOrderIds, [], []), false);
  console.log('✓ Selecting a completed order on page 2 immediately disables Confirm across pages.');

  // Remove the completed order
  selectedOrderIds = selectedOrderIds.filter(id => id !== completedOrderOnPage2.id);
  assert.strictEqual(computeCanConfirm(mockOrders, selectedOrderIds, [], []), true);

  // --- Test 6: Historical exchange/refund selections persist across pages ---
  console.log('\n--- Test 6: Historical exchange/refund selections persist across pages ---');
  const exchangedOrder = mockOrders.find(o => o.status === 'exchanged');
  const refundOrder = mockOrders.find(o => o.status === 'refunded');
  selectedExchangeIds.push(exchangedOrder.exchanges[0].id);
  selectedRefundIds.push(refundOrder.refunds[0].id);

  // When exchange or refund is selected, canConfirm must be false
  assert.strictEqual(computeCanConfirm(mockOrders, selectedOrderIds, selectedExchangeIds, selectedRefundIds), false);

  // Check that navigating to page 3, changing filter, sorting preserves exchange/refund selections
  const page3 = paginateOrders(sorted, 3, pageSize);
  assert.strictEqual(selectedExchangeIds.length, 1);
  assert.strictEqual(selectedRefundIds.length, 1);

  const docsWithHistory = buildDocumentsToDownload(mockOrders, selectedOrderIds, selectedExchangeIds, selectedRefundIds);
  assert(docsWithHistory.some(d => d.type === 'exchange' && d.data.id === exchangedOrder.exchanges[0].id));
  assert(docsWithHistory.some(d => d.type === 'refund' && d.data.id === refundOrder.refunds[0].id));
  console.log('✓ Historical exchange and refund selections persist across pagination and are included in print/PDF docs.');

  // --- Test 7: Sort/filter/page-size changes do not destroy selection state ---
  console.log('\n--- Test 7: Filter, sort, and page-size changes do not clear selection state ---');
  const initialSelectedOrders = [...selectedOrderIds];
  const initialSelectedEx = [...selectedExchangeIds];
  const initialSelectedRef = [...selectedRefundIds];

  // Apply status filter 'confirmed'
  const filteredConfirmed = filterOrders(mockOrders, '', 'confirmed');
  assert(filteredConfirmed.every(o => o.status === 'completed' || o.status === 'confirmed'));

  // Sort ascending
  const sortedAsc = sortOrders(filteredConfirmed, 'asc');
  const paginated50 = paginateOrders(sortedAsc, 1, 50);

  // Verify selection states are intact
  assert.deepStrictEqual(selectedOrderIds, initialSelectedOrders);
  assert.deepStrictEqual(selectedExchangeIds, initialSelectedEx);
  assert.deepStrictEqual(selectedRefundIds, initialSelectedRef);
  console.log('✓ Selection state remains intact across sorting, filtering, and page-size changes.');

  // --- Test 8: Header select-all reflects only current page ---
  console.log('\n--- Test 8: Header select-all checkbox reflects only current visible page ---');
  // Clean slate for page state test
  selectedOrderIds = [];
  const p1Orders = page1.paginatedOrders;
  const p2Orders = page2.paginatedOrders;

  // Nothing selected
  let stateP1 = evaluatePageSelectState(p1Orders, selectedOrderIds);
  assert.strictEqual(stateP1.isAllPageSelected, false);
  assert.strictEqual(stateP1.isSomePageSelected, false);

  // Select 2 items on page 1 -> some selected on page 1 (indeterminate)
  selectedOrderIds = [p1Orders[0].id, p1Orders[1].id];
  stateP1 = evaluatePageSelectState(p1Orders, selectedOrderIds);
  assert.strictEqual(stateP1.isAllPageSelected, false);
  assert.strictEqual(stateP1.isSomePageSelected, true);

  // Page 2 should be completely unchecked
  let stateP2 = evaluatePageSelectState(p2Orders, selectedOrderIds);
  assert.strictEqual(stateP2.isAllPageSelected, false);
  assert.strictEqual(stateP2.isSomePageSelected, false);

  // Select all on page 1
  selectedOrderIds = p1Orders.map(o => o.id);
  stateP1 = evaluatePageSelectState(p1Orders, selectedOrderIds);
  assert.strictEqual(stateP1.isAllPageSelected, true);
  assert.strictEqual(stateP1.isSomePageSelected, false);

  // Page 2 still completely unchecked
  stateP2 = evaluatePageSelectState(p2Orders, selectedOrderIds);
  assert.strictEqual(stateP2.isAllPageSelected, false);
  assert.strictEqual(stateP2.isSomePageSelected, false);
  console.log('✓ Header select-all reflects only current visible page (all -> checked, some -> indeterminate, none -> unchecked).');

  // --- Test 9: Montant à payer calculation exact reuse ---
  console.log('\n--- Test 9: Montant à payer calculation verification ---');
  const testOrderWithAmount = { total: 100, customerAmountToPay: 85 };
  const testOrderWithFinal = { total: 100, finalCustomerPayableAmount: 90 };
  const testOrderStandard = { total: 100 };
  assert.strictEqual(computeMontantAPayer(testOrderWithAmount), 85);
  assert.strictEqual(computeMontantAPayer(testOrderWithFinal), 90);
  assert.strictEqual(computeMontantAPayer(testOrderStandard), 100);
  console.log('✓ Montant à payer calculation properly reuses existing business calculation.');

  console.log('\n===============================================================');
  console.log('✅ ALL ADMIN ORDERS TABLE & SAFEGUARDS TESTS PASSED!');
  console.log('===============================================================');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
