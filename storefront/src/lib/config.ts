// Server-side configuration. Runtime values (the API address) come from the Worker environment
// (wrangler.jsonc "vars", .dev.vars or `wrangler deploy --var`); build-time values (PUBLIC_*) from import.meta.env.
// Server code only: the browser reads import.meta.env.PUBLIC_* directly.
import { env as workerEnv } from 'cloudflare:workers';

const runtime = workerEnv as unknown as Record<string, string | undefined>;
const trim = (value: string | undefined) => String(value ?? '').trim().replace(/\/+$/, '');

/** Where the Astro server fetches catalog data. */
export const apiUrl = () => trim(runtime.API_URL || import.meta.env.API_URL || import.meta.env.PUBLIC_API_URL);

/** The API as the browser sees it (used for the Content-Security-Policy; the browser code has it built in). */
export const publicApiUrl = () => trim(runtime.PUBLIC_API_URL || import.meta.env.PUBLIC_API_URL);

/** Public address of this site: canonical, hreflang, Open Graph, sitemap and JSON-LD URLs are built from it. */
export const siteUrl = () => trim(runtime.PUBLIC_SITE_URL || import.meta.env.PUBLIC_SITE_URL) || 'https://silky.tn';

/** Where uploaded photos are served from (server-rendered <img> and Open Graph images). */
export const mediaBase = () => trim(runtime.PUBLIC_MEDIA_URL || import.meta.env.PUBLIC_MEDIA_URL);

export const isProduction = () => siteUrl().startsWith('https://') && !siteUrl().includes('localhost');

// --- Static build (src/lib/pages/snapshot.ts). Read while `astro build` prerenders the pages; never at visitor time. ---
const number = (value: string | undefined) => (value && Number.isFinite(Number(value)) ? Number(value) : undefined);

/** The API the BUILD reads the catalogue from. SNAPSHOT_API_URL wins over API_URL so a Worker variable meant for run time (often localhost in wrangler.jsonc) cannot point a production build at the wrong place. */
export const snapshotApiUrl = () => trim(runtime.SNAPSHOT_API_URL || import.meta.env.SNAPSHOT_API_URL) || apiUrl();
export const snapshotOptions = () => ({
  attemptTimeoutMs: number(runtime.SNAPSHOT_ATTEMPT_TIMEOUT_MS || import.meta.env.SNAPSHOT_ATTEMPT_TIMEOUT_MS),
  totalBudgetMs: number(runtime.SNAPSHOT_BUDGET_MS || import.meta.env.SNAPSHOT_BUDGET_MS),
  minProducts: number(runtime.SNAPSHOT_MIN_PRODUCTS || import.meta.env.SNAPSHOT_MIN_PRODUCTS),
});
/** Products per collection page (default 48). Read at build time; the tests lower it to get several pages from a small catalogue. */
export const collectionPageSize = () => {
  const value = number(runtime.COLLECTION_PAGE_SIZE || import.meta.env.COLLECTION_PAGE_SIZE);
  return value && Number.isInteger(value) && value >= 1 ? value : 48;
};
/** Escape hatch for tests and local rehearsals: allow a production-looking build (https site address) to read a loopback API. */
export const allowLocalApiForBuild = () => String(runtime.ALLOW_LOCAL_API_FOR_BUILD || import.meta.env.ALLOW_LOCAL_API_FOR_BUILD || '') === '1';
