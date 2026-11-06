/**
 * Editing an EXISTING product whose colour names have accents ("Écru", "Bleu clair") in the admin form: the colours,
 * photos, sizes, stock and variant rows stay the same, no colour or variant is duplicated, and an order line that points
 * to a variant keeps pointing to it. The old admin built a colour id without handling accents ("Écru" -> "cru"); the
 * current form builds "ecru". A saved colour must keep its id when its name is retyped or changed; only a new colour gets
 * the unaccented id. The form logic under test is the real one (shared/productFormLogic.js).
 *
 * Safety: refuses to run unless DATABASE_URL is exactly "silky_test" on a loopback host (helpers/silky_test_guard.js).
 * Every row it inserts is removed in a finally block and the cleanup is verified.
 *
 * Usage (PowerShell): $env:DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/silky_test'; node server/scripts/test_colour_ids_on_edit.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertConnectedToSilkyTest, assertSilkyTestUrl } from './helpers/silky_test_guard.js';

const targetUrl = assertSilkyTestUrl();

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'silky-colour-ids-'));
process.env.UPLOADS_DIR = uploadsDir;
process.env.GOODEX_ENABLE_LIVE = 'false';

const { env } = await import('../config/env.js');
const { pool } = await import('../db/pool.js');
const { db } = await import('../db/orm.js');
const { eq, inArray } = await import('drizzle-orm');
const { categories, products, productVariants, orders, orderItems, governorates } = await import('../models/index.js');
const productService = await import('../services/product.service.js');
const { productRepository } = await import('../repositories/product.repository.js');
const { colorIdOnRename, mapProductColorsToForm, normalizeProduct, slugify } = await import('../shared/productFormLogic.js');

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

/** What the admin does: open the product (API -> form), change the form like a user would, press save (form -> body). */
async function adminSave(productId, edit) {
  const api = await productRepository.findById(productId);
  const form = {
    ...api,
    colors: mapProductColorsToForm(api.colors),
    sizes: [...(api.sizes || [])],
    stock: { ...(api.stock || {}) },
    videos: [],
    isHidden: false,
  };
  // The panel's updateColor: typing in the name field also recomputes the colour id.
  const typeName = (index, name) => {
    const c = form.colors[index];
    form.colors[index] = { ...c, name, id: colorIdOnRename(c, name, index) };
  };
  edit(form, typeName);
  return productService.updateProduct(productId, normalizeProduct(form));
}

const snapshot = async (productId) => {
  const p = await productRepository.findById(productId);
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  return {
    p,
    colours: p.colors.map((c) => ({ id: c.id, name: c.name, images: c.images })),
    sizes: p.sizes,
    stock: p.stock,
    variantRows: variants.map((v) => ({ id: v.id, colorSlug: v.colorSlug, size: v.size, stock: v.stockQuantity, sku: v.sku })).sort((a, b) => a.id.localeCompare(b.id)),
  };
};

