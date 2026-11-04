// Island props are serialized into the page's HTML: pass small objects holding only the fields the island reads,
// never a whole product.

/** What the product page's main block needs (see components/ProductMain.jsx). */
export function productForMain(p: any) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    nameAr: p.nameAr ?? null,
    description: p.description,
    descriptionAr: p.descriptionAr ?? null,
    category: p.category,
    price: p.price,
    discount: p.discount ?? 0,
    mainImage: p.mainImage,
    collectionImage: p.collectionImage,
    thumbnails: p.thumbnails,
    colors: (p.colors || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      nameAr: c.nameAr ?? null,
      thumbnail: c.thumbnail,
      image: c.image,
      images: c.images,
      gallery: c.gallery,
    })),
    sizes: p.sizes || [],
    stock: p.stock || {},
    variants: (p.variants || []).map((v: any) => ({ id: v.id, colorSlug: v.colorSlug, size: v.size })),
    isHidden: false,
  };
}

/** What the home carousel and the cards of an island need. */
export function productForCard(p: any) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    nameAr: p.nameAr ?? null,
    category: p.category,
    price: p.price,
    discount: p.discount ?? 0,
    mainImage: p.mainImage,
    collectionImage: p.collectionImage,
    stock: p.stock || {},
    isHidden: false,
  };
}
