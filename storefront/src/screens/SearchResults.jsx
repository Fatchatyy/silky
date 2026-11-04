import { useSearchParams } from '../lib/router.jsx';
import { productPath } from '@shared/urls';
import ProductCard from '../components/ProductCard';
import { useProducts } from '../stores/products';
import { useT } from '../i18n/useT';
import { productName } from '@shared/productText';

// Arabic counts 3 to 10 take the plural noun; French takes the plural from 2.
const resultsKey = (locale, n) =>
  locale === 'ar' ? (n >= 3 && n <= 10 ? 'search.results.many' : 'search.results.one') : n === 1 ? 'search.results.one' : 'search.results.many';

export default function SearchResults() {
  const { t, locale } = useT();
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const { visibleProducts, loading } = useProducts();

  const trimmed = query.trim().toLowerCase();

  const results = trimmed
    ? visibleProducts.filter(
        (p) =>
          p.name?.toLowerCase().includes(trimmed) ||
          p.nameAr?.toLowerCase().includes(trimmed) ||
          p.category?.toLowerCase().includes(trimmed) ||
          p.description?.toLowerCase().includes(trimmed) ||
          p.descriptionAr?.toLowerCase().includes(trimmed),
      )
    : [];

  return (
    <main className="search-results-page">
      <section className="collection-hero">
        <h1>{t('search.title')}</h1>
        {trimmed && (
          <p>
            {t(resultsKey(locale, results.length), { count: results.length })}<em>{query}</em>{t('search.viewAllAfter')}
          </p>
        )}
      </section>

      <div className="collections_wrapper">
        <section className="collection_section">
          {loading ? (
            <p style={{ textAlign: 'center' }}>{t('common.loading')}</p>
          ) : !trimmed ? (
            <p style={{ textAlign: 'center' }}>{t('search.prompt')}</p>
          ) : results.length === 0 ? (
            <p style={{ textAlign: 'center' }}>
              {t('search.noneBefore')}<strong>{query}</strong>{t('search.noneAfter')}
            </p>
          ) : (
            <div className="products_grid">
              {results.map((product) => (
                <ProductCard
                  key={product.id}
                  name={productName(product, locale)}
                  product={product}
                  image={product.collectionImage || product.mainImage || '/pictures/femme_example.jpg'}
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
