# SILKY CLIENTÈLE — STRICT IMPLEMENTATION PROMPT

You are implementing the Clientèle system for the Silky e-commerce application.

This implementation prompt is based on the completed post-Prompt-0 audit and the approved Clientèle blueprint.

The codebase itself is authoritative.

Before changing anything, inspect the current codebase and database and verify important assumptions.

---

# 0. CRITICAL IMPLEMENTATION RULES

## 0.1 Existing business logic is immutable

Do NOT modify or reinterpret existing Silky business or financial rules.

Do NOT change:

* order totals
* delivery fees
* delivery economics
* stock deduction
* order status transitions
* exchange rules
* refund rules
* cancellation rules
* payment semantics
* customer/order lifecycle
* existing order business calculations

Clientèle is an analytics/read-only intelligence layer.

It must consume existing authoritative business data.

Where an existing service/repository determines business truth, Clientèle must reuse or reference that truth instead of creating a competing implementation.

---

IMPORTANT — FREQUENT CHECKPOINTING

Do NOT treat an entire implementation phase as one checkpoint.

A phase may be larger than a single session/quota. Therefore update:

`docs/clientele/CLIENTELE_IMPLEMENTATION_CHECKPOINT.md`

AFTER EVERY SMALL, MEANINGFUL IMPLEMENTATION BATCH.

At minimum, update the checkpoint:

1. Before starting each batch, first update the checkpoint to say which batch is about to begin.
2. Immediately after creating/modifying a logical group of files.
3. Immediately after completing a migration/model/repository/service/controller group.
4. Immediately after completing a frontend component/group.
5. Immediately after running tests for that batch.
6. Immediately before moving to the next major batch.
7. Whenever a batch is only partially completed.
8. Before stopping for any reason.

A "batch" should normally be small enough to reasonably fit within one session.

Examples:

* Create and verify the Clientèle migrations → checkpoint.
* Create Drizzle models → checkpoint.
* Complete identity-link repository/service → checkpoint.
* Complete first-touch implementation → checkpoint.
* Complete visit-session repository → checkpoint.
* Complete visit-session middleware → checkpoint.
* Complete analytics-event repository → checkpoint.
* Complete analytics event controller/routes → checkpoint.
* Add one group of event emission hooks → checkpoint.
* Complete guest-profile service → checkpoint.

NEVER mark a phase COMPLETE merely because the agent has started or partially implemented it.

The checkpoint must distinguish:

* COMPLETE
* PARTIAL
* NOT STARTED
* BLOCKED

For every PARTIAL item, record:

* exact files already changed
* exact functions already changed
* what is unfinished
* any known errors
* exact next action

If the session ends unexpectedly, the next agent must be able to continue from the last small completed batch rather than reconstructing an entire phase.

Before doing substantial work, read the current checkpoint.
After substantial work, update it immediately.

The checkpoint is the persistent implementation memory across accounts and quotas.


---
# 0.2 Existing identity systems are authoritative

Do NOT modify the behavior of:

* `server/middleware/guestSession.js`
* `server/utils/shopper.js`

Do not change:

* guest session generation
* cookie lifetime
* header behavior
* authenticated/guest business identity resolution

Clientèle must integrate around the existing identity system.

---

# 0.3 CHECKPOINT / QUOTA SURVIVAL

This implementation may span multiple sessions/accounts.

The repository must contain persistent implementation memory.

Use:

`docs/clientele/CLIENTELE_IMPLEMENTATION_CHECKPOINT.md`

This file is the SOLE approved exception to any general rule against modifying planning/memory files.

## IMPORTANT — FREQUENT CHECKPOINTING

Do NOT treat an entire implementation phase as one checkpoint.

A phase may be larger than a single session/quota.

Update the checkpoint AFTER EVERY SMALL, MEANINGFUL IMPLEMENTATION BATCH.

At minimum, update it:

1. Before starting a new implementation batch.
2. Immediately after creating/modifying a logical group of files.
3. Immediately after completing a migration/model/repository/service/controller group.
4. Immediately after completing a frontend component/group.
5. Immediately after running tests for that batch.
6. Immediately before moving to the next batch.
7. Whenever a batch is only partially completed.
8. Before stopping for any reason.

Before starting each batch, record:

- the batch being started
- its status as IN PROGRESS
- the files expected to be changed

After the batch, record:

- exact files changed
- exact functions changed
- migrations created/applied
- tests completed and results
- known failures/errors
- remaining work
- exact next step

A batch must normally be small enough to reasonably fit within one session/quota.

NEVER mark a phase COMPLETE merely because it has been started or partially implemented.

The checkpoint must distinguish:

- COMPLETE
- PARTIAL
- NOT STARTED
- BLOCKED

If a batch is interrupted, the checkpoint must clearly show:

- what was already completed
- what was partially completed
- what remains
- the exact next action

Before doing substantial work, read the current checkpoint.

After substantial work, update it immediately.

The checkpoint is the persistent implementation memory across accounts and quotas.

All application files, database files, routes, models, services, repositories, and UI files must otherwise be modified only as required by this prompt.

If a session ends unexpectedly, the next agent must be able to continue safely from the latest checkpoint without assuming that an entire phase was completed.---

# 1. REQUIRED PRE-IMPLEMENTATION VERIFICATION

Before writing code:

