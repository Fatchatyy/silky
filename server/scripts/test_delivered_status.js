/**
 * Database-Independent Test Suite for Delivered Order Lifecycle Status
 *
 * Verifies all 8 required transition scenarios, terminal state immutability,
 * and idempotency without connecting to PostgreSQL or modifying the database.
 */

import './helpers/parcel_guard_off.js';
import { orderRepository } from '../repositories/order.repository.js';
import { exchangeRepository } from '../repositories/exchange.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { refundRepository } from '../repositories/refund.repository.js';
import * as orderService from '../services/order.service.js';
import * as exchangeService from '../services/exchange.service.js';
import { db } from '../db/orm.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function assertRejects(fn, expectedRegex, message) {
  try {
    await fn();
    console.error(`  ✗ FAIL: ${message} (Expected rejection, but resolved)`);
    failed++;
  } catch (err) {
    if (expectedRegex && !expectedRegex.test(err.message)) {
      console.error(`  ✗ FAIL: ${message} (Error message "${err.message}" did not match ${expectedRegex})`);
      failed++;
    } else {
      console.log(`  ✓ PASS: ${message} (Rejected with "${err.message}")`);
      passed++;
    }
  }
}

console.log('================================================================');
console.log('Database-Independent Delivered Status Lifecycle Tests');
console.log('================================================================\n');

// Set up in-memory mock repository & transaction
const mockTx = { isMockTx: true };
db.transaction = async (callback) => callback(mockTx);

let mockOrders = {};

orderRepository.findByIdForUpdate = async (id) => {
  return mockOrders[id] ? { ...mockOrders[id] } : null;
};

orderRepository.findById = async (id) => {
  return mockOrders[id] ? { ...mockOrders[id] } : null;
};

let statusUpdateCallCount = 0;
orderRepository.updateStatus = async (id, status) => {
  if (!mockOrders[id]) throw new Error(`Order ${id} not found`);
  statusUpdateCallCount++;
  mockOrders[id].status = status;
  mockOrders[id].updatedAt = new Date().toISOString();
  return { ...mockOrders[id] };
};

orderRepository.lockVariantsForUpdate = async () => {};
exchangeRepository.findLatestExchange = async () => null;
productRepository.findVariantById = async () => null;
productRepository.updateVariantStock = async () => {};
refundRepository.createRefundRecord = async () => ({ id: 999 });

// Helper to seed mock order
function seedOrder(id, status, extra = {}) {
  mockOrders[id] = {
    id,
    orderNumber: `ORD-${id}`,
    status,
    subtotal: 50.0,
    deliveryFee: 8.0,
    totalAmount: 58.0,
    userId: null,
    customerName: 'Test Customer',
    customerEmail: `customer${id}@example.com`,
    customerPhone: '12345678',
    shippingAddress: '123 Test Street, Tunis',
    items: [],
    ...extra,
  };
}

