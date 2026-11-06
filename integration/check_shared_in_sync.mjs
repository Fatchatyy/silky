/**
 * server/shared and storefront/shared are two copies of the same pure modules (prices, delivery fee, locales, texts,
 * URLs, stock rules): the API and the storefront must agree on them, so the copies must stay byte for byte identical.
 * Change a file in one, copy it to the other, and run this check. It reads both folders and nothing else.
 *
 * Usage: node integration/check_shared_in_sync.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = path.join(root, 'server', 'shared');
const b = path.join(root, 'storefront', 'shared');
const norm = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const list = (dir) => fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()).sort();

const problems = [];
const filesA = list(a);
const filesB = list(b);
for (const name of filesA) if (!filesB.includes(name)) problems.push(`${name}: only in server/shared`);
for (const name of filesB) if (!filesA.includes(name)) problems.push(`${name}: only in storefront/shared`);
for (const name of filesA) {
  if (filesB.includes(name) && norm(path.join(a, name)) !== norm(path.join(b, name))) problems.push(`${name}: the two copies differ`);
}

if (problems.length) {
  console.error('✗ FAIL: server/shared and storefront/shared are out of sync:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`✓ PASS: server/shared and storefront/shared are identical (${filesA.length} files)`);
