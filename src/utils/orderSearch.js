/**
 * Free-text search over the admin orders list. Matches (case-insensitive, partial) the
 * order number, order id, customer name, phone, e-mail and the GOODEX tracking code (EAN).
 * Extracted verbatim from AdminOrders so it can be unit-tested; an empty query matches all.
 */
export function orderMatchesSearch(order, query) {
  if (!query || !query.trim()) return true;
  const q = query.toLowerCase().trim();
  const orderNumMatch = order.orderNumber?.toLowerCase().includes(q);
  const orderIdMatch = order.id?.toLowerCase().includes(q);
  const firstName = (order.customer?.firstName || order.customer?.name || '').toLowerCase();
  const lastName = (order.customer?.lastName || '').toLowerCase();
  const fullName = `${firstName} ${lastName}`.trim();
  const nameMatch = firstName.includes(q) || lastName.includes(q) || fullName.includes(q);
  const phoneMatch = order.customer?.phone?.toLowerCase().includes(q);
  const emailMatch = order.customer?.email?.toLowerCase().includes(q);
  const eanMatch = order.delivery?.ean?.toLowerCase().includes(q);

  return Boolean(orderNumMatch || orderIdMatch || nameMatch || phoneMatch || emailMatch || eanMatch);
}
