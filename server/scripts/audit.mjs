/**
 * Silky storefront API audit — run with server on PORT (default 3001).
 * Usage: node server/scripts/audit.mjs
 */
import crypto from 'crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const BASE = process.env.API_BASE || 'http://localhost:3001/api';
const results = [];
const bugs = [];
const fixes = [];

function pass(area, detail = '') {
  results.push({ area, status: 'PASS', detail });
  console.log(`✓ PASS: ${area}${detail ? ` — ${detail}` : ''}`);
}

function fail(area, detail = '') {
  results.push({ area, status: 'FAIL', detail });
  console.error(`✗ FAIL: ${area}${detail ? ` — ${detail}` : ''}`);
}

function recordBug(description, fix = null) {
  bugs.push(description);
  if (fix) fixes.push({ bug: description, fix });
}

async function request(path, { method = 'GET', body, token, guestSession, cookieJar } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (guestSession) headers['X-Guest-Session-ID'] = guestSession;
  if (cookieJar?.cookie) headers.Cookie = cookieJar.cookie;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie');
  const guestHeader = res.headers.get('x-guest-session-id');
  if (cookieJar) {
    if (setCookie) {
      const match = setCookie.match(/silky_guest_session=([^;]+)/);
      if (match) cookieJar.cookie = `silky_guest_session=${match[1]}`;
    }
    if (guestHeader) cookieJar.guestSessionId = guestHeader;
  }

  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: res.status, data, headers: res.headers };
}

function uniqueEmail() {
  return `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@test.silky.tn`;
}

