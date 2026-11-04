import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent schema migration: optional custom alt text of a product's photos (one text for all the photos of the
 * product, French and Arabic). NULL means "none": the storefront then builds the alt from the product name, colour
 * and photo position.
 * Safe to run multiple times without error.
 */
export async function runProductImageAltMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS image_alt VARCHAR(255),
        ADD COLUMN IF NOT EXISTS image_alt_ar VARCHAR(255);
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
