// Pure logic of the product form (shared by the admin panel's Products tab and the inline editor on the product page, and
// tested by server/scripts/test_colour_ids_on_edit.js): colour ids, the API product -> form, the form -> API body.
// No React, no DOM, no network.
import { buildStockMatrix } from './stock.js';

/** Colour id of a NEW colour: its name without accents ("Écru" -> "ecru"). */
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * The id of a colour when the admin types its name. A colour that is already saved (`existing`) keeps its id: the product's
 * variants, photos, stock keys and the orders that point to those variants are tied to it, and products created before ids
 * lost their accents hold ids like "cru" for "Écru". Only a new colour gets the id made from the name.
 */
export function colorIdOnRename(color, newName, index = 0) {
  if (color?.existing && color.id) return color.id;
  return slugify(newName) || `color-${index}`;
}

/** The colours of an API product, as the form edits them (thumbnail + gallery per colour). */
export function mapProductColorsToForm(rawColors = []) {
  return rawColors.map((c, i) => {
    const rawImages = (c.images || (c.image ? [c.image] : [])).filter(Boolean);
    const thumbnail = (c.thumbnail || rawImages[0] || c.image || '').trim();
    const gallery = (c.gallery || rawImages.slice(1))
      .map((g) => (typeof g === 'string' ? g.trim() : ''))
      .filter(Boolean);
    return {
      id: c.id || slugify(c.name) || `color-${i}`,
      existing: Boolean(c.id),
      name: (c.name || '').trim(),
      nameAr: (c.nameAr || '').trim(),
      thumbnail,
      gallery,
    };
  });
}

/** The form -> the body the API expects (trimmed texts, colours without a name dropped, a full stock matrix, a main image that exists). */
export function normalizeProduct(form) {
  const colors = form.colors
    .filter((c) => c.name.trim())
    .map((c, i) => {
      const thumbnail = (c.thumbnail || '').trim();
      const gallery = (c.gallery || []).map((g) => (typeof g === 'string' ? g.trim() : '')).filter(Boolean);
      const images = [thumbnail, ...gallery].filter(Boolean);
      return {
        id: c.id || slugify(c.name) || `color-${i}`,
        name: c.name.trim(),
        nameAr: (c.nameAr || '').trim(),
        image: thumbnail,
        thumbnail,
        gallery,
        images,
      };
    });

  const sizes = form.sizes.map((s) => s.trim()).filter(Boolean);

  const stock = { ...form.stock };
  buildStockMatrix({ colors, sizes }).forEach(({ key }) => {
    if (stock[key] === undefined || stock[key] === '') stock[key] = 0;
    stock[key] = Number(stock[key]) || 0;
  });

  const allThumbnails = colors.flatMap((c) => c.images).filter(Boolean);
  const currentMain = (form.mainImage || '').trim();
  const mainImage = currentMain && allThumbnails.includes(currentMain) ? currentMain : allThumbnails[0] || '';

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    nameAr: (form.nameAr || '').trim(),
    descriptionAr: (form.descriptionAr || '').trim(),
    imageAlt: (form.imageAlt || '').trim(),
    imageAltAr: (form.imageAltAr || '').trim(),
    price: Number(form.price) || 0,
    discount: Number(form.discount) || 0,
    category: form.category,
    mainImage,
    thumbnails: allThumbnails,
    colors,
    sizes,
    stock,
    collectionImage: (form.collectionImage || '').trim(),
    isHidden: Boolean(form.isHidden),
  };
}
