import path from 'path';
import { db } from '../db/orm.js';

import {
    productRepository,
    getStockKey,
} from '../repositories/product.repository.js';

import { storage, uploadKey } from './storage.service.js';
import { removeImageVariants } from '../utils/imageVariants.js';
import { AppError } from '../utils/errors.js';
import { shortenSlug } from '../utils/slug.js';

/*
 * ============================================================
 * SLUG
 * ============================================================
 */

function slugify(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/*
 * ============================================================
 * COLOR NORMALIZATION
 * ============================================================
 */

function normalizeColorId(color, index) {
    return (
        color?.id?.toString().trim() ||
        color?.slug?.toString().trim() ||
        slugify(color?.name) ||
        `color-${index}`
    );
}

/*
 * ============================================================
 * STOCK
 * ============================================================
 *
 * Read stock using the same key format produced by the
 * repository:
 *
 *     S::black
 *     M::black
 *     L::black
 *
 * We also keep backwards compatibility with the previous
 * formats.
 */

function getStockQuantity(
    stock,
    size,
    colorSlug
) {
    if (
        !stock ||
        typeof stock !== 'object'
    ) {
        return 0;
    }

    const normalizedSize =
        String(size ?? '').trim();

    const normalizedColor =
        String(colorSlug ?? '').trim();

    const keys = [
        /*
         * CURRENT FORMAT: color-size (e.g. noir-S)
         */
        getStockKey(
            normalizedColor,
            normalizedSize
        ),

        /*
         * OLD POSSIBLE FORMATS
         */
        `${normalizedColor}::${normalizedSize}`,
        `${normalizedColor}-${normalizedSize}`,
        `${normalizedSize}-${normalizedColor}`,
        getStockKey(
            normalizedSize,
            normalizedColor
        ),
    ];

    for (const key of keys) {
        if (
            Object.prototype.hasOwnProperty.call(
                stock,
                key
            )
        ) {
            const quantity =
                Number(
                    stock[key]
                );

            return Number.isFinite(quantity)
                ? Math.max(0, quantity)
                : 0;
        }
    }

    return 0;
}

/*
 * ============================================================
 * NORMALIZE FRONTEND PRODUCT
 * ============================================================
 */

function normalizeProductInput(
    payload,
    existingProduct = null
) {
    const isUpdate = existingProduct !== null;

    const hasVariantInput =
        payload.variants !== undefined ||
        payload.colors !== undefined ||
        payload.sizes !== undefined ||
        payload.stock !== undefined;

    const hasImageInput =
        payload.images !== undefined ||
        payload.mainImage !== undefined ||
        payload.thumbnails !== undefined ||
        payload.colors !== undefined ||
        payload.collectionImage !== undefined ||
        payload.collectionImageUrl !== undefined;

    const merged =
        existingProduct
            ? {
                ...existingProduct,
                ...payload,
            }
            : payload;

    const title =
        (merged.name ?? merged.title)?.toString().trim();

    if (!title) {
        throw new AppError(
            'Le nom du produit est requis.',
            400
        );
    }

    const description =
        (merged.description ?? '')?.toString().trim();

    if (!description) {
        throw new AppError(
            'La description est requise.',
            400
        );
    }

    // Optional Arabic version; empty or missing means "none" (NULL), the storefront then shows the French text.
    const titleAr =
        (merged.nameAr ?? merged.titleAr)?.toString().trim() || null;

    const descriptionAr =
        merged.descriptionAr?.toString().trim() || null;

    if (titleAr && titleAr.length > 255) {
        throw new AppError(
            'Le nom arabe ne peut pas dépasser 255 caractères.',
            400
        );
    }

    // Optional custom alt text of the product's photos (one text for all of them); empty means "none" (NULL), the storefront
    // then builds the alt from the name, colour and photo position.
    const imageAlt =
        merged.imageAlt?.toString().trim() || null;

    const imageAltAr =
        merged.imageAltAr?.toString().trim() || null;

    if (
        (imageAlt && imageAlt.length > 255) ||
        (imageAltAr && imageAltAr.length > 255)
    ) {
        throw new AppError(
            'Le texte alternatif des photos ne peut pas dépasser 255 caractères.',
            400
        );
    }

    const price = Number(merged.price);
    if (
        merged.price === undefined ||
        merged.price === null ||
        merged.price === '' ||
        Number.isNaN(price) ||
        price <= 0
    ) {
        throw new AppError(
            'Le prix est requis et doit être supérieur à 0.',
            400
        );
    }

    const discountAmount =
        merged.discount === undefined ||
        merged.discount === null ||
        merged.discount === ''
            ? (merged.discountAmount !== undefined &&
               merged.discountAmount !== null &&
               merged.discountAmount !== ''
                ? Number(merged.discountAmount)
                : 0)
            : Number(merged.discount);

    if (Number.isNaN(discountAmount) || discountAmount < 0) {
        throw new AppError(
            'La remise doit être positive.',
            400
        );
    }

    if (discountAmount > price) {
        throw new AppError(
            'La remise ne peut pas être supérieure au prix.',
            400
        );
    }

    /*
     * Preserve existing slug.
     */
    const slug =
        (merged.slug ?? existingProduct?.slug)?.toString().trim() ||
        shortenSlug(slugify(title));

    if (!slug) {
        throw new AppError(
            'Le slug du produit est requis.',
            400
        );
    }

    /*
     * Active & Featured normalization.
     */
    let isActive;
    if (payload.isActive !== undefined) {
        isActive = Boolean(payload.isActive);
    } else if (payload.is_active !== undefined) {
        isActive = Boolean(payload.is_active);
    } else if (payload.isHidden !== undefined) {
        isActive = !Boolean(payload.isHidden);
    } else if (existingProduct) {
        isActive =
            existingProduct.is_active !== undefined
                ? Boolean(existingProduct.is_active)
                : existingProduct.isActive !== undefined
                    ? Boolean(existingProduct.isActive)
                    : !Boolean(existingProduct.isHidden);
    } else {
        isActive = true;
    }

    let isFeatured;
    if (payload.isFeatured !== undefined) {
        isFeatured = Boolean(payload.isFeatured);
    } else if (existingProduct) {
        isFeatured = Boolean(existingProduct.isFeatured);
    } else {
        isFeatured = false;
    }

    let collectionImageUrl = '';
    if (payload.collectionImage !== undefined) {
        collectionImageUrl = typeof payload.collectionImage === 'string'
            ? payload.collectionImage.trim()
            : payload.collectionImage
                ? String(payload.collectionImage).trim()
                : '';
    } else if (payload.collectionImageUrl !== undefined) {
        collectionImageUrl = typeof payload.collectionImageUrl === 'string'
            ? payload.collectionImageUrl.trim()
            : payload.collectionImageUrl
                ? String(payload.collectionImageUrl).trim()
                : '';
    } else if (existingProduct) {
        const existingVal =
            existingProduct.collectionImageUrl ||
            existingProduct.collectionImage ||
            '';
        collectionImageUrl = typeof existingVal === 'string' ? existingVal.trim() : '';
    } else {
        collectionImageUrl = '';
    }

    if (!collectionImageUrl || !collectionImageUrl.trim()) {
        throw new AppError(
            'Veuillez ajouter une image de collection.',
            400
        );
    }

    /*
     * Normalize sizes.
     */
    const sizes =
        (
            Array.isArray(
                merged.sizes
            )
                ? merged.sizes
                : []
        )
            .map(
                size =>
                    String(size).trim()
            )
            .filter(Boolean);

    if (!sizes.length) {
        throw new AppError(
            'Veuillez ajouter au moins une taille.',
            400
        );
    }

    /*
     * Normalize colors (Thumbnail + Gallery model).
     */
    const rawColors = Array.isArray(merged.colors) ? merged.colors : [];
    const colors = [];

    for (let i = 0; i < rawColors.length; i++) {
        const color = rawColors[i];
        const name = (color?.name || '').toString().trim();
        if (!name) {
            throw new AppError(
                `Le nom de la couleur ${i + 1} est requis.`,
                400
            );
        }

        const id = normalizeColorId(color, i);

        let thumbnail = (color.thumbnail || color.image || '').toString().trim();
        let gallery = [];

        if (Array.isArray(color.gallery)) {
            gallery = color.gallery
                .map((img) => (typeof img === 'string' ? img.trim() : ''))
                .filter(Boolean);
        }

        if (Array.isArray(color.images)) {
            const rawImages = color.images
                .map((img) => (typeof img === 'string' ? img.trim() : ''))
                .filter(Boolean);

            if (!thumbnail && rawImages.length > 0) {
                thumbnail = rawImages[0];
            }
            if (gallery.length === 0 && rawImages.length > 1) {
                gallery = rawImages.slice(1);
            }
        }

        if (!thumbnail) {
            throw new AppError(
                `Veuillez ajouter une miniature pour la couleur "${name}".`,
                400
            );
        }

        const images = [thumbnail, ...gallery].filter(Boolean);

        // Optional Arabic color name; empty or missing means "none" (NULL).
        const nameAr = (color.nameAr ?? '').toString().trim() || null;
        if (nameAr && nameAr.length > 64) {
            throw new AppError(
                `Le nom arabe de la couleur "${name}" ne peut pas dépasser 64 caractères.`,
                400
            );
        }

        colors.push({
            id,
            name,
            nameAr,
            image: thumbnail,
            thumbnail,
            gallery,
            images,
        });
    }
    /*
     * Stock object received from frontend.
     */
    const stock =
        merged.stock &&
        typeof merged.stock === 'object'
            ? merged.stock
            : {};

    /*
     * Main image.
     */
    const mainImage =
        (payload.mainImage !== undefined ? payload.mainImage : merged.mainImage)?.toString().trim() ||
        colors[0]?.thumbnail ||
        colors[0]?.image ||
        '';

    /*
     * ========================================================
     * BUILD VARIANTS
     * ========================================================
     */

    let variants = undefined;

    if (!isUpdate || hasVariantInput) {
        if (Array.isArray(payload.variants) && !Array.isArray(payload.colors)) {
            variants = payload.variants.map((v, i) => {
                const vSize = String(v.size ?? '').trim();
                const vColorSlug = normalizeColorId(v, i);
                const vColorName = (
                    v.colorName ||
                    v.colorSlug ||
                    v.colorId ||
                    vColorSlug ||
                    ''
                ).toString().trim();
                const vColorImageUrl = v.colorImageUrl || v.thumbnail || v.image || null;
                const vStockQuantity = Number.isFinite(
                    Number(v.stockQuantity ?? v.stock)
                )
                    ? Math.max(0, Number(v.stockQuantity ?? v.stock))
                    : 0;
                const vSku =
                    v.sku ||
                    `${slug}-${vSize || 'default'}-${vColorSlug}`.toUpperCase();

                return {
                    ...(v.id ? { id: v.id } : {}),
                    size: vSize,
                    colorSlug: vColorSlug,
                    colorName: vColorName,
                    colorNameAr: (v.colorNameAr ?? '').toString().trim() || null,
                    colorImageUrl: vColorImageUrl,
                    stockQuantity: vStockQuantity,
                    sku: vSku,
                };
            });
        } else {
            variants = [];
            const targetSizes =
                sizes.length
                    ? sizes
                    : [''];

            for (const color of colors) {
                for (const size of targetSizes) {
                    const stockQuantity =
                        getStockQuantity(
                            stock,
                            size,
                            color.id
                        );

                    variants.push({
                        size,
                        colorSlug:
                            color.id,
                        colorName:
                            color.name,
                        colorNameAr:
                            color.nameAr,
                        colorImageUrl:
                            color.thumbnail ||
                            color.image ||
                            null,
                        stockQuantity,
                        sku:
                            `${slug}-${size || 'default'}-${color.id}`
                                .toUpperCase(),
                    });
                }
            }
        }
    }

    /*
     * ========================================================
     * BUILD IMAGES
     * ========================================================
     */

    let images = undefined;

    if (!isUpdate || hasImageInput) {
        images = [];
        let sortOrder = 0;
        let primarySet = false;

        for (const color of colors) {
            for (const imgUrl of color.images) {
                if (!imgUrl) continue;
                const isPrimary = Boolean(
                    mainImage &&
                    imgUrl === mainImage &&
                    !primarySet
                );
                if (isPrimary) {
                    primarySet = true;
                }
                images.push({
                    imageUrl: imgUrl,
                    colorSlug: color.id,
                    sortOrder: sortOrder++,
                    isPrimary,
                });
            }
        }

        if (!primarySet && images.length > 0) {
            images[0].isPrimary = true;
        }
    }

    const categorySlug =
        (merged.category ?? merged.categorySlug)?.toString().trim() ||
        null;

    const categoryId =
        merged.categoryId ||
        null;

    if (!categorySlug && !categoryId) {
        throw new AppError(
            'Veuillez sélectionner une catégorie.',
            400
        );
    }

    const result = {
        title,

        slug,

        description,

        titleAr,

        descriptionAr,

        imageAlt,

        imageAltAr,

        price,

        discountAmount,

        categorySlug,

        categoryId,

        collectionImageUrl,

        isFeatured,

        isActive,
    };

    if (variants !== undefined) {
        result.variants = variants;
    }

    if (images !== undefined) {
        result.images = images;
    }

    return result;
}

/*
 * ============================================================
 * CATEGORY
 * ============================================================
 */

async function resolveCategoryId(
    input,
    tx
) {
    if (input.categoryId) {
        return input.categoryId;
    }

    if (!input.categorySlug) {
        throw new AppError(
            'La catégorie est requise',
            400
        );
    }

    const category =
        await productRepository
            .findCategoryBySlug(
                input.categorySlug,
                tx
            );

    if (!category) {
        throw new AppError(
            'Catégorie non trouvée',
            400
        );
    }

    return category.id;
}

/*
 * ============================================================
 * READ
 * ============================================================
 */

export async function getAllProducts({
    includeHidden = false
} = {}) {
    return productRepository.findAll({
        includeHidden
    });
}

export async function listProducts({
    category,
    search,
    page = 1,
    limit = 24,
    includeHidden = false
} = {}) {
    return productRepository.listPaginated({
        category,
        search,
        page,
        limit,
        includeHidden,
    });
}

export async function getProductById(id) {
    const product =
        await productRepository.findById(
            id
        );

    if (!product) {
        throw new AppError(
            'Produit non trouvé',
            404
        );
    }

    return product;
}

export async function getProductBySlug(slug) {
    const product =
        await productRepository.findBySlug(
            slug
        );

    if (!product) {
        throw new AppError(
            'Produit non trouvé',
            404
        );
    }

    return product;
}

/*
 * ============================================================
 * CREATE
 * ============================================================
 */

export async function createProduct(
    payload
) {
    const input =
        normalizeProductInput(
            payload
        );

    if (
        Number.isNaN(input.price) ||
        input.price < 0
    ) {
        throw new AppError(
            'Le prix doit être positif',
            400
        );
    }

    if (
        Number.isNaN(
            input.discountAmount
        ) ||
        input.discountAmount < 0
    ) {
        throw new AppError(
            'La remise doit être positive',
            400
        );
    }

    return db.transaction(
        async (tx) => {
            const categoryId =
                await resolveCategoryId(
                    input,
                    tx
                );

            const existing =
                await productRepository
                    .findBySlug(
                        input.slug,
                        tx
                    );

            if (existing) {
                throw new AppError(
                    'Un produit avec ce slug existe déjà',
                    409
                );
            }

            return productRepository
                .createProduct(
                    {
                        title:
                            input.title,

                        slug:
                            input.slug,

                        description:
                            input.description,

                        titleAr:
                            input.titleAr,

                        descriptionAr:
                            input.descriptionAr,

                        imageAlt:
                            input.imageAlt,

                        imageAltAr:
                            input.imageAltAr,

                        price:
                            input.price,

                        discountAmount:
                            input.discountAmount,

                        categoryId,

                        collectionImageUrl:
                            input.collectionImageUrl,

                        isFeatured:
                            input.isFeatured,

                        isActive:
                            input.isActive,

                        variants:
                            input.variants,

                        images:
                            input.images,
                    },

                    tx
                );
        }
    );
}

/*
 * ============================================================
 * UPDATE
 * ============================================================
 */

export async function updateProduct(
    id,
    payload
) {
    const existing =
        await productRepository.findById(
            id
        );

    if (!existing) {
        throw new AppError(
            'Produit non trouvé',
            404
        );
    }

    const input =
        normalizeProductInput(
            payload,
            existing
        );

    if (
        Number.isNaN(input.price) ||
        input.price < 0
    ) {
        throw new AppError(
            'Le prix doit être positif',
            400
        );
    }

    if (
        Number.isNaN(
            input.discountAmount
        ) ||
        input.discountAmount < 0
    ) {
        throw new AppError(
            'La remise doit être positive',
            400
        );
    }

    const photosBefore = productPhotoUrls(
        await productRepository.findProductImagesAndVariants(id)
    );

    const updated = await db.transaction(
        async (tx) => {
            const categoryId =
                await resolveCategoryId(
                    input,
                    tx
                );

            if (
                input.slug !==
                existing.slug
            ) {
                const slugCheck =
                    await productRepository
                        .findBySlug(
                            input.slug,
                            tx
                        );

                if (
                    slugCheck &&
                    slugCheck.id !== id
                ) {
                    throw new AppError(
                        'Un produit avec ce slug existe déjà',
                        409
                    );
                }
            }

            const updatePayload = {
                title:
                    input.title,

                slug:
                    input.slug,

                description:
                    input.description,

                titleAr:
                    input.titleAr,

                descriptionAr:
                    input.descriptionAr,

                imageAlt:
                    input.imageAlt,

                imageAltAr:
                    input.imageAltAr,

                price:
                    input.price,

                discountAmount:
                    input.discountAmount,

                categoryId,

                collectionImageUrl:
                    input.collectionImageUrl,

                isFeatured:
                    input.isFeatured,

                isActive:
                    input.isActive,
            };

            if (input.variants !== undefined) {
                updatePayload.variants = input.variants;
            }

            if (input.images !== undefined) {
                updatePayload.images = input.images;
            }

            return productRepository
                .updateProduct(
                    id,
                    updatePayload,
                    tx
                );
        }
    );

    await removePhotosDroppedByEdit(id, photosBefore);

    return updated;
}

/*
 * ============================================================
 * DELETE
 * ============================================================
 */

export async function deleteProduct(
    id
) {
    if (!id) {
        throw new AppError(
            'ID du produit requis',
            400
        );
    }

    return db.transaction(async (tx) => {
        const existing =
            await productRepository.findById(
                id,
                tx
            );

        if (!existing) {
            throw new AppError(
                'Produit non trouvé',
                404
            );
        }

        // Collect candidate media URLs from product, variants, product images, and product videos before deletion
        const { collectionImageUrl, images, variants, videos } =
            await productRepository.findProductImagesAndVariants(id, tx);

        const candidateImageUrls = new Set();
        if (collectionImageUrl) candidateImageUrls.add(collectionImageUrl);
        for (const img of images) candidateImageUrls.add(img);
        for (const img of variants) candidateImageUrls.add(img);
        for (const vid of (videos || [])) candidateImageUrls.add(vid);

        // Delete product from DB (cascades product_variants, product_images, cart_items, favourites, reviews)
        const deleted = await productRepository.deleteProduct(
            id,
            tx
        );

        // Clean up orphan uploaded files (local disk or R2, see storage.service.js)
        for (const imgUrl of candidateImageUrls) {
            await removeUploadIfUnused(imgUrl, tx);
        }

        return deleted;
    });
}

/**
 * Deletes an uploaded file (and its resized copies) unless something still uses it: another product, an order,
 * an exchange, a refund, a draft order, the review gallery or the home hero. Anything that is not an /uploads
 * file is ignored.
 */
export async function removeUploadIfUnused(imgUrl, tx) {
    if (typeof imgUrl !== 'string') return;
    const trimmed = imgUrl.trim();
    if (!(trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/'))) return;

    const isStillReferenced = await productRepository.isImageReferencedElsewhere(trimmed, null, tx);
    if (isStillReferenced) return;

    const filename = path.basename(trimmed);
    try {
        await storage.deleteObject(uploadKey(filename));
    } catch {
        // File may already have been removed, or the storage may be unreachable: never fail the edit for it
    }
    // Its resized copies (if any) go with it.
    await removeImageVariants(filename);
}

/**
 * Photos are uploaded the moment the admin picks them, before the product is saved. One that is then removed, replaced or
 * abandoned (editor closed) before saving was never written to the database, so no save or delete cleans it up. The
 * editors send the files they uploaded in this session; every one that nothing uses is deleted with its copies, the
 * ones the saved product (or an order, hero...) uses are kept. Returns how many files were removed.
 */
export async function discardUnusedUploads(urls) {
    if (!Array.isArray(urls)) throw new AppError('Liste de fichiers invalide', 400);
    let removed = 0;
    for (const url of [...new Set(urls)].slice(0, 200)) {
        if (typeof url !== 'string') continue;
        const trimmed = url.trim();
        if (!/^\/uploads\/[^/\\]+$/.test(trimmed)) continue;
        if (await productRepository.isImageReferencedElsewhere(trimmed, null)) continue;
        await removeUploadIfUnused(trimmed);
        removed++;
    }
    return { removed };
}

/**
 * Safety net for photos that were uploaded and never used (an editor closed by a crash, a lost connection...). Looks at
 * every stored upload and returns the ones nothing uses (product, colour, collection image, video, order, exchange,
 * refund, draft, review gallery, home hero), grouped as one entry per photo with its resized copies. Only files older
 * than `minAgeHours` are returned, so a photo being added right now is never touched. Read-only.
 */
export async function findOrphanUploads({ minAgeHours = 24, now = Date.now() } = {}) {
    const COPY = /^(.+)\.(?:card|share|large)\.webp$/;
    const groups = new Map(); // photo id (file name without extension and copy suffix) -> { original, keys, bytes, newest }
    for (const object of await storage.listObjects()) {
        const name = path.basename(object.key);
        if (!/^\d+-/.test(name)) continue; // not something this app uploaded
        const copy = COPY.exec(name);
        const id = copy ? copy[1] : name.replace(/\.[^.]+$/, '');
        const group = groups.get(id) || { id, original: null, keys: [], bytes: 0, newest: 0 };
        if (!copy) group.original = name;
        group.keys.push(object.key);
        group.bytes += object.size;
        group.newest = Math.max(group.newest, object.lastModified);
        groups.set(id, group);
    }

    const cutoff = now - minAgeHours * 3_600_000;
    const orphans = [];
    for (const group of groups.values()) {
        if (group.newest > cutoff) continue;
        // copies without their original cannot be shown by the storefront: they are leftovers too
        if (group.original && (await productRepository.isImageReferencedElsewhere(`/uploads/${group.original}`, null))) continue;
        orphans.push({ id: group.id, original: group.original, keys: group.keys, bytes: group.bytes });
    }
    return orphans;
}

/** Deletes what findOrphanUploads returned (every file of each photo). Returns how many files were removed. */
export async function deleteOrphanUploads(orphans) {
    let removed = 0;
    for (const orphan of orphans) {
        for (const key of orphan.keys) {
            await storage.deleteObject(key);
            removed++;
        }
    }
    return removed;
}

const productPhotoUrls = ({ collectionImageUrl, images, variants }) =>
    new Set([collectionImageUrl, ...images, ...variants].filter(Boolean));

/**
 * After a product edit has been saved: removes the photos the product no longer uses. Runs after the save is
 * committed, so a failed save never loses a file, and never fails the edit itself.
 */
async function removePhotosDroppedByEdit(productId, photosBefore) {
    try {
        const photosAfter = productPhotoUrls(await productRepository.findProductImagesAndVariants(productId));
        for (const url of photosBefore) {
            if (!photosAfter.has(url)) await removeUploadIfUnused(url);
        }
    } catch (err) {
        console.error('[products] could not clean up replaced photos:', String(err?.message ?? err).slice(0, 160));
    }
}

/*
 * ============================================================
 * ORDERS / VARIANTS
 * ============================================================
 */

export async function findVariantForOrderItem(
    productId,
    colorId,
    size
) {
    return productRepository
        .findVariantForOrderItem(
            productId,
            colorId,
            size
        );
}

/*
 * Keep this export because other backend
 * files may import it.
 */
export {
    getStockKey
};