# Clientèle Prompt A — Persistent Checkpoint

This file is the persistent working memory for the Clientèle planning audit.

IMPORTANT: This is a PLANNING-ONLY task.
The checkpoint file is the SOLE approved exception to the Prompt A rule that says "Do not modify files."
All other application files must remain unchanged.

---

## Status

Current phase: Phase 8 — FINAL SYNTHESIS COMPLETE
Current step: All phases done — full blueprint produced
Overall progress: 100% COMPLETE
Last updated: 2026-09-06T08:05

---

## Progress State

Phase 1 — Initial architecture: DONE
Phase 2 — Identity/auth/guest-session audit: DONE
Phase 3 — Orders/drafts/exchange/refund audit: DONE
Phase 4 — Analytics/event instrumentation audit: DONE
Phase 5 — Existing admin/UI component audit: DONE
Phase 6 — Database architecture design: DONE
Phase 7 — Security/data-quality analysis: DONE
Phase 8 — Final synthesis: DONE

---

## COMPLETE VERIFIED DATABASE SCHEMA (Post-Prompt-0)

### users
- id UUID PK, email VARCHAR(255) NULLABLE UNIQUE, password_hash NOT NULL
- role enum('customer','admin') DEFAULT 'customer', full_name NOT NULL, phone_number VARCHAR(32) NULLABLE UNIQUE
- created_at, updated_at TIMESTAMPTZ
- POST PROMPT-0: CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
- NO first_touch_source column exists

### orders
- id, order_number UNIQUE, user_id FK→users SET NULL NULLABLE, guest_session_id UUID NULLABLE
- customer_name NOT NULL, customer_email NULLABLE, customer_phone NOT NULL
- shipping_address, subtotal, delivery_fee, total_amount NUMERIC
- status enum('pending','processing','completed','cancelled','exchanged','refunded')
- created_at, updated_at
- NO order_source column (DROPPED by remove_order_source.js)
- Admin/manual orders CAN have BOTH user_id=NULL AND guest_session_id=NULL

### order_exchanges
- payment_responsibility VARCHAR(32) CHECK IN ('customer_paid','silky_paid') DEFAULT 'customer_paid'
- exchange_sequence INTEGER tracks chronological order per order
- customer_email NULLABLE

### order_refunds
- payment_responsibility VARCHAR(32) CHECK IN ('customer_paid','silky_paid')
- refund_amount NUMERIC, delivery_fee NUMERIC DEFAULT 8.000, carrier_cost NUMERIC DEFAULT 7.000
- customer_email NULLABLE

### drafts
- id, customer_name, phone_number, customer_email, governorate, shipping_address, delivery_fee, notes
- converted_at, converted_order_id FK→orders SET NULL
- NO user_id column, NO guest_session_id column
- Drafts are ADMIN-ONLY entities with no browser identity

### draft_conversions (journal table)
- draft_id PK FK→drafts, order_id FK→orders CASCADE, created_at

### carts
- CHECK (user_id IS NOT NULL OR guest_session_id IS NOT NULL)
- UNIQUE INDEX on user_id WHERE NOT NULL

### favourites
- CHECK (user_id IS NOT NULL OR guest_session_id IS NOT NULL)

### idempotency_keys
- CHECK: EXACTLY ONE of user_id or guest_session_id must be set (mutually exclusive)

### reviews (POST PROMPT-0)
- guest_session_id UUID NULLABLE (partial index)
- email VARCHAR(255) NULLABLE

### store_reviews (POST PROMPT-0)
- user_id UUID FK→users SET NULL NULLABLE (partial index)
- guest_session_id UUID NULLABLE (partial index)
- email VARCHAR(255) DEFAULT '' NOT NULL (legacy field preserved)

### contact_messages (POST PROMPT-0)
- guest_session_id UUID NULLABLE (partial index)

### site_settings (POST MIGRATIONS)
- announcements TEXT, announcements_hidden BOOL (add_announcements.js)
- hero_config TEXT (add_hero_config.js)

