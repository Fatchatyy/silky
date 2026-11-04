import {
    eq,
    and,
    or,
    ilike,
    inArray,
    sql,
    desc,
    asc,
} from 'drizzle-orm';

import { db } from '../db/orm.js';

import {
    products,
    productVariants,
    productImages,
    productVideos,
    categories,
    orderItems,
    exchangeItems,
    refundItems,
    reviewGallery,
    siteSettings,
    draftItems,
} from '../models/index.js';

/**
 * Stock key used by the frontend.
 *
 * Frontend expects:
 *
 *     black-S
 *     black-M
 *     black-L
 *
 *     red-S
 *     red-M
 *
 * If only color exists:
 *
 *     black
 *
 * If only size exists:
 *
 *     M
 *
 * Otherwise:
 *
 *     default
 */
export function getStockKey(colorId, size) {
    if (colorId && size) {
        return `${colorId}-${size}`;
    }

    if (colorId) {
        return colorId;
    }

    if (size) {
        return size;
    }

    return 'default';
}

/** Columns of a product row (with its category) that buildProductResponse needs. */
const PRODUCT_COLUMNS = {
    id: products.id,
    title: products.title,
    slug: products.slug,
    description: products.description,
    titleAr: products.titleAr,
    descriptionAr: products.descriptionAr,
    imageAlt: products.imageAlt,
    imageAltAr: products.imageAltAr,
    price: products.price,
    discountAmount: products.discountAmount,
    categoryId: products.categoryId,
    categoryName: categories.name,
    categorySlug: categories.slug,
    collectionImageUrl: products.collectionImageUrl,
    isFeatured: products.isFeatured,
    isActive: products.isActive,
    createdAt: products.createdAt,
    updatedAt: products.updatedAt,
};

/**
 * Turns a product row with its variants, images and videos into the response the storefront and the admin
 * expect. Shared by findById (one product) and findAll (the whole list, loaded in a few queries).
 */