async function runTestSuite() {
  // Scenario 1: completed -> delivered succeeds
  console.log('Scenario 1: Transition completed -> delivered succeeds');
  seedOrder(1, 'completed');
  const res1 = await orderService.deliverOrder(1);
  assert(res1.status === 'delivered', 'Order status updated to delivered');

  // Scenario 2: exchanged -> delivered succeeds
  console.log('\nScenario 2: Transition exchanged -> delivered succeeds');
  seedOrder(2, 'exchanged');
  const res2 = await orderService.deliverOrder(2);
  assert(res2.status === 'delivered', 'Order status updated to delivered');

  // Scenario 3: pending and processing -> delivered are rejected
  console.log('\nScenario 3: Transitions pending/processing -> delivered are rejected');
  seedOrder(3, 'pending');
  await assertRejects(
    () => orderService.deliverOrder(3),
    /Seules les commandes confirmées ou échangées peuvent être marquées comme livrées/,
    'Pending order cannot transition to delivered'
  );
  seedOrder(4, 'processing');
  await assertRejects(
    () => orderService.deliverOrder(4),
    /Seules les commandes confirmées ou échangées peuvent être marquées comme livrées/,
    'Processing order cannot transition to delivered'
  );

  // Scenario 4: All 6 terminal-to-terminal transitions are rejected
  console.log('\nScenario 4: All 6 terminal-to-terminal transitions are rejected');
  // 4.1 delivered -> cancelled
  seedOrder(10, 'delivered');
  await assertRejects(
    () => orderService.cancelOrder(10),
    /Impossible d'annuler une commande déjà livrée/,
    'delivered -> cancelled is rejected'
  );

  // 4.2 delivered -> refunded
  seedOrder(11, 'delivered');
  await assertRejects(
    () => orderService.refundOrder(11, {}),
    /Impossible de rembourser une commande déjà livrée/,
    'delivered -> refunded is rejected'
  );

  // 4.3 cancelled -> delivered
  seedOrder(12, 'cancelled');
  await assertRejects(
    () => orderService.deliverOrder(12),
    /Impossible de marquer comme livrée une commande annulée/,
    'cancelled -> delivered is rejected'
  );

  // 4.4 cancelled -> refunded
  seedOrder(13, 'cancelled');
  await assertRejects(
    () => orderService.refundOrder(13, {}),
    /Impossible de rembourser une commande annulée/,
    'cancelled -> refunded is rejected'
  );

  // 4.5 refunded -> delivered
  seedOrder(14, 'refunded');
  await assertRejects(
    () => orderService.deliverOrder(14),
    /Impossible de marquer comme livrée une commande remboursée/,
    'refunded -> delivered is rejected'
  );

  // 4.6 refunded -> cancelled
  seedOrder(15, 'refunded');
  await assertRejects(
    () => orderService.cancelOrder(15),
    /Impossible d'annuler une commande (déjà )?remboursée/,
    'refunded -> cancelled is rejected'
  );

  // Scenario 5: Terminal states cannot return to intermediate statuses via updateOrderStatus
  console.log('\nScenario 5: Terminal states cannot return to intermediate statuses');
  for (const terminalStatus of ['delivered', 'refunded', 'cancelled']) {
    for (const intermediate of ['pending', 'processing', 'completed', 'exchanged']) {
      const orderId = 20 + Math.floor(Math.random() * 100000);
      seedOrder(orderId, terminalStatus);
      await assertRejects(
        () => orderService.updateOrderStatus(orderId, intermediate),
        /(Impossible de modifier le statut|Impossible de confirmer|Le statut "exchanged" ne peut pas être défini directement)/,
        `${terminalStatus} cannot transition back to ${intermediate}`
      );
    }
  }

  // Scenario 6: completed and exchanged can still be cancelled/refunded before delivery
  console.log('\nScenario 6: Pre-delivery intermediate workflows remain fully functional');
  // completed -> cancelled
  seedOrder(30, 'completed');
  const res30 = await orderService.cancelOrder(30);
  assert(res30.status === 'cancelled', 'completed order can be cancelled before delivery');

  // exchanged -> cancelled
  seedOrder(31, 'exchanged');
  const res31 = await orderService.cancelOrder(31);
  assert(res31.status === 'cancelled', 'exchanged order can be cancelled before delivery');

  // completed -> refunded
  seedOrder(32, 'completed');
  const res32 = await orderService.refundOrder(32);
  assert(res32.status === 'refunded', 'completed order can be refunded before delivery');

  // exchanged -> refunded
  seedOrder(33, 'exchanged');
  const res33 = await orderService.refundOrder(33);
  assert(res33.status === 'refunded', 'exchanged order can be refunded before delivery');

  // Scenario 7: Order cannot be exchanged after delivery
  console.log('\nScenario 7: Delivered order cannot be exchanged');
  const deliveredUuid = 'a0000000-0000-4000-8000-000000000040';
  const variantUuid = 'b0000000-0000-4000-8000-000000000001';
  seedOrder(deliveredUuid, 'delivered');
  const validExchangeInput = {
    orderId: deliveredUuid,
    customer: {
      customerName: 'Client Test',
      phoneNumber: '20123456',
      shippingAddress: '123 Rue Test, Tunis',
    },
    items: [
      {
        variantId: variantUuid,
        action: 'keep',
        quantity: 1,
      },
    ],
  };

  await assertRejects(
    () => exchangeService.previewExchange(validExchangeInput),
    /Impossible d'échanger une commande déjà livrée/,
    'previewExchange rejects delivered order'
  );
  await assertRejects(
    () => exchangeService.createExchange(validExchangeInput),
    /Impossible d'échanger une commande déjà livrée/,
    'createExchange rejects delivered order'
  );

  // Scenario 8: Repeated delivery requests are idempotent
  console.log('\nScenario 8: Idempotent delivery transitions');
  seedOrder(50, 'delivered');
  statusUpdateCallCount = 0;

  const res50 = await orderService.deliverOrder(50);
  assert(res50.status === 'delivered', 'Already delivered order returns delivered status');
  assert(statusUpdateCallCount === 0, 'Repository updateStatus was not called on redundant request (idempotent)');

  console.log('\n================================================================');
  console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
