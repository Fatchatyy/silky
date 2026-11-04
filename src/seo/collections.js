// Titles and intro texts of the named collections, shared by the Collection page and the server-written head.
// Pure: no DOM, no React.

export const COLLECTION_META = {
  femme: {
    title: 'Collection Femme',
    heroText: 'Découvrez toute notre collection femme',
    fallbackImage: '/pictures/femme_example.jpg',
  },
  enfant: {
    title: 'Collection Enfant',
    heroText: 'Découvrez toute notre collection enfant',
    fallbackImage: '/pictures/enfant_example.jpg',
  },
};

export const DEFAULT_COLLECTION_META = {
  title: 'Collection',
  heroText: 'Découvrez nos produits',
  fallbackImage: '/pictures/femme_example.jpg',
};

export const isNamedCollection = (slug) => Object.prototype.hasOwnProperty.call(COLLECTION_META, slug);

/** Display metadata of a collection slug; unknown slugs get the generic one. */
export function collectionMeta(slug) {
  return isNamedCollection(slug) ? COLLECTION_META[slug] : DEFAULT_COLLECTION_META;
}

// Arabic titles and intro texts of the named collections (translated from the French ones; to be reviewed).
export const COLLECTION_META_AR = {
  femme: { title: 'مجموعة النساء', heroText: 'اكتشفوا كل مجموعتنا النسائية' },
  enfant: { title: 'مجموعة الأطفال', heroText: 'اكتشفوا كل مجموعتنا للأطفال' },
};
export const DEFAULT_COLLECTION_META_AR = { title: 'المجموعة', heroText: 'اكتشفوا منتجاتنا' };

/** Like collectionMeta, in the given language (the image is the same). */
export function localizedCollectionMeta(slug, locale = 'fr') {
  const base = collectionMeta(slug);
  if (locale !== 'ar') return base;
  const text = isNamedCollection(slug) ? COLLECTION_META_AR[slug] : DEFAULT_COLLECTION_META_AR;
  return { ...base, ...text };
}
