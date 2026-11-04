import { eq, and, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { orderDeliveries, orderDeliveryEvents } from '../models/index.js';
import {
  GOODEX_NOT_FOUND_STATUS,
  normalizeGoodexStatus,
  RECONCILE_TERMINAL_STATUS_IDS,
  RECONCILE_ACTIVE_WINDOW_HOURS,
  RECONCILE_MID_WINDOW_DAYS,
  RECONCILE_MID_GAP_HOURS,
  RECONCILE_OLD_GAP_HOURS,
  RECONCILE_NOT_FOUND_FIRST_HOURS,
  RECONCILE_NOT_FOUND_DAY_GAP_HOURS,
  RECONCILE_NOT_FOUND_LATER_GAP_HOURS,
  RECONCILE_NOT_FOUND_GIVE_UP_DAYS,
} from '../config/goodex.js';

const STALE_CLAIM_MINUTES = 2;

function truncate(text, max = 500) {
  return text == null ? null : String(text).slice(0, max);
}

export const deliveryRepository = {
  /**
   * Existing parcels whose status is due for a background refresh (ordinary and exchange rows
   * alike, whatever the Silky order status). Read-only: it only selects, never creates or retries.
   * Selected: state created with a well-formed ean, not financially settled, younger than
   * maxAgeDays, and not "introuvable" for more than the give-up window. Due: never polled, or
   * last polled longer ago than the gap of its tier. Webhook activity does NOT postpone a poll,
   * so a stale webhook status is always reconciled. Oldest poll first, bounded by `limit`.
   * `excludeIds` lets the caller leave out parcels it is backing off from.
   */
  async findRefreshCandidates({ now = new Date(), limit = 50, baseGapMs, maxAgeDays = 60, excludeIds = [] }, tx = db) {
    const at = sql`${now.toISOString()}::timestamptz`;
    const baseSecs = Math.max(0, Math.floor((baseGapMs ?? 0) / 1000));
    const terminal = sql.join(RECONCILE_TERMINAL_STATUS_IDS.map((id) => sql`${id}`), sql`, `);
    const sinceChange = sql`(${at} - COALESCE(${orderDeliveries.statusUpdatedAt}, ${orderDeliveries.createdAt}))`;
    const sinceFlag = sql`(${at} - ${orderDeliveries.trackingNotFoundAt})`;
    const gap = sql`(CASE
      WHEN ${orderDeliveries.trackingNotFoundAt} IS NOT NULL THEN (CASE
        WHEN ${sinceFlag} < make_interval(hours => ${RECONCILE_NOT_FOUND_FIRST_HOURS}) THEN make_interval(secs => ${baseSecs})
        WHEN ${sinceFlag} < interval '1 day' THEN make_interval(hours => ${RECONCILE_NOT_FOUND_DAY_GAP_HOURS})
        ELSE make_interval(hours => ${RECONCILE_NOT_FOUND_LATER_GAP_HOURS}) END)
      WHEN ${sinceChange} < make_interval(hours => ${RECONCILE_ACTIVE_WINDOW_HOURS}) THEN make_interval(secs => ${baseSecs})
      WHEN ${sinceChange} < make_interval(days => ${RECONCILE_MID_WINDOW_DAYS}) THEN make_interval(hours => ${RECONCILE_MID_GAP_HOURS})
      ELSE make_interval(hours => ${RECONCILE_OLD_GAP_HOURS}) END)`;
    const excluded = excludeIds.length
      ? sql`AND ${orderDeliveries.id} NOT IN (${sql.join(excludeIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``;
    return tx.select().from(orderDeliveries)
      .where(sql`${orderDeliveries.state} = 'created' ${excluded}
        AND ${orderDeliveries.ean} ~ '^\\S{1,64}$'
        AND (${orderDeliveries.goodexStatusId} IS NULL OR ${orderDeliveries.goodexStatusId} NOT IN (${terminal}))
        AND ${orderDeliveries.createdAt} >= ${at} - make_interval(days => ${maxAgeDays})
        AND (${orderDeliveries.trackingNotFoundAt} IS NULL
             OR ${orderDeliveries.trackingNotFoundAt} >= ${at} - make_interval(days => ${RECONCILE_NOT_FOUND_GIVE_UP_DAYS}))
        AND (${orderDeliveries.lastPolledAt} IS NULL OR ${orderDeliveries.lastPolledAt} <= ${at} - ${gap})`)
      .orderBy(sql`${orderDeliveries.lastPolledAt} ASC NULLS FIRST`, orderDeliveries.id)
      .limit(limit);
  },

  /** The ordinary order parcel. Exchange and refund parcels are never returned here. */
  async findByOrderId(orderId, tx = db) {
    const [row] = await tx.select().from(orderDeliveries)
      .where(and(eq(orderDeliveries.orderId, orderId), isNull(orderDeliveries.exchangeId), isNull(orderDeliveries.refundId)));
    return row || null;
  },

  async findByExchangeId(exchangeId, tx = db) {
    const [row] = await tx.select().from(orderDeliveries).where(eq(orderDeliveries.exchangeId, exchangeId));
    return row || null;
  },

  async findByRefundId(refundId, tx = db) {
    const [row] = await tx.select().from(orderDeliveries).where(eq(orderDeliveries.refundId, refundId));
    return row || null;
  },

  async findByEan(ean, tx = db) {
    const [row] = await tx.select().from(orderDeliveries).where(eq(orderDeliveries.ean, ean));
    return row || null;
  },

  async findByOrderIds(orderIds, tx = db) {
    if (!orderIds.length) return [];
    return tx.select().from(orderDeliveries)
      .where(and(inArray(orderDeliveries.orderId, orderIds), isNull(orderDeliveries.exchangeId), isNull(orderDeliveries.refundId)));
  },

  /** Exchange parcels of the given orders. */
  async findExchangeRowsByOrderIds(orderIds, tx = db) {
    if (!orderIds.length) return [];
    return tx.select().from(orderDeliveries)
      .where(and(inArray(orderDeliveries.orderId, orderIds), isNotNull(orderDeliveries.exchangeId)));
  },

  /** Refund parcels of the given orders. */
  async findRefundRowsByOrderIds(orderIds, tx = db) {
    if (!orderIds.length) return [];
    return tx.select().from(orderDeliveries)
      .where(and(inArray(orderDeliveries.orderId, orderIds), isNotNull(orderDeliveries.refundId)));
  },

  /**
   * A claim that has been 'creating' for too long means the process died or the
   * outcome is unknown. There is no scheduler, so this is applied lazily on read.
   */
  async expireStaleClaims(orderIds, tx = db) {
    if (!orderIds.length) return;
    await tx.update(orderDeliveries)
      .set({
        state: 'unknown',
        lastError: 'Création du colis interrompue : résultat inconnu, vérifier chez GOODEX',
        updatedAt: new Date(),
      })
      .where(and(
        inArray(orderDeliveries.orderId, orderIds),
        eq(orderDeliveries.state, 'creating'),
        sql`${orderDeliveries.claimedAt} < NOW() - make_interval(mins => ${STALE_CLAIM_MINUTES})`,
      ));
  },

  /** Inserts the row in state 'creating'. Returns the row only for the single winner. */
  async claimNew(orderId, codAmount, tx = db) {
    const [row] = await tx.insert(orderDeliveries)
      .values({
        orderId,
        state: 'creating',
        codAmount: codAmount.toFixed(3),
        claimedAt: new Date(),
        attemptCount: 1,
      })
      .onConflictDoNothing({ target: orderDeliveries.orderId, where: sql`${orderDeliveries.exchangeId} IS NULL AND ${orderDeliveries.refundId} IS NULL` })
      .returning();
    return row || null;
  },

  /** Same claim for an exchange parcel: unique per exchange, so each exchange gets exactly one. */
  async claimExchange(orderId, exchangeId, codAmount, tx = db) {
    const [row] = await tx.insert(orderDeliveries)
      .values({
        orderId,
        exchangeId,
        state: 'creating',
        codAmount: codAmount.toFixed(3),
        claimedAt: new Date(),
        attemptCount: 1,
      })
      .onConflictDoNothing({ target: orderDeliveries.exchangeId, where: sql`${orderDeliveries.exchangeId} IS NOT NULL` })
      .returning();
    return row || null;
  },

  /** Same claim for a refund parcel: unique per refund, so each refund gets exactly one. */
  async claimRefund(orderId, refundId, codAmount, tx = db) {
    const [row] = await tx.insert(orderDeliveries)
      .values({
        orderId,
        refundId,
        state: 'creating',
        codAmount: codAmount.toFixed(3),
        claimedAt: new Date(),
        attemptCount: 1,
      })
      .onConflictDoNothing({ target: orderDeliveries.refundId, where: sql`${orderDeliveries.refundId} IS NOT NULL` })
      .returning();
    return row || null;
  },

  /** Atomically moves an existing row from one of `fromStates` back to 'creating'. */
  async reclaim(orderId, fromStates, codAmount, tx = db) {
    const [row] = await tx.update(orderDeliveries)
      .set({
        state: 'creating',
        claimedAt: new Date(),
        codAmount: codAmount.toFixed(3),
        attemptCount: sql`${orderDeliveries.attemptCount} + 1`,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(orderDeliveries.orderId, orderId),
        isNull(orderDeliveries.exchangeId),
        isNull(orderDeliveries.refundId),
        inArray(orderDeliveries.state, fromStates),
      ))
      .returning();
    return row || null;
  },

  async reclaimExchange(exchangeId, fromStates, codAmount, tx = db) {
    const [row] = await tx.update(orderDeliveries)
      .set({
        state: 'creating',
        claimedAt: new Date(),
        codAmount: codAmount.toFixed(3),
        attemptCount: sql`${orderDeliveries.attemptCount} + 1`,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(orderDeliveries.exchangeId, exchangeId), inArray(orderDeliveries.state, fromStates)))
      .returning();
    return row || null;
  },

  async reclaimRefund(refundId, fromStates, codAmount, tx = db) {
    const [row] = await tx.update(orderDeliveries)
      .set({
        state: 'creating',
        claimedAt: new Date(),
        codAmount: codAmount.toFixed(3),
        attemptCount: sql`${orderDeliveries.attemptCount} + 1`,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(orderDeliveries.refundId, refundId), inArray(orderDeliveries.state, fromStates)))
      .returning();
    return row || null;
  },

  /**
   * `details` comes from the create response: { status, parcelId, createdAt }.
   *  - status:    the initial status (`last_statut`) as { goodexStatus, goodexStatusId,
   *               deliveryStatus }, or null. Without it no status is invented.
   *  - parcelId / createdAt: GOODEX's internal id and creation time, when present.
   */
  async markCreated(id, ean, details = null, tx = db) {
    const now = new Date();
    const status = details?.status ?? null;
    const patch = { state: 'created', ean, lastError: null, updatedAt: now };
    if (details?.parcelId != null) patch.goodexParcelId = details.parcelId;
    if (details?.createdAt) patch.goodexCreatedAt = details.createdAt;
    if (status) {
      Object.assign(patch, {
        goodexStatus: status.goodexStatus,
        goodexStatusId: status.goodexStatusId,
        deliveryStatus: status.deliveryStatus,
        statusUpdatedAt: now,
        statusReceivedAt: now,
      });
    }
    const [row] = await tx.update(orderDeliveries).set(patch).where(eq(orderDeliveries.id, id)).returning();
    await tx.insert(orderDeliveryEvents).values({
      deliveryId: id,
      source: 'create',
      goodexStatus: status?.goodexStatus ?? null,
      goodexStatusId: status?.goodexStatusId ?? null,
      motif: null,
    });
    return row || null;
  },

  async markState(id, state, error, tx = db) {
    const [row] = await tx.update(orderDeliveries)
      .set({ state, lastError: truncate(error), updatedAt: new Date() })
      .where(eq(orderDeliveries.id, id))
      .returning();
    return row || null;
  },

  /** Inserts or replaces the row with a manually linked, admin-verified ean. */
  async linkEan(orderId, ean, codAmount, tx = db) {
    const now = new Date();
    const [row] = await tx.insert(orderDeliveries)
      .values({ orderId, state: 'created', ean, codAmount: codAmount.toFixed(3), claimedAt: now, attemptCount: 0 })
      .onConflictDoUpdate({
        target: orderDeliveries.orderId,
        targetWhere: sql`${orderDeliveries.exchangeId} IS NULL AND ${orderDeliveries.refundId} IS NULL`,
        set: { state: 'created', ean, lastError: null, updatedAt: now },
        setWhere: sql`${orderDeliveries.state} <> 'created'`,
      })
      .returning();
    if (row) {
      await tx.insert(orderDeliveryEvents).values({ deliveryId: row.id, source: 'create', goodexStatus: null, motif: null });
    }
    return row || null;
  },

  /**
   * Records what GOODEX reports for a parcel (webhook or tracking poll).
   *  - status:   { goodexStatus, goodexStatusId, deliveryStatus } or null
   *  - notFound: tracking answered "Colis Introuvable". Recorded apart; the saved status
   *              is left untouched so a transient/odd answer cannot erase valid data.
   *  - motif:    reason received now. Empty or missing means "none received", never
   *              "cleared": a stored reason is only ever replaced by a new non-empty one.
   *  - hasMotif: the provider's has_motif indicator (true/false) or null when not sent.
   *              It decides whether the stored reason is shown as an incident.
   * Returns { changed, row }. changed is false for duplicates (same status, no new
   * reason), so repeats never create events. A poll that started before the latest
   * webhook is discarded ({ skipped: 'newer_webhook' }): the webhook payload has no
   * timestamp, so arrival order is the only ordering signal available.
   */
  async applyStatus(id, { status = null, notFound = false, motif = null, hasMotif = null, source, requestedAt }, tx = db) {
    const [current] = await tx.select().from(orderDeliveries).where(eq(orderDeliveries.id, id)).for('update');
    if (!current) return { changed: false, row: null };

    if (source === 'poll' && requestedAt && current.lastWebhookAt && current.lastWebhookAt > requestedAt) {
      return { changed: false, row: current, skipped: 'newer_webhook' };
    }

    const now = new Date();
    const bookkeeping = source === 'webhook' ? { lastWebhookAt: now } : { lastPolledAt: now };

    if (notFound) {
      if (current.trackingNotFoundAt) {
        const [same] = await tx.update(orderDeliveries).set(bookkeeping).where(eq(orderDeliveries.id, id)).returning();
        return { changed: false, row: same };
      }
      const [row] = await tx.update(orderDeliveries)
        .set({ trackingNotFoundAt: now, updatedAt: now, ...bookkeeping })
        .where(eq(orderDeliveries.id, id))
        .returning();
      await tx.insert(orderDeliveryEvents).values({
        deliveryId: id, source, goodexStatus: GOODEX_NOT_FOUND_STATUS, goodexStatusId: null, motif: null,
      });
      return { changed: true, row };
    }

    const keyOf = (goodexStatusId, goodexStatus) => {
      if (goodexStatusId != null) return `id:${goodexStatusId}`;
      return goodexStatus ? `raw:${normalizeGoodexStatus(goodexStatus)}` : null;
    };
    const newMotif = typeof motif === 'string' && motif.trim() ? motif.trim() : null;
    const statusChanged = Boolean(status)
      && keyOf(status.goodexStatusId, status.goodexStatus) !== keyOf(current.goodexStatusId, current.goodexStatus);
    const motifChanged = Boolean(newMotif) && newMotif !== (current.motif || null);

    // has_motif as reported (true/false), or unknown (null) when the source does not carry
    // it, e.g. a webhook. An unflagged non-empty reason re-opens an incident that an earlier
    // explicit "false" had closed; the stored text itself is never erased.
    const reportedFlag = typeof hasMotif === 'boolean' ? hasMotif : null;
    let nextFlag = current.hasMotif ?? null;
    if (reportedFlag !== null) nextFlag = reportedFlag;
    else if (newMotif && nextFlag === false) nextFlag = null;
    const flagChanged = nextFlag !== (current.hasMotif ?? null);

    const patch = { ...bookkeeping };
    if (status) patch.statusReceivedAt = now; // a status was successfully received (changed or not)
    if (flagChanged) patch.hasMotif = nextFlag;
    if (current.trackingNotFoundAt) patch.trackingNotFoundAt = null; // the parcel is known again
    if (statusChanged) {
      Object.assign(patch, {
        goodexStatus: status.goodexStatus,
        goodexStatusId: status.goodexStatusId,
        deliveryStatus: status.deliveryStatus,
        statusUpdatedAt: now,
      });
    }
    if (motifChanged) Object.assign(patch, { motif: newMotif, motifUpdatedAt: now });
    if (statusChanged || motifChanged || flagChanged) patch.updatedAt = now;

    const [row] = await tx.update(orderDeliveries).set(patch).where(eq(orderDeliveries.id, id)).returning();
    if (!statusChanged && !motifChanged && !flagChanged) return { changed: false, row };

    await tx.insert(orderDeliveryEvents).values({
      deliveryId: id,
      source,
      goodexStatus: statusChanged ? status.goodexStatus : current.goodexStatus,
      goodexStatusId: statusChanged ? status.goodexStatusId : current.goodexStatusId,
      motif: newMotif,
    });
    return { changed: true, row };
  },
};
