import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyHead } from './applyHead';

/**
 * Applies page metadata built from the page's own data (product, collection). Pass null to leave the head as is.
 * It also runs again when the path changes with the same data (a product opened by its id moves to its slug address
 * in place): SeoManager resets the head on every path change and this page must put its own back.
 */
export function useSeo(meta) {
  const { pathname } = useLocation();
  const { title, description, robots } = meta || {};
  useEffect(() => {
    if (title) applyHead({ title, description, robots });
  }, [title, description, robots, pathname]);
}
