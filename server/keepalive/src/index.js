// Keep-awake Worker for the API on Render's free plan (which sleeps after 15 minutes without traffic).
//
// A Cron Trigger fires every 10 minutes; ticks outside the opening hours (07:00 to midnight in Tunis by default) do
// nothing, so the API is allowed to sleep at night. Inside the window the Worker calls GET /ping of the API, which
// answers `{ ok: true }` without touching the database (the Neon free database keeps sleeping).
//
// This project is deployed on its own (`npm run deploy` inside server/keepalive/). It imports nothing from the API or
// from the storefront; the API only provides the /ping route.
import { isInsideWindow, readWindow } from './window.js';

const PING_TIMEOUT_MS = 90_000; // a sleeping Render instance takes about a minute to wake up

/** Calls the API once. Resolves with a short result for the logs; rejects when the API did not answer correctly. */
export async function ping(env, fetchImpl = fetch) {
  const url = String(env.PING_URL ?? '').trim();
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) {
    throw new Error('PING_URL is missing or is not an https address');
  }
  const startedAt = Date.now();
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'silky-keepalive', Accept: 'application/json' },
    signal: AbortSignal.timeout(PING_TIMEOUT_MS),
  });
  const ms = Date.now() - startedAt;
  if (!response.ok) throw new Error(`ping answered HTTP ${response.status} after ${ms} ms`);
  const body = await response.json().catch(() => null);
  if (!body || body.ok !== true) throw new Error(`ping answered an unexpected body after ${ms} ms`);
  return `ping ok in ${ms} ms`;
}

/** What one cron tick does. `scheduledTime` is the tick's own time (ms), so the decision does not depend on a delayed start. */
export async function runTick(env, scheduledTime, fetchImpl = fetch) {
  const window = readWindow(env);
  if (!isInsideWindow(scheduledTime, window)) return 'skipped: outside the keep-awake window';
  return ping(env, fetchImpl);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runTick(env, event.scheduledTime).then(
        (message) => console.log(`[keepalive] ${message}`),
        (error) => {
          console.error(`[keepalive] ${error.message}`);
          throw error; // the run shows as failed in the Cloudflare dashboard
        },
      ),
    );
  },
};
