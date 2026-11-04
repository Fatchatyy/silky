import { Fragment, useEffect, useState } from 'react';
import ClaimsBlock from './ClaimsBlock';
import { GxButton, CopyButton, Alert, KV, formatGoodexDate } from './gx';

/**
 * AdminOrderCard — Reusable order row component.
 * Mechanically extracted from AdminOrders.jsx (lines 592–962).
 * No design changes. No business logic changes.
 * Used by AdminOrders.
 */

// Shared utilities — duplicated here so this component is self-contained
export const formatPrice = (amount) =>
  (Number(amount) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' TND';

export function renderStatusBadge(status) {
  if (status === 'delivered') {
    return <span className="admin-status-badge delivered">Livrée</span>;
  }
  if (status === 'completed' || status === 'confirmed') {
    return <span className="admin-status-badge confirmed">Confirmée</span>;
  }
  if (status === 'exchanged') {
    return <span className="admin-status-badge exchanged">Echangée</span>;
  }
  if (status === 'refunded') {
    return <span className="admin-status-badge refunded">Remboursée</span>;
  }
  if (status === 'cancelled') {
    return <span className="admin-status-badge cancelled">Annulée</span>;
  }
  return <span className="admin-status-badge unconfirmed">Non Confirmée</span>;
}

/**
 * "Statut livraison" is GOODEX's delivery status. It is displayed next to, and never
 * mixed with, Silky's own order status ("Statut", renderStatusBadge above).
 */
const DELIVERY_STATE_LABELS = {
  creating: 'Création en cours…',
  created: 'Colis créé',
  failed: 'Échec de création',
  unknown: 'Résultat incertain',
};

/**
 * Describes the delivery situation of an order in French:
 *  - no delivery row        -> no parcel created or submitted yet
 *  - creating / failed / unknown -> creation states (never shown with a GOODEX status)
 *  - created                -> official GOODEX label (e.g. "En Attente"), or the raw
 *                              value flagged as unrecognized, or just "Colis créé"
 */
export function getDeliveryDisplay(order) {
  const d = order?.delivery;
  if (!d) {
    return { label: 'Aucun colis', tone: 'none', hint: "Aucun colis n'a été créé ni envoyé à GOODEX" };
  }
  if (d.state === 'creating') {
    return { label: DELIVERY_STATE_LABELS.creating, tone: 'pending', hint: 'Envoi à GOODEX en cours' };
  }
  if (d.state === 'failed') {
    return { label: DELIVERY_STATE_LABELS.failed, tone: 'error', hint: d.lastError || 'La création du colis a échoué' };
  }
  if (d.state === 'unknown') {
    return {
      label: DELIVERY_STATE_LABELS.unknown,
      tone: 'warn',
      hint: d.lastError || 'Le colis a peut-être été créé chez GOODEX : vérifiez avant de réessayer',
    };
  }
  if (d.statusLabel) return { label: d.statusLabel, tone: 'ok', hint: d.goodexStatus || d.statusLabel };
  if (d.goodexStatus) {
    return {
      label: `Statut non reconnu : ${d.goodexStatus}`,
      tone: 'warn',
      hint: `Valeur brute reçue de GOODEX : ${d.goodexStatus}`,
    };
  }
  return { label: DELIVERY_STATE_LABELS.created, tone: 'ok', hint: 'Colis créé, statut GOODEX pas encore reçu' };
}

/** An exchange whose own parcel was not created (older exchanges have none and are ignored). */
function findExchangeDeliveryProblem(order) {
  return (order.exchanges || []).find(
    (ex) => ex.delivery && (ex.delivery.state === 'failed' || ex.delivery.state === 'unknown'),
  );
}

/**
 * The created parcel that matters for an order: the latest exchange's when it has exchange
 * parcels, otherwise its own. Used for the single "Colis introuvable" badge and the filters.
 */
function findRelevantParcel(order) {
  const latestExchangeParcel = (order?.exchanges || [])
    .filter((ex) => ex.delivery?.state === 'created')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0]?.delivery;
  return latestExchangeParcel || (order?.delivery?.state === 'created' ? order.delivery : null);
}

/**
 * Bucket used by the "Confirmée" sub-filter: 'created' (GOODEX has the parcel), 'failed'
 * (creation failed or its outcome is uncertain, an exchange parcel is in that state, or GOODEX
 * no longer finds the parcel, i.e. what the admin must act on) or null (no parcel row yet, or
 * creation in progress).
 */
