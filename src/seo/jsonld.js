// schema.org structured data built only from data the product page shows. Pure: no DOM, no React.
// Every URL in structured data must be absolute, so these builders return null until a site URL is configured.
import { getEffectivePrice } from '../../shared/price.js';
import { isProductOutOfStock } from '../../shared/stock.js';
import { imageVariantPath } from '../../shared/imageVariants.js';
import { colorNameAr } from '../../shared/colors.js';
import { CONTACT } from '../../shared/contact.js';
import { DELIVERY_FEE_TND } from '../../shared/delivery.js';
import { cleanText } from './meta.js';
import { SITE_NAME, absoluteUrl, localizedPath, productPath, publicImagePath } from '../../shared/urls.js';

const SCHEMA = 'https://schema.org';

const meaningful = (value) => {
  const text = cleanText(value);
  return text && text.toLowerCase() !== 'default' ? text : '';
};

/**
 * One entry per sellable variant (size and/or colour) with its own SKU, taken from the product's variants:
 * { sku, colorKey, color, size, imagePath, inStock }. Variants without a SKU or id, and repeated SKUs, are left out.
 */
function variantEntries(product, locale) {
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const seen = new Set();
  const entries = [];
  for (const variant of Array.isArray(product.variants) ? product.variants : []) {
    if (!variant) continue;
    const sku = cleanText(variant.sku) || cleanText(variant.id);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const colorName = meaningful(variant.colorName);
    const colorEntry = colors.find((color) => color && variant.colorSlug && color.id === variant.colorSlug);
    entries.push({
      sku,
      colorKey: colorName ? cleanText(variant.colorSlug || colorName).toLowerCase() : '',
      color: colorName && locale === 'ar' ? colorNameAr(colorName, colors) : colorName,
      size: meaningful(variant.size),
      imagePath: [colorEntry?.thumbnail, colorEntry?.images?.[0], variant.colorImageUrl].map(publicImagePath).find(Boolean) || null,
      inStock: Number(variant.stockQuantity ?? variant.stock ?? 0) > 0,
    });
  }
  return entries;
}

/**
 * Product + Offer. Price and discount live on the product (variants have no price), so every offer is at the effective
 * price in TND. `rating` is the approved-review summary ({ average, count }) that the product page displays.
 *
 * A product sold in several sizes or colours becomes a ProductGroup with one Product per variant (own SKU, colour,
 * size, photo of the colour and its own InStock / OutOfStock), as Google describes for product variants; the page is
 * one URL, so every variant points at it. A product with a single variant, or without a price, stays a plain Product.
 */
