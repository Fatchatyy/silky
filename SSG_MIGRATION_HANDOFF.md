# SSG migration: handoff for the next session

Written at the end of a long session so a fresh one can continue without the conversation. Read this, then `CLAUDE.md`
(section "Astro migration", already updated), `storefront/README.md` ("Publishing") and `PRE_PRODUCTION.md` (section 3b).

## What we are doing and why

Silky's public storefront (Astro 7 + `@astrojs/cloudflare`, French + Arabic) used to render every page on request in a
Cloudflare Worker, behind a Workers Cache API layer (5 minutes). We are moving it to **static generation (SSG)**: every
public page is a file built from one snapshot of the catalogue and served by Cloudflare without running the Worker.

Decided (owner + a second reviewer + this assistant, after a side-by-side comparison of both implementations on the same
database):
- Keep Express, PostgreSQL (Neon), R2, Astro, and React islands where they are interactive. No backend/database rewrite.
- The owner will use the **Cloudflare free plan** and **Render free** for the API. Nothing is deployed yet (not the API, not
  the storefront).
- Why SSG: no origin dependency for public pages (the Render API sleeps; a sleeping API used to mean 503 for crawlers on a
  cache miss), no 5-minute cache or purge machinery, static asset requests are free and unlimited while Worker requests are
  capped (free: 100,000/day, 10 ms CPU each; the old SSR product page measured 17 ms, see `PRE_PRODUCTION.md`).
- SSG gives **no ranking boost by itself**: SEO output (title, canonical, hreflang, JSON-LD, h1, links) was identical in both
  implementations on 11 representative pages. The gains are reliability, TTFB and consistency.
- Optional structured-data properties (return policy, etc.) are not a ranking lever: low priority.
- Do not replace React everywhere with vanilla JS. Only remove it from always-loaded header pieces if a mobile measurement
  shows a problem (the React runtime is ~56 KB brotli, not 211 KB).

## Branch and commits (branch `ssg-migration`, cut from `astro-migration`)

- `2bf09de` Phase 1: `GET /api/storefront/snapshot` (server) + `integration/test_snapshot.mjs`.
- `8babc31` Phases 2 and 3a: static routes, `src/fetch.ts`, `_headers`/`_redirects`, snapshot client, build guard,
  `npm run publish-site`, tests, docs.
- `cfbd5f4` Phases 3b and 4: fingerprint + publish hook + admin banner, HTML carousel, search index, self-hosted fonts.
- Untracked and NOT ours: `.claude/`, `server/scripts/send_test_email.js` (leave them out of commits).

## Phase status

| Phase | State |
|---|---|
| 1. Snapshot endpoint | done, committed (`2bf09de`) |
| 2. Static routes (+ headers, redirects, Worker fallback, snapshot client, build guard, pagination) | done, committed (`8babc31`) |
| 3a. Manual publish command (`npm run publish-site`) | done, committed (only run with `--dry-run`) |
| 3b. Publish button (fingerprint, hook, `/api/publish`, admin banner, monthly counter) | done; the automatic triggers of `cfbd5f4` were removed afterwards: manual only |
| 4. Carousel as HTML/CSS, static search index, self-hosted fonts, eager first photos | done, committed (`cfbd5f4`); header islands deliberately NOT rewritten (measured) |
| Real deployment checks | when the owner deploys (checklist below) |

## How it works now (short)

- Build: `cd storefront && npm run build` = `scripts/write_headers.mjs` (writes `public/_headers`, gitignored) then
  `astro build` (`output: 'static'`). One API request (`/api/storefront/snapshot`) feeds every page, the sitemap
  (`sitemap.xml.ts`) and `redirects-map.json`. `integrations/buildGuard.mjs` runs at the end and fails the build on a missing
  or stub page, missing title/canonical/h1/Product JSON-LD, sitemap/page mismatch, missing control files.
- Snapshot client (`src/lib/snapshot/fetchSnapshot.ts`, `validate.ts`; wrapper `src/lib/pages/snapshot.ts`): 90 s per attempt,
  8 min budget, pauses 2/5/10/20/30 s, retries on refused/timeouts/408/425/429/5xx/non-JSON/cut-off body; never retries or
  publishes an unusable snapshot (empty, hidden product inside, summaries mismatch, bad shape, 4xx). A build for an https
  `PUBLIC_SITE_URL` refuses a loopback API unless `ALLOW_LOCAL_API_FOR_BUILD=1`.
