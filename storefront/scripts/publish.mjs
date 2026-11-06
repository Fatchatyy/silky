// Builds the storefront from the API's catalogue snapshot and deploys it to Cloudflare:  npm run publish-site
//
//   1. scripts/write_headers.mjs   writes public/_headers for this build's addresses
//   2. astro build                 fetches the snapshot (waits for a sleeping API), generates every page, and runs the build
//                                  guard (integrations/buildGuard.mjs)
//   3. wrangler deploy             ONLY when 1 and 2 succeeded
//
// A failed step stops here with a non-zero exit code and deploys nothing, so the site that is already live stays as it is.
// --dry-run does everything except the deploy (and says so).
//
// Settings (environment or storefront/.env): SNAPSHOT_API_URL (the API the catalogue is read from; falls back to API_URL),
// PUBLIC_API_URL, PUBLIC_MEDIA_URL, PUBLIC_SITE_URL. Optional: SNAPSHOT_ATTEMPT_TIMEOUT_MS (90000), SNAPSHOT_BUDGET_MS (480000),
// SNAPSHOT_MIN_PRODUCTS (1). Deploying needs `wrangler login` (or CLOUDFLARE_API_TOKEN) on the machine that runs it.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const run = (label, command, args) => {
  console.log(`\n[publish] ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, NODE_ENV: 'production' } });
  if (result.status !== 0) {
    console.error(`\n[publish] STOPPED: "${label}" failed (exit ${result.status}). Nothing was deployed; the live site is unchanged.`);
    process.exit(result.status || 1);
  }
};

run('1/3 write public/_headers', 'node', ['scripts/write_headers.mjs']);
run('2/3 build the site (snapshot, pages, build guard)', 'npx', ['astro', 'build']);
if (dryRun) {
  console.log('\n[publish] DRY RUN: the site was built and checked. The deploy step was skipped (it would run: wrangler deploy).');
} else {
  run('3/3 deploy to Cloudflare', 'npx', ['wrangler', 'deploy', '--config', 'dist/server/wrangler.json']);
  console.log('\n[publish] Deployed.');
}
