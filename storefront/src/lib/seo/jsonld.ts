// schema.org structured data built only from data the page shows. Pure.
import { getEffectivePrice } from '../../../../shared/price.js';
import { isProductOutOfStock } from '../../../../shared/stock.js';
import { colorNameAr } from '../../../../shared/colors.js';
import { CONTACT } from '../../../../shared/contact.js';
import { DELIVERY_FEE_TND } from '../../../../shared/delivery.js';
import { cleanText, SITE_NAME } from './text.ts';
import { assetUrl, pageUrl, productPath, shareImageUrl } from './urls.ts';
import type { Locale, SeoContext } from './types.ts';

const SCHEMA = 'https://schema.org';

const meaningful = (value: unknown) => {
  const text = cleanText(value);
  return text && text.toLowerCase() !== 'default' ? text : '';
};

type VariantEntry = { sku: string; colorKey: string; color: string; size: string; imagePath: string | null; inStock: boolean };

/** One entry per sellable variant (size and/or colour) that has its own SKU or id; repeated SKUs are left out. */
function variantEntries(product: any, locale: Locale): VariantEntry[] {
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const seen = new Set<string>();
  const entries: VariantEntry[] = [];
  for (const variant of Array.isArray(product.variants) ? product.variants : []) {
    if (!variant) continue;
    const sku = cleanText(variant.sku) || cleanText(variant.id);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const colorName = meaningful(variant.colorName);
    const colorEntry = colors.find((color: any) => color && variant.colorSlug && color.id === variant.colorSlug);
    entries.push({
      sku,
      colorKey: colorName ? cleanText(variant.colorSlug || colorName).toLowerCase() : '',
      color: colorName && locale === 'ar' ? colorNameAr(colorName, colors) : colorName,
      size: meaningful(variant.size),
      imagePath: [colorEntry?.thumbnail, colorEntry?.images?.[0], variant.colorImageUrl].find((p) => typeof p === 'string' && p.startsWith('/')) || null,
      inStock: Number(variant.stockQuantity ?? variant.stock ?? 0) > 0,
    });
  }
  return entries;
}

/**
 * Product + Offer (a ProductGroup with one Product per variant when the product has several sizes or colours).
 * `view` is the product with name/description in the page language. Price and discount live on the product, so
 * every offer is at the effective price in TND. `rating` is the approved-review summary ({ average, count }).
 */
export function productJsonLd(
  product: any,
  view: any,
  locale: Locale,
  ctx: SeoContext,
  { rating, deliveryFee }: { rating?: { average: number; count: number } | null; deliveryFee?: number | null } = {},
) {
  const url = pageUrl(ctx.siteUrl, productPath(product), locale);
  if (!url) return null;

  const name = cleanText(view.name);
  const description = cleanText(view.description);
  const brand = { '@type': 'Brand', name: SITE_NAME };

  const images = [
    ...new Set([product.mainImage, ...(product.thumbnails || [])].map((path) => shareImageUrl(ctx, path)).filter(Boolean)),
  ];

  const price = getEffectivePrice(product);
  // Delivery in Tunisia within 1 to 2 days (24 to 48 hours, what the delivery page states), at the fee customers are
  // charged (from the shop settings); without it, the amount the delivery page states.
  const fee = Number.isFinite(deliveryFee) && (deliveryFee as number) >= 0 ? (deliveryFee as number) : DELIVERY_FEE_TND;
  const shippingDetails = {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: fee, currency: 'TND' },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'TN' },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
    },
  };
  const buildOffer = () => ({ '@type': 'Offer', url, price: Number(price.toFixed(3)), priceCurrency: 'TND', shippingDetails });

  const aggregateRating =
    rating && Number(rating.count) > 0
      ? { '@type': 'AggregateRating', ratingValue: Number(rating.average), reviewCount: Number(rating.count), bestRating: 5, worstRating: 1 }
      : null;

  const entries = price > 0 ? variantEntries(product, locale) : [];
  const colorCount = new Set(entries.map((entry) => entry.colorKey).filter(Boolean)).size;
  const sizeCount = new Set(entries.map((entry) => entry.size).filter(Boolean)).size;

  if (entries.length >= 2 && (colorCount >= 2 || sizeCount >= 2)) {
    const group: Record<string, unknown> = { '@context': SCHEMA, '@type': 'ProductGroup', name, url, productGroupID: String(product.id), brand };
    if (description) group.description = description;
    if (images.length) group.image = images;
    group.variesBy = [colorCount >= 2 && `${SCHEMA}/color`, sizeCount >= 2 && `${SCHEMA}/size`].filter(Boolean);
    group.hasVariant = entries.map((entry) => {
      const variant: Record<string, unknown> = {
        '@type': 'Product',
        name: [name, [entry.color, entry.size].filter(Boolean).join(', ')].filter(Boolean).join(' – '),
        sku: entry.sku,
        url,
      };
      if (entry.color) variant.color = entry.color;
      if (entry.size) variant.size = entry.size;
      const photo = shareImageUrl(ctx, entry.imagePath);
      if (photo) variant.image = photo;
      variant.offers = { ...buildOffer(), availability: `${SCHEMA}/${entry.inStock ? 'InStock' : 'OutOfStock'}` };
      return variant;
    });
    if (aggregateRating) group.aggregateRating = aggregateRating;
    return group;
  }

  const data: Record<string, unknown> = { '@context': SCHEMA, '@type': 'Product', name, url, productID: String(product.id), brand };
  if (entries.length === 1) data.sku = entries[0].sku;
  if (description) data.description = description;
  if (images.length) data.image = images;
  if (price > 0) {
    const offer: Record<string, unknown> = buildOffer();
    const hasStockData = Object.keys(product.stock || {}).length > 0 || (product.variants || []).length > 0;
    if (hasStockData) offer.availability = `${SCHEMA}/${isProductOutOfStock(product) ? 'OutOfStock' : 'InStock'}`;
    data.offers = offer;
  }
  if (aggregateRating) data.aggregateRating = aggregateRating;
  return data;
}

/** Organization for the home page: name, site, logo, phone, e-mail and social profiles the shop already shows. No address. */
export function organizationJsonLd(ctx: SeoContext) {
  const url = pageUrl(ctx.siteUrl, '/', 'fr');
  if (!url) return null;
  return {
    '@context': SCHEMA,
    '@type': 'Organization',
    name: CONTACT.name,
    url,
    logo: assetUrl(ctx, CONTACT.logoPath),
    telephone: CONTACT.telephone,
    email: CONTACT.email,
    sameAs: CONTACT.socialProfiles,
  };
}

/** FAQPage from [{ question, answer }] in plain text: the questions and answers the FAQ page shows. */
export function faqJsonLd(entries: { question: string; answer: string }[]) {
  const list = (entries || []).filter((entry) => entry && cleanText(entry.question) && cleanText(entry.answer));
  if (!list.length) return null;
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

/** BreadcrumbList from [{ name, url }] (absolute URLs), most general first. */
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  const list = (items || []).filter((item) => item && cleanText(item.name) && item.url);
  if (!list.length) return null;
  return {
    '@context': SCHEMA,
    '@type': 'BreadcrumbList',
    itemListElement: list.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: cleanText(item.name), item: item.url })),
  };
}
