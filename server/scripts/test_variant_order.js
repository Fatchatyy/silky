/**
 * Order of a product's variants (the size buttons and the preselected size on the product page).
 * Variants of one product used to share one created_at, so their order was the physical order of the rows and moved
 * whenever a stock update rewrote a row. product_variants.position now fixes it:
 *   - a new product stores the order entered in the admin; an edit that changes the order stores the new one, an
 *     edit that changes nothing rewrites no variant row;
 *   - changing stock (admin inventory, or any UPDATE of the row) never changes the order;
 *   - the migration gives products without positions a natural order (36, 38, 40 / XS..XXL), once, and leaves
 *     products that already have positions alone.
 *
 * Safety: refuses to run unless DATABASE_URL is exactly "silky_test" on a loopback host (helpers/silky_test_guard.js).
 * UPLOADS_DIR is a temp folder, only built-in /pictures images are used, and every inserted row is removed at the end.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_variant_order.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-variant-order-'));
process.env.GOODEX_ENABLE_LIVE = 'false';

const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products } = await import('../models/index.js');
const { runVariantPositionMigration } = await import('../db/migrations/add_variant_position.js');
const productService = await import('../services/product.service.js');
const inventoryService = await import('../services/inventory.service.js');
const { productRepository } = await import('../repositories/product.repository.js');

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

const marker = `varorder${crypto.randomBytes(4).toString('hex')}`;
const created = { categoryId: null, productIds: [] };
const sizesOf = (product) => product.sizes.join(',');
const variantKeys = (product) => product.variants.map((v) => `${v.colorSlug}-${v.size}`).join(' ');
const rewrite = async (productId) => pool.query('update product_variants set stock_quantity = stock_quantity where product_id = $1', [productId]);
const stamps = async (productId) => (await pool.query('select id, xmin::text as x from product_variants where product_id = $1 order by id', [productId])).rows.map((r) => `${r.id}:${r.x}`).join('|');

try {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);
  const [category] = await db.insert(categories).values({ name: `Cat ${marker}`, slug: marker }).returning();
  created.categoryId = category.id;

  const payload = (name, sizes, extra = {}) => ({
    name,
    slug: `${marker}-${name.toLowerCase().replace(/\W+/g, '-')}`,
    description: `Description ${name}`,
    category: category.slug,
    categoryId: category.id,
    price: 50,
    collectionImage: '/pictures/blushmarron.jpg',
    colors: [
      { id: 'noir', name: 'Noir', image: '/pictures/blushmarron.jpg', gallery: [] },
      { id: 'rouge', name: 'Rouge', image: '/pictures/blushmarron.jpg', gallery: [] },
    ],
    sizes,
    stock: Object.fromEntries(['noir', 'rouge'].flatMap((c) => sizes.map((s) => [`${c}-${s}`, 5]))),
    ...extra,
  });

  console.log('\n--- A new product keeps the order entered in the admin ---');
  const product = await productService.createProduct(payload('Robe Ordre', ['38', '36', '40']));
  created.productIds.push(product.id);
  assert(sizesOf(product) === '38,36,40', 'sizes come back in the order they were entered (38, 36, 40)');
  assert(variantKeys(product) === 'noir-38 noir-36 noir-40 rouge-38 rouge-36 rouge-40', 'variants are listed colour by colour, in the entered size order');
  const positions = (await pool.query('select "position" from product_variants where product_id = $1 order by "position"', [product.id])).rows.map((r) => r.position);
  assert(positions.join() === '0,1,2,3,4,5', 'positions are 0..5 with no gaps');

  console.log('\n--- Changing stock never changes the order ---');
  const before = variantKeys(await productService.getProductById(product.id));
  for (const variant of product.variants) await inventoryService.updateVariantStock(variant.id, 9);
  await rewrite(product.id);
  await rewrite(product.id);
  const afterStock = await productService.getProductById(product.id);
  assert(variantKeys(afterStock) === before && sizesOf(afterStock) === '38,36,40', 'inventory updates and repeated row rewrites leave the order as it was');
  const listed = (await productRepository.findAll({ includeHidden: true })).find((p) => p.id === product.id);
  assert(JSON.stringify(listed) === JSON.stringify(afterStock), 'the product list shows the same order as the product page');

  console.log('\n--- Editing ---');
  const stampsBefore = await stamps(product.id);
  await productService.updateProduct(product.id, payload('Robe Ordre', ['38', '36', '40'], { description: 'Nouvelle description', stock: Object.fromEntries(['noir', 'rouge'].flatMap((c) => ['38', '36', '40'].map((s) => [`${c}-${s}`, 9]))) }));
  assert((await stamps(product.id)) === stampsBefore, 'an edit that changes neither sizes, colours nor stock rewrites no variant row');
  const withNew = await productService.updateProduct(product.id, payload('Robe Ordre', ['38', '36', '40', '42'], { stock: Object.fromEntries(['noir', 'rouge'].flatMap((c) => ['38', '36', '40', '42'].map((s) => [`${c}-${s}`, 9]))) }));
  assert(sizesOf(withNew) === '38,36,40,42', 'a size added in the editor is listed after the existing ones');
  const reordered = await productService.updateProduct(product.id, payload('Robe Ordre', ['36', '38', '40', '42'], { stock: Object.fromEntries(['noir', 'rouge'].flatMap((c) => ['36', '38', '40', '42'].map((s) => [`${c}-${s}`, 9]))) }));
  assert(sizesOf(reordered) === '36,38,40,42' && variantKeys(reordered).startsWith('noir-36 noir-38 noir-40 noir-42 rouge-36'), 'reordering the sizes in the editor changes the order');
  await rewrite(product.id);
  assert(sizesOf(await productService.getProductById(product.id)) === '36,38,40,42', 'and the new order also survives stock updates');

  console.log('\n--- Migration: products without positions ---');
  const legacy = await productService.createProduct(payload('Robe Ancienne', ['S']));
  created.productIds.push(legacy.id);
  // Rebuild what an old product looks like: mixed sizes in a scrambled order, no positions, one shared created_at.
  await pool.query('delete from product_variants where product_id = $1', [legacy.id]);
  const scrambled = ['44', '36', '40', '38', '42'];
  for (const size of scrambled) {
    await pool.query(
      `insert into product_variants (product_id, size, color_slug, color_name, stock_quantity, sku, created_at, "position")
       values ($1, $2, 'noir', 'Noir', 3, $3, '2026-01-01T00:00:00Z', null)`,
      [legacy.id, size, `${marker}-LEG-${size}`.toUpperCase()],
    );
  }
  const letters = await productService.createProduct(payload('Robe Lettres', ['S']));
  created.productIds.push(letters.id);
  await pool.query('delete from product_variants where product_id = $1', [letters.id]);
  for (const size of ['XL', 'S', 'M', 'XXL', 'L']) {
    await pool.query(
      `insert into product_variants (product_id, size, color_slug, color_name, stock_quantity, sku, created_at, "position")
       values ($1, $2, 'noir', 'Noir', 3, $3, '2026-01-01T00:00:00Z', null)`,
      [letters.id, size, `${marker}-LET-${size}`.toUpperCase()],
    );
  }
  const keptOrder = await productService.getProductById(product.id);
  await runVariantPositionMigration(pool);
  assert(sizesOf(await productService.getProductById(legacy.id)) === '36,38,40,42,44', 'numeric sizes are put in ascending order');
  assert(sizesOf(await productService.getProductById(letters.id)) === 'S,M,L,XL,XXL', 'letter sizes are put in the usual order');
  assert(variantKeys(await productService.getProductById(product.id)) === variantKeys(keptOrder), 'a product that already has positions is not reordered');
  const legacyStamps = await stamps(legacy.id);
  await runVariantPositionMigration(pool);
  assert((await stamps(legacy.id)) === legacyStamps, 'running the migration again changes nothing');
  await rewrite(legacy.id);
  assert(sizesOf(await productService.getProductById(legacy.id)) === '36,38,40,42,44', 'the migrated order survives stock updates');
  const nulls = (await pool.query('select count(*)::int as n from product_variants where "position" is null')).rows[0].n;
  assert(nulls === 0, 'no variant in the database is left without a position');
} finally {
  console.log('\n--- Cleanup ---');
  try {
    if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
    if (created.categoryId) await db.delete(categories).where(eq(categories.id, created.categoryId));
    const left = created.productIds.length ? await db.select({ id: products.id }).from(products).where(inArray(products.id, created.productIds)) : [];
    assert(left.length === 0, 'every inserted row was removed');
  } catch (err) {
    failed++;
    console.error('✗ FAIL: cleanup error:', err.message);
  }
  await pool.end().catch(() => {});
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
