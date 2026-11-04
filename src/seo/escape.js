// Pure helpers (no DOM, no React) shared by the browser and the server, so both write identical, safe head content.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Unicode line and paragraph separators (U+2028, U+2029), built from their codes so the source holds no invisible
// characters.
const SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');
const toUnicodeEscape = (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * JSON for a <script type="application/ld+json"> element. Characters that could close the script element or
 * break a parser are written as unicode escapes, so product text can never end the script early.
 */
export function serializeJsonLd(data) {
  return JSON.stringify(data).replace(/[<>&]/g, toUnicodeEscape).replace(SEPARATORS, toUnicodeEscape);
}
