// Every API call an admin makes, in ONE wrapper used by the admin panel (src/admin-app) and by the admin tools on the shop
// pages (inline product editor, review moderation). Imported only by lazily loaded admin modules, so visitors never
// download it. It is the admin part of the old src/api/client.js merged with the calls the shop's editor already had.
import { getUserToken, request } from '../lib/apiClient';

const query = (params: Record<string, unknown> = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null) as [string, string][]).toString();
  return qs ? `?${qs}` : '';
};

export const adminApi = {
  // Admin panel session (password login -> JWT; the token is stored under the same keys as the shop's)
  adminLogin: (password: string) => request('/admin/login', { method: 'POST', body: { password } }),
  adminLogout: () => request('/admin/logout', { method: 'POST' }),

  // Inventory, drafts, manual orders, exchanges
  getAdminInventory: () => request('/admin/inventory'),
  updateAdminInventory: async (variantId: string, stockQuantity: number) => {
    const updated = await request(`/admin/inventory/${variantId}`, { method: 'PATCH', body: { stockQuantity } });
    // Sold out / in stock shows on the product page (and in its structured data).
    catalogueChanged();
    return updated;
  },
  createManualOrder: (data: any) => request('/admin/orders/manual', { method: 'POST', body: data }),
  getDrafts: () => request('/admin/drafts'),
  getDraft: (id: string) => request(`/admin/drafts/${id}`),
  createDraft: (data: any) => request('/admin/drafts', { method: 'POST', body: data }),
  saveDraft: (id: string, data: any) => request(`/admin/drafts/${id}`, { method: 'PATCH', body: data }),
  deleteDraft: (id: string) => request(`/admin/drafts/${id}`, { method: 'DELETE' }),
  confirmDraft: (id: string) => request(`/admin/drafts/${id}/confirm`, { method: 'POST' }),
  previewExchange: (orderId: string, data: any) => request(`/admin/orders/${orderId}/exchange/preview`, { method: 'POST', body: data }),
  createExchange: (orderId: string, data: any) => request(`/admin/orders/${orderId}/exchange`, { method: 'POST', body: data }),
  getAdminAnalytics: (params?: any) => request(`/admin/analytics${query({ granularity: params?.granularity, limit: params?.limit, piePeriod: params?.piePeriod })}`),

  // Theme (colours, announcement bar, hero): it shows on every page, so it needs a publish.
  getTheme: () => request('/theme'),
  updateTheme: async (theme: any) => {
    const saved = await request('/theme', { method: 'PUT', body: theme });
    catalogueChanged();
    return saved;
  },
  uploadThemeImage: (formData: FormData) => request('/theme/upload', { method: 'POST', body: formData }),

  // Products. Each call that changes what visitors see is followed by catalogueChanged() by the caller.
  getProducts: (params?: any) => request(`/products${query({ category: params?.category, search: params?.search, page: params?.page, limit: params?.limit, includeHidden: params?.includeHidden ? 'true' : undefined })}`),
  // The public list including hidden products (the API only returns them to an admin token).
  getAllProducts: () => request('/products?includeHidden=true'),
  getProduct: (id: string) => request(`/products/${id}`),
  getProductBySlug: (slug: string) => request(`/products/by-slug/${slug}`),
  createProduct: (product: any) => request('/products', { method: 'POST', body: product }),
  updateProduct: (id: string, product: any) => request(`/products/${id}`, { method: 'PUT', body: product }),
  deleteProduct: (id: string) => request(`/products/${id}`, { method: 'DELETE' }),
  uploadProductImage: (formData: FormData) => request('/products/upload', { method: 'POST', body: formData }),
  discardUploads: (urls: string[], options: Record<string, unknown> = {}) =>
    request('/products/uploads/discard', { method: 'POST', body: { urls }, ...options }),
  getProductVideos: (productId: string) => request(`/products/${productId}/videos`),
  uploadProductVideo: (productId: string, formData: FormData) => request(`/products/${productId}/videos`, { method: 'POST', body: formData }),
  deleteProductVideo: (productId: string, videoId: string) => request(`/products/${productId}/videos/${videoId}`, { method: 'DELETE' }),

  // Orders, deliveries (GOODEX), claims, refunds
  getOrders: () => request('/orders'),
  getOrder: (id: string) => request(`/orders/${id}`),
  createOrder: (order: any) => request('/orders', { method: 'POST', body: order }),
  confirmOrder: (id: string) => request(`/orders/${id}/confirm`, { method: 'POST' }),
  deliverOrder: (id: string) => request(`/orders/${id}/deliver`, { method: 'POST' }),
  confirmOrders: (orderIds: string[]) => request('/orders/bulk-confirm', { method: 'POST', body: { orderIds } }),
  updateOrderStatus: (id: string, status: string) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),
  updateOrdersStatus: (orderIds: string[], status: string) => request('/orders/bulk-status', { method: 'PATCH', body: { orderIds, status } }),
  cancelOrder: (id: string) => request(`/orders/${id}/cancel`, { method: 'POST' }),
  refundOrder: (id: string, data: any = {}) => request(`/orders/${id}/refund`, { method: 'POST', body: data }),
  refreshOrderDelivery: (id: string, { onlyIfStale = false } = {}) =>
    request(`/orders/${id}/delivery/refresh`, { method: 'POST', body: { onlyIfStale } }),
  retryOrderDelivery: (id: string, acknowledgeUnknown = false) =>
    request(`/orders/${id}/delivery/retry`, { method: 'POST', body: { acknowledgeUnknown } }),
  refreshExchangeDelivery: (exchangeId: string, { onlyIfStale = false } = {}) =>
    request(`/orders/exchanges/${exchangeId}/delivery/refresh`, { method: 'POST', body: { onlyIfStale } }),
  retryExchangeDelivery: (exchangeId: string, acknowledgeUnknown = false) =>
    request(`/orders/exchanges/${exchangeId}/delivery/retry`, { method: 'POST', body: { acknowledgeUnknown } }),
  refreshRefundDelivery: (refundId: string, { onlyIfStale = false } = {}) =>
    request(`/orders/refunds/${refundId}/delivery/refresh`, { method: 'POST', body: { onlyIfStale } }),
  retryRefundDelivery: (refundId: string, acknowledgeUnknown = false) =>
    request(`/orders/refunds/${refundId}/delivery/retry`, { method: 'POST', body: { acknowledgeUnknown } }),
  getClaimTypes: () => request('/orders/claims/types'),
  getClaimCounts: () => request('/orders/claims/counts'),
  getRemoteClaims: (params: Record<string, unknown> = {}) => request(`/orders/claims/remote${query(params)}`),
  getOrderClaims: (id: string) => request(`/orders/${id}/claims`),
  openOrderClaim: (id: string, body: any) => request(`/orders/${id}/claims`, { method: 'POST', body }),
  syncOrderClaims: (id: string) => request(`/orders/${id}/claims/sync`, { method: 'POST' }),
  refreshClaim: (claimId: string) => request(`/orders/claims/${claimId}/refresh`, { method: 'POST' }),
  cancelClaim: (claimId: string) => request(`/orders/claims/${claimId}`, { method: 'DELETE' }),

  // Reviews (site reviews, product reviews) and the photo gallery of the reviews page
  getAllReviews: () => request('/reviews'),
  updateReviewStatus: (id: string, status: string) => request(`/reviews/${id}`, { method: 'PATCH', body: { status } }),
  deleteReview: (id: string) => request(`/reviews/${id}`, { method: 'DELETE' }),
  getAdminProductReviews: (productId: string) => request(`/products/${productId}/admin-reviews`),
  updateAdminProductReview: (id: string, data: any) => request(`/products/reviews/${id}`, { method: 'PATCH', body: data }),
  deleteAdminProductReview: (id: string) => request(`/products/reviews/${id}`, { method: 'DELETE' }),
  getGallery: () => request('/gallery'),
  addGalleryItem: (formData: FormData) => request('/gallery', { method: 'POST', body: formData }),
  deleteGalleryItem: (id: string) => request(`/gallery/${id}`, { method: 'DELETE' }),

  // Contact messages and notifications
  getContactMessages: () => request('/contact'),
  getContactMessage: (id: string) => request(`/contact/${id}`),
  sendContactReply: (id: string, data: any) => request(`/contact/${id}/reply`, { method: 'POST', body: data }),
  getNotifications: () => request('/notifications'),
  getAllNotifications: (params?: any) => request(`/notifications/all${query({ offset: params?.offset, limit: params?.limit })}`),
  markNotificationRead: (id: string) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),

  getGovernorates: () => request('/governorates'),
};

