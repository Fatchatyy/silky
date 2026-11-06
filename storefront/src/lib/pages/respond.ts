/** Open Graph photo of a home or collection page: the first product's photo (its 1200 px copy is picked by the SEO builder), else the logo. */
export function shareImagePath(products: any[]): string {
  const first = products?.[0];
  return first?.mainImage || first?.collectionImage || '/pictures/logo.png';
}
