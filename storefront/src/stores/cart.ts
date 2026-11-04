// The visitor's cart (replaces the old CartContext). The cart itself lives on the API (keyed by the logged-in
// customer or the guest id); this store mirrors it for every island of the page and reloads it when the customer
// logs in or out.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
import { api } from '../lib/apiClient';
import { authReady } from './auth';
import { $user } from './session';

type CartState = {
  items: any[];
  deliveryFee: number;
  subtotal: number;
  total: number;
  itemCount: number;
  loading: boolean;
  error: string | null;
  lastAddedAt: number | null;
};

const empty: CartState = { items: [], deliveryFee: 0, subtotal: 0, total: 0, itemCount: 0, loading: true, error: null, lastAddedAt: null };
const $cart = atom<CartState>(empty);

const apply = (cart: any, extra: Partial<CartState> = {}) =>
  $cart.set({
    ...$cart.get(),
    items: (cart.items || []).map((item: any) => ({ ...item, cartItemId: item.id })),
    deliveryFee: cart.deliveryFee,
    subtotal: cart.subtotal,
    total: cart.total,
    itemCount: cart.itemCount,
    error: null,
    ...extra,
  });

async function refreshCart() {
  try {
    const cart = await api.getCart();
    apply(cart);
    return cart;
  } catch (err: any) {
    $cart.set({ ...$cart.get(), error: err.message || 'Impossible de charger le panier' });
    throw err;
  }
}

let started = false;
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let lastUserId: string | null | undefined;
  const load = async () => {
    $cart.set({ ...empty });
    try {
      await refreshCart();
    } catch {
      /* error state already set */
    } finally {
      $cart.set({ ...$cart.get(), loading: false });
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

async function addItem(item: any) {
  $cart.set({ ...$cart.get(), error: null });
  try {
    const cart = await api.addCartItem({
      productId: item.productId,
      colorId: item.colorId,
      size: item.size,
      quantity: Math.max(1, Number(item.quantity) || 1),
    });
    apply(cart, { lastAddedAt: Math.max(Date.now(), ($cart.get().lastAddedAt || 0) + 1) });
    return cart;
  } catch (err: any) {
    $cart.set({ ...$cart.get(), error: err.message || "Impossible d'ajouter au panier" });
    throw err;
  }
}

async function updateQuantity(cartItemId: string, delta: number) {
  const item = $cart.get().items.find((i) => i.cartItemId === cartItemId);
  if (!item) return;
  const newQty = item.quantity + delta;
  $cart.set({ ...$cart.get(), error: null });
  try {
    if (newQty <= 0) {
      const cart = await api.removeCartItem(cartItemId);
      apply(cart);
      return cart;
    }
    if (delta > 0) {
      const cart = await api.addCartItem({ productId: item.productId, colorId: item.colorId, size: item.size, quantity: delta });
      apply(cart);
      return cart;
    }
    await api.removeCartItem(cartItemId);
    const cart = await api.addCartItem({ productId: item.productId, colorId: item.colorId, size: item.size, quantity: newQty });
    apply(cart);
    return cart;
  } catch (err: any) {
    $cart.set({ ...$cart.get(), error: err.message || 'Impossible de mettre à jour la quantité' });
    throw err;
  }
}

async function removeItem(cartItemId: string) {
  $cart.set({ ...$cart.get(), error: null });
  try {
    const cart = await api.removeCartItem(cartItemId);
    apply(cart);
    return cart;
  } catch (err: any) {
    $cart.set({ ...$cart.get(), error: err.message || "Impossible de supprimer l'article" });
    throw err;
  }
}

function clearCart() {
  $cart.set({ ...$cart.get(), items: [], subtotal: 0, total: 0, itemCount: 0, deliveryFee: 0 });
}

export function useCart() {
  const state = useStore($cart);
  useEffect(start, []);
  return { ...state, addItem, updateQuantity, removeItem, clearCart, refreshCart };
}
