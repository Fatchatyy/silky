// Data of the static pages, taken from the catalogue snapshot (one API request per build, see ./snapshot.ts). Pure
// functions over the snapshot: a missing thing here is a bug in the build (the routes are generated FROM the snapshot), so
// these throw; they never produce an "unavailable" page. A visitor never triggers any of this.
import { normalizeProduct } from '../normalizeProduct';
import { collectionPageSize } from '../config';
import { getSnapshot, type Snapshot } from './snapshot';
import { NAMED_COLLECTION_SLUGS, collectionText, isNamedCollection } from '../seo/routeText.ts';


/** A summary as the cards expect a product: published, no colours or variants. */
const fromSummary = (p: any) => ({ ...p, isHidden: false, is_active: true });

/** A collection with more products than collectionPageSize() is split into /collection/<slug>, /collection/<slug>/2, ... */
export const pageCount = (total: number) => Math.max(1, Math.ceil(total / collectionPageSize()));

/** Every collection page to generate: { category, page } with page 1 first. */
export async function collectionPagePaths(): Promise<{ category: string; page: number }[]> {
  const snap = await getSnapshot();
  // The header links to Femme and Enfant: they get a page even if every product of one was hidden (an empty-collection message,
  // noindex, not in the sitemap) instead of a link that ends on a 404.
  const slugs = [...new Set([...snap.categories.map((c) => c.slug), ...NAMED_COLLECTION_SLUGS])];
  return slugs.flatMap((slug) => {
    const total = snap.summaries.filter((p) => p.category === slug).length;
    return Array.from({ length: pageCount(total) }, (_, i) => ({ category: slug, page: i + 1 }));
  });
}

/** The home page: every published product as a card summary (the view decides how many to show where). */
export async function loadHome() {
  const snap = await getSnapshot();
  return { products: snap.summaries.map(fromSummary), theme: snap.theme };
}

/** One page of a collection. */
export async function loadCollectionPage(slug: string, page: number) {
  const snap = await getSnapshot();
  const category = snap.categories.find((c) => c.slug === slug) ?? (isNamedCollection(slug) ? { slug, name: collectionText(slug, 'fr').title } : null);
  if (!category) throw new Error(`collection "${slug}" is not in the snapshot`);
  const all = snap.summaries.filter((p) => p.category === slug).map(fromSummary);
  const pages = pageCount(all.length);
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new Error(`collection "${slug}" has no page ${page} (${pages} pages)`);
  return {
    slug: category.slug,
    name: category.name,
    products: all.slice((page - 1) * collectionPageSize(), page * collectionPageSize()),
    page,
    pages,
    total: all.length,
  };
}

/** The other products of a product's collection, newest first, 4 at most. */
function recommendationsFor(snap: Snapshot, product: any) {
  return snap.summaries
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 4)
    .map(fromSummary);
}

/** A product page: the product, its approved reviews and rating, the delivery fee, its collection's name and recommendations. */
export async function loadProductPage(slug: string) {
  const snap = await getSnapshot();
  const raw = snap.products.find((p) => p.slug === slug);
  if (!raw) throw new Error(`product "${slug}" is not in the snapshot`);
  const product = normalizeProduct(raw);
  const reviews = snap.reviews[product.id];
  return {
    product,
    reviews: reviews?.reviews ?? [],
    rating: reviews?.summary ?? { average: 0, count: 0 },
    deliveryFee: snap.settings.deliveryFee,
    collectionName: snap.categories.find((c) => c.slug === product.category)?.name ?? null,
    recommendations: recommendationsFor(snap, product),
  };
}

/** What the sitemap lists. */
export async function loadSitemapEntries() {
  const snap = await getSnapshot();
  return {
    products: snap.products.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt, hasArabic: p.hasArabic })),
    categories: snap.categories.map((c) => ({ slug: c.slug })),
  };
}

/** For the Worker's redirects of old addresses (see src/middleware.ts): published ids and slugs only, never a hidden product. */
export async function loadLegacyRedirects() {
  const snap = await getSnapshot();
  return {
    ids: Object.fromEntries(snap.products.map((p) => [p.id, p.slug])),
    products: snap.products.map((p) => p.slug),
    collections: snap.categories.map((c) => c.slug),
  };
}
