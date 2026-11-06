// Writes public/_headers from src/lib/securityHeaders.ts, with this build's addresses (the CSP lists the API and the media
// origin). Runs before `astro build` (npm run build). public/_headers is generated: it is in .gitignore.
//   node scripts/write_headers.mjs
//
// The addresses are read the way Astro was observed to read them for the browser bundle: `.env` takes precedence over the
// process environment (checked: a PUBLIC_API_URL given on the command line did NOT reach the bundle while `.env` held another
// value; `.env.production.local` was ignored too). On a build machine without a `.env` file only the environment exists, so the
// two agree; with both, make them say the same thing or the CSP would list an address the bundle does not use. This script
// prints what it used.
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
const value = (key) => String(fromFiles[key] ?? process.env[key] ?? '').trim().replace(/\/+$/, '');

const site = value('PUBLIC_SITE_URL') || 'https://silky.tn';
const context = {
  api: value('PUBLIC_API_URL'),
  media: value('PUBLIC_MEDIA_URL'),
  production: site.startsWith('https://') && !site.includes('localhost'),
};
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/_headers'), headersFile(context));
console.log(`[headers] public/_headers written (production=${context.production}, api=${context.api || '-'}, media=${context.media || '-'})`);
