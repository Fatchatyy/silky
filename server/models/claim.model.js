import {
  pgTable,
  uuid,
  varchar,
  bigint,
  boolean,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { orders } from './orders.model.js';

/**
 * Local copy of a GOODEX delivery claim (ticket) opened for an order's parcel, so an admin
 * can find and follow it up later. GOODEX stays the source of truth: rows are refreshed from
 * its API. GOODEX timestamps are kept as the raw text it sent (no time-zone assumptions).
 */
export const orderClaims = pgTable(
  'order_claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ean: varchar('ean', { length: 64 }).notNull(),
    goodexClaimId: bigint('goodex_claim_id', { mode: 'number' }).notNull().unique(),
    reference: varchar('reference', { length: 64 }),
    // The list/detail examples carry only type_label, so the code can be unknown.
    type: varchar('type', { length: 64 }),
    typeLabel: varchar('type_label', { length: 160 }),
    valeur: varchar('valeur', { length: 255 }),
    message: text('message'),
    status: varchar('status', { length: 32 }),
    priorite: varchar('priorite', { length: 32 }),
    isOpen: boolean('is_open').default(true).notNull(),
    reponse: text('reponse'),
    goodexCreatedAt: varchar('goodex_created_at', { length: 40 }),
    resolvedAt: varchar('resolved_at', { length: 40 }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    source: varchar('source', { length: 16 }).default('silky').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_order_claims_order').on(table.orderId, table.createdAt),
    index('idx_order_claims_ean').on(table.ean),
  ]
);