export function getDeliveryFilterBucket(order) {
  const state = order?.delivery?.state;
  if (state === 'failed' || state === 'unknown' || findExchangeDeliveryProblem(order)) return 'failed';
  if (findRelevantParcel(order)?.trackingNotFound) return 'failed';
  return state === 'created' ? 'created' : null;
}

/**
 * Same buckets for the "Échangée" sub-filter, judged on the exchange parcels only: the
 * original parcel belongs to the first delivery and is irrelevant to an exchanged order.
 * Exchanges recorded before GOODEX was connected have no parcel and fall in no bucket.
 */
export function getExchangeFilterBucket(order) {
  if (findExchangeDeliveryProblem(order)) return 'failed';
  if (findRelevantParcel(order)?.trackingNotFound) return 'failed';
  return (order?.exchanges || []).some((ex) => ex.delivery?.state === 'created') ? 'created' : null;
}

/** Compact cell for the main orders table: status, EAN, and a warning when a motif exists. */
function DeliveryStatusCell({ order }) {
  const d = order.delivery;
  const display = getDeliveryDisplay(order);
  // The server decides (parcel exists + reason received + GOODEX did not report has_motif=false).
  const hasIncident = Boolean(d?.incident);
  const exchangeProblem = findExchangeDeliveryProblem(order);
  // One "Colis introuvable" for the parcel that matters: the latest exchange's when the order has
  // exchange parcels, otherwise the order's own. It replaces the stale last status ("En Attente").
  const relevantParcel = findRelevantParcel(order);
  const parcelNotFound = Boolean(relevantParcel?.trackingNotFound);
  return (
    <>
      {/* The exchange failure replaces the order's own parcel status instead of sitting beside it. */}
      {!exchangeProblem && !parcelNotFound && (
        <span className={`admin-delivery-badge ${display.tone}`} title={display.hint}>
          {display.label}
        </span>
      )}
      {exchangeProblem && (
        <span
          className={`admin-delivery-badge ${exchangeProblem.delivery.state === 'failed' ? 'error' : 'warn'}`}
          title={exchangeProblem.delivery.lastError || 'Colis GOODEX de l\'échange non créé'}
        >
          Échange : colis {exchangeProblem.delivery.state === 'failed' ? 'non créé' : 'incertain'}
        </span>
      )}
      {hasIncident && (
        <span
          className="admin-delivery-warning"
          role="img"
          aria-label={`Incident de livraison : ${d.motif}`}
          title={`Incident de livraison : ${d.motif}`}
        >
          ⚠
        </span>
      )}
      {parcelNotFound && (
        <span
          className="admin-delivery-badge error"
          title={`GOODEX ne retrouve pas ce colis (${relevantParcel.ean}). Dernier statut connu : ${relevantParcel.statusLabel || display.label}`}
        >
          Colis introuvable
        </span>
      )}
      {d?.ean && (
        <span className="admin-delivery-ean" title="Code de suivi GOODEX (EAN)">
          {d.ean}
        </span>
      )}
    </>
  );
}

