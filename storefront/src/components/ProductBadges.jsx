import { useAuth } from '../stores/auth';
import { hasDiscount } from '@shared/price';
import { isProductOutOfStock } from '@shared/stock';
import { useT } from '../i18n/useT';

// "Masqué" is only ever drawn for an admin: hidden products only exist in an admin's browser (the server HTML and the
// public API never contain them), and useAuth() knows no user until the page has mounted.
export default function ProductBadges({ product, className = '' }) {
  const { t } = useT();
  const { isAdmin } = useAuth();
  const productObj = product?.product || product;
  const isHidden = Boolean(productObj?.isHidden);
  const isDiscounted = hasDiscount(productObj);
  const isOutOfStock = isProductOutOfStock(productObj);

  if (!isDiscounted && !isOutOfStock && !(isAdmin && isHidden)) return null;

  return (
    <div className={`product_badges ${className}`.trim()}>
      {isAdmin && isHidden && (
        <span className="product_badge product_badge_hidden">
          {t('badge.hidden')}
        </span>
      )}
      {isDiscounted && (
        <span className="product_badge product_badge_promo">
          {t('badge.promo')}
        </span>
      )}
      {isOutOfStock && (
        <span className="product_badge product_badge_out_of_stock">
          {t('badge.soldOut')}
        </span>
      )}
    </div>
  );
}
