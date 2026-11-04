// Loads the full product as the admin sees it (the public page only carries the fields visitors need, and a hidden
// product is only returned to an admin token), then shows the inline editor. While it loads, or if it fails, the
// public view that the server rendered stays on screen.
import { useEffect, useState } from 'react';
import { normalizeProduct } from '../lib/normalizeProduct';
import { adminApi } from './adminApi';
import ProductPageAdmin from './ProductPageAdmin';

export default function ProductAdminLoader({ productId, lookup = null, breadcrumb, fallback = null, standalone = false, onLoaded = null }) {
  const [product, setProduct] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // `lookup` is a slug or id typed in the address (the page of a hidden product has no id yet).
    const load = lookup ? (/^[0-9a-f-]{36}$/i.test(lookup) ? adminApi.getProduct(lookup) : adminApi.getProductBySlug(lookup)) : adminApi.getProduct(productId);
    load
      .then((data) => {
        if (!cancelled && data) {
          const full = normalizeProduct(data);
          setProduct(full);
          onLoaded?.(full);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId, lookup]);

  if (!product) return fallback;
  return <ProductPageAdmin initialProduct={product} breadcrumb={breadcrumb} standalone={standalone} />;
}