### NOT YET EXISTING: guest_profiles, guest_profile_sessions, visit_sessions, analytics_events, identity_links, user_first_touch

---

## Identity Architecture — CONFIRMED

- Layer 1: users.id — registered identity
- Layer 2: guest_session_id — long-lived 365-day cookie UUID, set by guestSession.js (FROZEN)
  - Source: cookie 'guestSessionCookieName' OR header 'X-Guest-Session-ID'
  - If absent: crypto.randomUUID() generated
  - Set on ALL requests as req.guestSessionId
  - NOT a DB entity — no canonical guest_sessions table
  - guestSession.js always refreshes cookie AND echoes header
- Layer 3: guest_profiles (TO BE CREATED)
- Layer 4: visit_sessions (TO BE CREATED)

## Auth Flow — CONFIRMED

- registerUser: identify by email OR phone → create user → mergeGuestSessionIntoUser in TX → JWT
- loginUser: verify bcrypt → mergeGuestSessionIntoUser in TX → JWT
- adminPanelLogin: password check env.adminPassword → find admin by env.adminEmail → JWT (NO guest merge)
- shopper.js: if req.user.id → userId; else guestSessionId (frozen, mutually exclusive)

---

## Analytics Findings — CONFIRMED

- analytics.repository.js (629 lines): FINANCIAL analytics only (revenue/delivery/KPI/top products)
- sourcePromise = Promise.resolve({ rows: [] }) — this is a STUB because order_source was REMOVED
- NO behavioral analytics exist: no page_view, no product_view, no cart events, no session tracking
- NO UTM/referrer capture, NO device tracking, NO analytics_events table

---

## Admin UI Architecture — CONFIRMED CRITICAL FINDING

- AdminDashboard.jsx is the SINGLE admin route at /admin
- Navigation is TAB-BASED with internal state: const [tab, setTab] = useState('analytics')
- NAV_SECTIONS array drives sidebar: Catalogue, Ventes, Service clients, Paramètres
- Each page component renders conditionally: {tab === 'orders' && <AdminOrders />}
- NOT React Router nested routes — the prompt's /admin/clientele/* are aspirational, not the current pattern
- Clientèle MUST be added as a new NAV_SECTION in NAV_SECTIONS, not separate routes

### Admin route guard:
- const admin = [authMiddleware, adminMiddleware]
- authMiddleware: JWT verification → sets req.user
- adminMiddleware: checks req.user.role === 'admin'

### AdminOrders.jsx (1038 lines):
- Order card is rendered INLINE in AdminOrders — NOT an extractable separate component
- Props: refreshKey, onOrderCreated, highlightOrderId
- Contains full search + filter + sort + pagination + card render

### AdminAnalyticsCharts.jsx (30,685 bytes): large chart component for reuse

---

## Previous-Audit Mismatches — COMPLETE LIST

1. order_source column — DROPPED (migration removed it). sourcePromise is stub.
2. BuyNowModal — is src/components/BuyNowModal.jsx, NOT inline in Product.jsx
3. Admin routing — TAB-BASED not React Router nested routes
4. analytics.repository.js — FINANCIAL analytics, not behavioral
5. Drafts — NO identity fields at all; draft-converted orders are NULL/NULL
6. guest_sessions table — does NOT exist; Option A confirmed

---

## New Tables Design

### guest_profiles
- id UUID PK, email VARCHAR(255) NULLABLE, phone VARCHAR(32) NULLABLE
- display_name VARCHAR(255) NULLABLE, created_at, updated_at
- CHECK (email IS NOT NULL OR phone IS NOT NULL)
- UNIQUE INDEX LOWER(email) WHERE NOT NULL; UNIQUE INDEX phone WHERE NOT NULL

### guest_profile_sessions
- id UUID PK, guest_profile_id UUID FK→guest_profiles CASCADE NOT NULL
- guest_session_id UUID NOT NULL, linked_at TIMESTAMPTZ, link_source VARCHAR(64)
- UNIQUE(guest_session_id) — one session maps to one profile only

