// Price text. The currency label follows the language of the page (TND in French, د.ت in Arabic); LocaleProvider tells this
// module the current language before the pages render. Digits stay Western (as everywhere in Tunisia).
let currentLocale = 'fr';

export const setPriceLocale = (locale) => {
  currentLocale = locale;
};

export function formatPrice(amount, locale = currentLocale) {
  return (
    Number(amount).toLocaleString('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }) + (locale === 'ar' ? ' د.ت' : ' TND')
  );
}
