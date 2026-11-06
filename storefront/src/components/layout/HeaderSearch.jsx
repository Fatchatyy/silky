// The header search box. Without JavaScript it is a plain GET form to /search?q=; with it, suggestions appear as the
// visitor types (the small search index, /search-index.json, is downloaded on the first keystroke, not on every page view).
import { useEffect, useRef, useState } from 'react';
import { productPath } from '@shared/urls';
import { productName } from '@shared/productText';
import { mediaUrl } from '@shared/media';
import { localizePath } from '@shared/locales';
import { useNavigate } from '../../lib/router';
import { useLocale } from '../../i18n/LocaleContext';
import { useT } from '../../i18n/useT';
import { useSearchProducts } from '../../stores/searchIndex';
import { withIsland } from '../../lib/island';

function HeaderSearch() {
  const navigate = useNavigate();
  const { locale } = useLocale();
  const { t, categoryLabel } = useT();
  const { products: visibleProducts, ensureLoaded } = useSearchProducts({ lazy: true });
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);

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

  const goToResults = () => {
    if (!trimmed) return;
    setShowDropdown(false);
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    goToResults();
  };

  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <form
      className="search_container"
      action={localizePath('/search', locale)}
      method="get"
      onSubmit={handleSearch}
      ref={searchRef}
      role="search"
      aria-label={t('search.label')}
    >
      <input
        id="site-search-input"
        className="search_input"
        type="text"
        name="q"
        placeholder={t('search.placeholder')}
        value={query}
        autoComplete="off"
        onChange={(e) => {
          ensureLoaded();
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
                  onMouseDown={() => {
                    setQuery('');
                    setShowDropdown(false);
                    navigate(productPath(product));
                  }}
                  role="option"
                >
                  <img
                    src={mediaUrl(product.collectionImage || product.mainImage || '/pictures/femme_example.jpg')}
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
              <button type="button" className="search_dropdown_viewall" onMouseDown={goToResults}>
                {t('search.viewAllBefore')}
                <strong>{query}</strong>
                {t('search.viewAllAfter')}
              </button>
            </>
          )}
        </div>
      )}
    </form>
  );
}

export default withIsland(HeaderSearch);
