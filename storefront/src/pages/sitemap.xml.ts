import type { APIRoute } from 'astro';
import { siteUrl } from '../lib/config';
import { loadSitemapEntries } from '../lib/pages/load';
import { sitemapXml } from '../lib/seo/sitemap.ts';

// Written once per build from the same snapshot as the pages (a static file: no API request when a crawler fetches it).
export const GET: APIRoute = async () =>
  new Response(sitemapXml(siteUrl(), await loadSitemapEntries()), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