function DeliveryBlock({ order, onRefresh, onRetry }) {
  const delivery = order.delivery;
  const eligible = ['completed', 'confirmed', 'exchanged', 'delivered'].includes(order.status);
  const state = delivery?.state;
  const canTrack = state === 'created' && Boolean(delivery?.ean);
  const [trackingError, setTrackingError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Opening the details refreshes from GOODEX only when the saved data is stale; the
  // server enforces the cooldown, so this is a no-op most of the time.
  useEffect(() => {
    if (!canTrack) return undefined;
    let cancelled = false;
    onRefresh(order.id, { onlyIfStale: true }).then((message) => {
      if (!cancelled) setTrackingError(message || '');
    });
    return () => {
      cancelled = true;
    };
  }, [order.id, canTrack]);

  if (!delivery && !eligible) return null;

  const display = getDeliveryDisplay(order);
  const manualRefresh = async () => {
    setRefreshing(true);
    setTrackingError((await onRefresh(order.id, { onlyIfStale: false })) || '');
    setRefreshing(false);
  };
  const showRetry = (!state || state === 'failed') && order.status === 'completed';

  return (
    <section className="gx-card" aria-label="Livraison GOODEX">
      <header className="gx-card__head">
        <h4 className="gx-card__title">Livraison GOODEX</h4>
        <span className={`admin-delivery-badge ${display.tone}`}>{display.label}</span>
        {state === 'created' && delivery.statusLabel && delivery.statusId != null && (
          <span className="gx-chip">GOODEX n°{delivery.statusId}</span>
        )}
      </header>

      {state === 'created' && (
        <dl className="gx-kv">
          <KV label="Code de suivi (EAN)">
            {delivery.ean && (
              <>
                <code className="gx-code">{delivery.ean}</code>
                <CopyButton text={delivery.ean} />
              </>
            )}
          </KV>
          <KV label="Colis GOODEX">
            {delivery.parcelId != null &&
              `n°${delivery.parcelId}${delivery.goodexCreatedAt ? ` · créé le ${formatGoodexDate(delivery.goodexCreatedAt)}` : ''}`}
          </KV>
          <KV label="Dernier statut reçu">{formatGoodexDate(delivery.statusReceivedAt)}</KV>
          <KV label="Statut changé le">{formatGoodexDate(delivery.statusUpdatedAt)}</KV>
          <KV label="Dernière notification">{formatGoodexDate(delivery.lastWebhookAt)}</KV>
          <KV label="Dernière vérification">{formatGoodexDate(delivery.lastPolledAt)}</KV>
        </dl>
      )}

      {state && state !== 'created' && (
        <Alert tone={state === 'failed' ? 'error' : state === 'unknown' ? 'warn' : 'info'}>{display.hint}</Alert>
      )}
      {state === 'created' && delivery.trackingNotFound && (
        <Alert tone="error" title="Colis introuvable">
          GOODEX répond « Colis Introuvable » pour ce code de suivi.
          {delivery.goodexStatus ? ` Dernier statut connu : ${delivery.statusLabel || delivery.goodexStatus}.` : ''}
        </Alert>
      )}
      {delivery?.incident && (
        <Alert tone="warn" title="Incident de livraison">
          {delivery.motif}
          {delivery.motifUpdatedAt && <span className="gx-alert__meta"> Reçu le {formatGoodexDate(delivery.motifUpdatedAt)}</span>}
        </Alert>
      )}
      {trackingError && (
        <Alert tone="error" title="Suivi GOODEX indisponible">
          {trackingError.replace(/^Suivi GOODEX indisponible : /, '')}
        </Alert>
      )}

      {(canTrack || showRetry || state === 'unknown') && (
        <footer className="gx-card__actions">
          {canTrack && (
            <GxButton icon="refresh" busy={refreshing} onClick={manualRefresh}>
              {refreshing ? 'Actualisation…' : 'Actualiser le statut'}
            </GxButton>
          )}
          {showRetry && (
            <GxButton variant="primary" icon={state === 'failed' ? 'refresh' : 'plus'} onClick={() => onRetry(order.id, false)}>
              {state === 'failed' ? 'Réessayer la création' : 'Créer le colis'}
            </GxButton>
          )}
          {state === 'unknown' && (
            <GxButton variant="primary" icon="refresh" onClick={() => onRetry(order.id, true)}>
              Réessayer (j'ai vérifié chez GOODEX)
            </GxButton>
          )}
        </footer>
      )}
    </section>
  );
}

/**
 * The GOODEX parcel of one exchange or one refund (separate from the order's own parcel above).
 * `record` is the exchange or refund carrying `delivery`. Shows the GOODEX status and tracking
 * code, and offers the same retry safeguards as the order parcel: a failed creation can be
 * retried, an uncertain one only after the admin confirms having checked at GOODEX.
 */
function ParcelDeliveryLine({ record, ariaLabel, onRefresh, onRetry }) {
  const delivery = record.delivery;
  const state = delivery?.state;
  const display = getDeliveryDisplay({ delivery });
  const [refreshing, setRefreshing] = useState(false);
  const [trackingError, setTrackingError] = useState('');

  const manualRefresh = async () => {
    setRefreshing(true);
    setTrackingError((await onRefresh(record.id)) || '');
    setRefreshing(false);
  };

  return (
    <div className="gx-exchange-delivery" aria-label={ariaLabel}>
      <span className="gx-exchange-delivery__label">Colis GOODEX :</span>
      <span className={`admin-delivery-badge ${display.tone}`} title={display.hint}>
        {display.label}
      </span>
      {delivery?.ean && (
        <>
          <code className="gx-code">{delivery.ean}</code>
          <CopyButton text={delivery.ean} />
        </>
      )}
      {(state === 'failed' || state === 'unknown') && delivery.lastError && (
        <span className="gx-exchange-delivery__error">{delivery.lastError}</span>
      )}
      {state === 'created' && delivery.trackingNotFound && (
        <span className="admin-delivery-badge error" title="GOODEX ne retrouve pas ce colis">
          Colis introuvable
        </span>
      )}
      {trackingError && <span className="gx-exchange-delivery__error">{trackingError}</span>}
      {state === 'created' && (
        <GxButton icon="refresh" busy={refreshing} onClick={manualRefresh}>
          {refreshing ? 'Actualisation…' : 'Actualiser le statut'}
        </GxButton>
      )}
      {(!state || state === 'failed') && (
        <GxButton variant="primary" icon={state === 'failed' ? 'refresh' : 'plus'} onClick={() => onRetry(record.id, false)}>
          {state === 'failed' ? 'Réessayer la création' : 'Créer le colis'}
        </GxButton>
      )}
      {state === 'unknown' && (
        <GxButton variant="primary" icon="refresh" onClick={() => onRetry(record.id, true)}>
          Réessayer (j'ai vérifié chez GOODEX)
        </GxButton>
      )}
    </div>
  );
}

function isValidTimestamp(ts) {
  if (!ts) return false;
  const time = new Date(ts).getTime();
  return !isNaN(time);
}

/**
 * Returns the timestamp to use as the counter's start time for a given order.
 * Priority:
 *   1. pending / processing → order.createdAt (unconfirmed)
 *   2. exchanged            → newest exchange's createdAt
 *   3. other statuses       → order.updatedAt (completed, delivered, cancelled, refunded)
 *
 * Fallback:
 *   If the selected timestamp is missing or invalid, falls back to a valid order.createdAt.
 *   If neither is valid, returns null.
 */
export function getElapsedBaseTimestamp(order) {
  if (!order) return null;

  let candidate = null;

  if (order.status === 'pending' || order.status === 'processing') {
    candidate = order.createdAt;
  } else if (order.status === 'exchanged') {
    // API/repository returns exchanges newest-first (orderBy desc createdAt).
    // We pick the newest valid exchange createdAt across single or multiple exchanges:
    if (Array.isArray(order.exchanges) && order.exchanges.length > 0) {
      for (const ex of order.exchanges) {
        if (isValidTimestamp(ex?.createdAt)) {
          if (!candidate || new Date(ex.createdAt).getTime() > new Date(candidate).getTime()) {
            candidate = ex.createdAt;
          }
        }
      }
    }
  } else {
    // completed, delivered, cancelled, refunded
    candidate = order.updatedAt;
  }

  if (isValidTimestamp(candidate)) {
    return candidate;
  }

  if (isValidTimestamp(order.createdAt)) {
    return order.createdAt;
  }

  return null;
}

/**
 * Formats a timestamp as a compact French elapsed-time string.
 * Returns '—' when the timestamp is missing, invalid, or far in the future.
 */
export function formatElapsed(timestamp) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  const time = d.getTime();
  if (isNaN(time)) return '—';

  const diffMs = Date.now() - time;

  // Clock skew tolerance: if created up to 1 minute in the future, treat as just now
  if (diffMs < 0) {
    if (diffMs >= -60000) {
      return 'Depuis < 1 min';
    }
    return '—';
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (days >= 1) {
    return hours > 0 ? `Depuis ${days} j ${hours} h` : `Depuis ${days} j`;
  }
  if (totalHours >= 1) {
    return minutes > 0 ? `Depuis ${totalHours} h ${String(minutes).padStart(2, '0')}` : `Depuis ${totalHours} h`;
  }
  if (totalMinutes >= 1) {
    return `Depuis ${totalMinutes} min`;
  }
  return 'Depuis < 1 min';
}

/**
 * Props:
 *  order                  — the order object
 *  isSelected             — whether this order's main checkbox is checked
 *  isExpanded             — whether the expanded details row is visible
 *  activeHighlightId      — order id currently highlighted (notification scroll)
 *  selectedExchangeIds    — array of exchange ids selected globally
 *  selectedRefundIds      — array of refund ids selected globally
 *  toggleSelectOrder(id)  — toggle order checkbox
 *  toggleExpand(id)       — toggle expanded row
 *  handlePrintOrder(order)
 *  handleConfirmSingleOrder(order)
 *  handleDeliverOrder(orderId)
 *  setExchangeModalOrder({ order, paymentResponsibility })
 *  handleRefundOrder(orderId, paymentResponsibility)
 *  handleCancelOrder(orderId)
 *  toggleSelectExchange(id)
 *  toggleSelectRefund(id)
 *
 * Optional prop:
 *  readOnly               — when true, hides action buttons (confirm/exchange/refund/cancel/print/checkbox)
 */
export default function AdminOrderCard({
  order,
  isSelected,
  isExpanded,
  activeHighlightId,
  selectedExchangeIds = [],
  selectedRefundIds = [],
  toggleSelectOrder,
  toggleExpand,
  handlePrintOrder,
  handleConfirmSingleOrder,
  handleDeliverOrder,
  setExchangeModalOrder,
  handleRefundOrder,
  handleCancelOrder,
  handleRefreshDelivery,
  handleRetryDelivery,
  handleRefreshExchangeDelivery,
  handleRetryExchangeDelivery,
  handleRefreshRefundDelivery,
  handleRetryRefundDelivery,
  toggleSelectExchange,
  toggleSelectRefund,
  // tick is incremented by a shared interval in AdminOrders every 60 s;
  // receiving it as a prop causes this row to re-render so formatElapsed stays current.
  // eslint-disable-next-line no-unused-vars
  tick = 0,
  readOnly = false,
}) {
  const isDelivered = order.status === 'delivered';
  const isCancelled = order.status === 'cancelled';
  const isRefunded = order.status === 'refunded';
  const isUnconfirmed = order.status === 'pending' || order.status === 'processing';
  const isTerminal = isDelivered || isCancelled || isRefunded;
  const canExchange = !isTerminal && (order.status === 'completed' || order.status === 'confirmed' || order.status === 'exchanged');
  const canDeliver = !isTerminal && (order.status === 'completed' || order.status === 'confirmed' || order.status === 'exchanged');
  // Deliver / exchange / refund wait until GOODEX has the parcel. Only orders that tried and did not
  // get through are held back (a parcel row exists but is not "created", or an exchange parcel
  // failed); older orders confirmed before GOODEX was connected have no row and stay usable.
  const parcelBlocked = Boolean(
    (order.delivery && order.delivery.state !== 'created') || findExchangeDeliveryProblem(order),
  );
  const blockedHint = "Indisponible : le colis GOODEX n'a pas encore été créé";

  const payableAmount =
    order.customerAmountToPay !== undefined
      ? order.customerAmountToPay
      : (order.finalCustomerPayableAmount !== undefined ? order.finalCustomerPayableAmount : order.total);

  return (
    <Fragment key={order.id}>
      <tr
        id={`order-${order.id}`}
        className={`admin-order-row ${isDelivered ? 'is-delivered' : ''} ${isCancelled ? 'is-cancelled' : ''} ${isRefunded ? 'is-refunded' : ''} ${activeHighlightId === order.id ? 'notification-highlight' : ''}`}
      >
        {/* Column 0: Checkbox */}
        <td className="admin-table-td col-select">
          {!readOnly && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSelectOrder(order.id)}
              aria-label={`Sélectionner commande ${order.orderNumber}`}
            />
          )}
        </td>

        {/* Column 1: Date et Heure */}
        <td className="admin-table-td col-date">
          <span className="admin-table-cell-date">
            {order.createdAt ? new Date(order.createdAt).toLocaleString('fr-FR') : '—'}
          </span>
          <span className="admin-elapsed-time">
            {formatElapsed(getElapsedBaseTimestamp(order))}
          </span>
        </td>

        {/* Column 2: ID de la commande */}
        <td className="admin-table-td col-id">
          <strong className="admin-table-cell-id">{order.orderNumber}</strong>
        </td>

        {/* Column 3: Nom Client */}
        <td className="admin-table-td col-client">
          <span className="admin-table-cell-client">
            {order.customer?.firstName || order.customer?.name || ''} {order.customer?.lastName || ''}
          </span>
        </td>

        {/* Column 4: Téléphone */}
        <td className="admin-table-td col-phone">
          <span className="admin-table-cell-phone">
            {order.customer?.phone || '—'}
          </span>
        </td>

        {/* Column 5: Status */}
        <td className="admin-table-td col-status">
          {renderStatusBadge(order.status)}
        </td>

        {/* Column 5b: Statut livraison (GOODEX), independent of the order status */}
        <td className="admin-table-td col-delivery">
          <DeliveryStatusCell order={order} />
        </td>

        {/* Column 6: Prix (Montant à payer) */}
        <td className="admin-table-td col-price">
          <strong className="admin-table-cell-price">{formatPrice(payableAmount)}</strong>
        </td>

        {/* Column 7: Actions */}
        <td className="admin-table-td col-actions">
          <div className="admin-table-actions-cell">
            {!readOnly && (
              <button
                type="button"
                className="admin-icon-action-btn admin-btn-print"
                onClick={() => handlePrintOrder(order)}
                aria-label={`Imprimer commande ${order.orderNumber}`}
              >
                <img alt="" className="admin-btn-icon" src="/pictures/printer.png" />
                <span className="admin-tooltip">Imprimer</span>
              </button>
            )}
            <div className="admin-order-actions-cluster">
              <div className="admin-actions-row admin-actions-row-top">
                <button
                  type="button"
                  className="admin-icon-action-btn admin-btn-details"
                  onClick={() => toggleExpand(order.id)}
                  aria-label={isExpanded ? 'Masquer' : 'Détails'}
                >
                  <img alt="" className="admin-btn-icon" src="/pictures/history.png" />
                  <span className="admin-tooltip">Détails</span>
                </button>
                {!readOnly && isUnconfirmed && (
                  <button
                    type="button"
                    className="admin-icon-action-btn admin-btn-confirm"
                    onClick={() => handleConfirmSingleOrder(order)}
                    aria-label="Confirmer commande"
                  >
                    <img alt="" className="admin-btn-icon" src="/pictures/confirm.png" />
                    <span className="admin-tooltip">Confirmer</span>
                  </button>
                )}
                {!readOnly && canDeliver && (
                  <button
                    type="button"
                    className="admin-icon-action-btn admin-btn-deliver"
                    onClick={() => handleDeliverOrder(order.id)}
                    disabled={parcelBlocked}
                    aria-label="Marquer comme livrée"
                  >
                    <img alt="" className="admin-btn-icon" src="/pictures/truckdilevery.png" />
                    <span className="admin-tooltip">{parcelBlocked ? blockedHint : 'Marquer comme livrée'}</span>
                  </button>
                )}
                {!readOnly && canExchange && (
                  <button
                    type="button"
                    className="admin-icon-action-btn admin-btn-exchange"
                    onClick={() => setExchangeModalOrder({ order, paymentResponsibility: 'customer_paid' })}
                    disabled={parcelBlocked}
                    aria-label="Échange"
                  >
                    <img alt="" className="admin-btn-icon" src="/pictures/exchange.png" />
                    <span className="admin-tooltip">{parcelBlocked ? blockedHint : 'Échange'}</span>
                  </button>
                )}
                {!readOnly && !isTerminal && !isUnconfirmed && (
                  <button
                    type="button"
                    className="admin-icon-action-btn admin-btn-refund"
                    onClick={() => handleRefundOrder(order.id, 'customer_paid')}
                    disabled={parcelBlocked}
                    aria-label="Remboursement"
                  >
                    <img alt="" className="admin-btn-icon" src="/pictures/refund.png" />
                    <span className="admin-tooltip">{parcelBlocked ? blockedHint : 'Remboursement'}</span>
                  </button>
                )}
                {!readOnly && !isTerminal && (
                  <button
                    type="button"
                    className="admin-icon-action-btn admin-btn-cancel"
                    onClick={() => handleCancelOrder(order.id)}
                    aria-label="Annuler"
                  >
                    <img alt="" className="admin-btn-icon" src="/pictures/cancel.png" />
                    <span className="admin-tooltip">Annuler</span>
                  </button>
                )}
              </div>
              {!readOnly && (canExchange || (!isTerminal && !isUnconfirmed)) && (
                <div className="admin-actions-row admin-actions-row-bottom">
                  {canExchange && (
                    <button
                      type="button"
                      className="admin-icon-action-btn admin-btn-exchange-paid"
                      onClick={() => setExchangeModalOrder({ order, paymentResponsibility: 'silky_paid' })}
                      disabled={parcelBlocked}
                      aria-label="Échange payé"
                    >
                      <img alt="" className="admin-btn-icon" src="/pictures/exchangesilky.png" />
                      <span className="admin-tooltip">{parcelBlocked ? blockedHint : 'Échange payé'}</span>
                    </button>
                  )}
                  {!isTerminal && !isUnconfirmed && (
                    <button
                      type="button"
                      className="admin-icon-action-btn admin-btn-refund-free"
                      onClick={() => handleRefundOrder(order.id, 'silky_paid')}
                      disabled={parcelBlocked}
                      aria-label="Remboursement gratuit"
                    >
                      <img alt="" className="admin-btn-icon" src="/pictures/refundsilky.png" />
                      <span className="admin-tooltip">{parcelBlocked ? blockedHint : 'Remboursement gratuit'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </td>
      </tr>

      {/* Expanded Row */}
      {isExpanded && (
        <tr className="admin-order-expanded-row">
          <td colSpan={9} className="admin-order-expanded-cell">
            <div className="admin-order-details">
              <div className="admin-expanded-header-info">
                <p>
                  <strong>Client:</strong> {order.customer?.firstName || order.customer?.name || ''} {order.customer?.lastName || ''}
                </p>
                <p>
                  <strong>Email:</strong> {order.customer?.email || 'Non renseigné'}
                </p>
                <p>
                  <strong>Téléphone:</strong> {order.customer?.phone || 'Non renseigné'}
                </p>
                <p>
                  <strong>Adresse:</strong> {order.customer?.address || 'Non renseignée'}
                </p>
              </div>

              <div className="admin-expanded-items-section">
                <strong>Articles commandés :</strong>
                <ul className="admin-order-items-list">
                  {order.items?.map((item, i) => (
                    <li key={i}>
                      <strong>{item.name || item.productTitle}</strong>
                      {item.details || item.variantLabel ? ` (${item.details || item.variantLabel})` : ''} × {item.quantity} — {formatPrice((item.price || item.unitPrice || 0) * item.quantity)}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="admin-expanded-financials">
                <p>
                  <strong>Total:</strong> {formatPrice(order.total)} (livraison: {formatPrice(order.deliveryFee)})
                </p>
                <p>
                  <strong>Montant à payer:</strong> {formatPrice(payableAmount)}
                </p>
              </div>

              {!readOnly && (
                <DeliveryBlock
                  order={order}
                  onRefresh={handleRefreshDelivery}
                  onRetry={handleRetryDelivery}
                />
              )}

              {!readOnly && <ClaimsBlock order={order} />}

              {/* Historical Exchanges */}
              {order.exchanges && order.exchanges.length > 0 && (
                <div className="admin-order-exchanges-history">
                  <h4 className="admin-exchanges-title">Historique des Échanges ({order.exchanges.length})</h4>
                  <div className="admin-history-subtable-wrap">
                    <table className="admin-history-subtable">
                      <thead>
                        <tr>
                          <th className="col-sub-select"></th>
                          <th className="col-sub-date">Date et Heure</th>
                          <th className="col-sub-id">ID Échange</th>
                          <th className="col-sub-client">Client</th>
                          <th className="col-sub-phone">Téléphone</th>
                          <th className="col-sub-status">Type</th>
                          <th className="col-sub-price">Montant à payer</th>
                          <th className="col-sub-details">Détails</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.exchanges.map((ex, idx) => {
                          const exPayable =
                            ex.customerAmountToPay !== undefined
                              ? ex.customerAmountToPay
                              : (ex.finalCustomerPayableAmount !== undefined ? ex.finalCustomerPayableAmount : ex.total);
                          const isExSelected = selectedExchangeIds.includes(ex.id);

                          return (
                            <tr key={ex.id || idx} className="admin-history-row">
                              <td className="col-sub-select">
                                {!readOnly && (
                                  <input
                                    type="checkbox"
                                    checked={isExSelected}
                                    onChange={() => toggleSelectExchange(ex.id)}
                                    aria-label={`Sélectionner échange ${ex.exchangeNumber}`}
                                  />
                                )}
                              </td>
                              <td className="col-sub-date">
                                {ex.createdAt ? new Date(ex.createdAt).toLocaleString('fr-FR') : '—'}
                              </td>
                              <td className="col-sub-id">
                                <strong>Échange #{ex.exchangeSequence || idx + 1} — {ex.exchangeNumber}</strong>
                              </td>
                              <td className="col-sub-client">
                                {ex.customer?.name || `${ex.customer?.firstName || ''} ${ex.customer?.lastName || ''}`.trim() || '—'}
                              </td>
                              <td className="col-sub-phone">
                                {ex.customer?.phone || '—'}
                              </td>
                              <td className="col-sub-status">
                                <span className={`admin-status-badge ${ex.paymentResponsibility === 'silky_paid' ? 'confirmed' : 'exchanged'}`}>
                                  {ex.paymentResponsibility === 'silky_paid' ? 'Silky payé' : 'Client payé'}
                                </span>
                              </td>
                              <td className="col-sub-price">
                                <strong>{formatPrice(exPayable)}</strong>
                              </td>
                              <td className="col-sub-details">
                                <div className="admin-history-item-desc">
                                  <span>Total Échange: {formatPrice(ex.total)} (livraison: {formatPrice(ex.deliveryFee)})</span>
                                  {Number(ex.productAmountAdded) > 0 && (
                                    <span className="admin-exchange-diff-added" style={{ display: 'block' }}>
                                      Montant ajouté aux produits : {formatPrice(ex.productAmountAdded)}
                                    </span>
                                  )}
                                  {Number(ex.productRefundObligation) > 0 && (
                                    <span className="admin-exchange-diff-refund" style={{ display: 'block' }}>
                                      Remboursement produit dû au client : {formatPrice(ex.productRefundObligation)}
                                    </span>
                                  )}
                                  <ul className="admin-exchange-items">
                                    {ex.items?.map((item, itemIdx) => (
                                      <li key={itemIdx}>
                                        {item.name || item.productTitle} × {item.quantity} — {formatPrice((item.price || item.unitPrice || 0) * item.quantity)}
                                      </li>
                                    ))}
                                  </ul>
                                  {!readOnly && (
                                    <ParcelDeliveryLine
                                      record={ex}
                                      ariaLabel={`Colis GOODEX de l'échange ${ex.exchangeNumber}`}
                                      onRefresh={handleRefreshExchangeDelivery}
                                      onRetry={handleRetryExchangeDelivery}
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Historical Refunds */}
              {order.refunds && order.refunds.length > 0 && (
                <div className="admin-order-refunds-history">
                  <h4 className="admin-refunds-title">Historique des Remboursements ({order.refunds.length})</h4>
                  <div className="admin-history-subtable-wrap">
                    <table className="admin-history-subtable">
                      <thead>
                        <tr>
                          <th className="col-sub-select"></th>
                          <th className="col-sub-date">Date et Heure</th>
                          <th className="col-sub-id">ID Remboursement</th>
                          <th className="col-sub-client">Client</th>
                          <th className="col-sub-phone">Téléphone</th>
                          <th className="col-sub-status">Type</th>
                          <th className="col-sub-price">Montant à payer</th>
                          <th className="col-sub-details">Détails</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.refunds.map((ref, idx) => {
                          const isSilkyPaid = ref.paymentResponsibility === 'silky_paid' || Number(ref.deliveryFee) === 0;
                          const refPayable =
                            ref.customerAmountToPay !== undefined
                              ? ref.customerAmountToPay
                              : (ref.finalCustomerPayableAmount !== undefined ? ref.finalCustomerPayableAmount : 0);
                          const isRefSelected = selectedRefundIds.includes(ref.id);

                          return (
                            <tr key={ref.id || idx} className="admin-history-row">
                              <td className="col-sub-select">
                                {!readOnly && (
                                  <input
                                    type="checkbox"
                                    checked={isRefSelected}
                                    onChange={() => toggleSelectRefund(ref.id)}
                                    aria-label={`Sélectionner remboursement ${ref.refundNumber}`}
                                  />
                                )}
                              </td>
                              <td className="col-sub-date">
                                {ref.createdAt ? new Date(ref.createdAt).toLocaleString('fr-FR') : '—'}
                              </td>
                              <td className="col-sub-id">
                                <strong>Remboursement #{idx + 1} — {ref.refundNumber}</strong>
                              </td>
                              <td className="col-sub-client">
                                {ref.customer?.name || '—'}
                              </td>
                              <td className="col-sub-phone">
                                {ref.customer?.phone || '—'}
                              </td>
                              <td className="col-sub-status">
                                <span className={`admin-status-badge ${isSilkyPaid ? 'confirmed' : 'refunded'}`}>
                                  {isSilkyPaid ? 'Silky gratuit' : 'Client payé'}
                                </span>
                              </td>
                              <td className="col-sub-price">
                                <strong>{formatPrice(refPayable)}</strong>
                              </td>
                              <td className="col-sub-details">
                                <div className="admin-history-item-desc">
                                  <span>
                                    Montant remboursé: {formatPrice(ref.refundAmount)} (
                                    {isSilkyPaid
                                      ? 'Frais retour client: 0,000 TND — Silky absorbe 7,000 TND'
                                      : `Frais retour payés par client: ${formatPrice(ref.deliveryFee)}`}
                                    )
                                  </span>
                                  <ul className="admin-refund-items">
                                    {ref.items?.map((item, itemIdx) => (
                                      <li key={itemIdx}>
                                        {item.name || item.productTitle} × {item.quantity} — {formatPrice((item.price || item.unitPrice || 0) * item.quantity)}
                                      </li>
                                    ))}
                                  </ul>
                                  {!readOnly && (
                                    <ParcelDeliveryLine
                                      record={ref}
                                      ariaLabel={`Colis GOODEX du remboursement ${ref.refundNumber}`}
                                      onRefresh={handleRefreshRefundDelivery}
                                      onRetry={handleRetryRefundDelivery}
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