/** The browser event that asks the "site publication" banner (admin-app/components/PublishStatus.jsx) to look again. */
export const CATALOGUE_CHANGED_EVENT = 'silky:catalogue-changed';

/**
 * Call after an admin change that visitors can see. Nothing is purged and nothing is sent: the SERVER notices a change to the
 * public site on its own (a write request, then one look at the catalogue, services/publish.service.js) and starts a publish if a
 * deploy hook is set. This only makes the banner refresh. Never throws.
 */
export function catalogueChanged() {
  try {
    window.dispatchEvent(new Event(CATALOGUE_CHANGED_EVENT));
  } catch {
    // no window (server rendering): nothing to refresh
  }
}

export type PublishStatus = {
  /** Fingerprint of the catalogue as the public site would be built from it right now. */
  fingerprint: string;
  hookConfigured: boolean;
  lastHook: { at: string; ok: boolean; message: string | null; forCurrentCatalogue: boolean } | null;
};
export type BuildInfo = { fingerprint: string; snapshotGeneratedAt: string; builtAt: string; products: number } | null;

export const getPublishStatus = (): Promise<PublishStatus> => request('/publish/status');
export const publishNow = (): Promise<{ ok: boolean; fingerprint: string }> => request('/publish', { method: 'POST' });

/** What the LIVE site was built from (build-info.json, a file of the deployed site: same origin as the admin). null when unavailable. */
export async function getBuildInfo(): Promise<BuildInfo> {
  try {
    const res = await fetch('/build-info.json', { cache: 'no-store' });
    if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) return null;
    const info = await res.json();
    return typeof info?.fingerprint === 'string' ? info : null;
  } catch {
    return null;
  }
}
