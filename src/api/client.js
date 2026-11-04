const API_BASE = '/api';



const GUEST_SESSION_KEY = 'silky_guest_session_id';

const USER_TOKEN_KEY = 'silky_auth_token';

const USER_KEY = 'silky_auth_user';



export function getUserToken() {

  return localStorage.getItem(USER_TOKEN_KEY);

}



export function setUserAuth(token, user) {

  if (token) {

    localStorage.setItem(USER_TOKEN_KEY, token);

    localStorage.setItem(USER_KEY, JSON.stringify(user));

  } else {

    localStorage.removeItem(USER_TOKEN_KEY);

    localStorage.removeItem(USER_KEY);

  }

}



export function clearUserAuth() {

  setUserAuth(null);

  window.dispatchEvent(new Event('silky:auth-expired'));

}



export function getStoredUser() {

  try {

    const raw = localStorage.getItem(USER_KEY);

    return raw ? JSON.parse(raw) : null;

  } catch {

    return null;

  }

}



function getGuestSessionId() {
  let id = localStorage.getItem(GUEST_SESSION_KEY);
  if (!id && typeof crypto !== 'undefined' && crypto.randomUUID) {
    id = crypto.randomUUID();
    localStorage.setItem(GUEST_SESSION_KEY, id);
  }
  return id;
}



function setGuestSessionId(id) {

  if (id) localStorage.setItem(GUEST_SESSION_KEY, id);

}



async function request(path, options = {}) {

  const headers = { ...options.headers };

  if (options.body && !(options.body instanceof FormData)) {

    headers['Content-Type'] = 'application/json';

  }



  const userToken = getUserToken();

  if (userToken) headers.Authorization = `Bearer ${userToken}`;



  const guestSessionId = getGuestSessionId();

  if (guestSessionId) {

    headers['X-Guest-Session-ID'] = guestSessionId;

  }



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

  if (newGuestSession) {

    setGuestSessionId(newGuestSession);

  }



  if (!res.ok) {

    const err = await res.json().catch(() => ({ error: res.statusText }));

    // Only auto-logout on 401 for general auth failures (expired/invalid session).
    // Credential-validation endpoints (change-password, admin login) legitimately
    // return 401 for wrong credentials — they should NOT clear the current session.
    const isCredentialValidation =
      path === '/auth/change-password' || path === '/admin/login';

    if (res.status === 401 && getUserToken() && !isCredentialValidation) {

      clearUserAuth();

      throw new Error(err.error || 'Session expirée. Veuillez vous reconnecter.');

    }

    const failure = new Error(err.error || 'Request failed');
    failure.status = res.status;
    throw failure;

  }



  return res.json();

}



