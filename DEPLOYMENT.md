# Silky: deployment guide

How to put the shop on a real server, keep it running, and get back to a working state when something goes wrong.
What is still to decide or check before going live is in `PRE_PRODUCTION.md`; this file is the how-to.

Everything below was tried on a scratch database. The commands that touch a database only ever read, or work on a
**new, empty** database, except where a step says otherwise.

## 1. Decisions to make first

| Decision | Recommendation | Why |
|---|---|---|
| Where the server runs | A platform that runs a Node server, restarts it after a crash and gives HTTPS on your domain (Render, Railway, Fly.io...). A VPS works too but you then run the restart policy, HTTPS and updates yourself. | The app exits on an unexpected error and relies on the host to start it again. |
| Database | **Managed PostgreSQL** from the same provider (version 14 or newer; local development uses 17). Not the same database as local. | Daily backups, visible connection limit, private network. |
| Uploaded photos and videos | A **persistent disk / volume** mounted into the server, path given in `UPLOADS_DIR`. | Product photos live on disk, not in the database. The default folder is inside the app and most hosts erase it on every deploy. |
| Backups | The provider's automatic daily backup **plus** a copy kept somewhere else (another provider or account). | A backup stored only next to the server does not survive losing the server or the account. |
| Node version | 20 or newer (24 locally). | `nodemailer` 10 needs it. |

Build command on the API host (root directory `server/`): `npm ci` (the API serves no pages since Phase 3 step 2; the storefront and admin panel are built from `storefront/` with `npm run build` and deployed on Cloudflare, see `MIGRATION_PLAN_ASTRO.md` phases 6 and 7).
Start command: `npm start`. Health check path (if the host asks): **`/ping`** on Render, not `/health`: the host calls it again and again, and `/health` queries the database, which would keep the free Neon database awake all month. `/ping` answers `{"ok":true}` without any database access.

## 2. Environment variables

Set them in the host's settings, never in a committed file. Production values must differ from local ones (own
database and password, own `JWT_SECRET`, own admin password, own SMTP and GOODEX credentials).
`server/.env.example` documents every variable. Every `npm run ...` command in this file is run inside `server/`.

**The server refuses to start in production without these**

| Variable | Notes |
|---|---|
| `NODE_ENV` | exactly `production` |
| `DATABASE_URL` | the production database; for a database on another machine add `?sslmode=require` |
| `JWT_SECRET` | random, 32+ characters |
| `ADMIN_PASSWORD` | 10+ characters, not a placeholder |
| `CORS_ALLOWED_ORIGINS` | `https://your-domain` (comma-separated exact origins) |

**Needed for the shop to work properly** (the server starts without them but part of the shop does not)

| Variable | Notes |
|---|---|
| `ADMIN_EMAIL` | the admin account e-mail (default `admin@silky.tn`) |
| `APP_URL` | `https://your-domain`: used in password-reset e-mails |
| `TRUST_PROXY` | `1` behind one reverse proxy (most hosts). Without it every visitor looks like one address to the rate limiters |
| `RESEND_API_KEY`, `EMAIL_FROM` (and optional `EMAIL_REPLY_TO`) | e-mail over HTTPS through Resend: required on Render's free plan, which blocks the SMTP ports. `EMAIL_FROM` must be an address on a domain verified in Resend (add the DNS records it shows; until then it only sends from `onboarding@resend.dev` to your own address). Free plan: 3000 e-mails a month, 100 a day |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | SMTP alternative, used only when `RESEND_API_KEY` is not set. Without either, no e-mail is sent in production |
| `UPLOADS_DIR` | path of the persistent disk |
| `GOODEX_API_TOKEN`, `GOODEX_USER_ID`, `GOODEX_WEBHOOK_SECRET`, `GOODEX_ENABLE_LIVE=true` | parcels and tracking; the webhook secret must differ from the API token |

**Optional**

