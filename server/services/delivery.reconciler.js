import { env } from '../config/env.js';
import { missingApiConfig, liveCallBlockReason } from '../config/goodex.js';
import { deliveryRepository } from '../repositories/delivery.repository.js';
import { refreshDeliveryRow } from './delivery.service.js';

/**
 * Background status reconciliation: periodically asks GOODEX (read-only GET) for the current
 * status of EXISTING parcels and saves valid changes through the same code as the manual
 * refresh. It never creates, retries or cancels anything: it only imports the row-level refresh,
 * never the parcel-creation functions.
 *
 * Safeguards
 *  - one run at a time (a run that is still going makes the next call a no-op);
 *  - bounded batch and bounded concurrency;
 *  - run-level stops: authentication / configuration errors end the run, a rate limit ends it and
 *    pauses the scheduler (Retry-After, at least one interval), several consecutive network /
 *    server / timeout failures end it (the provider looks down);
 *  - a parcel that keeps failing is skipped for exponentially longer (in memory, capped at 6 h);
 *  - the repository query spaces polls by how stale a parcel is and how long GOODEX has not found
 *    it, so no parcel is hammered (see findRefreshCandidates);
 *  - a failed request never changes the saved status and never becomes a cancellation.
 * Single-instance design: two instances would only double the read-only requests (saving a status
 * is idempotent), so enable it (GOODEX_POLL_INTERVAL_MINUTES) on one instance only.
 */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TRANSIENT_KINDS = new Set(['server', 'network', 'timeout']);

function defaultCanRun() {
  if (missingApiConfig().length) return 'not_configured';
  if (liveCallBlockReason()) return 'live_blocked';
  return null;
}

