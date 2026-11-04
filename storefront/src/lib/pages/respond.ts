// Response headers of server-rendered pages (plan 2.8). The pages are the same for every visitor (the cart, the login
// and the favourites are drawn in the browser), so the rendered HTML may be shared: browsers revalidate at once,
// the Cloudflare cache keeps it 5 minutes and may serve it stale for a day while it refreshes. A price change in the
// admin therefore shows within about 5 minutes. 404 and 5xx are never cached.
export const PAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';

export function cacheablePage(response: ResponseInit & { headers: Headers }, ok: boolean) {
  // Never shared while developing, so an edit shows on the next reload.
  response.headers.set('Cache-Control', ok && !import.meta.env.DEV ? PAGE_CACHE_CONTROL : 'no-store');
}

/** Open Graph photo of a home or collection page: the first product's photo (its 1200 px copy is picked by the SEO builder), else the logo. */
export function shareImagePath(products: any[]): string {
  const first = products?.[0];
  return first?.mainImage || first?.collectionImage || '/pictures/logo.png';
}
