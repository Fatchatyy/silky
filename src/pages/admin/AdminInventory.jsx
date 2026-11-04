import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useProducts } from '../../context/ProductsContext';

const LOW_STOCK_THRESHOLD = 5;

/** Shows `text` with every case-insensitive match of `term` wrapped in <mark>. Plain text only: nothing is parsed as HTML. */
function HighlightedText({ text, term }) {
  if (text === undefined || text === null) return null;
  const value = String(text);
  if (!term) return value;
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = value.split(new RegExp(`(${escapedTerm})`, 'gi'));
  // With one capture group, split() puts the matches at the odd positions.
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

function getPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = [1];
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

export default function AdminInventory({ refreshKey = 0 }) {
  const { refreshProducts } = useProducts();
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const loadInventory = useCallback((isInitial = false) => {
    if (isInitial) setLoading(true);
    setError('');
    api
      .getAdminInventory()
      .then(setInventory)
      .catch((err) => setError(err.message))
      .finally(() => {
        if (isInitial) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadInventory(!inventory.length);
  }, [loadInventory, refreshKey]);

  const handleEditChange = (variantId, value) => {
    const parsed = parseInt(value, 10);
    setEditing((prev) => ({
      ...prev,
      [variantId]: Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
    }));
  };

  const handleSave = async (variantId) => {
    const stockQuantity = editing[variantId];
    if (stockQuantity === undefined) return;

    setSaving(variantId);
    setMessage('');
    setError('');

    try {
      const updated = await api.updateAdminInventory(variantId, stockQuantity);
      setInventory((items) =>
        items.map((item) => (item.variantId === variantId ? updated : item)),
      );
      setEditing((prev) => {
        const next = { ...prev };
        delete next[variantId];
        return next;
      });
      setMessage('Stock mis à jour avec succès.');
      await refreshProducts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  // Live filter — matches name, color, or size
  const trimmed = searchQuery.trim().toLowerCase();
  const filtered = trimmed
    ? inventory.filter(
        (item) =>
          item.productTitle?.toLowerCase().includes(trimmed) ||
          item.colorName?.toLowerCase().includes(trimmed) ||
          item.size?.toLowerCase().includes(trimmed),
      )
    : inventory;

  const totalVariants = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalVariants / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalVariants);
  const paginated = filtered.slice(startIndex, endIndex);

  const lowStockCount = inventory.filter((item) => item.stockQuantity <= LOW_STOCK_THRESHOLD).length;

  if (loading) return <p className="admin-loading">Chargement de l&apos;inventaire...</p>;

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <h2>Inventaire</h2>
          <p>
            {filtered.length} variante{filtered.length !== 1 ? 's' : ''}
            {trimmed && inventory.length !== filtered.length && (
              <span style={{ color: '#999' }}> sur {inventory.length}</span>
            )}
            {lowStockCount > 0 && (
              <span className="admin-inventory-alert">
                {' '}
                — {lowStockCount} en stock faible (≤ {LOW_STOCK_THRESHOLD})
              </span>
            )}
          </p>
        </div>
        <button type="button" className="admin-secondary-btn" onClick={loadInventory}>
          Actualiser
        </button>
      </div>

      {/* Live search bar */}
      <div className="admin-inventory-search-wrap">
        <div className="admin-inventory-search-inner">
          <input
            id="inventory-search"
            type="text"
            className="admin-inventory-search"
            placeholder="Rechercher par produit, couleur ou taille…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            autoComplete="off"
            aria-label="Rechercher dans l'inventaire"
          />
          {searchQuery && (
            <button
              type="button"
              className="admin-inventory-search-clear"
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              aria-label="Effacer la recherche"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {message && <p className="admin-message">{message}</p>}
      {error && <p className="admin-error">{error}</p>}

      {inventory.length === 0 ? (
        <p className="admin-empty">Aucune variante en stock.</p>
      ) : filtered.length === 0 ? (
        <div className="admin-inventory-no-results">
          <span>🔍</span>
          <p>Aucun résultat pour «&nbsp;<strong>{searchQuery}</strong>&nbsp;»</p>
          <button
            type="button"
            className="admin-secondary-btn"
            onClick={() => {
              setSearchQuery('');
              setCurrentPage(1);
            }}
          >
            Réinitialiser
          </button>
        </div>
      ) : (
        <>
        <div className="admin-orders-table-wrap">
          <table className="admin-orders-table admin-inventory-table">
            <thead>
              <tr>
                <th className="admin-table-th">Produit</th>
                <th className="admin-table-th">Couleur</th>
                <th className="admin-table-th">Taille</th>
                <th className="admin-table-th">SKU</th>
                <th className="admin-table-th">Stock</th>
                <th className="admin-table-th">Statut</th>
                <th className="admin-table-th col-actions">
                  <div className="admin-th-content admin-th-actions">Action</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((item) => {
                const isLowStock = item.stockQuantity <= LOW_STOCK_THRESHOLD;
                const isEditing = editing[item.variantId] !== undefined;
                const displayQty = isEditing ? editing[item.variantId] : item.stockQuantity;

                return (
                  <tr
                    key={item.variantId}
                    className="admin-order-row"
                  >
                    <td data-label="Produit" className="admin-table-td col-client">
                      <span className="admin-inventory-cell-highlight">
                        <HighlightedText text={item.productTitle} term={trimmed} />
                      </span>
                      {item.productIsHidden && (
                        <span className="admin-status-badge unconfirmed" style={{ marginLeft: 8 }}>Masqué</span>
                      )}
                    </td>
                    <td data-label="Couleur" className="admin-table-td">
                      <span>
                        <HighlightedText text={item.colorName || '—'} term={trimmed} />
                      </span>
                    </td>
                    <td data-label="Taille" className="admin-table-td">
                      <span>
                        <HighlightedText text={item.size || '—'} term={trimmed} />
                      </span>
                    </td>
                    <td data-label="SKU" className="admin-table-td col-phone">{item.sku || '—'}</td>
                    <td data-label="Stock" className="admin-table-td">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={displayQty}
                        onChange={(e) => handleEditChange(item.variantId, e.target.value)}
                        aria-label={`Stock ${item.productTitle} ${item.colorName} ${item.size}`}
                      />
                    </td>
                    <td data-label="Statut" className="admin-table-td col-status">
                      {isLowStock ? (
                        <span className="admin-status-badge unconfirmed">Stock faible</span>
                      ) : (
                        <span className="admin-status-badge confirmed">OK</span>
                      )}
                    </td>
                    <td data-label="Action" className="admin-table-td col-actions">
                      <div className="admin-table-actions-cell">
                        <button
                          type="button"
                          className="admin-secondary-btn sm"
                          disabled={saving === item.variantId || !isEditing}
                          onClick={() => handleSave(item.variantId)}
                          style={{ padding: '4px 10px', height: '32px', display: 'inline-flex', alignItems: 'center' }}
                        >
                          {saving === item.variantId ? '...' : 'Enregistrer'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="admin-orders-pagination-bar">
          <div className="admin-pagination-summary">
            Affichage de {totalVariants === 0 ? 0 : startIndex + 1}–{endIndex} sur {totalVariants} variantes
          </div>

          <div className="admin-pagination-right">
            <div className="admin-pagination-page-size">
              <select
                id="admin-inventory-page-size-select"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="admin-page-size-select"
                aria-label="Sélectionner le nombre de variantes par page"
              >
                <option value={20}>20 par page</option>
                <option value={50}>50 par page</option>
                <option value={100}>100 par page</option>
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
                Précédent
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
                ),
              )}

              <button
                type="button"
                className="admin-pagination-btn"
                disabled={activePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Page suivante"
              >
                Suivant
              </button>
            </div>
          </div>
        </div>
        </>
      )}
    </section>
  );
}

