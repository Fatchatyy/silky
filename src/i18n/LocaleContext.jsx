import { createContext, useContext, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { dirOf, splitLocale } from '../../shared/locales';
import { setPriceLocale } from '../../shared/formatPrice';

const LocaleContext = createContext({ locale: 'fr', dir: 'ltr' });

// Arabic typeface, requested only when an Arabic page is shown (French pages never download it). Google serves the
// Arabic letters as a separate file, so the French-only text of an Arabic page costs nothing extra.
const ARABIC_FONT_URL = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap';

function ensureArabicFont() {
  if (document.querySelector('link[data-arabic-font]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = ARABIC_FONT_URL;
  link.setAttribute('data-arabic-font', '');
  document.head.appendChild(link);
}

/** The language is read from the URL (/ar/... is Arabic). It also sets <html lang> and <html dir>. */
export function LocaleProvider({ children }) {
  const { pathname } = useLocation();
  const { locale } = splitLocale(pathname);
  setPriceLocale(locale); // before the children render, so every price shows the right currency label

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
    if (locale === 'ar') ensureArabicFont();
  }, [locale]);

  const value = useMemo(() => ({ locale, dir: dirOf(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
