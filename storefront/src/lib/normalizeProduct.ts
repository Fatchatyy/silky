// Shapes a product from the API the way the storefront uses it: every colour has a thumbnail, a gallery and an
// images list, the product has a flat thumbnails list, and hidden products are flagged. Pure.
export function normalizeProduct(p: any) {
  if (!p) return p;
  const colors = (p.colors || []).map((c: any) => {
    const rawImages = (c.images || (c.image ? [c.image] : []))
      .map((img: any) => (typeof img === 'string' ? img.trim() : ''))
      .filter(Boolean);
    const thumbnail = c.thumbnail || rawImages[0] || c.image || p.mainImage || '';
    const gallery = c.gallery || rawImages.slice(1);
    const images = rawImages.length ? rawImages : thumbnail ? [thumbnail] : [];
    return { ...c, image: thumbnail, thumbnail, gallery, images };
  });
  const allThumbnails = p.thumbnails?.length ? p.thumbnails : colors.flatMap((c: any) => c.images).filter(Boolean);
  return {
    ...p,
    colors,
    thumbnails: allThumbnails.length ? allThumbnails : [p.mainImage].filter(Boolean),
    videos: Array.isArray(p.videos) ? p.videos : [],
    isHidden: p.isHidden === true || p.is_active === false,
    is_active: !(p.isHidden === true || p.is_active === false),
  };
}
