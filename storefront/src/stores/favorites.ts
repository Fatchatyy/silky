// The visitor's favourites (replaces the old FavoritesContext). Stored on the API like the cart.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { useCallback, useEffect } from 'react';
import { api } from '../lib/apiClient';
import { authReady } from './auth';
import { $user } from './session';

type FavoritesState = { items: any[]; favoriteIds: string[]; loading: boolean; error: string | null };

const $favorites = atom<FavoritesState>({ items: [], favoriteIds: [], loading: true, error: null });

function applyData(result: any) {
  const items = result?.favourites || result?.items || [];
  const favoriteIds = result?.productIds || Array.from(new Set(items.map((f: any) => f.productId)));
  $favorites.set({ ...$favorites.get(), items, favoriteIds });
  return items;
}

async function refreshFavorites() {
  try {
    $favorites.set({ ...$favorites.get(), error: null });
    return applyData(await api.getFavourites());
  } catch (err: any) {
    $favorites.set({ ...$favorites.get(), error: err.message || 'Impossible de charger les favoris' });
    throw err;
  }
}

let started = false;
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let lastUserId: string | null | undefined;
  const load = async () => {
    $favorites.set({ ...$favorites.get(), loading: true });
    try {
      await refreshFavorites();
    } catch {
      /* error state already set */
    } finally {
      $favorites.set({ ...$favorites.get(), loading: false });
    }
  };
  authReady().then(() => {
    lastUserId = $user.get()?.id ?? null;
    load();
    $user.listen((user) => {
      const id = user?.id ?? null;
      if (id !== lastUserId) {
        lastUserId = id;
        load();
      }
    });
  });
}

async function toggleFavorite(payload: any) {
  if ($user.get()?.role === 'admin') {
    const msg = 'Les administrateurs ne peuvent pas ajouter de produits aux favoris.';
    $favorites.set({ ...$favorites.get(), error: msg });
    throw new Error(msg);
  }
  $favorites.set({ ...$favorites.get(), error: null });
  try {
    const body = typeof payload === 'string' ? { productId: payload } : payload;
    const res = await api.toggleFavourite(body);
    if (res?.favourites || res?.items) {
      applyData(res);
      return res.isFavourite;
    }
    return await refreshFavorites();
  } catch (err: any) {
    $favorites.set({ ...$favorites.get(), error: err.message || 'Impossible de mettre à jour les favoris' });
    throw err;
  }
}

const removeFavorite = async (payload: any) => {
  await toggleFavorite(typeof payload === 'string' ? { productId: payload } : payload);
};

export function useFavorites() {
  const state = useStore($favorites);
  useEffect(start, []);
  const isFavorite = useCallback(
    (productId: string, variantId: string | null = null) => {
      if (!productId) return false;
      if (variantId) return state.items.some((item) => item.productId === productId && item.variantId === variantId);
      return state.items.some((item) => item.productId === productId);
    },
    [state.items],
  );
  return { ...state, favorites: state.items, isFavorite, toggleFavorite, removeFavorite, refreshFavorites };
}
