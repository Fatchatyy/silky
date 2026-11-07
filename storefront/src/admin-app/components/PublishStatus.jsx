// Banner at the top of the admin: is the public site up to date with the catalogue, and the « Publier maintenant » button.
//
// The public site is a set of files built from a snapshot of the catalogue. Two fingerprints tell whether it is behind:
//   - live:     the API's fingerprint of the catalogue as it would be built right now (GET /api/publish/status);
//   - deployed: the fingerprint of the snapshot the LIVE site was built from (/build-info.json, a file of the deployed site).
// They differ = there are changes visitors cannot see yet. NOTHING publishes by itself: the owner edits everything, then presses the
// button once (one request to the deploy hook, one build). The button is always there; it is highlighted while changes are waiting.
// Next to it, how many calls the hook accepted this month, against the allowance set on the API (PUBLISH_MONTHLY_BUILD_LIMIT).
// Without a hook (local development) there is no button: the owner runs `npm run publish-site`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CATALOGUE_CHANGED_EVENT, getBuildInfo, getPublishStatus, publishNow } from '../../admin/adminApi';

const REFRESH_MS = 30_000;
const WATCH_MS = 10_000; // faster while a build is expected
const WATCH_FOR_MS = 15 * 60_000;
const WARN_AT = 0.8;

const time = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function PublishStatus() {
  const [live, setLive] = useState(null); // PublishStatus from the API, or { error }
  const [deployed, setDeployed] = useState(undefined); // BuildInfo, null = unavailable, undefined = not read yet
  const [requestedAt, setRequestedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const watchUntil = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [status, info] = await Promise.all([getPublishStatus(), getBuildInfo()]);
      setLive(status);
      setDeployed(info);
    } catch (error) {
      setLive({ error: error?.message || 'Impossible de lire l’état de la publication.' });
    }
  }, []);

  useEffect(() => {
    refresh();
    let delay;
    const tick = () => {
      refresh();
      delay = setTimeout(tick, Date.now() < watchUntil.current ? WATCH_MS : REFRESH_MS);
    };
    delay = setTimeout(tick, REFRESH_MS);
    // A change was just saved: look again shortly so the banner turns to "Modifications non publiées".
    let soon;
    const onChanged = () => {
      clearTimeout(soon);
      soon = setTimeout(refresh, 1500);
    };
    const onFocus = () => refresh();
    window.addEventListener(CATALOGUE_CHANGED_EVENT, onChanged);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(delay);
      clearTimeout(soon);
      window.removeEventListener(CATALOGUE_CHANGED_EVENT, onChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const publish = async () => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      await publishNow();
      setRequestedAt(new Date().toISOString());
      watchUntil.current = Date.now() + WATCH_FOR_MS;
      refresh();
    } catch (error) {
      setProblem(error?.message || 'La publication n’a pas pu être lancée.');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!live) return null;
  if (live.error) {
    return (
      <div className="publish-status publish-status-unknown" role="status">
        État de la publication indisponible : {live.error}
      </div>
    );
  }

  const upToDate = Boolean(deployed && deployed.fingerprint === live.fingerprint);
  const waiting = Boolean(requestedAt && Date.now() < watchUntil.current);
  const failed = Boolean(live.lastHook && !live.lastHook.ok && live.lastHook.forCurrentCatalogue);

  let text;
  if (upToDate) {
    text = (
      <>
        <strong>Le site public est à jour</strong>
        {deployed.builtAt ? ` (construit à ${time(deployed.builtAt)})` : ''}.
      </>
    );
  } else if (waiting) {
    text = (
      <>
        <strong>Publication demandée à {time(requestedAt)}.</strong> Le site est en cours de construction (quelques minutes).
      </>
    );
  } else if (failed) {
    text = (
      <>
        <strong>Modifications non publiées.</strong> Le dernier envoi a échoué ({live.lastHook.message}) : cliquez de nouveau sur « Publier maintenant ».
      </>
    );
  } else if (live.hookConfigured) {
    text = (
      <>
        <strong>{deployed === null ? 'Version publiée inconnue.' : 'Modifications non publiées.'}</strong> Les visiteurs ne les voient pas encore. Quand vous avez
        terminé toutes vos modifications, cliquez sur « Publier maintenant » : une seule publication pour tous les changements (quelques minutes).
      </>
    );
  } else {
    text = (
      <>
        <strong>{deployed === null ? 'Version publiée inconnue.' : 'Modifications non publiées.'}</strong> Les visiteurs ne les voient pas encore. Lancez
        « npm run publish-site » dans le dossier storefront pour les publier.
      </>
    );
  }

  const builds = live.builds;
  const used = builds ? builds.thisMonth : 0;
  const level = !builds ? '' : used >= builds.limit ? ' publish-status-counter-over' : used >= builds.limit * WARN_AT ? ' publish-status-counter-warn' : '';

  return (
    <div className={`publish-status ${upToDate ? 'publish-status-ok' : 'publish-status-pending'}`} role="status">
      <div className="publish-status-text">
        {text}
        {problem ? ` ${problem}` : ''}
      </div>
      {live.hookConfigured ? (
        <>
          {builds ? (
            <span
              className={`publish-status-counter${level}`}
              title="Publications acceptées par Cloudflare depuis ce bouton, ce mois-ci (les publications lancées autrement ne sont pas comptées)."
            >
              Publications ce mois : {used} / {builds.limit}
            </span>
          ) : null}
          <button
            type="button"
            className={`publish-status-button${upToDate ? '' : ' publish-status-button-attention'}`}
            onClick={publish}
            disabled={busy}
          >
            {busy ? 'Envoi…' : 'Publier maintenant'}
          </button>
        </>
      ) : null}
    </div>
  );
}
