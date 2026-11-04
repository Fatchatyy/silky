import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { orderClaims, orderDeliveries, orders } from '../models/index.js';

function isUniqueViolation(err) {
  return (err?.cause?.code || err?.code) === '23505';
}

/** Open/closed from the documented claim statuses; null when the status is not one of them. */
function openFromStatus(status) {
  if (status === 'nouveau' || status === 'en_cours') return true;
  if (status === 'resolu' || status === 'rejete') return false;
  return null;
}

export const claimRepository = {
  async findByOrderId(orderId, tx = db) {
    return tx.select().from(orderClaims).where(eq(orderClaims.orderId, orderId)).orderBy(desc(orderClaims.createdAt));
  },

  async findById(id, tx = db) {
    const [row] = await tx.select().from(orderClaims).where(eq(orderClaims.id, id));
    return row || null;
  },

  async findByGoodexId(goodexClaimId, tx = db) {
    const [row] = await tx.select().from(orderClaims).where(eq(orderClaims.goodexClaimId, goodexClaimId));
    return row || null;
  },

  /** Local copies of the given GOODEX claims (to give a remote list its Silky ids and cancelled flags). */
  async findByGoodexIds(goodexClaimIds, tx = db) {
    if (!goodexClaimIds.length) return [];
    return tx.select().from(orderClaims).where(inArray(orderClaims.goodexClaimId, goodexClaimIds));
  },

  async findOpenByOrderAndType(orderId, type, tx = db) {
    const [row] = await tx.select().from(orderClaims)
      .where(and(eq(orderClaims.orderId, orderId), eq(orderClaims.type, type), eq(orderClaims.isOpen, true), isNull(orderClaims.cancelledAt)))
      .orderBy(desc(orderClaims.createdAt))
      .limit(1);
    return row || null;
  },

  /**
   * Inserts or refreshes the local copy of a GOODEX claim, keyed by its GOODEX id. Fields the
   * provider did not send (the list/detail examples omit some) keep their stored value.
   */
  async upsertFromRemote({ orderId, ean, ticket, message = null, source = 'silky' }, tx = db) {
    const attempt = async () => {
      const existing = await this.findByGoodexId(ticket.goodexClaimId, tx);
      const now = new Date();
      const pick = (key) => ticket[key] ?? existing?.[key] ?? null;
      const status = pick('status');
      const fields = {
        reference: pick('reference'),
        type: pick('type'),
        typeLabel: pick('typeLabel'),
        valeur: pick('valeur'),
        status,
        priorite: pick('priorite'),
        isOpen: ticket.isOpen ?? openFromStatus(status) ?? existing?.isOpen ?? true,
        reponse: pick('reponse'),
        goodexCreatedAt: pick('createdAt') ?? existing?.goodexCreatedAt ?? null,
        resolvedAt: pick('resolvedAt'),
        lastSyncedAt: now,
        updatedAt: now,
      };
      if (existing) {
        const [row] = await tx.update(orderClaims)
          .set({ ...fields, message: existing.message ?? message })
          .where(eq(orderClaims.id, existing.id))
          .returning();
        return row;
      }
      const [row] = await tx.insert(orderClaims)
        .values({ orderId, ean, goodexClaimId: ticket.goodexClaimId, message, source, ...fields })
        .returning();
      return row;
    };
    try {
      return await attempt();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return attempt(); // a concurrent writer inserted it first: refresh that row instead
    }
  },

  async markCancelled(id, tx = db) {
    const now = new Date();
    const [row] = await tx.update(orderClaims)
      .set({ cancelledAt: now, isOpen: false, updatedAt: now })
      .where(eq(orderClaims.id, id))
      .returning();
    return row || null;
  },

  /** Maps parcel EANs back to Silky orders, to link a remote claim list to local orders. */
  async findOrdersByEans(eans, tx = db) {
    if (!eans.length) return [];
    return tx.select({ ean: orderDeliveries.ean, orderId: orders.id, orderNumber: orders.orderNumber })
      .from(orderDeliveries)
      .innerJoin(orders, eq(orders.id, orderDeliveries.orderId))
      .where(inArray(orderDeliveries.ean, eans));
  },
};
