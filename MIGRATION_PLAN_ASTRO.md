# Silky: migration to Astro + Cloudflare + Render + Neon + R2

Implementation plan for the engineer (Sonnet) who will carry it out. Read all of it before starting.
Each step says **what** to do, **how** to do it well (hints), and **done when** (how to prove it works).

**Order of work:** Phases 1 to 3 are done and tested **entirely on the local machine** (no cloud account needed): the owner sees and tests the new Astro storefront and the admin locally first. Phases 4 to 7 move things to the cloud. Nothing customers see changes before Phase 7.

---

## 0. Read first

### 0.1 What exists today
- One repo, one Node process: Express API in `server/` (routes -> controllers -> services -> repositories -> `server/models`, Drizzle + `pg`) and a React + Vite app in `src/` that holds BOTH the storefront and the admin panel (`/admin`, `/admin/login`). Locally the API listens on `http://localhost:3001` and the Vite dev server proxies `/api` to it (`vite.config.js`).
- `CLAUDE.md` at the repo root documents every business rule (orders, GOODEX delivery, stock, variants, auth, uploads). Read it fully. Nothing in this migration may change order, stock, delivery or auth behaviour.
- The storefront is French (no prefix) and Arabic (`/ar/...`, right-to-left). Product URLs are `/product/<slug>`.
- Images are stored on disk in `server/uploads/` and referenced in the database as relative paths like `/uploads/1786391497273-243dfd2a-r.jpg`. Files whose name ends with `-r` have three pre-made WebP copies next to them: `.card.webp` (600 px), `.share.webp` (1200 px), `.large.webp` (2400 px) (`server/utils/imageVariants.js`, `src/utils/imageVariants.js`).

### 0.2 Corrections to the original plan (already decided, do not reopen)
| Original plan said | Do this instead | Why |
|---|---|---|
| API "unchanged" | The API changes in a few precise places (Phases 1 and 4). | The storefront needs a few read endpoints, images move to R2, the API stops serving pages, CORS/cookies must work across `silky.tn` and `api.silky.tn`. |
| Cloudflare Pages | **Cloudflare Workers with static assets** (same free account, same idea). | Cloudflare's current Astro guide and the `@astrojs/cloudflare` adapter target Workers; Pages is the older path. |
| "FAQs and buying guides" | Rebuild the existing FAQ. **Do not write buying guides.** | Content must come from the owner; never invent shop facts. |
| Admin panel not mentioned | The admin moves into the Astro project as one route, `/admin/[...path]`, rendering the current admin React app as a single `client:only="react"` island (Phase 3). It is served at `https://silky.tn/admin`; there is no `admin.silky.tn` and no separate admin deployment. | It lives in the same Vite app today. One project, one deployment, one origin (no cross-origin admin, so `CORS_ALLOWED_ORIGINS` only needs `https://silky.tn`). The admin screens are not rewritten. |
| Order: DB, API, Astro, images, domain | Local first (API endpoints, Astro, admin), then cloud (R2, Neon, Render, cut-over). Images go to R2 **before** the API is deployed on Render. | The owner tests the new storefront before any cloud work. Render's disk is wiped on every restart, so uploads written there would be lost. |

### 0.3 Owner decisions (final)
1. **Region: Frankfurt for everything.** The shop serves Tunisia only. Frankfurt is the closest region both providers offer: Render `frankfurt`, Neon `AWS Europe Central 1 (Frankfurt)`. API and database in the same city keeps every query fast. Cloudflare (storefront, images) is global and needs no region.
2. **Render: free plan for now** (paid plan later, once there are real orders). A free instance sleeps after 15 minutes without requests and takes about a minute to wake up. What that breaks, and what to do about it:
   - GOODEX webhooks must be answered in under 3 seconds (3 attempts) and the GOODEX reconciler does not run while asleep; a crawler or visitor arriving after a quiet period waits for the wake-up.
   - **Mitigation (build it in Phase 6):** keep the API awake with a ping every 10 minutes from a Cloudflare Worker **Cron Trigger** (free) to a new `GET /ping` route that answers `{ ok: true }` **without touching the database** (not `/health`, which queries Postgres and would keep Neon awake 24/7 and burn its free compute hours). Before relying on it, check Render's current free-plan instance-hours allowance in its docs: one service running all month must fit in it, and Silky must be the only free service on that Render account. Record the result in `DEPLOYMENT.md`.
   - The page cache of 2.8 (`stale-while-revalidate`) also means visitors and crawlers usually get a cached page instead of waiting on the API.
   - Write the free-plan limits and "move to the paid plan when real orders start" in `PRE_PRODUCTION.md`.
   - Free plans change: check the current Render and Neon free limits (instance hours, Neon compute hours and storage) at the start of Phase 4, and stop and tell the owner if Silky would not fit.

### 0.4 Ground rules
- Work on a new branch `astro-migration`. Commit at the end of each phase, staging files **by explicit path** (the tree may contain unrelated changes). Never force-push, never rewrite history.
- Stop at the end of every phase and report to the owner (what changed, what was run to verify it and its real output, what is not done). Start the next phase only after the owner says so.
- Never write to the dev database `silky` and never change `server/uploads/` (the copy script of Phase 4 only READS it). Local manual testing goes through the API the way the owner runs it; automated tests run on `silky_test` (see `CLAUDE.md`, "Tests").
- No test framework: tests are standalone scripts `node server/scripts/test_*.js` that exit non-zero on failure. Follow that style; for the storefront add scripts under `storefront/scripts/`.
- Every new environment variable goes in `.env.example` (API) or `storefront/.env.example` (storefront), with a one-line comment.
- Keep the visible design identical: same CSS, same markup structure, same class names. This is a technology migration, not a redesign.
- When a step says "verify", do it for real (run the script, open the page, read the response) and write down the result in the phase's commit message.

---

## Target architecture

