// The catalogue for the static build: ONE request to the API (/api/storefront/snapshot), validated, kept for the whole build.
// Every public page and the sitemap are generated from this single object, so they always agree with each other.
//
// If the snapshot cannot be had (API asleep for too long, unusable answer, wrong database) this throws and the build fails:
// there is no fallback data, and nothing is deployed from a failed build.
import { allowLocalApiForBuild, isProduction, snapshotApiUrl, snapshotOptions } from '../config';
import { fetchSnapshot } from '../snapshot/fetchSnapshot.ts';
import { SnapshotError } from '../snapshot/validate.ts';

export type Snapshot = {
  generatedAt: string;
  /** What a rebuild would change (server/services/catalogue.fingerprint.js); copied into build-info.json. */
  fingerprint: string;
  products: any[];
  summaries: any[];
  categories: { slug: string; name: string }[];
  reviews: Record<string, { reviews: any[]; summary: { average: number; count: number } }>;
  theme: any;
  settings: { deliveryFee: number };
};

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i;

/** Refuses to build a production site (https address) from an API on this very machine: that is a developer's database. */
export function assertBuildSource(apiBase: string) {
  let host = '';
  try {
    host = new URL(apiBase).hostname;
  } catch {
    throw new SnapshotError(`API address "${apiBase}" is not a URL: set SNAPSHOT_API_URL (or API_URL) for the build.`, true);
  }
  if (isProduction() && LOOPBACK.test(host) && !allowLocalApiForBuild()) {
    throw new SnapshotError(
      `This build is for ${'the production address'} but the API address is ${apiBase} (this machine). Refusing to publish a site built from a local database: set SNAPSHOT_API_URL to the real API (https://api.silky.tn).`,
      true,
    );
  }
}

let pending: Promise<Snapshot> | null = null;

export function getSnapshot(): Promise<Snapshot> {
  pending ??= (async () => {
    const base = snapshotApiUrl();
    assertBuildSource(base);
    const options = snapshotOptions();
    return (await fetchSnapshot({
      url: `${base}/api/storefront/snapshot`,
      ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
      log: (message) => console.log(`[snapshot] ${message}`),
    })) as Snapshot;
  })();
  // A failed attempt is not remembered, so the next caller tries again; the first caller still sees the error.
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