1. Read the Clientèle blueprint completely.
2. Read the current codebase relevant to Clientèle.
3. Read `docs/clientele/CLIENTELE_IMPLEMENTATION_CHECKPOINT.md` if it already exists.
4. Read the existing:

   * auth flow
   * guest session middleware
   * admin dashboard
   * admin orders
   * orders repository/service
   * exchanges
   * refunds
   * reviews
   * contact
   * carts
   * favourites
   * drafts
   * migrations
   * database models
   * analytics repository
5. Verify actual current schema.

Do not blindly copy assumptions from the blueprint.

If the blueprint conflicts with the current codebase, use the current codebase and document the correction in the checkpoint.

---

# 2. EXPLICIT RESOLUTION OF BLUEPRINT CONFLICTS

## 2.1 Admin order card extraction

The existing AdminOrders rendering is inline.

The Clientèle blueprint requires reuse of the exact existing order-card presentation.

Therefore:

### ALLOWED

You MAY mechanically extract the existing inline order-card rendering into:

`src/components/admin/AdminOrderCard.jsx`

and modify `AdminOrders.jsx` only as necessary to call that new component.

### STRICT CONDITIONS

The extraction must preserve exactly:

* JSX structure where practical
* displayed fields
* labels
* formatting
* spacing
* classes
* icons
* buttons
* controls
* conditional visibility
* status displays
* exchange/refund/cancel controls
* event handlers
* loading states
* error behavior
* business semantics

This is a mechanical extraction/refactor only.

Do NOT redesign the card.

Do NOT simplify the card.

Do NOT change its appearance.

Do NOT alter its business logic.

Do NOT modify order calculations.

Do NOT modify existing AdminOrders behavior.

After extraction, existing AdminOrders must visually and behaviorally render the same order card it rendered before.

This is the ONLY reason `AdminOrders.jsx` may be modified.

---

## 2.2 Draft → order lineage

The blueprint mentions `draft_conversions`.

DO NOT assume that table exists.

FIRST inspect the actual current schema and code.

Determine the real draft conversion relationship.

If the current system uses:

`drafts.converted_order_id`

then use that exact relationship.

If another real table or relation exists, use the real one.

NEVER invent:

* `draft_conversions`
* columns
* foreign keys
* relationships

that do not exist.

Document the verified relationship in the checkpoint.

Draft-converted orders remain:

`user_id = NULL`
`guest_session_id = NULL`

and therefore:

`Non attribué`

unless an actual authoritative identity relationship exists.

Draft contact fields may be displayed as contextual information, but must NOT be promoted to authoritative customer identity.

---

## 2.3 Historical guest orders after registration

This is mandatory.

A registered customer's Clientèle history MUST include both:

### Direct registered orders

`orders.user_id = user.id`

AND:

### Pre-registration guest orders

orders whose:

`orders.guest_session_id`

is linked through:

`identity_links.user_id = user.id`

Therefore Clientèle customer queries MUST NOT use only:

`WHERE orders.user_id = user.id`

when computing lifetime history.

The effective customer-order relationship is:

```text
users.id
   ├── orders.user_id
   │
   └── identity_links
          │
          └── guest_session_id
                 │
                 └── orders.guest_session_id
```

This must apply consistently to:

* order count
* lifetime spend
* first order
* last order
* exchange counts
* refund counts
* cancelled orders
* order history
* net-owned variants
* other customer order analytics

Do not duplicate business rules when constructing these queries.

---

# 3. IDENTITY ARCHITECTURE

Implement four distinct identity layers.

## 3.1 Registered identity

`users.id`

Authoritative registered-customer identity.

---

## 3.2 Anonymous browser identity

`guest_session_id`

Existing long-lived anonymous browser identity.

Do not modify its generation or lifecycle.

---

## 3.3 Identified guest profile

`guest_profiles`

Represents voluntarily supplied guest identity.

It is NOT the same thing as:

`guest_session_id`

---

## 3.4 Visit session

`visit_sessions`

Short-lived behavioral session.

Recommended rule:

30 minutes of inactivity.

A long-lived guest session may have many visit sessions.

A registered user may also have many visit sessions.

---

# 4. GUEST PROFILE SYSTEM

Create:

`guest_profiles`

and:

`guest_profile_sessions`

using the exact existing migration conventions.

## 4.1 Guest profile identity

A guest profile may be created only after voluntary identity information is provided.

Potential sources:

* guest checkout
* guest product review
* guest store review
* guest contact message

Anonymous browsing alone must NOT create a profile.

---

## 4.2 Centralize matching

All profile matching must be handled by:

`guest_profile.service.js`

Do NOT implement separate matching algorithms in checkout, reviews, and contact controllers.

The central service must:

1. normalize input
2. search existing profile
3. create profile when none exists
4. link the current guest session
5. return the resulting profile

---

## 4.3 Email normalization

Normalize:

* trim
* lowercase

Do not perform fuzzy email matching.

---

## 4.4 Phone normalization

Canonicalize Tunisian phone numbers by:

* removing spaces
* removing punctuation
* removing `+216`
* removing `216`
* preserving the canonical 8-digit local number

Do not use name similarity for identity matching.

---

## 4.5 Matching priority

Use:

1. normalized email
2. normalized phone

Do not use name alone.

Do not merge profiles based on similar names.

Do not use unverified data as legal identity.

---

## 4.6 Multiple sessions per profile

One profile can have multiple known guest sessions.

Use:

`guest_profile_sessions`

with:

`UNIQUE(guest_session_id)`

A guest session can belong to only one identified guest profile.

