// Serves the built storefront and writes each page's head (title, description, canonical, share-preview tags,
// product data) into index.html, with real HTTP status codes. React still renders the whole page body; only the
// <head> and the status change. Also serves robots.txt and sitemap.xml.
//
// Rules this router keeps:
//   - GET/HEAD only; /api and /uploads are never answered here.
//   - Absolute URLs come from the configured SITE_URL, never from the request's Host header.
//   - It is mounted outside /api, so no guest-session cookie is set: the HTML holds public data only.
//   - SEO_HTML off (or SITE_URL missing/invalid, or markers missing from the template) sends the built
//     index.html unchanged for every page route.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { buildRobotsTxt } from './robots.js';
import { buildSitemapEntries, buildSitemapXml } from './sitemap.js';
import { hasHeadMarkers, injectHead, renderHead } from './renderHead.js';
import { injectRootContent } from './renderBody.js';
import { resolvePage } from './resolvePage.js';
import { dirOf, splitLocale } from '../../shared/locales.js';

const RESERVED = /^\/(api|uploads)(\/|$)/;
const LOOKS_LIKE_FILE = /\.[a-z0-9]{1,8}$/i;
const NO_CACHE = 'no-cache';

function queryOf(url) {
  const i = url.indexOf('?');
  return i === -1 ? '' : url.slice(i);
}

function plainNotFound(res) {
  res.status(404).type('text/plain; charset=utf-8').send('Not found');
}

export function createSeoRouter({ siteUrl = '', htmlEnabled = false, distDir, serveFrontend = false, loaders, log = console }) {
  const router = express.Router();

  router.get('/robots.txt', (_req, res) => {
    if (!siteUrl) return plainNotFound(res);
    res
      .status(200)
      .set('Cache-Control', NO_CACHE)
      .type('text/plain; charset=utf-8')
      .send(buildRobotsTxt(siteUrl));
  });

  router.get('/sitemap.xml', async (_req, res) => {
    if (!siteUrl) return plainNotFound(res);
    try {
      const { products, categories } = await loaders.listSitemapData();
      const xml = buildSitemapXml(buildSitemapEntries({ products, categories }), siteUrl);
      res.status(200).set('Cache-Control', NO_CACHE).type('application/xml; charset=utf-8').send(xml);
    } catch (err) {
      log.error('[seo] sitemap failed:', err?.message);
      res.status(503).type('text/plain; charset=utf-8').send('Sitemap temporarily unavailable');
    }
  });

  if (!serveFrontend) return router;

  const indexFile = path.join(distDir, 'index.html');
  let template;
  try {
    template = fs.readFileSync(indexFile, 'utf8');
  } catch {
    log.error(`[seo] ${indexFile} not found (run "npm run build"); the built frontend is not served.`);
    return router;
  }

  let writeHead = htmlEnabled;
  if (writeHead && !siteUrl) {
    log.error('[seo] SEO_HTML=on needs a valid SITE_URL; sending index.html unchanged.');
    writeHead = false;
  }
  if (writeHead && !hasHeadMarkers(template)) {
    log.error('[seo] <!--seo-head--> markers are missing from the built index.html; sending it unchanged.');
    writeHead = false;
  }

  const sendTemplate = (res, status = 200) =>
    res.status(status).set('Cache-Control', NO_CACHE).type('text/html; charset=utf-8').send(template);

  // /api and /uploads belong to the rest of the app.
  router.use((req, _res, next) => (RESERVED.test(req.path) ? next('router') : next()));

  // The built file would otherwise be served as a second copy of the home page, without its page head.
  router.get('/index.html', (req, res) => res.redirect(301, `/${queryOf(req.originalUrl)}`));

  router.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        // Files under /assets have a content hash in their name and never change.
        if (filePath.split(path.sep).includes('assets')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  router.use(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const lastSegment = req.path.split('/').pop();
    if (LOOKS_LIKE_FILE.test(lastSegment)) return plainNotFound(res);

    if (!writeHead) return sendTemplate(res);

    try {
      const result = await resolvePage(req.path, { siteUrl, loaders });
      if (result.redirect) return res.redirect(301, `${result.redirect}${queryOf(req.originalUrl)}`);

      const { locale } = splitLocale(req.path);
      let html = injectRootContent(injectHead(template, renderHead(result.page, siteUrl, locale)), result.page.bodyHtml);
      if (locale === 'ar') html = html.replace('<html lang="fr">', () => `<html lang="ar" dir="${dirOf('ar')}">`);
      res.status(result.status).set('Cache-Control', NO_CACHE);
      if (result.page.meta.robots) res.set('X-Robots-Tag', result.page.meta.robots);
      return res.type('text/html; charset=utf-8').send(html);
    } catch (err) {
      // A database problem must not take the storefront down: shoppers still get the app, without page-specific tags.
      log.error('[seo] page head failed:', String(err?.message ?? err).split('\n')[0].slice(0, 160));
      return sendTemplate(res);
    }
  });

  return router;
}
