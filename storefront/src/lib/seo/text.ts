// Small text helpers shared by the SEO builders. Pure: no DOM, no Node or Workers APIs.

/** Collapses whitespace (descriptions are typed in the admin with line breaks). */
export function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Shortens at a word boundary, about 155 characters, and marks the cut with an ellipsis. */
export function trimDescription(text: unknown, max = 155): string {
  const value = cleanText(text);
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const BACKSLASH = String.fromCharCode(92);
const unicodeEscape = (code: number) => `${BACKSLASH}u${code.toString(16).padStart(4, '0')}`;

/**
 * JSON for a <script type="application/ld+json">. "<" is written as a unicode escape so a description containing
 * a closing script tag can neither end the script early nor inject markup (still the same text once parsed);
 * U+2028 and U+2029 are escaped too, for old parsers.
 */
export function safeJson(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll('<', unicodeEscape(0x3c))
    .replaceAll(String.fromCharCode(0x2028), unicodeEscape(0x2028))
    .replaceAll(String.fromCharCode(0x2029), unicodeEscape(0x2029));
}

export const SITE_NAME = 'Silky';
export const withSiteName = (title: string) => `${title} | ${SITE_NAME}`;
