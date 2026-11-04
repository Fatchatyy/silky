// Every route the storefront serves, with its indexing policy and, for fixed pages, its metadata. Shared by the
// browser (page titles today) and the server (status codes and head tags in Step 2). Pure: no DOM, no React.
// server/scripts/test_seo_builders.js fails if this list drifts from the <Route> paths in src/App.jsx.
//
// kind: 'page'     fixed public page, indexable, metadata below (descriptions only restate what the page shows)
//       'product'  public, metadata built from the product by the page itself
//       'category' public, metadata built from the collection by the page itself
//       'private'  never indexed (cart, checkout, account, admin, search ...)

export const ROUTES = [
  {
    path: '/',
    kind: 'page',
    fullTitle: 'Silky – Boutique de mode en ligne en Tunisie',
    description:
      'Silky, boutique en ligne de mode et de prêt-à-porter pensée en Tunisie. Livraison à domicile en 24 à 48 heures, paiement à la livraison.',
  },
  { path: '/product', kind: 'product' },
  { path: '/product/:slug', kind: 'product' },
  { path: '/collection/:category', kind: 'category' },
  {
    path: '/about',
    kind: 'page',
    title: 'À propos',
    description:
      'Silky, boutique en ligne de mode et de prêt-à-porter : des pièces pensées en Tunisie dans des matières de qualité, au meilleur prix.',
  },
  {
    path: '/contact',
    kind: 'page',
    title: 'Nous contacter',
    description: 'Envoyez un message au service client Silky avec le formulaire de contact.',
  },
  {
    path: '/service-client',
    kind: 'page',
    title: 'Service client',
    description: 'Joignez le service client Silky au +216 25 274 800, par e-mail ou sur nos réseaux sociaux.',
  },
  {
    path: '/livraison-retours',
    kind: 'page',
    title: 'Livraison et retours',
    description:
      'Livraison à domicile en 24 à 48 heures, paiement à la livraison, inspection du colis devant le livreur et échange de taille ou de couleur sous 48 heures.',
  },
  {
    path: '/faq',
    kind: 'page',
    title: 'Questions fréquentes',
    description: 'Livraison, paiement à la livraison, échange, remboursement et contact : les réponses aux questions fréquentes sur Silky.',
  },
  { path: '/search', kind: 'private', title: 'Recherche' },
  { path: '/cart', kind: 'private', title: 'Panier' },
  { path: '/checkout', kind: 'private', title: 'Finaliser la commande' },
  { path: '/order-confirmation', kind: 'private', title: 'Commande confirmée' },
  { path: '/leave-review', kind: 'private', title: 'Donner votre avis' },
  { path: '/login', kind: 'private', title: 'Connexion' },
  { path: '/signup', kind: 'private', title: 'Créer un compte' },
  { path: '/register', kind: 'private', title: 'Créer un compte' },
  { path: '/password-reset', kind: 'private', title: 'Mot de passe oublié' },
  { path: '/password-reset/:token', kind: 'private', title: 'Nouveau mot de passe' },
  { path: '/favorites', kind: 'private', title: 'Mes favoris' },
  { path: '/account', kind: 'private', title: 'Mon compte' },
  { path: '/admin/login', kind: 'private', title: 'Administration', robots: 'noindex, nofollow' },
  { path: '/admin', kind: 'private', title: 'Administration', robots: 'noindex, nofollow' },
];

/**
 * Finds the route for a pathname, or null when no route matches (a 404). Like React Router's defaults, static
 * segments match case-insensitively and a trailing slash is ignored; parameters keep their original text.
 */
export function matchRoute(pathname) {
  const segments = splitPath(pathname);
  for (const route of ROUTES) {
    const pattern = splitPath(route.path);
    if (pattern.length !== segments.length) continue;
    const params = {};
    const matches = pattern.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = segments[i];
        return segments[i].length > 0;
      }
      return part.toLowerCase() === segments[i].toLowerCase();
    });
    if (matches) return { route, params };
  }
  return null;
}

function splitPath(pathname) {
  return String(pathname ?? '/')
    .split('?')[0]
    .split('/')
    .filter(Boolean);
}
