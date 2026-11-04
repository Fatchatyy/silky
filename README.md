# Silky

Online clothes shop for Tunisia: an Express + Postgres API (`server/`), an Astro storefront with the admin panel
(`storefront/`), and, until the migration ends, the old React + Vite app (`src/`).
The migration plan and its status are in `MIGRATION_PLAN_ASTRO.md`; the business rules are in `CLAUDE.md`.

## Prerequisites

[Node.js](https://nodejs.org/) 22 or newer (24 locally) and a local PostgreSQL.

## Setup (first time)

```bash
npm install
cd storefront && npm install && cp .env.example .env && cd ..
```

Copy `.env.example` to `.env` (API settings, database). `CORS_ALLOWED_ORIGINS` must list the places the browser calls the
API from: `http://localhost:4321` (storefront and admin) and, while the old app still runs, `http://localhost:5173`.

## Start everything

```bash
npm run dev
```

It starts three processes with `concurrently`, each with its own colour and label in the terminal:

| Label | What | Address |
|---|---|---|
| `api` | Express API (`server/`) | http://localhost:3001 |
| `shop` | Astro storefront **and admin panel** (`storefront/`) | http://localhost:4321 (admin: http://localhost:4321/admin) |
| `old` | the old React + Vite app (`src/`), kept only until the migration step that removes it | http://localhost:5173 |

You can also start them one by one: `npm run dev:server`, `npm run dev:storefront`, `npm run dev:client`.

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
npm run build
```

builds the old Vite app (the storefront is built with `npm run build` inside `storefront/`).

## Project structure

```
silky-app/
├── server/        Express API (routes -> controllers -> services -> repositories -> models), scripts, migrations
├── shared/        pure modules used by the API and every front end (texts, prices, URLs, media helper)
├── storefront/    Astro project: the shop (French + /ar) and the admin panel at /admin
│   └── src/
│       ├── pages/ views/ components/ islands/   the shop
│       ├── admin/        admin tools shared by the shop pages and the panel (API wrapper, product editor, review moderation)
│       └── admin-app/    the admin panel (dashboard, orders, products, claims ...)
└── src/           the old Vite app (to be removed at the end of Phase 3, see the plan)
```
