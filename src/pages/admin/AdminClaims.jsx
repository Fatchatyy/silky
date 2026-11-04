import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { claimStatusLabel, claimTone } from '../../components/admin/ClaimsBlock';
import { GxButton, Alert, formatGoodexDate } from '../../components/admin/gx';

/**
 * All GOODEX claims of the account (read from GOODEX, paginated), with the provider's own
 * counters, status filters and an EAN search. Opening a claim stays on the order itself
 * (ClaimsBlock); everything else lives here. A claim never changes an order or its parcel.
 */

// `count` is the key of the matching counter returned by GOODEX.
const FILTERS = [
  { key: 'all', label: 'Toutes', params: {}, count: 'total' },
  { key: 'open', label: 'Ouvertes', params: { etat: 'ouverts' }, count: 'ouverts' },
  { key: 'nouveau', label: 'Nouvelles', params: { statut: 'nouveau' }, count: 'nouveau' },
  { key: 'en_cours', label: 'En cours', params: { statut: 'en_cours' }, count: 'en_cours' },
  { key: 'resolu', label: 'Résolues', params: { statut: 'resolu' }, count: 'resolu' },
  { key: 'rejete', label: 'Rejetées', params: { statut: 'rejete' }, count: 'rejete' },
];

export default function AdminClaims({ onShowOrder }) {
  const [filterKey, setFilterKey] = useState('open');
  const [eanInput, setEanInput] = useState('');
  const [ean, setEan] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const filter = FILTERS.find((f) => f.key === filterKey) || FILTERS[0];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getRemoteClaims({ ...filter.params, ...(ean ? { ean } : {}), page, per_page: 20 })
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, ean, page, reloadKey]);

  // Provider counters, used as returned. Unavailable counters just hide the numbers.
  useEffect(() => {
    let cancelled = false;
    api
      .getClaimCounts()
      .then((c) => {
        if (!cancelled) setCounts(c?.configured ? c : null);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const lastPage = result?.lastPage || (result?.total && result?.perPage ? Math.ceil(result.total / result.perPage) : 1);

  const cancel = async (item) => {
    if (!window.confirm(`Annuler la réclamation ${item.reference || ''} ? Seule la réclamation est annulée, pas le colis.`)) return;
    setBusyId(item.goodexClaimId);
    setNotice(null);
    try {
      await api.cancelClaim(item.localId);
      setNotice({ tone: 'ok', text: 'Réclamation annulée.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err.message });
    } finally {
      setBusyId(null);
      setReloadKey((k) => k + 1);
    }
  };

  const submitSearch = (e) => {
    e.preventDefault();
    setEan(eanInput.trim());
    setPage(1);
  };

  return (
    <section className="admin-panel">
      <div className="gx-card gx-panel">
        <header className="gx-card__head">
          <h4 className="gx-card__title">Réclamations GOODEX</h4>
          {result?.total != null && <span className="gx-chip">{result.total}</span>}
          <span className="gx-card__spacer" />
          <GxButton icon="refresh" busy={loading} onClick={() => setReloadKey((k) => k + 1)}>
            Actualiser
          </GxButton>
        </header>

        <div className="admin-segmented-control" role="group" aria-label="Filtrer les réclamations">
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f.key}
              className={`admin-segment-btn${filterKey === f.key ? ' active' : ''}`}
              onClick={() => {
                setFilterKey(f.key);
                setPage(1);
              }}
            >
              {f.label}
              {typeof counts?.[f.count] === 'number' ? ` · ${counts[f.count]}` : ''}
            </button>
          ))}
        </div>

        <form className="gx-claims-search" onSubmit={submitSearch}>
          <input
            type="text"
            className="gx-input"
            placeholder="Rechercher par code de suivi (EAN)…"
            value={eanInput}
            onChange={(e) => setEanInput(e.target.value)}
            aria-label="Rechercher par code de suivi"
          />
          <GxButton type="submit" icon="search">Rechercher</GxButton>
          {ean && (
            <GxButton
              variant="ghost"
              icon="x"
              onClick={() => {
                setEanInput('');
                setEan('');
                setPage(1);
              }}
            >
              Effacer
            </GxButton>
          )}
        </form>

        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {loading && !result && <p className="gx-empty">Chargement…</p>}
        {result && result.items.length === 0 && !loading && (
          <p className="gx-empty">
            Aucune réclamation{ean ? ` pour le code ${ean}` : ''}. Une réclamation se crée depuis le détail d&apos;une commande.
          </p>
        )}

        {result && result.items.length > 0 && (
          <div className={`gx-table-wrap${loading ? ' is-loading' : ''}`}>
            <table className="gx-table">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Colis (EAN)</th>
                  <th>Type</th>
                  <th>Statut</th>
                  <th>Valeur</th>
                  <th>Réponse GOODEX</th>
                  <th>Date</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.goodexClaimId}>
                    <td><strong>{item.reference || `n°${item.goodexClaimId}`}</strong></td>
                    <td><code className="gx-code">{item.ean || '—'}</code></td>
                    <td>{item.typeLabel || item.type || '—'}</td>
                    <td>
                      <span className={`admin-delivery-badge ${claimTone({ status: item.status, cancelled: item.cancelled })}`}>
                        {claimStatusLabel({ status: item.status, cancelled: item.cancelled })}
                      </span>
                    </td>
                    <td>{item.valeur || '—'}</td>
                    <td className="gx-table__wrap">{item.reponse || '—'}</td>
                    <td>{formatGoodexDate(item.createdAt) || '—'}</td>
                    <td className="gx-table__end">
                      {item.order ? (
                        <GxButton icon="eye" onClick={() => onShowOrder(item.order.id)}>
                          {item.order.orderNumber}
                        </GxButton>
                      ) : (
                        <span className="gx-muted">Hors Silky</span>
                      )}
                      {item.canCancel && (
                        <GxButton variant="danger" icon="x" busy={busyId === item.goodexClaimId} onClick={() => cancel(item)}>
                          Annuler
                        </GxButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result && lastPage > 1 && (
          <footer className="gx-card__actions gx-card__actions--between">
            <GxButton disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Précédent</GxButton>
            <span className="gx-muted">Page {result.page} / {lastPage}</span>
            <GxButton disabled={page >= lastPage || loading} onClick={() => setPage(page + 1)}>Suivant</GxButton>
          </footer>
        )}
      </div>
    </section>
  );
}
