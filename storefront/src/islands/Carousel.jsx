import { useEffect } from 'react';
import { withIsland } from '../lib/island';
import ProductCarousel from '../components/ProductCarousel';
import { useAuth } from '../stores/auth';
import { useProducts } from '../stores/products';

// The server sends the published products. For an admin's browser the list is replaced by the one that includes the
// hidden products (they carry the "Masqué" badge), as the old storefront's home page did.
function Carousel({ products }) {
  const { isAdmin } = useAuth();
  const { products: all, loading, ensureLoaded } = useProducts({ lazy: true });
  useEffect(() => {
    if (isAdmin) ensureLoaded();
  }, [isAdmin]);
  const useAll = isAdmin && !loading && all.length > 0;
  return <ProductCarousel products={useAll ? all : products} showHidden={useAll} />;
}

export default withIsland(Carousel);
