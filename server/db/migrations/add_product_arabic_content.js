import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent schema migration: optional Arabic name and description of a product, and optional Arabic name of a color
 * (stored on each variant row of that color). NULL means "no Arabic version" (the storefront falls back to its
 * built-in color words, then to the French text).
 * Safe to run multiple times without error.
 */
export async function runProductArabicContentMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS title_ar VARCHAR(255),
        ADD COLUMN IF NOT EXISTS description_ar TEXT;
    `);

    await client.query(`
      ALTER TABLE product_variants
        ADD COLUMN IF NOT EXISTS color_name_ar VARCHAR(64);
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
