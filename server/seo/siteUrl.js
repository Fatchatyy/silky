// SITE_URL parsing, kept free of dotenv so it can be tested alone.

/**
 * SITE_URL is the canonical origin used for every absolute URL in page heads, structured data and the sitemap:
 * an http(s) origin with no path, query or trailing slash.
 * Returns the origin, '' when unset, or null when set but invalid.
 */
export function parseSiteUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && value === url.origin) return url.origin;
  } catch {
    // invalid
  }
  return null;
}
