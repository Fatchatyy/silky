/**
 * Optional Arabic name and description of a product (columns products.title_ar / description_ar): the startup
 * migration is idempotent, the product service stores, keeps and clears the Arabic text, the API shape exposes it
 * as nameAr / descriptionAr (null when missing), and the product search also matches the Arabic text.
 *
 * Safety: refuses to run unless DATABASE_URL is exactly "silky_test" on a loopback host (helpers/silky_test_guard.js).
 * UPLOADS_DIR is a fresh temp folder and the test uses only built-in /pictures images, so server/uploads is never
 * touched. Every database row it inserts is removed in a finally block and the cleanup is verified.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_product_arabic_content.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-arabic-content-'));
process.env.UPLOADS_DIR = uploadsDir;
process.env.GOODEX_ENABLE_LIVE = 'false';

const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products, carts } = await import('../models/index.js');
const cartService = await import('../services/cart.service.js');
const { runProductArabicContentMigration } = await import('../db/migrations/add_product_arabic_content.js');
const productService = await import('../services/product.service.js');
const { productRepository } = await import('../repositories/product.repository.js');
const { getSitemapEntries } = await import('../services/storefront.service.js');

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
  await runProductArabicContentMigration(pool);
  await runProductArabicContentMigration(pool);
  const { rows } = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'products' AND column_name IN ('title_ar', 'description_ar') ORDER BY column_name",
  );
  assert(
    rows.length === 2 && rows.every((r) => r.is_nullable === 'YES') && rows[0].data_type === 'text' && rows[1].data_type === 'character varying',
    'migration (run twice) leaves two nullable columns: description_ar text, title_ar varchar',
  );

  const marker = `arabic${crypto.randomBytes(4).toString('hex')}`;
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

    console.log('\n--- Without Arabic text ---');
    const plain = await productService.createProduct(payload('Produit Plain'));
    created.productIds.push(plain.id);
    assert(plain.nameAr === null && plain.descriptionAr === null, 'a product without Arabic text has nameAr and descriptionAr null');

    console.log('\n--- With Arabic text ---');
    const arabic = await productService.createProduct(
      payload('Produit Arabe', { nameAr: '  فستان صيفي  ', descriptionAr: 'فستان خفيف من القطن.' }),
    );
    created.productIds.push(arabic.id);
    assert(arabic.nameAr === 'فستان صيفي' && arabic.descriptionAr === 'فستان خفيف من القطن.', 'Arabic name (trimmed) and description are stored and returned');
    const fetched = await productService.getProductById(arabic.id);
    assert(fetched.nameAr === 'فستان صيفي' && fetched.name === 'Produit Arabe' && fetched.description === 'Description Produit Arabe', 'the public product keeps the French fields next to the Arabic ones');

    console.log('\n--- Editing ---');
    const renamed = await productService.updateProduct(arabic.id, payload('Produit Arabe Bis'));
    assert(renamed.nameAr === 'فستان صيفي' && renamed.descriptionAr === 'فستان خفيف من القطن.', 'a save that does not mention the Arabic text keeps it');
    const changed = await productService.updateProduct(arabic.id, payload('Produit Arabe Bis', { nameAr: 'فستان شتوي' }));
    assert(changed.nameAr === 'فستان شتوي' && changed.descriptionAr === 'فستان خفيف من القطن.', 'changing the Arabic name leaves the Arabic description alone');
    const cleared = await productService.updateProduct(arabic.id, payload('Produit Arabe Bis', { nameAr: '', descriptionAr: '   ' }));
    assert(cleared.nameAr === null && cleared.descriptionAr === null, 'empty Arabic fields clear the Arabic text (null, not an empty string)');
    const restored = await productService.updateProduct(arabic.id, payload('Produit Arabe Bis', { nameAr: 'فستان صيفي', descriptionAr: 'فستان خفيف.' }));
    assert(restored.nameAr === 'فستان صيفي', 'the Arabic text can be written again');
    let tooLong = null;
    try {
      await productService.updateProduct(arabic.id, payload('Produit Arabe Bis', { nameAr: 'ا'.repeat(256) }));
    } catch (err) {
      tooLong = err;
    }
    assert(tooLong && tooLong.status === 400, 'an Arabic name over 255 characters is refused with a 400');

    console.log('\n--- Cart lines carry the Arabic name ---');
    const guestSessionId = crypto.randomUUID();
    created.guestSessionId = guestSessionId;
    const cartProduct = await productService.createProduct(payload('Panier Un', { nameAr: 'منتج السلة' }));
    created.productIds.push(cartProduct.id);
    const plainCartProduct = await productService.createProduct(payload('Panier Deux'));
    created.productIds.push(plainCartProduct.id);
    await cartService.addCartItem({ guestSessionId }, { productId: cartProduct.id, colorId: 'noir', size: 'S', quantity: 1 });
    const cart = await cartService.addCartItem({ guestSessionId }, { productId: plainCartProduct.id, colorId: 'noir', size: 'S', quantity: 1 });
    const lineOf = (id) => cart.items.find((i) => i.productId === id);
    assert(lineOf(cartProduct.id).name === 'Panier Un' && lineOf(cartProduct.id).nameAr === 'منتج السلة', 'a cart line has its French name and its Arabic name (nameAr)');
    assert(lineOf(plainCartProduct.id).nameAr === null, 'a cart line of a product without Arabic name has nameAr null');


    console.log('\n--- Arabic color names ---');
    const colorPayload = (nameAr) => ({
      colors: [
        { id: 'blanc-casse', name: 'Blanc cassé', ...(nameAr !== undefined ? { nameAr } : {}), image: '/pictures/blushmarron.jpg', gallery: [] },
        { id: 'rose', name: 'Rose', image: '/pictures/comfyrose.jpg', gallery: [] },
      ],
      stock: { 'blanc-casse-S': 2, 'rose-S': 1 },
    });
    const withColor = await productService.createProduct(payload('Produit Couleur', { ...colorPayload('  أوف وايت  ') }));
    created.productIds.push(withColor.id);
    const colorOf = (product, id) => product.colors.find((c) => c.id === id);
    assert(colorOf(withColor, 'blanc-casse').nameAr === 'أوف وايت' && colorOf(withColor, 'rose').nameAr === null, 'a color stores its Arabic name (trimmed); a color without one has nameAr null');
    assert(withColor.variants.filter((v) => v.colorSlug === 'blanc-casse').every((v) => v.colorNameAr === 'أوف وايت') && withColor.colors.every((c) => typeof c.name === 'string' && c.name), 'variants of that color carry it and the French color names are untouched');
    const fetchedColor = await productService.getProductById(withColor.id);
    assert(colorOf(fetchedColor, 'blanc-casse').nameAr === 'أوف وايت', 'the public product returns the Arabic color name');
    const edited = await productService.updateProduct(withColor.id, payload('Produit Couleur', colorPayload('أبيض مكسور')));
    assert(colorOf(edited, 'blanc-casse').nameAr === 'أبيض مكسور', 'editing changes the Arabic color name');
    const notMentioned = await productService.updateProduct(withColor.id, { name: 'Produit Couleur Bis' });
    assert(colorOf(notMentioned, 'blanc-casse').nameAr === 'أبيض مكسور', 'a save that does not send colors keeps the Arabic color name');
    const clearedColor = await productService.updateProduct(withColor.id, payload('Produit Couleur', colorPayload('')));
    assert(colorOf(clearedColor, 'blanc-casse').nameAr === null, 'an empty Arabic color name clears it (null)');
    let longColor = null;
    try {
      await productService.updateProduct(withColor.id, payload('Produit Couleur', colorPayload('ا'.repeat(65))));
    } catch (err) {
      longColor = err;
    }
    assert(longColor && longColor.status === 400, 'an Arabic color name over 64 characters is refused with a 400');
    const colRows = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'color_name_ar'");
    assert(colRows.rowCount === 1, 'migration added product_variants.color_name_ar');

    console.log('\n--- Search ---');
    const byArabicName = await productRepository.listPaginated({ search: 'صيفي', category: category.slug });
    assert(byArabicName.products.length === 1 && byArabicName.products[0].id === arabic.id, 'search matches the Arabic name');
    const byArabicDescription = await productRepository.listPaginated({ search: 'خفيف', category: category.slug });
    assert(byArabicDescription.products.length === 1 && byArabicDescription.products[0].id === arabic.id, 'search matches the Arabic description');
    const byFrench = await productRepository.listPaginated({ search: 'Produit', category: category.slug });
    assert(byFrench.products.length === 3, 'French search still finds all three products');

    console.log('\n--- Sitemap data ---');
    const sitemapData = await getSitemapEntries();
    // The test saves explicit slugs, so read the current ones (a save without a slug keeps the stored one).
    const arabicNow = await productService.getProductById(arabic.id);
    const plainNow = await productService.getProductById(plain.id);
    const arabicEntry = sitemapData.products.find((p) => p.slug === arabicNow.slug);
    const plainEntry = sitemapData.products.find((p) => p.slug === plainNow.slug);
    assert(arabicEntry && arabicEntry.hasArabic === true && plainEntry && plainEntry.hasArabic === false, 'sitemap entries flag the Arabic twin of the translated product only (slug addresses)');

    console.log('\n--- Slug (public address) ---');
    const { slug: _ignored, ...withoutSlug } = payload('Nom Complètement Différent');
    const renamedNoSlug = await productService.updateProduct(arabic.id, withoutSlug);
    assert(renamedNoSlug.name === 'Nom Complètement Différent' && renamedNoSlug.slug === arabicNow.slug, 'renaming a product without sending a slug keeps its address');
    const { slug: _ignored2, ...longPayload } = payload('x');
    const longName = `Ensemble pyjama en satin de soie avec broderie main pour femme collection été 2026 nouveauté ${marker}`;
    const longProduct = await productService.createProduct({ ...longPayload, name: longName });
    created.productIds.push(longProduct.id);
    assert(longProduct.slug.length <= 80 && longProduct.slug.startsWith('ensemble-pyjama-en-satin') && !longProduct.slug.endsWith('-'), 'a long name gives a short slug cut at a word boundary');
  } finally {
    console.log('\n--- Cleanup ---');
    try {
      if (created.guestSessionId) await db.delete(carts).where(eq(carts.guestSessionId, created.guestSessionId));
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
