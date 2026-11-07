# Silky: to do before production

Only what still has to be fixed, decided or checked before the site goes live. An item is deleted from this file as soon as it is done. Last updated: 2026-11-04.

## 1. Blockers (do not go live without these)

- [ ] **Set up the production environment by following `DEPLOYMENT.md`** (host, managed database, `UPLOADS_DIR` on a persistent disk, `npm run db:init`, `npm run admin:create`, `npm run preflight` with no FAIL, backups copied outside the provider with one tested restore, uptime monitor on `/health`, restart-on-crash policy, tagged deploys for rollback). The scripts, the guarded order-deleting migration, `/health` and request logging are done and tested (`node server/scripts/test_deploy_readiness.js`); the hosting choices and accounts are not.
- [ ] **Production environment variables** (on the host, never committed; production values must differ from the local `.env`: own database and password, own `JWT_SECRET`, own admin password, own SMTP and GOODEX credentials; the server refuses to start in production without `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL` and an `ADMIN_PASSWORD` of 10+ characters that is not a placeholder): `NODE_ENV=production` (exactly this word: the server refuses to start with anything else), random `JWT_SECRET` (32+ chars), `ADMIN_PASSWORD`, `DATABASE_URL`, `TRUST_PROXY=1` (number of reverse proxies in front of the server; without it every visitor shares one IP for the rate limiters, so login limits would lock everybody out together), `CORS_ALLOWED_ORIGINS=https://silky.tn`, `APP_URL`, `SITE_URL=https://silky.tn`, `SEO_HTML=on`, SMTP credentials `SMTP_USER` + `SMTP_PASS` (app password; without them no e-mail is sent in production: order confirmations, password resets, welcome and contact replies), `GOODEX_API_TOKEN`, `GOODEX_USER_ID`, `GOODEX_WEBHOOK_SECRET` (different from the API token), `GOODEX_ENABLE_LIVE=true` (production only), `UPLOADS_DIR` on a persistent disk. Without `SITE_URL` + `SEO_HTML=on`, `/robots.txt` and `/sitemap.xml` return 404 and no canonical, JSON-LD or share-preview tags are written.
- [ ] **Commit the work.** Phase 3 step 2 (old Vite app and the API's SEO layer deleted) and about 100 other changes are uncommitted (nothing pushed). Stage by explicit path.
- [ ] **Build the storefront** (`npm run build`) and deploy it on Cloudflare; the API no longer serves any page.
- [ ] **Back up the database before the first start of the new code.** Four migrations run at server start and have not been applied to the real database yet: the Arabic product columns (`add_product_arabic_content.js`), the variant order (`add_variant_position.js`, which puts the sizes of existing products in natural order once: 36, 38, 40... / XS..XXL), `add_users_tokens_valid_after.js` (one nullable column on `users`, no data change; admin logout and password changes use it to end old sessions) and `add_refund_deliveries.js` (a `refund_id` column on `order_deliveries` and its unique index; the one-parcel-per-order index is dropped and recreated in the same transaction, no data change). After the first start, open a few products (for example Set Blush) and check the size order.
- [ ] **Neon is set up but not connected to a live server yet** (Phase 5 done locally: schema + governorates, categories, site settings and the admin row restored, preflight clean, API and admin login checked). Still to do: set the production `DATABASE_URL` on Render to the direct Neon URL with `sslmode=verify-full`; keep the database allowed to sleep (uptime monitor off `/health` or rare, GOODEX poll off or long); copy a weekly `pg_dump` (version 17+) outside Neon and test one restore; re-check Neon's free limits (1 GB, 100 compute-hours) before launch. The four migrations in the next-but-one item are already applied in that Neon database.
- [ ] **Keep-awake Worker** (`server/keepalive/`, built and tested locally, not deployed): once `api.silky.tn` answers, deploy it (`cd server/keepalive && npm ci && npm run deploy`, steps in `DEPLOYMENT.md` "Keeping the free API awake"), set Render's health check path to `/ping`, and point any uptime monitor at `/ping` (or `/health` rarely). Re-check Render's free limits (750 instance hours, only free service in the workspace) and decide whether to turn on the GOODEX poll (`GOODEX_POLL_INTERVAL_MINUTES`), the only source of delivery statuses since webhooks are not used.
- [ ] **Never run `npm run db:seed` on production** (it TRUNCATEs users, orders, products).

## 2. Security

- [ ] The page Content-Security-Policy is sent in **report-only** mode (`CSP_MODE`, default `report-only`; policy in `server/middleware/securityHeaders.js`): it blocks nothing. Browsed on a local build (storefront fr/ar, product, cart, favourites, checkout, all admin tabs): zero reports. After deploy, browse the live site with the browser console open (look for "[Report Only] Refused to ..."), including product videos and a page that shows an image from another https site; if nothing is reported, set `CSP_MODE=enforce`. Social-media images and any new third-party script or embed (analytics, chat widget, map) must be added to the policy first.
- [ ] `npm audit` still reports 6 moderate: `drizzle-kit`/`esbuild` (dev tools, not used by the running site) and `express`/`qs` (the fix needs a newer Express; the advisories concern `qs.stringify` and buffers, which the app does not use). `jspdf` 4.2.1 and `nodemailer` 10.3.1 are installed: e-mails (all five templates, SMTP and STARTTLS login) and the order, exchange and refund PDFs (node and browser build) were compared with the previous versions and are identical. The host must run Node 20 or newer (nodemailer 10).
- [ ] Set `TRUST_PROXY` on the host (see the variables list above) and check `req.ip` is the visitor's address.
- [ ] 54 files in `server/uploads/` are tracked by git although `.gitignore` lists them: `git rm -r --cached server/uploads`. Keep real uploads on a persistent disk.
- [ ] The rate limiter is in memory: it resets on restart and works for one instance only.
- [ ] Postgres must not be reachable from the internet; dedicated DB user, `sslmode=require`, daily backups, test a restore.
- [ ] Rotate any secret that was ever pasted in chat or committed.
- [ ] After deploy: securityheaders.com, SSL Labs, admin routes with no token / customer token (401/403), webhook with a wrong Bearer token, no stack traces in responses.

## 3. SEO

- [ ] **Check the real product slugs before launch.** Open the products of the real database and make sure every slug is readable (names typed in the admin give good slugs; data created by tests or the seed gives things like `test-dress-1793...`). Two products cannot share a name.
- [ ] **Hero buttons that link to a product** were saved with `/product/<uuid>`: they still work (redirect), but re-pick the product in the hero editor so the button links straight to the slug address.
- [ ] **Real product content.** Every product needs a unique name and a real description (descriptions were waiting for launch).
- [ ] **www and HTTP redirects** are a host/DNS setting: `www.silky.tn` -> `silky.tn` (301) and HTTP -> HTTPS (301). Express does not do it.
- [ ] **No favicon** (`/favicon.ico` is 404, no `<link rel="icon">`), so Google cannot show the logo in results. Needs the owner's OK (changes the browser tab icon).
- [ ] Products whose image file is missing get an `og:image` that returns 404 (seen on the demo products). Make sure every real product has an uploaded image.
- [ ] `hasMerchantReturnPolicy` is not in the product data (return fees unknown).
- [ ] After deploy: crawl the live site (Screaming Frog or similar), run Google's Rich Results Test on a product with several sizes/colours (check the variants and prices show), submit `sitemap.xml` in Search Console.

## 3b. Astro storefront (added in migration phase 2)

- [ ] The storefront page Content-Security-Policy is **report-only** (`storefront/src/lib/securityHeaders.ts`, written into `public/_headers` at build and set by the Worker on the few pages it renders) and allows inline scripts, because Astro's island loader is inline. Astro 7 has a built-in CSP (`security.csp`, hashes), but it only writes an enforcing `<meta>` tag (no report-only mode), so it was not turned on. After deploy, browse the live site with the console open; if nothing is reported, evaluate the hash-based policy and then enforce.
- [ ] Deploy settings for the static build: the Worker variable `API_URL` in `storefront/wrangler.jsonc` is still `http://localhost:3001` (used by the password-reset page at run time); set it to the real API. The BUILD reads the catalogue from `SNAPSHOT_API_URL` (set it to `https://api.silky.tn`, together with `PUBLIC_API_URL`, `PUBLIC_MEDIA_URL`, `PUBLIC_SITE_URL`) and refuses a local API when `PUBLIC_SITE_URL` is https. If the build runs in Cloudflare (Workers Builds), set these variables there.
- [ ] Not verified on Cloudflare itself (only in `wrangler dev`): that `public/_redirects` (`/index.html`, trailing slash `/*/ /:splat`) and `public/_headers` behave the same on the real platform, the size limits of those two files, and that Render's real cold start fits the build's 8-minute waiting budget (`SNAPSHOT_BUDGET_MS`).
- [ ] `/404` and `/ar/404` are real files, so they answer 200 (with `noindex`) if someone requests them directly; every other unknown address is a genuine 404. Harmless, noted for completeness.
- [ ] **Decide where the build runs, then set `PUBLISH_HOOK_URL` on the API.** The public pages are static files built from a snapshot of the catalogue. Nothing starts a build by itself: the owner presses « Publier maintenant » in the admin banner after all his edits, and the API makes one POST to `PUBLISH_HOOK_URL` (Cloudflare Workers Builds deploy hook, a CI workflow ...; or by hand with `cd storefront && npm run publish-site`). Until `PUBLISH_HOOK_URL` is set there is no button, and an admin change shows on the shop only after a manual publish. The hook URL is a secret: set it only in the host's environment. If the repository is connected to Cloudflare, turn OFF its automatic build on every push (a push would be a second, automatic trigger).
- [ ] Build allowance: Cloudflare's Workers Builds free plan is 3,000 build minutes a month (one build at a time, 20 minutes per build, no cap on the number of builds; the 500-builds figure is Cloudflare Pages). The banner counts the button's accepted calls against `PUBLISH_MONTHLY_BUILD_LIMIT` (500 by default, display only): once the first real publish shows how long a build takes, set it to 3,000 divided by that many minutes. Check the first real build time against the 20-minute limit.
- [ ] Phase 4 follow-ups: The 91 KB single stylesheet is shared by every page (splitting it would change the cascade order). Card photos have one size (`.card`, 600 px): smaller sizes and AVIF would need the upload pipeline (`server/utils/imageVariants.js`) and a re-run on existing photos. The header islands (React) ship ~92 KB compressed JS on every page with no long task on a desktop CPU: measure on a real phone / with field data before changing them.
- [ ] The product page has a visually hidden breadcrumb and a visible "Livraison et retours" block (same wording as the delivery page) for search engines and AI assistants; the old design had neither. Owner to confirm.
- [ ] The admin can no longer edit a product from its public page (the inline editor was part of the old storefront); products are edited in Admin > Products.
- [ ] The old carts and favourites kept in `silky_cart` / `silky_favorites` localStorage (before they moved to the API) are no longer migrated by the storefront.

## 4. Content and legal

- [ ] Owner / boss must review the Arabic wording (for example "العملاء" vs Tunisian "الحرفاء").
- [ ] Customer e-mails, review dates and some cart text are still French in the Arabic storefront.
- [ ] Decision: customer names must be Latin letters (client and server). Allowing Arabic names needs the server regex, GOODEX and the order PDF font checked.
- [ ] Tunisian data-protection (INPDP) obligations for customer phone numbers and addresses.

## 5. Decisions waiting for the owner

- [ ] Favicon (see section 3).
- [ ] **GOODEX and refunds.** Refund parcels (Remboursement / Remboursement gratuit) are sent as ordinary parcels with `echange=0`, `decharge=0` and `cod` = the refund's montant à payer (8.000 / 0.000), because the GOODEX documentation we have shows no return or pickup option. Ask GOODEX how a customer return should be created (and what `decharge` does exactly) and confirm one refund in the supervised sandbox check before `GOODEX_ENABLE_LIVE=true`. The exchange form no longer asks for `decharge`: exchanges always send `echange=1`, `decharge=0`.
- [ ] Guest carts: does GA4 need a cart row to exist before the first item is added? If not, a plain visit should stop creating a cart row, and empty guest carts older than 30 days could be deleted (item in section 6).

## 6. Found by the read-only audit of 2026-10-31

Data fetched or exposed without need:
- [ ] Every cookie-less `GET /api/cart` inserts a cart row (2 calls = 2 rows) and nothing ever cleans guest carts (109 of 110 test carts are guest carts, 18 empty). The guest cookie is also set on every API response, including the product list. Waiting for the GA4 answer above.
- [ ] Customer order payloads include internal fields (`userId`, `guestSessionId`, `governorateId`).
- [ ] The admin Orders screen loads every order with no pagination (now fast, 11 queries, but the payload grows with the number of orders: 815 KB for 430 orders). Paging it means redesigning that screen.

Security and robustness:
- [ ] A customer's logout is still only client-side (their 7-day token stays valid until it expires or they change their password). Admin logout, password change/reset, deletion and demotion are enforced on the server.
- [ ] Stock can be locked by bots: public `POST /api/orders` takes stock at creation, has no CAPTCHA, and pending orders never expire (limiter is in memory, 10/min per IP).
- [ ] Registration answers "an account with this e-mail / phone already exists" (409), which reveals who has an account.
- [ ] No rate limit on `POST /api/favourites/toggle` (contact, reviews and cart additions are limited now).
- [ ] **Customer data is still on GitHub.** `server/data/orders.json` (3 customers) and `reviews.json` (2 e-mails) were deleted from the working folder, but the version on GitHub (and its history since commit 43fa1c3) still contains them. Make the GitHub repository private today; if it was ever public, treat those people's e-mails and phone numbers as exposed. Purging the history needs a history rewrite and a force push (not done).
- [ ] Run the server under a process manager or the host's restart policy (pm2, systemd, Render/Railway "restart on crash"), so it starts again after a crash. The code now logs stray errors and exits with code 1 on an uncaught exception.
- [ ] Small: unknown `/api/...` URLs answer an HTML error page, not JSON; malformed JSON returns the parser's English text; `drizzle-kit` (a dev tool) is in production dependencies and brings a vulnerable `esbuild`; `multer` 1.x is deprecated (check 2.x); 5 foreign keys without an index (`admin_notifications`, `contact_messages`, `idempotency_keys`, `draft_conversions`); no retention or cleanup for old carts, reset tokens, notifications or customer personal data (INPDP).

Cloudflare Workers (measured 2026-11-04, `wrangler dev` on the production build, whole-`workerd` CPU, so an upper estimate):
- [ ] Free plan allows 10 ms CPU per request, and the old server-rendered product page measured 17 ms (2026-11-04). The public pages are now static files (no Worker, no CPU); only `/admin`, `/password-reset/<token>`, old-address redirects and 404s run the Worker. Check their CPU time in the Cloudflare dashboard after a few days.
