import type { APIRoute } from 'astro';
import { getSnapshot } from '../lib/pages/snapshot';

// The search box and the search page look products up in this small file instead of downloading every product with all its
// variants (GET /api/products). One line per published product: what a card and a search match need, descriptions cut short.
// Rebuilt with the site, so a new product is searchable after the next publish (like its page). Not for search engines.
const SNIPPET = 300;
const cut = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET);

export const GET: APIRoute = async () => {
  const snapshot = await getSnapshot();
  const byId = new Map(snapshot.products.map((product) => [product.id, product]));
  const index = snapshot.summaries.map((summary) => {
    const full = byId.get(summary.id);
    return { ...summary, description: cut(full?.description), descriptionAr: cut(full?.descriptionAr) };
  });
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
