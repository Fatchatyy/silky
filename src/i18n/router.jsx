// Drop-in replacements for the react-router-dom pieces that create or follow links, so a visitor who is reading the
// Arabic storefront stays under /ar: Link, NavLink, Navigate and useNavigate add the language prefix to internal paths.
// External addresses and paths that already carry a prefix are left alone. The admin does not use these.
import { forwardRef, useCallback } from 'react';
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  Navigate as RouterNavigate,
  useNavigate as useRouterNavigate,
} from 'react-router-dom';
import { useLocale } from './LocaleContext';
import { localizePath } from '../../shared/locales';

function localizeTo(to, locale) {
  if (typeof to === 'string') return localizePath(to, locale);
  if (to && typeof to === 'object' && typeof to.pathname === 'string') {
    return { ...to, pathname: localizePath(to.pathname, locale) };
  }
  return to;
}

export const Link = forwardRef(function Link({ to, ...rest }, ref) {
  const { locale } = useLocale();
  return <RouterLink ref={ref} to={localizeTo(to, locale)} {...rest} />;
});

export const NavLink = forwardRef(function NavLink({ to, ...rest }, ref) {
  const { locale } = useLocale();
  return <RouterNavLink ref={ref} to={localizeTo(to, locale)} {...rest} />;
});

export function Navigate({ to, ...rest }) {
  const { locale } = useLocale();
  return <RouterNavigate to={localizeTo(to, locale)} {...rest} />;
}

export function useNavigate() {
  const navigate = useRouterNavigate();
  const { locale } = useLocale();
  return useCallback(
    (to, options) => (typeof to === 'number' ? navigate(to) : navigate(localizeTo(to, locale), options)),
    [navigate, locale],
  );
}
