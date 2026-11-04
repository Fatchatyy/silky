import { Fragment, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { formatPrice } from '../../../shared/formatPrice';
import AdminDraftModal from './AdminDraftModal';

function isDraftReady(draft) {
  const hasName = Boolean(draft.customerName?.trim() && draft.customerName.trim().length >= 3);
  const hasPhone = Boolean(draft.phoneNumber?.trim() && /^\d{8}$/.test(draft.phoneNumber.trim()));
  const hasGov = Boolean(draft.governorate?.trim());
  const hasAddress = Boolean(draft.shippingAddress?.trim());
  const hasItems = Array.isArray(draft.items) && draft.items.some((i) => i && i.variantId);

  return hasName && hasPhone && hasGov && hasAddress && hasItems;
}

function isConverted(draft) {
  return Boolean(draft.convertedAt || draft.convertedOrderId);
}

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function getPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = [];
  pages.push(1);
  if (currentPage > 3) {
    pages.push('...');
  }
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  if (currentPage < totalPages - 2) {
    pages.push('...');
  }
  pages.push(totalPages);
  return pages;
}

export default function AdminDrafts({ onOrderCreated }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selectedDraftId, setSelectedDraftId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  const [expandedDraftIds, setExpandedDraftIds] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);

  const fetchDrafts = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError('');
    try {
      const data = await api.getDrafts();
      setDrafts(data);
    } catch (err) {
      setError(err.message);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts(true);
  }, []);

  const handleOpenNew = () => {
    setSelectedDraftId(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (draftId) => {
    setSelectedDraftId(draftId);
    setModalOpen(true);
  };

  const handleSaveSuccess = () => {
    fetchDrafts();
  };

  const handleConfirmSuccess = (order) => {
    fetchDrafts();
    onOrderCreated?.(order);
  };

  const toggleExpand = (draftId) => {
    setExpandedDraftIds((prev) =>
      prev.includes(draftId) ? prev.filter((id) => id !== draftId) : [...prev, draftId]
    );
  };

  const toggleDateSort = () => {
    setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
  };

  const toggleSelectDraft = (id) => {
    setSelectedDraftIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleConfirmSingle = async (draftId) => {
    setError('');
    setConfirmingId(draftId);
    try {
      const order = await api.confirmDraft(draftId);
      setSelectedDraftIds((prev) => prev.filter((id) => id !== draftId));
      await fetchDrafts();
      onOrderCreated?.(order);
    } catch (err) {
      setError(err.message || 'Erreur lors de la confirmation du brouillon');
    } finally {
      setConfirmingId(null);
    }
  };

  const handleBulkConfirm = async () => {
    if (!canConfirm || bulkConfirming) return;
    setBulkConfirming(true);
    setError('');
    try {
      for (const draftId of selectedDraftIds) {
        await api.confirmDraft(draftId);
      }
      setSelectedDraftIds([]);
      await fetchDrafts();
      onOrderCreated?.();
    } catch (err) {
      setError(err.message || 'Erreur lors de la confirmation groupée des brouillons');
      await fetchDrafts();
    } finally {
      setBulkConfirming(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteDraft(deleteTarget.id);
      setSelectedDraftIds((prev) => prev.filter((id) => id !== deleteTarget.id));
      setDrafts((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(`Erreur lors de la suppression : ${err.message}`);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  // 1. Filtering pipeline
  const filteredDrafts = drafts.filter((d) => {
    // Search query
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const nameMatch = d.customerName?.toLowerCase().includes(q);
      const phoneMatch = d.phoneNumber?.toLowerCase().includes(q);
      const addressMatch = d.shippingAddress?.toLowerCase().includes(q);
      const govMatch = d.governorate?.toLowerCase().includes(q);
      const idMatch = d.id?.toLowerCase().includes(q);
      const notesMatch = d.notes?.toLowerCase().includes(q);
      if (!(nameMatch || phoneMatch || addressMatch || govMatch || idMatch || notesMatch)) {
        return false;
      }
    }

    // Status filter
    if (statusFilter !== 'all') {
      const draftConverted = isConverted(d);
      const ready = isDraftReady(d);
      if (statusFilter === 'converted' && !draftConverted) return false;
      if (statusFilter === 'ready' && (draftConverted || !ready)) return false;
      if (statusFilter === 'incomplete' && (draftConverted || ready)) return false;
    }

    return true;
  });

  // 2. Sorting pipeline
  const sortedDrafts = [...filteredDrafts].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
  });

  // 3. Pagination calculations
  const totalDrafts = sortedDrafts.length;
  const totalPages = Math.max(1, Math.ceil(totalDrafts / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalDrafts);
  const paginatedDrafts = sortedDrafts.slice(startIndex, endIndex);

  // 4. Page-scoped selection state
  // Only unconverted drafts can be selected for bulk actions
  const selectablePageDraftIds = paginatedDrafts.filter((d) => !isConverted(d)).map((d) => d.id);
  const isAllPageSelected =
    selectablePageDraftIds.length > 0 &&
    selectablePageDraftIds.every((id) => selectedDraftIds.includes(id));
  const isSomePageSelected =
    selectablePageDraftIds.some((id) => selectedDraftIds.includes(id)) && !isAllPageSelected;

  const toggleSelectPage = () => {
    if (isAllPageSelected) {
      setSelectedDraftIds((prev) => prev.filter((id) => !selectablePageDraftIds.includes(id)));
    } else {
      setSelectedDraftIds((prev) => Array.from(new Set([...prev, ...selectablePageDraftIds])));
    }
  };

  // 5. Global selection evaluation & Bulk Confirm enablement rule
  // Strictly enabled ONLY when:
  // - selectedDraftIds.length > 0
  // - EVERY selected draft has status "Prêt à confirmer" (isDraftReady === true && !isConverted)
  const selectedDrafts = drafts.filter((d) => selectedDraftIds.includes(d.id));
  const hasSelectedDrafts = selectedDrafts.length > 0;
  const canConfirm =
    hasSelectedDrafts &&
    selectedDrafts.every((d) => !isConverted(d) && isDraftReady(d));

  return (
    <section className="admin-panel admin-drafts-panel admin-orders-panel">
      {/* Top Header Bar */}
      <div className="admin-panel-header admin-orders-header">
        <div className="admin-panel-title-area">
          <h2>Brouillons</h2>
          {selectablePageDraftIds.length > 0 && (
            <label className="admin-toolbar-select">
              <input
                type="checkbox"
                checked={isAllPageSelected}
                ref={(input) => {
                  if (input) {
                    input.indeterminate = isSomePageSelected;
                  }
                }}
                onChange={toggleSelectPage}
                aria-label="Tout sélectionner sur la page"
              />
              <span>Tout sélectionner</span>
            </label>
          )}
          {filteredDrafts.length > 0 && (
            <span className="admin-draft-count-badge">
              {filteredDrafts.length} brouillon{filteredDrafts.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="admin-panel-actions">
          <button
            type="button"
            className="admin-download-btn"
            disabled={!canConfirm || bulkConfirming}
            onClick={handleBulkConfirm}
            title={
              !hasSelectedDrafts
                ? 'Sélectionnez des brouillons prêts à confirmer'
                : !canConfirm
                  ? 'Tous les brouillons sélectionnés doivent être prêts à confirmer'
                  : `Confirmer ${selectedDrafts.length} commande(s)`
            }
          >
            <img
              src="/pictures/push.png"
              alt=""
              className="admin-btn-icon"
              style={{ filter: 'none' }}
            />
            <span>
              {bulkConfirming
                ? 'Confirmation...'
                : `Passer commande${hasSelectedDrafts ? ` (${selectedDrafts.length})` : ''}`}
            </span>
          </button>

          <button
            type="button"
            className="admin-primary-btn"
            onClick={handleOpenNew}
          >
            <img src="/pictures/addorder.png" alt="" className="admin-btn-icon" />
            <span>Créer un brouillon</span>
          </button>

          <button
            type="button"
            className="admin-secondary-btn"
            onClick={() => fetchDrafts()}
            disabled={loading}
          >
            Actualiser
          </button>
        </div>
      </div>

      {/* Search Bar + Status Filter */}
      <div className="admin-orders-controls-bar">
        <div className="admin-orders-search-wrapper">
          <input
            type="text"
            className="admin-orders-search-input"
            placeholder="Rechercher par identifiant, nom client, téléphone, adresse, notes..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
          />
          {search && (
            <button
              type="button"
              className="admin-search-clear-btn"
              onClick={() => {
                setSearch('');
                setCurrentPage(1);
              }}
              title="Effacer la recherche"
              aria-label="Effacer la recherche"
            >
              ×
            </button>
          )}
        </div>

        <div className="admin-orders-filter-wrapper">
          <select
            className="admin-orders-status-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Filtrer par statut"
          >
            <option value="all">Tous les statuts</option>
            <option value="ready">Prêt à confirmer</option>
            <option value="incomplete">Incomplet</option>
            <option value="converted">Converti</option>
          </select>
        </div>
      </div>

      {error && <p className="admin-error" style={{ marginBottom: '16px' }}>{error}</p>}

      {loading ? (
        <p className="admin-loading">Chargement des brouillons...</p>
      ) : drafts.length === 0 ? (
        <div className="admin-empty" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <img
            src="/pictures/draft.png"
            alt=""
            style={{ width: '48px', height: '48px', opacity: 0.35, marginBottom: '12px', filter: 'grayscale(1)' }}
          />
          <p style={{ fontSize: '1rem', color: '#64748b', margin: '0 0 16px' }}>
            Aucun brouillon enregistré pour le moment.
          </p>

        </div>
      ) : filteredDrafts.length === 0 ? (
        <p className="admin-empty">
          {search
            ? `Aucun brouillon ne correspond à votre recherche "${search}".`
            : 'Aucun brouillon ne correspond au filtre sélectionné.'}
        </p>
      ) : (
        <>
          {/* Main Drafts Table */}
          <div className="admin-orders-table-wrap">
            <table className="admin-orders-table">
              <thead>
                <tr>
                  <th className="admin-table-th col-select">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      ref={(input) => {
                        if (input) {
                          input.indeterminate = isSomePageSelected;
                        }
                      }}
                      onChange={toggleSelectPage}
                      aria-label="Sélectionner tous les brouillons de la page"
                    />
                  </th>
                  <th
                    className="admin-table-th col-date sortable"
                    onClick={toggleDateSort}
                    title="Inverser le tri par date"
                  >
                    <div className="admin-th-content">
                      <img src="/pictures/timeanddate.png" alt="" className="admin-th-icon" />
                      <span>Date et Heure</span>
                      <span className="admin-sort-indicator">{sortDirection === 'desc' ? '▼' : '▲'}</span>
                    </div>
                  </th>
                  <th className="admin-table-th col-id">
                    <div className="admin-th-content">
                      <img src="/pictures/orderid.png" alt="" className="admin-th-icon" />
                      <span>ID du brouillon</span>
                    </div>
                  </th>
                  <th className="admin-table-th col-client">
                    <div className="admin-th-content">
                      <img src="/pictures/clientname.png" alt="" className="admin-th-icon" />
                      <span>Nom Client</span>
                    </div>
                  </th>
                  <th className="admin-table-th col-phone">
                    <div className="admin-th-content">
                      <img src="/pictures/phonenumber.png" alt="" className="admin-th-icon" />
                      <span>Téléphone</span>
                    </div>
                  </th>
                  <th className="admin-table-th col-status">
                    <div className="admin-th-content">
                      <img src="/pictures/statusflag.png" alt="" className="admin-th-icon" />
                      <span>Status</span>
                    </div>
                  </th>
                  <th className="admin-table-th col-price">
                    <div className="admin-th-content">
                      <img src="/pictures/money.png" alt="" className="admin-th-icon" />
                      <span>Prix</span>
                    </div>
                  </th>
                  <th className="admin-table-th col-actions">
                    <div className="admin-th-content admin-th-actions">
                      <img src="/pictures/actions.png" alt="" className="admin-th-icon" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedDrafts.map((draft) => {
                  const draftConverted = isConverted(draft);
                  const ready = isDraftReady(draft);
                  const isSelected = selectedDraftIds.includes(draft.id);
                  const isExpanded = expandedDraftIds.includes(draft.id);
                  const payableAmount = draft.customerAmountToPay !== undefined ? draft.customerAmountToPay : draft.total;

                  return (
                    <Fragment key={draft.id}>
                      <tr
                        id={`draft-${draft.id}`}
                        className={`admin-order-row ${draftConverted ? 'is-converted' : ''}`}
                      >
                        {/* Column 0: Checkbox */}
                        <td className="admin-table-td col-select">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={draftConverted}
                            onChange={() => toggleSelectDraft(draft.id)}
                            aria-label={`Sélectionner brouillon BR-${draft.id.slice(0, 8).toUpperCase()}`}
                          />
                        </td>

                        {/* Column 1: Date et Heure */}
                        <td className="admin-table-td col-date">
                          <span className="admin-table-cell-date">
                            {formatDate(draft.createdAt || draft.updatedAt)}
                          </span>
                        </td>

                        {/* Column 2: ID du brouillon */}
                        <td className="admin-table-td col-id">
                          <strong className="admin-table-cell-id">
                            BR-{draft.id.slice(0, 8).toUpperCase()}
                          </strong>
                        </td>

                        {/* Column 3: Nom Client */}
                        <td className="admin-table-td col-client">
                          <span className="admin-table-cell-client">
                            {draft.customerName || (
                              <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                                Client non renseigné
                              </span>
                            )}
                          </span>
                        </td>

                        {/* Column 4: Téléphone */}
                        <td className="admin-table-td col-phone">
                          <span className="admin-table-cell-phone">
                            {draft.phoneNumber || '—'}
                          </span>
                        </td>

                        {/* Column 5: Status */}
                        <td className="admin-table-td col-status">
                          {draftConverted ? (
                            <span className="admin-status-badge confirmed">Converti</span>
                          ) : ready ? (
                            <span className="admin-status-badge confirmed">Prêt à confirmer</span>
                          ) : (
                            <span className="admin-status-badge unconfirmed">Incomplet</span>
                          )}
                        </td>

                        {/* Column 6: Prix (Montant à payer) */}
                        <td className="admin-table-td col-price">
                          <strong className="admin-table-cell-price">
                            {payableAmount !== null && payableAmount !== undefined
                              ? formatPrice(payableAmount)
                              : '—'}
                          </strong>
                        </td>

                        {/* Column 7: Actions */}
                        <td className="admin-table-td col-actions">
                          <div className="admin-table-actions-cell">
                            <button
                              type="button"
                              className="admin-icon-action-btn admin-btn-details"
                              onClick={() => toggleExpand(draft.id)}
                              aria-label={isExpanded ? 'Masquer' : 'Détails'}
                              title="Détails"
                            >
                              <img alt="" className="admin-btn-icon" src="/pictures/history.png" />
                              <span className="admin-tooltip">Détails</span>
                            </button>

                            {!draftConverted && (
                              <>
                                <button
                                  type="button"
                                  className="admin-secondary-btn sm"
                                  onClick={() => handleOpenEdit(draft.id)}
                                  title="Ouvrir le brouillon"
                                  style={{ padding: '4px 10px', height: '32px', display: 'inline-flex', alignItems: 'center' }}
                                >
                                  Ouvrir
                                </button>

                                {ready && (
                                  <button
                                    type="button"
                                    className="admin-icon-action-btn admin-btn-confirm"
                                    onClick={() => handleConfirmSingle(draft.id)}
                                    aria-label="Confirmer commande"
                                    title="Confirmer commande"
                                    disabled={confirmingId === draft.id}
                                    style={{ background: '#eff6ff', borderColor: '#93c5fd' }}
                                  >
                                    <img
                                      alt=""
                                      className="admin-btn-icon"
                                      src="/pictures/push.png"
                                      style={{ filter: 'none' }}
                                    />
                                    <span className="admin-tooltip">Confirmer</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="admin-icon-action-btn admin-btn-cancel"
                                  onClick={() => setDeleteTarget(draft)}
                                  aria-label="Supprimer le brouillon"
                                  title="Supprimer"
                                >
                                  <img alt="" className="admin-btn-icon" src="/pictures/cancel.png" />
                                  <span className="admin-tooltip">Supprimer</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Row Rendering directly below its draft */}
                      {isExpanded && (
                        <tr className="admin-order-expanded-row">
                          <td colSpan={8} className="admin-order-expanded-cell">
                            <div className="admin-order-details">
                              {draftConverted && (
                                <div className="admin-draft-converted-banner" style={{ marginBottom: '14px' }}>
                                  <span className="admin-draft-badge complete">Brouillon Confirmé</span>
                                  <p>
                                    Ce brouillon a déjà été converti en commande réelle
                                    {draft.convertedOrderNumber ? ` (${draft.convertedOrderNumber})` : ''}.
                                    Il est archivé en lecture seule et ne peut plus être modifié.
                                  </p>
                                </div>
                              )}

                              <div className="admin-expanded-header-info">
                                <p>
                                  <strong>Client:</strong> {draft.customerName || 'Non renseigné'}
                                </p>
                                <p>
                                  <strong>Email:</strong> {draft.customerEmail || 'Non renseigné'}
                                </p>
                                <p>
                                  <strong>Téléphone:</strong> {draft.phoneNumber || 'Non renseigné'}
                                </p>
                                <p>
                                  <strong>Adresse:</strong>{' '}
                                  {draft.governorate
                                    ? `${draft.governorate}${draft.shippingAddress ? ` — ${draft.shippingAddress}` : ''}`
                                    : draft.shippingAddress || 'Non renseignée'}
                                </p>
                                {draft.notes && (
                                  <p style={{ gridColumn: '1 / -1' }}>
                                    <strong>Notes internes:</strong> 📝 {draft.notes}
                                  </p>
                                )}
                              </div>

                              <div className="admin-expanded-items-section">
                                <strong>Articles du brouillon :</strong>
                                {draft.items && draft.items.length > 0 ? (
                                  <ul className="admin-order-items-list">
                                    {draft.items.map((item, i) => (
                                      <li key={item.id || i}>
                                        <strong>{item.productTitle || item.name || 'Article'}</strong>
                                        {item.variantLabel ? ` (${item.variantLabel})` : ''} × {item.quantity}
                                        {item.unitPrice !== null && item.unitPrice !== undefined
                                          ? ` — ${formatPrice(item.unitPrice * item.quantity)}`
                                          : ''}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p style={{ color: '#94a3b8', fontStyle: 'italic', margin: '6px 0 0' }}>
                                    Aucun article ajouté.
                                  </p>
                                )}
                              </div>

                              <div className="admin-expanded-financials">
                                <p>
                                  <strong>Frais de livraison:</strong>{' '}
                                  {draft.deliveryFee !== null && draft.deliveryFee !== undefined
                                    ? formatPrice(draft.deliveryFee)
                                    : 'Standard (selon commande)'}
                                </p>
                                <p>
                                  <strong>Montant à payer:</strong>{' '}
                                  {payableAmount !== null && payableAmount !== undefined
                                    ? formatPrice(payableAmount)
                                    : '—'}
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Bar */}
          <div className="admin-orders-pagination-bar">
            <div className="admin-pagination-summary">
              Showing {totalDrafts === 0 ? 0 : startIndex + 1}–{endIndex} of {totalDrafts} brouillons
            </div>

            <div className="admin-pagination-right">
              <div className="admin-pagination-page-size">
                <select
                  id="admin-drafts-page-size-select"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="admin-page-size-select"
                  aria-label="Sélectionner le nombre de brouillons par page"
                >
                  <option value={20}>20 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                </select>
              </div>

              <div className="admin-pagination-nav">
                <button
                  type="button"
                  className="admin-pagination-btn"
                  disabled={activePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  aria-label="Page précédente"
                >
                  Previous
                </button>

                {getPageNumbers(activePage, totalPages).map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="admin-pagination-ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      className={`admin-pagination-btn ${p === activePage ? 'active' : ''}`}
                      onClick={() => setCurrentPage(p)}
                      aria-label={`Page ${p}`}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  type="button"
                  className="admin-pagination-btn"
                  disabled={activePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Page suivante"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Edit/Create Draft Modal */}
      <AdminDraftModal
        open={modalOpen}
        draftId={selectedDraftId}
        onClose={() => setModalOpen(false)}
        onSaveSuccess={handleSaveSuccess}
        onConfirmSuccess={handleConfirmSuccess}
      />

      {/* Delete Confirmation In-App Overlay (matching Product delete modal) */}
      {deleteTarget && (
        <div
          className="admin-modal-overlay"
          onClick={() => !deleting && setDeleteTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-draft-title"
        >
          <div
            className="admin-modal"
            style={{ maxWidth: '420px', padding: '24px', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="delete-draft-title"
              style={{ margin: '0 0 16px', fontSize: '1.2rem', color: '#111' }}
            >
              Supprimer ce brouillon ?
            </h3>
            <p style={{ margin: '0 0 24px', color: '#666', fontSize: '0.9rem' }}>
              Cette action est irréversible. Le brouillon &laquo; BR-{deleteTarget.id.slice(0, 8).toUpperCase()} &raquo; sera définitivement supprimé.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                className="admin-btn secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Annuler
              </button>
              <button
                type="button"
                className="admin-btn danger"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Suppression...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
