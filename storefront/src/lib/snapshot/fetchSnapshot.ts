// Fetches the catalogue snapshot for a static build, built for an API that may be ASLEEP (Render's free plan stops a service
// after 15 minutes without traffic and takes up to about a minute to wake it; Neon wakes in a second or two).
//
//  - every attempt has a long timeout (a waking service often holds the request until it is ready);
//  - failures that can heal (no connection, timeout, 408/425/429/5xx, an answer that is not JSON, a cut-off body) are retried
//    with a growing pause, inside one overall time budget;
//  - an answer that is complete but unusable (4xx, or a snapshot that fails validation) stops at once;
//  - in the end it returns a VALIDATED snapshot or throws. There is no partial result, so a build can never publish a
//    half-filled site: the caller (the Astro build) fails and nothing is deployed.
import { SnapshotError, assertSnapshot, type SnapshotRules } from './validate.ts';

export type FetchSnapshotOptions = SnapshotRules & {
  /** Full address of the snapshot, e.g. https://api.silky.tn/api/storefront/snapshot */
  url: string;
  /** Per attempt. Default 90 s. */
  attemptTimeoutMs?: number;
  /** For all attempts together. Default 8 minutes. */
  totalBudgetMs?: number;
  /** Pauses between attempts (the last one repeats). Default 2, 5, 10, 20, 30 s. */
  backoffMs?: number[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
};

const RETRY_STATUS = new Set([408, 425, 429]);

export async function fetchSnapshot(options: FetchSnapshotOptions) {
  const {
    url,
    attemptTimeoutMs = 90_000,
    totalBudgetMs = 480_000,
    backoffMs = [2_000, 5_000, 10_000, 20_000, 30_000],
    minProducts,
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    log = () => {},
  } = options;

  const started = now();
  let attempt = 0;
  let lastReason = 'no attempt made';

  while (true) {
    attempt++;
    const remaining = totalBudgetMs - (now() - started);
    if (remaining <= 0) break;
    let retryAfterMs = 0;
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(Math.min(attemptTimeoutMs, remaining)),
      });
      if (response.ok) {
        const type = response.headers.get('content-type') ?? '';
        if (!/json/i.test(type)) {
          lastReason = `answered ${response.status} but not JSON (content-type "${type || 'none'}"): the service may still be waking up`;
        } else {
          let body: any;
          try {
            body = await response.json();
          } catch {
            lastReason = 'the answer was cut off or is not valid JSON';
            body = undefined;
          }
          if (body !== undefined) {
            // A complete answer: validate it. A snapshot that fails validation is not retried (fatal).
            assertSnapshot(body, { minProducts });
            log(`snapshot received after ${attempt} attempt(s), ${((now() - started) / 1000).toFixed(1)} s, ${body.products.length} products`);
            return body;
          }
        }
      } else if (RETRY_STATUS.has(response.status) || response.status >= 500) {
        lastReason = `the API answered ${response.status}`;
        const header = Number(response.headers.get('retry-after'));
        if (Number.isFinite(header) && header > 0) retryAfterMs = Math.min(header * 1000, 60_000);
      } else {
        throw new SnapshotError(`The API answered ${response.status} to ${url}: not something a retry can fix (wrong address, or an API without the snapshot endpoint).`, true);
      }
    } catch (error: any) {
      if (error instanceof SnapshotError && error.fatal) throw error;
      lastReason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? `no answer within ${Math.round(attemptTimeoutMs / 1000)} s` : `no connection (${error?.cause?.code ?? error?.message ?? error})`;
    }

    const pause = retryAfterMs || backoffMs[Math.min(attempt - 1, backoffMs.length - 1)];
    if (totalBudgetMs - (now() - started) <= pause) break;
    log(`snapshot attempt ${attempt} failed (${lastReason}); trying again in ${Math.round(pause / 1000)} s`);
    await sleep(pause);
  }
  throw new SnapshotError(`Could not get the catalogue snapshot from ${url} in ${Math.round(totalBudgetMs / 1000)} s (${attempt} attempt(s)); last problem: ${lastReason}. Nothing was built.`);
}
