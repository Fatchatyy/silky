// The public address of a product that is hidden is a 404 for everyone (visitors and crawlers). An admin's browser
// loads the product through the API with the admin token and shows the same page, with the inline editor, as the old
// storefront did. The server's 404 content steps aside once the product is here.
import { useState } from 'react';
import { translate } from '@shared/messages';
import { localizePath } from '@shared/locales';
import { productName } from '@shared/productText';
import { categoryPath } from '@shared/urls';
import ProductAdminLoader from './ProductAdminLoader';
import { useLocale } from '../i18n/LocaleContext';

export default function HiddenProductPage({ lookup, onFound }) {
  const { locale } = useLocale();
  const [breadcrumb, setBreadcrumb] = useState(null);

  const handleFound = (product) => {
    const slug = product.category;
    const named = { femme: 'nav.women', enfant: 'nav.kids' }[slug];
    const items = [
      { name: locale === 'ar' ? 'الرئيسية' : 'Accueil', href: localizePath('/', locale) },
      ...(slug ? [{ name: named ? translate(locale, named) : slug, href: localizePath(categoryPath(slug), locale) }] : []),
      { name: productName(product, locale), href: null },
    ];
    setBreadcrumb({ label: locale === 'ar' ? 'مسار التصفح' : "Fil d'Ariane", items });
    document.title = `${productName(product, locale)} | Silky`;
    onFound?.(product);
  };

  return <ProductAdminLoader lookup={lookup} standalone breadcrumb={breadcrumb} onLoaded={handleFound} />;
}
