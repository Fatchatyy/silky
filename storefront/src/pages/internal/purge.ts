import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { apiUrl } from '../../lib/config';
import { cacheKeyFor, pathsForSite, pathsToPurge } from '../../lib/pages/cacheKeys';
import { loadSitemapEntries } from '../../lib/pages/load';
import { forgetCachedData } from '../../lib/serverApi';

// Called by the admin's browser (the admin panel at /admin and the editor on the product pages) after it saves, hides, shows or
// deletes a product, moderates a product review, or changes the theme/announcement bar/hero (plan: visitors must not wait
// for the 5-minute page cache). Body: { slug, category, previousCategory } or { productId } (the page of that product) or { all: true }.
// Only an admin may call it: the token is checked against the API, which reads the users table on every request (a demoted
// or logged-out admin is refused).
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function isAdmin(authorization: string | null) {
  if (!authorization || !/^Bearer\s+\S+$/.test(authorization)) return false;
  try {
    const res = await fetch(`${apiUrl()}/api/auth/me`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    return (await res.json())?.user?.role === 'admin';
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isAdmin(request.headers.get('authorization')))) return json({ error: 'Forbidden' }, 403);

  let change: any = {};
  try {
    change = await request.json();
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }
  let paths: string[];
  if (change?.all === true) {
    // Colours, announcement bar and hero show on every page: drop every cacheable page.
    try {
      paths = pathsForSite(await loadSitemapEntries());
    } catch {
      return json({ error: 'The API is unreachable' }, 503);
    }
  } else {
    let { slug, category } = change ?? {};
    if (!slug && typeof change?.productId === 'string' && /^[0-9a-f-]{36}$/i.test(change.productId)) {
      // Only an id is known (review moderation): ask the API, as this admin, which page it belongs to.
      try {
        const res = await fetch(`${apiUrl()}/api/products/${change.productId}`, { headers: { Authorization: request.headers.get('authorization')! }, signal: AbortSignal.timeout(5000) });
        if (res.ok) ({ slug, category } = await res.json());
      } catch {}
    }
    paths = pathsToPurge({ slug, category: change?.category ?? category, previousCategory: change?.previousCategory });
  }
  const origin = new URL(request.url).origin;

  // Workers Cache API: removes the pages from the cache of the data center that runs this request.
  const cache: Cache | undefined = (globalThis as any).caches?.default;
  let removedHere = 0;
  if (cache) for (const path of paths) if (await cache.delete(cacheKeyFor(origin, path))) removedHere++;
  forgetCachedData();

  // Every other data center: Cloudflare's purge-by-URL API, when its credentials are configured (Worker secrets
  // CF_ZONE_ID and CF_API_TOKEN, set at deployment). Without them the other data centers drop the page within 5 minutes.
  const runtime = workerEnv as unknown as Record<string, string | undefined>;
  let zonePurge: 'done' | 'failed' | 'not configured' = 'not configured';
  if (runtime.CF_ZONE_ID && runtime.CF_API_TOKEN) {
    try {
      zonePurge = 'done';
      for (let i = 0; i < paths.length; i += 30) {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${runtime.CF_ZONE_ID}/purge_cache`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${runtime.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: paths.slice(i, i + 30).map((path) => `${origin}${path}`) }),
        });
        if (!res.ok) zonePurge = 'failed';
      }
    } catch {
      zonePurge = 'failed';
    }
  }
  return json({ paths, removedHere, zonePurge });
};