```
                 visitors / Googlebot / AI crawlers
                               |
                     Cloudflare (DNS, CDN, SSL)
        +----------------------------------+-----------------------+
        |                                  |                       |
   silky.tn                          media.silky.tn          api.silky.tn
   Astro on Workers                  R2 bucket (images)      -> Render (Express API)
   (server-rendered storefront       public, cached                  |
    + the admin at /admin,                                           |
    one client:only island)                                          |
        |                                                            |
        +--- fetches catalog data from api.silky.tn (server side) --+
                                                                     |
                                                          Neon Postgres (Frankfurt)
```
Locally: storefront **and admin** `http://localhost:4321` (Astro dev; the admin is `http://localhost:4321/admin`), API and images `http://localhost:3001`, local Postgres. Ports used only for testing: `4399` (`wrangler dev` of the storefront test scripts), `3101` (a throw-away API on `silky_test` for browser tests). The old Vite dev server `http://localhost:5173` still runs after Phase 3 step 1 (`npm run dev` starts it as `old`); it is removed in Phase 3 step 2, when the Vite app and its `dev:client` script are deleted.

Principles:
- **The API stays the only thing that talks to the database.** Astro never connects to Postgres; it calls the API. One place for business rules.
- **Public pages are complete HTML from the server.** Product name, price, description, images, sizes, breadcrumbs, JSON-LD: all in the first response. JavaScript only adds interactivity.
- **The admin is part of the same Astro project and the same origin, but it is not a page of the shop.** `/admin` and everything under it is `noindex`, absent from the sitemap, `Disallow`ed in `robots.txt`, and never stored by the page cache. Visitors never download admin code (admin tools on the shop pages are loaded lazily, only when the browser holds a valid admin token).
- **Image URLs in the database do not change.** They stay `/uploads/<file>`. Front ends turn them into a full URL with one helper (`http://localhost:3001/uploads/<file>` locally, `https://media.silky.tn/uploads/<file>` in production). No data migration of URLs.

### Repo layout after the migration
```
server/        Express API (existing)
storefront/    NEW Astro project (own package.json)
shared/        NEW pure modules used by the API and the front end (no React, no DOM, no Node APIs)
src/           existing Vite app: still the live site until Phase 7, then (Phase 3) its admin code moves into
               storefront/src/admin-app/ and src/ and the Vite config are deleted
```
After Phase 3 the only front-end project is `storefront/` (storefront pages + the `/admin` route).
Hint: `shared/` holds data and pure functions only (texts, translations, formatting, URL helpers). If a file imports React or touches `window`, it does not belong there.

---

## Phase 1: API endpoints for the storefront (local)

**1.1 Public endpoint for product pages.** Add `GET /api/products/by-slug/:slug` (public, `optionalAuthMiddleware` like `GET /:id`). Same response shape as `GET /api/products/:id`. Hidden products answer 404 to non-admins (same rule as today). Unknown slug -> 404 `{ error }`. Add it to the router **before** `/:id`.
- Hint: reuse the repository's `findById` logic through a `findBySlug`; do not write a second product serializer.

**1.2 Data the storefront needs that today only the old SEO layer reads.** List what `server/seo/loaders.js` reads (published product summaries per category, delivery fee from `site_settings`, collections) and expose what is missing through small public read endpoints, e.g. `GET /api/storefront/collections/:slug` and `GET /api/storefront/sitemap-entries` (slug, updatedAt, hasArabic). Return only public fields.
- Hint: one endpoint per page type is fine. Keep queries bounded (limit), and never return hidden products.

**1.3 Cross-origin setup.**
- `CORS_ALLOWED_ORIGINS`: locally `http://localhost:4321` (storefront and admin share this origin after Phase 3; `http://localhost:5173` is only needed while the old Vite app still runs); in production (Phase 6) only `https://silky.tn`.
- In `server/app.js` `cors({...})`, add `exposedHeaders: ['X-Guest-Session-ID']`. Today the client reads that header (`src/api/client.js`); cross-origin, the browser hides it unless exposed.
- Guest cookie (`server/middleware/guestSession.js`): `silky.tn` and `api.silky.tn` are the same site (and so are two `localhost` ports), so `sameSite: 'lax'` keeps working. Leave the cookie host-only.

**1.4 Image URL helper** in `shared/media.js`: `mediaUrl('/uploads/x.jpg') -> MEDIA_BASE + '/uploads/x.jpg'`; leaves absolute URLs and `/pictures/...` (files shipped with the site) unchanged. Move the existing `imageVariantPath` logic (`src/utils/imageVariants.js`) to `shared/` next to it. Locally `MEDIA_BASE` is the API (`http://localhost:3001`), which already serves `/uploads`.

**1.5 The old site keeps working.** Do not remove anything from `server/seo/` or the frontend serving in `server/app.js` yet; that happens in Phase 3 step 2, together with the old frontend (owner decision: Astro is the only owner of SEO/GEO output, the API serves no page). `server/middleware/securityHeaders.js` keeps applying to API responses; the page Content-Security-Policy is rebuilt in the storefront (2.11).

**Done when:** the new endpoints have tests in the existing style (`server/scripts/test_storefront_endpoints.js` on `silky_test`): 200 for a published product, 404 for hidden/unknown, no private fields; a cross-origin request from an allowed origin gets `Access-Control-Expose-Headers: X-Guest-Session-ID`. Existing tests that passed before still pass.

---

## Phase 2: The Astro storefront (local)

This is the main phase. **The storefront must not import anything from `src/seo/`, `server/seo/`, `SeoManager`, `useSeo` or `applyHead`.** All SEO and GEO output is produced by Astro itself (2.5 to 2.10). The old implementation may be read as a **specification** of required behaviour (the list in 2.12 comes from it), never imported.

### 2.1 Project setup
- `npm create astro@latest storefront` (empty template, TypeScript "strict"). Add `@astrojs/react`, `@astrojs/cloudflare`, `nanostores`, `@nanostores/react`, `@nanostores/persistent`.
- `astro.config.mjs`:
  ```js
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
  site: 'https://silky.tn',
  trailingSlash: 'never',
  build: { format: 'file' },
  i18n: { locales: ['fr', 'ar'], defaultLocale: 'fr', routing: { prefixDefaultLocale: false } },
  ```
