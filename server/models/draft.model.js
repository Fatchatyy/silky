import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { orders } from './orders.model.js';
import { productVariants } from './products.model.js';

// -----------------------------------------------------------------------------
// Drafts Table
// -----------------------------------------------------------------------------

export const drafts = pgTable(
  'drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    customerName: varchar('customer_name', {
      length: 255,
    }),

    phoneNumber: varchar('phone_number', {
      length: 32,
    }),

    customerEmail: varchar('customer_email', {
      length: 255,
    }),

    governorate: varchar('governorate', {
      length: 100,
    }),

    shippingAddress: text('shipping_address'),

    deliveryFee: numeric('delivery_fee', {
      precision: 10,
      scale: 3,
    }),

    notes: text('notes'),

    convertedAt: timestamp('converted_at', {
      withTimezone: true,
    }),

    convertedOrderId: uuid('converted_order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_drafts_converted_at').on(table.convertedAt),
    index('idx_drafts_updated_at').on(table.updatedAt),
    index('idx_drafts_converted_order_id')
      .on(table.convertedOrderId)
      .where(sql`${table.convertedOrderId} IS NOT NULL`),
  ]
);

// -----------------------------------------------------------------------------
// Draft Items Table
// -----------------------------------------------------------------------------

export const draftItems = pgTable(
  'draft_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    draftId: uuid('draft_id')
      .notNull()
      .references(() => drafts.id, {
        onDelete: 'cascade',
      }),

    variantId: uuid('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),

    productTitle: varchar('product_title', {
      length: 255,
    }),

    variantLabel: varchar('variant_label', {
      length: 255,
    }),

    imageUrl: text('image_url'),

    quantity: integer('quantity').default(1).notNull(),

    unitPrice: numeric('unit_price', {
      precision: 10,
      scale: 3,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_draft_items_draft_id').on(table.draftId),
    index('idx_draft_items_variant_id').on(table.variantId),
  ]
);

// -----------------------------------------------------------------------------
// Draft Conversions Table (Journal for State D cross-transaction recovery)
// -----------------------------------------------------------------------------

export const draftConversions = pgTable(
  'draft_conversions',
  {
    draftId: uuid('draft_id')
      .primaryKey(),

    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, {
        onDelete: 'cascade',
      }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  }
);

// -----------------------------------------------------------------------------
// Relations
// -----------------------------------------------------------------------------

export const draftsRelations = relations(drafts, ({ one, many }) => ({
  convertedOrder: one(orders, {
    fields: [drafts.convertedOrderId],
    references: [orders.id],
  }),
  items: many(draftItems),
}));

export const draftItemsRelations = relations(draftItems, ({ one }) => ({
  draft: one(drafts, {
    fields: [draftItems.draftId],
    references: [drafts.id],
  }),
  variant: one(productVariants, {
    fields: [draftItems.variantId],
    references: [productVariants.id],
  }),
}));