function buildProductResponse(product, variants, images, videos) {
    const colorMap = new Map();
    const sizeSet = new Set();
    const stock = {};

    for (const variant of variants) {
        if (variant.size) {
            sizeSet.add(
                variant.size
            );
        }

        const stockKey =
            getStockKey(
                variant.colorSlug,
                variant.size
            );

        stock[stockKey] =
            Number(
                variant.stockQuantity
            ) || 0;
    }

    /*
     * Sort images by sortOrder explicitly.
     */
    const sortedImages =
        [...images].sort(
            (a, b) =>
                (a.sortOrder ?? 0) -
                (b.sortOrder ?? 0)
        );

    /*
     * Populate colorMap in explicit sortOrder appearance order from images.
     */
    for (const image of sortedImages) {
        if (!image.colorSlug) {
            continue;
        }

        const colorSlug =
            image.colorSlug;

        if (
            !colorMap.has(
                colorSlug
            )
        ) {
            const variantForColor = variants.find(
                (v) => v.colorSlug === colorSlug
            );
            colorMap.set(
                colorSlug,
                {
                    id: colorSlug,
                    name:
                        variantForColor?.colorName ||
                        colorSlug
                            .charAt(0)
                            .toUpperCase() +
                        colorSlug.slice(1),
                    nameAr:
                        variantForColor?.colorNameAr ||
                        null,
                    image:
                        image.imageUrl,
                    thumbnail:
                        image.imageUrl,
                    gallery: [],
                    images: [image.imageUrl],
                }
            );
        } else {
            const color =
                colorMap.get(
                    colorSlug
                );

            color.images.push(
                image.imageUrl
            );
            color.gallery.push(
                image.imageUrl
            );
        }
    }

    /*
     * Add any variants whose colorSlug was not in productImages (fallback / backward compat).
     */
    for (const variant of variants) {
        if (
            variant.colorSlug &&
            !colorMap.has(
                variant.colorSlug
            )
        ) {
            const thumb =
                variant.colorImageUrl ||
                product.collectionImageUrl ||
                '';
            colorMap.set(
                variant.colorSlug,
                {
                    id:
                        variant.colorSlug,
                    name:
                        variant.colorName ||
                        variant.colorSlug,
                    nameAr:
                        variant.colorNameAr ||
                        null,
                    image: thumb,
                    thumbnail: thumb,
                    gallery: [],
                    images: thumb ? [thumb] : [],
                }
            );
        }
    }

    /*
     * Ensure color.thumbnail and color.image are consistently the first image.
     */
    for (
        const color
        of colorMap.values()
    ) {
        if (color.images.length) {
            color.image =
                color.images[0];
            color.thumbnail =
                color.images[0];
            color.gallery =
                color.images.slice(1);
        } else if (color.image) {
            color.thumbnail =
                color.image;
            color.images.push(
                color.image
            );
            color.gallery = [];
        }
    }

    /*
     * Primary image.
     */
    const primaryImage =
        sortedImages.find(
            image =>
                image.isPrimary
        ) ||
        sortedImages[0];

    const allImageUrls =
        sortedImages.map(
            image =>
                image.imageUrl
        );

    /*
     * IMPORTANT:
     *
     * Preserve the existing frontend
     * response contract.
     */

    return {
        id:
            product.id,

        name:
            product.title,

        slug:
            product.slug,

        description:
            product.description,

        nameAr:
            product.titleAr || null,

        descriptionAr:
            product.descriptionAr || null,

        imageAlt:
            product.imageAlt || null,

        imageAltAr:
            product.imageAltAr || null,

        price:
            parseFloat(
                product.price
            ),

        discount:
            parseFloat(
                product.discountAmount ||
                0
            ),

        category:
            product.categorySlug,

        categoryId:
            product.categoryId,

        mainImage:
            primaryImage?.imageUrl ||
            product.collectionImageUrl ||
            '',

        thumbnails:
            allImageUrls.length
                ? allImageUrls
                : [
                    product.collectionImageUrl,
                ].filter(Boolean),

        colors:
            [...colorMap.values()],

        sizes:
            [...sizeSet],

        variants: variants.map((v) => ({
            id: v.id,
            size: v.size,
            colorSlug: v.colorSlug,
            colorName: v.colorName,
            colorNameAr: v.colorNameAr || null,
            colorImageUrl: v.colorImageUrl,
            stockQuantity: Number(v.stockQuantity) || 0,
            sku: v.sku,
        })),

        videos: videos.map((v) => ({
            id: v.id,
            productId: v.productId,
            videoUrl: v.videoUrl,
            sortOrder: v.sortOrder,
            createdAt: v.createdAt,
        })),

        stock,

        collectionImage:
            product.collectionImageUrl ||
            primaryImage?.imageUrl ||
            '',

        isHidden:
            product.isActive === false,

        is_active:
            Boolean(
                product.isActive
            ),

        isFeatured:
            Boolean(
                product.isFeatured
            ),
    };
}