- Worker (`src/fetch.ts`): only `/admin/**` and `/password-reset/<token>` (rendered on request), old addresses (301 from
  `/redirects-map.json`: `/product/<id>`, wrong-case slug/collection) and real 404s (static `404.html` / `ar/404.html`).
  Every Worker response has `x-silky-worker: 1`; pages never do. The build itself also goes through this entry: it lets
  requests through when `state.routeData.prerender` is true and the pattern matches. Do not add logic that runs for those.
- Files: `public/_redirects` (committed: `/index.html`, trailing slash 301) and `public/_headers` (generated from
  `src/lib/securityHeaders.ts`; CSP report-only).
- Collections are paginated: `/collection/<slug>` (page 1), `/collection/<slug>/2`... (`COLLECTION_PAGE_SIZE`, default 48).
  Home carousel: the old 3D coverflow with autoplay as static HTML, 5 cards (`ProductCarousel.astro`).
- Hidden/new products: no file is generated; the 404 page's inline script (`NotFoundView.astro`) hands the slug to
  `src/admin/enhance.jsx`, so an admin's browser loads the product with the admin token and shows the editor. Verified in a
  real browser.
- Removed: Workers Cache API layer, `/internal/purge`, `cacheKeys.ts`, `middleware.ts`. `purgeStorefrontCache` in
  `src/admin/adminApi.ts` is a **no-op** kept for its 9 call sites (`adminApi.ts`, `AdminProductReviewsSection.jsx`,
  `ProductPageAdmin.jsx`, `admin-app/context/ProductsContext.jsx`) until 3b replaces them.

## Tests (all passing at the end of the session)

```bash
node storefront/scripts/test_snapshot_fetch.mjs        # 13: snapshot client (hermetic)
node storefront/scripts/test_build_guard.mjs           # 31: the build guard catches broken sites (hermetic)
node storefront/scripts/test_seo_builders.mjs          # 29
node integration/check_independence.mjs && node integration/check_shared_in_sync.mjs
# silky_test only (set DATABASE_URL to the silky_test database; the test refuses anything else). Takes ~8 minutes: it runs
# several builds. Result at the end of the session: 419 passed, 0 failed.
DATABASE_URL=postgres://.../silky_test node integration/test_rendered_pages.mjs
DATABASE_URL=postgres://.../silky_test node integration/test_snapshot.mjs
DATABASE_URL=postgres://.../silky_test node integration/test_publish_trigger.mjs   # 17: the publish hook, with a mock hook
NODE_ENV=test node server/scripts/test_catalogue_fingerprint.js                    # 7: the fingerprint (hermetic)
DATABASE_URL=postgres://.../silky_test node server/scripts/test_deploy_readiness.js # schema.sql has not drifted
```
`integration/test_rendered_pages.mjs` is the acceptance test of the routing (section A: which requests run the Worker, old-id
redirects, hidden products, real 404s, pagination) and of the sleeping/failing API (section B). Keep it green when changing
anything in `src/fetch.ts`, `public/_*`, the pages or the snapshot client. Never run tests against the dev `silky` database.

## Gotchas learned the hard way

- On Windows a running `wrangler dev` (or a leftover `workerd`) locks `dist/`: stop it before `astro build`
  ("Device or resource busy"). A failing Node script can also end with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
  (exit 127): known, not a test failure.
- Astro reads `PUBLIC_*` for the browser bundle from `storefront/.env` BEFORE the process environment (a command-line
  `PUBLIC_API_URL` did not reach the bundle while `.env` held another value; `.env.production.local` was ignored too).
  `scripts/write_headers.mjs` mirrors that. Keep `.env` and the build environment consistent. `storefront/.env` is the owner's
  local file (API 3001, site 4321): restore it exactly if you ever change it for a browser test.
- With `build.format: 'file'`, prerender requests look like `/index.html`, `/product/x.html`: anything that redirects on the
  request path breaks the build into redirect stubs (the guard now catches that).
- In bash on this machine, backslashes in heredocs passed through the tool can be altered: write Python/JS edit scripts with
  the Write tool into the scratchpad instead of heredocs when they contain regex backslashes.
