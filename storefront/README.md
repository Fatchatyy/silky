# Silky storefront (Astro)

The public shop (French at `/`, Arabic at `/ar`), rendered on the server by Astro and deployed as a Cloudflare Worker.
It never talks to the database: every piece of catalog data comes from the Express API in `../server`.
Plan and decisions: `../MIGRATION_PLAN_ASTRO.md`.

## Run everything locally

Three terminals, from the repository root (the first two are the commands you already use):

```bash
npm run dev:server        # API on http://localhost:3001 (needs the local Postgres)
```

```bash
npm run dev:client        # admin (old Vite app) on http://localhost:5173
```

```bash
npm run dev:storefront    # storefront on http://localhost:4321
```

First time only:

```bash
cd storefront && npm install && cp .env.example .env
```

Then add the storefront to the API's allowed origins, in the root `.env`:

```
CORS_ALLOWED_ORIGINS=http://localhost:4321,http://localhost:5173
```

and restart the API. Without it the browser blocks the cart, login and checkout calls (the pages themselves still load).

## Configuration

| Variable | Where it is read | Meaning |
|---|---|---|
| `API_URL` | server, at run time (`wrangler.jsonc` `vars`, `.dev.vars`, or `--var`) | where the Astro server fetches catalog data |
| `PUBLIC_API_URL` | browser, built into the pages | the API as the browser sees it |
| `PUBLIC_MEDIA_URL` | server and browser, built in | where `/uploads/...` photos and videos are served from |
| `PUBLIC_SITE_URL` | server and browser, built in | public address: canonical, hreflang, Open Graph, sitemap, JSON-LD |
| `PUBLIC_ADMIN_URL` | browser, built in | where the admin app lives (links only) |

Only `PUBLIC_` variables reach the browser: never put a secret in one. After changing a `PUBLIC_` value, rebuild.

## Checks

```bash
cd storefront
node scripts/test_seo_builders.mjs                 # pure tests of the SEO builders, no server needed
node scripts/test_rendered_pages.mjs               # needs DATABASE_URL pointing at silky_test; builds, runs wrangler dev
```

`node scripts/serve_fixtures.mjs` starts an API on `silky_test` (port 3101) with test products, for browsing the
storefront without touching your own database (set `API_URL` / `PUBLIC_API_URL` / `PUBLIC_MEDIA_URL` to that port).

## Notes

- `astro dev` runs in `workerd` (the Cloudflare runtime), so Workers-only limits show up while developing.
- Product photos are plain `<img>` tags using the pre-made WebP copies (`.card/.share/.large.webp`): Astro's image
  optimizer needs `sharp`, which does not run on Workers.
- Rendered pages are cached 5 minutes by Cloudflare (`src/middleware.ts`): a price change shows within that time.