export const productRepository = {
    /* =====================================================
       CATEGORIES
       ===================================================== */

    async findCategoryBySlug(slug, tx = db) {
        if (!slug) {
            return null;
        }

        const [category] = await tx
            .select()
            .from(categories)
            .where(eq(categories.slug, slug));

        return category || null;
    },

    /* =====================================================
       SITEMAP (published data only, no per-product queries)
       ===================================================== */

    async listPublishedProductStamps(tx = db) {
        return tx
            .select({
                id: products.id,
                slug: products.slug,
                updatedAt: products.updatedAt,
                titleAr: products.titleAr,
                descriptionAr: products.descriptionAr,
            })
            .from(products)
            .where(eq(products.isActive, true))
            .orderBy(asc(products.createdAt));
    },

    /**
     * What a product card needs, for the published products, newest first: ONE query (no variants, images or reviews are
     * loaded; the main photo and the sold-out flag are sub-selects). Used by the storefront's home and collection pages
     * and the recommendations of a product page, instead of the full product list.
     * mainImage / collectionImage follow buildProductResponse: the primary photo (else the first by sort order), the
     * collection photo set by the admin (else the primary photo). soldOut is true when the product has variants and every
     * one of them is out of stock (the rule of shared/stock.js isProductOutOfStock).
     */
    async listPublishedProductSummaries({ categorySlug = null, limit = 100 } = {}, tx = db) {
        const conditions = [eq(products.isActive, true)];
        if (categorySlug) conditions.push(eq(categories.slug, categorySlug));
        const rows = await tx
            .select({
                id: products.id,
                slug: products.slug,
                title: products.title,
                titleAr: products.titleAr,
                imageAlt: products.imageAlt,
                imageAltAr: products.imageAltAr,
                price: products.price,
                discountAmount: products.discountAmount,
                category: categories.slug,
                collectionImageUrl: products.collectionImageUrl,
                primaryImageUrl: sql`(
                    SELECT pi.image_url FROM product_images pi
                    WHERE pi.product_id = ${products.id}
                    ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
                    LIMIT 1
                )`,
                soldOut: sql`COALESCE((
                    SELECT bool_and(COALESCE(pv.stock_quantity, 0) <= 0) FROM product_variants pv
                    WHERE pv.product_id = ${products.id}
                ), false)`,
            })
            .from(products)
            .innerJoin(categories, eq(products.categoryId, categories.id))
            .where(and(...conditions))
            .orderBy(desc(products.createdAt))
            .limit(Math.min(Math.max(Number(limit) || 100, 1), 300));
        return rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.title,
            nameAr: row.titleAr || null,
            imageAlt: row.imageAlt || null,
            imageAltAr: row.imageAltAr || null,
            price: parseFloat(row.price),
            discount: parseFloat(row.discountAmount || 0),
            category: row.category,
            mainImage: row.primaryImageUrl || row.collectionImageUrl || '',
            collectionImage: row.collectionImageUrl || row.primaryImageUrl || '',
            soldOut: row.soldOut === true,
        }));
    },

    async listCategorySlugsWithPublishedProducts(tx = db) {
        return tx
            .selectDistinct({ slug: categories.slug })
            .from(categories)
            .innerJoin(products, eq(products.categoryId, categories.id))
            .where(eq(products.isActive, true))
            .orderBy(asc(categories.slug));
    },

    /* =====================================================
       PRODUCTS - READ
       ===================================================== */

    /**
     * Every product (published ones only unless `includeHidden`), newest first, shaped exactly as findById returns
     * them but loaded in four queries (products, variants, images, videos) instead of four per product.
     */
    async findAll(
        { includeHidden = false } = {},
        tx = db
    ) {
        const rows = await tx
            .select(PRODUCT_COLUMNS)
            .from(products)
            .leftJoin(categories, eq(products.categoryId, categories.id))
            .where(includeHidden ? undefined : eq(products.isActive, true))
            .orderBy(desc(products.createdAt));

        if (!rows.length) {
            return [];
        }

        const ids = rows.map((row) => row.id);

        // No ORDER BY here on purpose. findById sorts one product's rows in the database; rows that still tie (images
        // with the same sort_order, variants saved before positions existed) come out in the order the database
        // returns them. Reading everything unsorted, grouping per product and sorting with a stable sort gives each
        // product that same order, where one big ORDER BY would shuffle tied rows differently.
        const [variantRows, imageRows, videoRows] = await Promise.all([
            tx.select().from(productVariants).where(inArray(productVariants.productId, ids)),
            tx.select().from(productImages).where(inArray(productImages.productId, ids)),
            tx.select().from(productVideos).where(inArray(productVideos.productId, ids)),
        ]);

        // NULLs sort last, as in an ascending ORDER BY.
        const rank = (value) => {
            if (value === null || value === undefined) {
                return Infinity;
            }
            return typeof value === 'number' ? value : new Date(value).getTime();
        };
        const compareBy = (...keys) => (a, b) => {
            for (const key of keys) {
                const x = rank(a[key]);
                const y = rank(b[key]);
                if (x < y) {
                    return -1;
                }
                if (x > y) {
                    return 1;
                }
            }
            return 0;
        };
        const groupByProduct = (list, compare) => {
            const map = new Map();
            for (const item of list) {
                if (!map.has(item.productId)) {
                    map.set(item.productId, []);
                }
                map.get(item.productId).push(item);
            }
            for (const group of map.values()) {
                group.sort(compare);
            }
            return map;
        };
        const variantsBy = groupByProduct(variantRows, compareBy('position', 'createdAt'));
        const imagesBy = groupByProduct(imageRows, compareBy('sortOrder'));
        const videosBy = groupByProduct(videoRows, compareBy('sortOrder', 'createdAt'));

        return rows.map((row) =>
            buildProductResponse(
                row,
                variantsBy.get(row.id) || [],
                imagesBy.get(row.id) || [],
                videosBy.get(row.id) || []
            )
        );
    },

    async listPaginated(
        {
            category,
            search,
            page = 1,
            limit = 24,
            includeHidden = false,
        } = {},
        tx = db
    ) {
        const safePage = Math.max(
            Number(page) || 1,
            1
        );

        const safeLimit = Math.min(
            Math.max(
                Number(limit) || 24,
                1
            ),
            100
        );

        const offset =
            (safePage - 1) *
            safeLimit;

        const conditions = [];

        if (!includeHidden) {
            conditions.push(
                eq(products.isActive, true)
            );
        }

        if (category) {
            const cat =
                await this.findCategoryBySlug(
                    category,
                    tx
                );

            if (!cat) {
                return {
                    products: [],
                    pagination: {
                        total: 0,
                        page: safePage,
                        limit: safeLimit,
                        totalPages: 0,
                    },
                };
            }

            conditions.push(
                eq(
                    products.categoryId,
                    cat.id
                )
            );
        }

        if (search) {
            const searchPattern =
                `%${search.trim()}%`;

            conditions.push(
                or(
                    ilike(
                        products.title,
                        searchPattern
                    ),
                    ilike(
                        products.description,
                        searchPattern
                    ),
                    ilike(
                        products.titleAr,
                        searchPattern
                    ),
                    ilike(
                        products.descriptionAr,
                        searchPattern
                    )
                )
            );
        }

        const whereClause =
            conditions.length
                ? and(...conditions)
                : undefined;

        const [{ count }] =
            await tx
                .select({
                    count: sql`count(*)`,
                })
                .from(products)
                .where(whereClause);

        const total =
            parseInt(
                count || '0',
                10
            );

        const rows =
            await tx
                .select()
                .from(products)
                .where(whereClause)
                .orderBy(
                    desc(products.createdAt)
                )
                .limit(safeLimit)
                .offset(offset);

        const productList = [];

        for (const product of rows) {
            const full =
                await this.findById(
                    product.id,
                    tx
                );

            if (full) {
                productList.push(full);
            }
        }

        const totalPages =
            Math.ceil(
                total / safeLimit
            );

        return {
            products: productList,

            pagination: {
                total,
                page: safePage,
                limit: safeLimit,
                totalPages,
            },
        };
    },

    /* =====================================================
       PRODUCT BY ID
       ===================================================== */

    async findById(id, tx = db) {
        if (!id) {
            return null;
        }

        const [product] =
            await tx
                .select(PRODUCT_COLUMNS)
                .from(products)
                .leftJoin(
                    categories,
                    eq(
                        products.categoryId,
                        categories.id
                    )
                )
                .where(
                    eq(products.id, id)
                );

        if (!product) {
            return null;
        }

        const variants =
            await tx
                .select()
                .from(productVariants)
                .where(
                    eq(
                        productVariants.productId,
                        id
                    )
                )
                .orderBy(
                    asc(productVariants.position),
                    asc(productVariants.createdAt)
                );

        const images =
            await tx
                .select()
                .from(productImages)
                .where(
                    eq(
                        productImages.productId,
                        id
                    )
                )
                .orderBy(
                    asc(productImages.sortOrder)
                );

        const videos =
            await tx
                .select()
                .from(productVideos)
                .where(
                    eq(
                        productVideos.productId,
                        id
                    )
                )
                .orderBy(
                    asc(productVideos.sortOrder),
                    asc(productVideos.createdAt)
                );

        return buildProductResponse(product, variants, images, videos);
    },

    /* =====================================================
       PRODUCT BY SLUG
       ===================================================== */

    async findBySlug(
        slug,
        tx = db
    ) {
        if (!slug) {
            return null;
        }

        const [product] =
            await tx
                .select({
                    id: products.id,
                })
                .from(products)
                .where(
                    eq(
                        products.slug,
                        slug
                    )
                );

        if (!product) {
            return null;
        }

        return this.findById(
            product.id,
            tx
        );
    },

    /* =====================================================
       VARIANTS
       ===================================================== */

    async findVariantById(
        variantId,
        tx = db
    ) {
        if (!variantId) {
            return null;
        }

        const [variant] =
            await tx
                .select()
                .from(productVariants)
                .where(
                    eq(
                        productVariants.id,
                        variantId
                    )
                );

        return variant || null;
    },

    async findVariantForOrderItem(
        productId,
        colorId,
        size,
        tx = db
    ) {
        if (!productId || !size) {
            return null;
        }

        const conditions = [
            eq(
                productVariants.productId,
                productId
            ),

            eq(
                productVariants.size,
                size
            ),
        ];

        if (colorId) {
            conditions.push(
                eq(
                    productVariants.colorSlug,
                    colorId
                )
            );
        }

        const [variant] =
            await tx
                .select()
                .from(productVariants)
                .where(
                    and(...conditions)
                );

        return variant || null;
    },

    async lockVariantsForUpdate(
        variantIds,
        tx = db
    ) {
        if (
            !variantIds ||
            variantIds.length === 0
        ) {
            return [];
        }

        return tx
            .select()
            .from(productVariants)
            .where(
                inArray(
                    productVariants.id,
                    variantIds
                )
            )
            .for('update');
    },

    async updateVariantStock(
        variantId,
        stockQuantity,
        tx = db
    ) {
        const [updated] =
            await tx
                .update(productVariants)
                .set({
                    stockQuantity,
                    updatedAt:
                        new Date(),
                })
                .where(
                    eq(
                        productVariants.id,
                        variantId
                    )
                )
                .returning();

        return updated || null;
    },

    /* =====================================================
       PRODUCTS - CREATE
       ===================================================== */

    async createProduct(
        {
            title,
            slug,
            description = '',
            titleAr = null,
            descriptionAr = null,
            imageAlt = null,
            imageAltAr = null,
            price,
            discountAmount = 0,
            categoryId,
            collectionImageUrl = null,
            isFeatured = false,
            isActive = true,
            variants = [],
            images = [],
        },
        tx = db
    ) {
        const [product] =
            await tx
                .insert(products)
                .values({
                    title,
                    slug,
                    description,
                    titleAr,
                    descriptionAr,
                    imageAlt,
                    imageAltAr,
                    price:
                        price.toString(),
                    discountAmount:
                        discountAmount.toString(),
                    categoryId,
                    collectionImageUrl,
                    isFeatured,
                    isActive,
                })
                .returning();

        /*
         * Insert variants.
         */

        for (const [position, variant] of variants.entries()) {
            await tx
                .insert(productVariants)
                .values({
                    productId:
                        product.id,

                    position,

                    size:
                        variant.size,

                    colorSlug:
                        variant.colorSlug ||
                        variant.colorId,

                    colorName:
                        variant.colorName ||
                        variant.colorSlug ||
                        variant.colorId,

                    colorNameAr:
                        variant.colorNameAr ||
                        null,

                    colorImageUrl:
                        variant.colorImageUrl ||
                        null,

                    stockQuantity:
                        variant.stockQuantity ??
                        variant.stock ??
                        0,

                    sku:
                        variant.sku ||
                        `${slug}-${variant.size || 'default'}-${variant.colorSlug || variant.colorId}`
                            .toUpperCase(),
                });
        }

        /*
         * Insert images.
         */

        for (
            let i = 0;
            i < images.length;
            i++
        ) {
            const image =
                images[i];

            await tx
                .insert(productImages)
                .values({
                    productId:
                        product.id,

                    imageUrl:
                        typeof image === 'string'
                            ? image
                            : image.imageUrl,

                    colorSlug:
                        typeof image === 'object'
                            ? image.colorSlug
                            : null,

                    sortOrder:
                        typeof image === 'object' &&
                        image.sortOrder !== undefined
                            ? image.sortOrder
                            : i,

                    isPrimary:
                        typeof image === 'object'
                            ? Boolean(
                                image.isPrimary
                            )
                            : i === 0,
                });
        }

        return this.findById(
            product.id,
            tx
        );
    },

    /* =====================================================
       PRODUCTS - UPDATE
       ===================================================== */

    async updateProduct(
        id,
        payload,
        tx = db
    ) {
        const updateFields = {};

        if (
            payload.title !== undefined
        ) {
            updateFields.title =
                payload.title;
        }

        if (
            payload.slug !== undefined
        ) {
            updateFields.slug =
                payload.slug;
        }

        if (
            payload.description !== undefined
        ) {
            updateFields.description =
                payload.description;
        }

        if (
            payload.titleAr !== undefined
        ) {
            updateFields.titleAr =
                payload.titleAr;
        }

        if (
            payload.descriptionAr !== undefined
        ) {
            updateFields.descriptionAr =
                payload.descriptionAr;
        }

        if (
            payload.imageAlt !== undefined
        ) {
            updateFields.imageAlt =
                payload.imageAlt;
        }

        if (
            payload.imageAltAr !== undefined
        ) {
            updateFields.imageAltAr =
                payload.imageAltAr;
        }

        if (
            payload.price !== undefined
        ) {
            updateFields.price =
                payload.price.toString();
        }

        if (
            payload.discountAmount !== undefined
        ) {
            updateFields.discountAmount =
                payload.discountAmount.toString();
        }

        if (
            payload.categoryId !== undefined
        ) {
            updateFields.categoryId =
                payload.categoryId;
        }

        if (
            payload.collectionImageUrl !== undefined
        ) {
            updateFields.collectionImageUrl =
                payload.collectionImageUrl;
        }

        if (
            payload.isFeatured !== undefined
        ) {
            updateFields.isFeatured =
                payload.isFeatured;
        }

        if (
            payload.isActive !== undefined
        ) {
            updateFields.isActive =
                payload.isActive;
        }

        updateFields.updatedAt =
            new Date();

        if (
            Object.keys(updateFields)
                .length > 0
        ) {
            await tx
                .update(products)
                .set(updateFields)
                .where(
                    eq(
                        products.id,
                        id
                    )
                );
        }

        /*
         * Granular variant reconciliation if variants is explicitly provided.
         * If payload.variants === undefined, variants are untouched.
         */

        if (
            payload.variants !== undefined &&
            Array.isArray(payload.variants)
        ) {
            const existingVariants = await tx
                .select()
                .from(productVariants)
                .where(
                    eq(
                        productVariants.productId,
                        id
                    )
                );

            const existingByKey = new Map();
            const existingById = new Map();

            for (const ev of existingVariants) {
                const normSize = String(ev.size ?? '').trim();
                const normColor = String(ev.colorSlug ?? '').trim();
                existingByKey.set(`${normColor}::${normSize}`, ev);
                existingById.set(ev.id, ev);
            }

            const currentProductSlug =
                payload.slug ||
                (
                    await tx
                        .select({ slug: products.slug })
                        .from(products)
                        .where(eq(products.id, id))
                )[0]?.slug ||
                id;

            const matchedExistingIds = new Set();

            for (const [position, variant] of payload.variants.entries()) {
                const size = String(variant.size ?? '').trim();
                const colorSlug = String(
                    variant.colorSlug || variant.colorId || ''
                ).trim();
                const colorName =
                    variant.colorName ||
                    variant.colorSlug ||
                    variant.colorId ||
                    colorSlug;
                const colorNameAr =
                    variant.colorNameAr || null;
                const colorImageUrl =
                    variant.colorImageUrl || null;
                const stockQuantity = Number.isFinite(
                    Number(variant.stockQuantity ?? variant.stock)
                )
                    ? Math.max(
                          0,
                          Number(variant.stockQuantity ?? variant.stock)
                      )
                    : 0;
                const sku =
                    variant.sku ||
                    `${currentProductSlug}-${size || 'default'}-${colorSlug}`.toUpperCase();

                const key = `${colorSlug}::${size}`;
                const matchedVariant =
                    (variant.id && existingById.get(variant.id)) ||
                    existingByKey.get(key);

                if (matchedVariant) {
                    matchedExistingIds.add(matchedVariant.id);

                    const hasChanges =
                        matchedVariant.position !== position ||
                        matchedVariant.size !== size ||
                        matchedVariant.colorSlug !== colorSlug ||
                        matchedVariant.colorName !== colorName ||
                        (matchedVariant.colorNameAr || null) !== colorNameAr ||
                        (matchedVariant.colorImageUrl || null) !== colorImageUrl ||
                        Number(matchedVariant.stockQuantity) !== stockQuantity ||
                        matchedVariant.sku !== sku;

                    if (hasChanges) {
                        await tx
                            .update(productVariants)
                            .set({
                                position,
                                size,
                                colorSlug,
                                colorName,
                                colorNameAr,
                                colorImageUrl,
                                stockQuantity,
                                sku,
                                updatedAt: new Date(),
                            })
                            .where(
                                eq(
                                    productVariants.id,
                                    matchedVariant.id
                                )
                            );
                    }
                } else {
                    await tx
                        .insert(productVariants)
                        .values({
                            productId: id,
                            position,
                            size,
                            colorSlug,
                            colorName,
                            colorNameAr,
                            colorImageUrl,
                            stockQuantity,
                            sku,
                        });
                }
            }

            const toDeleteIds = existingVariants
                .filter((ev) => !matchedExistingIds.has(ev.id))
                .map((ev) => ev.id);

            if (toDeleteIds.length > 0) {
                await tx
                    .delete(productVariants)
                    .where(
                        inArray(
                            productVariants.id,
                            toDeleteIds
                        )
                    );
            }
        }

        /*
         * Granular image reconciliation if images is explicitly provided.
         * If payload.images === undefined, images are untouched.
         */

        if (
            payload.images !== undefined &&
            Array.isArray(payload.images)
        ) {
            await tx
                .delete(productImages)
                .where(
                    eq(
                        productImages.productId,
                        id
                    )
                );

            for (
                let i = 0;
                i < payload.images.length;
                i++
            ) {
                const image =
                    payload.images[i];

                await tx
                    .insert(productImages)
                    .values({
                        productId:
                            id,

                        imageUrl:
                            typeof image === 'string'
                                ? image
                                : image.imageUrl,

                        colorSlug:
                            typeof image === 'object'
                                ? image.colorSlug
                                : null,

                        sortOrder:
                            typeof image === 'object' &&
                            image.sortOrder !== undefined
                                ? image.sortOrder
                                : i,

                        isPrimary:
                            typeof image === 'object'
                                ? Boolean(
                                    image.isPrimary
                                )
                                : i === 0,
                    });
            }
        }

        return this.findById(
            id,
            tx
        );
    },

    /* =====================================================
       VIDEOS
       ===================================================== */

    async findVideosByProductId(productId, tx = db) {
        if (!productId) return [];
        return tx
            .select()
            .from(productVideos)
            .where(eq(productVideos.productId, productId))
            .orderBy(asc(productVideos.sortOrder), asc(productVideos.createdAt));
    },

    async findProductVideo(videoId, tx = db) {
        if (!videoId) return null;
        const [video] = await tx
            .select()
            .from(productVideos)
            .where(eq(productVideos.id, videoId));
        return video || null;
    },

    async addProductVideo({ productId, videoUrl, sortOrder = null }, tx = db) {
        if (!productId || !videoUrl) return null;

        let finalSortOrder = sortOrder;
        if (finalSortOrder === null || finalSortOrder === undefined) {
            const [maxRow] = await tx
                .select({ maxOrder: sql`COALESCE(MAX(${productVideos.sortOrder}), -1)` })
                .from(productVideos)
                .where(eq(productVideos.productId, productId));
            finalSortOrder = (Number(maxRow?.maxOrder) ?? -1) + 1;
        }

        const [created] = await tx
            .insert(productVideos)
            .values({
                productId,
                videoUrl,
                sortOrder: finalSortOrder,
            })
            .returning();

        return created || null;
    },

    async deleteProductVideo(videoId, tx = db) {
        if (!videoId) return null;
        const [deleted] = await tx
            .delete(productVideos)
            .where(eq(productVideos.id, videoId))
            .returning();
        return deleted || null;
    },

    /* =====================================================
       DELETE & IMAGE/VIDEO REFERENCE HELPERS
       ===================================================== */

    async findProductImagesAndVariants(productId, tx = db) {
        if (!productId) return { collectionImageUrl: null, images: [], variants: [], videos: [] };
        const [product] = await tx
            .select({ collectionImageUrl: products.collectionImageUrl })
            .from(products)
            .where(eq(products.id, productId));

        const images = await tx
            .select({ imageUrl: productImages.imageUrl })
            .from(productImages)
            .where(eq(productImages.productId, productId));

        const variants = await tx
            .select({ colorImageUrl: productVariants.colorImageUrl })
            .from(productVariants)
            .where(eq(productVariants.productId, productId));

        const videos = await tx
            .select({ videoUrl: productVideos.videoUrl })
            .from(productVideos)
            .where(eq(productVideos.productId, productId));

        return {
            collectionImageUrl: product?.collectionImageUrl || null,
            images: images.map((i) => i.imageUrl).filter(Boolean),
            variants: variants.map((v) => v.colorImageUrl).filter(Boolean),
            videos: videos.map((v) => v.videoUrl).filter(Boolean),
        };
    },

    async isImageReferencedElsewhere(imageUrl, excludeProductId = null, tx = db) {
        if (!imageUrl) return false;

        // Check products.collectionImageUrl
        const prodCond = excludeProductId
            ? and(eq(products.collectionImageUrl, imageUrl), sql`${products.id} != ${excludeProductId}`)
            : eq(products.collectionImageUrl, imageUrl);
        const [prodRef] = await tx.select({ id: products.id }).from(products).where(prodCond).limit(1);
        if (prodRef) return true;

        // Check productImages.imageUrl
        const imgCond = excludeProductId
            ? and(eq(productImages.imageUrl, imageUrl), sql`${productImages.productId} != ${excludeProductId}`)
            : eq(productImages.imageUrl, imageUrl);
        const [imgRef] = await tx.select({ id: productImages.id }).from(productImages).where(imgCond).limit(1);
        if (imgRef) return true;

        // Check productVideos.videoUrl
        const vidCond = excludeProductId
            ? and(eq(productVideos.videoUrl, imageUrl), sql`${productVideos.productId} != ${excludeProductId}`)
            : eq(productVideos.videoUrl, imageUrl);
        const [vidRef] = await tx.select({ id: productVideos.id }).from(productVideos).where(vidCond).limit(1);
        if (vidRef) return true;

        // Check productVariants.colorImageUrl
        const varCond = excludeProductId
            ? and(eq(productVariants.colorImageUrl, imageUrl), sql`${productVariants.productId} != ${excludeProductId}`)
            : eq(productVariants.colorImageUrl, imageUrl);
        const [varRef] = await tx.select({ id: productVariants.id }).from(productVariants).where(varCond).limit(1);
        if (varRef) return true;

        // Check orderItems.imageUrl
        const [orderRef] = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.imageUrl, imageUrl)).limit(1);
        if (orderRef) return true;

        // Check exchangeItems.imageUrl
        const [exRef] = await tx.select({ id: exchangeItems.id }).from(exchangeItems).where(eq(exchangeItems.imageUrl, imageUrl)).limit(1);
        if (exRef) return true;

        // Check refundItems.imageUrl
        const [refRef] = await tx.select({ id: refundItems.id }).from(refundItems).where(eq(refundItems.imageUrl, imageUrl)).limit(1);
        if (refRef) return true;

        // Check draftItems.imageUrl (draft orders keep the photo they were created with)
        const [draftRef] = await tx.select({ id: draftItems.id }).from(draftItems).where(eq(draftItems.imageUrl, imageUrl)).limit(1);
        if (draftRef) return true;

        // Check reviewGallery.imageUrl
        const [revRef] = await tx.select({ id: reviewGallery.id }).from(reviewGallery).where(eq(reviewGallery.imageUrl, imageUrl)).limit(1);
        if (revRef) return true;

        // Check siteSettings hero images and heroConfig
        const [themeRef] = await tx.select({
            id: siteSettings.id,
            heroLeftImage: siteSettings.heroLeftImage,
            heroRightImage: siteSettings.heroRightImage,
            heroConfig: siteSettings.heroConfig,
        }).from(siteSettings).limit(1);
        if (themeRef) {
            if (themeRef.heroLeftImage === imageUrl || themeRef.heroRightImage === imageUrl) return true;
            if (themeRef.heroConfig && typeof themeRef.heroConfig === 'string' && themeRef.heroConfig.includes(imageUrl)) return true;
        }

        return false;
    },

    async deleteProduct(
        id,
        tx = db
    ) {
        const [deleted] =
            await tx
                .delete(products)
                .where(
                    eq(
                        products.id,
                        id
                    )
                )
                .returning();

        return deleted || null;
    },
};