Concurrent linking must be safe.

Use database uniqueness and conflict-safe operations.

---

# 5. VISIT SESSION SYSTEM

Create:

`visit_sessions`

and:

`server/middleware/visitSession.js`

plus the corresponding service/repository.

---

## 5.1 Session start

A visit session begins when tracked activity is initiated for a browser/user.

Do not create a new analytics session for every arbitrary backend request.

The implementation must distinguish meaningful behavioral/request entry from ordinary internal API calls where necessary.

Do not inflate session counts because the frontend makes multiple API requests during one page visit.

---

## 5.2 30-minute inactivity

A visit session remains active while:

`last_activity_at + 30 minutes >= NOW()`

After inactivity:

* mark the old session ended
* create a new session when subsequent tracked activity occurs

Do not physically delete expired sessions.

---

## 5.3 Session ownership

For every client-supplied visit session ID:

verify it server-side.

Guest:

`visit_sessions.guest_session_id = req.guestSessionId`

Authenticated:

`visit_sessions.user_id = req.user.id`

Never blindly trust:

`X-Visit-Session-ID`

---

## 5.4 Session transition after login/registration

When the current guest logs in/registers:

* create the permanent `identity_links` record
* associate the current visit session with the authenticated user as designed
* preserve enough information to retain historical anonymous attribution

Do not destroy or rewrite historical analytics events.

---

# 6. FIRST-TOUCH ATTRIBUTION

Create:

`user_first_touch`

for users whose first tracked journey can be reliably established.

---

## 6.1 Immutable

Once created:

DO NOT UPDATE first-touch attribution.

---

## 6.2 First visit

For a newly registering user with an existing guest session:

find the earliest known `visit_sessions.started_at` associated with that guest session.

Do NOT rely on the newly-created `identity_links` row to discover sessions that existed before that link.

The actual `visit_sessions.guest_session_id` history is authoritative for prior sessions.

---

## 6.3 Registration session

Store the current visit session associated with the registration event.

First-touch session and registration session are separate concepts.

They may be the same or different.

---

## 6.4 Existing users

Do NOT fabricate historical first-touch data for accounts created before Clientèle.

Do NOT backfill first-touch from:

* current login
* current referrer
* guessed traffic source
* order history
* name
* email

For older users where true first touch is unavailable, Clientèle must display it as unavailable/unknown.

---

# 7. IDENTITY LINKS

Create:

`identity_links`

with:

* user_id
* guest_session_id
* linked_at
* link_source

Use a unique constraint on:

`(user_id, guest_session_id)`

Identity links are persistent and MUST NOT be removed by the analytics reset.

Create them during:

* registration
* login when a guest session is present
* any explicitly verified guest→user transition

Never accept identity-link creation from frontend input.

---

# 8. ANALYTICS EVENTS

Create:

`analytics_events`

as the canonical behavioral event store.

Do NOT create a competing behavioral analytics storage system.

---

# 9. EVENT TYPES

Implement:

* `page_view`
* `product_view`
* `variant_selected`
* `cart_added`
* `cart_removed`
* `cart_cleared`
* `favorite_added`
* `favorite_removed`
* `checkout_started`
* `order_placed`
* `search_performed`
* `review_submitted`
* `contact_submitted`

---

# 10. EVENT IDENTITY RULE

Every event must have an attributable actor.

For guest activity:

* user_id = NULL
* guest_session_id = request guest session

For authenticated activity:

* user_id = authenticated user
* guest_session_id should not be populated merely because the browser still has the old guest cookie

Historical guest activity remains attributable through:

`identity_links`

Do not rewrite historical guest events into user events.

---

# 11. EVENT OWNERSHIP SECURITY

Every event request must be validated against the current authenticated/guest actor.

The backend must NOT accept arbitrary:

`user_id`

or:

`guest_session_id`

from the request body as authoritative identity.

Identity comes from server authentication/session context.

The event payload may contain:

* product_id
* variant_id
* order_id
* quantity
* value
* page_url
* metadata
* client_idempotency_key

but actor identity is server-derived.

---

# 12. EVENT DEDUPLICATION

Implement idempotency appropriate to the event.

## Server events

Use authoritative IDs:

* order_placed → order_id
* review_submitted → review_id
* contact_submitted → message_id

Do NOT emit duplicate events when the same business entity is processed more than once.

---

## Client events

Use `client_idempotency_key`.

It must be generated deterministically enough to prevent accidental duplicate retries.

Do not use an overly aggressive key that prevents legitimate repeated user actions.

For example, a real product view after returning later should be allowed to exist as a distinct event/session when appropriate.

Do not collapse all activity on a page into one permanent record.

---

# 13. EVENT EMISSION POINTS

Implement events from authoritative points.

## Frontend

### page_view

On actual route/page navigation.

### product_view

On actual product-page viewing.

### variant_selected

When the visitor actually selects a variant.

### checkout_started

When checkout actually begins.

### search_performed

When a search action is actually submitted/triggered.

---

## Backend

### cart_added

After successful cart mutation.

### cart_removed

After successful removal.

### cart_cleared

After successful clear.

### favorite_added

After successful favourite mutation.

### favorite_removed

After successful removal.

### order_placed

Only after successful order creation/commit.

### review_submitted

Only after successful review creation.

### contact_submitted

Only after successful contact-message creation.

Do NOT emit events for failed business operations.

---

# 14. ORDER_PLACED BUSINESS SAFETY

