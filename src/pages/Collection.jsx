import { useParams } from 'react-router-dom';
import { productPath } from '../../shared/urls';
import ProductCard from '../components/ProductCard';
import { useProducts } from '../context/ProductsContext';
import { useSeo } from '../seo/useSeo';
import { categoryMeta } from '../seo/meta';
import { isNamedCollection, localizedCollectionMeta } from '../seo/collections';
import { useLocale } from '../i18n/LocaleContext';
import '../styles/home.css';
import { useT } from '../i18n/useT';
import { productName } from '../../shared/productText';

export default function Collection() {
  const { t } = useT();
  const { category } = useParams();
  const { getByCategory, loading } = useProducts();

  const { locale } = useLocale();
  const meta = localizedCollectionMeta(category, locale);

  const products = getByCategory(category);

  // A collection the storefront knows (named in seo/collections.js or holding products) is indexable; anything else
  // is not. While products load the head is left as is (the server-written one on a first load, see SeoManager).
  useSeo(
    loading
      ? null
      : categoryMeta({
          name: meta.title,
          description: meta.heroText,
          exists: isNamedCollection(category) || products.length > 0,
          locale,
        }),
  );

  return (
    <main>
      <section className="collection-hero">
        <h1>{meta.title}</h1>
        <p>{meta.heroText}</p>
      </section>

      <div className="collections_wrapper">
        <section className="collection_section">
          {loading ? (
            <p style={{ textAlign: 'center' }}>{t('common.loading')}</p>
          ) : products.length === 0 ? (
            <p style={{ textAlign: 'center' }}>{t('collection.empty')}</p>
          ) : (
            <div className="products_grid">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  name={productName(product, locale)}
                  product={product}
                  image={product.collectionImage || product.mainImage || meta.fallbackImage}
                  linkTo={productPath(product)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