| Variable | Default | Notes |
|---|---|---|
| `CSP_MODE` | `report-only` | switch to `enforce` only after browsing the live site with the browser console open and seeing no "[Report Only] Refused" message |
| `LOG_REQUESTS` | on in production | one log line per request, no personal data; `false` turns it off |
| `DB_POOL_MAX` | `10` | keep it below the database plan's connection limit |
| `DB_CONNECTION_TIMEOUT_MS` | `30000` | how long a request waits for the database |
| `DB_STATEMENT_TIMEOUT_MS` | none | maximum run time of one query |
| `GOODEX_POLL_INTERVAL_MINUTES` | off | e.g. `15` to follow parcel statuses automatically; enable on ONE instance only |
| `ALLOW_ORDER_RESET` | never set | see section 8: do not set it |

## 3. First deploy, step by step

Do it once, in this order. Use a staging copy first if you can (a second database and a second service).

1. **Create the database** (empty) at the provider and copy its connection URL into `DATABASE_URL`.
   - **Neon (the chosen provider)**: project `silky`, PostgreSQL 17, region AWS Europe Central 1 (Frankfurt), database
     `neondb`. Use the **direct** connection string (no `-pooler` in the host): the API keeps its own connection pool and
     sends `statement_timeout`, which the pooled (PgBouncer) string does not accept. End the URL with `?sslmode=verify-full`
     (`sslmode=require` works too but prints a `pg` security warning, because `require` is treated as `verify-full`; never
     disable certificate checks).
   - **Free plan limits** (checked 2026-11-06 on neon.com/pricing): 1 GB storage and 100 compute-unit hours a month per
     project. The database suspends itself after about 5 minutes without queries and wakes on the next one (the first
     request after a sleep is a fraction of a second slower). Do not keep it awake: point an uptime monitor at a path that
     does not query the database (`GET /health` does query it), or ping `/health` rarely, and keep the GOODEX background
     poll (`GOODEX_POLL_INTERVAL_MINUTES`) off or at a long interval. Check the numbers again before going live.
   - **How the data got there** (Phase 5, 2026-11-06): the schema and the 24 governorates, 2 categories, site settings and
     the admin row were restored from a cleaned local copy (`pg_dump --format=custom --no-owner --no-acl`, then
     `pg_restore --no-owner --no-acl --dbname <direct url>`). Row counts of all 31 tables, indexes, constraints and columns
     matched; `npm run preflight` against Neon had no FAIL; the API started against it and the admin login worked.
     Products, orders and customers are created fresh on the live shop.
2. **Set all environment variables** (section 2) on the host.
3. **Build and start once** with the commands in section 1 so the code is on the host.
4. **Create the tables** (only ever on an empty database; it refuses otherwise):
   `npm run db:init`
5. **Start the server once** (`npm start`). Its start-up migrations fill the 24 governorates and bring the schema up to
   date. The log ends with `Silky API running on ...`.
6. **Create the admin account** (adds one row and nothing else): `npm run admin:create`
7. **Run the pre-launch check**: `npm run preflight`. It reads the configuration, the files and the database, sends
   nothing and prints no secret. Every `[FAIL]` must be fixed. Read each `[WARN]`: on a first deploy some are expected
   (for example GOODEX not configured yet), the others are real.
8. **Domain and HTTPS**: point the domain at the host, make sure HTTP redirects to HTTPS (a host setting), then open
   `https://your-domain/health`: it must answer `{"status":"ok"}`.
9. **Content**: log in to `/admin`, create the real categories and products (real names, descriptions, photos). Check the
   product addresses (`/product/<slug>`) read well. Nothing from development is copied over.
10. **GOODEX**: in the GOODEX customer area enter `https://your-domain/api/webhooks/goodex` and the secret from
    `GOODEX_WEBHOOK_SECRET`, then use their "Envoyer un appel de test" button.
11. **Walk through the live site** with the browser console open: storefront in French and Arabic, a product, cart,
    checkout with a real test order, a password-reset e-mail, an admin order confirmation, an order PDF, a photo upload.
    No red error and no "[Report Only] Refused" message. Then set `CSP_MODE=enforce` and repeat the walk-through.
12. **Search engines**: submit `https://your-domain/sitemap.xml` in Google Search Console, run the Rich Results Test on a
    product.
13. **Backups and monitoring** (sections 4 and 6) before the first real customer.

## 4. Backups

- **Database**: turn on the provider's automatic daily backups. In addition, once a week copy a dump to another
  provider or account:
  `pg_dump --format=custom --no-owner --file=silky-$(date +%F).dump "$DATABASE_URL"`