- Local `wrangler dev` kept stale cached pages past `s-maxage` when `stale-while-revalidate` was present (irrelevant now:
  the cache layer is gone) and Cloudflare documents SWR/stale-if-error as unsupported for `cache.put/match`.

## Phase 3b and 4: what was built (`cfbd5f4`)

See `CLAUDE.md` (the Astro migration section, bullets "Automatic publishing", "Admin banner", "Phase 4") for the design. In short:
- Server: `catalogue.fingerprint.js`, `publish.service.js`, `/api/publish/*` (the `publishWatcher.js` middleware was removed: nothing publishes by itself), migration `add_publish_state.js`
  (+ `schema.sql` patched by hand: only the 4 new `site_settings` columns, to avoid unrelated pg_dump formatting noise).
- Storefront: `build-info.json.ts`, `search-index.json.ts`, `PublishStatus.jsx`, `ProductCarousel.astro`, `stores/searchIndex.ts`,
  `ArabicFonts.astro`, fontsource packages, `catalogueChanged()` replacing the purge calls.
- Tests added: `server/scripts/test_catalogue_fingerprint.js`, `integration/test_publish_trigger.mjs`; extended:
  `test_build_guard`, `test_snapshot_fetch`, `integration/test_rendered_pages.mjs`, `integration/test_snapshot.mjs`.
- Verified in a real browser (test admin on silky_test): the new carousel scrolls and its arrows work, the header search used only
  `/search-index.json`, no Google font request, the admin banner went from "à jour" to "Modifications non publiées" within seconds of a theme change
  (and showed the failing hook), "Publier maintenant" showed its error.
- Measured (desktop CPU, local server, browser pane): ~92 KB compressed JS and 19-20 files on every page, zero long tasks (> 50 ms) on home,
  collection and FAQ: so no vanilla-JS rewrite of the header islands.

Still open (owner decisions): where the build runs and the `PUBLISH_HOOK_URL` (the admin button is the only trigger; there is no button until it is set); whether the new
scrolling carousel look is accepted (the coverflow 3D effect and autoplay were restored afterwards as static HTML + a small script); image sizes/AVIF (needs the upload pipeline).

## When the owner deploys (checklist, nothing here is verified on Cloudflare yet)

- Set `SNAPSHOT_API_URL=https://api.silky.tn`, `PUBLIC_API_URL`, `PUBLIC_MEDIA_URL`, `PUBLIC_SITE_URL` for the build; the Worker
  variable `API_URL` in `storefront/wrangler.jsonc` is still `http://localhost:3001` (used by the password-reset page at run time).
- Check on the real platform: `public/_redirects` (`/index.html`, `/*/ /:splat`) and `public/_headers` behave as in
  `wrangler dev`, their size limits, a 404 from an unknown address, `x-silky-worker` absent on pages, Render's real cold start
  vs the 8-minute budget, the first `npm run publish-site` (only `--dry-run` has run), Worker CPU time in the dashboard.
- Free plan: 20,000 files per deployment (about 2.4 files per product, so ~8,000 products), 25 MiB per file.

## Not verified (be honest about these)

- Anything on real Cloudflare (see above). Real API latency / cold start. Worker CPU for the few Worker-rendered requests.
- Admin listings on paginated collection pages (admins may get the full client-side list): not checked.
- Stock/price freshness on product pages: now refreshed in the browser from `/api/products/by-slug` (see CLAUDE.md); cards and the search index still show the build's values until the next publish. Seen working in a browser (request fires, no error); the visible change after an edit was proven at the API level only (`test_static_scenarios.mjs` C1).
- `/ar/product/<id>/` (old id + trailing slash) takes two redirects (slash, then id): accepted.
- `/404` and `/ar/404` answer 200 (noindex) if requested directly: accepted, noted in `PRE_PRODUCTION.md`.

## Leftovers outside the repository

Two helper git worktrees were created next to the repo and can be removed when no longer needed
(`git worktree remove <path>` then `git branch -D ssg-spike ssr-baseline`): `../silky-app-ssg-spike` (branch `ssg-spike`,
the first prototype and the comparison scripts in `spike/`) and `../silky-app-ssr-baseline` (branch `ssr-baseline`, the old
SSR build used for the comparison). The comparison harness `spike/serve_compare.mjs` / `compare_pages.mjs` / `measure.mjs`
lives only in the spike worktree.
