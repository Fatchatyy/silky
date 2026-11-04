// Runs before every page: canonical-address redirects, the rendered-page cache (Workers Cache API) and the
// security headers (plan 2.8 and 2.11).
import { defineMiddleware } from 'astro:middleware';
import { isProduction, mediaBase, publicApiUrl } from './lib/config';

// Page types whose rendered HTML is cached for everyone: home, collections, products and the text pages, French
// and Arabic. The cart, checkout, account ... are static shells (their data is fetched in the browser).
const CACHEABLE = /^(?:\/ar)?(?:\/|\/collection\/[^/]+|\/product\/[^/]+|\/faq|\/livraison-retours|\/service-client|\/about|\/contact|\/sitemap\.xml)$/;

const redirect = (to: string) => new Response(null, { status: 301, headers: { Location: to, 'Cache-Control': 'public, max-age=3600' } });

function securityHeaders(headers: Headers, pathname: string) {
  const api = publicApiUrl();
  const media = mediaBase();
  const origins = (...list: string[]) => list.filter(Boolean).join(' ');

  headers.set('X-Content-Type-Options', 'nosniff');
  // A password-reset address carries a secret token: never send it as a referrer (Google Fonts, social links ...).
  headers.set('Referrer-Policy', pathname.includes('/password-reset/') ? 'no-referrer' : 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (isProduction()) headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');

  // Report-only first (like the old server): nothing is blocked until the site has been browsed without a report.
  // 'unsafe-inline' scripts are needed by Astro's island loader; hashes are the way to tighten this later.
  headers.set(
    'Content-Security-Policy-Report-Only',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      `img-src ${origins("'self'", 'data:', 'blob:', media)}`,
      `media-src ${origins("'self'", 'blob:', media)}`,
      `connect-src ${origins("'self'", api)}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);

  if (url.pathname === '/index.html') return redirect(`/${url.search}`);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) return redirect(`${url.pathname.replace(/\/+$/, '')}${url.search}`);

  // Not while developing: a cached page would hide every edit (the Workers cache persists across dev restarts).
  const cache: Cache | undefined = import.meta.env.DEV ? undefined : (globalThis as any).caches?.default;
  const cacheable =
    cache && request.method === 'GET' && CACHEABLE.test(url.pathname) && !request.headers.has('authorization');
  // These pages ignore the query string, so a crawler adding ?utm_... does not bypass the cache.
  const cacheKey = cacheable ? new Request(`${url.origin}${url.pathname}`, { method: 'GET' }) : null;

  if (cache && cacheKey) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const response = new Response(hit.body, hit);
      response.headers.set('x-silky-cache', 'HIT');
      securityHeaders(response.headers, url.pathname);
      return response;
    }
  }

  const rendered = await next();
  const response = new Response(rendered.body, rendered);
  securityHeaders(response.headers, url.pathname);

  if (cache && cacheKey) {
    response.headers.set('x-silky-cache', 'MISS');
    // Only successful pages are stored: a 404 or 5xx must never be served from the cache.
    if (response.status === 200 && /s-maxage/.test(response.headers.get('Cache-Control') ?? '')) {
      const store = cache.put(cacheKey, response.clone());
      const waitUntil = (context.locals as any).cfContext?.waitUntil;
      if (typeof waitUntil === 'function') waitUntil.call((context.locals as any).cfContext, store);
      else await store;
    }
  }
  return response;
});