`order_placed` must observe the existing order creation result.

Do NOT modify order creation calculations.

Do NOT move order logic into analytics.

Do not cause an analytics failure to roll back a successful customer order unless the existing architecture explicitly and safely supports transactional coupling.

Analytics must not break checkout.

---

# 15. PRODUCT VISITS

Do NOT create a separately-written `product_visits` table.

Create:

`product_visits`

as a SQL VIEW over:

`analytics_events`

where:

`event_type = 'product_view'`

The canonical source remains `analytics_events`.

---

# 16. CURRENT CART VS HISTORICAL CART ANALYTICS

Never reconstruct historical cart additions from current cart contents.

Current cart:

`carts + cart_items`

represents current state.

Historical cart analytics:

`analytics_events WHERE event_type = 'cart_added'`

represents behavioral history.

Keep them separate.

---

# 17. TRAFFIC SOURCE

Inspect the existing application for source/referrer capture.

Because the current system has no reliable existing order-level source history, implement initial traffic-source attribution using session-level capture.

At session creation classify:

* direct
* instagram
* facebook
* tiktok
* google
* referral
* unknown

Use the actual `Referer` header when available.

Do not claim this is perfect ad attribution.

No UTM infrastructure is required in this phase unless the actual codebase already supports it.

Do not invent a second source system.

Leave the architecture extensible for future:

* UTM
* Meta Ads
* campaign attribution
* ROAS

---

# 18. DEVICE ANALYTICS

Classify sessions into:

* mobile
* tablet
* desktop
* unknown

Do not introduce browser fingerprinting.

Do not store unnecessary raw fingerprint information.

Prefer not to persist raw `user_agent` text unless inspection proves it is required.

Device classification is sufficient for the initial Clientèle launch.

---

# 19. DATABASE TABLES

Create only the six approved logical tables:

1. `guest_profiles`
2. `guest_profile_sessions`
3. `visit_sessions`
4. `analytics_events`
5. `identity_links`
6. `user_first_touch`

Do not create unnecessary identity/analytics tables.

---

# 20. GUEST PROFILES SCHEMA

Required conceptual fields:

* id UUID
* email nullable
* phone nullable
* display_name nullable
* created_at
* updated_at

Require:

`email IS NOT NULL OR phone IS NOT NULL`

Unique normalized email.

Unique canonical phone.

Do not make display_name unique.

---

# 21. GUEST PROFILE SESSIONS SCHEMA

Required:

* id
* guest_profile_id
* guest_session_id
* linked_at
* link_source

`guest_session_id` unique.

FK from guest_profile_id to guest_profiles.

Link source should represent the real origin, such as:

* checkout
* review
* store_review
* contact
* manual

Do not accept arbitrary frontend-provided link_source.

---

# 22. VISIT SESSION SCHEMA

Required conceptual fields:

* id
* user_id nullable
* guest_session_id nullable
* started_at
* last_activity_at
* ended_at nullable
* page_count
* traffic_source
* referrer_url
* device_type

Owner constraint:

at least one of user_id / guest_session_id.

Do not delete expired sessions during normal operation.

---

# 23. ANALYTICS EVENT SCHEMA

Required conceptual fields:

* id
* event_type
* user_id nullable
* guest_session_id nullable
* visit_session_id nullable
* product_id nullable
* variant_id nullable
* order_id nullable
* quantity nullable
* value nullable
* page_url nullable
* metadata JSONB nullable
* client_idempotency_key nullable
* created_at

FK behavior must preserve historical analytics where business entities are deleted.

Do not make analytics deletion cascade into core business data.

Analytics may become anonymous if an FK target is deleted.

---

# 24. ANALYTICS DATA RETENTION

Treat:

* analytics_events
* visit_sessions

as disposable telemetry.

Treat:

* guest_profiles
* guest_profile_sessions
* identity_links
* user_first_touch

as persistent identity/attribution.

Never mix these categories during reset.

---

# 25. CLIENTÈLE QUERY LAYER

Create a dedicated read-only repository/service layer.

Do not put Clientèle behavioral queries into:

`analytics.repository.js`

because that repository is existing financial analytics.

Keep financial analytics separate from behavioral analytics.

---

# 26. CLIENTS LIST

Create an admin endpoint for registered customers.

Search:

* full_name
* email
* phone_number

Display:

* name
* email
* phone
* account creation date
* total orders
* lifetime spend

The query MUST include pre-registration guest orders reachable through:

`identity_links`.

Do not use only `orders.user_id`.

---

# 27. CLIENT DETAIL

Provide:

* profile
* first-touch information
* registration-session information
* last order
* total orders
* lifetime spend
* average order value
* exchanges
* refunds
* cancelled orders
* current cart
* current favourites
* complete order history
* visited products/variants
* net-owned variants
* product reviews
* store reviews
* contact messages
* known sessions

---

# 28. ORDER HISTORY IN CLIENT DETAIL

The Clientèle customer detail must render the SAME visual order card as AdminOrders.

Use:

`AdminOrderCard.jsx`

created by mechanical extraction of the existing rendering.

Do not create a visually different Clientèle order card.

Do not copy/paste a second version of the order card.

There must be one reusable rendering component.

AdminOrders and Clientèle must both use it.

---

# 29. ORDER HISTORY QUERY

Customer order history must combine:

### direct orders

`orders.user_id = user.id`

### linked guest orders

`orders.guest_session_id IN (
  SELECT guest_session_id
  FROM identity_links
  WHERE user_id = ?
)`

