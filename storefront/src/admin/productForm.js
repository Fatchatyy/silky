// The product form logic shared by the two product editors: the admin panel's Products tab (admin-app/pages/AdminProducts.jsx)
// and the inline editor on the product page (ProductPageAdmin.jsx). The pure part lives in shared/productFormLogic.js.
import { adminApi } from './adminApi';

export { slugify, colorIdOnRename, mapProductColorsToForm, normalizeProduct } from '@shared/productFormLogic';

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
