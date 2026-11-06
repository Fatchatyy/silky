# Silky

Online clothes shop for Tunisia: an Express + Postgres API (`server/`), an Astro storefront with the admin panel
(`storefront/`). The old React + Vite app was removed at the end of Phase 3.
The migration plan and its status are in `MIGRATION_PLAN_ASTRO.md`; the business rules are in `CLAUDE.md`.

## Prerequisites

[Node.js](https://nodejs.org/) 22 or newer (24 locally) and a local PostgreSQL.

## Setup (first time)

The two apps are independent projects, each with its own `package.json`, `node_modules` and `.env`:

```bash
cd server && npm install && cp .env.example .env && cd ..
cd storefront && npm install && cp .env.example .env && cd ..
```

Fill in `server/.env` (API settings, database). `CORS_ALLOWED_ORIGINS` must list the places the browser calls the
API from: `http://localhost:4321` (storefront and admin).

## Start everything

Two terminals, one per app:

```bash
cd server && npm run dev
```

```bash
cd storefront && npm run dev
```

| App | What | Address |
|---|---|---|
| `server/` | Express API | http://localhost:3001 |
| `storefront/` | Astro storefront **and admin panel** | http://localhost:4321 (admin: http://localhost:4321/admin) |

The apps only talk over HTTP (the storefront calls the API at `API_URL` / `PUBLIC_API_URL`); neither imports the other's files.

## The admin panel

The admin panel is part of the Astro project: **http://localhost:4321/admin** (login at `/admin/login`). It is one client-side
island (`storefront/src/admin-app/`) with React Router (`basename="/admin"`). It shares the login of the shop: it is the same
origin and the same `localStorage` keys (`silky_auth_token`, `silky_auth_user`), so signing in at `/admin/login` makes you an
admin on the shop pages too (inline product editor, review moderation, hidden products), and signing out in either place
signs you out of both.

The admin is not a page of the site: `noindex` (meta tag and `X-Robots-Tag`), never cached, not in `sitemap.xml`, `Disallow`ed
in `robots.txt`. Visitors never download admin code.

More details (configuration, tests, test data): `storefront/README.md`.

## Build

```bash
cd storefront && npm run build
```

builds the storefront and the admin panel. The API has no build step.

## Project structure

```
silky-app/
├── server/        Express API: its own package.json, node_modules, .env, drizzle config, assets (e-mail logo), uploads
│   ├── (routes -> controllers -> services -> repositories -> models), db/ migrations, scripts/ (tests, preflight)
│   └── shared/    pure modules (copy; see below)
├── storefront/    Astro project: the shop (French + /ar) and the admin panel at /admin, its own package.json and .env
│   ├── src/
│   │   ├── pages/ views/ components/ islands/   the shop
│   │   ├── admin/        admin tools shared by the shop pages and the panel (API wrapper, product editor, review moderation)
│   │   └── admin-app/    the admin panel (dashboard, orders, products, claims ...)
│   └── shared/    pure modules (copy; see below)
├── integration/   checks and test helpers that need both apps (neither app imports from here)
└── docs/          archive of old project notes
```

`shared/` (prices, delivery fee, locales, texts, URLs, stock rules) exists **twice**, once per app, so each deploys on its own.
The copies must stay identical: `node integration/check_shared_in_sync.mjs`. That no app uses the other's files:
`node integration/check_independence.mjs`.
```