while preserving proper identity classification.

Do not double-count an order if both paths somehow appear.

Use `DISTINCT order.id` or an equivalent safe strategy.

---

# 30. EXCHANGE / REFUND / CANCELLATION

Do NOT invent new business rules.

Inspect the existing authoritative exchange/refund/cancellation calculations.

Use them directly or reproduce their read-only SQL pattern faithfully.

In particular:

* existing latest exchange semantics
* existing `exchange_sequence`
* existing payment responsibility
* existing refund semantics
* existing cancellation semantics

must remain authoritative.

---

# 31. NET-OWNED VARIANTS

Implement Clientèle's net-owned variant display using the same authoritative effective-order/exchange/refund logic already present in the existing analytics/business code.

Do NOT invent a simplified algorithm.

Do NOT assume:

`ordered quantity - first exchange`

is sufficient.

Use the actual latest/effective exchange semantics.

Cancelled orders must be handled according to existing authoritative cancellation behavior.

---

# 32. EXCHANGE PAYMENT RESPONSIBILITY

Preserve the existing semantic field:

`payment_responsibility`

Use its actual values and meaning from the existing implementation.

Do not derive payer responsibility indirectly when the authoritative field already exists.

---

# 33. INVITÉS

Create:

`AdminClienteleInvites.jsx`

and detail UI.

Only voluntarily identified guest profiles belong here.

Anonymous sessions with no identified profile do NOT become Invités profiles.

---

# 34. INVITÉ SEARCH

Search by:

* display_name
* email
* phone

Show:

* identity
* sessions known
* order count
* created date

---

# 35. INVITÉ DETAIL WARNING

At the very top of the detail content, before activity:

display a styled warning:

`⚠️ Activité basée sur les sessions connues uniquement.
Cet invité peut avoir utilisé d'autres appareils ou navigateurs non liés à ce profil.`

Do not hide this warning behind tabs.

It must always be visible on the Invité detail page.

---

# 36. INVITÉ ACTIVITY

Guest activity is gathered through:

`guest_profile_sessions`

then:

`guest_session_id`

then:

* orders
* product reviews
* store reviews
* contact messages
* visit sessions
* analytics events

Never assume activity from an unlinked guest session belongs to the profile.

---

# 37. SUIVI MARCHÉ

Create:

`AdminClienteleSuivi.jsx`

as the global behavioral analytics dashboard.

Segment:

* Tous
* Clients
* Invités

Period:

* 7j
* 30j
* 90j
* 1an
* Tout

---

# 38. SEGMENT DEFINITIONS

## Clients

Behavior whose primary analytics identity is:

`analytics_events.user_id`

## Invités

Behavior whose primary analytics identity is:

`analytics_events.guest_session_id`

and:

`user_id IS NULL`

Do NOT use `guest_profile_id` as the primary behavioral identity.

---

# 39. CORE METRICS

Implement:

* anonymous browser identities
* active registered users
* accounts created
* guest profiles
* product views
* variant selections
* favourites
* cart additions
* ordered variants
* exchanged variants
* refunded variants
* cancelled orders
* orders
* revenue
* sessions
* conversion rate
* revenue per session
* traffic-source metrics
* device metrics

Label:

`Revenu par session`

when the denominator is sessions.

Never call this revenue per visitor unless the denominator is actually a visitor identity.

---

# 40. NULL/NULL ORDERS

Orders where:

`user_id IS NULL`

AND:

`guest_session_id IS NULL`

are:

`Non attribué`

They MUST NOT be silently classified as:

* Client
* Invité
* Admin

This includes verified admin/manual or draft-converted NULL/NULL orders.

They may be shown in a dedicated unattributed area where useful.

---

# 41. DRAFTS

Inspect the real draft schema and conversion implementation.

Do not fabricate relationships.

If the current design is:

`drafts.converted_order_id = orders.id`

use that.

If another actual relationship exists, use that.

Converted drafts remain unattributed unless a real authoritative identity exists.

Show draft contact information only as contextual information.

Do not promote draft email/name/phone into customer identity.

---

# 42. FUNNEL

Implement:

`Sessions`
→ `Product Views`
→ `Cart Adds`
→ `Checkout Starts`
→ `Orders`

For each:

* count
* conversion percentage
* drop-off percentage

Use consistent denominators.

Do not mix visitor counts with session counts.

---

# 43. TRAFFIC-SOURCE BREAKDOWN

For each source:

* sessions
* orders
* revenue
* conversion rate
* revenue per session

Traffic source is assigned at visit-session creation.

It is not changed by individual events.

---

# 44. DEVICE BREAKDOWN

For:

* mobile
* tablet
* desktop
* unknown

show:

* sessions
* percentage
* orders
* revenue

---

# 45. TIME-TO-CONVERT

Keep three separate measurements.

## Session → order

From relevant visit session start to order placement.

## First visit → registration

From earliest known tracked visit to account creation.

## First visit → first order

From earliest known tracked visit to first order.

Do not merge these into one KPI.

For older users with no reliable first-touch record, return unavailable rather than fabricating values.

---

# 46. SESSION ENGAGEMENT

Implement:

* sessions
* average duration
* pages/events per session
* products viewed per session
* checkout starts
* orders
* one-event sessions where meaningful

Define formulas explicitly.

Avoid calling every one-page session a “bounce” unless the implemented definition is actually one event/page and is documented accordingly.

---

