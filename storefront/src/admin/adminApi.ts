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
    if (updated?.productId) await purgeStorefrontCache({ productId: updated.productId });
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

  // Theme (colours, announcement bar, hero). Saving also clears the cached pages: it shows on every page.
  getTheme: () => request('/theme'),
  updateTheme: async (theme: any) => {
    const saved = await request('/theme', { method: 'PUT', body: theme });
    await purgeStorefrontCache({ all: true });
    return saved;
  },
  uploadThemeImage: (formData: FormData) => request('/theme/upload', { method: 'POST', body: formData }),

  // Products. Each call that changes what visitors see is followed by the cache purge by the caller (see purgeProductPages).
  getProducts: (params?: any) => request(`/products${query({ category: params?.category, search: params?.search, page: params?.page, limit: params?.limit, includeHidden: params?.includeHidden ? 'true' : undefined })}`),
  // The public list including hidden products (the API only returns them to an admin token).
  getAllProducts: () => request('/products?includeHidden=true'),
  getProduct: (id: string) => request(`/products/${id}`),
  getProductBySlug: (slug: string) => request(`/products/by-slug/${slug}`),
  createProduct: (product: any) => request('/products', { method: 'POST', body: product }),
  updateProduct: (id: string, product: any) => request(`/products/${id}`, { method: 'PUT', body: product }),
  deleteProduct: (id: string) => request(`/products/${id}`, { method: 'DELETE' }),
  uploadProductImage: (formData: FormData) => request('/products/upload', { method: 'POST', body: formData }),
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

type PurgeRequest = { slug?: string; category?: string; previousCategory?: string; all?: boolean };

/**
 * Tells the storefront server that something visitors see changed, so the cached pages that show it are dropped: for a
 * product, its page in French and Arabic, its collection(s), the home page and the sitemap; with `all`, every cached page
 * (colours, announcement bar and hero show on all of them). Never throws: the change itself already succeeded.
 */
export async function purgeStorefrontCache(change: PurgeRequest) {
  try {
    const token = getUserToken();
    const res = await fetch('/internal/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(change),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** After a product was created, saved, hidden/shown, moved to another collection or deleted: `next` is the product as saved, `previous` as it was. */
export function purgeProductPages(next?: any, previous?: any) {
  return purgeStorefrontCache({
    slug: next?.slug || previous?.slug,
    category: next?.category || previous?.category,
    previousCategory: previous?.category,
  });
}
