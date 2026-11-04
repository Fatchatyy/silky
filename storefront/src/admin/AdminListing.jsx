// Lists for an admin: the same cards as the server-rendered lists, but including the hidden products (with the
// "Masqué" badge), exactly as the old storefront showed them. The server HTML never contains a hidden product; this
// component replaces the static list in the admin's browser only.
import { useEffect } from 'react';
import { productCustomAlt, productName } from '@shared/productText';
import { productPath } from '@shared/urls';
import { mediaVariantUrl as imageVariantPath } from '@shared/media';
import ProductCard from '../components/ProductCard';
import ProductPrice from '../components/ProductPrice';
import ProductBadges from '../components/ProductBadges';
import { Link } from '../lib/router';
import { useLocale } from '../i18n/LocaleContext';
import { useT } from '../i18n/useT';
import { useProducts } from '../stores/products';

const FALLBACK = { femme: '/pictures/femme_example.jpg', enfant: '/pictures/enfant_example.jpg' };

export default function AdminListing({ kind, category, limit, exclude, hideWhenReady }) {
  const { locale } = useLocale();
  const { t } = useT();
  const { products, loading } = useProducts();

  let list = products.filter((p) => p.category === category && p.id !== exclude);
  if (limit) list = list.slice(0, limit);

  // Once the admin's list is here, the static server-rendered list steps aside.
  useEffect(() => {
    if (loading) return;
    hideWhenReady?.(list.length);
  }, [loading, list.length]);

  if (loading) return null;

  if (kind === 'recs') {
    return list.map((rec) => (
      <div key={rec.id} className={`product_card${rec.isHidden ? ' product_card--hidden' : ''}`}>
        <Link to={productPath(rec)} className="product_card_link">
          <div className="product_card_img_wrapper">
            <ProductBadges product={rec} />
            <img src={imageVariantPath(rec.collectionImage || rec.mainImage, 'card')} alt={productName(rec, locale)} className="product_card_img" loading="lazy" decoding="async" />
          </div>
          <h3 className="product_card_title">{productName(rec, locale)}</h3>
          <p className="product_card_price">
            <ProductPrice product={rec} size="small" />
          </p>
        </Link>
      </div>
    ));
  }

  if (list.length === 0) return <p style={{ textAlign: 'center' }}>{t('collection.empty')}</p>;
  return list.map((product) => (
    <ProductCard
      key={product.id}
      name={productName(product, locale)}
      alt={productCustomAlt(product, locale)}
      product={product}
      image={product.collectionImage || product.mainImage || FALLBACK[category] || FALLBACK.femme}
      linkTo={productPath(product)}
    />
  ));
}
