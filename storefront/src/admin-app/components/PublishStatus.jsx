// Banner at the top of the admin: is the public site up to date with the catalogue?
//
// The public site is a set of files built from a snapshot of the catalogue. Two fingerprints tell whether it is behind:
//   - live:     the API's fingerprint of the catalogue as it would be built right now (GET /api/publish/status);
//   - deployed: the fingerprint of the snapshot the LIVE site was built from (/build-info.json, a file of the deployed site).
// They differ = there are changes visitors cannot see yet. If the API has a deploy hook it starts a build by itself about 30
// seconds after the last change; "Publier maintenant" starts one at once. Without a hook the owner runs `npm run publish-site`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CATALOGUE_CHANGED_EVENT, getBuildInfo, getPublishStatus, publishNow } from '../../admin/adminApi';

const REFRESH_MS = 30_000;
const WATCH_MS = 10_000; // faster while a build is expected
const WATCH_FOR_MS = 15 * 60_000;

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
    // A change was just saved: look again shortly (the server needs a moment to see it, and it is the moment to start watching).
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
    setBusy(true);
    setProblem('');
    try {
      await publishNow();
      setRequestedAt(new Date().toISOString());
      watchUntil.current = Date.now() + WATCH_FOR_MS;
      refresh();
    } catch (error) {
      setProblem(error?.message || 'La publication n’a pas pu être lancée.');
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

  const upToDate = deployed && deployed.fingerprint === live.fingerprint;
  if (upToDate) {
    return (
      <div className="publish-status publish-status-ok" role="status">
        Le site public est à jour{deployed.builtAt ? ` (construit à ${time(deployed.builtAt)})` : ''}.
      </div>
    );
  }

  const waiting = requestedAt && Date.now() < watchUntil.current;
  const failed = live.lastHook && !live.lastHook.ok && live.lastHook.forCurrentCatalogue;
  return (
    <div className="publish-status publish-status-pending" role="status">
      <div className="publish-status-text">
        <strong>{deployed === null ? 'Version publiée inconnue.' : 'Modifications non publiées.'}</strong>{' '}
        {waiting
          ? `Publication demandée à ${time(requestedAt)} : le site est en cours de construction (quelques minutes).`
          : failed
            ? `Les visiteurs ne les voient pas encore. Le déclenchement automatique de la publication a échoué (${live.lastHook.message}) : utilisez « Publier maintenant ».`
            : live.hookConfigured
              ? 'Les visiteurs ne les voient pas encore. Une publication démarre automatiquement environ 30 secondes après le dernier changement ; elle prend quelques minutes.'
              : 'Les visiteurs ne les voient pas encore. Lancez « npm run publish-site » dans le dossier storefront pour les publier.'}
        {problem ? ` ${problem}` : ''}
      </div>
      {live.hookConfigured ? (
        <button type="button" className="publish-status-button" onClick={publish} disabled={busy}>
          {busy ? 'Envoi…' : 'Publier maintenant'}
        </button>
      ) : null}
    </div>
  );
}
