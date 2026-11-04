// The page-level SEO builders: each takes the page's data and returns the single object <Seo> writes into the head.
// Indexing rules (plan 2.6): home, collections, products, FAQ, delivery, customer service, about and contact are
// indexable; search, cart, checkout, account ... are noindex; an Arabic page is indexable only with a real Arabic
// translation; hreflang links only join pages that are both indexable.
import { hasArabicProduct, localizedProductView } from '../../../../shared/productText.js';
import { faqEntries, partsToText } from '../../../../shared/textPages.js';
import { breadcrumbJsonLd, faqJsonLd, organizationJsonLd, productJsonLd } from './jsonld.ts';
import {
  INDEXABLE_PAGES,
  NOT_FOUND_TITLE,
  PAGE_PATHS,
  PAGE_TEXT,
  PRODUCT_NOT_FOUND_TITLE,
  UNAVAILABLE_TITLE,
  collectionText,
  hasArabicPageText,
  isNamedCollection,
  type PageKey,
} from './routeText.ts';
import { cleanText, trimDescription, withSiteName } from './text.ts';
import { alternatesFor, categoryPath, pageUrl, productPath, shareImageUrl } from './urls.ts';
import type { Locale, SeoContext, SeoProps } from './types.ts';

const ogLocale = (locale: Locale) => (locale === 'ar' ? 'ar_AR' : 'fr_FR');
const homeName = (locale: Locale) => (locale === 'ar' ? 'الرئيسية' : 'Accueil');

/** Fixed public page (home, about, contact, service-client, livraison-retours, faq). */
export function textPageSeo(key: PageKey, locale: Locale, ctx: SeoContext, imagePath?: string): SeoProps {
  const path = PAGE_PATHS[key];
  const text = PAGE_TEXT[locale][key];
  const indexable = INDEXABLE_PAGES.includes(key) && (locale === 'fr' || hasArabicPageText(key));
  const bothLanguages = INDEXABLE_PAGES.includes(key) && hasArabicPageText(key);
  const jsonLd: object[] = [];
  if (key === 'home') jsonLd.push(organizationJsonLd(ctx) as object);
  if (key === 'faq') {
    jsonLd.push(
      faqJsonLd(faqEntries(locale).map((entry: any) => ({ question: entry.question, answer: entry.answer })))
        ?? {},
    );
  }
  return {
    title: text.fullTitle || withSiteName(text.title),
    description: text.description ? trimDescription(text.description) : undefined,
    canonical: pageUrl(ctx.siteUrl, path, locale),
    alternates: indexable && bothLanguages ? alternatesFor(ctx.siteUrl, path) : undefined,
    robots: indexable ? 'index,follow' : 'noindex,follow',
    og: { type: 'website', image: imagePath ? shareImageUrl(ctx, imagePath) : undefined, locale: ogLocale(locale) },
    jsonLd: jsonLd.filter((item) => item && Object.keys(item).length),
  };
}

/** Pages that must never be indexed: search, cart, checkout, order confirmation, account, login, signup ... */
export function privatePageSeo(key: PageKey, locale: Locale, ctx: SeoContext, path: string = PAGE_PATHS[key]): SeoProps {
  return {
    title: withSiteName(PAGE_TEXT[locale][key].title),
    canonical: pageUrl(ctx.siteUrl, path, locale),
    robots: 'noindex,follow',
    og: { type: 'website', locale: ogLocale(locale) },
  };
}

/** The 404 page and the "service unavailable" page: no canonical of their own, never indexed. */
export function errorPageSeo(kind: 'not-found' | 'product-not-found' | 'unavailable', locale: Locale, ctx: SeoContext, path = '/'): SeoProps {
  const title = { 'not-found': NOT_FOUND_TITLE, 'product-not-found': PRODUCT_NOT_FOUND_TITLE, unavailable: UNAVAILABLE_TITLE }[kind][locale];
  return {
    title: withSiteName(title),
    canonical: pageUrl(ctx.siteUrl, path, locale),
    robots: 'noindex,nofollow',
    og: { type: 'website', locale: ogLocale(locale) },
  };
}

/** Collection (category) page. An Arabic collection is indexable only when it has an Arabic title (named collections). */
export function collectionSeo(slug: string, locale: Locale, ctx: SeoContext, name?: string, imagePath?: string): SeoProps {
  const text = collectionText(slug, locale);
  const title = isNamedCollection(slug) ? text.title : cleanText(name) || text.title;
  const hasArabic = isNamedCollection(slug);
  const indexable = locale === 'fr' || hasArabic;
  const path = categoryPath(slug);
  return {
    title: withSiteName(title),
    description: trimDescription(text.heroText),
    canonical: pageUrl(ctx.siteUrl, path, locale),
    alternates: indexable && hasArabic ? alternatesFor(ctx.siteUrl, path) : undefined,
    robots: indexable ? 'index,follow' : 'noindex,follow',
    og: { type: 'website', image: imagePath ? shareImageUrl(ctx, imagePath) : undefined, locale: ogLocale(locale) },
    jsonLd: [
      breadcrumbJsonLd([
        { name: homeName(locale), url: pageUrl(ctx.siteUrl, '/', locale) },
        { name: title, url: pageUrl(ctx.siteUrl, path, locale) },
      ]) as object,
    ].filter(Boolean),
  };
}

/** Product page: Product (or ProductGroup) + BreadcrumbList JSON-LD, Open Graph product, hreflang when Arabic is real. */
export function productSeo(
  product: any,
  locale: Locale,
  ctx: SeoContext,
  { rating, deliveryFee, collectionName }: { rating?: { average: number; count: number } | null; deliveryFee?: number | null; collectionName?: string | null } = {},
): SeoProps {
  const view = localizedProductView(product, locale);
  const path = productPath(product);
  const arabicIndexable = hasArabicProduct(product);
  const indexable = locale === 'fr' || arabicIndexable;
  const slug = product.category as string | undefined;
  const collectionTitle = slug ? (isNamedCollection(slug) ? collectionText(slug, locale).title : collectionName || slug) : null;
  const breadcrumb = breadcrumbJsonLd([
    { name: homeName(locale), url: pageUrl(ctx.siteUrl, '/', locale) },
    ...(collectionTitle && slug ? [{ name: collectionTitle, url: pageUrl(ctx.siteUrl, categoryPath(slug), locale) }] : []),
    { name: cleanText(view.name), url: pageUrl(ctx.siteUrl, path, locale) },
  ]);
  const image = [product.mainImage, ...(product.thumbnails || [])].map((p: string) => shareImageUrl(ctx, p)).find(Boolean);
  return {
    title: withSiteName(cleanText(view.name)),
    description: trimDescription(view.description) || undefined,
    canonical: pageUrl(ctx.siteUrl, path, locale),
    alternates: indexable && arabicIndexable ? alternatesFor(ctx.siteUrl, path) : undefined,
    robots: indexable ? 'index,follow' : 'noindex,follow',
    og: { type: 'product', image, locale: ogLocale(locale) },
    jsonLd: [productJsonLd(product, view, locale, ctx, { rating, deliveryFee }) as object, breadcrumb as object].filter(Boolean),
  };
}

export { partsToText };
