/**
 * Finds the uploaded photos and videos that nothing uses any more (added in an editor that was never saved, a crash, ...)
 * and, only when asked, deletes them from the configured storage (local disk or R2, see STORAGE_DRIVER).
 *
 * It only looks at files older than --min-age-hours (default 24), so a photo being added right now is never touched, and it
 * keeps every file that a product, colour, collection image, video, order, exchange, refund, draft, review or the home hero
 * still uses. Without --delete it deletes NOTHING and only prints what it would remove.
 *
 * Usage (inside server/):
 *   node scripts/sweep_orphan_uploads.js                       list the orphans (nothing is deleted)
 *   node scripts/sweep_orphan_uploads.js --min-age-hours 1     only look at files older than one hour
 *   node scripts/sweep_orphan_uploads.js --delete              delete them
 */
import '../config/env.js';
import { pool } from '../db/pool.js';
import { deleteOrphanUploads, findOrphanUploads } from '../services/product.service.js';
import { storage } from '../services/storage.service.js';

const args = process.argv.slice(2);
const doDelete = args.includes('--delete');
const ageIndex = args.indexOf('--min-age-hours');
const minAgeHours = ageIndex >= 0 ? Number(args[ageIndex + 1]) : 24;
if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
  console.error('--min-age-hours needs a number (0 or more)');
  process.exit(2);
}

try {
  console.log(`Storage: ${storage.driver}. Looking for unused uploads older than ${minAgeHours} h...`);
  const orphans = await findOrphanUploads({ minAgeHours });
  const bytes = orphans.reduce((sum, o) => sum + o.bytes, 0);
  for (const orphan of orphans) console.log(`  ${orphan.original ?? `${orphan.id} (copies only)`}  (${orphan.keys.length} file(s), ${(orphan.bytes / 1024).toFixed(0)} KB)`);
  console.log(`${orphans.length} unused upload(s), ${orphans.reduce((n, o) => n + o.keys.length, 0)} file(s), ${(bytes / 1048576).toFixed(2)} MB.`);
  if (orphans.length && doDelete) {
    console.log(`Deleted ${await deleteOrphanUploads(orphans)} file(s).`);
  } else if (orphans.length) {
    console.log('Nothing deleted. Run again with --delete to remove them.');
  }
} catch (err) {
  console.error('Sweep failed:', String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
