import type { APIRoute } from 'astro';
import { getSnapshot } from '../lib/pages/snapshot';

// What this build was made from. The admin (same origin) reads it to tell whether the live site is behind the catalogue: its
// `fingerprint` is the API's fingerprint of the snapshot the pages were generated from (see PublishStatus.jsx). Not secret.
export const GET: APIRoute = async () => {
  const snapshot = await getSnapshot();
  return new Response(
    JSON.stringify({ fingerprint: snapshot.fingerprint, snapshotGeneratedAt: snapshot.generatedAt, builtAt: new Date().toISOString(), products: snapshot.products.length }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
};
