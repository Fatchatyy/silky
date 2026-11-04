import { hasDiscount } from '@shared/price';
import { isProductOutOfStock } from '@shared/stock';
import { useT } from '../i18n/useT';

export default function ProductBadges({ product, className = '' }) {
  const { t } = useT();
  const productObj = product?.product || product;
  const isDiscounted = hasDiscount(productObj);
  const isOutOfStock = isProductOutOfStock(productObj);

  if (!isDiscounted && !isOutOfStock) return null;

  return (
    <div className={`product_badges ${className}`.trim()}>
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
