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
