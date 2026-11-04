import type { APIRoute } from 'astro';
import { siteUrl } from '../lib/config';
import { loadSitemapEntries } from '../lib/pages/load';
import { PAGE_CACHE_CONTROL } from '../lib/pages/respond';
import { sitemapXml } from '../lib/seo/sitemap.ts';

// Built on every request from the API (products live in the database, so @astrojs/sitemap cannot know them).
export const GET: APIRoute = async () => {
  try {
    const data = await loadSitemapEntries();
    return new Response(sitemapXml(siteUrl(), data), {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': PAGE_CACHE_CONTROL },
    });
  } catch {
    // The API is down: a 503 makes crawlers retry instead of dropping the sitemap.
    return new Response('Service temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } });
  }
};
