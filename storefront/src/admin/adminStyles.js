// The admin tools' stylesheet: a plain file in public/ (public/admin/styles.css), so the build never links it into the pages
// visitors receive. The admin panel's shell links it in its <head> (layouts/AdminLayout.astro); on the shop pages this module
// adds the link at run time, once, only for an admin's browser (it is imported by the lazily loaded admin modules).
export const ADMIN_STYLES_VERSION = 3;

if (typeof document !== 'undefined' && !document.querySelector('link[data-admin-styles]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `/admin/styles.css?v=${ADMIN_STYLES_VERSION}`;
  link.setAttribute('data-admin-styles', '');
  document.head.appendChild(link);
}
