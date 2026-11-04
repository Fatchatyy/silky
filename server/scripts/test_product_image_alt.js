/**
 * Custom alt text of a product's photos (columns products.image_alt / image_alt_ar): the startup migration is
 * idempotent, the product service stores (trimmed), keeps, clears and bounds it, and the API shape exposes it as
 * imageAlt / imageAltAr (null when missing).
 *
 * Safety: refuses to run unless DATABASE_URL is exactly "silky_test" on a loopback host (helpers/silky_test_guard.js).
 * UPLOADS_DIR is a fresh temp folder; every row inserted is removed in a finally block and the cleanup is verified.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_product_image_alt.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-image-alt-'));
process.env.UPLOADS_DIR = uploadsDir;
process.env.GOODEX_ENABLE_LIVE = 'false';

const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products } = await import('../models/index.js');
const { runProductImageAltMigration } = await import('../db/migrations/add_product_image_alt.js');
const productService = await import('../services/product.service.js');
const { productCustomAlt } = await import('../../shared/productText.js');

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

async function run() {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);

  console.log('\n--- Migration ---');
  await runProductImageAltMigration(pool);
  await runProductImageAltMigration(pool);
  const { rows } = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'products' AND column_name IN ('image_alt', 'image_alt_ar')",
  );
  assert(rows.length === 2 && rows.every((r) => r.is_nullable === 'YES' && r.data_type === 'character varying'), 'migration (run twice) leaves two nullable varchar columns');

  const marker = `imgalt${crypto.randomBytes(4).toString('hex')}`;
  const created = { categoryId: null, productIds: [] };

  try {
    const [category] = await db.insert(categories).values({ name: `Cat ${marker}`, slug: marker }).returning();
    created.categoryId = category.id;

    const payload = (name, extra = {}) => ({
      name,
      slug: `${marker}-${name.toLowerCase().replace(/\W+/g, '-')}`,
      description: `Description ${name}`,
      category: category.slug,
      categoryId: category.id,
      price: 50,
      collectionImage: '/pictures/blushmarron.jpg',
      colors: [{ id: 'noir', name: 'Noir', image: '/pictures/blushmarron.jpg', gallery: [] }],
      sizes: ['S'],
      stock: { 'noir-S': 3 },
      ...extra,
    });

    console.log('\n--- Service ---');
    const plain = await productService.createProduct(payload('Produit Simple'));
    created.productIds.push(plain.id);
    assert(plain.imageAlt === null && plain.imageAltAr === null, 'a product without alt text has imageAlt and imageAltAr null');

    const withAlt = await productService.createProduct(payload('Produit Alt', { imageAlt: '  Robe satin noire, vue de face  ', imageAltAr: 'فستان ساتان أسود' }));
    created.productIds.push(withAlt.id);
    assert(withAlt.imageAlt === 'Robe satin noire, vue de face' && withAlt.imageAltAr === 'فستان ساتان أسود', 'both alt texts are stored (trimmed) and returned');

    const renamed = await productService.updateProduct(withAlt.id, payload('Produit Alt Bis'));
    assert(renamed.imageAlt === 'Robe satin noire, vue de face' && renamed.imageAltAr === 'فستان ساتان أسود', 'a save that does not mention the alt texts keeps them');

    const changed = await productService.updateProduct(withAlt.id, payload('Produit Alt Bis', { imageAlt: 'Robe noire' }));
    assert(changed.imageAlt === 'Robe noire' && changed.imageAltAr === 'فستان ساتان أسود', 'changing the French alt leaves the Arabic one alone');

    const cleared = await productService.updateProduct(withAlt.id, payload('Produit Alt Bis', { imageAlt: '', imageAltAr: '   ' }));
    assert(cleared.imageAlt === null && cleared.imageAltAr === null, 'empty alt texts clear them (null, not an empty string)');

    let tooLong = null;
    try {
      await productService.updateProduct(withAlt.id, payload('Produit Alt Bis', { imageAlt: 'a'.repeat(256) }));
    } catch (err) {
      tooLong = err;
    }
    assert(tooLong && tooLong.status === 400, 'an alt text over 255 characters is refused with a 400');

    console.log('\n--- Shared helper ---');
    const product = { imageAlt: 'Robe noire', imageAltAr: 'فستان أسود' };
    assert(productCustomAlt(product, 'fr') === 'Robe noire' && productCustomAlt(product, 'ar') === 'فستان أسود', 'each language gets its own alt');
    assert(productCustomAlt({ imageAlt: 'Robe noire', imageAltAr: null }, 'ar') === 'Robe noire', 'the Arabic page falls back to the French alt');
    assert(productCustomAlt({ imageAlt: null }, 'fr') === '' && productCustomAlt({}, 'ar') === '', 'no alt written gives an empty string (the generated alt is used)');
  } finally {
    console.log('\n--- Cleanup ---');
    try {
      if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
      if (created.categoryId) await db.delete(categories).where(eq(categories.id, created.categoryId));
      const left = created.productIds.length ? await db.select({ id: products.id }).from(products).where(inArray(products.id, created.productIds)) : [];
      assert(left.length === 0, 'every inserted product was removed');
    } catch (err) {
      failed++;
      console.error('✗ FAIL: cleanup error:', err.message);
    }
  }
}

try {
  await run();
} catch (err) {
  failed++;
  console.error('✗ FAIL: unexpected error:', err);
} finally {
  await pool.end().catch(() => {});
  fs.rmSync(uploadsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
