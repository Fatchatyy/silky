# Silky storefront (Astro)

The public shop (French at `/`, Arabic at `/ar`) and the admin panel (`/admin`), generated as static files by Astro from a snapshot of the
catalogue (one API request per build) and deployed as a Cloudflare Worker with static assets. It never talks to the database: every piece of catalog data comes from the Express API in `../server`.
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
  rendered on request by the Worker (never a file), absent from `sitemap.xml` and `Disallow`ed in `robots.txt`. `/ar/admin` is a 404.
- **No page cache, no purge.** The public pages are files built from a snapshot of the catalogue, so a change made in the admin
  (product created, saved, hidden/shown, deleted, reviews, theme, announcement bar, hero) shows on the shop after the next
  `npm run publish-site`. An admin sees a hidden or new product at once: its address is a 404 for visitors, and the admin's
  browser then loads the product with the admin token and shows it with the editor.
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
node scripts/test_snapshot_fetch.mjs               # the snapshot client: retries through a cold start, never returns partial data
node scripts/test_build_guard.mjs                  # the build guard catches every kind of broken site
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

## Publishing

```bash
cd storefront && npm run publish-site            # headers -> build (snapshot, pages, build guard) -> wrangler deploy
cd storefront && npm run publish-site -- --dry-run   # everything except the deploy
```

- The build reads the catalogue from `SNAPSHOT_API_URL` (falls back to `API_URL`): the Express API. A sleeping Render API is
  waited for (90 s per attempt, 8 minutes in all, growing pauses). If the API never answers, or answers with something that must
  not be published (no products, a hidden product, mismatched data), the build fails and **nothing is deployed**: the live site
  stays as it is.
- After the pages are written, `integrations/buildGuard.mjs` fails the build when a page is missing, empty, a redirect stub or
  shows `undefined`, when a page has no title, canonical, h1 or Product JSON-LD, or when the sitemap lists a page that does not exist.
- A build for the real address (`PUBLIC_SITE_URL=https://...`) refuses an API on this machine, so a developer database is never
  published. Deploying needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`) on the machine that runs the command.
- Extra settings: `SNAPSHOT_ATTEMPT_TIMEOUT_MS`, `SNAPSHOT_BUDGET_MS`, `SNAPSHOT_MIN_PRODUCTS`, `COLLECTION_PAGE_SIZE`.

## Notes

- `astro dev` runs in `workerd` (the Cloudflare runtime), so Workers-only limits show up while developing.
- Product photos are plain `<img>` tags using the pre-made WebP copies (`.card/.share/.large.webp`): Astro's image
  optimizer needs `sharp`, which does not run on Workers.
- Pages are files, revalidated by the browser with their ETag. Cloudflare serves a file without starting the Worker; only
  `/admin`, `/password-reset/<token>`, old product addresses (301) and unknown addresses (404) run it (`src/fetch.ts`).
