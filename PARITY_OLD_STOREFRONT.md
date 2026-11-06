# Parity: old storefront (`src/`) -> Astro storefront (`storefront/`)

Every file of the old Vite app under `src/`, what it did, and where it lives now. Status:
**moved** (same behaviour, new place), **rebuilt** (same result, different mechanism), **admin -> Phase 3**
(copied into `storefront/src/admin-app/` in Phase 3 step 1; the old file was deleted with the old app in step 2), **not needed** (with the reason).
Written at the end of the Phase 2 follow-up; updated at the end of Phase 3 step 1 (admin rows). **Phase 3 step 2 deleted the old Vite app (`src/`): the old paths in this file are historical, recoverable from git history.**

## Pages (`src/pages/*.jsx`, customer side)

| Old file | What it did | Now |
|---|---|---|
| `Home.jsx` | Hero, sections per collection, reviews block | `storefront/src/views/HomeView.astro` + islands `Hero.jsx`, `Carousel.jsx`, `ReviewsBlock.jsx`; admin sees hidden products through `admin/enhance.jsx` |
| `Collection.jsx` | Product grid of a collection, intro text | `views/CollectionView.astro` (+ `ProductCard.astro`); admin sees hidden products (marked sections) |
| `Product.jsx` | Product page for visitors **and** the inline admin editor (name, texts, colours, sizes, price, photos, videos, hide/show, delete) | Visitor view: `views/ProductView.astro` + island `components/ProductMain.jsx`, `ProductVideos.jsx`, `ProductReviewsSection.jsx`. Admin editor: `admin/ProductPageAdmin.jsx` (generated from the old file), loaded lazily by `ProductMain` only for a valid admin token |
| `SearchResults.jsx` | `/search?q=` results | `screens/SearchResults.jsx` + island `SearchPage.jsx` (`pages/search.astro`); admin sees hidden products |
| `Cart.jsx`, `Checkout.jsx`, `OrderConfirmation.jsx` | Cart, checkout, confirmation | `screens/*.jsx` + islands `CartPage`, `CheckoutPage`, `OrderConfirmationPage` |
| `Favorites.jsx` | Favourites | `screens/Favorites.jsx` + island `FavoritesPage` |
| `Account.jsx` | Customer account, orders, profile | `screens/Account.jsx` + island `AccountPage` |
| `Login.jsx`, `Signup.jsx`, `PasswordReset.jsx` | Auth pages | `screens/*.jsx` + islands (`/register` is an alias of `/signup`, as before) |
| `LeaveReview.jsx` | Review form reached from an e-mail link | `screens/LeaveReview.jsx` + island `LeaveReviewPage` |
| `Contact.jsx` | Contact form | `screens/Contact.jsx` + island `ContactPage` |
| `About.jsx`, `FAQ.jsx`, `DeliveryReturns.jsx`, `CustomerService.jsx` | Text pages | `views/TextPage.astro` + `RichParts.astro` (`shared/textPages.js` holds the text); server-rendered, cached |
| `NotFound.jsx` | 404 | `pages/404.astro`, `views/NotFoundView.astro` (a real 404 status; also the entry point of the admin's hidden-product page) |

## Pages (`src/pages/admin/`) and admin components (`src/components/admin/`)

All 21 files: **admin -> `storefront/src/admin-app/` (Phase 3 step 1: pages in `pages/`, components in `components/`)**. `AdminAnalytics`, `AdminClaims`, `AdminDashboard`, `AdminDraftModal`, `AdminDrafts`,
`AdminExchangeModal`, `AdminInventory`, `AdminLogin`, `AdminManualOrderModal`, `AdminMessages`, `AdminOrders`,
`AdminProducts`, `AdminReviews`; `AdminAnalyticsCharts`, `AdminOrderCard`, `ClaimsBlock`, `NotificationAllPanel`,
`NotificationBell`, `NotificationPanel`, `NotificationPopup`, `gx.jsx`. They were copied unchanged except for imports, the router basename and `mediaUrl` on uploaded files.
The hero editor (`components/hero/Hero{ButtonEditor,EditorModal,ImageSlot,TemplateSelector}.jsx`) is used only by
`AdminDashboard`: **-> `admin-app/components/hero/`**. `hooks/useNotifications.js` is only used by the admin: **-> `admin-app/hooks/`**. `data/defaultProducts.js` and `data/userRoutes.js` are
imported by nothing anywhere (dead code): **not copied**.

## Components

| Old file | What it did | Now |
|---|---|---|
| `AdminProductReviewsSection.jsx` | Review moderation under the reviews, admin only | `storefront/src/admin/AdminProductReviewsSection.jsx`, lazy, rendered by `ProductReviewsSection` for an admin. **One copy, shared with the admin panel** (Phase 3 step 1) |
| `BuyNowModal.jsx` | "Commander" quick-order modal | `components/BuyNowModal.jsx` |
| `CollectionSection.jsx` | A collection block on the home page | `views/HomeView.astro` (server) + `islands/Carousel.jsx` |
| `CustomerRoute.jsx`, `GuestRoute.jsx` | Route guards (admin is sent to `/admin`) | `components/CustomerRoute.jsx`, `GuestRoute.jsx`; the admin redirect had been dropped and is restored (it goes to `PUBLIC_ADMIN_URL`) |
| `InfiniteMarquee.jsx` | Scrolling announcement text | `components/InfiniteMarquee.jsx` |
| `ProductBadges.jsx` | Promo / sold out / "Masqué" (admin) badges | `components/ProductBadges.jsx` + `ProductBadgesView.astro` (server) |
| `ProductCard.jsx` | Product tile | `components/ProductCard.astro` (server lists) and `ProductCard.jsx` (islands) |
| `ProductCarousel.jsx` | Product carousel | `components/ProductCarousel.jsx`; wrapped by `islands/Carousel.jsx` (admin sees hidden products there; the old carousel always filtered them out, see note below) |
| `ProductPrice.jsx` | Price with discount | `components/ProductPrice.jsx` + `ProductPriceView.astro` |
| `ProductReviewsSection.jsx` | Reviews list and form on the product page | `components/ProductReviewsSection.jsx` + island `ProductReviews.jsx` |
| `ReviewLoginPrompt.jsx`, `ReviewsSection.jsx` | Review login prompt, home reviews | same names in `components/` |
| `RichText.jsx` | Text-page rich text | `components/RichText.jsx` (+ `views/RichParts.astro` for the server) |
| `SeoManager.jsx` | Browser-side head updates | **not needed**: every head tag is written by the server in `components/seo/Seo.astro` |
| `ShareModal.jsx` | Share dialog | `components/ShareModal.jsx` |
| `hero/HeroRenderer.jsx` | Draws the home hero | `components/hero/HeroRenderer.jsx` + island `Hero.jsx` |
| `layout/AnnouncementBar.jsx` | Top bar from the theme | `components/layout/AnnouncementBar.jsx` |
| `layout/Footer.jsx` | Footer | `components/layout/Footer.astro` |
| `layout/Header.jsx` | Header, search, cart count, account link | `components/layout/Header.astro` + islands `HeaderAccount`, `HeaderCart`, `HeaderSearch`. The admin's account link goes to the admin panel again (it had been sending admins to `/account`) |
| `layout/Layout.jsx` | Page frame | `layouts/BaseLayout.astro` |
| `layout/ScrollToTop.jsx` | Scrolled to the top on each route change | **not needed**: every page change is a real navigation, the browser handles it |

## Context, hooks, i18n, api

| Old file | Now |
|---|---|
| `context/AuthContext.jsx` | `stores/auth.ts` + `stores/session.ts` (same localStorage keys) |
| `context/CartContext.jsx` | `stores/cart.ts` |
| `context/FavoritesContext.jsx` | `stores/favorites.ts` |
| `context/ProductsContext.jsx` | `stores/products.ts` (admin gets the `includeHidden` list) |
| `context/ThemeContext.jsx` | `lib/theme.ts` (colours and announcement bar fetched by the server, written as CSS variables in the head) |
| `i18n/LocaleContext.jsx`, `i18n/useT.js` | `i18n/LocaleContext.jsx`, `i18n/useT.js` (+ `lib/i18n.ts` for `.astro` files); messages in `shared/messages.js` |
| `i18n/router.jsx` | `lib/router.jsx` (plain `<a>`, full navigation) |
| `api/client.js` | `lib/apiClient.ts` (customer calls) and `admin/adminApi.ts` (every admin call, used by the shop's admin tools and by the panel: the old `client.js` admin part merged with it) |
| `hooks/useNotifications.js` | `admin-app/hooks/useNotifications.js` |
| `main.jsx`, `App.jsx` | **not needed**: routing is the file tree of `storefront/src/pages` (French + `/ar`); admin routes: `admin-app/AdminApp.jsx` (React Router, `basename="/admin"`) |

## Utils and data

| Old file | Now |
|---|---|
| `utils/ratings.js` | `storefront/src/utils/ratings.js` |
| `utils/orderPdf.js`, `utils/orderSearch.js` | `admin-app/utils/` |
| `data/defaultProducts.js`, `data/userRoutes.js` | not copied: nothing imports them |
| `price`, `stock`, `formatPrice`, `colors`, `productText`, `delivery`, `contact`, `urls`, `locales`, `messages`, `textPages` (moved earlier from `src/`) | `shared/` (used by the API, the old app and the storefront) |

## SEO (`src/seo/*`)

| Old file | Now |
|---|---|
| `applyHead.js`, `useSeo.js` | **not needed**: head is server-rendered; no browser-side head updates |
| `arabic.js`, `routes.js`, `collections.js` | `lib/seo/routeText.ts` (fixed-page and collection text, French and Arabic) |
| `escape.js` | `lib/seo/text.ts` (`safeJson` escapes `<`) |
| `jsonld.js` | `lib/seo/jsonld.ts` |
| `meta.js` | `lib/seo/builders.ts` |
| (server `server/seo/*`) | **not needed** by the storefront; stays with the old app until it is removed |

## Styles (`src/styles/*.css`)

`about, account, auth, base, buyNowModal, cart, checkout, contact, home, legal, price, product, product-reviews, pwreset,
reboot, review-login-prompt, reviews-page, reviews, rtl, shareModal` -> one file, `storefront/src/styles/shop.css`
(same order as the old app evaluated them). `admin.css`, `product-admin.css` -> `storefront/public/admin/` (two plain files:
the admin panel links them unlayered after the shop stylesheet; the shop pages load `public/admin/styles.css`, which imports
`admin.css` into `@layer admin`); `hero-editor.css` -> `storefront/src/admin-app/styles/hero-editor.css`.

## What was found missing and fixed in this pass
1. Admin account link in the header, admin redirect from `/account`, `/login`, `/signup` (route guards): restored.

## Notes
- The old home/collection **carousel** always filtered hidden products, even for an admin. The Astro carousel shows them
  to an admin (with the "Masqué" badge), as requested for the home carousel.
- Public assets in `public/pictures` were copied unchanged.
