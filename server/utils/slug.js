// A product's slug is its public address (/product/<slug>), so a long name is cut to a short one.
export const PRODUCT_SLUG_MAX_LENGTH = 80;

/** Cuts a slug at a word boundary (a hyphen) so it does not exceed `max`; a slug with no usable hyphen is cut as is. */
export function shortenSlug(slug, max = PRODUCT_SLUG_MAX_LENGTH) {
  const value = String(slug ?? '');
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastHyphen = cut.lastIndexOf('-');
  return (lastHyphen > max * 0.5 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, '');
}