export function buildProductJsonLd(product, { siteUrl, rating, locale = 'fr', deliveryFee = null } = {}) {
  if (!product || product.isHidden || product.is_active === false) return null;
  const url = absoluteUrl(siteUrl, localizedPath(productPath(product), locale));
  if (!url) return null;

  const name = cleanText(product.name);
  const brand = { '@type': 'Brand', name: SITE_NAME };
  const description = cleanText(product.description);

  const imagePaths = [product.mainImage, ...(product.thumbnails || [])]
    .map(publicImagePath)
    .filter(Boolean)
    .map((path) => imageVariantPath(path, 'share'));
  const images = [...new Set(imagePaths)].map((path) => absoluteUrl(siteUrl, path));

  const price = getEffectivePrice(product);
  // Delivery in Tunisia within 24 to 48 hours (what the delivery page states), at the fee customers are charged
  // (`deliveryFee`, from the shop settings); without it, the amount the delivery page states.
  const shippingDetails = {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: Number.isFinite(deliveryFee) && deliveryFee >= 0 ? deliveryFee : DELIVERY_FEE_TND, currency: 'TND' },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'TN' },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
    },
  };
  const buildOffer = () => ({ '@type': 'Offer', url, price: price.toFixed(3), priceCurrency: 'TND', shippingDetails });

  const aggregateRating =
    rating && Number(rating.count) > 0
      ? { '@type': 'AggregateRating', ratingValue: Number(rating.average), reviewCount: Number(rating.count), bestRating: 5, worstRating: 1 }
      : null;

  const entries = price > 0 ? variantEntries(product, locale) : [];
  const colorCount = new Set(entries.map((entry) => entry.colorKey).filter(Boolean)).size;
  const sizeCount = new Set(entries.map((entry) => entry.size).filter(Boolean)).size;

  if (entries.length >= 2 && (colorCount >= 2 || sizeCount >= 2)) {
    const group = { '@context': SCHEMA, '@type': 'ProductGroup', name, url, productGroupID: String(product.id), brand };
    if (description) group.description = description;
    if (images.length) group.image = images;
    group.variesBy = [colorCount >= 2 && `${SCHEMA}/color`, sizeCount >= 2 && `${SCHEMA}/size`].filter(Boolean);
    group.hasVariant = entries.map((entry) => {
      const variant = { '@type': 'Product', name: [name, [entry.color, entry.size].filter(Boolean).join(', ')].filter(Boolean).join(' – '), sku: entry.sku, url };
      if (entry.color) variant.color = entry.color;
      if (entry.size) variant.size = entry.size;
      if (entry.imagePath) variant.image = absoluteUrl(siteUrl, imageVariantPath(entry.imagePath, 'share'));
      variant.offers = { ...buildOffer(), availability: `${SCHEMA}/${entry.inStock ? 'InStock' : 'OutOfStock'}` };
      return variant;
    });
    if (aggregateRating) group.aggregateRating = aggregateRating;
    return group;
  }

  const data = { '@context': SCHEMA, '@type': 'Product', name, url, brand };
  if (description) data.description = description;
  if (images.length) data.image = images;

  if (price > 0) {
    data.offers = buildOffer();
    const hasStockData = Object.keys(product.stock || {}).length > 0 || (product.variants || []).length > 0;
    if (hasStockData) {
      data.offers.availability = `${SCHEMA}/${isProductOutOfStock(product) ? 'OutOfStock' : 'InStock'}`;
    }
  }
  if (aggregateRating) data.aggregateRating = aggregateRating;

  return data;
}

/** Organization for the home page: name, site, logo, phone, e-mail and social profiles the shop already shows. */
export function buildOrganizationJsonLd({ siteUrl } = {}) {
  const url = absoluteUrl(siteUrl, '/');
  if (!url) return null;
  return {
    '@context': SCHEMA,
    '@type': 'Organization',
    name: CONTACT.name,
    url,
    logo: absoluteUrl(siteUrl, CONTACT.logoPath),
    telephone: CONTACT.telephone,
    email: CONTACT.email,
    sameAs: CONTACT.socialProfiles,
  };
}

/** FAQPage from [{ question, answer }] in plain text: the questions and answers the FAQ page shows. */
export function buildFaqJsonLd(entries, { siteUrl } = {}) {
  const list = (entries || []).filter((entry) => entry && cleanText(entry.question) && cleanText(entry.answer));
  if (!list.length || !absoluteUrl(siteUrl, '/')) return null;
  return {
    '@context': SCHEMA,
    '@type': 'FAQPage',
    mainEntity: list.map((entry) => ({
      '@type': 'Question',
      name: cleanText(entry.question),
      acceptedAnswer: { '@type': 'Answer', text: cleanText(entry.answer) },
    })),
  };
}

/** BreadcrumbList from [{ name, path }], most general first. */
export function buildBreadcrumbJsonLd(items, { siteUrl } = {}) {
  const list = (items || []).filter((item) => item && cleanText(item.name) && item.path);
  if (!list.length || !absoluteUrl(siteUrl, '/')) return null;
  return {
    '@context': SCHEMA,
    '@type': 'BreadcrumbList',
    itemListElement: list.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: cleanText(item.name),
      item: absoluteUrl(siteUrl, item.path),
    })),
  };
}
