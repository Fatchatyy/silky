// Publishing the public site (static files built from a snapshot of the catalogue) is done ONLY by the owner, with the button in the
// admin banner (POST /api/publish). Nothing in the API starts a build by itself: no write request, no order, no start-up.
//
// The site is built by a separate process (a Cloudflare build started by the deploy hook, or `npm run publish-site`). This service
// never builds anything:
//   - the snapshot (services/storefront.service.js) carries a FINGERPRINT of everything the public pages show;
//   - the build copies that fingerprint into /build-info.json of the deployed site;
//   - the admin compares the live fingerprint (getStatus) with the deployed one: different = "changes not published yet";
//   - the button (publishNow) POSTs once to PUBLISH_HOOK_URL, the deploy hook, and the API counts the calls that were accepted
//     (publish_month_count), so the owner can keep an eye on Cloudflare's monthly build allowance.
//
// A second click while the first call is still on its way gets the answer of the first (one call, one build). A failed call is
// remembered (publish_hook_ok = false) and shown in the admin; pressing the button again is the retry.
// Never call this inside a database transaction (it does an HTTP request).
import { env } from '../config/env.js';
import { publishRepository } from '../repositories/publish.repository.js';
import { AppError } from '../utils/errors.js';
import { getSnapshot } from './storefront.service.js';

let inFlight = null;

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

/**
 * For the admin: the live fingerprint, whether a hook is set, how the last call went, and how many calls the hook accepted this
 * month (UTC calendar month) against the allowance the owner set. Admin-only (it builds the snapshot).
 */
export async function getStatus() {
  const [fingerprint, state] = await Promise.all([currentFingerprint(), publishRepository.getState()]);
  const month = new Date().toISOString().slice(0, 7);
  return {
    fingerprint,
    hookConfigured: hookConfigured(),
    lastHook: state.at ? { at: state.at, ok: state.ok === true, message: state.message ?? null, forCurrentCatalogue: state.fingerprint === fingerprint } : null,
    builds: { month, thisMonth: state.month === month ? state.monthCount : 0, limit: env.publish.monthlyBuildLimit },
  };
}

/** The « Publier maintenant » button: one call to the deploy hook. */
export async function publishNow() {
  if (!hookConfigured()) {
    throw new AppError("Aucun déclencheur de publication n'est configuré sur le serveur (PUBLISH_HOOK_URL). Lancez « npm run publish-site » dans le dossier storefront.", 409);
  }
  inFlight ??= (async () => {
    try {
      const fingerprint = await currentFingerprint();
      const { ok, message } = await callHook(fingerprint);
      if (!ok) throw new AppError(`La publication n'a pas pu être lancée (${message}).`, 502);
      return { ok: true, fingerprint };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Tests only: forget a call that is on its way. */
export function _resetPublishState() {
  inFlight = null;
}
