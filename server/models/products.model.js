import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  smallint,
  boolean,
  timestamp,
  unique,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    name: varchar('name', { length: 100 }).notNull(),

    slug: varchar('slug', { length: 100 }).notNull().unique(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).defaultNow().notNull(),
  }
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    title: varchar('title', { length: 255 }).notNull(),

    slug: varchar('slug', { length: 255 }).notNull().unique(),

    description: text('description').default('').notNull(),

    titleAr: varchar('title_ar', { length: 255 }),

    descriptionAr: text('description_ar'),

    imageAlt: varchar('image_alt', { length: 255 }),

    imageAltAr: varchar('image_alt_ar', { length: 255 }),

    price: numeric('price', {
      precision: 10,
      scale: 3,
    }).notNull(),

    discountAmount: numeric('discount_amount', {
      precision: 10,
      scale: 3,
    }).default('0').notNull(),

    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, {
        onDelete: 'restrict',
      }),

    collectionImageUrl: text('collection_image_url'),

    isFeatured: boolean('is_featured')
      .default(false)
      .notNull(),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).defaultNow().notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_products_category_id').on(table.categoryId),

    index('idx_products_is_featured')
      .on(table.isFeatured)
      .where(sql`${table.isFeatured} = true`),

    index('idx_products_is_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),

    check(
      'products_price_non_negative',
      sql`${table.price} >= 0`
    ),

    check(
      'products_discount_non_negative',
      sql`${table.discountAmount} >= 0`
    ),

    check(
      'products_discount_not_greater_than_price',
      sql`${table.discountAmount} <= ${table.price}`
    ),
  ]
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, {
        onDelete: 'cascade',
      }),

    size: varchar('size', {
      length: 16,
    }).notNull(),

    colorSlug: varchar('color_slug', {
      length: 64,
    }).notNull(),

    colorName: varchar('color_name', {
      length: 64,
    }).notNull(),

    colorNameAr: varchar('color_name_ar', {
      length: 64,
    }),

    colorImageUrl: text('color_image_url'),

    // Place of the variant in its product's list (see db/migrations/add_variant_position.js). NULL = not set yet.
    position: integer('position'),

    stockQuantity: integer('stock_quantity')
      .default(0)
      .notNull(),

    sku: varchar('sku', {
      length: 128,
    }).notNull().unique(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).defaultNow().notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_product_variants_product_size_color').on(
      table.productId,
      table.size,
      table.colorSlug
    ),

    index('idx_product_variants_product_id').on(
      table.productId
    ),

    check(
      'product_variants_stock_non_negative',
      sql`${table.stockQuantity} >= 0`
    ),
  ]
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, {
        onDelete: 'cascade',
      }),

    imageUrl: text('image_url').notNull(),

    colorSlug: varchar('color_slug', {
      length: 64,
    }),

    sortOrder: smallint('sort_order')
      .default(0)
      .notNull(),

    isPrimary: boolean('is_primary')
      .default(false)
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_product_images_product_id').on(
      table.productId
    ),

    uniqueIndex('idx_product_images_one_primary')
      .on(table.productId)
      .where(sql`${table.isPrimary} = true`),
  ]
);

export const productVideos = pgTable(
  'product_videos',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, {
        onDelete: 'cascade',
      }),

    videoUrl: text('video_url').notNull(),

    sortOrder: smallint('sort_order')
      .default(0)
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_product_videos_product_id').on(
      table.productId
    ),
    index('idx_product_videos_sort_order').on(
      table.productId,
      table.sortOrder,
      table.createdAt
    ),
  ]
);

// -----------------------------------------------------------------------------
// Relations
// -----------------------------------------------------------------------------

export const categoriesRelations = relations(
  categories,
  ({ many }) => ({
    products: many(products),
  })
);

export const productsRelations = relations(
  products,
  ({ one, many }) => ({
    category: one(categories, {
      fields: [products.categoryId],
      references: [categories.id],
    }),

    variants: many(productVariants),

    images: many(productImages),

    videos: many(productVideos),
  })
);

export const productVariantsRelations = relations(
  productVariants,
  ({ one }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
  })
);

export const productImagesRelations = relations(
  productImages,
  ({ one }) => ({
    product: one(products, {
      fields: [productImages.productId],
      references: [products.id],
    }),
  })
);

export const productVideosRelations = relations(
  productVideos,
  ({ one }) => ({
    product: one(products, {
      fields: [productVideos.productId],
      references: [products.id],
    }),
  })
);