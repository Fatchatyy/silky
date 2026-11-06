// Writes public/_headers from src/lib/securityHeaders.ts, with this build's addresses (the CSP lists the API and the media
// origin). Runs before `astro build` (npm run build). public/_headers is generated: it is in .gitignore.
//   node scripts/write_headers.mjs
//
// The addresses come from the environment, then from .env. CAUTION: Astro bakes PUBLIC_* into the BROWSER bundle from `.env`
// BEFORE the environment (checked: a PUBLIC_API_URL given on the command line did not reach the bundle while `.env` held another
// value; `.env.production.local` was ignored too). On a build machine there is no .env file, so everything comes from the
// environment and the two agree; on a developer's machine keep `.env` and the environment consistent. This script prints what it used.
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { headersFile } from '../src/lib/securityHeaders.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromFiles = {};
for (const name of ['.env']) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) Object.assign(fromFiles, parseEnv(fs.readFileSync(file, 'utf8')));
}
// The environment wins (a build machine, a test): .env is the fallback for a developer's own machine.
const value = (key) => String(process.env[key] ?? fromFiles[key] ?? '').trim().replace(/\/+$/, '');

const site = value('PUBLIC_SITE_URL') || 'https://silky.tn';
const context = {
  api: value('PUBLIC_API_URL'),
  media: value('PUBLIC_MEDIA_URL'),
  production: site.startsWith('https://') && !site.includes('localhost'),
};
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/_headers'), headersFile(context));
console.log(`[headers] public/_headers written (production=${context.production}, api=${context.api || '-'}, media=${context.media || '-'})`);
