// HTML of the page head written by the server between the <!--seo-head--> markers of index.html. Pure: no I/O.
// Every tag carries data-seo, so the browser (src/seo/applyHead.js) can replace or remove exactly these tags.
import { escapeHtml, serializeJsonLd } from '../../src/seo/escape.js';
import { SITE_NAME, absoluteUrl } from '../../shared/urls.js';

const OG_LOCALES = { fr: 'fr_FR', ar: 'ar_AR' };
const DEFAULT_IMAGE_PATH = '/pictures/logo.png';

const attr = (value) => escapeHtml(value);
const metaName = (name, content) => `<meta name="${attr(name)}" content="${attr(content)}" data-seo>`;
const metaProperty = (property, content) => `<meta property="${attr(property)}" content="${attr(content)}" data-seo>`;

/**
 * page: {
 *   meta:          { title, description?, robots? }   from src/seo/meta.js
 *   canonicalPath: path of the indexable page, or null (noindex pages get no canonical or share-preview tags)
 *   ogType:        'website' | 'product'
 *   imagePath:     own image path (already passed through publicImagePath) or null for the logo
 *   alternates:    [{ hreflang, path }] language twins of this page (fr, ar, x-default), or []
 *   jsonLd:        array of schema.org objects (null entries are skipped)
 * }
 * Returns the HTML to put between the markers. Without a valid siteUrl only title, description and robots are
 * written: a canonical or share-preview tag needs an absolute URL.
 */
export function renderHead(page, siteUrl, locale = 'fr') {
  const { meta, canonicalPath = null, ogType = 'website', imagePath = null, alternates = [], jsonLd = [] } = page;
  const tags = [`<title data-seo>${escapeHtml(meta.title)}</title>`];
  if (meta.description) tags.push(metaName('description', meta.description));
  if (meta.robots) tags.push(metaName('robots', meta.robots));

  const canonical = canonicalPath ? absoluteUrl(siteUrl, canonicalPath) : null;
  if (canonical) {
    tags.push(`<link rel="canonical" href="${attr(canonical)}" data-seo>`);
    for (const alternate of alternates) {
      const href = absoluteUrl(siteUrl, alternate.path);
      if (href) tags.push(`<link rel="alternate" hreflang="${attr(alternate.hreflang)}" href="${attr(href)}" data-seo>`);
    }
    tags.push(metaProperty('og:type', ogType));
    tags.push(metaProperty('og:title', meta.title));
    if (meta.description) tags.push(metaProperty('og:description', meta.description));
    tags.push(metaProperty('og:url', canonical));
    tags.push(metaProperty('og:site_name', SITE_NAME));
    tags.push(metaProperty('og:locale', OG_LOCALES[locale] || OG_LOCALES.fr));
    tags.push(metaProperty('og:image', absoluteUrl(siteUrl, imagePath || DEFAULT_IMAGE_PATH)));
    tags.push(metaName('twitter:card', 'summary_large_image'));
  }

  for (const data of jsonLd) {
    if (data) tags.push(`<script type="application/ld+json" data-seo>${serializeJsonLd(data)}</script>`);
  }
  return tags.join('\n    ');
}

const REGION = /<!--seo-head-->[\s\S]*?<!--\/seo-head-->/;

export const hasHeadMarkers = (template) => REGION.test(template);

/** Replaces the marked region. A function replacement, so `$&` or `$1` in a product name stay literal. */
export function injectHead(template, headHtml) {
  return template.replace(REGION, () => headHtml);
}