### visit_sessions
- id UUID PK, user_id FK→users SET NULL NULLABLE, guest_session_id UUID NULLABLE
- started_at, last_activity_at, ended_at NULLABLE, page_count INT DEFAULT 0
- traffic_source VARCHAR(64) NULLABLE, referrer_url TEXT NULLABLE
- user_agent TEXT NULLABLE, device_type VARCHAR(16) CHECK IN ('mobile','tablet','desktop','unknown')
- CHECK (user_id IS NOT NULL OR guest_session_id IS NOT NULL)

### analytics_events
- id UUID PK, event_type VARCHAR(64) NOT NULL
- user_id FK→users SET NULL NULLABLE, guest_session_id UUID NULLABLE
- visit_session_id FK→visit_sessions SET NULL NULLABLE
- product_id FK→products SET NULL NULLABLE, variant_id FK→product_variants SET NULL NULLABLE
- order_id FK→orders SET NULL NULLABLE, quantity INT NULLABLE, value NUMERIC NULLABLE
- page_url TEXT NULLABLE, metadata JSONB NULLABLE
- client_idempotency_key VARCHAR(128) NULLABLE
- created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
- CHECK (user_id IS NOT NULL OR guest_session_id IS NOT NULL)
- UNIQUE INDEX (event_type, client_idempotency_key) WHERE client_idempotency_key IS NOT NULL

### identity_links
- id UUID PK, user_id UUID NOT NULL FK→users CASCADE
- guest_session_id UUID NOT NULL, linked_at TIMESTAMPTZ, link_source VARCHAR(64)
- UNIQUE(user_id, guest_session_id)

### user_first_touch
- user_id UUID PK FK→users CASCADE (immutable — one record per user, never updated)
- first_visit_session_id FK→visit_sessions SET NULL NULLABLE
- registration_visit_session_id FK→visit_sessions SET NULL NULLABLE
- first_touch_source VARCHAR(64) NULLABLE, first_touch_at TIMESTAMPTZ NULLABLE
- registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

## Files That Must Remain Frozen — CONFIRMED
- server/middleware/guestSession.js (frozen)
- server/utils/shopper.js (frozen)
- server/repositories/order.repository.js (frozen)
- server/services/order.service.js (frozen)
- server/services/exchange.service.js (frozen)
- server/repositories/refund.repository.js (frozen)
- server/repositories/cart.repository.js (frozen)
- src/context/CartContext.jsx (frozen)
- src/context/FavoritesContext.jsx (frozen)
- src/context/AuthContext.jsx (frozen)

---

## Important Warnings
1. order_source column does NOT exist — dropped by migration
2. Admin dashboard is TAB-BASED — Clientèle must be a NAV_SECTION with tab items
3. guest_session_id is NOT a DB entity — no canonical guest_sessions table
4. Drafts have NO identity — draft orders are always "Non attribué"
5. analytics.repository.js is FINANCIAL analytics only — keep frozen
6. AdminOrders order card is NOT an extractable separate component
7. payment_responsibility: 'customer_paid' or 'silky_paid' only (semantic, not monetary)
8. Admin/manual orders: both NULL → "Non attribué" in Clientèle
9. idempotency_keys: EXACTLY ONE of user_id or guest_session_id (mutually exclusive)
10. Admin login is separate path (env.adminPassword) — NO guest session merge at admin login


---

## Status

Current phase: Phase 1 — Initial architecture/schema inspection
Current step: Reading schema, migrations, directory structure
Overall progress: 15% — Phase 1 active
Last updated: 2026-09-06T07:56 (session start)

---

## Progress State

Phase 1 — Initial architecture: IN PROGRESS
Phase 2 — Identity/auth/guest-session audit: PENDING
Phase 3 — Orders/drafts/exchange/refund audit: PENDING
Phase 4 — Analytics/event instrumentation audit: PENDING
Phase 5 — Existing admin/UI component audit: PENDING
Phase 6 — Database architecture design: PENDING
Phase 7 — Security/data-quality analysis: PENDING
Phase 8 — Final synthesis: PENDING

---

## Confirmed Findings

