// Browser-side API client (port of the old src/api/client.js, storefront calls only). Base address: PUBLIC_API_URL.
// credentials: 'include' + the guest id header keep the cart and favourites of a visitor who is not logged in.
import { $guestId, clearUserAuth, getStoredUser, getUserToken, setUserAuth } from '../stores/session';

export { getStoredUser, getUserToken, setUserAuth, clearUserAuth };

const API_BASE = `${String(import.meta.env.PUBLIC_API_URL ?? '').replace(/\/+$/, '')}/api`;

function getGuestSessionId() {
  let id = $guestId.get();
  if (!id && typeof crypto !== 'undefined' && crypto.randomUUID) {
    id = crypto.randomUUID();
    $guestId.set(id);
  }
  return id;
}

export async function request(path: string, options: any = {}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const userToken = getUserToken();
  if (userToken) headers.Authorization = `Bearer ${userToken}`;

  const guestSessionId = getGuestSessionId();
  if (guestSessionId) headers['X-Guest-Session-ID'] = guestSessionId;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
    body:
      options.body instanceof FormData || typeof options.body === 'string'
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined,
  });

  const newGuestSession = res.headers.get('X-Guest-Session-ID');
  if (newGuestSession) $guestId.set(newGuestSession);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // Credential-validation endpoints legitimately return 401 for wrong credentials: they must not end the session.
    const isCredentialValidation = path === '/auth/change-password' || path === '/admin/login';
    if (res.status === 401 && getUserToken() && !isCredentialValidation) {
      clearUserAuth();
      throw new Error(err.error || 'Session expirée. Veuillez vous reconnecter.');
    }
    const failure: any = new Error(err.error || 'Request failed');
    failure.status = res.status;
    throw failure;
  }
  return res.json();
}

export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const api = {
  // Customer auth
  register: (data: any) => request('/auth/register', { method: 'POST', body: data }),
  login: (data: any) => request('/auth/login', { method: 'POST', body: data }),
  forgotPassword: (email: string) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (data: any) => request('/auth/reset-password', { method: 'POST', body: data }),
  getMe: () => request('/auth/me'),
  updateProfile: (data: any) => request('/auth/me', { method: 'PATCH', body: data }),
  changePassword: async (data: any) => {
    const result = await request('/auth/change-password', { method: 'POST', body: data });
    // A password change ends the old sessions; the server sends a fresh token so this browser stays signed in.
    if (result?.token) setUserAuth(result.token, getStoredUser());
    return result;
  },
  adminLogout: () => request('/admin/logout', { method: 'POST' }),
  getTheme: () => request('/theme'),
  getProducts: (params?: any) => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.includeHidden) query.set('includeHidden', 'true');
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/products${suffix}`);
  },
  getProduct: (id: string) => request(`/products/${id}`),
  getProductBySlug: (slug: string) => request(`/products/by-slug/${slug}`),
  getProductReviews: (id: string) => request(`/products/${id}/reviews`),
  submitProductReview: (id: string, review: any) => request(`/products/${id}/reviews`, { method: 'POST', body: review }),
  getCart: () => request('/cart'),
  addCartItem: (item: any) => request('/cart/items', { method: 'POST', body: item }),
  removeCartItem: (id: string) => request(`/cart/items/${id}`, { method: 'DELETE' }),
  getFavourites: () => request('/favourites'),
  toggleFavourite: (payload: any) => {
    const body = typeof payload === 'string' ? { productId: payload } : payload;
    return request('/favourites/toggle', { method: 'POST', body });
  },
  checkout: (customer: any, buyNowItem: any = null, idempotencyKey: string | null = null) => {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return request('/orders/checkout', { method: 'POST', headers, body: { customer, buyNowItem } });
  },
  getMyOrders: () => request('/orders/mine'),
  getOrder: (id: string) => request(`/orders/${id}`),
  cancelOrder: (id: string) => request(`/orders/${id}/cancel`, { method: 'POST' }),
  getPublishedReviews: () => request('/reviews/published'),
  submitReview: (review: any) => request('/reviews', { method: 'POST', body: review }),
  submitContactMessage: (data: any) => request('/contact', { method: 'POST', body: data }),
  getGovernorates: () => request('/governorates'),
};