export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const api = {
  // Customer auth
  register: (data) => request('/auth/register', { method: 'POST', body: data }),
  login: (data) => request('/auth/login', { method: 'POST', body: data }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (data) => request('/auth/reset-password', { method: 'POST', body: data }),
  getMe: () => request('/auth/me'),
  updateProfile: (data) => request('/auth/me', { method: 'PATCH', body: data }),
  changePassword: async (data) => {
    const result = await request('/auth/change-password', { method: 'POST', body: data });
    // A password change ends the old sessions; the server sends a fresh token so this browser stays signed in.
    if (result?.token) setUserAuth(result.token, getStoredUser());
    return result;
  },

  // Admin panel (password login → JWT)
  adminLogin: (password) => request('/admin/login', { method: 'POST', body: { password } }),
  adminLogout: () => request('/admin/logout', { method: 'POST' }),
  getAdminInventory: () => request('/admin/inventory'),
  updateAdminInventory: (variantId, stockQuantity) =>
    request(`/admin/inventory/${variantId}`, { method: 'PATCH', body: { stockQuantity } }),
  createManualOrder: (data) => request('/admin/orders/manual', { method: 'POST', body: data }),
  // Admin Draft Orders (Brouillons)
  getDrafts: () => request('/admin/drafts'),
  getDraft: (id) => request(`/admin/drafts/${id}`),
  createDraft: (data) => request('/admin/drafts', { method: 'POST', body: data }),
  saveDraft: (id, data) => request(`/admin/drafts/${id}`, { method: 'PATCH', body: data }),
  deleteDraft: (id) => request(`/admin/drafts/${id}`, { method: 'DELETE' }),
  confirmDraft: (id) => request(`/admin/drafts/${id}/confirm`, { method: 'POST' }),
  previewExchange: (orderId, data) => request(`/admin/orders/${orderId}/exchange/preview`, { method: 'POST', body: data }),
  createExchange: (orderId, data) => request(`/admin/orders/${orderId}/exchange`, { method: 'POST', body: data }),
  getAdminAnalytics: (params) => {
    const query = new URLSearchParams();
    if (params?.granularity) query.set('granularity', params.granularity);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.piePeriod) query.set('piePeriod', params.piePeriod);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/admin/analytics${suffix}`);
  },

  getTheme: () => request('/theme'),
  updateTheme: (theme) => request('/theme', { method: 'PUT', body: theme }),
  uploadThemeImage: (formData) => request('/theme/upload', { method: 'POST', body: formData }),

  getProducts: (params) => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.includeHidden) query.set('includeHidden', 'true');
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/products${suffix}`);
  },
  getProduct: (id) => request(`/products/${id}`),
  getProductReviews: (id) => request(`/products/${id}/reviews`),
  submitProductReview: (id, review) =>
    request(`/products/${id}/reviews`, { method: 'POST', body: review }),

  getCart: () => request('/cart'),
  addCartItem: (item) => request('/cart/items', { method: 'POST', body: item }),
  removeCartItem: (id) => request(`/cart/items/${id}`, { method: 'DELETE' }),

  getFavourites: () => request('/favourites'),
  toggleFavourite: (payload) => {
    const body = typeof payload === 'string' ? { productId: payload } : payload;
    return request('/favourites/toggle', { method: 'POST', body });
  },

  checkout: (customer, buyNowItem = null, idempotencyKey = null) => {
    const headers = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return request('/orders/checkout', {
      method: 'POST',
      headers,
      body: { customer, buyNowItem },
    });
  },


  createProduct: (product) => request('/products', { method: 'POST', body: product }),

  updateProduct: (id, product) => request(`/products/${id}`, { method: 'PUT', body: product }),

  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),

  uploadProductImage: (formData) => request('/products/upload', { method: 'POST', body: formData }),

  getProductVideos: (productId) => request(`/products/${productId}/videos`),

  uploadProductVideo: (productId, formData) => request(`/products/${productId}/videos`, { method: 'POST', body: formData }),

  deleteProductVideo: (productId, videoId) => request(`/products/${productId}/videos/${videoId}`, { method: 'DELETE' }),



  getOrders: () => request('/orders'),

  getMyOrders: () => request('/orders/mine'),

  getOrder: (id) => request(`/orders/${id}`),

  createOrder: (order) => request('/orders', { method: 'POST', body: order }),

  confirmOrder: (id) => request(`/orders/${id}/confirm`, { method: 'POST' }),

  deliverOrder: (id) => request(`/orders/${id}/deliver`, { method: 'POST' }),

  confirmOrders: (orderIds) => request('/orders/bulk-confirm', { method: 'POST', body: { orderIds } }),

  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  updateOrdersStatus: (orderIds, status) => request('/orders/bulk-status', { method: 'PATCH', body: { orderIds, status } }),

  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'POST' }),
  refreshOrderDelivery: (id, { onlyIfStale = false } = {}) =>
    request(`/orders/${id}/delivery/refresh`, { method: 'POST', body: { onlyIfStale } }),
  retryOrderDelivery: (id, acknowledgeUnknown = false) =>
    request(`/orders/${id}/delivery/retry`, { method: 'POST', body: { acknowledgeUnknown } }),
  refreshExchangeDelivery: (exchangeId, { onlyIfStale = false } = {}) =>
    request(`/orders/exchanges/${exchangeId}/delivery/refresh`, { method: 'POST', body: { onlyIfStale } }),
  retryExchangeDelivery: (exchangeId, acknowledgeUnknown = false) =>
    request(`/orders/exchanges/${exchangeId}/delivery/retry`, { method: 'POST', body: { acknowledgeUnknown } }),
  refreshRefundDelivery: (refundId, { onlyIfStale = false } = {}) =>
    request(`/orders/refunds/${refundId}/delivery/refresh`, { method: 'POST', body: { onlyIfStale } }),
  retryRefundDelivery: (refundId, acknowledgeUnknown = false) =>
    request(`/orders/refunds/${refundId}/delivery/retry`, { method: 'POST', body: { acknowledgeUnknown } }),
  // GOODEX claims (tickets)
  getClaimTypes: () => request('/orders/claims/types'),
  getClaimCounts: () => request('/orders/claims/counts'),
  getRemoteClaims: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null)).toString();
    return request('/orders/claims/remote' + (qs ? '?' + qs : ''));
  },
  getOrderClaims: (id) => request(`/orders/${id}/claims`),
  openOrderClaim: (id, body) => request(`/orders/${id}/claims`, { method: 'POST', body }),
  syncOrderClaims: (id) => request(`/orders/${id}/claims/sync`, { method: 'POST' }),
  refreshClaim: (claimId) => request(`/orders/claims/${claimId}/refresh`, { method: 'POST' }),
  cancelClaim: (claimId) => request(`/orders/claims/${claimId}`, { method: 'DELETE' }),

  refundOrder: (id, data = {}) => request(`/orders/${id}/refund`, { method: 'POST', body: data }),



  getPublishedReviews: () => request('/reviews/published'),

  submitReview: (review) => request('/reviews', { method: 'POST', body: review }),

  getAllReviews: () => request('/reviews'),

  updateReviewStatus: (id, status) => request(`/reviews/${id}`, { method: 'PATCH', body: { status } }),

  deleteReview: (id) => request(`/reviews/${id}`, { method: 'DELETE' }),



  getAdminProductReviews: (productId) => request(`/products/${productId}/admin-reviews`),

  updateAdminProductReview: (id, data) => request(`/products/reviews/${id}`, { method: 'PATCH', body: data }),

  deleteAdminProductReview: (id) => request(`/products/reviews/${id}`, { method: 'DELETE' }),

  getGallery: () => request('/gallery'),

  addGalleryItem: (formData) => request('/gallery', { method: 'POST', body: formData }),

  deleteGalleryItem: (id) => request(`/gallery/${id}`, { method: 'DELETE' }),



  // Contact messages

  submitContactMessage: (data) => request('/contact', { method: 'POST', body: data }),

  getContactMessages: () => request('/contact'),

  getContactMessage: (id) => request(`/contact/${id}`),

  sendContactReply: (id, data) => request(`/contact/${id}/reply`, { method: 'POST', body: data }),

  // Admin Notifications

  getNotifications: () => request('/notifications'),

  getAllNotifications: (params) => {
    const query = new URLSearchParams();
    if (params?.offset !== undefined) query.set('offset', String(params.offset));
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/notifications/all${suffix}`);
  },

  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),

  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),

  // Governorates
  getGovernorates: () => request('/governorates'),

};



