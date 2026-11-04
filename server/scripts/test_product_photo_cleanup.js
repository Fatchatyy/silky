/**
 * Photo cleanup when a product is edited or deleted: a photo (and its resized copies) that a product no longer uses
 * is removed from disk, unless something else still uses it. The product service is called directly.
 *
 * Safety: refuses to run unless DATABASE_URL is exactly "silky_test" on a loopback host (helpers/silky_test_guard.js).
 * UPLOADS_DIR is pointed at a fresh temp folder by this script itself, so server/uploads is never touched. Every
 * database row it inserts is removed in a finally block and the cleanup is verified.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_product_photo_cleanup.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-photo-cleanup-'));
process.env.UPLOADS_DIR = uploadsDir;
process.env.GOODEX_ENABLE_LIVE = 'false';

const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products } = await import('../models/index.js');
const productService = await import('../services/product.service.js');
const { productRepository } = await import('../repositories/product.repository.js');

if (path.resolve(env.uploadsDir) !== path.resolve(uploadsDir) || !path.resolve(uploadsDir).startsWith(path.resolve(os.tmpdir()))) {
  console.error('REFUSING TO RUN: uploads are not pointed at the temp folder.');
  process.exit(2);
}

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

const COPIES = ['', '.card.webp', '.share.webp', '.large.webp'];
/** Creates a fake upload (original + three copies) and returns its url. */
function makeUpload() {
  const base = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-r`;
  fs.writeFileSync(path.join(uploadsDir, `${base}.jpg`), 'original');
  for (const suffix of COPIES.slice(1)) fs.writeFileSync(path.join(uploadsDir, `${base}${suffix}`), 'copy');
  return `/uploads/${base}.jpg`;
}
const filesOf = (url) => {
  const base = path.basename(url).replace(/\.jpg$/, '');
  return COPIES.map((suffix) => path.join(uploadsDir, suffix ? `${base}${suffix}` : `${base}.jpg`));
};
const exists = (url) => filesOf(url).every((f) => fs.existsSync(f));
const gone = (url) => filesOf(url).every((f) => !fs.existsSync(f));

async function run() {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);

  const marker = `cleanup${crypto.randomBytes(4).toString('hex')}`;
  const created = { categoryId: null, productIds: [] };

  try {
    const [category] = await db.insert(categories).values({ name: `Cat ${marker}`, slug: marker }).returning();
    created.categoryId = category.id;

    const payload = (name, collection, colors) => ({
      name,
      slug: `${marker}-${name.toLowerCase().replace(/\W+/g, '-')}`,
      description: `Description ${name}`,
      category: category.slug,
      categoryId: category.id,
      price: 50,
      collectionImage: collection,
      colors,
      sizes: ['S'],
      stock: Object.fromEntries(colors.map((c) => [`${c.id}-S`, 3])),
    });

    const C1 = makeUpload(); // collection image
    const V1 = makeUpload(); // color noir image
    const P1 = makeUpload();
    const P2 = makeUpload();
    const V2 = makeUpload(); // color rose image
    const P3 = makeUpload();
    const noir = { id: 'noir', name: 'Noir', image: V1, gallery: [P1, P2] };
    const rose = { id: 'rose', name: 'Rose', image: V2, gallery: [P3] };

    const A = await productService.createProduct(payload('Produit A', C1, [noir, rose]));
    created.productIds.push(A.id);
    const stored = async (id) => {
      const s = await productRepository.findProductImagesAndVariants(id);
      return new Set([s.collectionImageUrl, ...s.images, ...s.variants].filter(Boolean));
    };
    const initial = await stored(A.id);
    assert([C1, V1, P1, P2, V2, P3].every((u) => initial.has(u)), 'product created with its collection image, color images and gallery photos');

    console.log('\n--- Saving without touching photos ---');
    await productService.updateProduct(A.id, payload('Produit A renomme', C1, [noir, rose]));
    assert([C1, V1, P1, P2, V2, P3].every(exists), 'same photos: nothing is deleted');

    console.log('\n--- Removing one gallery photo ---');
    await productService.updateProduct(A.id, payload('Produit A renomme', C1, [{ ...noir, gallery: [P1] }, rose]));
    assert(gone(P2), 'removed photo and its three copies are deleted');
    assert([C1, V1, P1, V2, P3].every(exists), 'every other photo is kept');

    console.log('\n--- Replacing a photo ---');
    const P4 = makeUpload();
    await productService.updateProduct(A.id, payload('Produit A renomme', C1, [{ ...noir, gallery: [P4] }, rose]));
    assert(gone(P1) && exists(P4), 'replaced photo deleted, new one kept');

    console.log('\n--- Removing a whole color (variant) ---');
    await productService.updateProduct(A.id, payload('Produit A renomme', C1, [{ ...noir, gallery: [P4] }]));
    assert(gone(V2) && gone(P3), 'the removed color: its image and its photos are deleted');
    assert([C1, V1, P4].every(exists), 'the remaining color keeps its photos');

    console.log('\n--- Replacing the collection image ---');
    const C2 = makeUpload();
    await productService.updateProduct(A.id, payload('Produit A renomme', C2, [{ ...noir, gallery: [P4] }]));
    assert(gone(C1) && exists(C2), 'old collection image deleted, new one kept');

    console.log('\n--- A photo another product also uses ---');
    const SHARED = makeUpload();
    const B = await productService.createProduct(payload('Produit B', SHARED, [{ id: 'vert', name: 'Vert', image: SHARED, gallery: [SHARED] }]));
    created.productIds.push(B.id);
    await productService.updateProduct(A.id, payload('Produit A renomme', C2, [{ ...noir, gallery: [P4, SHARED] }]));
    await productService.updateProduct(A.id, payload('Produit A renomme', C2, [{ ...noir, gallery: [P4] }]));
    assert(exists(SHARED), 'photo removed from A but still used by B is kept');

    console.log('\n--- Switching to a built-in picture ---');
    await productService.updateProduct(A.id, payload('Produit A renomme', '/pictures/blushmarron.jpg', [{ ...noir, gallery: [P4, '/pictures/comfyrose.jpg'] }]));
    assert(gone(C2), 'collection image replaced by a /pictures image: the old upload is deleted, no error');

    console.log('\n--- Deleting products ---');
    await productService.deleteProduct(A.id);
    created.productIds = created.productIds.filter((id) => id !== A.id);
    assert([V1, P4].every(gone), 'deleting A removes all its remaining photos');
    assert(exists(SHARED), 'deleting A keeps the photo B uses');
    await productService.deleteProduct(B.id);
    created.productIds = created.productIds.filter((id) => id !== B.id);
    assert(gone(SHARED), 'deleting B removes the last photo');
    assert(fs.readdirSync(uploadsDir).length === 0, 'no file is left in the uploads folder');
  } finally {
    console.log('\n--- Cleanup ---');
    try {
      if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
      if (created.categoryId) await db.delete(categories).where(eq(categories.id, created.categoryId));
      const leftProducts = created.productIds.length ? await db.select({ id: products.id }).from(products).where(inArray(products.id, created.productIds)) : [];
      const leftCategories = created.categoryId ? await db.select({ id: categories.id }).from(categories).where(eq(categories.id, created.categoryId)) : [];
      assert(leftProducts.length + leftCategories.length === 0, 'every inserted row (category, products) was removed');
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
