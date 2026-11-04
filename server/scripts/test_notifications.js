import http from 'http';
import '../config/env.js';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { runNotificationsMigration } from '../db/migrations/add_notifications.js';
import { runExchangesMigration } from '../db/migrations/add_exchanges.js';
import { runRefundsMigration } from '../db/migrations/add_refunds.js';
import { runAnnouncementsMigration } from '../db/migrations/add_announcements.js';
import { runFavouritesVariantMigration } from '../db/migrations/add_favourites_variant.js';
import { runIdempotencyKeysMigration } from '../db/migrations/add_idempotency_keys.js';
import { notificationRepository } from '../repositories/notification.repository.js';
import * as adminService from '../services/admin.service.js';
import * as orderService from '../services/order.service.js';

let passed = 0;
let failed = 0;
let server;
let BASE = '';

function assert(condition, message) {
  if (condition) {
    console.log('  ✓ ' + message);
    passed++;
  } else {
    console.error('  ✗ ' + message);
    failed++;
  }
}

async function request(endpoint, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(BASE + endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: res.status, data };
}

async function runTests() {
  console.log('\n=== Starting Admin Dashboard Notification System Verification Tests ===\n');

  // 1. Run migrations
  await runExchangesMigration(pool);
  await runRefundsMigration(pool);
  await runAnnouncementsMigration(pool);
  await runFavouritesVariantMigration(pool);
  await runIdempotencyKeysMigration(pool);
  await runNotificationsMigration(pool);

  // Clean notifications table before test
  await pool.query('DELETE FROM admin_notifications');

  // Start HTTP server
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      BASE = `http://127.0.0.1:${port}/api`;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // Setup: Get Admin and Customer Tokens, and a Product Variant
    // -------------------------------------------------------------------------
    console.log('--- 1. Authentication & Access Control ---');

    const adminLoginRes = await request('/admin/login', {
      method: 'POST',
      body: { password: process.env.ADMIN_PASSWORD || 'admin123' },
    });
    assert(adminLoginRes.status === 200, 'Admin login succeeds');
    const adminToken = adminLoginRes.data?.token;

    // Register a customer
    const ts = Date.now();
    const customerEmail = `customer.test.${ts}@example.com`;
    const customerRegisterRes = await request('/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Client Test',
        email: customerEmail,
        password: 'Password123!',
      },
    });
    assert(customerRegisterRes.status === 201, 'Customer register succeeds');
    const customerToken = customerRegisterRes.data?.token;
    const customerUserId = customerRegisterRes.data?.user?.id;

    // Test access control on notification endpoints
    const unauthRes = await request('/notifications');
    assert(unauthRes.status === 401, 'Guest request to /api/notifications returns 401');

    const customerAccessRes = await request('/notifications', { token: customerToken });
    assert(customerAccessRes.status === 403, 'Customer request to /api/notifications returns 403');

    const adminAccessRes = await request('/notifications', { token: adminToken });
    assert(adminAccessRes.status === 200, 'Admin request to /api/notifications returns 200');
    assert(adminAccessRes.data?.unreadCount === 0, 'Initial unreadCount is 0');
    assert(Array.isArray(adminAccessRes.data?.notifications), 'Initial notifications is an array');

    // Fetch an active product variant for ordering & product review
    const { rows: variants } = await pool.query(`
      SELECT pv.id, pv.product_id, pv.stock_quantity, p.title
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE p.is_active = TRUE AND pv.stock_quantity > 5
      LIMIT 1
    `);

    if (!variants.length) {
      throw new Error('No active product variant with sufficient stock found for testing');
    }
    const testVariant = variants[0];
    const testProductId = testVariant.product_id;

    // -------------------------------------------------------------------------
    // Test 2: Customer Web Order Notification
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Customer Order Notification ---');
    const custOrder = await orderService.createOrder({
      customer: {
        name: 'Client Test',
        email: customerEmail,
        phone: '12345678',
        address: 'Rue Test 123, Tunis',
      },
      items: [{ variantId: testVariant.id, quantity: 1 }],
      userId: customerUserId,
      guestSessionId: null,
      orderSource: 'web',
    });
    assert(!!custOrder?.id, `Customer order created: ${custOrder.orderNumber}`);

    const { rows: orderNotifs } = await pool.query(
      'SELECT * FROM admin_notifications WHERE order_id = $1',
      [custOrder.id]
    );
    assert(orderNotifs.length === 1, 'Exactly one notification created for customer order');
    assert(orderNotifs[0].type === 'order', 'Notification type is "order"');
    assert(orderNotifs[0].is_read === false, 'Notification is_read is false');
    assert(orderNotifs[0].user_id === customerUserId, 'Notification user_id matches customer');
    assert(orderNotifs[0].title.includes('Nouvelle commande'), 'Title contains "Nouvelle commande"');
    assert(orderNotifs[0].message.includes('Client'), 'Message identifies as Client');

    // -------------------------------------------------------------------------
    // Test 3: Guest Web Order Notification
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Guest Order Notification ---');
    const guestOrder = await orderService.createOrder({
      customer: {
        name: 'Invité Silky',
        email: 'invite@example.com',
        phone: '98765432',
        address: 'Sousse Centre',
      },
      items: [{ variantId: testVariant.id, quantity: 1 }],
      userId: null,
      guestSessionId: '11111111-1111-4111-8111-111111111111',
      orderSource: 'web',
    });
    assert(!!guestOrder?.id, `Guest order created: ${guestOrder.orderNumber}`);

    const { rows: guestNotifs } = await pool.query(
      'SELECT * FROM admin_notifications WHERE order_id = $1',
      [guestOrder.id]
    );
    assert(guestNotifs.length === 1, 'Exactly one notification created for guest order');
    assert(guestNotifs[0].type === 'order', 'Guest notification type is "order"');
    assert(guestNotifs[0].user_id === null, 'Guest notification user_id is null');
    assert(guestNotifs[0].message.includes('Invité'), 'Message identifies as Invité');

    // -------------------------------------------------------------------------
    // Test 4: Admin Manual Order -> NO Notification Created
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Admin Manual Order Exclusion ---');
    const manualOrder = await adminService.createManualOrder({
      customerName: 'Admin Manual Client',
      phoneNumber: '55555555',
      orderSource: 'phone',
      governorate: 'Tunis',
      shippingAddress: 'Rue de la Liberté',
      items: [{ variantId: testVariant.id, quantity: 1 }],
    });
    assert(!!manualOrder?.id, `Admin manual order created: ${manualOrder.orderNumber}`);

    const { rows: manualNotifs } = await pool.query(
      'SELECT * FROM admin_notifications WHERE order_id = $1',
      [manualOrder.id]
    );
    assert(manualNotifs.length === 0, 'ZERO notifications created for admin manual order');

    // -------------------------------------------------------------------------
    // Test 5: Store Review Notification (Leave Review Page)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Store Review Notification ---');
    const storeReviewRes = await request('/reviews', {
      method: 'POST',
      token: customerToken, // only a logged-in customer can write a review; the name is the account's
      body: {
        rating: 5,
        body: 'Magnifique qualité de soie ! Très satisfaite.',
      },
    });
    assert(storeReviewRes.status === 201, 'Store review submitted with 201');
    const storeReviewId = storeReviewRes.data?.id;

    const { rows: storeReviewNotifs } = await pool.query(
      'SELECT * FROM admin_notifications WHERE review_id = $1',
      [storeReviewId]
    );
    assert(storeReviewNotifs.length === 1, 'Exactly one notification created for store review');
    assert(storeReviewNotifs[0].type === 'review', 'Notification type is "review"');
    assert(storeReviewNotifs[0].product_id === null, 'Store review notification product_id is null');
    assert(storeReviewNotifs[0].title.includes('Nouvel avis client'), 'Title contains "Nouvel avis client"');
    assert(storeReviewNotifs[0].message.includes('Client Test'), 'Message contains the account name');

    // -------------------------------------------------------------------------
    // Test 6: Product Review Notification (Product Page)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Product Review Notification ---');
    const productReviewRes = await request(`/products/${testProductId}/reviews`, {
      method: 'POST',
      token: customerToken,
      body: {
        rating: 4,
        comment: 'Très belle coupe et finition soignée.',
      },
    });
    assert(productReviewRes.status === 201, 'Product review submitted with 201');
    const productReviewId = productReviewRes.data?.id;

    const { rows: prodReviewNotifs } = await pool.query(
      'SELECT * FROM admin_notifications WHERE review_id = $1',
      [productReviewId]
    );
    assert(prodReviewNotifs.length === 1, 'Exactly one notification created for product review');
    assert(prodReviewNotifs[0].type === 'product_review', 'Notification type is "product_review"');
    assert(prodReviewNotifs[0].product_id === testProductId, 'Notification contains correct product_id');
    assert(prodReviewNotifs[0].title.includes('Nouvel avis produit'), 'Title contains "Nouvel avis produit"');

    // -------------------------------------------------------------------------
    // Test 7: Contact Message Notification
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Contact Message Notification ---');
    const contactRes = await request('/contact', {
      method: 'POST',
      body: {
        firstName: 'Yassine',
        lastName: 'Trabelsi',
        email: 'yassine@example.com',
        message: 'Bonjour, avez-vous des tailles personnalisées ?',
      },
    });
    assert(contactRes.status === 201, 'Contact message submitted with 201');
    const contactMsgId = contactRes.data?.id;

    const { rows: contactNotifs } = await pool.query(
      'SELECT * FROM admin_notifications WHERE contact_message_id = $1',
      [contactMsgId]
    );
    assert(contactNotifs.length === 1, 'Exactly one notification created for contact message');
    assert(contactNotifs[0].type === 'contact_message', 'Notification type is "contact_message"');
    assert(contactNotifs[0].title.includes('Nouveau message'), 'Title contains "Nouveau message"');
    assert(contactNotifs[0].message.includes('Yassine Trabelsi'), 'Message contains sender full name');

    // -------------------------------------------------------------------------
    // Test 8: Deduplication & Idempotency
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Database Deduplication & Idempotency ---');
    // Attempt duplicate insertion of custOrder notification
    const dupRes = await notificationRepository.createNotification({
      type: 'order',
      title: 'Duplicate Order',
      message: 'Duplicate Message',
      orderId: custOrder.id,
    });
    assert(dupRes === null, 'Duplicate order notification insertion returns null via onConflictDoNothing');

    const { rows: dupCheckRows } = await pool.query(
      'SELECT COUNT(*)::int as count FROM admin_notifications WHERE order_id = $1',
      [custOrder.id]
    );
    assert(dupCheckRows[0].count === 1, 'Total notifications for custOrder is strictly 1');

    // -------------------------------------------------------------------------
    // Test 9: Read State & Notification Endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Notification Endpoints & Read State Management ---');
    const listRes1 = await request('/notifications', { token: adminToken });
    assert(listRes1.status === 200, 'GET /api/notifications returns 200');
    assert(listRes1.data?.unreadCount === 5, `Unread count is 5 (Got: ${listRes1.data?.unreadCount})`);
    assert(listRes1.data?.notifications?.length === 5, 'Returns latest 5 notifications');

    // Verify ordering is newest first
    const nList = listRes1.data?.notifications || [];
    let isOrdered = true;
    for (let i = 0; i < nList.length - 1; i++) {
      if (new Date(nList[i].createdAt) < new Date(nList[i + 1].createdAt)) {
        isOrdered = false;
        break;
      }
    }
    assert(isOrdered, 'Notifications are returned newest first');

    // Mark single notification as read
    const targetNotifId = nList[0].id;
    const markOneRes = await request(`/notifications/${targetNotifId}/read`, {
      method: 'PATCH',
      token: adminToken,
    });
    assert(markOneRes.status === 200, 'PATCH /api/notifications/:id/read returns 200');
    assert(markOneRes.data?.notification?.isRead === true, 'Single notification marked isRead = true');

    const listRes2 = await request('/notifications', { token: adminToken });
    assert(listRes2.data?.unreadCount === 4, `Unread count decremented to 4 (Got: ${listRes2.data?.unreadCount})`);

    // Verify paginated all notifications
    const allRes = await request('/notifications/all?offset=0&limit=3', { token: adminToken });
    assert(allRes.status === 200, 'GET /api/notifications/all returns 200');
    assert(allRes.data?.total === 5, `Total in /all is 5 (Got: ${allRes.data?.total})`);
    assert(allRes.data?.notifications?.length === 3, 'Limit 3 returns 3 notifications');
    assert(allRes.data?.unreadCount === 4, 'Unread count preserved in /all');

    // Mark all as read
    const markAllRes = await request('/notifications/read-all', {
      method: 'POST',
      token: adminToken,
    });
    assert(markAllRes.status === 200, 'POST /api/notifications/read-all returns 200');

    const listRes3 = await request('/notifications', { token: adminToken });
    assert(listRes3.data?.unreadCount === 0, `Unread count is now 0 (Got: ${listRes3.data?.unreadCount})`);
    assert(listRes3.data?.notifications?.every((n) => n.isRead === true), 'All notifications have isRead = true');

    // -------------------------------------------------------------------------
    // Test 10: Failure Resilience (Invalid Requests -> No Notifications)
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Failure Scenarios (No Notifications on Invalid Operations) ---');
    const preCount = (await pool.query('SELECT count(*)::int from admin_notifications')).rows[0].count;

    // Invalid review
    const badReview = await request('/reviews', { method: 'POST', body: {} });
    assert(badReview.status === 400, 'Empty review rejected with 400');

    // Invalid contact
    const badContact = await request('/contact', { method: 'POST', body: { message: '' } });
    assert(badContact.status === 400, 'Empty contact message rejected with 400');

    const postCount = (await pool.query('SELECT count(*)::int from admin_notifications')).rows[0].count;
    assert(preCount === postCount, 'No notifications created for failed operations');

  } catch (err) {
    console.error('\n[FATAL TEST ERROR]:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n========================================');
  console.log(`NOTIFICATION TESTS SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
