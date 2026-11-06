import { Router } from 'express';
import authRoutes from './auth.routes.js';
import adminRoutes from './admin.routes.js';
import productsRoutes from './products.routes.js';
import ordersRoutes from './orders.routes.js';
import reviewsRoutes from './reviews.routes.js';
import galleryRoutes from './gallery.routes.js';
import themeRoutes from './theme.routes.js';
import cartRoutes from './cart.routes.js';
import favouritesRoutes from './favourites.routes.js';
import contactRoutes from './contact.routes.js';
import notificationsRoutes from './notifications.routes.js';
import governoratesRoutes from './governorates.routes.js';
import storefrontRoutes from './storefront.routes.js';
import publishRoutes from './publish.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/gallery', galleryRoutes);
router.use('/theme', themeRoutes);
router.use('/cart', cartRoutes);
router.use('/favourites', favouritesRoutes);
router.use('/contact', contactRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/governorates', governoratesRoutes);
router.use('/storefront', storefrontRoutes);
router.use('/publish', publishRoutes);

export default router;
