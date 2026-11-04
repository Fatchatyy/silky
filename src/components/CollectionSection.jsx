import { Link } from '../i18n/router';
import ProductCard from './ProductCard';
import { useT } from '../i18n/useT';

export default function CollectionSection({ title, image, products, viewAllHref = '#' }) {
  const { t } = useT();
  return (
    <section className="collection_section">
      <h2 className="collection_title">{title}</h2>

      <div className="products_grid">
        {products.map((product, index) => (
          <ProductCard
            key={product.linkTo || `${product.name}-${index}`}
            name={product.name}
            product={product.product || product}
            image={product.image || image}
            linkTo={product.linkTo || `/product/${index + 1}`}
          />
        ))}
      </div>

      <div className="button_container">
        <Link to={viewAllHref} className="tout_button">
          {t('collection.all')}
        </Link>
      </div>
    </section>
  );
}
