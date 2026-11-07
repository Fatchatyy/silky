// The product page's main block (thumbnails, zoomable photo, title, description, colours, sizes, price, add to cart,
// buy now). Ported from the visitor view of the old src/pages/Product.jsx: same markup and classes. The admin editing
// mode is not part of the storefront (products are edited in the admin app). It is rendered on the server with the
// first colour and size selected, so the name, price, description and photos are in the HTML a crawler receives.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { productName, productDescription, productImageAlt, productCustomAlt } from '@shared/productText';
import { mediaVariantUrl as imageVariantPath } from '@shared/media';
import { getEffectivePrice } from '@shared/price';
import { getAvailableStock, getStockStatus } from '@shared/stock';
import ProductPrice from './ProductPrice';
import ProductBadges from './ProductBadges';
import BuyNowModal from './BuyNowModal';
import ShareModal from './ShareModal';
import Breadcrumb from './Breadcrumb';
import { api } from '../lib/apiClient';
import { useCart } from '../stores/cart';
import { useFavorites } from '../stores/favorites';
import { useAuth } from '../stores/auth';
import { useLocale } from '../i18n/LocaleContext';
import { useT } from '../i18n/useT';
import { withIsland } from '../lib/island';

// The admin's inline editor: a separate chunk, downloaded only when the browser holds a valid admin token.
const ProductAdminLoader = lazy(() => import('../admin/ProductAdminLoader'));