# 47. GOVERNORATE

Do NOT add a new `governorate` column to `orders` merely to satisfy this dashboard.

Inspect the existing order address representation.

If governorate can be extracted reliably from the existing structured/address data, do so.

If not, expose governorate analytics as unavailable/deferred rather than introducing an undocumented business-data schema change.

`drafts.governorate` may be used only where it actually belongs to draft reporting.

Do not corrupt order data to support analytics.

---

# 48. FIRST-TOUCH SOURCE LIMITATIONS

Current historical `order_source` is unavailable.

Do NOT reconstruct historical traffic source using guesses.

Clientèle traffic attribution begins with the new visit-session tracking.

Historical records without authoritative source data remain unknown.

---

# 49. ADMIN NAVIGATION

The current admin is tab-based.

Do NOT add React Router routes such as:

`/admin/clientele/clients`

unless inspection shows the architecture has changed.

The expected current pattern is:

`AdminDashboard.jsx`

with:

`NAV_SECTIONS`

and tab state.

Add:

`Clientèle`

as a navigation group with:

* Clients
* Invités
* Suivi marché

while preserving the existing admin navigation design.

Use the existing sidebar visual conventions.

---

# 50. ADMIN AUTHORIZATION

All Clientèle backend endpoints must require:

`authMiddleware`

and:

`adminMiddleware`

Use the project's existing admin authorization pattern.

Never expose Clientèle customer data to ordinary customers.

---

# 51. API DESIGN

Implement appropriate admin endpoints such as:

`GET /api/admin/clientele/clients`

`GET /api/admin/clientele/clients/:userId`

`GET /api/admin/clientele/clients/:userId/orders`

`GET /api/admin/clientele/invites`

`GET /api/admin/clientele/invites/:guestProfileId`

`GET /api/admin/clientele/suivi`

and:

`POST /api/events`

Use the project's existing routing conventions.

Do not create redundant endpoints where an existing pattern can be reused cleanly.

---

# 52. FRONTEND API CLIENT

Extend the existing API layer only as necessary.

Do NOT break existing methods.

Do not change unrelated API behavior.

Use existing request/auth/error conventions.

---

# 53. EXISTING FILES TO MODIFY

Modify only the files truly required.

Expected categories include:

### Backend

* migration startup registration
* auth service
* admin routes
* application routes
* new Clientèle models
* new repositories
* new services
* new controllers
* event middleware
* event integration points

### Frontend

* AdminDashboard.jsx
* Clientèle pages
* reusable AdminOrderCard
* analytics/session hooks
* necessary analytics emission points

Do not modify unrelated files simply because they are nearby.

---

# 54. FROZEN FILES

The following must remain behaviorally frozen:

* `server/middleware/guestSession.js`
* `server/utils/shopper.js`
* `server/repositories/order.repository.js`
* `server/services/order.service.js`
* `server/services/exchange.service.js`
* `server/repositories/refund.repository.js`
* `server/repositories/cart.repository.js`
* `src/context/CartContext.jsx`
* `src/context/FavoritesContext.jsx`
* `src/context/AuthContext.jsx`
* `server/repositories/analytics.repository.js`

The only permitted change touching existing AdminOrders is the mechanical extraction described in Section 2.1.

---

# 55. AUTH SERVICE SAFETY

When modifying `auth.service.js`:

* preserve existing registration behavior
* preserve existing login behavior
* preserve guest cart/favourite merge behavior
* preserve transaction boundaries as much as possible
* add only identity-link / first-touch functionality required by Clientèle

Do not silently change authentication semantics.

Do not change password handling.

Do not change admin login behavior.

Admin panel login must not automatically create a customer identity link.

---

# 56. LOGIN / REGISTRATION IDENTITY LINKS

For normal customer:

### Registration

create identity link from the current guest session.

### Login

when a guest session exists, create the user↔guest-session identity link.

Use conflict-safe insertion.

Do not create duplicates.

Do not create identity links for the admin panel login flow.

---

# 57. GUEST PROFILE CREATION HOOKS

Central guest-profile logic may be invoked when a guest provides identity through:

* checkout
* product review
* store review
* contact message

Do not require every anonymous visitor to have a profile.

For checkout, remember that Prompt 0 removed the email field, but guest checkout still has other customer contact information such as phone.

Use only the identity fields actually present in the current checkout flow.

Do not re-add the removed checkout email field.

---

# 58. PROMPT-0 REGRESSION PROTECTION

Do NOT undo Prompt-0 changes.

Preserve:

* product review guest session attribution
* product review email behavior
* store review user_id attribution
* store review guest attribution
* contact guest attribution
* user email/phone validation
* guest cart deletion after merge
* favourite merge cleanup
* checkout email removal

Do not reintroduce checkout email.

---

# 59. PRODUCTION RESET

Implement the safe telemetry-reset mechanism described by the blueprint.

Create a protected script such as:

`server/scripts/reset_analytics_telemetry.js`

Required protections:

* explicit environment safety flag
* explicit CLI confirmation flag
* explicit typed confirmation
* warning output
* countdown before deletion
* never delete identity tables

The reset may clear:

* analytics_events
* visit_sessions
* derived telemetry summaries if any are created

The reset MUST NOT clear:

* guest_profiles
* guest_profile_sessions
* identity_links
* user_first_touch

Do not require application-code changes after deployment to perform a normal authorized telemetry reset.

---

# 60. MIGRATION SAFETY

