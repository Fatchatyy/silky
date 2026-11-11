import { useEffect, useState } from 'react';
import { mediaUrl } from '@shared/media';
import { adminApi as api } from '../../admin/adminApi';
import { generateExchangePdf } from '../utils/orderPdf';
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

const EMPTY_LINE = { variantId: '', quantity: 1, action: 'add', isExisting: false, currentQuantity: 0 };

function parseGovAndAddress(fullAddressStr = '') {
  if (!fullAddressStr) return { governorate: '', streetAddress: '' };
  const parts = fullAddressStr.split(' — ');
  if (parts.length >= 2 && TUNISIAN_GOVERNORATES.includes(parts[0].trim())) {
    return {
      governorate: parts[0].trim(),
      streetAddress: parts.slice(1).join(' — ').trim(),
    };
  }
  return { governorate: '', streetAddress: fullAddressStr };
}

export default function AdminExchangeModal({ open, order, paymentResponsibility = 'customer_paid', onClose, onSuccess }) {
  const [inventory, setInventory] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState({
    customerName: '',
    phoneNumber: '',
    customerEmail: '',
    governorate: '',
    shippingAddress: '',
    items: [{ ...EMPTY_LINE }],
  });

  const isSilkyPaid = paymentResponsibility === 'silky_paid';

  useEffect(() => {
    if (!open || !order) return;

    setError('');
    setSuccess('');
    setFieldErrors({});

    // Determine latest state (either latest exchange or original order)
    let latestState = order;
    if (order.exchanges && order.exchanges.length > 0) {
      latestState = order.exchanges[0] || order.exchanges[order.exchanges.length - 1];
    }

    const custName =
      latestState.customer?.name ||
      `${latestState.customer?.firstName || ''} ${latestState.customer?.lastName || ''}`.trim();
    const phone = latestState.customer?.phone || '';
    const email = latestState.customer?.email || '';
    const rawAddress = latestState.customer?.address || '';
    const parsed = parseGovAndAddress(rawAddress);
    const governorate = latestState.customer?.governorate || parsed.governorate;
    const streetAddress = latestState.customer?.shippingAddress || latestState.customer?.streetAddress || parsed.streetAddress;

    const initialItems =
      Array.isArray(latestState.items) && latestState.items.length > 0
        ? latestState.items.map((it) => ({
            variantId: it.variantId || '',
            productTitle: it.name || it.productTitle || '',
            variantLabel: it.details || it.variantLabel || '',
            colorName: it.colorName || '',
            size: it.size || '',
            image: it.image || it.imageUrl || null,
            currentQuantity: Number(it.quantity) || 1,
            action: 'keep',
            quantity: Number(it.quantity) || 1,
            isExisting: true,
          }))
        : [{ ...EMPTY_LINE }];

    setForm({
      customerName: custName,
      phoneNumber: phone,
      customerEmail: email,
      governorate,
      shippingAddress: streetAddress,
      items: initialItems,
    });

    setLoadingInventory(true);
    api
      .getAdminInventory()
      .then(setInventory)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingInventory(false));
  }, [open, order, isSilkyPaid]);

  if (!open || !order) return null;

  const updateField = (field, value) => {
    let newValue = value;
    if (field === 'phoneNumber') {
      newValue = value.replace(/\D/g, '').slice(0, 8);
    }
    setForm((prev) => ({ ...prev, [field]: newValue }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const updateItem = (index, field, value) => {
    setForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, items };
    });
    if (fieldErrors.items) {
      setFieldErrors((prev) => ({ ...prev, items: '' }));
    }
  };

  const updateItemAction = (index, action) => {
    setForm((prev) => {
      const items = [...prev.items];
      const item = items[index];
      items[index] = {
        ...item,
        action,
        quantity: item.isExisting
          ? (action === 'add' ? 1 : item.currentQuantity)
          : (item.quantity || 1),
      };
      return { ...prev, items };
    });
    if (fieldErrors.items) {
      setFieldErrors((prev) => ({ ...prev, items: '' }));
    }
  };

  const removeLine = (index) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : prev.items,
    }));
  };

  const validateForm = () => {
    const errors = {};

    const trimmedName = (form.customerName || '').trim();
    if (!trimmedName) {
      errors.customerName = 'Le nom du client est obligatoire.';
    } else if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(trimmedName)) {
      errors.customerName = 'Le nom du client doit contenir uniquement des lettres.';
    } else if (trimmedName.length < 3) {
      errors.customerName = 'Le nom du client doit contenir au moins 3 lettres.';
    } else if (trimmedName.length > 35) {
      errors.customerName = 'Le nom du client ne doit pas dépasser 35 lettres.';
    }

    const trimmedPhone = (form.phoneNumber || '').trim();
    if (!trimmedPhone) {
      errors.phoneNumber = 'Le numéro de téléphone est obligatoire.';
    } else if (!/^\d{8}$/.test(trimmedPhone)) {
      errors.phoneNumber = 'Le numéro de téléphone doit contenir exactement 8 chiffres.';
    }

    const trimmedEmail = (form.customerEmail || '').trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.customerEmail = 'Veuillez entrer une adresse e-mail valide.';
    }

    if (!form.governorate) {
      errors.governorate = 'Veuillez sélectionner un gouvernorat.';
    }

    const trimmedAddress = (form.shippingAddress || '').trim();
    if (!trimmedAddress) {
      errors.shippingAddress = "L'adresse de livraison est obligatoire.";
    }

    const validItems = form.items.filter((line) => line.variantId);
    if (!validItems.length) {
      errors.items = 'Ajoutez au moins un article.';
    } else {
      const seenVariantIds = new Set();
      let hasDuplicate = false;
      for (const l of validItems) {
        if (seenVariantIds.has(l.variantId)) {
          hasDuplicate = true;
          break;
        }
        seenVariantIds.add(l.variantId);
      }

      if (hasDuplicate) {
        errors.items = 'Chaque variante ne peut apparaître qu\'une seule fois.';
      } else {
        // Check for keep-only unchanged
        const isKeepOnlyUnchanged =
          validItems.every(
            (l) => l.isExisting && l.action === 'keep' && Number(l.quantity) === Number(l.currentQuantity)
          ) &&
          validItems.length === form.items.filter((l) => l.isExisting).length &&
          !form.items.some((l) => !l.isExisting && l.variantId);

        if (isKeepOnlyUnchanged) {
          errors.items = 'Aucune modification détectée. Veuillez sélectionner une action (Échanger, Retourner) ou ajouter un article.';
        }

        // Check for zero resulting active items
        let totalActive = 0;
        for (const l of validItems) {
          const q = Number(l.quantity) || 0;
          const cur = Number(l.currentQuantity) || 0;
          if (!l.isExisting) {
            totalActive += q;
          } else if (l.action === 'keep') {
            totalActive += Math.min(q, cur);
          } else if (l.action === 'replace') {
            totalActive += cur;
          } else if (l.action === 'return') {
            totalActive += Math.max(0, cur - q);
          } else if (l.action === 'add') {
            totalActive += cur + q;
          }
        }

        if (totalActive <= 0) {
          errors.items = 'Un échange doit contenir au moins un article actif. Pour un retour complet, veuillez utiliser le Remboursement.';
        }
      }
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    setFieldErrors({});

    const items = form.items
      .filter((line) => line.variantId)
      .map((line) => ({
        variantId: line.variantId,
        action: line.action || (line.isExisting ? 'keep' : 'add'),
        quantity: Math.max(1, parseInt(line.quantity, 10) || 1),
      }));

    const fullShippingAddress = `${form.governorate} — ${form.shippingAddress.trim()}`;

    const customerData = {
      customerName: form.customerName.trim(),
      phoneNumber: form.phoneNumber.trim(),
      shippingAddress: fullShippingAddress,
    };
    if (form.customerEmail.trim()) customerData.customerEmail = form.customerEmail.trim();

    const payload = {
      customer: customerData,
      items,
      paymentResponsibility: isSilkyPaid ? 'silky_paid' : 'customer_paid',
    };

    try {
      // 1. Explicit exchange creation/confirmation FIRST in DB
      const updatedOrder = await api.createExchange(order.id, payload);

      const latestExchange =
        updatedOrder.exchanges && updatedOrder.exchanges.length > 0
          ? updatedOrder.exchanges[0]
          : null;

      // 2. Generate and download PDF (side-effect free)
      try {
        if (latestExchange) {
          generateExchangePdf({
            ...latestExchange,
            orderNumber: order.orderNumber,
          });
        }
      } catch (pdfErr) {
        console.error('PDF generation error:', pdfErr);
      }

      const exchangeNum = latestExchange?.exchangeNumber || 'enregistré';
      const exchangeTotal = latestExchange ? formatPrice(latestExchange.total) : '';

      // The exchange is saved either way; tell the admin when its GOODEX parcel was not created.
      const parcel = latestExchange?.delivery;
      const parcelOk = parcel?.state === 'created';
      setSuccess(`Échange ${exchangeNum} finalisé avec succès — Total: ${exchangeTotal}`);
      if (!parcelOk) {
        setError(
          `Le colis GOODEX de l'échange n'a pas été créé${parcel?.lastError ? ` (${parcel.lastError})` : ''}. Ouvrez la commande pour réessayer.`,
        );
      }
      onSuccess?.(updatedOrder);

      setTimeout(() => {
        onClose();
      }, parcelOk ? 1500 : 5000);
    } catch (err) {
      setError(err.message || 'Erreur lors de la création de l\'échange');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="admin-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exchange-order-title"
      >
        <div className="admin-modal-header">
          <h2 id="exchange-order-title">
            {isSilkyPaid ? 'Créer un Échange payé (Pris en charge par Silky)' : 'Créer un Échange'} — {order.orderNumber}
          </h2>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>

        <form className="admin-form admin-manual-order-form" onSubmit={handleSubmit} noValidate>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="exch-customerName">Nom du client *</label>
              <input
                id="exch-customerName"
                value={form.customerName}
                onChange={(e) => updateField('customerName', e.target.value)}
                className={fieldErrors.customerName ? 'input-error' : ''}
              />
              {fieldErrors.customerName && (
                <span className="field-error-msg">{fieldErrors.customerName}</span>
              )}
            </div>
            <div className="form-field">
              <label htmlFor="exch-phoneNumber">Téléphone (8 chiffres) *</label>
              <input
                id="exch-phoneNumber"
                type="tel"
                inputMode="numeric"
                maxLength={8}
                value={form.phoneNumber}
                onChange={(e) => updateField('phoneNumber', e.target.value)}
                className={fieldErrors.phoneNumber ? 'input-error' : ''}
              />
              {fieldErrors.phoneNumber && (
                <span className="field-error-msg">{fieldErrors.phoneNumber}</span>
              )}
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="exch-customerEmail">Email (optionnel)</label>
            <input
              id="exch-customerEmail"
              type="email"
              value={form.customerEmail}
              onChange={(e) => updateField('customerEmail', e.target.value)}
              className={fieldErrors.customerEmail ? 'input-error' : ''}
            />
            {fieldErrors.customerEmail && (
              <span className="field-error-msg">{fieldErrors.customerEmail}</span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="exch-shippingAddress">Adresse de livraison *</label>
            <select
              id="exch-governorate"
              className={`admin-governorate-select ${fieldErrors.governorate ? 'input-error' : ''}`}
              value={form.governorate}
              onChange={(e) => updateField('governorate', e.target.value)}
            >
              <option value="">Sélectionner un gouvernorat *</option>
              {TUNISIAN_GOVERNORATES.map((gov) => (
                <option key={gov} value={gov}>
                  {gov}
                </option>
              ))}
            </select>
            {fieldErrors.governorate && (
              <span className="field-error-msg">{fieldErrors.governorate}</span>
            )}
            <textarea
              id="exch-shippingAddress"
              value={form.shippingAddress}
              onChange={(e) => updateField('shippingAddress', e.target.value)}
              placeholder="Rue, quartier, code postal, etc."
              rows={2}
              className={fieldErrors.shippingAddress ? 'input-error' : ''}
            />
            {fieldErrors.shippingAddress && (
              <span className="field-error-msg">{fieldErrors.shippingAddress}</span>
            )}
          </div>

          <p className="form-section-title">Articles de l'Échange</p>

          {loadingInventory ? (
            <p className="admin-loading">Chargement des variantes...</p>
          ) : (
            <div className="admin-manual-order-lines">
              {form.items.map((line, index) => {
                const invItem = inventory.find((it) => it.variantId === line.variantId);
                const title = line.productTitle || invItem?.productTitle || 'Article';
                const details = line.variantLabel || (invItem ? `${invItem.colorName} — Taille ${invItem.size}` : '');
                const img = line.image || invItem?.colorImageUrl || null;

                if (line.isExisting) {
                  return (
                    <div key={index} className="admin-exchange-line admin-exchange-line-existing">
                      <div className="admin-exchange-item-meta">
                        {img ? (
                          <img src={mediaUrl(img)} alt="" className="admin-variant-thumb" />
                        ) : (
                          <div className="admin-variant-thumb-placeholder" />
                        )}
                        <div className="admin-exchange-item-text">
                          <span className="admin-exchange-item-title">
                            <strong>{title}</strong>
                          </span>
                          <span className="admin-exchange-item-sub">
                            {details}
                          </span>
                        </div>
                        <span className="admin-exchange-current-badge">
                          Actuel : <strong>{line.currentQuantity}</strong>
                        </span>
                      </div>

                      <div className="admin-exchange-controls">
                        <select
                          className="admin-exchange-action-select"
                          value={line.action || 'keep'}
                          onChange={(e) => updateItemAction(index, e.target.value)}
                          aria-label={`Action article ${index + 1}`}
                        >
                          <option value="keep">Garder</option>
                          <option value="replace">Échanger</option>
                          <option value="return">Retourner</option>
                          <option value="add">Ajouter</option>
                        </select>

                        <div className="admin-exchange-qty-box">
                          <span className="admin-exchange-qty-label">
                            {line.action === 'add' ? 'À ajouter :' : 'Qté :'}
                          </span>
                          {line.action === 'add' ? (
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={line.quantity}
                              onChange={(e) => {
                                const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                                updateItem(index, 'quantity', val);
                              }}
                              aria-label={`Quantité à ajouter article ${index + 1}`}
                            />
                          ) : (
                            <input
                              type="number"
                              min="1"
                              max={line.currentQuantity}
                              step="1"
                              value={line.quantity}
                              onChange={(e) => {
                                const maxVal = line.currentQuantity || 1;
                                const val = Math.min(maxVal, Math.max(1, parseInt(e.target.value, 10) || 1));
                                updateItem(index, 'quantity', val);
                              }}
                              aria-label={`Quantité article ${index + 1}`}
                            />
                          )}
                        </div>

                        {form.items.length > 1 && (
                          <button
                            type="button"
                            className="admin-btn danger"
                            onClick={() => removeLine(index)}
                            title="Retirer cet article"
                          >
                            Retirer
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                return null;
              })}

              <ArticlePicker
                inventory={inventory}
                lines={form.items.filter((line) => !line.isExisting && line.variantId)}
                buttonLabel="+ Ajouter des articles à l'échange"
                onChange={(newLines) =>
                  setForm((prev) => {
                    const existing = prev.items.filter((l) => l.isExisting);
                    const added = newLines.map((l) => {
                      const prevLine = prev.items.find((p) => !p.isExisting && p.variantId === l.variantId);
                      return { ...EMPTY_LINE, ...prevLine, variantId: l.variantId, quantity: l.quantity };
                    });
                    const items = [...existing, ...added];
                    return { ...prev, items: items.length ? items : [{ ...EMPTY_LINE }] };
                  })
                }
              />

              {fieldErrors.items && (
                <span className="field-error-msg" style={{ marginBottom: '8px' }}>
                  {fieldErrors.items}
                </span>
              )}
            </div>
          )}

          {error && (
            <p className="admin-error" ref={(el) => el?.scrollIntoView({ block: 'nearest' })}>
              {error}
            </p>
          )}
          {success && <p className="admin-message">{success}</p>}

          <div className="form-footer">
            <button type="button" className="admin-btn secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="admin-btn" disabled={submitting || loadingInventory}>
              <img src="/pictures/confirm.png" alt="" className="admin-btn-icon" style={{ filter: 'none' }} />
              <span>{submitting ? 'Traitement...' : 'Confirmer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

