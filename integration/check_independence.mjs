/**
 * server/ and storefront/ must not use each other's files: they are deployed separately (Render, Cloudflare) and talk
 * over HTTP only. This check reads every source file of both apps and fails when a relative import, dynamic import,
 * `new URL('...', import.meta.url)` or path built with path.join/path.resolve reaches outside the app's own folder.
 * (shared/ is a copy in each app, see node integration/check_shared_in_sync.mjs.)
 *
 * Usage: node integration/check_independence.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.wrangler', '.git', 'uploads']);
const EXT = /\.(m?js|cjs|jsx|tsx?|astro|json)$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.test(entry.name) && !/package(-lock)?\.json$/.test(entry.name)) out.push(full);
  }
  return out;
}

// String literals that start with ./ or ../ in a position that loads or reads a file.
const LOADERS = [
  /\bfrom\s+['"](\.{1,2}\/[^'"]*)['"]/g,
  /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]*)['"]/g,
  /\bimport\s+['"](\.{1,2}\/[^'"]*)['"]/g,
  /\brequire\s*\(\s*['"](\.{1,2}\/[^'"]*)['"]/g,
  /new URL\(\s*[`'"](\.{1,2}\/[^`'"]*)[`'"]\s*,\s*import\.meta\.url/g,
];

let problems = 0;
for (const app of ['server', 'storefront']) {
  const appRoot = path.join(repo, app);
  const other = app === 'server' ? 'storefront' : 'server';
  for (const file of walk(appRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of LOADERS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const target = path.resolve(path.dirname(file), m[1]);
        if (target !== appRoot && !target.startsWith(appRoot + path.sep)) {
          problems++;
          console.error(`✗ ${path.relative(repo, file)}: "${m[1]}" leaves ${app}/${target.startsWith(path.join(repo, other)) ? ` and reaches into ${other}/` : ''}`);
        }
      }
    }
    // path.join / path.resolve with segments that climb out of the app, e.g. path.join(__dirname, '../../shared')
    for (const m of text.matchAll(/path\.(?:join|resolve)\(([^)]*)\)/g)) {
      const segs = [...m[1].matchAll(/['"`]([^'"`]*)['"`]/g)].map((s) => s[1]);
      const rel = segs.join('/');
      if (!/(?:^|\/)\.\.\//.test(rel) && !rel.endsWith('..')) continue;
      const ups = (rel.match(/\.\.\//g) || []).length;
      const depth = path.relative(appRoot, path.dirname(file)).split(path.sep).filter(Boolean).length;
      if (ups > depth) {
        problems++;
        console.error(`✗ ${path.relative(repo, file)}: path "${rel}" climbs out of ${app}/`);
      }
    }
  }
}

if (problems) {
  console.error(`\n✗ FAIL: ${problems} reference(s) between server/ and storefront/`);
  process.exit(1);
}
console.log('✓ PASS: nothing in server/ uses storefront/ and nothing in storefront/ uses server/ (relative imports and file paths checked)');
