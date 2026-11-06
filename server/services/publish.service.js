// Keeps the public site (static files built from the catalogue snapshot) up to date, and tells the admin when it is behind.
//
// The site is built by a separate process (npm run publish-site, or a Cloudflare / CI build). This service never builds anything:
//   - the snapshot (services/storefront.service.js) carries a FINGERPRINT of everything the public pages show;
//   - the build copies that fingerprint into /build-info.json of the deployed site;
//   - the admin compares the live fingerprint (getStatus) with the deployed one: different = "changes not published yet";
//   - when PUBLISH_HOOK_URL is set, a change makes the API POST that URL once to start a rebuild (the "hook").
//
// When is the catalogue looked at? Only after a request that could have changed it (watcher middleware: any successful
// POST/PUT/PATCH/DELETE except sign-in, cart, favourites, contact, notifications), at most once per PUBLISH_CHECK_DELAY_SECONDS:
// a burst of edits is one look, and an idle shop costs the database nothing (no timer, no polling: the free Neon plan sleeps).
// A look that finds the fingerprint already sent to the hook does nothing, so an order that leaves every variant in stock never
// starts a build; one that sells the last item of a variant does.
//
// Failure of the hook is remembered (publish_hook_ok = false) and retried by the next look; the admin shows it and can press
// "publish now". Single-instance design, like the rate limiters: two instances would both call the hook (one build more).
// Never call this inside a database transaction (it does an HTTP request).
import { env } from '../config/env.js';
import { publishRepository } from '../repositories/publish.repository.js';
import { AppError } from '../utils/errors.js';
import { getSnapshot } from './storefront.service.js';

let timer = null;
let running = false;
let again = false;

export const hookConfigured = () => Boolean(env.publish.hookUrl);

/** Fingerprint of the catalogue as the public site would be built from it right now. */
export async function currentFingerprint() {
  return (await getSnapshot()).fingerprint;
}

/** POSTs to the hook and remembers how it went. The URL is a secret: it is never logged or returned, only the outcome. */
async function callHook(fingerprint) {
  let ok = false;
  let message;
  try {
    const response = await fetch(env.publish.hookUrl, { method: 'POST', signal: AbortSignal.timeout(env.publish.hookTimeoutMs) });
    ok = response.ok;
    message = `HTTP ${response.status}`;
    await response.arrayBuffer().catch(() => {});
  } catch (error) {
    message = error?.name === 'TimeoutError' ? 'timeout' : `no connection (${error?.cause?.code ?? error?.cause?.errors?.[0]?.code ?? error?.name ?? 'error'})`;
  }
  try {
    await publishRepository.saveHookResult({ fingerprint, ok, message });
  } catch (error) {
    console.error('[publish] could not save the hook result:', error.message);
  }
  console.log(`[publish] deploy hook ${ok ? 'called' : 'FAILED'}: ${message}`);
  return { ok, message };
}

/** One look at the catalogue: fires the hook unless it was already fired successfully for this very state. Never throws. */
export async function runCheck() {
  if (!hookConfigured()) return { skipped: 'no hook configured' };
  if (running) {
    again = true;
    return { skipped: 'already running' };
  }
  running = true;
  let outcome = { unchanged: true };
  try {
    do {
      again = false;
      const fingerprint = await currentFingerprint();
      const state = await publishRepository.getState();
      outcome = state.fingerprint === fingerprint && state.ok ? { unchanged: true } : { triggered: await callHook(fingerprint) };
    } while (again);
  } catch (error) {
    console.error('[publish] check failed:', error.message);
    outcome = { error: error.message };
  } finally {
    running = false;
  }
  return outcome;
}

/** Called after a request that may have changed the catalogue. Coalesces: one look per delay, at its end. */
export function scheduleCheck({ delayMs = env.publish.checkDelayMs } = {}) {
  if (!hookConfigured() || timer) return false;
  timer = setTimeout(() => {
    timer = null;
    runCheck();
  }, delayMs);
  timer.unref?.();
  return true;
}

/** For the admin: the live fingerprint, whether a hook is set, and how the last call went. Admin-only (it builds the snapshot). */
export async function getStatus() {
  const [fingerprint, state] = await Promise.all([currentFingerprint(), publishRepository.getState()]);
  return {
    fingerprint,
    hookConfigured: hookConfigured(),
    lastHook: state.at ? { at: state.at, ok: state.ok === true, message: state.message ?? null, forCurrentCatalogue: state.fingerprint === fingerprint } : null,
  };
}

/** "Publish now" from the admin. */
export async function publishNow() {
  if (!hookConfigured()) {
    throw new AppError("Aucun déclencheur de publication n'est configuré sur le serveur (PUBLISH_HOOK_URL). Lancez « npm run publish-site » dans le dossier storefront.", 409);
  }
  const fingerprint = await currentFingerprint();
  const { ok, message } = await callHook(fingerprint);
  if (!ok) throw new AppError(`La publication n'a pas pu être lancée (${message}).`, 502);
  return { ok: true, fingerprint };
}

/** Tests only: is a look scheduled? */
export const _checkScheduled = () => timer !== null;

/** Tests only: forget the timer and the running flags. */
export function _resetPublishState() {
  if (timer) clearTimeout(timer);
  timer = null;
  running = false;
  again = false;
}
