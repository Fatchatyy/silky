import { useEffect, useState } from 'react';
import { mediaUrl } from '@shared/media';
import { adminApi as api } from '../../admin/adminApi';
import { formatPrice } from '@shared/formatPrice';
import ArticlePicker from '../components/ArticlePicker';

const TUNISIAN_GOVERNORATES = [
  'Tunis',
  'Sousse',
  'Nabeul',
  'Ariana',
  'Manouba',
  'Monastir',
  'Mahdia',
  'Ben Arous',
  'Bizerte',
  'Kairouan',
  'Sfax',
  'Zaghouan',
  'Beja',
  'Gabes',
  'Gafsa',
  'Jendouba',
  'Kasserine',
  'Kebili',
  'Kef',
  'Medenine',
  'Sidi Bouzid',
  'Siliana',
  'Tataouine',
  'Tozeur',
];

const EMPTY_LINE = { variantId: '', quantity: 1 };

export default function AdminDraftModal({
  open,
  draftId = null,
  initialDraft = null,
  onClose,
  onSaveSuccess,
  onConfirmSuccess,
}) {
  const [inventory, setInventory] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState(draftId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [missingFields, setMissingFields] = useState([]);
  const [isConverted, setIsConverted] = useState(false);
  const [convertedOrderNumber, setConvertedOrderNumber] = useState('');

  const [form, setForm] = useState({
    customerName: '',
    phoneNumber: '',
    customerEmail: '',
    governorate: '',
    shippingAddress: '',
    deliveryFee: '',
    notes: '',
    items: [{ ...EMPTY_LINE }],
  });

  useEffect(() => {
    if (!open) return;

    setError('');
    setSuccess('');
    setMissingFields([]);
    setCurrentDraftId(draftId);

    setLoadingInventory(true);
    api
      .getAdminInventory()
      .then(setInventory)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingInventory(false));

    if (draftId) {
      api
        .getDraft(draftId)
        .then((draft) => {
          setIsConverted(Boolean(draft.convertedAt || draft.convertedOrderId));
          setConvertedOrderNumber(draft.convertedOrderId || '');
          setForm({
            customerName: draft.customerName || '',
            phoneNumber: draft.phoneNumber || '',
            customerEmail: draft.customerEmail || '',
            governorate: draft.governorate || '',
            shippingAddress: draft.shippingAddress || '',
            deliveryFee: draft.deliveryFee !== null && draft.deliveryFee !== undefined ? String(draft.deliveryFee) : '',
            notes: draft.notes || '',
            items: draft.items && draft.items.length > 0
              ? draft.items.map((item) => ({
                  variantId: item.variantId || '',
                  quantity: item.quantity || 1,
                }))
              : [{ ...EMPTY_LINE }],
          });
        })
        .catch((err) => setError(err.message));
    } else if (initialDraft) {
      setIsConverted(Boolean(initialDraft.convertedAt || initialDraft.convertedOrderId));
      setConvertedOrderNumber(initialDraft.convertedOrderId || '');
      setForm({
        customerName: initialDraft.customerName || '',
        phoneNumber: initialDraft.phoneNumber || '',
        customerEmail: initialDraft.customerEmail || '',
        governorate: initialDraft.governorate || '',
        shippingAddress: initialDraft.shippingAddress || '',
        deliveryFee: initialDraft.deliveryFee !== null && initialDraft.deliveryFee !== undefined ? String(initialDraft.deliveryFee) : '',
        notes: initialDraft.notes || '',
        items: initialDraft.items && initialDraft.items.length > 0
          ? initialDraft.items.map((item) => ({
                  variantId: item.variantId || '',
                  quantity: item.quantity || 1,
                }))
          : [{ ...EMPTY_LINE }],
      });
    } else {
      setIsConverted(false);
      setConvertedOrderNumber('');
      setForm({
        customerName: '',
        phoneNumber: '',
        customerEmail: '',
        governorate: '',
        shippingAddress: '',
        deliveryFee: '',
        notes: '',
        items: [{ ...EMPTY_LINE }],
      });
    }
  }, [open, draftId, initialDraft]);

  if (!open) return null;

  const updateField = (field, value) => {
    let newValue = value;
    if (field === 'phoneNumber') {
      newValue = value.replace(/\D/g, '').slice(0, 8);
    } else if (field === 'deliveryFee') {
      newValue = value.replace(/\D/g, '').slice(0, 6);
    }
    setForm((prev) => ({ ...prev, [field]: newValue }));
  };

  const buildPayload = () => {
    const validItems = form.items
      .filter((line) => line.variantId)
      .map((line) => ({
        variantId: line.variantId,
        quantity: Math.max(1, parseInt(line.quantity, 10) || 1),
      }));

    const payload = {
      customerName: form.customerName.trim() || undefined,
      phoneNumber: form.phoneNumber.trim() || undefined,
      customerEmail: form.customerEmail.trim() || undefined,
      governorate: form.governorate || undefined,
      shippingAddress: form.shippingAddress.trim() || undefined,
      notes: form.notes.trim() || undefined,
      items: validItems,
    };

    if (form.deliveryFee !== '') {
      payload.deliveryFee = Number(form.deliveryFee);
    }

    return payload;
  };

  const handleSaveDraft = async () => {
    setError('');
    setSuccess('');
    setMissingFields([]);
    setSaving(true);

    const payload = buildPayload();

    try {
      let saved;
      if (currentDraftId) {
        saved = await api.saveDraft(currentDraftId, payload);
        setSuccess('Brouillon mis à jour avec succès.');
      } else {
        saved = await api.createDraft(payload);
        setCurrentDraftId(saved.id);
        setSuccess('Brouillon enregistré avec succès.');
      }
      onSaveSuccess?.(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="admin-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-modal-title"
      >
        <div className="admin-modal-header">
          <h2 id="draft-modal-title">
            {currentDraftId ? 'Modifier le brouillon' : 'Nouveau brouillon'}
          </h2>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>

        {isConverted && (
          <div className="admin-draft-converted-banner">
            <span className="admin-draft-badge complete">Brouillon Confirmé</span>
            <p>
              Ce brouillon a déjà été converti en commande réelle. Il est archivé en lecture seule et ne peut plus être modifié.
            </p>
          </div>
        )}

        <form
          className="admin-form admin-manual-order-form"
          onSubmit={(e) => e.preventDefault()}
          noValidate
        >
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="draftCustomerName">Nom du client</label>
              <input
                id="draftCustomerName"
                value={form.customerName}
                onChange={(e) => updateField('customerName', e.target.value)}
                placeholder="Ex: Ahmed Ben Salem"
                disabled={isConverted}
              />
            </div>
            <div className="form-field">
              <label htmlFor="draftPhoneNumber">Téléphone (8 chiffres)</label>
              <input
                id="draftPhoneNumber"
                type="tel"
                inputMode="numeric"
                maxLength={8}
                value={form.phoneNumber}
                onChange={(e) => updateField('phoneNumber', e.target.value)}
                placeholder="Ex: 98123456"
                disabled={isConverted}
              />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="draftCustomerEmail">Email (optionnel)</label>
            <input
              id="draftCustomerEmail"
              type="email"
              value={form.customerEmail}
              onChange={(e) => updateField('customerEmail', e.target.value)}
              placeholder="client@exemple.com"
              disabled={isConverted}
            />
          </div>

          <div className="form-field">
            <label htmlFor="draftGovernorate">Adresse de livraison</label>
            <select
              id="draftGovernorate"
              className="admin-governorate-select"
              value={form.governorate}
              onChange={(e) => updateField('governorate', e.target.value)}
              disabled={isConverted}
            >
              <option value="">Sélectionner un gouvernorat (optionnel)</option>
              {TUNISIAN_GOVERNORATES.map((gov) => (
                <option key={gov} value={gov}>
                  {gov}
                </option>
              ))}
            </select>
            <textarea
              id="draftShippingAddress"
              value={form.shippingAddress}
              onChange={(e) => updateField('shippingAddress', e.target.value)}
              placeholder="Rue, quartier, code postal, etc."
              rows={2}
              disabled={isConverted}
            />
          </div>



          <div className="form-field">
            <label htmlFor="draftNotes">Notes internes</label>
            <textarea
              id="draftNotes"
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Notes pour le suivi du brouillon..."
              rows={2}
              disabled={isConverted}
            />
            <span className="admin-field-hint">
              Notes internes (visibles uniquement dans le brouillon — non transférées à la commande finale)
            </span>
          </div>

          <p className="form-section-title">Articles du brouillon</p>

          {loadingInventory ? (
            <p className="admin-loading">Chargement des variantes...</p>
          ) : (
            <div className="admin-manual-order-lines">
              <ArticlePicker
                inventory={inventory}
                lines={form.items.filter((line) => line.variantId)}
                onChange={(lines) => setForm((prev) => ({ ...prev, items: lines }))}
                disabled={isConverted}
                stockMode="soft"
              />
            </div>
          )}

          {error && (
            <div className="admin-error" style={{ marginTop: '12px' }}>
              <p><strong>{error}</strong></p>
              {missingFields.length > 0 && (
                <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                  {missingFields.map((field, idx) => (
                    <li key={idx}>{field}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {success && <p className="admin-message" style={{ marginTop: '12px' }}>{success}</p>}

          <div className="form-footer" style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="admin-btn secondary" onClick={onClose}>
              Fermer
            </button>

            {!isConverted && (
              <button
                type="button"
                className="admin-btn primary"
                onClick={handleSaveDraft}
                disabled={saving || loadingInventory}
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
