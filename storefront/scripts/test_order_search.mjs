/**
 * The admin orders search (orderMatchesSearch): order number, id, name, phone, e-mail and the GOODEX tracking code (EAN)
 * match case-insensitively and partially; an empty query matches everything. Pure: hand-made orders in the shape the
 * API returns, no server, no database.
 *
 * Usage: node storefront/scripts/test_order_search.mjs
 */
import { orderMatchesSearch } from '../src/admin-app/utils/orderSearch.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

const ean = 'AB12CD34EF56';
const withParcel = {
  id: '9f8e7d6c-1234-4abc-8def-0123456789ab',
  orderNumber: 'ORD-20261105-00042',
  customer: { firstName: 'Test', lastName: 'Client', phone: '22123456', email: 'test.client@example.com' },
  delivery: { ean },
};
const withoutParcel = {
  id: '11112222-3333-4444-5555-666677778888',
  orderNumber: 'ORD-20261105-00043',
  customer: { firstName: 'Autre', lastName: 'Personne', phone: '99887766' },
  delivery: null,
};
const otherParcel = { ...withoutParcel, id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111', delivery: { ean: 'ZZ99YY88XX77' } };

assert(orderMatchesSearch(withParcel, ean), 'search: full EAN matches');
assert(orderMatchesSearch(withParcel, ean.slice(2, 8)) && orderMatchesSearch(withParcel, ean.slice(-4)), 'search: partial EAN (middle, suffix) matches');
assert(orderMatchesSearch(withParcel, ean.toLowerCase()) && orderMatchesSearch(withParcel, `  ${ean.toLowerCase()}  `), 'search: EAN is case-insensitive and trimmed');
assert(
  orderMatchesSearch(withParcel, withParcel.orderNumber.slice(-5)) && orderMatchesSearch(withParcel, withParcel.customer.phone)
    && orderMatchesSearch(withParcel, 'test cli') && orderMatchesSearch(withParcel, withParcel.id.slice(0, 8)) && orderMatchesSearch(withParcel, 'client@example'),
  'search: order number, phone, name, id and e-mail work',
);
assert(!orderMatchesSearch(withParcel, 'zzz-no-match') && orderMatchesSearch(withParcel, '') && orderMatchesSearch(withParcel, '   '), 'search: no false positive; empty query matches all');
assert(!orderMatchesSearch(withoutParcel, ean) && orderMatchesSearch(withoutParcel, withoutParcel.orderNumber), 'search: orders without a parcel do not break and do not match an EAN');
assert(!orderMatchesSearch(otherParcel, ean), 'search: another order does not match this EAN');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