All migrations must follow the project's established migration mechanism.

They must be:

* transactional where appropriate
* idempotent where the project convention supports it
* ordered safely
* registered correctly in startup

Do not modify historical migrations unless absolutely required by the existing migration system.

---

# 61. FOREIGN KEY DELETE BEHAVIOR

Be deliberate.

For identity tables:

* preserve persistent identity appropriately

For analytics:

* preserve telemetry history where possible by using SET NULL for deleted business entities

Do not allow deleting a product/order/user to unexpectedly delete large analytical history unless explicitly justified.

---

# 62. DATA QUALITY

Explicitly guard against:

* duplicate events
* duplicate order events
* duplicate review events
* duplicate contact events
* repeated page-view firing
* cart retry duplication
* checkout retry duplication
* duplicate identity links
* guest profile race conditions
* multiple tabs
* stale visit-session IDs
* wrong session ownership
* stale guest cookies
* NULL/NULL orders
* duplicate order counting through identity_links
* draft conversions
* deleted users/products

---

# 63. CONCURRENCY

Use database constraints and conflict-safe operations.

Guest profile creation must be safe when:

two requests provide the same normalized email/phone simultaneously.

Identity-link creation must be safe concurrently.

Event deduplication must be database-enforced where possible.

Do not rely solely on frontend checks.

---

# 64. SECURITY

Verify:

* arbitrary guest_session_id cannot be used to attribute another visitor's event
* arbitrary visit_session_id cannot be reused by another visitor
* arbitrary user_id cannot be supplied by frontend
* arbitrary identity_link cannot be created by frontend
* guest profiles cannot be merged via name alone
* admin-only Clientèle routes are protected
* customer data is not exposed to ordinary users
* analytics cannot manipulate order state
* Clientèle cannot manipulate inventory
* Clientèle cannot modify exchange/refund state

---

# 65. PERFORMANCE

Avoid N+1 database queries in:

* Clients list
* Invités list
* Suivi metrics

Prefer:

* aggregated SQL
* CTEs where appropriate
* indexed foreign keys
* pagination

Do not create unbounded queries for customer histories.

---

# 66. PAGINATION

Clientèle lists must be paginated.

Do not load every user/guest profile into the browser at once.

Use server-side search and pagination.

---

# 67. SEARCH

Implement server-side search for:

Clients:

* name
* email
* phone

Invités:

* display_name
* email
* phone

Use normalized comparisons where appropriate.

Do not expose sensitive raw database internals to the frontend.

---

# 68. UI VISUAL CONSISTENCY

Clientèle must visually belong to the existing Silky admin dashboard.

Reuse existing:

* table styles
* cards
* spacing
* typography
* buttons
* badges
* modals
* icons
* empty states
* loading states
* pagination
* filters

Do not create a separate visual design system.

---

# 69. ADMIN ORDER CARD

The newly extracted:

`AdminOrderCard.jsx`

must look exactly like the previous AdminOrders order card.

After extraction, verify side-by-side behavior.

Do not change:

* buttons
* action order
* labels
* status colors
* exchange/refund controls
* order data representation

The Clientèle detail page must use the same component.

---

# 70. CLIENTÈLE DETAIL DATA LOADING

Do not create a giant endpoint that returns huge datasets unnecessarily.

Load the detail information efficiently.

Where practical, use:

* summary endpoint
* paginated order history
* bounded recent sessions
* paginated reviews/messages where needed

Do not load thousands of events into a browser.

---

# 71. ANALYTICS RESET INITIAL STATE

On first Clientèle production deployment:

new telemetry tables begin empty.

Do not create fabricated historical behavioral data.

Existing business data remains available for customer/order reporting.

Behavioral analytics begin when the new instrumentation goes live.

---

# 72. HISTORICAL DATA POLICY

Never speculative-backfill:

* old product reviews
* old store reviews
* old contacts
* old traffic source
* old page views
* old cart events
* old first-touch source

Use only authoritative existing relationships.

---

# 73. EXISTING REVIEWS / CONTACTS

Prompt 0 already added:

* `reviews.guest_session_id`
* `reviews.email`
* `store_reviews.user_id`
* `store_reviews.guest_session_id`
* `contact_messages.guest_session_id`

Clientèle must use these actual fields.

Do not create duplicates.

---

# 74. PRODUCT REVIEW IDENTITY

Authenticated:

`user_id`

Guest:

`guest_session_id`

Guest email is informational/self-reported only.

Do not use review email as authoritative registered-user identity.

---

# 75. STORE REVIEW IDENTITY

Authenticated:

`store_reviews.user_id`

Guest:

`store_reviews.guest_session_id`

Existing `store_reviews.email` remains informational.

Do not overwrite authenticated identity using submitted email/name.

---

# 76. CONTACT IDENTITY

Authenticated:

`user_id`

Guest:

`guest_session_id`

Do not add phone merely for Clientèle.

---

# 77. CLIENTÈLE REVENUE

When displaying customer lifetime spend and revenue:

use the existing authoritative effective-order/revenue logic.

Do not simply sum arbitrary order rows if the existing analytics/business logic already accounts for:

* cancellations
* exchanges
* refunds
* effective orders

The Clientèle result must agree with Silky's authoritative financial logic.

---

# 78. NO SECOND FINANCIAL ENGINE

Do not build a second competing implementation of:

* revenue
* delivery expense
* delivery margin
* exchange economics
* refund economics

Reference or reuse existing authoritative calculations.