- **Uploads**: back up the `UPLOADS_DIR` folder the same way (copy to object storage or another machine). A restored
  database whose photos are gone shows broken images.
- **Neon**: the plan's point-in-time restore is the daily safety net (check how far back the plan in use goes; the free
  plan's window is short). Use a `pg_dump` of version 17 or newer for the weekly copy (an older `pg_dump` refuses a newer
  server). Run it against the **direct** URL.
- **Keep** at least 7 daily and 4 weekly copies.
- **Test a restore before launch, then every few months**:
  1. create a throwaway database: `createdb silky_restore_check`
  2. restore into it: `pg_restore --no-owner --dbname=silky_restore_check silky-DATE.dump`
  3. run `DATABASE_URL=<url of silky_restore_check> npm run preflight` and compare its `data:` line (customers, products,
     orders) with the live site's
  4. drop the throwaway database.
  Never restore an old backup **into** the live database without reading section 8.

## 5. Routine deploy

1. Take a backup (or confirm last night's exists).
2. Deploy the new version (the host builds with the command in section 1).
3. Watch the log: it must end with `Silky API running on ...` and show no `Migration failed`.
4. `npm run preflight` and `https://your-domain/health`.
5. Click through login, a product, the cart and the admin orders page.

## 6. Monitoring, logging and restarts

- **Uptime**: create a free monitor (UptimeRobot or similar) with alerts to your phone or e-mail. On the free Render and Neon plans point it at `/ping` (no database access, see "Keeping the free API awake" below), or at `/health` with a long interval such as one hour. `/health` answers 200 only while the database answers within 3 seconds, 503 otherwise; checking it every few minutes keeps Neon awake and uses up its 100 free compute-hours.
- **Logs**: the server writes to standard output; the host keeps it. One line per request
  (`[http] GET /api/products 200 12ms`), plus error lines (`[db]`, `[process]`, `[health]`, `[server error]`). Query strings,
  bodies and IP addresses are never logged. Set the host's log retention and, if it offers one, an alert on `[process]`.
- **Crashes**: on an unexpected error the server logs `[process] Uncaught exception, exiting` and stops with code 1.
  The host must start it again: use the platform's "restart on crash" policy, or on a VPS a process manager
  (`pm2 start npm --name silky -- start`, or a systemd unit with `Restart=always`).
- **Database down**: the server keeps running and requests fail after the wait time; `/health` goes 503 and your monitor
  alerts you. It recovers by itself when the database returns.

### Keeping the free API awake (Render free plan)

A free Render web service goes to sleep after 15 minutes without a request and takes about a minute to wake up. To avoid that during the day, a small Cloudflare Worker (`server/keepalive/`, its own `package.json`, imports nothing from the API) calls `GET /ping` every 10 minutes **from 07:00 to midnight, Tunis time**; at night the API may sleep. The hours are decided in the Worker's code in the shop's time zone (`KEEPALIVE_FROM_HOUR`, `KEEPALIVE_TO_HOUR`, `KEEPALIVE_TIMEZONE` in `server/keepalive/wrangler.jsonc`), because Cloudflare cron triggers are always in UTC.

Deploy it once the API answers on its public address: set `PING_URL` in `server/keepalive/wrangler.jsonc` if the address is not `https://api.silky.tn/ping`, then `cd server/keepalive && npm ci && npm run deploy`. Check in the Cloudflare dashboard (Workers, silky-keepalive, Logs) that a `[keepalive] ping ok` line appears every 10 minutes inside the window and `skipped` lines outside it. Test (no network): `node server/scripts/test_ping_keepalive.js`.

Render's free plan limits that matter for Silky (from Render's documentation, checked 2026-11-07; re-check before going live):

