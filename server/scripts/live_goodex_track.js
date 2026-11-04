/**
 * MANUAL live check, not an automated test: one read-only tracking call to the real GOODEX.
 * Creates nothing. Prints whether credentials are configured (never their values) and the
 * parsed tracking result.
 *
 * Usage: node server/scripts/live_goodex_track.js [EAN]   (default: the known test parcel)
 */
import { env } from '../config/env.js';
import { missingApiConfig } from '../config/goodex.js';
import { trackParcel } from '../services/goodex.client.js';

const ean = process.argv[2] || 'SOU3381271432961';

const missing = missingApiConfig();
console.log(`Base URL: ${env.goodex.baseUrl}`);
console.log(`Credentials: ${missing.length ? `MISSING ${missing.join(', ')}` : 'present'}`);
if (missing.length) process.exit(2);

// Running this script is the explicit opt-in to a real call; the test-database gate still applies.
env.goodex.enableLive = true;

const r = await trackParcel(ean);
if (!r.ok) {
  console.log(`Tracking failed: ${r.error}${r.configError ? ' (configuration, nothing sent)' : ''}`);
  process.exit(1);
}
console.log(JSON.stringify({ ean, notFound: r.notFound, statut: r.statut, hasMotif: r.hasMotif, motif: r.motif }));
