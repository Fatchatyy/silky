// Turns the image paths stored in the database into URLs a browser can load. Pure: no DOM, no React, no Node APIs.
//
// The database keeps uploads as relative paths ('/uploads/<file>') and that never changes. Where the files are served
// from does: the API locally, the media domain in production. Each app sets its base once at start-up
// (setMediaBase(import.meta.env.PUBLIC_MEDIA_URL), ...) and calls mediaUrl() wherever it prints an image or video.
//
// Only '/uploads/...' is rewritten. Absolute URLs (http, https, protocol-relative, data:, blob:) and the files shipped
// with the site ('/pictures/...') come back unchanged, as does anything that is not a string.
import { imageVariantPath } from './imageVariants.js';

let mediaBase = '';

/** Sets the origin that serves '/uploads/...' (for example 'https://media.silky.tn'); a trailing slash is ignored. */
export function setMediaBase(base) {
  mediaBase = String(base ?? '').trim().replace(/\/+$/, '');
}

export const getMediaBase = () => mediaBase;

/** `base` overrides the one set with setMediaBase (tests, or a server-side caller that holds its own). */
export function mediaUrl(url, base = mediaBase) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return url;
  return `${String(base ?? '').trim().replace(/\/+$/, '')}${url}`;
}

/** mediaUrl of a resized copy ('card' | 'share' | 'large'); photos without copies come back as mediaUrl of the original. */
export const mediaVariantUrl = (url, variant, base = mediaBase) => mediaUrl(imageVariantPath(url, variant), base);
