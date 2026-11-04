// The public product list for islands that need to look products up in the browser (cart names, search
// suggestions, favourites, checkout). Loaded once per page, on first use. Pages that only display products get them
// from the server instead.
//
// For an admin (a valid admin token) the list also holds the hidden products, as in the old ProductsContext; for
// everybody else hidden products are dropped even if the API somehow sent one.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useMemo } from 'react';
import { api } from '../lib/apiClient';
import { normalizeProduct } from '../lib/normalizeProduct';
import { authReady } from './auth';
import { $user } from './session';

const $state = atom<{ products: any[]; loading: boolean }>({ products: [], loading: true });
let started = false;

async function refreshProducts() {
  // Wait for the stored session to be checked with the API: a stale or revoked admin token must not ask for hidden products.
  await authReady();
  const isAdmin = $user.get()?.role === 'admin';
  try {
    const data = await api.getProducts({ includeHidden: isAdmin });
    const list = (data || []).map(normalizeProduct).filter((p: any) => isAdmin || !p.isHidden);
    $state.set({ products: list, loading: false });
    return list;
  } catch (err) {
    console.warn('Failed to fetch products from the API:', err);
    $state.set({ products: $state.get().products, loading: false });
    return $state.get().products;
  }
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  refreshProducts();
}

/** lazy: do not download the list until ensureLoaded() is called (the header search waits for the first keystroke). */
export function useProducts({ lazy = false }: { lazy?: boolean } = {}) {
  const { products, loading } = useStore($state);
  useEffect(() => {
    if (!lazy) start();
  }, [lazy]);
  // `key` is a product id or the slug used in its URL.
  const getProduct = useCallback((key: string) => products.find((p) => p.id === key || (p.slug && p.slug === key)), [products]);
  const getByCategory = useCallback((category: string) => products.filter((p) => p.category === category), [products]);
  const visibleProducts = useMemo(() => products, [products]);
  return { products, visibleProducts, loading, getProduct, getByCategory, refreshProducts, ensureLoaded: start };
}