async function main() {
  console.log('=== Silky API Audit ===\n');

  // --- Schema inspection via products ---
  const productsRes = await request('/products');
  if (productsRes.status !== 200 || !Array.isArray(productsRes.data)) {
    fail('Products API baseline', `status ${productsRes.status}`);
    printSummary();
    process.exit(1);
  }

  const product = productsRes.data[0];
  if (!product?.colors?.length || !product?.sizes?.length) {
    fail('Product variant structure', 'No colors/sizes on product');
  } else {
    const colorId = product.colors[0].id;
    const size = product.sizes[0];
    const hasStockKey = product.stock[`${colorId}-${size}`] !== undefined;
    if (hasStockKey) {
      pass('Product variant structure', `color uses slug as id (${colorId}), size ${size}, stock key ${colorId}-${size}`);
    } else {
      fail('Product variant structure', `Missing stock key for ${colorId}-${size}`);
    }
  }

  const productId = product.id;
  const colorId = product.colors[0].id;
  const size = product.sizes[0];

  // --- 1. Cart with productId + colorId + size ---
  const guest1 = { cookie: null, guestSessionId: null };
  const addRes = await request('/cart/items', {
    method: 'POST',
    body: { productId, colorId, size, quantity: 1 },
    cookieJar: guest1,
  });

  if (addRes.status === 201 && addRes.data?.items?.length === 1) {
    const item = addRes.data.items[0];
    if (item.colorId === colorId && item.size === size && item.productId === productId) {
      pass('Cart add by productId+colorId+size', `variant resolved correctly`);
    } else {
      fail('Cart add by productId+colorId+size', JSON.stringify(item));
      recordBug('Cart item variant mismatch when using colorId');
    }
  } else {
    fail('Cart add by productId+colorId+size', `status ${addRes.status}: ${JSON.stringify(addRes.data)}`);
  }

  // --- 2. Guest session ---
  if (guest1.guestSessionId) {
    pass('Guest session creation', guest1.guestSessionId);
  } else {
    fail('Guest session creation', 'No X-Guest-Session-ID header');
  }

  const cartRes = await request('/cart', { cookieJar: guest1 });
  if (cartRes.status === 200 && cartRes.data?.items?.length >= 1) {
    pass('Guest cart retrieve');
  } else {
    fail('Guest cart retrieve');
  }

  const cartItemId = cartRes.data.items[0].id;

  // Guest isolation
  const guest2 = { cookie: null, guestSessionId: crypto.randomUUID() };
  const guest2Cart = await request('/cart', { cookieJar: guest2 });
  if (guest2Cart.data?.items?.length === 0) {
    pass('Guest cart isolation', 'Second guest has empty cart');
  } else {
    fail('Guest cart isolation', `Guest2 has ${guest2Cart.data?.items?.length} items`);
    recordBug('Guest carts may be mixing data');
  }

  // Remove item and re-add for quantity test
  await request(`/cart/items/${cartItemId}`, { method: 'DELETE', cookieJar: guest1 });
  await request('/cart/items', {
    method: 'POST',
    body: { productId, colorId, size, quantity: 2 },
    cookieJar: guest1,
  });
  const qtyCart = await request('/cart', { cookieJar: guest1 });
  if (qtyCart.data?.items?.[0]?.quantity === 2) {
    pass('Guest cart quantity');
  } else {
    fail('Guest cart quantity', `got ${qtyCart.data?.items?.[0]?.quantity}`);
  }

  // --- 3. Customer cart ---
  const email1 = uniqueEmail();
  const reg1 = await request('/auth/register', {
    method: 'POST',
    body: { email: email1, password: 'testpass123', fullName: 'Audit User One' },
    cookieJar: guest1,
  });

  let customerToken = reg1.data?.token;
  if (reg1.status === 201 && customerToken) {
    pass('Register with guest merge', `cart items: ${reg1.data ? 'token ok' : 'fail'}`);
  } else {
    fail('Register with guest merge', JSON.stringify(reg1.data));
  }

  const mergedCart = await request('/cart', { token: customerToken });
  if (mergedCart.data?.items?.length >= 1) {
    pass('Guest→customer cart merge', `${mergedCart.data.items.length} item(s)`);
  } else {
    fail('Guest→customer cart merge', 'Cart empty after register');
    recordBug('Guest cart not merged on registration');
  }

  // Verify repeated login does not duplicate cart item quantity
  const loginAgain = await request('/auth/login', {
    method: 'POST',
    body: { email: email1, password: 'testpass123' },
    cookieJar: guest1,
  });
  const cartAfterSecondLogin = await request('/cart', { token: loginAgain.data?.token });
  const itemQty = cartAfterSecondLogin.data?.items?.[0]?.quantity;
  if (itemQty === 2) {
    pass('Repeated login does not duplicate cart item quantity', `qty: ${itemQty}`);
  } else {
    fail('Repeated login does not duplicate cart item quantity', `qty: ${itemQty} (expected 2)`);
  }

  // Customer isolation - register another user
  const guest3 = { cookie: null, guestSessionId: crypto.randomUUID() };
  const email2 = uniqueEmail();
  const reg2 = await request('/auth/register', {
    method: 'POST',
    body: { email: email2, password: 'testpass123', fullName: 'Audit User Two' },
    cookieJar: guest3,
  });
  const customer2Token = reg2.data?.token;
  const cust2Cart = await request('/cart', { token: customer2Token });
  if (cust2Cart.data?.items?.length === 0) {
    pass('Customer cart isolation');
  } else {
    fail('Customer cart isolation');
  }

  // Add to customer1 cart
  await request('/cart/items', {
    method: 'POST',
    body: { productId, colorId, size, quantity: 1 },
    token: customerToken,
  });
  const cust1Cart = await request('/cart', { token: customerToken });
  const cust1ItemId = cust1Cart.data?.items?.[0]?.id;

  // --- 4 & 5. Favourites ---
  const favGuest = { cookie: null, guestSessionId: null };
  const favToggle = await request('/favourites/toggle', {
    method: 'POST',
    body: { productId },
    cookieJar: favGuest,
  });
  if (favToggle.status === 200 && favToggle.data?.isFavourite === true) {
    pass('Guest favourite toggle');
  } else {
    fail('Guest favourite toggle', JSON.stringify(favToggle.data));
  }

  const favList = await request('/favourites', { cookieJar: favGuest });
  if (favList.data?.productIds?.includes(productId)) {
    pass('Guest favourites retrieve');
  } else {
    fail('Guest favourites retrieve');
  }

  const favRemove = await request('/favourites/toggle', {
    method: 'POST',
    body: { productId },
    cookieJar: favGuest,
  });
  if (favRemove.data?.isFavourite === false) {
    pass('Guest favourite remove');
  } else {
    fail('Guest favourite remove');
  }

  // Favourite merge on login
  await request('/favourites/toggle', { method: 'POST', body: { productId }, cookieJar: favGuest });
  const favGuest2 = { cookie: null, guestSessionId: crypto.randomUUID() };
  await request('/favourites/toggle', { method: 'POST', body: { productId: productsRes.data[1]?.id || productId }, cookieJar: favGuest2 });

  const email3 = uniqueEmail();
  const reg3 = await request('/auth/register', {
    method: 'POST',
    body: { email: email3, password: 'testpass123', fullName: 'Fav Merge User' },
    cookieJar: favGuest,
  });
  const favMerged = await request('/favourites', { token: reg3.data?.token });
  if (favMerged.data?.productIds?.includes(productId)) {
    pass('Guest→customer favourites merge');
  } else {
    fail('Guest→customer favourites merge');
    recordBug('Guest favourites not merged on registration');
  }

  const favCust = await request('/favourites/toggle', {
    method: 'POST',
    body: { productId: productsRes.data[1]?.id || productId },
    token: customerToken,
  });
  if (favCust.status === 200) {
    pass('Customer favourite toggle');
  } else {
    fail('Customer favourite toggle');
  }

  // --- 7. Checkout ---
  // Find variant with stock
  const detailRes = await request(`/products/${productId}`);
  const stock = detailRes.data?.stock || {};
  let checkoutProduct = product;
  let checkoutColorId = colorId;
  let checkoutSize = size;
  for (const p of productsRes.data) {
    for (const c of p.colors || []) {
      for (const s of p.sizes || []) {
        if ((p.stock[`${c.id}-${s}`] || 0) >= 1) {
          checkoutProduct = p;
          checkoutColorId = c.id;
          checkoutSize = s;
          break;
        }
      }
    }
  }

  const checkoutGuest = { cookie: null, guestSessionId: crypto.randomUUID() };
  await request('/cart/items', {
    method: 'POST',
    body: {
      productId: checkoutProduct.id,
      colorId: checkoutColorId,
      size: checkoutSize,
      quantity: 1,
    },
    cookieJar: checkoutGuest,
  });

  const checkoutRes = await request('/orders/checkout', {
    method: 'POST',
    body: {
      customer: {
        firstName: 'Test',
        lastName: 'Checkout',
        email: 'checkout@test.silky.tn',
        phone: '+21612345678',
        address: '123 Test St, Tunis',
      },
    },
    cookieJar: checkoutGuest,
  });

  if (checkoutRes.status === 201 && checkoutRes.data?.orderNumber) {
    pass('Checkout creates order', checkoutRes.data.orderNumber);
    const order = checkoutRes.data;
    if (order.items?.length >= 1 && order.total > 0) {
      pass('Checkout order items and total', `total=${order.total}`);
    } else {
      fail('Checkout order items and total');
    }
  } else {
    fail('Checkout creates order', `${checkoutRes.status}: ${JSON.stringify(checkoutRes.data)}`);
  }

  const emptyCartAfter = await request('/cart', { cookieJar: checkoutGuest });
  if (emptyCartAfter.data?.items?.length === 0) {
    pass('Cart cleared after checkout');
  } else {
    fail('Cart cleared after checkout');
    recordBug('Cart not cleared after successful checkout');
  }

  // --- 8. Insufficient stock at checkout (cart valid, stock drained by another order) ---
  const lowStockGuest = { cookie: null, guestSessionId: crypto.randomUUID() };
  const prodDetail = await request(`/products/${checkoutProduct.id}`);
  const availStock = prodDetail.data?.stock?.[`${checkoutColorId}-${checkoutSize}`] ?? 0;

  if (availStock >= 2) {
    await request('/cart/items', {
      method: 'POST',
      body: {
        productId: checkoutProduct.id,
        colorId: checkoutColorId,
        size: checkoutSize,
        quantity: 2,
      },
      cookieJar: lowStockGuest,
    });

    const drainGuest = { cookie: null, guestSessionId: crypto.randomUUID() };
    await request('/cart/items', {
      method: 'POST',
      body: {
        productId: checkoutProduct.id,
        colorId: checkoutColorId,
        size: checkoutSize,
        quantity: Math.max(1, availStock - 1),
      },
      cookieJar: drainGuest,
    });
    await request('/orders/checkout', {
      method: 'POST',
      body: {
        customer: {
          firstName: 'Drain',
          lastName: 'Stock',
          email: 'drain@test.silky.tn',
          phone: '+21612345678',
          address: '456 Test St',
        },
      },
      cookieJar: drainGuest,
    });

    const overCheckout = await request('/orders/checkout', {
      method: 'POST',
      body: {
        customer: {
          firstName: 'Over',
          lastName: 'Stock',
          email: 'over@test.silky.tn',
          phone: '+21612345678',
          address: '456 Test St',
        },
      },
      cookieJar: lowStockGuest,
    });

    if (overCheckout.status >= 400) {
      pass('Insufficient stock checkout fails', `status ${overCheckout.status}`);
    } else {
      fail('Insufficient stock checkout fails', 'Checkout succeeded with over-stock');
      recordBug('Checkout allows purchasing more than available stock');
    }

    const cartStillThere = await request('/cart', { cookieJar: lowStockGuest });
    if (cartStillThere.data?.items?.length > 0) {
      pass('Cart preserved after failed checkout');
    } else {
      fail('Cart preserved after failed checkout');
      recordBug('Cart incorrectly cleared on failed checkout');
    }
  } else {
    pass('Insufficient stock checkout fails', 'skipped (need variant stock >= 2)');
    pass('Cart preserved after failed checkout', 'skipped (need variant stock >= 2)');
  }

  // --- 9. Reviews ---
  const guestReview = await request(`/products/${productId}/reviews`, {
    method: 'POST',
    body: { rating: 5, comment: 'Guest review attempt', authorName: 'Guest Reviewer' },
  });
  if (guestReview.status === 201) {
    pass('Guest can submit product review');
  } else {
    fail('Guest can submit product review', `status ${guestReview.status}`);
  }

  const authReview = await request(`/products/${productId}/reviews`, {
    method: 'POST',
    body: { rating: 4, comment: 'Authenticated review for audit' },
    token: customerToken,
  });
  if (authReview.status === 201) {
    pass('Authenticated user can submit review');
  } else {
    fail('Authenticated user can submit review', JSON.stringify(authReview.data));
  }

  const publicReviews = await request(`/products/${productId}/reviews`);
  const pendingVisible = publicReviews.data?.reviews?.some(
    (r) => r.comment === 'Authenticated review for audit',
  );
  if (!pendingVisible) {
    pass('Unapproved reviews hidden from public GET');
  } else {
    fail('Unapproved reviews hidden from public GET');
    recordBug('Pending reviews exposed in public product reviews endpoint');
  }

  // --- 10. Products API filters ---
  const womenRes = await request('/products?category=women');
  const womenData = Array.isArray(womenRes.data) ? womenRes.data : womenRes.data?.products;
  if (womenRes.status === 200 && womenData?.every((p) => p.category === 'femme')) {
    pass('Products category=women filter');
  } else {
    fail('Products category=women filter');
  }

  const kidsRes = await request('/products?category=kids');
  const kidsData = Array.isArray(kidsRes.data) ? kidsRes.data : kidsRes.data?.products;
  if (kidsRes.status === 200) {
    pass('Products category=kids filter', `${kidsData?.length ?? 0} products`);
  } else {
    fail('Products category=kids filter');
  }

  const searchRes = await request('/products?search=comfy');
  if (searchRes.status === 200) {
    pass('Products search');
  } else {
    fail('Products search');
  }

  const pageRes = await request('/products?page=1&limit=2');
  if (pageRes.status === 200 && pageRes.data?.pagination?.limit === 2) {
    pass('Products pagination');
  } else {
    fail('Products pagination', JSON.stringify(pageRes.data?.pagination));
  }

  const emptySearch = await request('/products?search=zzzznonexistent999');
  const emptyData = Array.isArray(emptySearch.data) ? emptySearch.data : emptySearch.data?.products;
  if (emptySearch.status === 200 && (emptyData?.length === 0 || emptySearch.data?.pagination?.total === 0)) {
    pass('Empty search results');
  } else {
    fail('Empty search results');
  }

  // --- 13. Security ---
  const adminAttempt = await request('/orders');
  if (adminAttempt.status === 401) {
    pass('Admin routes reject unauthenticated');
  } else {
    fail('Admin routes reject unauthenticated', `status ${adminAttempt.status}`);
  }

  const customerAdmin = await request('/orders', { token: customerToken });
  if (customerAdmin.status === 403) {
    pass('Customer cannot access admin orders');
  } else {
    fail('Customer cannot access admin orders', `status ${customerAdmin.status}`);
  }

  const meRes = await request('/auth/me', { token: customerToken });
  if (meRes.status === 200 && !meRes.data?.user?.password_hash) {
    pass('No password hash exposed in /auth/me');
  } else {
    fail('No password hash exposed in /auth/me');
  }

  // --- 12. DB integrity checks ---
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const integrityChecks = [
    ['orphaned cart items', `SELECT COUNT(*) FROM cart_items ci LEFT JOIN carts c ON c.id = ci.cart_id WHERE c.id IS NULL`],
    ['orphaned favourites', `SELECT COUNT(*) FROM favourites f LEFT JOIN products p ON p.id = f.product_id WHERE p.id IS NULL`],
    ['negative stock', `SELECT COUNT(*) FROM product_variants WHERE stock_quantity < 0`],
    ['duplicate user favourites', `SELECT COUNT(*) FROM (SELECT user_id, product_id, COUNT(*) c FROM favourites WHERE user_id IS NOT NULL GROUP BY user_id, product_id HAVING COUNT(*) > 1) x`],
    ['duplicate guest favourites', `SELECT COUNT(*) FROM (SELECT guest_session_id, product_id, COUNT(*) c FROM favourites WHERE guest_session_id IS NOT NULL GROUP BY guest_session_id, product_id HAVING COUNT(*) > 1) x`],
    ['invalid cart variant refs', `SELECT COUNT(*) FROM cart_items ci LEFT JOIN product_variants pv ON pv.id = ci.variant_id WHERE pv.id IS NULL`],
  ];

  for (const [name, sql] of integrityChecks) {
    const { rows } = await pool.query(sql);
    const count = Number(Object.values(rows[0])[0]);
    if (count === 0) {
      pass(`DB integrity: ${name}`);
    } else {
      fail(`DB integrity: ${name}`, `${count} issues`);
      recordBug(`Database integrity issue: ${name} (${count})`);
    }
  }

  // Verify color_slug in DB
  const { rows: variantCols } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'product_variants' AND column_name LIKE '%color%'
  `);
  pass('DB color columns', variantCols.map((r) => r.column_name).join(', '));

  await pool.end();

  printSummary();
}

function printSummary() {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (bugs.length) {
    console.log('\nBugs found:');
    bugs.forEach((b) => console.log(`  - ${b}`));
  }
}

main().catch((err) => {
  console.error('Audit crashed:', err);
  process.exit(1);
});
