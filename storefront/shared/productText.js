// Product name and description in the language of the page. The Arabic text is optional (`nameAr`, `descriptionAr`,
// written in the admin); a product without it shows its French text. Pure: no DOM, no React.

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

export function productName(product, locale = 'fr') {
  return (locale === 'ar' && clean(product?.nameAr)) || product?.name || '';
}

/** Name of a cart line (`name`, `nameAr` as the cart API sends them) in the page language: the Arabic name when there is one. */
export function cartItemName(item, locale = 'fr') {
  return productName({ name: item?.name, nameAr: item?.nameAr }, locale);
}

export function productDescription(product, locale = 'fr') {
  return (locale === 'ar' && clean(product?.descriptionAr)) || product?.description || '';
}

/**
 * Alt text of one product photo: what this photo shows, in a few words (name, colour, which photo of the set), as
 * search engines and screen readers expect. The description is page text, not alt text: repeating it on every photo
 * would be keyword stuffing. `positionText` is the translated "photo 2 of 5", given only when the colour has several.
 */
export function productImageAlt(name, { colorName = '', positionText = '' } = {}) {
  const color = clean(colorName);
  const position = clean(positionText);
  return `${clean(name)}${color ? ` – ${color}` : ''}${position ? `, ${position}` : ''}`;
}

/**
 * The custom alt text the admin wrote for the product's photos (`imageAlt`, `imageAltAr`): ONE text shared by every photo
 * of the product. The Arabic page uses the Arabic text, then the French one; '' when the admin wrote none, and the caller
 * keeps its generated alt (`productImageAlt`).
 */
export function productCustomAlt(product, locale = 'fr') {
  return (locale === 'ar' && clean(product?.imageAltAr)) || clean(product?.imageAlt);
}

/** Both the Arabic name and description exist: only then is the Arabic page a real translation worth indexing. */
export const hasArabicProduct = (product) => Boolean(clean(product?.nameAr) && clean(product?.descriptionAr));

/** The product with `name` and `description` replaced by the page language's text (for metadata builders only). */
export function localizedProductView(product, locale = 'fr') {
  if (!product || locale !== 'ar') return product;
  return { ...product, name: productName(product, locale), description: productDescription(product, locale) };
}