function ProductMain({ product: staticProduct, breadcrumb = null }) {
  // The page is a static file: its price, discount and stock are those of the last build. Once the page has loaded in the
  // browser it asks the API for the current ones (the first render, and so the HTML a crawler gets, is the static one), so a
  // sale, a restock, a price change or a removed product shows at once instead of after the next publish. Only these three
  // values are refreshed; colours, sizes and photos stay those of the build. If the product is gone (404: deleted or hidden
  // since the build) the page reads "out of stock" and nothing can be added.
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!staticProduct.slug) return undefined;
    let cancelled = false;
    api
      .getProductBySlug(staticProduct.slug)
      .then((fresh) => {
        if (cancelled || !fresh || typeof fresh !== 'object') return;
        setLive({ price: fresh.price, discount: fresh.discount ?? 0, stock: fresh.stock || {} });
      })
      .catch((err) => {
        if (!cancelled && err?.status === 404) setLive({ stock: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [staticProduct.slug]);
  const product = useMemo(() => (live ? { ...staticProduct, ...live } : staticProduct), [staticProduct, live]);

  const { t, known, colorLabel } = useT();
  const { addItem } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { isAdmin } = useAuth();
  const { locale } = useLocale();

  const [quantity, setQuantity] = useState(1);
  // No size is selected when the page opens: the customer must choose one (« Ajouter au panier » and « Commander » ask for it).
  const [selectedSize, setSelectedSize] = useState(null);
  const initialMainImage =
    product.mainImage || product.colors?.[0]?.thumbnail || product.colors?.[0]?.images?.[0] || product.colors?.[0]?.image || '';
  const [mainImage, setMainImage] = useState(initialMainImage);
  const [selectedColor, setSelectedColor] = useState(() => {
    const first = product.colors?.[0] ?? null;
    if (initialMainImage && product.colors?.length > 0) {
      const found = product.colors.find(
        (c) =>
          c.thumbnail === initialMainImage ||
          c.image === initialMainImage ||
          (c.images || []).includes(initialMainImage) ||
          (c.gallery || []).includes(initialMainImage),
      );
      if (found) return found;
    }
    return first;
  });
  const [cartMessage, setCartMessage] = useState('');
  // « Choose a size » asked of the customer: shown red under the size buttons (not in the small line further down), with the
  // buttons outlined and the section scrolled into view. The number restarts the shake on every press; 0 = no error.
  const [sizeErrorTick, setSizeErrorTick] = useState(0);
  const sizeSectionRef = useRef(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const [isZoomed, setIsZoomed] = useState(false);
  const [buyNowModalOpen, setBuyNowModalOpen] = useState(false);
  const [buyNowItem, setBuyNowItem] = useState(null);

  const verticalTrackRef = useRef(null);
  const colorTrackRef = useRef(null);

  // Flattened thumbnails for selection and arrow navigation
  const allThumbnails = useMemo(() => {
    const result = [];
    if (product.colors?.length > 0) {
      product.colors.forEach((color, colorIdx) => {
        const colorThumb = color.thumbnail || color.images?.[0] || color.image || '';
        const gallery = color.gallery || (color.images?.length > 1 ? color.images.slice(1) : []);
        if (colorThumb) {
          result.push({ src: colorThumb, colorId: color.id, colorName: color.name, isThumbnail: true, isGallery: false, colorIdx, color });
        }
        gallery.forEach((src, galleryIdx) => {
          if (src) {
            result.push({ src, colorId: color.id, colorName: color.name, isThumbnail: false, isGallery: true, colorIdx, galleryIdx, color });
          }
        });
      });
    }
    if (!result.length) {
      const fallbackList = product.thumbnails?.length ? product.thumbnails : [product.mainImage];
      fallbackList.filter(Boolean).forEach((src) => {
        result.push({ src, colorId: null, colorName: '', isThumbnail: true, isGallery: false, colorIdx: 0, color: null });
      });
    }
    return result;
  }, [product]);

  // Alt text of a gallery photo: product name, its colour and, when the colour has several photos, which one.
  const photoAlt = (thumb) => {
    const name = productName(product, locale);
    // A custom alt written by the admin (one text for all the photos of the product) wins over the generated one.
    const custom = productCustomAlt(product, locale);
    if (custom) return custom;
    if (!thumb) return name;
    const sameColor = allThumbnails.filter((item) => item.colorId === thumb.colorId);
    return productImageAlt(name, {
      colorName: thumb.colorName ? colorLabel(thumb.colorName, product) : '',
      positionText: sameColor.length > 1 ? t('product.photoOf', { n: sameColor.indexOf(thumb) + 1, total: sameColor.length }) : '',
    });
  };
  const mainImageThumb =
    allThumbnails.find((item) => item.src === mainImage && (selectedColor?.id ? item.colorId === selectedColor.id : true)) ||
    allThumbnails.find((item) => item.src === mainImage);

  const scrollToThumbnail = (index) => {
    if (!verticalTrackRef.current || typeof index !== 'number' || index < 0) return;
    const track = verticalTrackRef.current;
    const buttons = track.querySelectorAll('.thumb_box_vertical');
    const targetBtn = buttons[index];
    if (targetBtn) {
      const trackRect = track.getBoundingClientRect();
      const btnRect = targetBtn.getBoundingClientRect();
      if (track.scrollWidth > track.clientWidth) {
        const offset = btnRect.left - trackRect.left + track.scrollLeft - (track.clientWidth - btnRect.width) / 2;
        track.scrollTo({ left: offset, behavior: 'smooth' });
      }
      if (track.scrollHeight > track.clientHeight) {
        const offset = btnRect.top - trackRect.top + track.scrollTop - (track.clientHeight - btnRect.height) / 2;
        track.scrollTo({ top: offset, behavior: 'smooth' });
      }
    }
  };

  const scrollToColorSwatch = (colorId) => {
    if (!colorTrackRef.current || !colorId || !product.colors?.length) return;
    const targetIdx = product.colors.findIndex((c) => c.id === colorId);
    if (targetIdx !== -1) {
      const track = colorTrackRef.current;
      const targetBtn = track.querySelectorAll('.color_thumb_box')[targetIdx];
      if (targetBtn) {
        const trackLeft = track.getBoundingClientRect().left;
        const btnLeft = targetBtn.getBoundingClientRect().left;
        const offset = btnLeft - trackLeft + track.scrollLeft - (track.clientWidth - targetBtn.clientWidth) / 2;
        track.scrollTo({ left: offset, behavior: 'smooth' });
      }
    }
  };

  const scrollToSection = (targetId) => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const header = document.querySelector('.header_wrapper');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.pageYOffset - headerHeight - 16;
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  };

  const scrollToColorThumbnail = (colorId) => {
    if (!verticalTrackRef.current || !colorId || !allThumbnails.length) return;
    const targetIdx = allThumbnails.findIndex((item) => item.colorId === colorId);
    if (targetIdx !== -1) scrollToThumbnail(targetIdx);
  };

  const handleColorSelect = (color) => {
    if (!color) return;
    setSelectedColor(color);
    setMainImage(color.thumbnail || color.images?.[0] || color.image || product.mainImage || '');
    setCartMessage('');
    scrollToColorThumbnail(color.id);
    scrollToColorSwatch(color.id);
  };

  const handleThumbnailSelect = (thumb, index) => {
    if (!thumb) return;
    setMainImage(thumb.src);
    let parentColor = null;
    if (thumb.color) parentColor = thumb.color;
    else if (thumb.colorId) parentColor = product.colors?.find((c) => c.id === thumb.colorId) || null;
    if (parentColor) setSelectedColor(parentColor);
    setCartMessage('');
    if (typeof index === 'number') {
      scrollToThumbnail(index);
    } else {
      const foundIdx = allThumbnails.findIndex((x) => x === thumb || (x.src === thumb.src && x.colorId === thumb.colorId));
      if (foundIdx !== -1) scrollToThumbnail(foundIdx);
    }
  };

  const handleVerticalArrow = (direction) => {
    if (!allThumbnails.length) return;
    let currentIdx = allThumbnails.findIndex((x) => x.src === mainImage && (selectedColor?.id ? x.colorId === selectedColor.id : true));
    if (currentIdx === -1) currentIdx = allThumbnails.findIndex((x) => x.src === mainImage);
    if (currentIdx === -1) currentIdx = 0;
    const targetIdx = direction === 'up' ? Math.max(0, currentIdx - 1) : Math.min(allThumbnails.length - 1, currentIdx + 1);
    const targetThumb = allThumbnails[targetIdx];
    if (targetThumb) handleThumbnailSelect(targetThumb, targetIdx);
  };

  const handleHorizontalArrow = (direction) => {
    if (!product.colors?.length) return;
    let currentIdx = product.colors.findIndex((c) => c.id === selectedColor?.id);
    if (currentIdx === -1) currentIdx = 0;
    const targetIdx = direction === 'left' ? Math.max(0, currentIdx - 1) : Math.min(product.colors.length - 1, currentIdx + 1);
    const targetColor = product.colors[targetIdx];
    if (targetColor) handleColorSelect(targetColor);
  };

  const availableStock = getAvailableStock(product, selectedColor?.id, selectedSize);
  // The product has sizes and none is chosen yet: there is no stock to talk about (it is per size), so the stock line stays hidden
  // and the quantity is not capped by it (the stock check runs when « Ajouter au panier » / « Commander » is pressed).
  const sizeMissing = product.sizes?.length > 0 && !selectedSize;
  const stockStatus = getStockStatus(availableStock);
  const stockText = t(`stock.${stockStatus.status}`, { qty: availableStock });

  const buildDetails = () => {
    const parts = [];
    if (selectedColor?.name) parts.push(selectedColor.name);
    if (selectedSize) parts.push(`Taille ${selectedSize}`);
    return parts.join(' · ') || 'Standard';
  };

  const currentVariant = useMemo(() => {
    if (!product.variants?.length) return null;
    return (
      product.variants.find((v) => (!selectedColor?.id || v.colorSlug === selectedColor.id) && (!selectedSize || v.size === selectedSize)) ||
      product.variants.find((v) => !selectedColor?.id || v.colorSlug === selectedColor.id) ||
      product.variants[0] ||
      null
    );
  }, [product, selectedColor?.id, selectedSize]);

  const isFav = isFavorite(product.id, currentVariant?.id);

  const validateSelection = () => {
    if (isAdmin) {
      setCartMessage(t('product.adminOrderFav'));
      return false;
    }
    if (product.colors?.length && !selectedColor) {
      setCartMessage(t('product.pickColor'));
      return false;
    }
    if (product.sizes?.length && !selectedSize) {
      setCartMessage('');
      setSizeErrorTick((n) => n + 1);
      sizeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (quantity > availableStock) {
      setCartMessage(t('product.stockInsufficient', { n: availableStock }));
      return false;
    }
    if (availableStock <= 0) {
      setCartMessage(t('product.outOfStockMsg'));
      return false;
    }
    return true;
  };

  const handleAddToCart = async () => {
    if (isAdmin) {
      setCartMessage(t('product.adminOrder'));
      return;
    }
    if (!validateSelection()) return;
    try {
      await addItem({
        productId: product.id,
        variantId: currentVariant?.id ?? null,
        colorId: selectedColor?.id ?? null,
        size: selectedSize ?? null,
        quantity,
      });
      setCartMessage(t('product.added'));
    } catch (err) {
      setCartMessage(known(err.message) || t('product.addFailed'));
    }
  };

  const handleCommander = () => {
    if (isAdmin) {
      setCartMessage(t('product.adminOrder'));
      return;
    }
    if (!validateSelection()) return;
    setBuyNowItem({
      productId: product.id,
      colorId: selectedColor?.id ?? null,
      colorName: selectedColor?.name ?? '',
      size: selectedSize ?? null,
      quantity,
      name: product.name,
      nameAr: product.nameAr ?? null,
      price: getEffectivePrice(product),
      image: mainImage || product.mainImage,
      details: buildDetails(),
    });
    setBuyNowModalOpen(true);
  };

  const publicView = (
    <>
      <main className="product_page_wrapper">
        {/* Vertical Thumbnails Column (Left) */}
        <div className="thumbnails_vertical_container">
          <button type="button" className="scroll_arrow" onClick={() => handleVerticalArrow('up')} aria-label={t('marquee.up')}>
            <span className="scroll_arrow_icon_vertical">❮</span>
          </button>

          <div className="vertical_thumbnails_track" ref={verticalTrackRef}>
            {allThumbnails.map((thumb, index) => {
              const isSelected = mainImage === thumb.src && (thumb.colorId && selectedColor?.id ? thumb.colorId === selectedColor.id : true);
              return (
                <button
                  key={`${thumb.src}-${thumb.colorId || ''}-${index}`}
                  type="button"
                  className={`thumb_box_vertical${isSelected ? ' active' : ''}`}
                  onClick={() => handleThumbnailSelect(thumb, index)}
                >
                  <img src={imageVariantPath(thumb.src, 'card')} alt={photoAlt(thumb)} loading="lazy" decoding="async" />
                </button>
              );
            })}
          </div>
          <button type="button" className="scroll_arrow" onClick={() => handleVerticalArrow('down')} aria-label={t('marquee.down')}>
            <span className="scroll_arrow_icon_vertical">❯</span>
          </button>
        </div>

        {/* Main Featured Zoomable Image and Section Actions */}
        <div className="main_image_column">
          <div
            className="main_image_container"
            onClick={(e) => {
              const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - left) / width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - top) / height) * 100));
              setZoomPos({ x, y });
              setIsZoomed((prev) => !prev);
            }}
            onMouseMove={(e) => {
              if (!isZoomed) return;
              const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - left) / width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - top) / height) * 100));
              setZoomPos({ x, y });
            }}
            onMouseLeave={() => setIsZoomed(false)}
          >
            <ProductBadges product={product} />
            <img
              className="main_product_img"
              src={imageVariantPath(mainImage || product.mainImage, 'large')}
              srcSet={
                imageVariantPath(mainImage || product.mainImage, 'large') !== imageVariantPath(mainImage || product.mainImage, 'card')
                  ? `${imageVariantPath(mainImage || product.mainImage, 'card')} 600w, ${imageVariantPath(mainImage || product.mainImage, 'share')} 1200w, ${imageVariantPath(mainImage || product.mainImage, 'large')} 2400w`
                  : undefined
              }
              sizes="(max-width: 768px) 100vw, 50vw"
              alt={photoAlt(mainImageThumb)}
              fetchPriority="high"
              decoding="async"
              style={{
                transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                transform: isZoomed ? 'scale(2.2)' : 'scale(1)',
                transition: isZoomed ? 'transform-origin 0.05s ease-out, transform 0.15s ease-out' : 'transform 0.25s ease-out',
                cursor: isZoomed ? 'zoom-out' : 'zoom-in',
              }}
            />
          </div>

          <div className="product_section_actions">
            <button type="button" className="product_section_btn" onClick={() => scrollToSection('product_videos_section')}>
              {t('product.seeVideo')}
            </button>
            <button type="button" className="product_section_btn" onClick={() => scrollToSection('product_reviews_container')}>
              {t('product.seeReviews')}
            </button>
          </div>
        </div>

        {/* Product Details Panel (Right) */}
        <div className="product_info_panel">
          {breadcrumb && <Breadcrumb {...breadcrumb} />}
          <h1 className="product_title">{productName(product, locale)}</h1>

          <h2 className="section_subtitle">{t('product.details')}</h2>
          <p className="product_description">{productDescription(product, locale)}</p>

          {/* Color Section */}
          {product.colors?.length > 0 && (
            <div className="color_section">
              <div className="color_header_line">
                <span className="section_subtitle" style={{ marginBottom: 0 }}>
                  {t('product.color')}
                </span>
                <span className="selected_value_text">
                  {selectedColor?.name ? colorLabel(selectedColor.name, product) : t('product.chooseColor')}
                </span>
              </div>

              <div className="color_carousel_wrapper">
                <button type="button" className="scroll_arrow" onClick={() => handleHorizontalArrow('left')} aria-label={t('marquee.left')}>
                  ❮
                </button>
                <div className="horizontal_colors_track" ref={colorTrackRef}>
                  {product.colors.map((color) => {
                    const colorMainImage = color.thumbnail || color.images?.[0] || color.image || product.mainImage;
                    const isColorUnavailable =
                      product.sizes?.length > 0
                        ? selectedSize
                          ? getAvailableStock(product, color.id, selectedSize) <= 0
                          : product.sizes.every((s) => getAvailableStock(product, color.id, s) <= 0)
                        : getAvailableStock(product, color.id, null) <= 0;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        className={`color_thumb_box${selectedColor?.id === color.id ? ' active' : ''}${isColorUnavailable ? ' unavailable' : ''}`}
                        onClick={() => handleColorSelect(color)}
                        title={
                          isColorUnavailable
                            ? t('product.colorUnavailable', { name: colorLabel(color.name, product) })
                            : colorLabel(color.name, product)
                        }
                      >
                        <img src={imageVariantPath(colorMainImage, 'card')} alt={colorLabel(color.name, product)} />
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="scroll_arrow" onClick={() => handleHorizontalArrow('right')} aria-label={t('marquee.right')}>
                  ❯
                </button>
              </div>
            </div>
          )}

          {/* Sizes Section */}
          {product.sizes?.length > 0 && (
            <div className={`size_section${sizeErrorTick > 0 ? ' size_section_error' : ''}`} ref={sizeSectionRef}>
              <div className="color_header_line">
                <span className="section_subtitle" style={{ marginBottom: 0 }}>
                  {t('product.sizeLabel')}
                </span>
                <span className="selected_value_text">
                  {selectedSize ? t('product.sizeValue', { size: selectedSize }) : t('product.chooseSize')}
                </span>
              </div>
              <div className="sizes_grid" key={`sizes-${sizeErrorTick}`}>
                {product.sizes.map((size) => {
                  const isSizeUnavailable =
                    product.colors?.length > 0
                      ? selectedColor
                        ? getAvailableStock(product, selectedColor.id, size) <= 0
                        : product.colors.every((c) => getAvailableStock(product, c.id, size) <= 0)
                      : getAvailableStock(product, null, size) <= 0;
                  return (
                    <button
                      key={size}
                      type="button"
                      className={`size_box${isSizeUnavailable ? ' unavailable' : ''}`}
                      style={selectedSize === size ? { backgroundColor: '#000', color: '#fff' } : undefined}
                      onClick={() => {
                        setSelectedSize(size);
                        setCartMessage('');
                        setSizeErrorTick(0);
                      }}
                      title={isSizeUnavailable ? t('product.sizeUnavailable', { size }) : t('product.sizeValue', { size })}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
              {sizeErrorTick > 0 && (
                <p className="size_error_message" role="alert">
                  {t('product.pickSize')}
                </p>
              )}
            </div>
          )}

          <div className="price_section">
            <span className="price_label">{t('product.price')}</span>
            <ProductPrice product={product} size="large" />
          </div>

          {/* Action Row */}
          <div className="action_row">
            <div className="quantity_wrapper">
              <div className="quantity_box">
                <button type="button" className="qty_btn" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                  -
                </button>
                <input type="text" value={quantity} readOnly className="qty_input" />
                <button type="button" className="qty_btn" onClick={() => setQuantity((q) => (sizeMissing ? q + 1 : Math.min(q + 1, Math.max(availableStock, 1))))}>
                  +
                </button>
              </div>
              <span className="qty_label">{t('product.qty')}</span>
            </div>

            <button type="button" className="add_to_cart_btn" onClick={handleAddToCart}>
              {t('product.addToCart')}
            </button>

            <button
              type="button"
              className={`icon_action_btn${isFav ? ' icon_action_btn_active' : ''}`}
              onClick={() => {
                if (isAdmin) {
                  setCartMessage(t('product.adminFav'));
                  return;
                }
                toggleFavorite({
                  productId: product.id,
                  variantId: currentVariant?.id ?? null,
                  colorId: selectedColor?.id ?? null,
                  size: selectedSize ?? null,
                });
              }}
            >
              <div className="custom_icon_gap">
                <img src="/pictures/heart.png" alt={t('product.fav')} />
              </div>
              <span>{isFav ? t('product.favAdded') : t('product.fav')}</span>
            </button>

            <button type="button" className="icon_action_btn" onClick={() => setShareOpen(true)}>
              <div className="custom_icon_gap">
                <img src="/pictures/share.png" alt={t('product.share')} />
              </div>
              <span>{t('product.share')}</span>
            </button>
          </div>

          {cartMessage && <p className="stock_status_text stock_status_message">{cartMessage}</p>}

          {!sizeMissing && (
            <p className={`stock_status_text stock_${stockStatus.status || (stockStatus.inStock ? 'available' : 'out')}${stockStatus.inStock ? '' : ' out-of-stock'}`}>
              <span className="stock_bullet">•</span> {t('product.stockLabel')} {stockText}
            </p>
          )}

          <button type="button" className="buy_now_btn" onClick={handleCommander}>
            {t('product.order')}
          </button>

          <div className="guarantee_row">
            <div className="badge_icon_gap">
              <img src="/pictures/truckdilevery.png" alt={t('product.deliveryAlt')} />
            </div>
            <span>{t('product.delivery')}</span>
          </div>

          <div className="guarantee_row">
            <div className="badge_icon_gap">
              <img src="/pictures/echange.png" alt={t('product.exchangeAlt')} />
            </div>
            <span>{t('product.exchange')}</span>
          </div>
        </div>
      </main>

      <BuyNowModal isOpen={buyNowModalOpen} onClose={() => setBuyNowModalOpen(false)} buyNowItem={buyNowItem} />
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        product={product}
        image={mainImage || product.mainImage}
        price={getEffectivePrice(product)}
      />
    </>
  );

  // An admin gets the inline editor instead (same server HTML for everyone: this swap happens in the browser only).
  if (isAdmin) {
    return (
      <Suspense fallback={publicView}>
        <ProductAdminLoader productId={product.id} breadcrumb={breadcrumb} fallback={publicView} />
      </Suspense>
    );
  }
  return publicView;
}

export default withIsland(ProductMain);
