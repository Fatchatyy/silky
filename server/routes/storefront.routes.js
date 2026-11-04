import { Router } from 'express';
import * as storefrontController from '../controllers/storefront.controller.js';

const router = Router();

// Public, read-only, no authentication: the data of the storefront's server-rendered pages.
router.get('/home', storefrontController.home);
router.get('/collections/:slug', storefrontController.collection);
router.get('/settings', storefrontController.settings);
router.get('/sitemap-entries', storefrontController.sitemapEntries);

export default router;
