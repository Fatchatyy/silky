import { Link } from '../lib/router';
import { ADMIN_URL } from '../lib/adminUrl';
import { useCart } from '../stores/cart';
import { useAuth } from '../stores/auth';
import { formatPrice } from '@shared/formatPrice';
import { mediaVariantUrl as imageVariantPath } from '@shared/media';
import { useT } from '../i18n/useT';
import { useProducts } from '../stores/products';
import { cartItemName } from '@shared/productText';

export default function Cart() {
  const { t, known, locale, detailsLabel } = useT();
  const { isAdmin } = useAuth();
  const { getProduct } = useProducts();

  // The order keeps the French name; Arabic pages show the Arabic name the cart API sends with each line (no wait for the product list).
  const itemName = (item) => cartItemName(item, locale);
  const { items, deliveryFee, subtotal, total, itemCount, updateQuantity, removeItem, loading, error } = useCart();

  if (isAdmin) {
    return (
      <main className="collections_wrapper" style={{ minHeight: 400, paddingTop: 40 }}>
        <h1 className="collection_title">{t('cart.title')}</h1>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ fontSize: 16, color: '#b00020', marginBottom: 24 }}>
            {t('product.adminOrder')}
          </p>
          <a href={ADMIN_URL} className="tout_button">
            {t('contact.backAdmin')}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main>
      <section className="cart-section">
        <h1 className="cart-title">{t('cart.title')}</h1>

        {error && (
          <p style={{ textAlign: 'center', color: '#b00020', marginBottom: 16 }} role="alert">
            {known(error)}
          </p>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p>{t('cart.loading')}</p>
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p>{t('cart.empty')}</p>
            <Link to="/" className="secondary-btn" style={{ display: 'inline-block', marginTop: 16 }}>
              {t('cart.continue')}
            </Link>
          </div>
        ) : (
          <div className="cart-layout">
            <div className="cart-items-wrapper">
              <div className="cart-items-container">
                <div className="cart-header">
                  <span>{t('cart.item')}</span>
                  <span>{t('product.price')}</span>
                  <span>{t('product.qty')}</span>
                  <span>{t('cart.totalPrice')}</span>
                  <span></span>
                </div>

                {items.map((item) => (
                  <div key={item.cartItemId} className="cart-item">
                    <div className="product-info">
                      <img
                        src={imageVariantPath(item.image || '/pictures/femme_example.jpg', 'card')}
                        alt={itemName(item)}
                        className="product-image"
                      />
                      <div className="product-details">
                        <h4>{itemName(item)}</h4>
                        <p>{detailsLabel(item.details, getProduct(item.productId))}</p>
                      </div>
                    </div>

                    <div className="price">{formatPrice(item.price)}</div>

                    <div className="quantity-control-wrapper">
                      <div className="quantity-control">
                        <button
                          type="button"
                          className="quantity-btn"
                          onClick={() => updateQuantity(item.cartItemId, -1)}
                        >
                          -
                        </button>
                        <input type="text" className="quantity-input" value={item.quantity} readOnly />
                        <button
                          type="button"
                          className="quantity-btn"
                          onClick={() => updateQuantity(item.cartItemId, 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="total-price">{formatPrice(item.price * item.quantity)}</div>

                    <button
                      type="button"
                      className="remove-btn"
                      aria-label={t('cart.remove')}
                      onClick={() => removeItem(item.cartItemId)}
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>

              <Link to="/" className="secondary-btn">
                {t('cart.continue')}
              </Link>
            </div>

            <div className="cart-summary">
              <div className="summary-row">
                <span>{t('cart.items', { count: itemCount })}</span>
                <strong>{formatPrice(subtotal)}</strong>
              </div>

              <div className="summary-row">
                <span>{t('cart.delivery')}</span>
                <strong>{formatPrice(deliveryFee)}</strong>
              </div>

              <div className="summary-divider"></div>

              <div className="summary-total">
                <span className="total-label">{t('cart.total')}</span>
                <span className="total-amount">{formatPrice(total)}</span>
              </div>

              <Link to="/checkout" className="submit-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                {t('cart.confirm')}
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
