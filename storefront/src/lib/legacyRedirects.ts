// Old addresses -> canonical addresses. Pure (the Worker passes in the map the build wrote to /redirects-map.json).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RedirectMap = { ids: Record<string, string>; products: string[]; collections: string[] };

/** The canonical address an old one maps to, or null when it maps to nothing (then it is a plain 404). Pure given the map. */
export function legacyTarget(pathname: string, map: RedirectMap): string | null {
  const product = pathname.match(/^(\/ar)?\/product\/([^/]+)\/?$/);
  if (product) {
    const [, prefix = '', raw] = product;
    let segment = raw;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (UUID.test(segment)) {
      const slug = map.ids[segment.toLowerCase()];
      return slug ? `${prefix}/product/${slug}` : null;
    }
    const lower = segment.toLowerCase();
    return lower !== segment && map.products.includes(lower) ? `${prefix}/product/${lower}` : null;
  }
  const collection = pathname.match(/^(\/ar)?\/collection\/([^/]+)((?:\/\d+)?)\/?$/);
  if (collection) {
    const [, prefix = '', raw, page] = collection;
    const lower = raw.toLowerCase();
    return lower !== raw && map.collections.includes(lower) ? `${prefix}/collection/${lower}${page}` : null;
  }
  return null;
}

