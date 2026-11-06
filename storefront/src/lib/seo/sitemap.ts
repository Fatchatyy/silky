// sitemap.xml and robots.txt content, built from the API's sitemap data. Pure.
import { INDEXABLE_PAGES, PAGE_PATHS, hasArabicPageText, isNamedCollection } from './routeText.ts';
import { alternatesFor, categoryPath, pageUrl, productPath } from './urls.ts';

export type SitemapData = {
  products: { slug: string; updatedAt?: string | null; hasArabic?: boolean }[];
  categories: { slug: string }[];
};

type Entry = { loc: string; lastmod?: string; alternates?: Record<string, string> };

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export const escapeXml = (value: string) => String(value).replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);

function toDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

/** A page that exists in both languages is listed twice, each entry pointing at both (hreflang alternates). */
function withTwin(siteUrl: string, frPath: string, hasArabic: boolean, lastmod?: string): Entry[] {
  const fr: Entry = { loc: pageUrl(siteUrl, frPath, 'fr'), lastmod };
  if (!hasArabic) return [fr];
  const alternates = alternatesFor(siteUrl, frPath);
  return [
    { ...fr, alternates },
    { loc: pageUrl(siteUrl, frPath, 'ar'), lastmod, alternates },
  ];
}

export function sitemapEntries(siteUrl: string, data: SitemapData): Entry[] {
  const pages = INDEXABLE_PAGES.flatMap((key) => withTwin(siteUrl, PAGE_PATHS[key], hasArabicPageText(key)));
  const collections = data.categories
    .filter((category) => /^[a-z0-9-]+$/.test(String(category?.slug ?? '')))
    .flatMap((category) => withTwin(siteUrl, categoryPath(category.slug), isNamedCollection(category.slug)));
  const products = data.products
    .filter((product) => product && product.slug)
    .flatMap((product) => withTwin(siteUrl, productPath(product), Boolean(product.hasArabic), toDate(product.updatedAt)));
  return [...pages, ...collections, ...products];
}

export function sitemapXml(siteUrl: string, data: SitemapData): string {
  const urls = sitemapEntries(siteUrl, data).map((entry) => {
    const alternates = Object.entries(entry.alternates ?? {})
      .map(([lang, href]) => `<xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(href)}"/>`)
      .join('');
    return `  <url><loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}${alternates}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * robots.txt: everything public is allowed for every crawler, AI crawlers included (owner decision: training and
 * search alike), so there is a single group and no per-bot rule. Only private pages are disallowed.
 */
export function robotsTxt(siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  const privatePaths = ['cart', 'checkout', 'account', 'login', 'signup', 'register', 'password-reset', 'favorites', 'search', 'order-confirmation', 'leave-review'];
  const lines = ['User-agent: *', 'Allow: /'];
  for (const prefix of ['', '/ar']) for (const path of privatePaths) lines.push(`Disallow: ${prefix}/${path}`);
  // The admin panel is not part of the public site.
  lines.push('Disallow: /admin');
  lines.push('',`Sitemap: ${base}/sitemap.xml`, '');
  return lines.join('\n');
}
