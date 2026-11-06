// The products the header search and the search page look in. For a visitor: /search-index.json, a small static file built with
// the site (one line per published product). For an admin: the full product list including hidden products (stores/products.ts),
// as before. If the file cannot be read (an old deploy, the network) everybody falls back to the API list.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { useCallback, useEffect } from 'react';
import { useAuth } from './auth';
import { useProducts } from './products';

type IndexState = { products: any[]; loading: boolean; failed: boolean };
const $index = atom<IndexState>({ products: [], loading: true, failed: false });
let requested = false;

async function loadIndex() {
  if (requested) return;
  requested = true;
  try {
    const res = await fetch('/search-index.json');
    if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) throw new Error(`search index: ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('search index: not a list');
    $index.set({ products: list, loading: false, failed: false });
  } catch (err) {
    console.warn('The search index could not be read, using the product list from the API:', err);
    $index.set({ products: [], loading: false, failed: true });
  }
}

/** lazy: nothing is downloaded until ensureLoaded() (the header search calls it on the first keystroke). */
export function useSearchProducts({ lazy = false }: { lazy?: boolean } = {}) {
  const { isAdmin } = useAuth();
  const index = useStore($index);
  const api = useProducts({ lazy: true });
  const useApiList = isAdmin || index.failed;

  const ensureLoaded = useCallback(() => {
    if (isAdmin) api.ensureLoaded();
    else loadIndex();
  }, [isAdmin, api.ensureLoaded]);

  // A visitor whose index failed to load gets the API list.
  useEffect(() => {
    if (index.failed) api.ensureLoaded();
  }, [index.failed]);

  useEffect(() => {
    if (!lazy) ensureLoaded();
  }, [lazy, ensureLoaded]);

  return {
    products: useApiList ? api.visibleProducts : index.products,
    loading: useApiList ? api.loading : index.loading,
    ensureLoaded,
  };
}
