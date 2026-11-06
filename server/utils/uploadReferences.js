// Every '/uploads/...' address the database points at (product photos, colour photos, collection image, videos, home
// hero). Read-only. Used by `npm run preflight` and by scripts/copy_uploads_to_r2.js to check that each file exists.
const SQL = `
  SELECT DISTINCT url FROM (
    SELECT image_url AS url FROM product_images
    UNION ALL SELECT color_image_url FROM product_variants
    UNION ALL SELECT collection_image_url FROM products
    UNION ALL SELECT video_url FROM product_videos
    UNION ALL SELECT hero_left_image FROM site_settings
    UNION ALL SELECT hero_right_image FROM site_settings
  ) u WHERE url LIKE '/uploads/%'`;

/** Distinct '/uploads/<file>' addresses referenced by the database. `pool` is a pg Pool (or anything with query()). */
export async function listReferencedUploadUrls(pool) {
  const { rows } = await pool.query(SQL);
  return rows.map((row) => row.url);
}