async function run() {
  await assertConnectedToSilkyTest(pool, env.databaseUrl, targetUrl);

  const marker = `colid${crypto.randomBytes(4).toString('hex')}`;
  const created = { categoryId: null, productIds: [], orderIds: [] };

  try {
    const [category] = await db.insert(categories).values({ name: `Cat ${marker}`, slug: marker }).returning();
    created.categoryId = category.id;
    const [gov] = await db.select().from(governorates).limit(1);

    const make = (slug, colors, stock) =>
      productService.createProduct({
        name: `Produit ${slug}`,
        slug: `${marker}-${slug}`,
        description: 'Description',
        category: category.slug,
        categoryId: category.id,
        price: 60,
        collectionImage: '/pictures/blushmarron.jpg',
        colors,
        sizes: ['S', 'M'],
        stock,
      });

    const insertOrder = (suffix, variantId) =>
      db
        .insert(orders)
        .values({
          orderNumber: `ORD-${suffix}-${marker}`,
          customerName: 'Client Test',
          customerPhone: '22334455',
          shippingAddress: 'Rue test',
          governorateId: gov?.id,
          subtotal: '60.000',
          deliveryFee: '8.000',
          totalAmount: '68.000',
          status: 'completed',
        })
        .returning()
        .then(async ([order]) => {
          created.orderIds.push(order.id);
          const [line] = await db
            .insert(orderItems)
            .values({ orderId: order.id, variantId, productTitle: 'Produit', variantLabel: 'Écru / S', quantity: 1, unitPrice: '60.000' })
            .returning();
          return line;
        });

    // A product as the OLD admin saved it: "Écru" got the id "cru".
    const oldColours = () => [
      { id: 'cru', name: 'Écru', image: '/pictures/blushmarron.jpg', gallery: ['/pictures/blushrose.jpg'] },
      { id: 'bleu-clair', name: 'Bleu clair', image: '/pictures/comfyrose.jpg', gallery: [] },
    ];
    const stock = { 'cru-S': 4, 'cru-M': 3, 'bleu-clair-S': 2, 'bleu-clair-M': 7 };
    const product = await make('ecru', oldColours(), stock);
    created.productIds.push(product.id);
    assert(product.colors.map((c) => c.id).join() === 'cru,bleu-clair', 'fixture: the product holds the old-style ids "cru" and "bleu-clair"');

    const before0 = await snapshot(product.id);
    const cruS = before0.variantRows.find((v) => v.colorSlug === 'cru' && v.size === 'S');
    const line = await insertOrder('A', cruS.id);
    const lineVariant = async () => (await db.select().from(orderItems).where(eq(orderItems.id, line.id)))[0].variantId;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const ids = (s) => s.variantRows.map((v) => v.id);

    console.log('\n--- 1. Open and save without touching anything ---');
    await adminSave(product.id, () => {});
    const s1 = await snapshot(product.id);
    assert(same(s1.colours, before0.colours), 'same colours (ids, names, photos)');
    assert(same(s1.sizes, before0.sizes) && same(s1.stock, before0.stock), 'same sizes and stock');
    assert(same(ids(s1), ids(before0)) && s1.variantRows.length === 4, 'the same 4 variant rows (no duplicate, none recreated)');
    assert((await lineVariant()) === cruS.id, 'the order line still points to its variant');

    console.log('\n--- 2. Retype the accented names (same text) ---');
    await adminSave(product.id, (form, type) => {
      type(0, 'Écru');
      type(1, 'Bleu clair');
    });
    const s2 = await snapshot(product.id);
    assert(same(s2.colours, before0.colours) && same(s2.stock, before0.stock), 'ids, photos and stock unchanged after retyping the names');
    assert(same(ids(s2), ids(before0)), 'the same variant rows');
    assert((await lineVariant()) === cruS.id, 'the order line still points to its variant');

    console.log('\n--- 3. Rename the accented colour ---');
    await adminSave(product.id, (form, type) => type(0, 'Écru clair'));
    const s3 = await snapshot(product.id);
    assert(s3.colours[0].id === 'cru' && s3.colours[0].name === 'Écru clair', 'the colour is renamed, its id stays "cru"');
    assert(same(s3.colours[0].images, before0.colours[0].images) && s3.stock['cru-S'] === 4 && s3.stock['cru-M'] === 3, 'its photos and stock are kept');
    assert(same(ids(s3), ids(before0)), 'the same variant rows');
    assert((await lineVariant()) === cruS.id, 'the order line still points to its variant');

    console.log('\n--- 4. A new colour gets the unaccented id; the others are untouched ---');
    await adminSave(product.id, (form, type) => {
      form.colors.push({ id: '', name: '', thumbnail: '/pictures/noir.jpg', gallery: [] });
      type(2, 'Éclat');
      form.stock['eclat-S'] = 5;
      form.stock['eclat-M'] = 1;
    });
    const s4 = await snapshot(product.id);
    assert(s4.colours.map((c) => c.id).join() === 'cru,bleu-clair,eclat', 'the new colour is "eclat" (no accent)');
    assert(s4.variantRows.length === 6 && new Set(s4.variantRows.map((v) => `${v.colorSlug}::${v.size}`)).size === 6, 'six variants, no duplicate colour/size pair');
    assert(before0.variantRows.every((old) => s4.variantRows.some((v) => v.id === old.id)), 'the four original variant rows are still there');
    assert((await lineVariant()) === cruS.id, 'the order line still points to its variant');

    console.log('\n--- Control: the old behaviour (a new id from every typed name) loses the link ---');
    const control = await make('controle', oldColours(), stock);
    created.productIds.push(control.id);
    const cVariants = await db.select().from(productVariants).where(eq(productVariants.productId, control.id));
    const cLine = await insertOrder('C', cVariants.find((v) => v.colorSlug === 'cru' && v.size === 'S').id);
    await adminSave(control.id, (form) => {
      const old = form.colors[0];
      form.colors[0] = { ...old, id: slugify(old.name) }; // what the form did before the fix
      form.stock['ecru-S'] = form.stock['cru-S'];
      form.stock['ecru-M'] = form.stock['cru-M'];
    });
    const afterControl = (await db.select().from(orderItems).where(eq(orderItems.id, cLine.id)))[0].variantId;
    assert(slugify('Écru') === 'ecru' && afterControl === null, 'with "Écru" -> "ecru" the order line loses its variant (this is what the fix prevents)');
  } finally {
    console.log('\n--- Cleanup ---');
    try {
      if (created.orderIds.length) await db.delete(orders).where(inArray(orders.id, created.orderIds));
      if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
      if (created.categoryId) await db.delete(categories).where(eq(categories.id, created.categoryId));
      const left = created.productIds.length ? await db.select({ id: products.id }).from(products).where(inArray(products.id, created.productIds)) : [];
      const leftOrders = created.orderIds.length ? await db.select({ id: orders.id }).from(orders).where(inArray(orders.id, created.orderIds)) : [];
      assert(left.length + leftOrders.length === 0, 'every inserted row (orders, products, category) was removed');
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
