import {
  pgTable,
  uuid,
  varchar,
  integer,
  smallint,
  bigint,
  boolean,
  numeric,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orders, orderExchanges, orderRefunds } from './orders.model.js';

export const orderDeliveries = pgTable(
  'order_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // One ordinary row per order (exchangeId and refundId NULL) plus one row per exchange
    // parcel and one per refund parcel.
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    exchangeId: uuid('exchange_id').references(() => orderExchanges.id, { onDelete: 'cascade' }),
    refundId: uuid('refund_id').references(() => orderRefunds.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).default('goodex').notNull(),
    state: varchar('state', { length: 16 }).default('creating').notNull(),
    ean: varchar('ean', { length: 64 }),
    codAmount: numeric('cod_amount', { precision: 10, scale: 3 }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').default(0).notNull(),
    lastError: text('last_error'),
    goodexStatus: varchar('goodex_status', { length: 100 }),
    // GOODEX's internal parcel id and creation time (raw text), from the create response.
    goodexParcelId: bigint('goodex_parcel_id', { mode: 'number' }),
    goodexCreatedAt: varchar('goodex_created_at', { length: 32 }),
    goodexStatusId: smallint('goodex_status_id'),
    deliveryStatus: varchar('delivery_status', { length: 32 }),
    motif: text('motif'),
    // has_motif as last reported by GOODEX: true / false, or null when never reported.
    hasMotif: boolean('has_motif'),
    motifUpdatedAt: timestamp('motif_updated_at', { withTimezone: true }),
    statusReceivedAt: timestamp('status_received_at', { withTimezone: true }),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
    lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    trackingNotFoundAt: timestamp('tracking_not_found_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_order_deliveries_order_ordinary')
      .on(table.orderId)
      .where(sql`${table.exchangeId} IS NULL AND ${table.refundId} IS NULL`),
    uniqueIndex('idx_order_deliveries_exchange')
      .on(table.exchangeId)
      .where(sql`${table.exchangeId} IS NOT NULL`),
    uniqueIndex('idx_order_deliveries_refund')
      .on(table.refundId)
      .where(sql`${table.refundId} IS NOT NULL`),
    check(
      'order_deliveries_one_owner',
      sql`${table.exchangeId} IS NULL OR ${table.refundId} IS NULL`
    ),
    uniqueIndex('idx_order_deliveries_ean')
      .on(table.ean)
      .where(sql`${table.ean} IS NOT NULL`),
    check(
      'order_deliveries_state_valid',
      sql`${table.state} IN ('creating', 'created', 'failed', 'unknown')`
    ),
    check(
      'order_deliveries_status_id_valid',
      sql`${table.goodexStatusId} IS NULL OR ${table.goodexStatusId} BETWEEN 1 AND 20`
    ),
  ]
);

export const orderDeliveryEvents = pgTable(
  'order_delivery_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => orderDeliveries.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 16 }).notNull(),
    goodexStatus: varchar('goodex_status', { length: 100 }),
    goodexStatusId: smallint('goodex_status_id'),
    motif: text('motif'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_order_delivery_events_delivery').on(table.deliveryId, table.createdAt),
  ]
);
