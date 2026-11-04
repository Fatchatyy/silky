import { useEffect, useRef, useState } from 'react';
import { productPath } from '../../../shared/urls';
import { Link, useNavigate } from '../../i18n/router';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { useT } from '../../i18n/useT';
import { productName } from '../../../shared/productText';
import { ARABIC_ENABLED, switchLocalePath } from '../../../shared/locales';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useProducts } from '../../context/ProductsContext';
import { formatPrice } from '../../../shared/formatPrice';

export default function Header() {
  const navigate = useNavigate();
  const { pathname: currentPath, search: currentSearch } = useLocation();
  const { locale } = useLocale();
  const { t, detailsLabel, categoryLabel } = useT();
  const otherLocale = locale === 'ar' ? 'fr' : 'ar';
  const { isAuthenticated, isAdmin, logout } = useAuth();

  const accountPath = !isAuthenticated ? '/login' : isAdmin ? '/admin' : '/account';
  const accountLabel = !isAuthenticated ? t('nav.account') : isAdmin ? t('nav.admin') : t('nav.myAccount');
  const { items, itemCount, subtotal, total, lastAddedAt } = useCart();
  const { visibleProducts, getProduct } = useProducts();

  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [isAutoOpen, setIsAutoOpen] = useState(false);
  const searchRef = useRef(null);
  const headerRef = useRef(null);
  const cartTimerRef = useRef(null);
  const prevLastAddedRef = useRef(lastAddedAt);

  // Maintain dynamic header height for sticky subordinate bars
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const updateHeaderHeight = () => {
      const height = el.getBoundingClientRect().height;
      if (height > 0) {
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    };

    updateHeaderHeight();

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateHeaderHeight);
      ro.observe(el);
    }
    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  const trimmed = query.trim().toLowerCase();

  const suggestions = trimmed
    ? visibleProducts
        .filter(
          (p) =>
            p.name?.toLowerCase().includes(trimmed) ||
            p.nameAr?.toLowerCase().includes(trimmed) ||
            p.category?.toLowerCase().includes(trimmed),
        )
        .slice(0, 6)
    : [];

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (!trimmed) return;
    setShowDropdown(false);
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const handleSuggestionClick = (product) => {
    setQuery('');
    setShowDropdown(false);
    navigate(productPath(product));
  };

  const handleViewAll = () => {
    if (!trimmed) return;
    setShowDropdown(false);
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Automatically show cart dropdown for 5 seconds on successful item addition
  useEffect(() => {
    if (!lastAddedAt) return;
    if (prevLastAddedRef.current === lastAddedAt) return;
    prevLastAddedRef.current = lastAddedAt;

    if (cartTimerRef.current) {
      clearTimeout(cartTimerRef.current);
      cartTimerRef.current = null;
    }

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
    <div ref={headerRef} className="header_wrapper">
      <div className="top_utility_bar">
        <div className="contact_section">
          <div className="social_icons">
            <a href="https://www.instagram.com/silky.tn/" target="_blank" rel="noreferrer" className="social_link">
              <img src="/pictures/instagram.png" alt="Instagram" className="icon_img" />
            </a>
            <a href="https://www.tiktok.com/@silky4042" target="_blank" rel="noreferrer" className="social_link">
              <img src="/pictures/tiktok.png" alt="TikTok" className="icon_img" />
            </a>
            <a
              href="https://www.facebook.com/profile.php?id=61560630851600"
              target="_blank"
              rel="noreferrer"
              className="social_link"
            >
              <img src="/pictures/facebook.png" alt="Facebook" className="icon_img" />
            </a>
            <a href="mailto:silky26tn@gmail.com" className="social_link">
              <img src="/pictures/gmail.png" alt="Email" className="icon_img" />
            </a>
          </div>

          <div className="contact_info">
            {t('header.contactLine')} <span dir="ltr">+216 25 274 800</span>
          </div>
        </div>

        <div className="user_actions">
          {ARABIC_ENABLED && (
            <RouterLink
              to={switchLocalePath(currentPath, currentSearch, otherLocale)}
              className="action_item language_switch"
              lang={otherLocale}
              hrefLang={otherLocale}
            >
              <span>{otherLocale === 'ar' ? 'العربية' : 'Français'}</span>
            </RouterLink>
          )}
          <Link to="/leave-review" className="action_item reviews_item" title={t('header.reviewsTitle')}>
            <img src="/pictures/avis.png" alt={t('header.reviewsAlt')} className="reviews_icon_img" />
          </Link>
          <Link
            to="/"
            className="action_item"
            onClick={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
          >
            <img src="/pictures/home.png" alt={t('nav.home')} className="action_icon_img" />
            <span>{t('nav.home')}</span>
          </Link>
          <Link to="/favorites" className="action_item">
            <img src="/pictures/heart.png" alt={t('nav.favorites')} className="action_icon_img" />
            <span>{t('nav.favorites')}</span>
          </Link>

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
                        <img src={item.image || '/pictures/femme_example.jpg'} alt="" />
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

          {isAuthenticated ? (
            <>
              <Link to={accountPath} className="action_item">
                <img
                  src="/pictures/account.png"
                  alt={accountLabel}
                  className="action_icon_img"
                />
                <span>{accountLabel}</span>
              </Link>
              <button
                type="button"
                className="action_item header-logout-btn"
                onClick={handleLogout}
                title={t('nav.logout')}
                aria-label={t('nav.logout')}
              >
                <span>{t('nav.logout')}</span>
              </button>
            </>
          ) : (
            <Link to="/login" className="action_item">
              <img src="/pictures/account.png" alt={t('nav.account')} className="action_icon_img" />
              <span>{t('nav.account')}</span>
            </Link>
          )}
        </div>
      </div>

      <header className="main_header">
        <Link to="/" className="logo">
          <img className="logo_img" src="/pictures/logo.png" alt="Silky Logo" />
        </Link>

        <nav className="nav_links">
          <Link to="/collection/femme">{t('nav.women')}</Link>
          <Link to="/collection/enfant">{t('nav.kids')}</Link>
        </nav>

        <form
          className="search_container"
          onSubmit={handleSearch}
          ref={searchRef}
          role="search"
          aria-label={t('search.label')}
        >
          <input
            id="site-search-input"
            className="search_input"
            type="text"
            placeholder={t('search.placeholder')}
            value={query}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => trimmed && setShowDropdown(true)}
            aria-label={t('search.label')}
            aria-autocomplete="list"
            aria-expanded={showDropdown && suggestions.length > 0}
          />
          <button className="search_button" type="submit">
            {t('search.button')}
          </button>

          {showDropdown && trimmed && (
            <div className="search_dropdown" role="listbox">
              {suggestions.length === 0 ? (
                <div className="search_dropdown_empty">{t('search.noResult', { query })}</div>
              ) : (
                <>
                  {suggestions.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className={`search_dropdown_item${product.isHidden ? ' search_dropdown_item--hidden' : ''}`}
                      onMouseDown={() => handleSuggestionClick(product)}
                      role="option"
                    >
                      <img
                        src={product.collectionImage || product.mainImage || '/pictures/femme_example.jpg'}
                        alt={productName(product, locale)}
                        className="search_dropdown_img"
                      />
                      <div className="search_dropdown_info">
                        <span className="search_dropdown_name">
                          {productName(product, locale)}
                          {product.isHidden && (
                            <span className="admin-badge admin-badge--warning" style={{ marginLeft: 6, fontSize: '0.65rem', padding: '2px 6px' }}>
                              {t('search.hiddenBadge')}
                            </span>
                          )}
                        </span>
                        <span className="search_dropdown_category">{categoryLabel(product.category)}</span>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="search_dropdown_viewall"
                    onMouseDown={handleViewAll}
                  >
                    {t('search.viewAllBefore')}<strong>{query}</strong>{t('search.viewAllAfter')}
                  </button>
                </>
              )}
            </div>
          )}
        </form>
      </header>
    </div>
  );
}