export function createDeliveryReconciler({
  intervalMinutes = env.goodex.poll.intervalMinutes,
  batchSize = env.goodex.poll.batchSize,
  concurrency = env.goodex.poll.concurrency,
  maxAgeDays = env.goodex.poll.maxAgeDays,
  initialDelayMs = 60 * 1000,
  maxTransientFailures = 5,
  findCandidates = (args) => deliveryRepository.findRefreshCandidates(args),
  refresh = refreshDeliveryRow,
  canRun = defaultCanRun,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = console,
} = {}) {
  const intervalMs = Math.max(0, Number(intervalMinutes) || 0) * 60 * 1000;
  const rowBackoff = new Map(); // delivery id -> { fails, until }
  let running = false;
  let inflight = null;
  let timer = null;
  let stopped = true;
  let pausedUntil = 0;
  let lastSkip = null;

  function newStats() {
    return { selected: 0, updated: 0, unchanged: 0, notFound: 0, skipped: 0, backedOff: 0, errors: {}, aborted: null };
  }

  async function runOnce() {
    if (running) return { skipped: 'already_running' };
    const startedAt = now().getTime();
    if (startedAt < pausedUntil) return { skipped: 'paused', until: new Date(pausedUntil) };
    const blocked = canRun();
    if (blocked) {
      if (lastSkip !== blocked) log.log(`[reconciler] not running: ${blocked}`);
      lastSkip = blocked;
      return { skipped: blocked };
    }
    lastSkip = null;

    running = true;
    inflight = (async () => {
      const stats = newStats();
      try {
        for (const [id, entry] of rowBackoff) if (entry.until <= startedAt) rowBackoff.delete(id);
        const candidates = await findCandidates({
          now: now(),
          limit: batchSize,
          baseGapMs: Math.floor(intervalMs / 2),
          maxAgeDays,
          excludeIds: [...rowBackoff.keys()],
        });
        stats.selected = candidates.length;
        stats.backedOff = rowBackoff.size;

        let cursor = 0;
        let transientStreak = 0;
        const fail = (kind) => { stats.errors[kind] = (stats.errors[kind] || 0) + 1; };

        const handle = async (row) => {
          let outcome;
          try {
            outcome = await refresh(row);
          } catch {
            outcome = { ok: false, kind: 'internal' };
          }
          if (outcome.ok) {
            transientStreak = 0;
            rowBackoff.delete(row.id);
            if (outcome.outcome === 'updated') stats.updated += 1;
            else if (outcome.outcome === 'not_found') stats.notFound += 1;
            else if (outcome.outcome === 'skipped') stats.skipped += 1;
            else stats.unchanged += 1;
            return;
          }
          const kind = outcome.kind || 'internal';
          fail(kind);
          if (kind === 'config' || kind === 'auth') {
            stats.aborted = kind;
            return;
          }
          if (kind === 'rate_limit') {
            stats.aborted = 'rate_limit';
            pausedUntil = now().getTime() + Math.max(outcome.retryAfterMs || 0, intervalMs);
            return;
          }
          const fails = (rowBackoff.get(row.id)?.fails || 0) + 1;
          rowBackoff.set(row.id, { fails, until: now().getTime() + Math.min(Math.max(intervalMs, 60_000) * 2 ** fails, SIX_HOURS_MS) });
          if (TRANSIENT_KINDS.has(kind)) {
            transientStreak += 1;
            if (transientStreak >= maxTransientFailures) stats.aborted = 'provider_unavailable';
          }
        };

        const workers = Array.from({ length: Math.min(Math.max(1, concurrency), candidates.length) }, async () => {
          while (!stats.aborted) {
            const index = cursor;
            cursor += 1;
            if (index >= candidates.length) return;
            await handle(candidates[index]);
          }
        });
        await Promise.all(workers);
      } catch (err) {
        stats.aborted = 'internal';
        fail('internal');
        log.error(`[reconciler] run failed (${err?.cause?.code || err?.code || 'error'})`);
      }
      if (stats.selected || stats.aborted) {
        const errors = Object.entries(stats.errors).map(([k, n]) => `${k}:${n}`).join(',') || 'none';
        log.log(`[reconciler] selected=${stats.selected} updated=${stats.updated} unchanged=${stats.unchanged} not_found=${stats.notFound} skipped=${stats.skipped} errors=${errors}${stats.aborted ? ` aborted=${stats.aborted}` : ''}`);
      }
      return stats;
    })();
    try {
      return await inflight;
    } finally {
      running = false;
      inflight = null;
    }
  }

  function schedule(delayMs) {
    if (stopped) return;
    timer = setTimer(async () => {
      timer = null;
      try {
        await runOnce();
      } catch {
        // runOnce already contains its own failures
      }
      schedule(intervalMs);
    }, delayMs);
    timer?.unref?.();
  }

  return {
    enabled: intervalMs > 0,
    isRunning: () => running,
    runOnce,
    /** Starts the periodic runs. A zero interval disables the reconciler (no timer at all). */
    start() {
      if (intervalMs <= 0 || !stopped) return false;
      stopped = false;
      schedule(Math.min(initialDelayMs, intervalMs));
      return true;
    },
    /** Stops scheduling and waits for the run in progress, so nothing is left hanging. */
    async stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
      if (inflight) {
        try {
          await inflight;
        } catch {
          // nothing to report
        }
      }
    },
    /** Test visibility. */
    _state: () => ({ pausedUntil, backedOffIds: [...rowBackoff.keys()], scheduled: timer !== null, stopped }),
  };
}

let instance = null;

/** Starts the reconciler from the environment settings. Returns null when it is disabled. */
export function startDeliveryReconciler() {
  const reconciler = createDeliveryReconciler();
  if (!reconciler.enabled) {
    console.log('[reconciler] GOODEX status reconciliation is off (set GOODEX_POLL_INTERVAL_MINUTES to a number of minutes, e.g. 15, to enable it)');
    return null;
  }
  reconciler.start();
  instance = reconciler;
  console.log(`[reconciler] GOODEX status reconciliation every ${env.goodex.poll.intervalMinutes} min (batch ${env.goodex.poll.batchSize}, concurrency ${env.goodex.poll.concurrency})`);
  return reconciler;
}

export async function stopDeliveryReconciler() {
  const current = instance;
  instance = null;
  if (current) await current.stop();
}