### Pre-Prompt-0 Implementation (VERIFIED — Prompt 0 done)
- `reviews` table now has: `guest_session_id UUID`, `email VARCHAR(255)` (nullable) — ADDED by migration
- `store_reviews` table now has: `user_id UUID` (FK→users ON DELETE SET NULL), `guest_session_id UUID` — ADDED by migration
- `contact_messages` table now has: `guest_session_id UUID` — ADDED by migration
- `users` table has: `CHECK (email IS NOT NULL OR phone_number IS NOT NULL)` — ADDED by migration
- Guest cart is deleted after merge (guestMerge.service.js fix applied)
- Checkout email field removed from Checkout.jsx and BuyNowModal.jsx
- Account.jsx frontend validation for email/phone added
- All 30/30 verification assertions passed

### Initial Codebase Structure (from package.json and top-level):
- Node.js ESM, Express backend, React/Vite frontend
- Drizzle ORM with PostgreSQL
- Custom migration runner (not Drizzle's built-in migrate command — manually runs idempotent JS migration files)
- Migration pattern: idempotent JS files registered in server/index.js startup pipeline

---

## Findings Requiring Further Inspection

- Exact current schema for all tables (need to read the full initial migration + all subsequent migrations)
- Drafts table: schema, columns, converted_order_id relationship
- Exchange/refund exact columns and payment-type fields
- Admin sidebar architecture (exact component and routing)
- Order card/row exact reusable component path
- Whether any analytics instrumentation already exists
- Whether user-agent / device type is currently captured anywhere
- Whether UTM/referrer is currently captured anywhere
- Whether order_source column still exists (migration removed it per Prompt 0 walkthrough)
- Exact admin middleware / auth guard used for admin routes

---

## Previous-Audit Mismatches

### MISMATCH 1 — order_source column
- Previous audit assumption: `orders` table has `order_source` column
- Reality: `remove_order_source.js` migration was applied. Column removed.
- Impact on Clientèle: Cannot use order_source for traffic attribution. Need to design alternative.

### MISMATCH 2 — BuyNowModal lives in components/, not Product.jsx inline
- Previous audit found Buy Now form inside Product.jsx
- Reality: Buy Now is a separate component: `src/components/BuyNowModal.jsx`
- Impact: Clientèle buy-now analytics events must instrument BuyNowModal.jsx, not Product.jsx

---

## Database Findings

### Confirmed tables from initial migration + Prompt 0 migrations:
(Full schema details to be filled after Phase 1 inspection)

KNOWN TABLES (partial, to be verified):
- users
- password_resets
- products
- product_variants
- product_colors
- product_images (or similar)
- product_videos (migration confirmed)
- carts
- cart_items
- favourites
- orders
- order_items
- order_exchanges (to be inspected)
- order_email_deliveries
- reviews (now has guest_session_id, email)
- store_reviews (now has user_id, guest_session_id)
- review_gallery
- contact_messages (now has guest_session_id)
- admin_notifications
- idempotency_keys
- drafts (to be inspected)

TO CONFIRM:
- refunds table (mentioned in server structure but schema unknown)
- announcements table
- hero_config table
- theme table

---

## Identity Architecture Findings

CONFIRMED POST-PROMPT-0:
- Layer 1: users.id — registered identity
- Layer 2: guest_session_id — anonymous browser identity (UUID, set by guestSession.js middleware, stored in cookie + X-Guest-Session-ID header)
- guestSession.js reads from cookie 'guestSessionId' OR header 'X-Guest-Session-ID'
- guest_session_id is NOT a DB entity — it is a cookie/localStorage value
- After login/register: cart and favourites merged, guest cart DELETED (confirmed Prompt 0 fix)
- Favourites merge already deleted guest rows before Prompt 0

NOT YET DESIGNED:
- Layer 3: guest_profiles (to be planned)
- Layer 4: visit_sessions (to be planned)
- identity_links table (to be planned)
- user_first_touch table (to be planned)

---

## Guest Profile Findings

NOT YET INSPECTED — Phase 2 task.

Voluntarily-identified guest profiles will be linked via:
- email (normalized: trim, lowercase)
- phone (normalized: strip +216/216/spaces/punctuation)

Multiple guest sessions per profile via: guest_profile_sessions table (to be designed)

---

## Visit Session Findings

NOT YET INSPECTED.

Visit session (30-min inactivity window) is distinct from guest_session_id.
guest_session_id = long-lived browser identity (can persist months)
visit_session_id = short-lived behavioral session (expires after 30min inactivity)

---

## Analytics Findings

NOT YET INSPECTED.

NO existing analytics instrumentation found yet (to be confirmed).
order_source column was REMOVED (remove_order_source.js migration applied).

---

## Orders / Drafts / Exchange / Refund Findings

NOT YET INSPECTED IN DETAIL.

Known:
- orders table exists with user_id (nullable), guest_session_id (nullable), customer_email (nullable — NOT REMOVED)
- order_email_deliveries table exists
- exchange table exists (referenced in migration list)
- refund table exists (referenced in migration list, separate file)
- draft model exists (server/models/draft.model.js confirmed in git status)

CRITICAL: Admin/manual orders can have user_id=NULL, guest_session_id=NULL — must be flagged as "Unattributed" in Clientèle.

---

## Existing Components To Reuse

NOT YET INSPECTED IN DETAIL.

Known to exist (from git status):
- src/pages/admin/AdminOrders.jsx — order list
- src/pages/admin/AdminDashboard.jsx
- src/pages/admin/AdminMessages.jsx
- src/pages/admin/AdminReviews.jsx
- src/components/admin/ — directory exists
- src/pages/admin/AdminExchangeModal.jsx
- src/pages/admin/AdminManualOrderModal.jsx

Need to identify:
- Exact reusable order card/row component
- Admin sidebar component and route structure
- Admin page layout wrapper
- Table/pagination components
- Chart components (if any)

---

## Files That Must Remain Frozen

CONFIRMED FROZEN (from Prompt 0 specifications):
- server/middleware/guestSession.js
- server/utils/shopper.js
- server/repositories/order.repository.js
- server/services/exchange.service.js
- server/repositories/refund.repository.js (if exists)
- src/context/CartContext.jsx
- src/context/FavoritesContext.jsx
- src/context/AuthContext.jsx
- src/api/client.js
- server/repositories/cart.repository.js

ADDITIONAL (business logic frozen):
- server/services/order.service.js (business calculations)
- All exchange/refund/cancellation business rule files

---

## Security Findings

NOT YET ANALYZED IN DETAIL.

Known risks to address:
- visit_session_id must be server-authoritative (not blindly trusted from client)
- Cross-user event attribution via arbitrary guest_session_id injection
- Clientèle endpoints must be admin-only
- Personal data exposure (email/phone in Clientèle views)
- User deletion effects on linked identity data

---

## Data-Quality Risks

NOT YET ANALYZED IN DETAIL.

Known risks:
- page_view duplication on refresh
- cart-add retry duplication
- checkout retry (idempotency keys exist for orders, but analytics events may not)
- login/registration transition creating duplicate events
- Multiple tabs with same guest_session_id
- Stale sessionStorage for visit sessions

---

## Production Reset Findings

NOT YET ANALYZED.

Two categories:
1. Disposable telemetry: analytics_events, visit_sessions, summaries
2. Persistent identity: guest_profiles, guest_profile_sessions, identity_links, user_first_touch

---

## Decisions Already Made

- Option A for guest_session_id architecture: keep as existing anonymous identity token, build visit_sessions around it WITHOUT creating a canonical guest_sessions table
  - Reasoning: creating a canonical guest_sessions table would require modifying guestSession.js (frozen) or a separate creation path; existing cookie/header system is already working; adding a new DB table would require backfill for all historical sessions which is impossible
  - Status: PROVISIONAL — needs to be confirmed against codebase

---

## Open Decisions

1. Whether user_first_touch needs a denormalized `first_touch_source` column on users table or can be derived from user_first_touch table JOIN
2. How to handle admin-created orders with NULL/NULL identity in analytics
3. Whether product_visits should be a SQL VIEW or materialized view
4. Exact device detection strategy (user-agent parsing library vs minimal classification)
5. Whether draft-associated contact info should create a guest_profile
6. Whether converting a draft to order should inherit the draft's guest session identity

---

## Exact Work Completed

- Read checkpoint file (empty at session start)
- Initialized checkpoint with Phase 1 status
- Confirmed Prompt 0 completion and pre-existing changes
- Identified key migration list from server/index.js

---

## Exact Work Remaining

1. PHASE 1: Read full schema (initial migration SQL + all subsequent migration files)
2. PHASE 1: Read all models in server/models/
3. PHASE 1: Read draft model in full
4. PHASE 2: Read auth service, guest session middleware, shopper utility
5. PHASE 2: Read auth routes and registration/login flows
6. PHASE 3: Read order model, order repository, exchange model, refund repository, draft service
7. PHASE 4: Check for any existing analytics in server/services/analytics.service.js
8. PHASE 5: Read admin routing, sidebar, admin layout, order card components
9. PHASE 6: Design all new tables with full schema
10. PHASE 7: Security and data quality analysis
11. PHASE 8: Final synthesis and implementation plan

---

## Last Completed Investigation

Phase 1 started — checkpoint initialized, package.json and server/index.js read.

---

## Next Investigation To Perform

Read full initial schema migration SQL file: server/db/drizzle/0000_secret_wonder_man.sql
Then read all individual migration files in server/db/migrations/
Then read all model files in server/models/

---

## Important Warnings / Do Not Assume

- order_source column NO LONGER EXISTS (was removed by migration)
- BuyNowModal is a separate component (src/components/BuyNowModal.jsx), not inline in Product.jsx
- guest_session_id is NOT a DB entity — it is a long-lived cookie/header value
- Admin/manual orders may have BOTH user_id=NULL AND guest_session_id=NULL
- Do not modify guestSession.js (frozen)
- Do not modify cart.repository.js (frozen)
- The migration runner is CUSTOM (idempotent JS files run at startup), NOT drizzle-kit migrate
- Prompt 0 fixes are CONFIRMED applied and verified (30/30 tests passed)




IMPORTANT:



This is a PLANNING-ONLY task.



The checkpoint file is the SOLE approved exception to the Prompt A rule that says "Do not modify files."



The agent may modify ONLY this checkpoint file during the audit.



All other application files, source files, database files, migrations, configuration files, and UI files must remain unchanged.



The agent must update this checkpoint continuously throughout the audit.



Do not wait until the end.



Another coding agent may continue this work from this file after the current session ends or the account changes.



\---



\## Status



Current phase:

Current step:

Overall progress:

Last updated:



\---



\## Progress State



Phase 1 — Initial architecture: PENDING

Phase 2 — Identity/auth/guest-session audit: PENDING

Phase 3 — Orders/drafts/exchange/refund audit: PENDING

Phase 4 — Analytics/event instrumentation audit: PENDING

Phase 5 — Existing admin/UI component audit: PENDING

Phase 6 — Database architecture design: PENDING

Phase 7 — Security/data-quality analysis: PENDING

Phase 8 — Final synthesis: PENDING



\---



\## Confirmed Findings



\---



\## Findings Requiring Further Inspection



\---



\## Previous-Audit Mismatches



\---



\## Database Findings



\---



\## Identity Architecture Findings



\---



\## Guest Profile Findings



\---



\## Visit Session Findings



\---



\## Analytics Findings



\---



\## Orders / Drafts / Exchange / Refund Findings



\---



\## Existing Components To Reuse



\---



\## Files That Must Remain Frozen



\---



\## Security Findings



\---



\## Data-Quality Risks



\---



\## Production Reset Findings



\---



\## Decisions Already Made



\---



\## Open Decisions



\---



\## Exact Work Completed



\---



\## Exact Work Remaining



\---



\## Last Completed Investigation



\---



\## Next Investigation To Perform



\---



\## Important Warnings / Do Not Assume



\---

