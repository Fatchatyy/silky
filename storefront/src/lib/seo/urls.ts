// Absolute URLs for canonical, hreflang, Open Graph and structured data. Pure.
import { absoluteUrl, categoryPath, productPath } from '../../../shared/urls.js';
import { localizePath } from '../../../shared/locales.js';
import { mediaUrl } from '../../../shared/media.js';
import { imageVariantPath } from '../../../shared/imageVariants.js';
import type { Locale, SeoContext } from './types.ts';

export { categoryPath, productPath };

/** https://silky.tn/ar/faq for ('/faq', 'ar'); never a trailing slash except the home page. */
export function pageUrl(siteUrl: string, path: string, locale: Locale): string {
  return absoluteUrl(siteUrl, localizePath(path, locale)) ?? '';
}

/** hreflang block for a page that exists, and may be indexed, in both languages (x-default is French). */
export function alternatesFor(siteUrl: string, frPath: string) {
  return {
    fr: pageUrl(siteUrl, frPath, 'fr'),
    ar: pageUrl(siteUrl, frPath, 'ar'),
    'x-default': pageUrl(siteUrl, frPath, 'fr'),
  };
}

/** A '/uploads/...' file lives on the media origin, anything else ('/pictures/...') on the site itself. */
export function assetUrl(ctx: SeoContext, path: string | null | undefined): string | undefined {
  if (!path || !/^\/(uploads|pictures)\/[^\s?#]+$/.test(path) || path.includes('..')) return undefined;
  if (path.startsWith('/uploads/')) return mediaUrl(path, ctx.mediaBase || '') as string;
  return absoluteUrl(ctx.siteUrl, path) ?? undefined;
}

/** The 1200 px copy used for Open Graph and structured data, when the photo has one. */
export const shareImageUrl = (ctx: SeoContext, path: string | null | undefined) =>
  assetUrl(ctx, path ? imageVariantPath(path, 'share') : path);
