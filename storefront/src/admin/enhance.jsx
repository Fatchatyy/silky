// Everything an admin gets on top of the public pages, loaded by one dynamic import from the header (see
// components/layout/HeaderAccount.jsx) only when the browser holds a valid admin token. It finds the marked places of
// the server-rendered HTML (the same HTML for everyone) and mounts React in them:
//   [data-admin-section]        a product list (collection, home section): shown with the hidden products
//   [data-admin-recs]           the recommendations under a product
//   [data-admin-hidden-product] the 404 of a product address: shown as the product page when it is a hidden product
import { createRoot } from 'react-dom/client';
import { IslandContext } from '../i18n/LocaleContext';
import { dirOf } from '@shared/locales';
import { setPriceLocale } from '@shared/formatPrice';
import '../lib/island';
import './adminStyles';
import AdminListing from './AdminListing';
import HiddenProductPage from './HiddenProductPage';

const mounted = new WeakSet();

function mount(host, element, locale) {
  const root = createRoot(host);
  setPriceLocale(locale);
  root.render(<IslandContext.Provider value={{ locale, dir: dirOf(locale), params: {} }}>{element}</IslandContext.Provider>);
}

function insertAfter(reference, tag, className) {
  const host = document.createElement(tag);
  if (className) host.className = className;
  reference.insertAdjacentElement('afterend', host);
  return host;
}

export function enhancePage() {
  const locale = document.documentElement.lang === 'ar' ? 'ar' : 'fr';

  // Product lists
  for (const section of document.querySelectorAll('[data-admin-section]')) {
    if (mounted.has(section)) continue;
    mounted.add(section);
    const statics = [...section.querySelectorAll(':scope > .products_grid, :scope > p')];
    const anchor = statics[statics.length - 1] || section.querySelector('h2, h1') || section;
    const host = insertAfter(anchor, 'div', 'products_grid');
    mount(
      host,
      <AdminListing
        kind="grid"
        category={section.dataset.category}
        limit={Number(section.dataset.limit) || undefined}
        hideWhenReady={() => statics.forEach((el) => (el.hidden = true))}
      />,
      locale,
    );
  }

  // Recommendations under a product
  for (const section of document.querySelectorAll('[data-admin-recs]')) {
    if (mounted.has(section)) continue;
    mounted.add(section);
    const staticGrid = section.querySelector('.recommendations_grid');
    const host = insertAfter(staticGrid, 'div', 'recommendations_grid');
    mount(
      host,
      <AdminListing
        kind="recs"
        category={section.dataset.category}
        exclude={section.dataset.exclude}
        limit={4}
        hideWhenReady={(count) => {
          staticGrid.hidden = true;
          section.hidden = count === 0;
        }}
      />,
      locale,
    );
  }

  // The 404 of a product address
  for (const notFound of document.querySelectorAll('[data-admin-hidden-product]')) {
    if (mounted.has(notFound)) continue;
    mounted.add(notFound);
    const host = insertAfter(notFound, 'div');
    mount(host, <HiddenProductPage lookup={notFound.dataset.adminHiddenProduct} onFound={() => (notFound.hidden = true)} />, locale);
  }
}
