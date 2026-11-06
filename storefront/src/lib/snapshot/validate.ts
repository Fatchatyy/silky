// Checks that a snapshot from the API is complete enough to publish. Pure. A build that cannot trust its data must stop:
// publishing an empty or half-filled catalogue replaces a good site with a bad one.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY = /^[a-z0-9-]+$/;

export class SnapshotError extends Error {
  /** true: retrying cannot help (the API answered, but with something we must not publish). */
  fatal: boolean;
  constructor(message: string, fatal = false) {
    super(message);
    this.name = 'SnapshotError';
    this.fatal = fatal;
  }
}

export type SnapshotRules = {
  /** Fewest published products a snapshot may hold. Default 1: an empty catalogue is almost certainly a mistake (wrong database, failed query). Set 0 to publish an empty shop on purpose. */
  minProducts?: number;
};

/** Returns the list of problems (empty = fine). Never throws. */
export function snapshotProblems(snapshot: any, { minProducts = 1 }: SnapshotRules = {}): string[] {
  const problems: string[] = [];
  const add = (message: string) => problems.length < 25 && problems.push(message);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ['the snapshot is not an object'];

  for (const key of ['products', 'summaries', 'categories']) if (!Array.isArray(snapshot[key])) add(`"${key}" is not a list`);
  if (typeof snapshot.generatedAt !== 'string' || Number.isNaN(Date.parse(snapshot.generatedAt))) add('"generatedAt" is missing or not a date');
  if (typeof snapshot.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.fingerprint)) add('"fingerprint" is missing or not a SHA-256 (an API older than the publish trigger?)');
  if (!snapshot.theme || typeof snapshot.theme !== 'object') add('"theme" is missing');
  if (!snapshot.reviews || typeof snapshot.reviews !== 'object' || Array.isArray(snapshot.reviews)) add('"reviews" is not an object');
  if (!Number.isFinite(snapshot.settings?.deliveryFee)) add('"settings.deliveryFee" is not a number');
  if (problems.length) return problems;

  const { products, summaries, categories } = snapshot;
  if (products.length < minProducts) add(`only ${products.length} published products (minimum ${minProducts}): refusing to publish a near-empty shop`);

  const categorySlugs = new Set<string>();
  for (const category of categories) {
    if (!category || !CATEGORY.test(String(category.slug ?? '')) || typeof category.name !== 'string' || !category.name.trim()) add(`bad category ${JSON.stringify(category)?.slice(0, 60)}`);
    else categorySlugs.add(category.slug);
  }

  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const product of products) {
    const label = String(product?.slug ?? product?.id ?? '?').slice(0, 60);
    if (!product || typeof product.id !== 'string' || !product.id) { add(`a product has no id (${label})`); continue; }
    if (!SLUG.test(String(product.slug ?? '')) || product.slug.length > 255) add(`product ${label}: bad slug`);
    if (typeof product.name !== 'string' || !product.name.trim()) add(`product ${label}: no name`);
    if (!Number.isFinite(product.price) || product.price < 0) add(`product ${label}: bad price`);
    if (product.isHidden === true || product.is_active === false) add(`product ${label}: a hidden product is in the snapshot`);
    if (!categorySlugs.has(product.category)) add(`product ${label}: category "${product.category}" is not in the category list`);
    if (!Array.isArray(product.variants) || !Array.isArray(product.colors)) add(`product ${label}: variants or colours missing`);
    if (ids.has(product.id)) add(`duplicate product id ${product.id}`);
    if (slugs.has(product.slug)) add(`duplicate product slug ${label}`);
    ids.add(product.id);
    slugs.add(product.slug);
  }

  if (summaries.length !== products.length) add(`${summaries.length} card summaries for ${products.length} products`);
  for (const summary of summaries) if (!ids.has(summary?.id)) add(`a card summary has no matching product (${String(summary?.slug ?? '?').slice(0, 60)})`);
  for (const productId of Object.keys(snapshot.reviews)) if (!ids.has(productId)) add(`reviews for an unknown product ${productId}`);
  return problems;
}

/** Throws a fatal SnapshotError when the snapshot has problems. */
export function assertSnapshot(snapshot: any, rules: SnapshotRules = {}) {
  const problems = snapshotProblems(snapshot, rules);
  if (problems.length) throw new SnapshotError(`The snapshot cannot be published:\n  - ${problems.join('\n  - ')}`, true);
  return snapshot;
}
