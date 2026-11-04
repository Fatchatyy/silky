import { formatPrice } from '@shared/formatPrice';
import { useLocale } from '../i18n/LocaleContext';
import { getEffectivePrice, hasDiscount } from '@shared/price';

export default function ProductPrice({ product, className = '', size = 'default' }) {
  const { locale } = useLocale();
  const discounted = hasDiscount(product);
  const effective = getEffectivePrice(product);
  const sizeClass = size === 'large' ? 'product_price_large' : size === 'small' ? 'product_price_small' : '';

  if (!discounted) {
    return <span className={`product_price_display ${sizeClass} ${className}`.trim()}>{formatPrice(product.price)}</span>;
  }

  return (
    <span className={`product_price_display product_price_discounted ${sizeClass} ${className}`.trim()}>
      <span className="price_original">{formatPrice(product.price)}</span>
      <span className="price_discount_amount">{locale === 'ar' ? '\u200E-' : '-'}{formatPrice(product.discount)}</span>
      <span className="price_new">{formatPrice(effective)}</span>
    </span>
  );
}
