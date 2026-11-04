// Languages of the storefront. French has no prefix (today's URLs never change); Arabic lives under /ar/.
// Shared by the browser and the server. Pure: no DOM, no React.

export const LOCALES = ['fr', 'ar'];
export const DEFAULT_LOCALE = 'fr';

// The Arabic storefront is not announced anywhere (no switcher, no hreflang, no sitemap entries) and /ar answers 404
// while this is false. Set true once the owner has reviewed the Arabic text and the right-to-left layout.
export const ARABIC_ENABLED = true;

const PREFIXED = /^\/ar(?=\/|\?|#|$)/;

/** { locale, path } of a pathname: '/ar/faq' -> { locale: 'ar', path: '/faq' }; anything else is French. */
export function splitLocale(pathname) {
  const value = String(pathname ?? '/');
  if (ARABIC_ENABLED && PREFIXED.test(value)) {
    const rest = value.replace(PREFIXED, '');
    return { locale: 'ar', path: rest.startsWith('/') ? rest : `/${rest}` };
  }
  return { locale: DEFAULT_LOCALE, path: value };
}

export const dirOf = (locale) => (locale === 'ar' ? 'rtl' : 'ltr');

const isShopPath = (path) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');

/** Adds the language prefix to an internal path (query and hash kept). Anything else, or an already prefixed path, is returned as is. */
export function localizePath(path, locale) {
  if (!isShopPath(path) || locale === DEFAULT_LOCALE || PREFIXED.test(path)) return path;
  return `/${locale}${path === '/' ? '' : path}`;
}

/** The same page in another language: switchLocalePath('/ar/cart', '?a=1', 'fr') -> '/cart?a=1'. */
export function switchLocalePath(pathname, search, targetLocale) {
  const { path } = splitLocale(pathname);
  return `${localizePath(path, targetLocale)}${search || ''}`;
}