---

# 79. TESTING — DATABASE

For all new tables test:

* valid insert
* invalid CHECK
* UNIQUE conflicts
* foreign keys
* ON DELETE behavior
* identity constraints
* event ownership

---

# 80. TESTING — GUEST PROFILES

Test:

1. guest gives email → profile created
2. same normalized email → same profile
3. same email from second guest session → second session linked
4. same phone in normalized forms → same profile
5. two different names with same email → same profile
6. same name with different emails → different profiles
7. concurrent identical profile creation → one profile

---

# 81. TESTING — IDENTITY LINKS

Test:

1. registration creates identity link
2. login creates identity link when appropriate
3. duplicate login does not create duplicate link
4. admin login does not create customer identity link
5. historical guest order becomes visible under linked customer
6. unrelated guest order does not become visible under that customer

---

# 82. TESTING — FIRST TOUCH

Test:

1. first visit differs from registration visit
2. first-touch source is preserved
3. registration session is separate
4. first-touch record is immutable
5. existing old user without first-touch remains unavailable rather than fabricated

---

# 83. TESTING — VISIT SESSIONS

Test:

1. first tracked activity creates session
2. activity within 30 minutes reuses session
3. activity after 30 minutes creates a new session
4. old session gets ended
5. wrong guest session ownership is rejected
6. wrong authenticated user ownership is rejected
7. stale session ID is replaced safely
8. multiple tabs do not incorrectly share one tab session ID

---

# 84. TESTING — ANALYTICS EVENTS

Test:

* valid guest event
* valid authenticated event
* missing identity rejected
* forged user_id rejected
* forged guest_session_id rejected
* forged visit_session_id rejected
* duplicate idempotency key ignored
* duplicate order event prevented
* failed order does not produce order_placed
* successful order produces exactly one order_placed
* product view appears in product_visits view

---

# 85. TESTING — CLIENTÈLE

Test:

### Clients

* user with zero orders
* user with direct orders
* user with guest pre-registration orders
* user with both direct and linked guest orders
* no double counting
* exchange history
* refund history
* cancellations
* reviews
* contacts
* current cart
* current favourites

### Invités

* one profile with one session
* one profile with multiple sessions
* known sessions included
* unknown sessions excluded
* warning always displayed

### Suivi

* all segments
* clients segment
* guests segment
* all periods
* traffic sources
* devices
* funnel
* time-to-convert
* session engagement
* revenue per session

---

# 86. TESTING — NULL/NULL ORDERS

Create/identify a NULL/NULL order.

Verify:

* it is not shown as Client
* it is not shown as Invité
* it is not silently counted in those segments
* it remains available as Non attribué where appropriate

---

# 87. TESTING — DRAFTS

Verify the actual draft conversion relationship in the database.

Verify:

* unconverted draft remains draft
* converted draft points to the correct order
* converted order remains NULL/NULL unless authoritative identity exists
* no invented identity is assigned

---

# 88. TESTING — REGRESSION

Run the existing Silky regression suite.

At minimum verify:

* authentication
* registration
* login
* guest sessions
* cart
* favourites
* checkout
* Buy Now
* order creation
* exchange
* refund
* cancellation
* reviews
* contacts

Clientèle implementation must not break existing customer functionality.

---

# 89. BUILD / LINT / TEST

Run the project's normal:

* build
* tests
* lint/type checks where available

Fix only issues introduced by the implementation.

Do not unrelated-refactor existing warnings unless necessary for this task.

---

# 90. FINAL VALIDATION

Before declaring completion:

1. Verify all Clientèle migrations exist and are applied.
2. Verify all new models match the actual database.
3. Verify all admin endpoints are protected.
4. Verify all event ownership checks.
5. Verify no Clientèle code changes order business logic.
6. Verify identity_links correctly connect old guest orders to registered customers.
7. Verify draft lineage uses the ACTUAL current schema.
8. Verify order-card extraction did not change its visual/behavioral output.
9. Verify analytics reset cannot delete persistent identity tables.
10. Verify Prompt-0 functionality remains intact.

---

# 91. FINAL REPORT

Return:

## A. Implementation Summary

## B. Exact New Files

## C. Exact Existing Files Modified

## D. Exact Frozen Files Preserved

## E. Database Migrations Applied

## F. Identity Architecture Implemented

## G. Guest Profile Architecture Implemented

## H. Visit Session Architecture Implemented

## I. Analytics Event Architecture Implemented

## J. First-Touch / Identity-Linking Implementation

## K. Clients Implementation

## L. Invités Implementation

## M. Suivi Marché Implementation

## N. Draft Lineage — Actual Verified Relationship

## O. Admin Order Card Extraction

## P. Security Validation

## Q. Data-Quality / Double-Counting Validation

## R. Production Reset Mechanism

## S. Tests Executed

## T. Build / Regression Results

## U. Known Limitations

## V. Deviations From Blueprint

For every deviation, explain:

* what the blueprint proposed
* what the actual code required
* what was implemented
* why

---

# 92. ABSOLUTE NON-REGRESSION REQUIREMENT

Before finishing, confirm explicitly:

No changes were made to Silky's:

* order business rules
* exchange business rules
* refund business rules
* cancellation rules
* delivery economics
* stock calculations
* payment semantics
* guest-session generation
* shopper identity resolution

Clientèle must remain a separate read/analytics layer around the existing authoritative systems.

Do not claim completion unless the implementation and tests actually support the claim.