- 750 free instance hours a month for the whole workspace, used only while the service runs. Awake 17 hours a day is about 527 hours a month; even 24 hours a day (744 h) would just fit, but only if Silky is the only free service of that workspace. Past the limit Render suspends the service until the next month.
- The filesystem is erased on every restart, redeploy and sleep: uploads must use `STORAGE_DRIVER=r2`, never `disk`.
- Outbound ports 25, 465 and 587 are blocked: e-mail goes through Resend over HTTPS (`RESEND_API_KEY`).
- No shell, SSH or one-off jobs: run `db:init`, `admin:create`, `preflight` and `uploads:copy-to-r2` from your own computer with the production environment variables.
- Render may restart the service at any time: what the API keeps only in memory (rate-limit counters, the GOODEX failure back-off, the claim-types cache) starts again from empty.
- Traffic the service starts itself (Neon, R2, GOODEX, Resend) counts as "service-initiated traffic"; an uncommonly high volume can get the service suspended. A small shop is far below it; large video uploads to R2 are the heaviest part.
- Since 2026-11-10 the keep-awake window is 24 hours a day (`KEEPALIVE_FROM_HOUR=0`, `KEEPALIVE_TO_HOUR=24` in `server/keepalive/wrangler.jsonc`): about 744 instance hours in a 31-day month, under the 750 free hours, so no margin for any other free Render service in the workspace (watch Render's hours counter). To go back to sleeping at night set `KEEPALIVE_FROM_HOUR` to `7`. If the API is asleep for any reason, the first request waits about a minute. GOODEX webhooks are not used: delivery statuses come from the background poll (`GOODEX_POLL_INTERVAL_MINUTES`, off by default) and the manual refresh, and the poll only runs while the API is awake.

## 7. Rollback

- **Code**: redeploy the previous version (the host's "rollback" button, or deploy the previous git commit). Tag every
  deployed commit (`git tag deploy-2026-11-03`) so you can find it. The newest migrations only add columns, so older code
  keeps working with a database that has the extra column.
- **Data**: only restore a backup if data was damaged, and only into a **new** database that you then switch to (section 4).
  Check it with `npm run preflight` before switching.

## 8. Things never to do on the live shop

- `npm run db:seed`: it empties users, orders and products.
- `npm run db:push`, `npm run db:generate`: the drizzle files are stale; schema changes go through `server/db/migrations`.
- Setting `ALLOW_ORDER_RESET`: one old start-up migration deletes **all orders** when `orders.governorate_id` is missing
  (for example after restoring a very old backup). It now refuses unless this variable is `yes`. If the server stops at
  start with `Refusing to delete N order(s)`, restore a newer backup instead.
- Running the server on your own computer against the production database, or with `GOODEX_ENABLE_LIVE=true` while
  testing: real parcels would be created.
- Copying the development database to production: it contains test products, test accounts and test orders.

## 9. When the server does not start

| Message | Meaning and fix |
|---|---|
| `NODE_ENV must be "production", "development" or "test"` | set `NODE_ENV=production` exactly |
| `JWT_SECRET must be set` / `...insecure or default` | set a random `JWT_SECRET` of 32+ characters |
| `ADMIN_PASSWORD ...` | set one of 10+ characters that is not a placeholder |
| `CORS_ALLOWED_ORIGINS must be set` | set it to `https://your-domain` |
| `DATABASE_URL must be set` | set the production database URL |
| `Failed to start server: ... ECONNREFUSED` or `password authentication failed` | wrong host, port, user, password, or the database is not reachable from the server |
| `relation "..." does not exist` | the database is empty: `npm run db:init`, then start again |
| `Refusing to delete N order(s)` | see section 8 |
| the site answers but `/admin` login says "Admin account not configured" | `npm run admin:create` |
| photos disappear after a deploy | `UPLOADS_DIR` is not on a persistent disk |

## 10. Command reference

| Command | What it does | Touches data? |
|---|---|---|
| `npm run build` | builds the Astro storefront and admin panel (`storefront/`) | no |
| `npm start` | starts the server (runs start-up migrations) | adds missing columns/tables only |
| `npm run preflight` | checks configuration, files and database; prints OK / WARN / FAIL | reads only |
| `npm run db:init` | creates all tables in a new empty database | refuses a non-empty database |
| `npm run admin:create` | adds the admin account | adds one row; changes nothing else |
| `npm run db:export-schema` | rewrites `server/db/schema.sql` from the database in `DATABASE_URL` (run after adding a migration, from the test database) | reads only |
| `node server/scripts/test_deploy_readiness.js` | tests all of the above on a scratch database | `silky_test` only |
| `node server/scripts/test_security_audit.js` | security regression tests | `silky_test` only |
