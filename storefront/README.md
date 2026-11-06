# Silky storefront (Astro)

The public shop (French at `/`, Arabic at `/ar`) and the admin panel (`/admin`), rendered on the server by Astro and deployed
as a Cloudflare Worker. It never talks to the database: every piece of catalog data comes from the Express API in `../server`.
Plan and decisions: `../MIGRATION_PLAN_ASTRO.md`.

## Run everything locally

Two terminals. The API (its own project in `../server`):

```bash
cd server && npm run dev   # API on http://localhost:3001 (needs the local Postgres)
```

This project:

```bash
cd storefront && npm run dev   # storefront on http://localhost:4321 and the admin on http://localhost:4321/admin
```

First time only:

```bash
cd storefront && npm install && cp .env.example .env
```

Then add the storefront to the API's allowed origins, in `server/.env`:

```
CORS_ALLOWED_ORIGINS=http://localhost:4321
```

and restart the API. Without it the browser blocks the cart, login, checkout and admin calls (the pages themselves still load).

## The admin panel (`/admin`)

`http://localhost:4321/admin` (login at `/admin/login`, with the admin password of the API's `.env`). It lives in
`src/admin-app/` and is mounted by `src/pages/admin/[...path].astro` as ONE `client:only="react"` island, with React Router
(`basename="/admin"`), so every address under `/admin` answers the same shell and a reload on any of them works.

- **Shared login with the shop.** Same origin, same `localStorage` keys (`silky_auth_token`, `silky_auth_user`). Sign in at
  `/admin/login` and the shop pages show the admin tools (inline product editor, hidden products, review moderation); sign out
  in either place and both are signed out (other open tabs follow through the `storage` event).
- **One copy of the admin code.** `src/admin/` is used by both the panel and the shop pages: `adminApi.ts` (every admin API
  call and the cache purge), `productForm.js` (product form logic shared by the panel's product form and the inline
  editor), `AdminProductReviewsSection.jsx`, the inline editor (`ProductPageAdmin.jsx`), `enhance.jsx` ... The shop loads them
  lazily, only for a browser that holds an admin token; a visitor's page never contains or downloads them.
- **Not a page of the site.** Everything under `/admin` is `noindex` (meta tag and `X-Robots-Tag`), `Cache-Control: no-store`,
  never stored by or served from the page cache, absent from `sitemap.xml` and `Disallow`ed in `robots.txt`. `/ar/admin` is a 404.
- **Cache purge.** Every admin change that visitors can see (product created, saved, hidden/shown, deleted, stock, product
  reviews, theme, announcement bar, hero) calls `POST /internal/purge` so the 5-minute page cache is cleared for the pages
  concerned (`{ slug, category, previousCategory }`, `{ productId }` or `{ all: true }`).
- **Styles.** The shell loads the shop stylesheet (`src/styles/shop.css`) and `public/admin/styles.css` (the admin stylesheet:
  `admin.css` in the `admin` cascade layer, then `product-admin.css`), in the order the old single-page app evaluated them.

## Configuration

| Variable | Where it is read | Meaning |
|---|---|---|
| `API_URL` | server, at run time (`wrangler.jsonc` `vars`, `.dev.vars`, or `--var`) | where the Astro server fetches catalog data |
| `PUBLIC_API_URL` | browser, built into the pages | the API as the browser sees it |
| `PUBLIC_MEDIA_URL` | server and browser, built in | where `/uploads/...` photos and videos are served from |
| `PUBLIC_SITE_URL` | server and browser, built in | public address: canonical, hreflang, Open Graph, sitemap, JSON-LD |

The admin has no address of its own: it is `/admin` on this site. Only `PUBLIC_` variables reach the browser: never put a secret in
one. After changing a `PUBLIC_` value, rebuild.

## Checks

```bash
cd storefront
node scripts/test_seo_builders.mjs                 # pure tests of the SEO builders, no server needed
node scripts/test_order_search.mjs                 # admin orders search, pure
node scripts/test_admin_orders_table_safeguards.mjs   # admin orders table and PDF selection, pure
node scripts/test_governorate_lists.mjs            # checkout governorate lists, pure
```

The tests that need the API as well live outside both apps, in `integration/` (run from the repository root):

```bash
node integration/test_rendered_pages.mjs           # needs DATABASE_URL pointing at silky_test; builds, runs wrangler dev
node integration/test_admin_orders_pdf_selection.js   # real orders from silky_test rendered as PDFs
```

`node integration/serve_fixtures.mjs` (from the repository root) starts an API on `silky_test` (port 3101) with test products, for browsing the
storefront without touching your own database (set `API_URL` / `PUBLIC_API_URL` / `PUBLIC_MEDIA_URL` to that port).

`node integration/serve_admin_session.mjs [apiPort] [sessionFile] [storefrontOrigin]` does the same for the admin panel: API on
`silky_test`, a stand-in for GOODEX, a throw-away uploads folder, test products and pending orders, and a throw-away admin
account whose generated password is written to the session file (nothing of your own data is read or written; Ctrl+C removes
what it created).

## Notes

- `astro dev` runs in `workerd` (the Cloudflare runtime), so Workers-only limits show up while developing.
- Product photos are plain `<img>` tags using the pre-made WebP copies (`.card/.share/.large.webp`): Astro's image
  optimizer needs `sharp`, which does not run on Workers.
- Rendered pages are cached 5 minutes by Cloudflare (`src/middleware.ts`): a price change shows within that time (the admin
  clears it at once with the purge above; a browser may still show its own copy once).
