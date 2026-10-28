import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

const ProductsContext = createContext(null);

const STORAGE_KEY = 'silky_products_state';

function getStoredProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoredProducts(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore storage errors */
  }
}

function normalizeProductState(p) {
  if (!p) return p;
  const colors = (p.colors || []).map((c) => {
    const rawImages = (c.images || (c.image ? [c.image] : []))
      .map((img) => (typeof img === 'string' ? img.trim() : ''))
      .filter(Boolean);
    const thumbnail = c.thumbnail || rawImages[0] || c.image || p.mainImage || '';
    const gallery = c.gallery || rawImages.slice(1);
    const images = rawImages.length ? rawImages : thumbnail ? [thumbnail] : [];
    return {
      ...c,
      image: thumbnail,
      thumbnail,
      gallery,
      images,
    };
  });

  const allThumbnails = p.thumbnails?.length
    ? p.thumbnails
    : colors.flatMap((c) => c.images).filter(Boolean);

  return {
    ...p,
    colors,
    thumbnails: allThumbnails.length ? allThumbnails : [p.mainImage].filter(Boolean),
    videos: Array.isArray(p.videos) ? p.videos : [],
    isHidden: p.isHidden === true || p.is_active === false,
    is_active: !(p.isHidden === true || p.is_active === false),
  };
}

// Hidden (unpublished) products are admin-only: the API only returns them to an admin token, and
// the local state / cache must not keep them once the user is no longer an admin.
function withoutHidden(list) {
  return list.filter((p) => !p.isHidden);
}

export function ProductsProvider({ children }) {
  const { isAdmin } = useAuth();
  const [products, setProducts] = useState(() => {
    const stored = getStoredProducts();
    if (!stored) return [];
    const list = stored.map(normalizeProductState);
    return isAdmin ? list : withoutHidden(list);
  });
  const [loading, setLoading] = useState(true);
  // Only the latest refresh may update state (login/logout can start a refresh while another is in flight).
  const refreshSeq = useRef(0);

  const refreshProducts = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const data = await api.getProducts({ includeHidden: isAdmin });
      const list = (data || []).map(normalizeProductState);
      const visible = isAdmin ? list : withoutHidden(list);

      if (seq === refreshSeq.current) {
        setProducts(visible);
        saveStoredProducts(visible);
      }
      return visible;
    } catch (err) {
      console.warn('Failed to fetch products from backend, using stored cache:', err);
      const stored = getStoredProducts();
      const cached = stored && Array.isArray(stored) ? stored.map(normalizeProductState) : [];
      const list = isAdmin ? cached : withoutHidden(cached);
      if (seq === refreshSeq.current) setProducts(list);
      return list;
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      // Logout (or a guest's first load after this fix): drop hidden products from state and the cache now,
      // without waiting for the refetch.
      setProducts((current) => (current.some((p) => p.isHidden) ? withoutHidden(current) : current));
      const stored = getStoredProducts();
      if (Array.isArray(stored) && stored.some((p) => p.isHidden === true || p.is_active === false)) {
        saveStoredProducts(withoutHidden(stored.map(normalizeProductState)));
      }
    }
    refreshProducts().finally(() => setLoading(false));
  }, [refreshProducts, isAdmin]);

  const getProduct = useCallback((id) => products.find((p) => p.id === id), [products]);

  const getByCategory = useCallback(
    (category, includeHidden = false) =>
      products.filter((p) => p.category === category && (isAdmin || includeHidden || !p.isHidden)),
    [products, isAdmin],
  );

  const visibleProducts = useMemo(
    () => (isAdmin ? products : products.filter((p) => !p.isHidden)),
    [products, isAdmin],
  );

  const addProduct = useCallback(async (product) => {
    const saved = await api.createProduct(product);
    const created = normalizeProductState(saved || product);

    setProducts((current) => {
      const next = [...current, created];
      saveStoredProducts(next);
      return next;
    });
    return created;
  }, []);

  const updateProduct = useCallback(async (id, updates) => {
    const saved = await api.updateProduct(id, updates);
    const savedProduct = normalizeProductState(saved || updates);

    setProducts((current) => {
      const next = current.map((p) => (p.id === id ? { ...p, ...savedProduct } : p));
      saveStoredProducts(next);
      return next;
    });
    return savedProduct;
  }, []);

  const deleteProduct = useCallback(async (id) => {
    await api.deleteProduct(id);

    setProducts((current) => {
      const next = current.filter((p) => p.id !== id);
      saveStoredProducts(next);
      return next;
    });
  }, []);

  const uploadProductVideo = useCallback(async (productId, formData) => {
    const res = await api.uploadProductVideo(productId, formData);
    if (res?.product) {
      const updated = normalizeProductState(res.product);
      setProducts((current) => {
        const next = current.map((p) => (p.id === productId ? updated : p));
        saveStoredProducts(next);
        return next;
      });
    }
    return res;
  }, []);

  const deleteProductVideo = useCallback(async (productId, videoId) => {
    const res = await api.deleteProductVideo(productId, videoId);
    if (res?.product) {
      const updated = normalizeProductState(res.product);
      setProducts((current) => {
        const next = current.map((p) => (p.id === productId ? updated : p));
        saveStoredProducts(next);
        return next;
      });
    }
    return res;
  }, []);

  return (
    <ProductsContext.Provider
      value={{
        products,
        visibleProducts,
        loading,
        getProduct,
        getByCategory,
        addProduct,
        updateProduct,
        deleteProduct,
        uploadProductVideo,
        deleteProductVideo,
        refreshProducts,
      }}
    >
      {children}
    </ProductsContext.Provider>
  );
}

export function useProducts() {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error('useProducts must be used within ProductsProvider');
  return ctx;
}
