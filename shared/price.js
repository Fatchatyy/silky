export function getEffectivePrice(product) {
  const price = Number(product?.price) || 0;
  const discount = Number(product?.discount) || 0;
  if (discount > 0 && discount < price) return price - discount;
  return price;
}

export function hasDiscount(product) {
  const price = Number(product?.price) || 0;
  const discount = Number(product?.discount) || 0;
  return discount > 0 && discount < price;
}
