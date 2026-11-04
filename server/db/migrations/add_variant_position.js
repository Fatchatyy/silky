import { pool as defaultPool } from '../pool.js';

/**
 * Idempotent schema migration: `product_variants.position`, the place of a variant in its product's list (sizes
 * and colours shown to shoppers follow it). Until now variants of one product shared one `created_at`, so their
 * order was whatever order the rows happened to sit in the table, and it changed whenever a stock update rewrote a
 * row.
 *
 * Products that have a variant without a position get all their positions set once: colours in the order of their
 * first photo, then sizes in their natural order (numbers ascending: 36, 38, 40; letters XXS..XXXL; anything else
 * after, by name). New and edited products store the order entered in the admin from now on.
 * Safe to run multiple times: a product whose variants all have a position is left alone.
 */
export async function runVariantPositionMigration(poolInstance = defaultPool) {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE product_variants
        ADD COLUMN IF NOT EXISTS "position" INTEGER;
    `);

    await client.query(`
      WITH targets AS (
        SELECT DISTINCT product_id FROM product_variants WHERE "position" IS NULL
      ),
      colour_rank AS (
        SELECT product_id, color_slug, MIN(sort_order) AS first_photo
        FROM product_images
        WHERE color_slug IS NOT NULL
        GROUP BY product_id, color_slug
      ),
      keyed AS (
        SELECT v.id, v.product_id, v.color_slug, v.size, v.created_at,
               cr.first_photo,
               CASE
                 WHEN v.size ~ '^[0-9]' THEN 0
                 WHEN upper(btrim(v.size)) IN ('XXS','XS','S','M','L','XL','XXL','2XL','XXXL','3XL','4XL') THEN 1
                 ELSE 2
               END AS size_group,
               CASE WHEN v.size ~ '^[0-9]'
                    THEN replace(substring(v.size from '^[0-9]+(?:[.,][0-9]+)?'), ',', '.')::numeric
               END AS size_number,
               CASE upper(btrim(v.size))
                 WHEN 'XXS' THEN 1 WHEN 'XS' THEN 2 WHEN 'S' THEN 3 WHEN 'M' THEN 4 WHEN 'L' THEN 5
                 WHEN 'XL' THEN 6 WHEN 'XXL' THEN 7 WHEN '2XL' THEN 7 WHEN 'XXXL' THEN 8 WHEN '3XL' THEN 8
                 WHEN '4XL' THEN 9
               END AS size_letter
        FROM product_variants v
        JOIN targets t ON t.product_id = v.product_id
        LEFT JOIN colour_rank cr ON cr.product_id = v.product_id AND cr.color_slug = v.color_slug
      ),
      ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY product_id
                 ORDER BY COALESCE(first_photo, 2147483647), color_slug,
                          size_group, size_number, size_letter, size, created_at, id
               ) - 1 AS pos
        FROM keyed
      )
      UPDATE product_variants pv
      SET "position" = ranked.pos
      FROM ranked
      WHERE pv.id = ranked.id;
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
