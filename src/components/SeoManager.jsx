import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { applyHead, removeServerHeadTags } from '../seo/applyHead';
import { splitLocale } from '../../shared/locales';
import { matchRoute } from '../seo/routes';
import { notFoundMeta, routeMeta } from '../seo/meta';
import { SITE_NAME } from '../../shared/urls';

/**
 * Sets the head for every route from src/seo/routes.js, in the language of the URL (/ar/... is Arabic). Product and
 * collection pages set their own metadata from their data (useSeo); an unknown path gets the "page introuvable"
 * metadata (noindex).
 *
 * The server may have written the head of the first URL (title, description, canonical, share-preview tags,
 * product data). Those tags describe that URL only, so the first time the visitor moves to another path the
 * canonical, share-preview and structured-data tags are removed, and a product or collection page starts from the
 * plain site title until its own data arrives. On the first URL itself product and collection pages keep the
 * server-written head while their data loads.
 */
export default function SeoManager() {
  const { pathname } = useLocation();
  const firstPath = useRef(pathname);

  useEffect(() => {
    const isFirstUrl = pathname === firstPath.current;
    if (!isFirstUrl) removeServerHeadTags();

    const { locale, path } = splitLocale(pathname);
    const match = matchRoute(path);
    if (!match) {
      applyHead(notFoundMeta(locale));
      return;
    }
    if (match.route.kind === 'product' || match.route.kind === 'category') {
      if (!isFirstUrl) applyHead({ title: SITE_NAME });
      return;
    }
    applyHead(routeMeta(match.route, locale));
  }, [pathname]);

  return null;
}
