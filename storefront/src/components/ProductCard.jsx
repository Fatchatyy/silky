import { Link } from '../lib/router';
import ProductPrice from './ProductPrice';
import ProductBadges from './ProductBadges';
import { mediaVariantUrl as imageVariantPath } from '@shared/media';

export default function ProductCard({ name, alt, product, image, linkTo = '/product/1' }) {
  const isHidden = Boolean(product?.isHidden);
  return (
    <div className={`product_card${isHidden ? ' product_card--hidden' : ''}`}>
      <Link to={linkTo} className="product_card_link">
        <div className="product_image_container">
          <ProductBadges product={product} />
          <img src={imageVariantPath(image, 'card')} alt={alt || name} className="product_img" loading="lazy" decoding="async" />
        </div>
        <div className="product_info">
          <h3 className="product_name">{name}</h3>
          <p className="product_price">
            <ProductPrice product={product} size="small" />
          </p>
        </div>
      </Link>
    </div>
  );
}
