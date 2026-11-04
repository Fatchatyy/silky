// Test data for the storefront scripts, created in silky_test through the real product service and removed afterwards.
// Never touches another database: the caller must already have passed assertSilkyTestUrl().
import crypto from 'node:crypto';
import http from 'node:http';

export async function startApi(port = 0) {
  const { app } = await import('../../../server/app.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function createFixtures() {
  const { pool } = await import('../../../server/db/pool.js');
  const { db } = await import('../../../server/db/orm.js');
  const { eq, inArray } = await import('drizzle-orm');
  const { categories, products, reviews } = await import('../../../server/models/index.js');
  const productService = await import('../../../server/services/product.service.js');

  const marker = `sfx${crypto.randomBytes(3).toString('hex')}`;
  const created = { categoryIds: [], productIds: [], reviewIds: [] };

  const ensureCategory = async (slug, name) => {
    const [existing] = await db.select().from(categories).where(eq(categories.slug, slug));
    if (existing) return existing;
    const [row] = await db.insert(categories).values({ name, slug }).returning();
    created.categoryIds.push(row.id);
    return row;
  };
  const femme = await ensureCategory('femme', 'Femme');
  const enfant = await ensureCategory('enfant', 'Enfant');
  const custom = await ensureCategory(`${marker}-custom`, `Special ${marker}`);

  const make = async (slug, overrides = {}) => {
    const product = await productService.createProduct({
      name: `Produit ${slug}`,
      slug: `${marker}-${slug}`,
      description: `Description de ${slug}. Une pièce élégante en tissu fluide, coupe droite.`,
      category: femme.slug,
      categoryId: femme.id,
      price: 89.9,
      collectionImage: '/pictures/blushmarron.jpg',
      colors: [
        { id: 'noir', name: 'Noir', image: '/pictures/blushmarron.jpg', gallery: ['/pictures/blushrose.jpg'] },
        { id: 'rose', name: 'Rose', image: '/pictures/comfyrose.jpg', gallery: [] },
      ],
      sizes: ['S', 'M'],
      stock: { 'noir-S': 3, 'noir-M': 2, 'rose-S': 0, 'rose-M': 5 },
      ...overrides,
    });
    created.productIds.push(product.id);
    return product;
  };

  const robe = await make('robe', {
    name: `Robe Satin ${marker}`,
    nameAr: 'فستان ساتان',
    descriptionAr: 'فستان ساتان أنيق بقصة مستقيمة.',
    discount: 10,
    colors: [
      { id: 'noir', name: 'Noir', nameAr: 'أسود', image: '/pictures/blushmarron.jpg', gallery: ['/pictures/blushrose.jpg'] },
      { id: 'rose', name: 'Rose', image: '/pictures/comfyrose.jpg', gallery: [] },
    ],
  });
  const chemise = await make('chemise', { name: `Chemise Lin ${marker}` });
  const enfantProduct = await make('enfant', { name: `Ensemble Enfant ${marker}`, category: enfant.slug, categoryId: enfant.id, price: 35 });
  const customProduct = await make('custom', { name: `Article Special ${marker}`, category: custom.slug, categoryId: custom.id });
  const evil = await make('evil', {
    name: `Produit </script><script>alert(1)</script> ${marker}`,
    description: 'Texte avec </script><script>window.__pwned=1</script> et "guillemets" & esperluette.',
  });
  const hidden = await make('cache', { name: `Produit Cache ${marker}`, isHidden: true });

  const [review] = await db
    .insert(reviews)
    .values({
      productId: robe.id,
      guestSessionId: crypto.randomUUID(),
      email: `${marker}@reviewer.test`,
      authorName: 'Cliente Test',
      rating: 5,
      comment: `Très belle robe ${marker}`,
      isApproved: true,
      status: 'approved',
      showInGeneral: false,
    })
    .returning();
  created.reviewIds.push(review.id);

  return {
    marker,
    robe,
    chemise,
    enfantProduct,
    customProduct,
    evil,
    hidden,
    customCategory: custom,
    async cleanup() {
      if (created.reviewIds.length) await db.delete(reviews).where(inArray(reviews.id, created.reviewIds));
      if (created.productIds.length) await db.delete(products).where(inArray(products.id, created.productIds));
      if (created.categoryIds.length) await db.delete(categories).where(inArray(categories.id, created.categoryIds));
      const left = created.productIds.length ? await db.select({ id: products.id }).from(products).where(inArray(products.id, created.productIds)) : [];
      await pool.end().catch(() => {});
      return left.length === 0;
    },
  };
}
