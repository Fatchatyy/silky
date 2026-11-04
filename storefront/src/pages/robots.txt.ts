import type { APIRoute } from 'astro';
import { siteUrl } from '../lib/config';
import { robotsTxt } from '../lib/seo/sitemap.ts';

export const GET: APIRoute = () =>
  new Response(robotsTxt(siteUrl()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
