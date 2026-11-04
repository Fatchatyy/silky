import { useState } from 'react';
import { productPath } from '../../shared/urls';
import { Link } from '../i18n/router';
import ProductPrice from '../components/ProductPrice';
import ProductBadges from '../components/ProductBadges';
import { useFavorites } from '../context/FavoritesContext';
import { useProducts } from '../context/ProductsContext';
import { useAuth } from '../context/AuthContext';
import { imageVariantPath } from '../../shared/imageVariants.js';
import '../styles/home.css';
import { useT } from '../i18n/useT';
import { productName } from '../../shared/productText';

export default function Favorites() {
  const { t, known, locale, colorLabel } = useT();
  const { isAdmin } = useAuth();
  const { items: favoriteItems, removeFavorite, loading: favoritesLoading, error: favoritesError } = useFavorites();
  const { getProduct, loading: productsLoading } = useProducts();
  const [removingId, setRemovingId] = useState(null);

  const favorites = favoriteItems.map((fav) => {
    const product = getProduct(fav.productId);
    const colorObj = product?.colors?.find((c) => c.id === (fav.colorSlug || fav.colorId)) || null;
    const colorName = fav.colorName || colorObj?.name || (typeof colorObj === 'string' ? colorObj : '');
    const size = fav.size || null;
    const image = fav.image || colorObj?.thumbnail || colorObj?.image || product?.collectionImage || product?.mainImage || '/pictures/femme_example.jpg';
    const price = fav.price || product?.price || 0;
    const discount = fav.discount || product?.discount || 0;
    const effectivePrice = fav.effectivePrice || (discount > 0 ? price - discount : price);

    return {
      favoriteId: fav.id,
      id: fav.id,
      productId: fav.productId,
      variantId: fav.variantId || null,
      name: (product && productName(product, locale)) || fav.name || '',
      price,
      discount,
      effectivePrice,
      image,
      colorId: fav.colorSlug || fav.colorId || colorObj?.id || null,
      colorName,
      size,
      isHidden: product?.isHidden,
      product: product || null,
    };
  });

  const handleRemove = async (e, fav) => {
    e.preventDefault();
    e.stopPropagation();
    const removeKey = fav.favoriteId || fav.variantId || fav.productId;
    setRemovingId(removeKey);
    try {
      await removeFavorite({
        favoriteId: fav.favoriteId,
        variantId: fav.variantId,
        productId: fav.productId,
      });
    } catch (err) {
      console.error('Error removing favorite:', err);
    } finally {
      setRemovingId(null);
    }
  };

  if (isAdmin) {
    return (
      <main className="collections_wrapper" style={{ minHeight: 400, paddingTop: 40 }}>
        <h1 className="collection_title">{t('fav.title')}</h1>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ fontSize: 16, color: '#b00020', marginBottom: 24 }}>
            {t('fav.adminNone')}
          </p>
          <Link to="/admin" className="tout_button">
            {t('fav.adminBack')}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="collections_wrapper" style={{ minHeight: 400, paddingTop: 40 }}>
      <h1 className="collection_title">{t('fav.title')}</h1>

      {favoritesError && (
        <p style={{ textAlign: 'center', color: '#b00020', marginBottom: 16 }} role="alert">
          {known(favoritesError)}
        </p>
      )}

      {favoritesLoading || productsLoading ? (
        <p style={{ textAlign: 'center' }}>{t('common.loading')}</p>
      ) : favorites.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ fontSize: 16, color: '#555', marginBottom: 24 }}>
            {t('fav.empty')}
          </p>
          <Link to="/" className="secondary-btn" style={{ display: 'inline-block', marginTop: 16 }}>
            {t('fav.discover')}
          </Link>
        </div>
      ) : (
        <div className="products_grid">
          {favorites.map((fav) => {
            const variantParts = [];
            if (fav.colorName) variantParts.push(t('fav.color', { value: colorLabel(fav.colorName, getProduct(fav.productId)) }));
            if (fav.size) variantParts.push(t('fav.size', { value: fav.size }));
            const variantText = variantParts.join(' · ');
            const cardKey = fav.favoriteId || `${fav.productId}-${fav.variantId || 'legacy'}`;
            const actionKey = fav.favoriteId || fav.variantId || fav.productId;

            return (
              <div key={cardKey} className={`product_card${fav.isHidden ? ' product_card--hidden' : ''}`}>
                <div className="product_image_container" style={{ position: 'relative' }}>
                  <ProductBadges product={fav.product || fav} className="fav_product_badges" />
                  <Link to={productPath(getProduct(fav.productId) || fav.productId)} className="product_card_link">
                    <img
                      src={imageVariantPath(fav.image, 'card')}
                      alt={fav.name}
                      className="product_img"
                      loading="lazy"
                      decoding="async"
                    />
                  </Link>
                  <button
                    type="button"
                    className="fav_image_remove_icon"
                    onClick={(e) => handleRemove(e, fav)}
                    title={t('fav.removeTitle')}
                    aria-label={t('fav.removeTitle')}
                    disabled={removingId === actionKey}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                </div>

                <div className="product_info" style={{ width: '100%' }}>
                  <Link to={productPath(getProduct(fav.productId) || fav.productId)} className="product_card_link">
                    <h3 className="product_name">{fav.name}</h3>
                    <p className="product_price">
                      <ProductPrice product={fav.product || fav} size="small" />
                    </p>
                    {variantText && <p className="fav_variant_info">{variantText}</p>}
                  </Link>

                  <div className="fav_card_actions">
                    <button
                      type="button"
                      className="fav_remove_btn"
                      onClick={(e) => handleRemove(e, fav)}
                      disabled={removingId === actionKey}
                    >
                      {t('fav.removeButton')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
