// Replacement for react-router-dom and the old i18n/router.jsx: the storefront is made of separate pages, so a link
// is a plain <a href> and moving to another page is a full navigation. Internal paths get the language prefix
// (/ar/...) exactly as before. Router "state" (where to return after login, the order just placed) is handed to the
// next page through sessionStorage, keyed by the destination path.
import { forwardRef, useCallback, useEffect } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { localizePath } from '@shared/locales';

const STATE_KEY = 'silky:nav-state';

function localizeTo(to, locale) {
  if (typeof to === 'string') return localizePath(to, locale);
  if (to && typeof to === 'object' && typeof to.pathname === 'string') {
    return `${localizePath(to.pathname, locale)}${to.search || ''}${to.hash || ''}`;
  }
  return '/';
}

function stashState(href, state) {
  try {
    if (state === undefined) return sessionStorage.removeItem(STATE_KEY);
    const path = new URL(href, window.location.origin).pathname;
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ path, state }));
  } catch {
    /* storage unavailable: the next page simply gets no state */
  }
}

export const Link = forwardRef(function Link({ to, state, replace, onClick, ...rest }, ref) {
  const { locale } = useLocale();
  const href = localizeTo(to, locale);
  const handleClick = state === undefined ? onClick : (event) => {
    stashState(href, state);
    onClick?.(event);
  };
  return <a ref={ref} href={href} onClick={handleClick} {...rest} />;
});

export const NavLink = forwardRef(function NavLink({ to, className, end, ...rest }, ref) {
  const { locale } = useLocale();
  const href = localizeTo(to, locale);
  const isActive = typeof window !== 'undefined' && window.location.pathname === href.split(/[?#]/)[0];
  const resolved = typeof className === 'function' ? className({ isActive }) : className;
  return <a ref={ref} href={href} className={resolved} {...rest} />;
});

export function useNavigate() {
  const { locale } = useLocale();
  return useCallback(
    (to, options = {}) => {
      if (typeof to === 'number') return window.history.go(to);
      const href = localizeTo(to, locale);
      stashState(href, options.state);
      if (options.replace) window.location.replace(href);
      else window.location.assign(href);
    },
    [locale],
  );
}

export function Navigate({ to, replace, state }) {
  const navigate = useNavigate();
  // Effects do not run during server rendering, so nothing happens there.
  useEffect(() => navigate(to, { replace, state }), [navigate, to, replace, state]);
  return null;
}

/** { pathname, search, hash, state }; the state is the one handed over by Link/useNavigate for this very path. */
export function useLocation() {
  if (typeof window === 'undefined') return { pathname: '/', search: '', hash: '', state: null };
  let state = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    if (saved && saved.path === window.location.pathname) state = saved.state;
  } catch {
    state = null;
  }
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash, state };
}

export function useParams() {
  return useLocale().params || {};
}

export function useSearchParams() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const set = (next) => {
    const query = new URLSearchParams(next).toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  };
  return [params, set];
}
