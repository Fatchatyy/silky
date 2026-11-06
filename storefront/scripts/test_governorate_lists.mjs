/**
 * The governorate lists of the checkout forms (Checkout.jsx, BuyNowModal.jsx, and the admin order forms) hold exactly the
 * 24 names that have an Arabic label in shared/messages.js (the server test checks those same 24 against its own list).
 * Pure: reads source files only, no server, no database.
 *
 * Usage: node storefront/scripts/test_governorate_lists.mjs
 */
import fs from 'node:fs';
import { GOVERNORATES_AR } from '../shared/messages.js';

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

const expected = Object.keys(GOVERNORATES_AR).sort();
assert(expected.length === 24, 'the Arabic labels cover 24 governorates');
for (const file of ['src/screens/Checkout.jsx', 'src/components/BuyNowModal.jsx']) {
  const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const listed = [...text.match(/TUNISIAN_GOVERNORATES = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(listed) === JSON.stringify(expected), `${file}: governorate list matches the Arabic labels`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
