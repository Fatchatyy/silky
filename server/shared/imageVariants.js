// Resized copies of uploaded photos, shared by the server (which makes them) and the storefront (which uses them).
// Pure: no DOM, no React, no Node APIs.
//
// An admin photo uploaded as /uploads/<time>-<random>-r.jpg is kept untouched, and three WebP copies are saved next to
// it: <same name>.card.webp, .share.webp and .large.webp. The "-r" in the file name says "the copies exist"; photos
// uploaded before this feature have no marker and are always used as they are.

export const IMAGE_VARIANTS = {
  card: { width: 600, quality: 82 }, // product cards, thumbnails, carts
  share: { width: 1200, quality: 82 }, // Open Graph and structured-data images
  large: { width: 2400, quality: 85 }, // main product image, zoom, home hero
};

export const RESIZED_MARKER = '-r';

const RESIZED_UPLOAD = /^(\/uploads\/\d+-[0-9a-f]{8}-r)\.(?:jpe?g|png|webp)$/i;

/** The uploaded file is one that has resized copies (its name carries the marker). */
export const hasImageVariants = (url) => RESIZED_UPLOAD.test(String(url ?? ''));

/** URL of a resized copy ('card' | 'share' | 'large'); any other url (older uploads, /pictures, ...) comes back as is. */
export function imageVariantPath(url, variant) {
  const match = RESIZED_UPLOAD.exec(String(url ?? ''));
  return match && IMAGE_VARIANTS[variant] ? `${match[1]}.${variant}.webp` : url;
}
