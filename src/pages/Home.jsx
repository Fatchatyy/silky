import CollectionSection from '../components/CollectionSection';
import { productPath } from '../../shared/urls';
import ProductCarousel from '../components/ProductCarousel';
import ReviewsSection from '../components/ReviewsSection';
import HeroRenderer from '../components/hero/HeroRenderer';
import { useProducts } from '../context/ProductsContext';
import { useTheme } from '../context/ThemeContext';
import '../styles/home.css';
import { useT } from '../i18n/useT';
import { productName } from '../../shared/productText';

export default function Home() {
  const { t, locale } = useT();
  const { getByCategory, visibleProducts, loading } = useProducts();
  const { theme } = useTheme();

  const femmeProducts = getByCategory('femme').slice(0, 4).map((p) => ({
    name: productName(p, locale),
    product: p,
    image: p.collectionImage || p.mainImage,
    linkTo: productPath(p),
  }));

  const enfantProducts = getByCategory('enfant').slice(0, 4).map((p) => ({
    name: productName(p, locale),
    product: p,
    image: p.collectionImage || p.mainImage,
    linkTo: productPath(p),
  }));

  const femmeHeroImage =
    getByCategory('femme')[0]?.collectionImage ||
    getByCategory('femme')[0]?.mainImage ||
    '/pictures/femme_example.jpg';

  const enfantHeroImage =
    getByCategory('enfant')[0]?.collectionImage ||
    getByCategory('enfant')[0]?.mainImage ||
    '/pictures/enfant_example.jpg';

  return (
    <>
      <HeroRenderer heroConfig={theme?.heroConfig} />

      {!loading && visibleProducts.length > 0 && <ProductCarousel products={visibleProducts} />}

      <div className="collections_wrapper">
        {!loading && femmeProducts.length > 0 && (
          <CollectionSection
            title={t('collection.women')}
            image={femmeHeroImage}
            products={femmeProducts}
            viewAllHref="/collection/femme"
          />
        )}

        {!loading && enfantProducts.length > 0 && (
          <CollectionSection
            title={t('collection.kids')}
            image={enfantHeroImage}
            products={enfantProducts}
            viewAllHref="/collection/enfant"
          />
        )}
      </div>

      <ReviewsSection />
    </>
  );
}
