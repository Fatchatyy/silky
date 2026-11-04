// The product form logic shared by the two product editors: the admin panel's Products tab (admin-app/pages/AdminProducts.jsx)
// and the inline editor on the product page (ProductPageAdmin.jsx). Before this module each editor carried its own copy of
// these functions.
import { buildStockMatrix } from '@shared/stock';
import { adminApi } from './adminApi';

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
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

/** Uploads one product photo; resolves to its `/uploads/...` path (or, if the API is unreachable, a data URL). */
export async function uploadFile(file, onRejected) {
  if (!file) return null;
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await adminApi.uploadProductImage(formData);
    if (res?.url) return res.url;
  } catch (err) {
    // The server refused the file itself (wrong content, too large...): tell the admin instead of embedding it as a data URL.
    if (err?.status >= 400 && err?.status < 500) {
      onRejected?.(err.message);
      return null;
    }
    console.warn('API upload failed, falling back to data URL:', err);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}
