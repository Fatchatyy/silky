// A fingerprint of everything the static storefront shows, taken from the catalogue snapshot itself (so it can never drift from
// what the pages are built from). Two snapshots have the same fingerprint when a rebuild would produce the same site:
//   - generatedAt and the fingerprint itself are ignored;
//   - stock QUANTITIES are reduced to in stock / out of stock: an order that leaves a product in stock must not trigger a rebuild,
//     one that sells the last item of a variant must (the page's availability and JSON-LD change);
//   - arrays of objects with an id are sorted by it and keys are sorted, so the order a query returned rows in cannot change it.
import crypto from 'node:crypto';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function sortKeys(value) {
  if (Array.isArray(value)) {
    const items = value.map(sortKeys);
    if (items.length && items.every((item) => isPlainObject(item) && typeof item.id === 'string')) return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (items.length && items.every((item) => isPlainObject(item) && typeof item.slug === 'string' && item.id === undefined)) return items.sort((a, b) => (a.slug < b.slug ? -1 : 1));
    return items;
  }
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
}

const inStock = (quantity) => Number(quantity) > 0;

/** The snapshot reduced to what can change a page, in a deterministic shape. */
export function canonicalSnapshot(snapshot) {
  const { generatedAt: _generatedAt, fingerprint: _fingerprint, ...rest } = snapshot;
  const products = (rest.products ?? []).map((product) => {
    const copy = { ...product };
    if (isPlainObject(copy.stock)) copy.stock = Object.fromEntries(Object.entries(copy.stock).map(([key, quantity]) => [key, inStock(quantity)]));
    if (Array.isArray(copy.variants)) copy.variants = copy.variants.map(({ stockQuantity, ...variant }) => ({ ...variant, inStock: inStock(stockQuantity) }));
    return copy;
  });
  // « Afficher dans avis généraux » only decides what the home page's reviews block asks the API for at load time
  // (/api/reviews/published); no static page shows it, so ticking it must not rebuild the site.
  const reviews = Object.fromEntries(
    Object.entries(rest.reviews ?? {}).map(([productId, group]) => [
      productId,
      { ...group, reviews: (group.reviews ?? []).map(({ showInGeneral: _showInGeneral, ...review }) => review) },
    ]),
  );
  return sortKeys({ ...rest, products, reviews });
}

export function snapshotFingerprint(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalSnapshot(snapshot))).digest('hex');
}
