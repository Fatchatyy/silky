import type { APIRoute } from 'astro';
import { loadLegacyRedirects } from '../lib/pages/load';

// Read by the Worker (src/middleware.ts) to redirect old product addresses (/product/<id>) and wrong-case slugs to the
// canonical address. Published products only: a hidden product is not in it, so its address stays a 404.
export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await loadLegacyRedirects()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
