/**
 * One-off, re-runnable copy of every file in the local uploads folder (UPLOADS_DIR, default server/uploads) to the
 * Cloudflare R2 bucket, then a cross-check that every '/uploads/...' address the database points at exists in R2.
 *
 *  - Read-only on the local folder and on the database (SELECT only). It never deletes anything anywhere.
 *  - A file that already exists in R2 with the same size is skipped, so it can be run again after a failure or after
 *    new uploads.
 *  - Content type comes from the extension; photos with resized copies get the one-year immutable cache header.
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (STORAGE_DRIVER may stay "disk").
 *
 * Usage (inside server/):
 *   node scripts/copy_uploads_to_r2.js              copy, then cross-check
 *   node scripts/copy_uploads_to_r2.js --dry-run    list what would be copied, change nothing
 *   node scripts/copy_uploads_to_r2.js --verify     cross-check only (no copy)
 * Exit code 1 when a copy failed or a referenced file is missing in R2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { createStorage, contentTypeFor, uploadKey } from '../services/storage.service.js';
import { listReferencedUploadUrls } from '../utils/uploadReferences.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const verifyOnly = args.has('--verify');
const CONCURRENCY = 4;

const r2 = env.storage.r2;
const missingVars = [
  !r2.accountId && 'R2_ACCOUNT_ID',
  !r2.accessKeyId && 'R2_ACCESS_KEY_ID',
  !r2.secretAccessKey && 'R2_SECRET_ACCESS_KEY',
  !r2.bucket && 'R2_BUCKET',
].filter(Boolean);
if (missingVars.length) {
  console.error(`Missing ${missingVars.join(', ')} (see .env.example). Nothing was done.`);
  process.exit(1);
}
const remote = createStorage({ driver: 'r2', r2 });

let failed = 0;

async function copyFolder() {
  const dir = env.uploadsDir;
  if (!fs.existsSync(dir)) {
    console.log(`The uploads folder ${dir} does not exist: nothing to copy.`);
    return;
  }
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  console.log(`${files.length} file(s) in ${dir}${dryRun ? ' (dry run: nothing will be uploaded)' : ''}`);
  const counts = { copied: 0, skipped: 0, failed: 0 };
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const name = files[next++];
      const file = path.join(dir, name);
      const key = uploadKey(name);
      try {
        const size = fs.statSync(file).size;
        if ((await remote.objectSize(key)) === size) {
          counts.skipped++;
          continue;
        }
        if (dryRun) {
          console.log(`  would copy ${name} (${size} bytes)`);
          counts.copied++;
          continue;
        }
        await remote.putObject(key, fs.createReadStream(file), contentTypeFor(name), { contentLength: size });
        counts.copied++;
      } catch (err) {
        counts.failed++;
        console.error(`  FAILED ${name}: ${String(err?.message ?? err).slice(0, 160)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  failed += counts.failed;
  console.log(`${dryRun ? 'would copy' : 'copied'}: ${counts.copied}, already in R2 (same size): ${counts.skipped}, failed: ${counts.failed}`);
}

async function crossCheck() {
  const { pool } = await import('../db/pool.js');
  try {
    const urls = await listReferencedUploadUrls(pool);
    const missing = [];
    for (const url of urls) {
      if (!(await remote.objectExists(uploadKey(url)))) missing.push(url);
    }
    console.log(`database references ${urls.length} upload(s); missing in R2: ${missing.length}`);
    for (const url of missing.slice(0, 50)) console.log(`  missing: ${url}`);
    if (missing.length > 50) console.log(`  ... and ${missing.length - 50} more`);
    failed += missing.length;
  } finally {
    await pool.end().catch(() => {});
  }
}

try {
  if (!verifyOnly) await copyFolder();
  if (!dryRun) await crossCheck();
} catch (err) {
  console.error('Stopped:', String(err?.message ?? err));
  failed++;
}
process.exitCode = failed > 0 ? 1 : 0;
