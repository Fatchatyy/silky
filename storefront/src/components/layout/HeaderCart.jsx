// Cart link with its count and the dropdown that opens for 5 seconds after an item is added.
import { useEffect, useRef, useState } from 'react';
import { productName } from '@shared/productText';
import { formatPrice } from '@shared/formatPrice';
import { mediaUrl } from '@shared/media';
import { Link } from '../../lib/router';
import { useLocale } from '../../i18n/LocaleContext';
import { useT } from '../../i18n/useT';
import { useCart } from '../../stores/cart';
import { useProducts } from '../../stores/products';
import { withIsland } from '../../lib/island';

function HeaderCart() {
  const { locale } = useLocale();
  const { t, detailsLabel } = useT();
  const { items, itemCount, subtotal, total, lastAddedAt } = useCart();
  const { getProduct } = useProducts({ lazy: true });
  const [isAutoOpen, setIsAutoOpen] = useState(false);
  const cartTimerRef = useRef(null);
  const prevLastAddedRef = useRef(lastAddedAt);

  // Automatically show the dropdown for 5 seconds on a successful addition.
  useEffect(() => {
    if (!lastAddedAt) return;
    if (prevLastAddedRef.current === lastAddedAt) return;
    prevLastAddedRef.current = lastAddedAt;
    if (cartTimerRef.current) clearTimeout(cartTimerRef.current);
    setIsAutoOpen(true);
    cartTimerRef.current = setTimeout(() => {
      setIsAutoOpen(false);
      cartTimerRef.current = null;
    }, 5000);
    return () => {
      if (cartTimerRef.current) {
        clearTimeout(cartTimerRef.current);
        cartTimerRef.current = null;
      }
    };
  }, [lastAddedAt]);

  return (
    <div className="action_item cart_dropdown_container">
      <Link to="/cart" className="cart_link">
        <img src="/pictures/cart.png" alt={t('nav.cart')} className="action_icon_img" />
        <span>{t('nav.cart')}{itemCount > 0 ? ` (${itemCount})` : ''}</span>
      </Link>

      <div className={`cart_dropdown_box${isAutoOpen ? ' is_visible' : ''}`}>
        {items.length === 0 ? (
          <p className="cart_dropdown_empty">{t('cart.empty')}</p>
        ) : (
          <>
            <div className="cart_dropdown_items">
              {items.map((item) => (
                <div key={item.cartItemId} className="cart_dropdown_item">
                  <img src={mediaUrl(item.image || '/pictures/femme_example.jpg')} alt="" />
                  <div className="cart_dropdown_item_info">
                    <span className="cart_dropdown_item_name">{getProduct(item.productId) ? productName(getProduct(item.productId), locale) : item.name}</span>
                    <span className="cart_dropdown_item_meta">
                      {detailsLabel(item.details, getProduct(item.productId))} × {item.quantity}
                    </span>
                  </div>
                  <span className="cart_dropdown_item_price">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>

            <hr className="cart_divider" />

            <div className="cart_row">
              <span>{t('cart.articleCount', { count: itemCount })}</span>
              <span className="cart_amount">{formatPrice(subtotal)}</span>
            </div>

            <div className="cart_row total_row">
              <strong>{t('cart.totalTtc')}</strong>
              <strong className="cart_amount">{formatPrice(total)}</strong>
            </div>
          </>
        )}

        <Link to={items.length ? '/checkout' : '/cart'} className="cart_checkout_btn">
          {t('cart.checkout')}
        </Link>
      </div>
    </div>
  );
}

export default withIsland(HeaderCart);
