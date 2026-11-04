import { useCallback } from 'react';
import { useLocale } from './LocaleContext';
import { governorateLabel, translate, translateKnown } from '../../shared/messages';
import { colorNameAr, detailsAr } from '../../shared/colors';

/** t('nav.cart') -> the text in the language of the URL; t('search.noResult', { query }) fills {query}. */
export function useT() {
  const { locale } = useLocale();
  const t = useCallback((key, vars) => translate(locale, key, vars), [locale]);
  const known = useCallback((text) => translateKnown(locale, text), [locale]);
  const govName = useCallback((name) => governorateLabel(locale, name), [locale]);
  // Color names and the "Couleur · Taille S" line of a cart item: translated on Arabic pages, untouched in French.
  // `product` (optional) is the live product: its Arabic color names, written in the admin, win over the built-in list.
  const colorLabel = useCallback((name, product) => (locale === 'ar' ? colorNameAr(name, product?.colors) : name), [locale]);
  const detailsLabel = useCallback((details, product) => (locale === 'ar' ? detailsAr(details, product?.colors) : details), [locale]);
  // The category slug of a product (femme / enfant) as a label; French keeps the slug as it was shown.
  const categoryLabel = useCallback(
    (slug) => (locale === 'ar' ? ({ femme: translate(locale, 'nav.women'), enfant: translate(locale, 'nav.kids') }[slug] ?? slug) : slug),
    [locale],
  );
  return { t, known, govName, colorLabel, detailsLabel, categoryLabel, locale };
}
