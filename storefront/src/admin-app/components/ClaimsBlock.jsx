import { useCallback, useEffect, useState } from 'react';
import { adminApi as api } from '../../admin/adminApi';
import { GxButton, Alert } from './gx';

/**
 * Opens a GOODEX claim for one order's parcel, from the provider's own type list. This is the
 * only claim action left on the order: listing, refreshing and cancelling claims lives in the
 * Ventes > Réclamations page (AdminClaims). A claim never changes the order, its totals or
 * the parcel. The status labels below are shared with that page.
 */

const STATUS_LABELS = { nouveau: 'Nouvelle', en_cours: 'En cours', resolu: 'Résolue', rejete: 'Rejetée' };
const STATUS_TONES = { nouveau: 'warn', en_cours: 'pending', resolu: 'ok', rejete: 'error' };

export function claimStatusLabel(claim) {
  if (claim.cancelled) return 'Annulée';
  return STATUS_LABELS[claim.status] || claim.status || 'Statut inconnu';
}

export function claimTone(claim) {
  if (claim.cancelled) return 'none';
  return STATUS_TONES[claim.status] || 'warn';
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ValueInput({ def, value, onChange }) {
  const common = { className: 'gx-input', value, onChange: (e) => onChange(e.target.value), required: true };
  if (def.valueType === 'date') return <input {...common} type="date" min={todayIso()} />;
  if (def.valueType === 'telephone') return <input {...common} type="tel" inputMode="numeric" placeholder="55899090" />;
  if (def.valueType === 'montant') return <input {...common} type="text" inputMode="decimal" placeholder="85.000" />;
  return <input {...common} type="text" maxLength={255} />;
}

export default function ClaimsBlock({ order }) {
  const delivery = order.delivery;
  const eligible = delivery?.state === 'created' && Boolean(delivery?.ean);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null); // { tone, text }
  const [busy, setBusy] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [types, setTypes] = useState(null);
  const [form, setForm] = useState({ type: '', valeur: '', message: '' });

  const load = useCallback(async () => {
    try {
      setData(await api.getOrderClaims(order.id));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [order.id]);

  useEffect(() => {
    if (eligible) load();
  }, [eligible, load]);

  if (!eligible) return null;

  const def = types?.find((t) => t.code === form.type) || null;

  const openForm = async () => {
    setNotice(null);
    setError('');
    setBusy('types');
    try {
      if (!types) setTypes((await api.getClaimTypes()).types);
      setFormOpen(true);
    } catch (err) {
      setError(`Types de réclamation indisponibles : ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice(null);
    if (!def) return setError('Choisissez un type de réclamation.');
    if (def.needsValue && !form.valeur.trim()) return setError('Cette information est obligatoire pour ce motif.');
    if (def.messageRequired && !form.message.trim()) return setError('Un message est obligatoire pour ce motif.');

    setBusy('open');
    try {
      const res = await api.openOrderClaim(order.id, {
        type: form.type,
        valeur: def.needsValue ? form.valeur : undefined,
        message: form.message || undefined,
      });
      if (res.result === 'created') {
        setNotice({
          tone: res.warning ? 'warn' : 'ok',
          title: 'Réclamation envoyée',
          text: `${res.claim?.reference || ''} a été transmise à GOODEX.${res.warning ? ` ${res.warning}` : ''} Suivez-la dans Ventes › Réclamations.`,
        });
      } else {
        // HTTP 200 already_sent: nothing new was created, and it must not look like it was.
        setNotice({
          tone: 'warn',
          title: "Aucune nouvelle réclamation n'a été créée",
          text: `${res.message || ''}${res.claim ? ` Réclamation existante : ${res.claim.reference || `n°${res.claim.goodexClaimId}`}.` : ''}`,
        });
      }
      setForm({ type: '', valeur: '', message: '' });
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="gx-card" id={`gx-claims-${order.id}`} aria-label="Réclamations GOODEX">
      <header className="gx-card__head">
        <h4 className="gx-card__title">Réclamation GOODEX</h4>
        <span className="gx-card__spacer" />
        {!formOpen && (
          <GxButton variant="primary" icon="plus" busy={busy === 'types'} disabled={data ? !data.canOpen : false} onClick={openForm}>
            Nouvelle réclamation
          </GxButton>
        )}
      </header>

      {notice && <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {formOpen && types && (
        <form className="gx-form" onSubmit={submit}>
          <label className="gx-field">
            <span className="gx-field__label">Type de réclamation</span>
            <select
              className="gx-input"
              value={form.type}
              onChange={(e) => setForm({ type: e.target.value, valeur: '', message: form.message })}
            >
              <option value="">Choisir un type…</option>
              {types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
          </label>
          {def?.needsValue && (
            <label className="gx-field">
              <span className="gx-field__label">{def.hint || 'Valeur'} <em>*</em></span>
              <ValueInput def={def} value={form.valeur} onChange={(valeur) => setForm({ ...form, valeur })} />
            </label>
          )}
          {def && (
            <label className="gx-field gx-field--wide">
              <span className="gx-field__label">Message {def.messageRequired ? <em>*</em> : <small>(facultatif)</small>}</span>
              <textarea
                className="gx-input"
                rows={3}
                maxLength={1000}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
              <small className="gx-field__hint">{form.message.length} / 1000</small>
            </label>
          )}
          <p className="gx-note">
            Le colis doit avoir quitté l'état « En Attente ». GOODEX refuse une deuxième réclamation du même type tant que la première reste ouverte.
          </p>
          <div className="gx-form__actions">
            <GxButton type="submit" variant="primary" icon="check" busy={busy === 'open'} disabled={!def}>
              {busy === 'open' ? 'Envoi…' : 'Envoyer la réclamation'}
            </GxButton>
            <GxButton variant="ghost" onClick={() => setFormOpen(false)}>Fermer</GxButton>
          </div>
        </form>
      )}
    </section>
  );
}