- Allow importing `../shared` (Vite `server.fs.allow: ['..']`).
- Env (`storefront/.env.example`): `API_URL` (server side; locally `http://localhost:3001`), `PUBLIC_API_URL` (browser side, same value), `PUBLIC_MEDIA_URL` (locally `http://localhost:3001`), `PUBLIC_SITE_URL` (locally `http://localhost:4321`). Hint: only variables prefixed `PUBLIC_` reach the browser; never put a secret in one.
- Add `"dev:storefront"` to the root `package.json` scripts (runs `astro dev` in `storefront/`) so the owner can start API + storefront + admin with the commands they already know. Write the exact local start-up steps in `storefront/README.md`.
- Hint: `astro dev` runs on Node, but production runs on Cloudflare Workers, which lacks most Node APIs (`fs`, `path`, `Buffer` helpers...). Before declaring the phase done, also run `astro build` and `npx wrangler dev` and click through the site there; that catches Workers-incompatible code early.
- Hint: Astro's built-in `<Image>` optimizer needs sharp, which does not run on Cloudflare Workers. Use plain `<img>` with our pre-made WebP copies (2.7).

### 2.2 Move shared code to `shared/`
Move (and update the existing app's imports): `src/i18n/messages.js`, `src/i18n/locales.js`, `src/i18n/colors.js`, `src/i18n/productText.js`, `src/content/textPages.js`, `src/config/contact.js`, `src/config/delivery.js`, `src/utils/formatPrice.js`, `src/utils/price.js`, the governorate list, and the pure URL builder for product paths. Check each file has no React/DOM import first; split a file if it mixes both.
- Hint: move with `git mv` so history follows. Run the existing pure tests afterwards (`test_i18n_messages.js` etc.) and fix their import paths. The old Vite storefront must still build and run after the move (it stays the live site until Phase 7).

### 2.3 Layout and design
- `src/layouts/BaseLayout.astro`: `<html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>`, `<Seo {...seo} />` in `<head>`, header, `<slot />`, footer.
- Import the existing CSS in the same order as `src/main.jsx` today (`reboot.css` first, `rtl.css` last). Load the Cairo font only on Arabic pages (`<link rel="preconnect">` + stylesheet), as today.
- Rebuild header and footer as **Astro components** (static HTML). Only the interactive parts become islands: cart badge + dropdown, search box, language switcher if it needs JS, mobile menu toggle.
- Hint: copy the JSX markup and class names exactly; Astro syntax is close to JSX (`class` instead of `className`). Same HTML + same CSS = same look.

### 2.4 Routing (French + Arabic without duplicating logic)
Put each page's logic in a component and keep route files thin:
```
src/pages/index.astro                 -> <HomePage locale="fr" />
src/pages/ar/index.astro              -> <HomePage locale="ar" />
src/pages/product/[slug].astro        -> <ProductPage locale="fr" slug={...} />
src/pages/ar/product/[slug].astro     -> <ProductPage locale="ar" slug={...} />
src/pages/collection/[category].astro, faq, livraison-retours, service-client, about, contact, search, cart, checkout,
order-confirmation, leave-review, login, signup, register, password-reset, password-reset/[token], favorites, account
+ the same under src/pages/ar/
src/pages/404.astro (+ Arabic variant chosen by path)
```
- Text pages (faq, livraison-retours, service-client, about) have no live data: `export const prerender = true;` so they are plain files on the CDN.
- Product, collection and home pages are server-rendered on each request (with caching, 2.8).
- Cart, checkout, account, login, signup, password reset, favorites, order confirmation: thin server shell + one `client:only="react"` island (they depend on the logged-in user and localStorage) and `noindex` (2.6).
- Hint: a data fetch failure must never produce a page that looks fine but is empty. Product not found -> real 404 status; API down -> 503 status with a short message (search engines retry 503, they drop 404).

### 2.5 SEO component (the single place that writes the head)
`src/components/seo/Seo.astro` receives one object and writes everything:
```ts
type SeoProps = {
  title: string; description: string;
  canonical: string;            // absolute, https://silky.tn/...
  alternates?: { fr?: string; ar?: string; 'x-default'?: string };
  robots?: 'index,follow' | 'noindex,follow' | 'noindex,nofollow';
  og: { type: 'website' | 'product'; image?: string; locale: 'fr_FR' | 'ar_AR' };
  jsonLd?: object[];
}
```
- Pages build this object with small pure functions in `src/lib/seo/` (`productSeo(product, locale)`, `collectionSeo(...)`, `textPageSeo(...)`), each unit-tested by a script (2.14).
- Absolute URLs are built from `PUBLIC_SITE_URL`, so they are `http://localhost:4321/...` locally and `https://silky.tn/...` in production.
- JSON-LD output: `<script type="application/ld+json" set:html={safeJson(data)} />` where `safeJson` is `JSON.stringify(data).replace(/</g, '\\u003c')`. Hint: without that escape, a product description containing `</script>` breaks the page and is an XSS hole.
- Titles and descriptions: unique per page, French and Arabic. Description trimmed to about 155 characters at a word boundary.
- Hint: `Seo.astro` is the only file allowed to write `<title>`, `<meta name="description">`, canonical, hreflang, Open Graph or JSON-LD. Grep for it at the end.

### 2.6 Indexing rules (what is indexable)
- Indexable: home, collections with a known category, product pages, FAQ, delivery/returns, customer service, about, contact.
- `noindex`: search results, cart, checkout, order confirmation, account, login, signup, password reset, favorites, leave-review, 404.
- Arabic product page: indexable **only if** the product has both an Arabic name and an Arabic description; otherwise `noindex` and no hreflang pointing to it. Same idea for Arabic collections without an Arabic title.
- hreflang (`fr`, `ar`, `x-default` = French) only between pages that are both indexable, both directions.
- Hidden products: 404 (the API already refuses them).

### 2.7 Product page (the most important page)
- Server side: `GET {API_URL}/api/products/by-slug/:slug` with a timeout (`AbortSignal.timeout(5000)`).
- If the URL holds a product **id** instead of a slug, or wrong case, or a trailing slash: one `301` to `/product/<slug>` (`return Astro.redirect(path, 301)`), keeping the `/ar` prefix. Look the id up through the existing `GET /api/products/:id`.
- HTML from the server: breadcrumb, h1 product name, price (with discount), description, all images, colours and sizes (sizes in `position` order as the API returns them), stock state, reviews summary.
- Images: `<img src={large} srcset="{card} 600w, {large} 2400w" sizes="(max-width: 768px) 100vw, 50vw" width height alt>` using `mediaUrl` + variant helper. Main image `fetchpriority="high"`, no lazy; the others `loading="lazy" decoding="async"`. Alt text = product name, colour, "photo n sur m" (as `productImageAlt` does today).
- Islands: colour/size picker + add-to-cart + buy-now as ONE island `client:load` receiving only the fields it needs (id, slug, variants with stock, prices). Reviews list `client:visible`. Hint: island props are serialized into the HTML; pass small objects, not the whole product.
- JSON-LD: `Product` with `name`, `description`, `image` (share copies), `sku`/`productID`, `brand` Silky, `offers` (`Offer`, price as number, `priceCurrency: 'TND'`, `availability` InStock/OutOfStock from variant stock, `url` canonical, `shippingDetails` with the delivery fee and destination TN, 1-2 days transit), `aggregateRating` only when there are reviews. Plus `BreadcrumbList`. Do not add a return policy (facts not confirmed).

### 2.8 Caching of server-rendered pages
- Product, collection and home responses for visitors: `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=86400`.
- Cloudflare does not cache Worker responses by itself. Implement it in `src/middleware.ts` with the Workers Cache API (`caches.default`): only `GET`, only those page types, only when the request has no auth cookie/header; store the rendered response, serve it on the next hit; add an `x-silky-cache: HIT|MISS` header to verify.
- Hint: `caches.default` does not exist under `astro dev` (Node). Guard it (`typeof caches !== 'undefined' && caches.default`) and test the cache under `wrangler dev`.
- Hint: 5 minutes means a price change shows within 5 minutes. Tell the owner. Never cache a 404 or 5xx.

### 2.9 robots.txt and sitemap (Astro endpoints, not static files)
- `src/pages/robots.txt.ts`: allow everything public; `Disallow` cart, checkout, account, login, signup, password-reset, favorites, search; `Sitemap: <site>/sitemap.xml`. **All AI crawlers are allowed** (owner decision), training and search alike: one `User-agent: *` group is enough; do not add per-bot `Disallow` groups for `GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot` etc. The old `server/seo/robots.js` blocks training bots: that policy is NOT carried over.
- `src/pages/sitemap.xml.ts`: built per request from `GET /api/storefront/sitemap-entries`: fixed indexable pages, collections, products, each with `<lastmod>` and `<xhtml:link rel="alternate" hreflang>`; Arabic URLs only when indexable (2.6). Cache it like 2.8. Do NOT use `@astrojs/sitemap` (it only knows pages that exist at build time, not products in the database).
- Hint: XML-escape every URL (`&` -> `&amp;`).

### 2.10 GEO (being quoted by AI assistants)
AI crawlers do not run JavaScript, so everything below must be in the server HTML (check with JS disabled):
- Clear factual text on product pages: what it is, material/composition if the owner gave it, sizes, price in TND, delivery fee and delay, exchange/refund conditions (from the existing FAQ/delivery text, unchanged wording).
- `Organization` JSON-LD on the home page (name, logo, phone, email, social links from `shared/contact.js`; no address, the owner asked to hide company info). `FAQPage` JSON-LD on `/faq` and `/ar/faq` built from the same entries as the visible FAQ.
- Collection and home pages list product names, prices and links as real `<a href>` in the HTML (not only in an island).
- Semantic HTML: one `h1` per page, `h2` for sections, `<nav>` with breadcrumbs, `<main>`, real links rather than click handlers.

### 2.11 Security headers for pages
In `src/middleware.ts` set what `server/middleware/securityHeaders.js` sets today for pages (`X-Content-Type-Options`, `Referrer-Policy`, frame protection, `Permissions-Policy`, `Strict-Transport-Security` in production only) and the Content-Security-Policy in **report-only** mode first. Allow the API and media origins (from env), Google Fonts (Arabic) and nothing else. Astro adds inline hydration scripts: use Astro's built-in CSP support if the installed version has it (it hashes those scripts); otherwise keep report-only and note it in `PRE_PRODUCTION.md`.

### 2.12 Behaviour that must be preserved (checklist, taken from the old implementation)
- [ ] `/product/<slug>`; id/uppercase/trailing-slash variants 301 to it once; `/ar` keeps its prefix.
- [ ] `/index.html` -> 301 `/`. (`www.silky.tn` -> `silky.tn` is a Cloudflare redirect rule, Phase 7.)
- [ ] Unknown pages and unknown collections answer a real 404 status with the 404 page. `/ar/admin` is 404.
- [ ] Hidden products are 404 for visitors.
- [ ] Arabic pages: `lang="ar" dir="rtl"`, Cairo font, `og:locale ar_AR`, Arabic titles/descriptions, Arabic product name/description when present, French fallback otherwise + noindex rule (2.6).
- [ ] Colour names in Arabic: product's own Arabic colour name, then the built-in list (`shared/colors.js`), then the name as typed.
- [ ] Prices show "د.ت" in Arabic; governorate labels Arabic in forms but the saved value stays the Latin canonical name.
- [ ] Every page has exactly one canonical, unique title and description.
- [ ] Review forms only for logged-in customers (login prompt for guests).
- [ ] Contact form open to guests.
- [ ] A full order works from the new storefront (guest and logged in, cart and buy-now) and appears in the admin exactly like an order from the old site.

### 2.13 Client-side state (islands)
- React Context does not cross islands (each island is a separate React tree). Replace `CartContext`, `FavoritesContext` and `AuthContext` with **nanostores** in `src/stores/` (`cart.ts`, `favorites.ts`, `auth.ts`) using `persistentAtom` for what lives in localStorage today (same keys as `src/api/client.js`, so existing customers keep their cart and login). Islands read them with `useStore()`.
- One browser API client `src/lib/apiClient.ts` (port of `src/api/client.js`): base `PUBLIC_API_URL`, `credentials: 'include'`, sends `Authorization` and `X-Guest-Session-ID`, stores the returned guest id, same 401 handling. One server-side fetch helper `src/lib/serverApi.ts` (no localStorage, timeout, typed errors).
- Hint: reuse the existing React components for cart, checkout, account, login, etc. as islands; change only how they get state and how they navigate (`window.location` / `<a href>` instead of React Router). Remove `react-router-dom` from them; keep the markup.

### 2.14 Tests for the storefront
Scripts in `storefront/scripts/`, run with `node`, exit non-zero on failure:
- `test_seo_builders.mjs`: pure tests of `src/lib/seo/*` (titles, descriptions, JSON-LD shape, escaping, hreflang rules, noindex rules).
- `test_rendered_pages.mjs`: build, run `wrangler dev` against the API on `silky_test`, fetch pages with plain `fetch` (= a crawler without JavaScript) and assert: status codes (200/301/404), one `<title>`, canonical, hreflang, JSON-LD parses as JSON, product name/price/description are in the HTML, robots.txt and sitemap.xml content.
- Crawl every URL from the local sitemap and check there are no 404/500 and no page without a title.

**Done when:** all checklist items in 2.12 are ticked with evidence, tests pass, and side-by-side screenshots of home, a collection, a product, cart and checkout in French and Arabic (desktop and phone width) of the old site and the new one look identical. Give the owner the exact commands to start everything locally so they can test it themselves.

---

## Phase 3: The admin panel inside the Astro project (local)

Decision (owner): there is **no separate Vite admin app**. The existing admin moves into `storefront/` as it is and is served by Astro at `/admin`. Do not rewrite any admin screen.

**Phase 3 is done in two steps, with a stop between them.**
- **Step 1 (built, committed): build, delete nothing.** The admin is added to the Astro project, the shop and the admin share one login and one copy of the shared admin code, and `npm run dev` starts the API, the storefront and (for now) the old app. The old frontend (`src/`, `index.html`, `vite.config.js`, the `dev:client` script, the server code importing from `src/`) is **not touched** and keeps running on port 5173. The owner then tests everything on `http://localhost:4321/admin`.
- **Step 2 (only after the owner writes "ok, delete the old frontend"): removal of the old frontend** (3.4). The engineer first lists exactly what will be deleted or changed (files, scripts, server imports from `src/`) and waits for the owner's confirmation of that list before deleting anything.

### Step 1: build, do not delete anything

**3.1 One route, one island.**
- `storefront/src/pages/admin/[...path].astro` (`prerender = false`) renders a thin shell (`src/layouts/AdminLayout.astro`) and the admin React app as a **single** island: `<AdminApp client:only="react" />`. No server-side rendering of admin content (it needs localStorage and the token).
- The admin code is **copied** (not `git mv`: the old app must keep running until step 2) into `storefront/src/admin-app/`: `pages/` (the 13 admin pages), `components/` (the admin components, and `components/hero/` for `HeroButtonEditor`, `HeroEditorModal`, `HeroImageSlot`, `HeroTemplateSelector`), `hooks/useNotifications.js`, `utils/orderPdf.js`, `utils/orderSearch.js`, `styles/hero-editor.css`, plus `context/` (the admin's `ThemeContext`, `ProductsContext` and `useAuth`) and `AdminApp.jsx`. `data/defaultProducts.js` and `data/userRoutes.js` are imported by nothing anywhere and were not copied. Imports were rewritten (`@shared/...`, the shared admin API); nothing else in the screens changed except what the move forced: links to the shop are plain `<a href>` (a router link would stay inside `/admin`), `navigate('/admin/login')` became `navigate('/login')` (basename), uploaded photos and videos are printed through `mediaUrl`.
- **React Router stays inside the admin**, with `basename="/admin"` (`BrowserRouter`): `/admin` is the dashboard (its tabs are component state), `/admin/login` the password form, any other address under `/admin` shows the dashboard. The Astro catch-all answers the same shell for every path, so a reload on any address works.
- **Shared login.** Admin auth is unchanged (same API, Bearer token). The panel uses the shop's session store (`src/stores/auth.ts`, same `localStorage` keys `silky_auth_token` / `silky_auth_user`, followed across tabs), so signing in at `/admin/login` makes the owner an admin on the shop pages too and signing out in either place signs out of both. `AdminLogin` stays at `/admin/login`.
- Admin API calls use `PUBLIC_API_URL` like the storefront client (the admin origin is the storefront origin, so no admin-specific CORS). Photo and video previews use `mediaUrl`.
- The admin bundle is a separate chunk loaded only on `/admin`; visitor pages contain none of it (the rendered-pages test asserts it).

**3.2 `/admin` is not part of the public site.** Everything under `/admin`:
- `<meta name="robots" content="noindex,nofollow">` (through `Seo.astro`, whose `canonical` is now optional) and an `X-Robots-Tag: noindex, nofollow` response header (`src/middleware.ts`);
- not in `sitemap.xml`, and `Disallow: /admin` in `robots.txt` (`src/lib/seo/sitemap.ts`);
- **never stored by the page cache** (`src/middleware.ts`): `Cache-Control: no-store`, not written to `caches.default`, not served from it, no `x-silky-cache` header;
- the same security headers and report-only CSP as the rest of the site; no canonical or hreflang (the shell is not an SEO page); `/ar/admin` stays a 404;
- the storefront's links to the admin (header account link of an admin, "retour à l'admin" buttons, redirects of admin accounts away from customer pages) point to `/admin`: `ADMIN_URL` is the constant `'/admin'` and `PUBLIC_ADMIN_URL` is gone.

**3.3 One copy of the shared admin code** (`storefront/src/admin/`, used by the panel and by the shop pages):
- `adminApi.ts` is the **only** admin API wrapper: the admin part of the old `src/api/client.js` merged with the calls the shop's inline editor already had, plus the cache purge (`purgeStorefrontCache`, `purgeProductPages`).
- `AdminProductReviewsSection.jsx`: one copy, rendered under the reviews on a product page and in the panel's Products tab (the old `src/components/AdminProductReviewsSection.jsx` stays until step 2 only because the old app still imports it).
- `productForm.js` (new): `slugify`, `mapProductColorsToForm`, `normalizeProduct`, `uploadFile`, which the panel's product form (`admin-app/pages/AdminProducts.jsx`) and the inline editor (`ProductPageAdmin.jsx`) each carried a copy of.
- The lazy-loading rule stays: a visitor's page never contains or downloads admin code, style or content (the rendered-pages test asserts it), and visitor HTML and the page cache are identical for everyone.
- **Every admin action that changes what visitors see calls `POST /internal/purge`**, in the panel and in the inline editor alike: product created / saved / hidden / shown / deleted / category changed, product video added or removed, stock changed, product review moderated (`{ productId }`: the endpoint asks the API which page it is), theme, announcement bar and hero (`{ all: true }`: every cacheable page, French and Arabic, built from the sitemap data, never a hidden product; the Cloudflare zone purge goes in batches of 30 URLs). The Worker's short-lived memory of API data (theme, product list) is 5 seconds, so a purge handled by one Worker instance is not undone by another instance's older copy.
- The admin stylesheet is two plain files in `public/admin/` (`admin.css`, `product-admin.css`, each the old file unchanged). The panel's shell links both **unlayered** after the shop stylesheet (a layered `admin.css` would lose to the shop's `* { margin: 0 }`; measured: 5497 of 7612 elements differed from the old admin before this, 48 after, all of them hover/active states of the sidebar under the mouse pointer). The shop pages load `public/admin/styles.css`, which `@import`s `admin.css` into the low-priority `admin` layer (as it was in Phase 2) and `product-admin.css`.

**3.5 Tests (step 1).** `storefront/scripts/test_rendered_pages.mjs` additionally checks: `/admin`, `/admin/login`, `/admin/orders` and a deep address answer 200 with `noindex` (meta and header), `no-store`, no `x-silky-cache` (two requests), no canonical/hreflang/JSON-LD, the same shell everywhere, the island is client-only; `/admin/` redirects once; `/ar/admin` is a 404; `robots.txt` has `Disallow: /admin`; the sitemap has no `/admin`; visitor pages contain no admin code; the purge by `productId` and the site-wide purge. `test_seo_builders.mjs` covers the purge path builders and the robots rule. `storefront/scripts/serve_admin_session.mjs` (API on `silky_test`, GOODEX stand-in, test products and orders, throw-away admin) is the browser-test helper. In-browser check of every tab of `http://localhost:4321/admin` (see the step 1 report in the commit message).

**Step 1 done when:** every admin tab works from `http://localhost:4321/admin` (login, products with photo and video upload, orders and bulk actions, exchanges and refunds, GOODEX actions on the mock, claims, drafts, messages, reviews, inventory, analytics, theme and hero editor, notifications, PDF export), the shared login works in both directions, the shared code exists once, `npm run dev` starts api + shop + old, and the old app still runs on 5173. **Stop and wait for the owner.**

### Step 2: remove the old Vite app (only on the owner's "ok, delete the old frontend")

**3.4 First list, then delete.** Before touching anything, send the owner the exact list of what will be deleted or changed and wait for a "yes" to that list. It will contain at least:
- Delete `vite.config.js`, `index.html`, `src/` (nothing of the old storefront is needed: `PARITY_OLD_STOREFRONT.md` lists where each file went; the admin files were copied in step 1), the `dev:client` and `preview` scripts, and the client half of `dev` (`npm run dev` then starts `api` and `shop` only, `--names api,shop`). Update `scripts/build.mjs` (it builds the Vite app) so `npm run build` builds the storefront. Remove the Vite-only dependencies (`vite`, `@vitejs/plugin-react`, and the front-end packages nothing in `server/` uses) from the root `package.json`.
- **Remove the old SEO layer from the API in this same step** (moved here from 7.4; owner decision): the `createSeoRouter` mount in `server/app.js` (old `robots.txt`, `sitemap.xml` and page handler, and the frontend static serving), `server/seo/` (with `renderBody.js`), `src/seo/`, their tests (`test_seo_builders.js`, `test_seo_pages.js`, `test_seo_html.js`; before deleting `test_seo_builders.js`, move its assertions on `shared/` modules (`productText`, `locales`, ...) into a new `test_shared_modules.js`), the `SEO_HTML` / `FRONTEND_DIST_DIR` env vars (`server/config/env.js`, `.env.example`) and their preflight / `test_deploy_readiness.js` / `test_compression.js` / `test_security_audit.js` checks. The API root `/` answers `{ ok: true }`. **Done when** `GET /robots.txt` and `GET /sitemap.xml` on the API answer 404, `grep -rn "server/seo|src/seo" server storefront shared` finds nothing, and the whole test list gives the same results as before.
- Delete `ARABIC_ENABLED` from `shared/locales.js` (and make `splitLocale` always read the `/ar` prefix): its only readers are the old Vite app and `server/seo/`; the Astro storefront no longer reads it (decision: Arabic is always on in Astro, a flag would need four separate guards that nothing tests).
- Before deleting `src/`, run `grep -rn "src/" server` and fix what imports from it. Since `server/seo/` goes in the same step, nothing needs to be moved next to it. Tests that import admin files (`test_admin_orders_pdf_selection.js`, `test_admin_orders_table_safeguards.js`, `test_goodex_delivery.js`, `test_operation_specific_payable_amount.js`, `test_seo_builders.js`): update their import paths to `storefront/src/admin-app/`.
- Remove `http://localhost:5173` from `CORS_ALLOWED_ORIGINS` in `.env`, `.env.example`, `storefront/README.md` and the test scripts that set it (`serve_fixtures.mjs`, `test_rendered_pages.mjs`, `test_storefront_endpoints.js`).
- Then delete the leftover copies the old app forced us to keep: none are expected, but `grep` for `AdminProductReviewsSection` and `adminApi` must show exactly one definition each.
- Update `CLAUDE.md` (admin location, ports, scripts, the `src/` references) and `PARITY_OLD_STOREFRONT.md`.
- The live production site (if any) is untouched until Phase 7.

**Step 2 done when:** the Vite app, its config and the `dev:client` script are gone, `grep -rn "src/" server` finds nothing, the old test list gives the same results as before (compare with the known pre-existing failures in `CLAUDE.md`), and every admin tab still works from `http://localhost:4321/admin`.

---

## Phase 4: Images to Cloudflare R2 (API change)

Goal: uploads are written to R2 instead of the local disk, served from `media.silky.tn`, and every existing file is copied there. URLs stored in the database stay `/uploads/<file>`.

**4.1 Create the bucket** `silky-media`, connect the custom domain `media.silky.tn` to it (R2 > bucket > Settings > Custom domains; needs the domain on Cloudflare, see 7.1: until then use the bucket's `r2.dev` public URL for testing). Create an R2 API token limited to that bucket (Object Read & Write).

**4.2 Add a storage module** `server/services/storage.service.js` with one small interface:
```js
putObject(key, buffer, contentType)   // key like 'uploads/123-abc-r.jpg'
deleteObject(key)
objectExists(key)
```
and two implementations chosen by env `STORAGE_DRIVER=disk|r2`:
- `disk`: writes to `env.uploadsDir` exactly like today (keeps local dev and all existing tests working, offline).
- `r2`: uses `@aws-sdk/client-s3` (R2 speaks the S3 API) with `endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `region: 'auto'`, credentials from env.
- Hint: this is the "adapter" pattern: callers never know where files go. Do not sprinkle `if (driver === 'r2')` across controllers.
- Hint: set `CacheControl: 'public, max-age=31536000, immutable'` on every `-r` file and its copies (they are never overwritten, the name changes on every upload); `public, max-age=3600` on others.
- New env vars (document in `.env.example`): `STORAGE_DRIVER`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `MEDIA_PUBLIC_URL` (e.g. `https://media.silky.tn`). Production start-up must refuse `STORAGE_DRIVER=r2` with a missing R2 variable (follow the existing checks in `server/config/env.js`).

**4.3 Switch the upload pipeline to it.**
- Today: multer `diskStorage` (`server/utils/upload.js`) -> `verifyImageUpload` / `verifyVideoUpload` (file signature check) -> sharp resize middleware writes the three WebP copies -> controller answers `{ url: '/uploads/<file>' }`.
- Change multer to `memoryStorage()` with the same size limits, keep the signature check on the buffer, have the resize step produce the three copies as buffers, then `putObject` the original and the copies. The answer stays `{ url: '/uploads/<file>' }`.
- Hint: keep file naming exactly as today (`<timestamp>-<random>-r.<ext>`). The `-r` marker is how front ends know copies exist.
- Hint: sharp is already given a Buffer (there is a Windows file-lock note about it). Good, memory storage fits.
- Hint: upload the copies first and the original last. If anything fails, delete what was uploaded and answer an error; never leave an original without its copies while the name says `-r`.
- Deletion: `removeUploadIfUnused` / product deletion / photo cleanup on product edit (`server/services/product.service.js`) must call `deleteObject` for the original and the three copies. Videos too (`server/services/video.service.js`).
- Remove `express.static` for `/uploads` only when `STORAGE_DRIVER=r2` (keep it for `disk` so local dev works).

**4.4 One-off copy script** `server/scripts/copy_uploads_to_r2.js`:
- Reads every file in `env.uploadsDir`, uploads it with the right content type and cache header, skips files that already exist in R2 with the same size, prints a count. Read-only on the local folder. Re-runnable.
- Then cross-check: every `/uploads/...` URL referenced in the database (preflight already has the query that lists them, `server/scripts/preflight.js`) must exist in R2. Print missing ones.

**Done when:** with `STORAGE_DRIVER=r2` locally, uploading, editing and deleting a product photo and a gallery/hero image works and the files appear/disappear in R2, and the local storefront shows them with `PUBLIC_MEDIA_URL` pointing at the bucket; existing tests still pass with `STORAGE_DRIVER=disk`; the copy script reports 0 missing. New test `server/scripts/test_storage_service.js` covers the disk driver and an injected fake R2 client (no network in tests).

---

## Phase 5: Database to Neon

**5.1 Create the Neon project.** Region: AWS Europe Central 1 (Frankfurt), per 0.3. Note both connection strings Neon gives: the **direct** one and the **pooled** one (`-pooler` in the host).
- Hint: the API is a long-running server with its own `pg.Pool` (`server/db/pool.js`), so it uses the **direct** string. The pooled one (PgBouncer, transaction mode) is for serverless code and does not accept the `statement_timeout` start-up parameter our pool sends.
- Hint: add `?sslmode=require` to the URL. Check `pool.js` still works with SSL; if `pg` complains about the certificate, pass `ssl: { rejectUnauthorized: true }` explicitly. Never set `rejectUnauthorized: false`.

**5.2 Copy the data.**
- `pg_dump` must be the same major version or newer than the Neon Postgres version. Check with `pg_dump --version`.
- Use custom format: `pg_dump --format=custom --no-owner --no-acl "$SOURCE_URL" -f silky.dump`, then `pg_restore --no-owner --no-acl --dbname "$NEON_DIRECT_URL" silky.dump`.
- Source = the database the owner names (production data, NOT `silky_test`). Ask which one.
- Hint: `--no-owner --no-acl` avoids errors about roles that exist locally but not on Neon.

**5.3 Verify.**
- Run `npm run preflight` with `DATABASE_URL` pointing at Neon: schema, admin row and configuration checks must pass.
- Compare row counts of `products`, `product_variants`, `orders`, `users`, `order_deliveries`, `governorates` between source and Neon with one SQL query each.
- Start the API locally against Neon and open a product and an order in the admin and on the local storefront. Startup migrations must report nothing to do.

**Done when:** counts match, preflight is clean, the app works against Neon. Document the Neon setup in `DEPLOYMENT.md` (backup = Neon's point-in-time restore on the plan in use; also keep a weekly `pg_dump`).

---

## Phase 6: Deploy the API to Render

- Web service, region Frankfurt, free plan (0.3), Node 24, build `npm ci`, start `node server/index.js`. Health check path `/health` (already answers 200 only while the DB answers).
- Env vars: everything production needs per `CLAUDE.md` and `.env.example` (`NODE_ENV=production`, `DATABASE_URL` = Neon direct, `JWT_SECRET`, `CORS_ALLOWED_ORIGINS=https://silky.tn` (only: the admin is served from `https://silky.tn/admin`, same origin), `ADMIN_PASSWORD`, `TRUST_PROXY=1`, SMTP, GOODEX, `GOODEX_WEBHOOK_SECRET`, `STORAGE_DRIVER=r2` + R2 vars, `MEDIA_PUBLIC_URL`). Never commit secrets; use Render's environment settings.
- Custom domain `api.silky.tn` (CNAME in Cloudflare DNS to the Render host). In Cloudflare set this record to **DNS only** (grey cloud) at first; Render issues its own certificate.
- Keep `GOODEX_POLL_INTERVAL_MINUTES` as the owner wants (off by default). On a free instance it only runs while awake.
- Free plan keep-awake (0.3): add `GET /ping` in `server/app.js` (before the guest-session middleware, no DB, no cookie, excluded from the request log like `/health`), and a tiny separate Worker `keepalive/` with a Cron Trigger `*/10 * * * *` that fetches `https://api.silky.tn/ping`. Hint: a scheduled Worker uses the `scheduled(event, env, ctx)` handler and `ctx.waitUntil(fetch(...))`.

**Done when:** `https://api.silky.tn/health` answers 200; logging in to the local admin (`http://localhost:4321/admin`) pointed at it works; `npm run preflight` run against the production env vars is clean; the ping Worker's logs show it calling `/ping` every 10 minutes.

---

## Phase 7: Cut-over (go live)

**7.1 Domain on Cloudflare.** Change the nameservers at the `.tn` registrar to the two Cloudflare gives. (This can be done earlier, e.g. before Phase 4, without changing the live site, as long as the existing records are copied over first.)

**7.2 Deploy the front ends.**
- Storefront: `astro build` + `wrangler deploy` with production env (`API_URL=https://api.silky.tn`, `PUBLIC_MEDIA_URL=https://media.silky.tn`, `PUBLIC_SITE_URL=https://silky.tn`), custom domain `silky.tn`.
- Admin: nothing to deploy separately. It is the `/admin` route of the same Worker (Phase 3), so `silky.tn/admin` goes live with the storefront. There is no `admin.silky.tn` record and no second Worker or Vite build. Check on the live domain: `/admin` answers with `X-Robots-Tag: noindex`, is not in `sitemap.xml`, is `Disallow`ed in `robots.txt` and has no `x-silky-cache` header.
- Page-cache purge across data centers: set the Worker secrets `CF_ZONE_ID` and `CF_API_TOKEN` (token limited to "Cache Purge" on the `silky.tn` zone). `POST /internal/purge` (called by the admin after a product change) deletes the page from the data center that runs the request and, with these secrets, asks Cloudflare to purge the same URLs everywhere. Without them other data centers keep the old page for up to 5 minutes. Test it on the real domain: edit a product, check `x-silky-cache: MISS` right after.
- `www` -> redirect rule to `https://silky.tn` (301, keep path and query).

**7.3 Switch the services.**
- Update `SITE_URL`/`APP_URL` on Render (used in e-mails and password-reset links) to `https://silky.tn`, and check that reset links point to the storefront's `/password-reset/<token>`.
- GOODEX: change the webhook URL in the GOODEX customer area to `https://api.silky.tn/api/webhooks/goodex` and press "Envoyer un appel de test".

**7.4 (moved to Phase 3 step 2, done there)** Remove the old SEO and page serving from the API. Remove from `server/app.js` the old page handler, `/robots.txt`, `/sitemap.xml` and the frontend static serving; the API root `/` answers `{ ok: true }`. Delete `server/seo/` (with the `src/seo/` modules Phase 3 moved next to it) and `renderBody.js` and their tests (`test_seo_builders.js`, `test_seo_pages.js`, `test_seo_html.js`), and the `SEO_HTML` / `FRONTEND_DIST_DIR` env vars and preflight check. Run the whole test list afterwards.

**7.5 Search engines.** Google Search Console and Bing Webmaster Tools: verify `silky.tn` (DNS TXT record), submit `https://silky.tn/sitemap.xml`, inspect 3 product URLs with "URL inspection" and confirm the rendered HTML holds the content.

**Done when:** the site, admin, images, API and GOODEX webhooks work on the real domains; the old SEO code is gone; `DEPLOYMENT.md` and `PRE_PRODUCTION.md` are updated (deploy, roll back = redeploy previous Worker version + previous Render deploy, backups = Neon + R2).

---

## Final verification (before telling the owner it is done)
- Fetch 5 product pages, 2 collections, home, FAQ in French and Arabic **with plain `fetch`** and show that name, price, description and JSON-LD are in the HTML.
- Lighthouse (mobile) for home, a collection and a product page: report the scores and LCP/CLS/INP next to the same pages on the old site (measured locally in Phase 2 if the old site was never online).
- Place a real test order end to end on the deployed site (guest and logged in), confirm it in the admin, check the GOODEX parcel and the confirmation e-mail. Use a test address agreed with the owner.
- List anything not done or not verified, plainly.
