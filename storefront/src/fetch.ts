// The Worker's entry point (Astro 7 `src/fetch.ts`): runs for every request that reaches the Worker, before Astro's own pipeline.
//
// With the static build that is almost nothing. Cloudflare serves a file that exists (every page, the sitemap, robots.txt, the
// hashed scripts and styles, redirects/headers from public/_redirects and public/_headers) WITHOUT starting the Worker, so a
// request only gets here when no file matches:
//
//   1. the admin panel and the password-reset address, the only pages rendered on request: handed to Astro;
//   2. an OLD address that can be mapped (/product/<id>, a slug or collection in the wrong case): one 301 to the canonical
//      address, using the map the build writes (/redirects-map.json: published products only, never a hidden one);
//   3. anything else: a real 404 (status 404) with the static not-found page. A hidden or missing product is a 404 for everyone;
//      an admin's browser then opens it through the admin tools (see src/views/NotFoundView.astro).
//
// Every response built here carries `x-silky-worker: 1`, so a test (and anyone with the network tab open) can tell a page served
// as a file from one that ran the Worker: the pages must NOT have it (integration/test_static_routing.mjs).
import type { Fetchable } from 'astro';
import { FetchState, astro } from 'astro/fetch';
import { env as workerEnv } from 'cloudflare:workers';
import { isProduction, mediaBase, publicApiUrl } from './lib/config';
import { legacyTarget, type RedirectMap } from './lib/legacyRedirects';
import { ADMIN_HEADERS, securityHeaders } from './lib/securityHeaders';

const isAdminPath = (pathname: string) => pathname === '/admin' || pathname.startsWith('/admin/');
const isPasswordResetPath = (pathname: string) => /^(?:\/ar)?\/password-reset\/[^/]+$/.test(pathname);

let redirectMap: Promise<RedirectMap | null> | null = null;

/** The map of old addresses, read from the static file of this deployment (kept per Worker instance; a new deployment is a new instance). */
function loadRedirectMap(origin: string): Promise<RedirectMap | null> {
  redirectMap ??= (async () => {
    try {
      const res = await (workerEnv as any).ASSETS.fetch(new Request(`${origin}/redirects-map.json`));
      if (!res.ok) return null;
      const map = (await res.json()) as Partial<RedirectMap>;
      return { ids: map.ids ?? {}, products: map.products ?? [], collections: map.collections ?? [] };
    } catch {
      return null;
    }
  })();
  redirectMap.then((value) => {
    if (!value) redirectMap = null; // not remembered: the next request tries again
  });
  return redirectMap;
}

function finish(response: Response, pathname: string, extra: [string, string][] = []) {
  const out = new Response(response.body, response);
  const context = { api: publicApiUrl(), media: mediaBase(), production: isProduction() };
  for (const [name, value] of [...securityHeaders(context, { passwordReset: isPasswordResetPath(pathname) }), ...extra]) out.headers.set(name, value);
  out.headers.set('x-silky-worker', '1');
  return out;
}

export default {
  async fetch(request: Request) {
    // `astro dev` renders everything on request and has no static files: leave it to Astro.
    if (import.meta.env.DEV) return astro(new FetchState(request));

    // The BUILD renders every static page through this same entry point (one request per page): let those through untouched. A
    // request is one of them when it matches a real route that is prerendered. (An unknown address also carries a route, the
    // fallback 404, but that route's pattern does not match the address: that is the case handled below.)
    const state = new FetchState(request);
    if (state.routeData?.prerender && state.routeData.pattern.test(state.pathname)) return astro(state);

    const url = new URL(request.url);

    // 1. Rendered on request.
    if (isAdminPath(url.pathname)) return finish(await astro(state), url.pathname, ADMIN_HEADERS);
    if (isPasswordResetPath(url.pathname)) return finish(await astro(state), url.pathname);

    // 2. Old addresses.
    const map = await loadRedirectMap(url.origin);
    const target = map ? legacyTarget(url.pathname, map) : null;
    if (target) {
      return finish(new Response(null, { status: 301, headers: { Location: `${target}${url.search}`, 'Cache-Control': 'public, max-age=3600' } }), url.pathname);
    }

    // 3. A real 404. A missing file (script, style, photo ...) or a method that is not GET/HEAD gets a tiny plain answer; a page
    //    address gets the static not-found page, in the language of the address.
    if (/\.[a-z0-9]{1,8}$/i.test(url.pathname) || !['GET', 'HEAD'].includes(request.method)) {
      return finish(new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }), url.pathname);
    }
    const arabic = url.pathname === '/ar' || url.pathname.startsWith('/ar/');
    const page = await (workerEnv as any).ASSETS.fetch(new Request(`${url.origin}${arabic ? '/ar/404' : '/404'}`));
    const body = request.method === 'HEAD' ? null : page.ok ? page.body : 'Not found';
    return finish(new Response(body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }), url.pathname);
  },
} satisfies Fetchable;
