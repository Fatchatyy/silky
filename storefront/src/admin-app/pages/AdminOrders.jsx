import { Fragment, useEffect, useState } from 'react';
import { adminApi as api } from '../../admin/adminApi';
import { generateDocumentsPdf, buildDocumentsToDownload } from '../utils/orderPdf';
import AdminManualOrderModal from './AdminManualOrderModal';
import AdminExchangeModal from './AdminExchangeModal';
import AdminOrderCard, { getDeliveryFilterBucket, getExchangeFilterBucket } from '../components/AdminOrderCard';
import { orderMatchesSearch } from '../utils/orderSearch';

const formatPrice = (amount) =>
  (Number(amount) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' TND';

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

export default function AdminOrders({ refreshKey = 0, onOrderCreated, highlightOrderId = null }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Kept apart from `error`: every reload clears `error`, and this must outlive the modal.
  const [parcelWarning, setParcelWarning] = useState('');
  const [expandedOrderIds, setExpandedOrderIds] = useState([]);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [exchangeModalOrder, setExchangeModalOrder] = useState(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [selectedExchangeIds, setSelectedExchangeIds] = useState([]);
  const [selectedRefundIds, setSelectedRefundIds] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  // Sub-filter of "Confirmée" and "Échangée": all | created (parcel at GOODEX) | failed (parcel not created / uncertain)
  const [deliveryFilter, setDeliveryFilter] = useState('all');
  const [sortDirection, setSortDirection] = useState('desc'); // 'desc' (newest -> oldest), 'asc' (oldest -> newest)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [activeHighlightId, setActiveHighlightId] = useState(null);

  const toggleExpand = (orderId) => {
    setExpandedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId],
    );
  };

  const loadOrders = (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError('');
    api
      .getOrders()
      .then(setOrders)
      .catch((err) => setError(err.message))
      .finally(() => {
        if (isInitial) setLoading(false);
      });
  };

  const [tick, setTick] = useState(0);

  useEffect(() => {
    loadOrders(!orders.length);
  }, [refreshKey]);

  // Shared 60-second interval — increments tick so every AdminOrderCard
  // re-renders its elapsed-time string without creating one timer per row.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const isConfirmedStatus = (order) => order.status === 'completed' || order.status === 'confirmed';

  // GOODEX sub-filter: confirmed orders look at their own parcel, exchanged orders at the exchange parcels.
  const hasDeliverySubfilter = statusFilter === 'confirmed' || statusFilter === 'exchanged';
  const bucketOf = statusFilter === 'exchanged' ? getExchangeFilterBucket : getDeliveryFilterBucket;

  // Counts shown on the sub-filter: orders of the chosen status matching the search box.
  const deliveryCounts = { all: 0, created: 0, failed: 0 };
  if (hasDeliverySubfilter) {
    orders.forEach((order) => {
      const inStatus = statusFilter === 'exchanged' ? order.status === 'exchanged' : isConfirmedStatus(order);
      if (!inStatus || !orderMatchesSearch(order, searchQuery)) return;
      deliveryCounts.all += 1;
      const bucket = bucketOf(order);
      if (bucket) deliveryCounts[bucket] += 1;
    });
  }

  // Filtering pipeline: search query + status dropdown (+ GOODEX sub-filter for "Confirmée")
  const filteredOrders = orders.filter((order) => {
    // 1. Search Query Filter (order number/id, name, phone, e-mail, GOODEX EAN)
    if (!orderMatchesSearch(order, searchQuery)) {
      return false;
    }

    // 2. Status Filter
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'unconfirmed') {
        if (order.status !== 'pending' && order.status !== 'processing') return false;
      } else if (statusFilter === 'confirmed') {
        if (!isConfirmedStatus(order)) return false;
        if (deliveryFilter !== 'all' && bucketOf(order) !== deliveryFilter) return false;
      } else if (statusFilter === 'delivered') {
        if (order.status !== 'delivered') return false;
      } else if (statusFilter === 'exchanged') {
        if (order.status !== 'exchanged') return false;
        if (deliveryFilter !== 'all' && bucketOf(order) !== deliveryFilter) return false;
      } else if (statusFilter === 'refunded') {
        if (order.status !== 'refunded') return false;
      } else if (statusFilter === 'cancelled') {
        if (order.status !== 'cancelled') return false;
      }
    }

    return true;
  });

  // Sorting pipeline (default: newest -> oldest)
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
  });

  const toggleDateSort = () => {
    setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
  };

  // Pagination calculations
  const totalOrders = sortedOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalOrders);
  const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

  // Handle notification highlight scroll & auto-navigate page
  useEffect(() => {
    if (highlightOrderId && orders.length > 0) {
      const orderIdx = sortedOrders.findIndex((o) => o.id === highlightOrderId);
      if (orderIdx !== -1) {
        const targetPage = Math.floor(orderIdx / pageSize) + 1;
        setCurrentPage(targetPage);
      }
      setSearchQuery('');
      setStatusFilter('all');
      setDeliveryFilter('all');
      setActiveHighlightId(highlightOrderId);
      const timer = setTimeout(() => {
        const el = document.getElementById(`order-${highlightOrderId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);

      const clearTimer = setTimeout(() => {
        setActiveHighlightId(null);
      }, 3500);

      return () => {
        clearTimeout(timer);
        clearTimeout(clearTimer);
      };
    }
  }, [highlightOrderId, orders]);

  // Page-scoped select-all state
  const pageOrderIds = paginatedOrders.map((o) => o.id);
  const isAllPageSelected =
    pageOrderIds.length > 0 && pageOrderIds.every((id) => selectedOrderIds.includes(id));
  const isSomePageSelected =
    pageOrderIds.some((id) => selectedOrderIds.includes(id)) && !isAllPageSelected;

  const toggleSelectPage = () => {
    if (isAllPageSelected) {
      // Unselect only orders on the current visible page, preserving other pages
      setSelectedOrderIds((prev) => prev.filter((id) => !pageOrderIds.includes(id)));
    } else {
      // Add visible orders on this page to global selection
      setSelectedOrderIds((prev) => Array.from(new Set([...prev, ...pageOrderIds])));
    }
  };

  const toggleSelectOrder = (id) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleSelectExchange = (id) => {
    setSelectedExchangeIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleSelectRefund = (id) => {
    setSelectedRefundIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  // Global selections evaluation (across ALL orders / pages)
  const selectedOrders = orders.filter((o) => selectedOrderIds.includes(o.id));

  const selectedExchanges = [];
  orders.forEach((order) => {
    if (Array.isArray(order.exchanges)) {
      order.exchanges.forEach((ex) => {
        if (selectedExchangeIds.includes(ex.id)) {
          selectedExchanges.push({
            ...ex,
            orderNumber: ex.orderNumber || order.orderNumber,
          });
        }
      });
    }
  });

  const selectedRefunds = [];
  orders.forEach((order) => {
    if (Array.isArray(order.refunds)) {
      order.refunds.forEach((ref) => {
        if (selectedRefundIds.includes(ref.id)) {
          selectedRefunds.push({
            ...ref,
            orderNumber: ref.orderNumber || order.orderNumber,
          });
        }
      });
    }
  });

  const totalSelectedCount =
    selectedOrders.length +
    selectedExchanges.length +
    selectedRefunds.length;

  const hasSelectedOrders = selectedOrders.length > 0;
  const hasSelectedExchangesOrRefunds =
    selectedExchangeIds.length > 0 || selectedRefundIds.length > 0;

  // Confirmer is enabled ONLY when every globally selected order is unconfirmed (pending or processing)
  // If at least one selected order is not pending/processing, or if exchanges/refunds are selected, it is disabled.
  const canConfirm =
    hasSelectedOrders &&
    !hasSelectedExchangesOrRefunds &&
    selectedOrders.every(
      (o) => o.status === 'pending' || o.status === 'processing',
    );

  const handlePrintOrder = (order) => {
    const docs = buildDocumentsToDownload([order], [order.id], [], []);
    generateDocumentsPdf(docs);
  };

  const handlePrintSelected = () => {
    if (totalSelectedCount === 0) return;
    const documentsToPrint = buildDocumentsToDownload(
      orders,
      selectedOrderIds,
      selectedExchangeIds,
      selectedRefundIds,
    );
    if (documentsToPrint.length === 0) return;
    generateDocumentsPdf(documentsToPrint);
  };

  const handleDownloadSelected = async () => {
    if (totalSelectedCount === 0) return;
    setDownloading(true);
    setError('');

    try {
      // 1. Explicit order confirmation operation FIRST for unconfirmed normal orders
      const unconfirmedIds = selectedOrders
        .filter((o) => o.status === 'pending' || o.status === 'processing')
        .map((o) => o.id);

      let confirmedOrders = [];
      if (unconfirmedIds.length > 0) {
        confirmedOrders = await api.confirmOrders(unconfirmedIds);
      }

      // 2. Build deterministic ordered document list
      const documentsToDownload = buildDocumentsToDownload(
        orders,
        selectedOrderIds,
        selectedExchangeIds,
        selectedRefundIds,
      );

      // 3. Generate and download PDF (side-effect free)
      generateDocumentsPdf(documentsToDownload);

      setSelectedOrderIds([]);
      setSelectedExchangeIds([]);
      setSelectedRefundIds([]);
      if (unconfirmedIds.length > 0) {
        loadOrders();
        onOrderCreated?.();
        warnAboutDelivery(confirmedOrders);
      }
    } catch (err) {
      setError(err.message || 'Erreur lors de la confirmation ou du téléchargement');
    } finally {
      setDownloading(false);
    }
  };

  const handleConfirmSingleOrder = async (order) => {
    setError('');
    try {
      // 1. Explicit order confirmation operation for this single order
      const confirmedOrders = await api.confirmOrders([order.id]);

      // 2. Build deterministic ordered document list
      const documentsToDownload = buildDocumentsToDownload(
        [order],
        [order.id],
        [],
        [],
      );

      // 3. Generate and download PDF (side-effect free)
      if (documentsToDownload.length > 0) {
        generateDocumentsPdf(documentsToDownload);
      }

      setSelectedOrderIds((prev) => prev.filter((id) => id !== order.id));
      loadOrders();
      onOrderCreated?.();
      warnAboutDelivery(confirmedOrders);
    } catch (err) {
      setError(err.message || 'Erreur lors de la confirmation de la commande');
    }
  };

  // Confirmation succeeded; tell the admin when the GOODEX parcel did not get created.
  const warnAboutDelivery = (confirmedOrders) => {
    const problems = (Array.isArray(confirmedOrders) ? confirmedOrders : []).filter(
      (o) => o?.delivery && o.delivery.state !== 'created',
    );
    if (problems.length === 0) {
      setParcelWarning('');
      return;
    }
    // Own state, not `error`: the reload that follows a confirmation clears `error` at once.
    const reasons = problems.map((o) => `${o.orderNumber} (${o.delivery.lastError || 'résultat incertain'})`);
    setParcelWarning(
      `Commande confirmée, mais le colis GOODEX n'a pas été créé pour : ${reasons.join(' ; ')}. Ouvrez la commande pour réessayer.`,
    );
  };

  // The exchange is saved either way. This stays on the page (the modal closes by itself) when
  // its GOODEX parcel was not created, with the reason, until the admin acts.
  const warnAboutExchangeDelivery = (updatedOrder) => {
    const parcel = updatedOrder?.exchanges?.[0]?.delivery;
    if (parcel?.state === 'created') {
      setParcelWarning('');
      return;
    }
    const reason = parcel?.lastError ? ` Motif : ${parcel.lastError}.` : '';
    const uncertain = parcel?.state === 'unknown' ? ' Vérifiez chez GOODEX avant de réessayer.' : '';
    setParcelWarning(
      `Échange enregistré, mais le colis GOODEX n'a pas été créé pour ${updatedOrder?.orderNumber || 'la commande'}.${reason}${uncertain} Ouvrez la commande, section « Historique des Échanges », pour réessayer.`,
    );
  };

  // Returns an error message ('' on success) for the delivery block to show inline, so a
  // tracking failure never replaces the saved status or breaks the page. The orders list
  // itself only reads saved data from Silky's database; GOODEX is called here, one order
  // at a time, on an explicit refresh or (cooldown permitting) when details are opened.
  const handleRefreshDelivery = async (orderId, { onlyIfStale = false } = {}) => {
    try {
      const result = await api.refreshOrderDelivery(orderId, { onlyIfStale });
      if (!result?.refreshSkipped) loadOrders();
      return '';
    } catch (err) {
      return err.message || 'Erreur lors de la récupération du statut de livraison';
    }
  };

  const handleRetryDelivery = async (orderId, acknowledgeUnknown = false) => {
    if (
      acknowledgeUnknown &&
      !window.confirm("Le résultat de la création précédente est incertain. Avez-vous vérifié chez GOODEX qu'aucun colis n'existe pour cette commande ?")
    ) {
      return;
    }
    setError('');
    setParcelWarning('');
    try {
      await api.retryOrderDelivery(orderId, acknowledgeUnknown);
      loadOrders();
    } catch (err) {
      setError(err.message || 'Erreur lors de la création du colis');
    }
  };

  // Same contract as the order parcel handlers, for the parcel of one exchange.
  const handleRefreshExchangeDelivery = async (exchangeId) => {
    try {
      await api.refreshExchangeDelivery(exchangeId);
      loadOrders();
      return '';
    } catch (err) {
      return err.message || 'Erreur lors de la récupération du statut de livraison';
    }
  };

  const handleRetryExchangeDelivery = async (exchangeId, acknowledgeUnknown = false) => {
    if (
      acknowledgeUnknown &&
      !window.confirm("Le résultat de la création précédente est incertain. Avez-vous vérifié chez GOODEX qu'aucun colis n'existe pour cet échange ?")
    ) {
      return;
    }
    setError('');
    setParcelWarning('');
    try {
      await api.retryExchangeDelivery(exchangeId, acknowledgeUnknown);
      loadOrders();
    } catch (err) {
      setError(err.message || 'Erreur lors de la création du colis');
    }
  };

  // Same contract again, for the parcel of one refund.
  const handleRefreshRefundDelivery = async (refundId) => {
    try {
      await api.refreshRefundDelivery(refundId);
      loadOrders();
      return '';
    } catch (err) {
      return err.message || 'Erreur lors de la récupération du statut de livraison';
    }
  };

  const handleRetryRefundDelivery = async (refundId, acknowledgeUnknown = false) => {
    if (
      acknowledgeUnknown &&
      !window.confirm("Le résultat de la création précédente est incertain. Avez-vous vérifié chez GOODEX qu'aucun colis n'existe pour ce remboursement ?")
    ) {
      return;
    }
    setError('');
    setParcelWarning('');
    try {
      await api.retryRefundDelivery(refundId, acknowledgeUnknown);
      loadOrders();
    } catch (err) {
      setError(err.message || 'Erreur lors de la création du colis');
    }
  };

  const handleCancelOrder = async (orderId) => {
    setError('');
    try {
      await api.cancelOrder(orderId);
      setSelectedOrderIds((prev) => prev.filter((id) => id !== orderId));
      const orderToCancel = orders.find((o) => o.id === orderId);
      if (orderToCancel?.exchanges) {
        const exIds = orderToCancel.exchanges.map((e) => e.id);
        setSelectedExchangeIds((prev) => prev.filter((id) => !exIds.includes(id)));
      }
      if (orderToCancel?.refunds) {
        const refIds = orderToCancel.refunds.map((r) => r.id);
        setSelectedRefundIds((prev) => prev.filter((id) => !refIds.includes(id)));
      }
      loadOrders();
      onOrderCreated?.();
    } catch (err) {
      setError(err.message || "Erreur lors de l'annulation de la commande");
    }
  };

  const handleRefundOrder = async (orderId, paymentResponsibility = 'customer_paid') => {
    setError('');
    try {
      await api.refundOrder(orderId, { paymentResponsibility });
      setSelectedOrderIds((prev) => prev.filter((id) => id !== orderId));
      const orderToRefund = orders.find((o) => o.id === orderId);
      if (orderToRefund?.exchanges) {
        const exIds = orderToRefund.exchanges.map((e) => e.id);
        setSelectedExchangeIds((prev) => prev.filter((id) => !exIds.includes(id)));
      }
      if (orderToRefund?.refunds) {
        const refIds = orderToRefund.refunds.map((r) => r.id);
        setSelectedRefundIds((prev) => prev.filter((id) => !refIds.includes(id)));
      }
      loadOrders();
      onOrderCreated?.();
    } catch (err) {
      setError(err.message || "Erreur lors du remboursement de la commande");
    }
  };

  const handleDeliverOrder = async (orderId) => {
    setError('');
    try {
      await api.deliverOrder(orderId);
      setSelectedOrderIds((prev) => prev.filter((id) => id !== orderId));
      loadOrders();
      onOrderCreated?.();
    } catch (err) {
      setError(err.message || 'Erreur lors de la livraison de la commande');
    }
  };

  const handleManualOrderSuccess = () => {
    loadOrders();
    onOrderCreated?.();
  };

  if (loading) return <p className="admin-loading">Chargement des commandes...</p>;

  return (
    <section className="admin-panel admin-orders-panel">
      {/* Top Header Bar */}
      <div className="admin-panel-header admin-orders-header">
        <div className="admin-panel-title-area">
          <h2>Commandes</h2>
          {filteredOrders.length > 0 && (
            <span className="admin-draft-count-badge">
              {filteredOrders.length} commande{filteredOrders.length > 1 ? 's' : ''}
            </span>
          )}
          {paginatedOrders.length > 0 && (
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
        </div>
        <div className="admin-panel-actions">
          <button
            type="button"
            className="admin-print-toolbar-btn"
            disabled={totalSelectedCount === 0}
            onClick={handlePrintSelected}
            title={`Imprimer${totalSelectedCount > 0 ? ` (${totalSelectedCount})` : ''}`}
            aria-label={`Imprimer ${totalSelectedCount} commande(s) sélectionnée(s)`}
          >
            <img alt="" className="admin-btn-icon" src="/pictures/printer.png" />
          </button>
          <button
            type="button"
            className="admin-download-btn"
            disabled={!canConfirm || downloading}
            onClick={handleDownloadSelected}
          >
            <img src="/pictures/confirm.png" alt="" className="admin-btn-icon" style={{ filter: 'none' }} />
            <span>
              {downloading
                ? 'Confirmation...'
                : `Confirmer${totalSelectedCount > 0 ? ` (${totalSelectedCount})` : ''}`}
            </span>
          </button>
          <button type="button" className="admin-primary-btn" onClick={() => setManualOrderOpen(true)}>
            <img src="/pictures/addorder.png" alt="" className="admin-btn-icon" />
            <span>Créer une commande</span>
          </button>
          <button type="button" className="admin-secondary-btn" onClick={() => loadOrders()}>
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
            placeholder="Rechercher par N° commande, nom client, téléphone, email, code de suivi..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
          {searchQuery && (
            <button
              type="button"
              className="admin-search-clear-btn"
              onClick={() => {
                setSearchQuery('');
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
              setDeliveryFilter('all');
              setCurrentPage(1);
            }}
            aria-label="Filtrer par statut"
          >
            <option value="all">Tous les statuts</option>
            <option value="unconfirmed">Non Confirmée</option>
            <option value="confirmed">Confirmée</option>
            <option value="delivered">Livrée</option>
            <option value="exchanged">Échangée</option>
            <option value="refunded">Remboursée</option>
            <option value="cancelled">Annulée</option>
          </select>
        </div>

        {hasDeliverySubfilter && (
          <div className="admin-segmented-control" role="group" aria-label="Filtrer par livraison GOODEX">
            {[
              { value: 'all', label: 'Toutes' },
              { value: 'created', label: 'Colis créé' },
              { value: 'failed', label: 'Échec GOODEX' },
            ].map((opt) => (
              <button
                type="button"
                key={opt.value}
                className={`admin-segment-btn${deliveryFilter === opt.value ? ' active' : ''}${opt.value === 'failed' && deliveryCounts.failed > 0 ? ' has-problem' : ''}`}
                title={opt.value === 'failed' ? 'Colis non créé chez GOODEX, résultat incertain, ou colis introuvable (à réessayer ou vérifier)' : undefined}
                onClick={() => {
                  setDeliveryFilter(opt.value);
                  setCurrentPage(1);
                }}
              >
                {opt.label} · {deliveryCounts[opt.value]}
              </button>
            ))}
          </div>
        )}
      </div>

      <AdminManualOrderModal
        open={manualOrderOpen}
        onClose={() => setManualOrderOpen(false)}
        onSuccess={handleManualOrderSuccess}
      />

      <AdminExchangeModal
        open={Boolean(exchangeModalOrder)}
        order={exchangeModalOrder?.order || exchangeModalOrder}
        paymentResponsibility={exchangeModalOrder?.paymentResponsibility || 'customer_paid'}
        onClose={() => setExchangeModalOrder(null)}
        onSuccess={(updatedOrder) => {
          loadOrders();
          onOrderCreated?.();
          warnAboutExchangeDelivery(updatedOrder);
        }}
      />

      {parcelWarning && (
        <p className="admin-error" role="alert" style={{ marginBottom: '16px' }}>
          {parcelWarning}{' '}
          <button type="button" className="admin-btn secondary" onClick={() => setParcelWarning('')}>
            Fermer
          </button>
        </p>
      )}

      {error && <p className="admin-error" style={{ marginBottom: '16px' }}>{error}</p>}

      {orders.length === 0 ? (
        <p className="admin-empty">Aucune commande pour le moment.</p>
      ) : filteredOrders.length === 0 ? (
        <p className="admin-empty">
          {searchQuery
            ? `Aucune commande ne correspond à votre recherche "${searchQuery}".`
            : 'Aucune commande ne correspond au filtre sélectionné.'}
        </p>
      ) : (
        <>
          {/* Main Orders Table */}
          <div className="admin-orders-table-wrap">
            <table className="admin-orders-table admin-orders-table--tight">
              <thead>
                <tr className="admin-table-header-row">
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
                      aria-label="Sélectionner toutes les commandes de la page"
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
                      <span>ID</span>
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
                      <span>Statut</span>
                    </div>
                  </th>
                  <th className="admin-table-th col-delivery">
                    <div className="admin-th-content">
                      <span>Statut livraison</span>
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
                {paginatedOrders.map((order) => (
                  <AdminOrderCard
                    key={order.id}
                    order={order}
                    isSelected={selectedOrderIds.includes(order.id)}
                    isExpanded={expandedOrderIds.includes(order.id)}
                    activeHighlightId={activeHighlightId}
                    selectedExchangeIds={selectedExchangeIds}
                    selectedRefundIds={selectedRefundIds}
                    toggleSelectOrder={toggleSelectOrder}
                    toggleExpand={toggleExpand}
                    handlePrintOrder={handlePrintOrder}
                    handleConfirmSingleOrder={handleConfirmSingleOrder}
                    handleDeliverOrder={handleDeliverOrder}
                    setExchangeModalOrder={setExchangeModalOrder}
                    handleRefundOrder={handleRefundOrder}
                    handleCancelOrder={handleCancelOrder}
                    handleRefreshDelivery={handleRefreshDelivery}
                    handleRetryDelivery={handleRetryDelivery}
                    handleRefreshExchangeDelivery={handleRefreshExchangeDelivery}
                    handleRetryExchangeDelivery={handleRetryExchangeDelivery}
                    handleRefreshRefundDelivery={handleRefreshRefundDelivery}
                    handleRetryRefundDelivery={handleRetryRefundDelivery}
                    toggleSelectExchange={toggleSelectExchange}
                    toggleSelectRefund={toggleSelectRefund}
                    tick={tick}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Bar */}
          <div className="admin-orders-pagination-bar">
            <div className="admin-pagination-summary">
              Showing {totalOrders === 0 ? 0 : startIndex + 1}–{endIndex} of {totalOrders} orders
            </div>

            <div className="admin-pagination-right">
              <div className="admin-pagination-page-size">
                <select
                  id="admin-page-size-select"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="admin-page-size-select"
                  aria-label="Sélectionner le nombre de commandes par page"
                >
                  <option value={20}>20 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                  <option value={500}>500 per page</option>
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
                  ),
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
    </section>
  );
}
