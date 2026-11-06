\# Clientèle — Complete Implementation Blueprint



> \*\*Planning-Only Document\*\* — Do not implement. Do not create migrations. Do not modify source files. Based on full post-Prompt-0 codebase audit conducted 2026-09-06.



\---



\## A. Executive Summary



Clientèle is a customer and behavioral intelligence layer for Silky that adds three new admin areas:



| \*\*SectionTab IDPurpose\*\* |                     |                                                                |

| ------------------------ | ------------------- | -------------------------------------------------------------- |

| \*\*Clients\*\*              | `clientele\_clients` | Registered customer profiles, full order/interaction history   |

| \*\*Invités\*\*              | `clientele\_invites` | Voluntarily identified guest profiles linked to known sessions |

| \*\*Suivi Marché\*\*         | `clientele\_suivi`   | Global behavioral analytics, funnels, traffic sources          |



\*\*Critical architecture finding\*\*: The existing admin is \*\*tab-based\*\* (single `/admin` route, `AdminDashboard.jsx` with `NAV\_SECTIONS` array and `tab` state). The routes `/admin/clientele/clients` etc. in the prompt are aspirational. Clientèle must integrate as a new `NAV\_SECTION` entry named `Clientèle` with three sub-items. This requires modifying only `AdminDashboard.jsx` (not frozen).

\*\*Key constraints confirmed\*\*:



\- `order\_source` column does \*\*not\*\* exist (dropped)

\- `drafts` table has \*\*no\*\* `user\_id` or `guest\_session\_id` — all draft-converted orders are "Non attribué"

\- `analytics.repository.js` is \*\*financial\*\* analytics only — no behavioral events exist

\- `guest\_session\_id` is a cookie/header value — \*\*no\*\* canonical `guest\_sessions` table

\- All business logic files are \*\*frozen\*\*



\*\*Six new tables\*\* required: `guest\_profiles`, `guest\_profile\_sessions`, `visit\_sessions`, `analytics\_events`, `identity\_links`, `user\_first\_touch`



\---



\## B. Current Verified Architecture



\### B1. Database Tables (post-Prompt-0, verified from actual files)



| \*\*TableKey Identity FieldsNotes\*\* |                                                                   |                                                             |

| --------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |

| `users`                           | `id UUID PK`                                                      | email OR phone required (CHECK constraint added Prompt 0)   |

| `orders`                          | `user\_id` NULLABLE, `guest\_session\_id` NULLABLE                   | Both can be NULL for admin/manual orders                    |

| `order\_exchanges`                 | linked via `order\_id`                                             | `payment\_responsibility` ∈ `('customer\_paid','silky\_paid')` |

| `order\_refunds`                   | linked via `order\_id`                                             | `carrier\_cost` = 7.000 TND default                          |

| `drafts`                          | \*\*NO identity fields\*\*                                            | Admin-only; converted orders are NULL/NULL                  |

| `carts`                           | `user\_id` XOR `guest\_session\_id`                                  | One per user (UNIQUE idx), indexed for guest                |

| `reviews`                         | `user\_id` NULLABLE, `guest\_session\_id` NULLABLE, `email` NULLABLE | Prompt 0 additions                                          |

| `store\_reviews`                   | `user\_id` NULLABLE, `guest\_session\_id` NULLABLE                   | Prompt 0 additions                                          |

| `contact\_messages`                | `user\_id` NULLABLE, `guest\_session\_id` NULLABLE                   | Prompt 0 addition                                           |

| `idempotency\_keys`                | `user\_id` XOR `guest\_session\_id`                                  | Mutually exclusive CHECK                                    |



\### B2. Guest Session System



\- `guestSession.js` middleware: reads cookie `guestSessionCookieName` OR header `X-Guest-Session-ID`

\- If neither present: generates `crypto.randomUUID()`

\- Cookie lifetime: \*\*365 days\*\*

\- Always refreshes cookie + echoes header on every response

\- Sets `req.guestSessionId` on all requests

\- \*\*FROZEN\*\* — must not be modified



\### B3. Auth Flow (verified from auth.service.js)



```

svg

```



registerUser()

→ create user in TX

→ mergeGuestSessionIntoUser(userId, guestSessionId, tx)   ← in same TX

→ return JWT

loginUser()

→ verify password

→ mergeGuestSessionIntoUser(userId, guestSessionId, tx)   ← in separate TX

→ return JWT

adminPanelLogin()

→ password check (env.adminPassword)

→ NO guest session merge

→ return JWT



\### B4. Admin UI Architecture



\- Single React route: `path="admin"` → `<AdminDashboard />`

\- `AdminDashboard.jsx` manages tab state: `useState('analytics')`

\- `NAV\_SECTIONS` array drives sidebar groups and items

\- Pattern: `{tab === 'orders' \&\& <AdminOrders refreshKey={...} />}`

\- Admin guard: `\[authMiddleware, adminMiddleware]` (role === 'admin')



\### B5. Existing Analytics



\- `analytics.repository.js` — financial/revenue analytics (orders, exchanges, refunds, KPI)

\- \*\*No behavioral analytics\*\* — no events table, no session tracking, no device tracking

\- `sourcePromise = Promise.resolve({ rows: \[] })` — stub left after `order\_source` column removal



\### B6. Order Identity Summary



| \*\*Scenariouser\\\_idguest\\\_session\\\_idClientèle Classification\*\* |          |          |                  |

| -------------------------------------------------------------- | -------- | -------- | ---------------- |

| Registered customer checkout                                   | NOT NULL | NULL     | Client           |

| Guest checkout                                                 | NULL     | NOT NULL | Invité (session) |

| Admin manual order                                             | NULL     | NULL     | \*\*Non attribué\*\* |

| Draft → converted order                                        | NULL     | NULL     | \*\*Non attribué\*\* |



\## C. Current-Code vs Previous-Audit Mismatch Report



| \*\*#Previous AssumptionCurrent Verified RealityClientèle Uses\*\* |                                                            |                                                      |                                                                   |

| -------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |

| 1                                                              | `orders.order\_source` column exists                        | \*\*DROPPED\*\* by `remove\_order\_source.js`              | Traffic source must come from new `visit\_sessions.traffic\_source` |

| 2                                                              | Buy Now in `Product.jsx`                                   | Separate component: `src/components/BuyNowModal.jsx` | Analytics events must instrument `BuyNowModal.jsx`                |

| 3                                                              | Admin uses React Router nested routes                      | \*\*TAB-BASED\*\* single route `/admin`                  | Clientèle = new `NAV\_SECTION`, not new routes                     |

| 4                                                              | `analytics.repository.js` may contain behavioral analytics | \*\*Financial analytics only\*\* — revenue/KPI/delivery  | New `analytics\_events` table + repository needed                  |

| 5                                                              | Drafts may have identity                                   | \*\*NO\*\* `user\_id` or `guest\_session\_id` on drafts     | Draft orders → "Non attribué"                                     |

| 6                                                              | `guest\_sessions` table may exist                           | \*\*Does NOT exist\*\*                                   | Option A (no canonical table) confirmed                           |

| 7                                                              | `order\_source` enum available for traffic attribution      | \*\*Dropped\*\*, `sourcePromise` is empty stub           | Traffic source captured in new `visit\_sessions`                   |



\---



\## D. Identity \& Attribution Architecture



\### D1. Four Layers



\*\*Layer 1 — Registered Identity\*\*: `users.id`



\- Created on registration (email or phone required)

\- JWT token issued; all subsequent authenticated requests carry `req.user.id`

\- Orders linked via `orders.user\_id`



\*\*Layer 2 — Anonymous Browser Identity\*\*: `guest\_session\_id`



\- UUID cookie, 365-day lifetime, refreshed on every request

\- Managed entirely by `guestSession.js` (frozen)

\- Assigned to orders via `orders.guest\_session\_id`

\- Does NOT represent a human — represents a browser/device

\- Transitions to user identity at login/register via `mergeGuestSessionIntoUser`



\*\*Layer 3 — Voluntarily Identified Guest\*\*: `guest\_profiles`



\- Created only when a guest provides email or phone voluntarily (checkout, review, contact)

\- Multiple guest sessions can be linked to one profile via `guest\_profile\_sessions`

\- Profile = contact identity, NOT anonymous behavior identity



\*\*Layer 4 — Visit Session\*\*: `visit\_sessions`



\- Short-lived behavioral window (30-min inactivity)

\- One `guest\_session\_id` or `user\_id` → many `visit\_sessions` over time

\- `guest\_session\_id` (long-lived) ≠ `visit\_session\_id` (short-lived)



\### D2. Identity Lifecycle



```

svg

```



Browser lands (no cookie)

→ guestSession.js generates UUID → stores in cookie

→ visit\\\_sessions: CREATE new session (guest\\\_session\\\_id, traffic\\\_source, device\\\_type)

→ analytics\\\_events: page\\\_view event (guest\\\_session\\\_id, visit\\\_session\\\_id)

Guest adds to cart

→ analytics\\\_events: cart\\\_added (guest\\\_session\\\_id, visit\\\_session\\\_id, variant\\\_id, quantity)

Guest submits review (provides email)

→ guest\\\_profiles: UPSERT by email → link guest\\\_session\\\_id via guest\\\_profile\\\_sessions

Guest places order

→ orders: guest\\\_session\\\_id set, user\\\_id = NULL

→ analytics\\\_events: order\\\_placed (guest\\\_session\\\_id, visit\\\_session\\\_id, order\\\_id, value)

Guest registers

→ users: created

→ mergeGuestSessionIntoUser: cart + favourites merged

→ identity\\\_links: INSERT (user\\\_id, guest\\\_session\\\_id, 'registration')

→ user\\\_first\\\_touch: INSERT (user\\\_id, first\\\_visit\\\_session\\\_id, registration\\\_visit\\\_session\\\_id)

→ visit\\\_sessions: UPDATE user\\\_id on current session

→ analytics\\\_events: subsequent events use user\\\_id

User logs in (returning)

→ mergeGuestSessionIntoUser

→ identity\\\_links: INSERT (user\\\_id, guest\\\_session\\\_id, 'login') if not exists

→ visit\\\_sessions: UPDATE user\\\_id on current session



\### D3. Guest-to-User Session Transfer



When a guest registers/logs in, the current session transitions:



\- `visit\_sessions`: set `user\_id` on the \*\*current\*\* visit session

\- `identity\_links`: record the permanent link between `user\_id` and `guest\_session\_id`

\- Future analytics events use `user\_id` (not `guest\_session\_id`)

\- Historical events on that `guest\_session\_id` remain attributable via `identity\_links`



\---



\## E. Guest Profile Architecture



\### E1. Profile Creation Rules



A `guest\_profile` is created ONLY when a guest \*\*voluntarily\*\* provides identity:



\- Checkout form (name + email or phone)

\- Product review (email provided)

\- Store review (email field)

\- Contact form (email required)



\*\*Never\*\* create a profile for anonymous visits with no voluntary identity data.



\### E2. Matching Logic (server-authoritative)



```

svg

```



Lookup priority:

1\\. email (normalize: trim + toLowerCase)

→ SELECT \\\* FROM guest\\\_profiles WHERE LOWER(email) = $normalized\\\_email

2\\. phone (normalize: remove +216, 216, spaces, punctuation → 8 digits)

→ SELECT \\\* FROM guest\\\_profiles WHERE phone = $normalized\\\_phone

If found: link current guest\\\_session\\\_id to existing profile

If not found: INSERT new guest\\\_profile, then link session

\*\*Never\*\* use name alone for matching. \*\*Never\*\* merge two separate profiles based on name similarity. Guest identity is voluntary contact data only — not verified government identity.



\### E3. Multiple Sessions Per Profile



`guest\_profile\_sessions` table maps N sessions to one profile:



```

guest\_profiles.id ─→ guest\_profile\_sessions ─→ guest\_session\_id (unique)

```



Constraint: `UNIQUE(guest\_session\_id)` — one session can only belong to one profile.

If a guest uses three different browsers, each browser has its own `guest\_session\_id`. Each browser's session may independently link to the same profile if the guest identifies on each one.



\### E4. Profile Attribution Limitation (UI Requirement)



Every Invités detail page \*\*must\*\* display:



> \*"Activité basée sur les sessions connues uniquement. Cet invité peut avoir utilisé d'autres appareils ou navigateurs non liés à ce profil."\*



Display as a styled `admin-warning` callout block below the profile header, before any activity data.



\## F. Visit Session Architecture



\### F1. Session Semantics



\- A visit session starts when a browser makes its first request (page load) with a valid `guest\_session\_id` or authenticated `user\_id`

\- A session ends after \*\*30 minutes of inactivity\*\* (server-side: `last\_activity\_at` + 30min < NOW)

\- A session is "expired" but not deleted — `ended\_at` is set lazily on next request

\- If `last\_activity\_at + 30min >= NOW`: current session is still active → update `last\_activity\_at`

\- If `last\_activity\_at + 30min < NOW`: current session is expired → INSERT new session



\### F2. Server-Authoritative Ownership Validation



\*\*CRITICAL\*\*: visit sessions must be server-authoritative.

For every analytics event request that carries a `X-Visit-Session-ID` header:



1\. Look up the session in `visit\_sessions`

2\. Verify ownership:

&#x20;  - For guest: `visit\_sessions.guest\_session\_id = req.guestSessionId`

&#x20;  - For authenticated: `visit\_sessions.user\_id = req.user.id`

3\. Verify session is not expired (`last\_activity\_at + 30min >= NOW`)

4\. If invalid/expired: create a new session, return new ID in response header

5\. Update `last\_activity\_at` on valid sessions



\*\*Never\*\* trust a client-supplied `visit\_session\_id` without this server-side validation.



\### F3. Session Lifecycle at Login/Register



When a user registers or logs in with an existing `guest\_session\_id`:



1\. The current `visit\_sessions` row for that `guest\_session\_id` gets `user\_id` set

2\. This bridges behavioral continuity: the same session records pre-auth and post-auth events



\### F4. Session Storage (Frontend)



\- `visit\_session\_id` stored in `sessionStorage` (per tab, not shared)

\- Sent in every API request as header: `X-Visit-Session-ID`

\- Backend validates and may return a new session ID if expired



\### F5. Traffic Source Attribution



Captured at session \*\*creation time\*\* (not per-event):



\- Parse `Referer` header on first request of a session

\- Classify into: `direct | instagram | tiktok | facebook | google | referral | unknown`

\- Store in `visit\_sessions.traffic\_source` (immutable after session creation)

\- `referrer\_url` stored for raw debugging



Classification rules:



```

svg

```



no Referer → 'direct'

instagram.com → 'instagram'

tiktok.com → 'tiktok'

facebook.com → 'facebook'

google.com → 'google'

any other → 'referral' (store full referrer\\\_url)



\## G. Analytics Event Architecture



\### G1. Event Taxonomy



| \*\*Event TypeWho EmitsIdentity RequiredProductOrderQuantityValueIdempotency\*\* |                                  |               |          |     |     |                     |                                              |

| ---------------------------------------------------------------------------- | -------------------------------- | ------------- | -------- | --- | --- | ------------------- | -------------------------------------------- |

| `page\_view`                                                                  | Frontend (every page load)       | guest OR user | optional | —   | —   | —                   | client key (URL+sessionId+timestamp\\\_minute) |

| `product\_view`                                                               | Frontend (Product page mount)    | guest OR user | YES      | —   | —   | —                   | client key                                   |

| `variant\_selected`                                                           | Frontend (variant click)         | guest OR user | YES      | —   | —   | —                   | none (frequent)                              |

| `cart\_added`                                                                 | Backend (cart API response)      | guest OR user | YES      | —   | YES | YES                 | client key                                   |

| `cart\_removed`                                                               | Backend                          | guest OR user | YES      | —   | YES | —                   | none                                         |

| `cart\_cleared`                                                               | Backend                          | guest OR user | —        | —   | —   | —                   | none                                         |

| `favorite\_added`                                                             | Backend                          | guest OR user | YES      | —   | —   | —                   | none                                         |

| `favorite\_removed`                                                           | Backend                          | guest OR user | YES      | —   | —   | —                   | none                                         |

| `checkout\_started`                                                           | Frontend (Checkout mount)        | guest OR user | —        | —   | —   | —                   | client key                                   |

| `order\_placed`                                                               | Backend (order creation success) | guest OR user | —        | YES | —   | YES (total\\\_amount) | order\\\_id-based                              |

| `search\_performed`                                                           | Frontend                         | guest OR user | —        | —   | —   | —                   | none                                         |

| `review\_submitted`                                                           | Backend (review creation)        | guest OR user | YES      | —   | —   | —                   | review\\\_id                                   |

| `contact\_submitted`                                                          | Backend (contact creation)       | guest OR user | —        | —   | —   | —                   | message\\\_id                                  |



\### G2. Event Deduplication Strategy



\*\*Server-emitted events\*\* (order\\\_placed, review\\\_submitted, contact\\\_submitted):



\- Deduplicate by the authoritative entity ID (order\\\_id, review\\\_id, message\\\_id)

\- Use `ON CONFLICT DO NOTHING` with unique index on (event\\\_type, order\\\_id) — or embed in JSONB metadata and check before insert



\*\*Client-emitted events\*\* (page\\\_view, product\\\_view, checkout\\\_started):



\- Client generates `client\_idempotency\_key` = `sha256(event\_type + page\_url + visit\_session\_id + minute\_truncated\_timestamp)`

\- UNIQUE INDEX on `(event\_type, client\_idempotency\_key) WHERE client\_idempotency\_key IS NOT NULL`

\- Client retries are safe (idempotent)



\### G3. Emission Points



| \*\*EventEmission Point\*\* |                                                                 |

| ----------------------- | --------------------------------------------------------------- |

| `page\_view`             | Frontend: each route change (React `useEffect` on location)     |

| `product\_view`          | Frontend: `Product.jsx` on mount                                |

| `variant\_selected`      | Frontend: `Product.jsx` and `BuyNowModal.jsx` on variant change |

| `cart\_added`            | Backend: cart controller after successful insert                |

| `cart\_removed`          | Backend: cart controller after successful remove                |

| `favorite\_added`        | Backend: favourites controller after successful insert          |

| `order\_placed`          | Backend: order service after successful order commit            |

| `checkout\_started`      | Frontend: `Checkout.jsx` on mount                               |

| `review\_submitted`      | Backend: review controller after successful creation            |

| `contact\_submitted`     | Backend: contact controller after successful creation           |



\### G4. Product Visits View



Do NOT create a separate `product\_visits` table. Use a SQL VIEW:



```

sql

```



svg

CREATE VIEW product\\\_visits AS

SELECT

ae.id AS event\\\_id,

ae.product\\\_id,

ae.variant\\\_id,

ae.user\\\_id,

ae.guest\\\_session\\\_id,

ae.visit\\\_session\\\_id,

ae.page\\\_url,

ae.created\\\_at

FROM analytics\\\_events ae

WHERE ae.event\\\_type = 'product\\\_view'

AND ae.product\\\_id IS NOT NULL;

This avoids dual-write inconsistencies. Aggregate counts come from querying `analytics\_events` directly.



\## H. Orders / Drafts / Exchange / Refund Lineage



\### H1. Order Identity Classification



```

svg

```



orders.user\\\_id IS NOT NULL → registered customer order

orders.guest\\\_session\\\_id IS NOT NULL AND user\\\_id IS NULL → guest order

BOTH NULL → "Non attribué" (admin manual or draft-converted)

\*\*IMPORTANT\*\*: Never silently assign NULL/NULL orders to any identity category.



\### H2. Draft → Order Lineage



```

svg

```



drafts (no identity)

→ draft\\\_conversions.order\\\_id → orders (NULL/NULL)

→ Clientèle: "Non attribué"

→ Show draft context: customer\\\_name, phone\\\_number, customer\\\_email from drafts table



```

via: orders JOIN draft\\\_conversions ON draft\\\_conversions.order\\\_id = orders.id



&#x20;    JOIN drafts ON drafts.id = draft\\\_conversions.draft\\\_id

```



\### H3. Exchange / Refund Attribution



For registered customers:



```

svg

```



users.id → orders.user\\\_id → order\\\_exchanges via exchange.order\\\_id



```

&#x20;                      → order\\\_refunds via refund.order\\\_id

```



For identified guests:



```

svg

```



guest\\\_profile → guest\\\_profile\\\_sessions → guest\\\_session\\\_id → orders.guest\\\_session\\\_id

→ order\\\_exchanges, order\\\_refunds

`payment\_responsibility` field is authoritative for payer classification:



\- `'customer\_paid'` → customer paid exchange/refund delivery

\- `'silky\_paid'` → Silky absorbed the cost



\### H4. Net-Owned Variants Calculation



For Clientèle "net-owned variants" display:



1\. Collect all `order\_items` for a customer's completed orders

2\. Subtract items from exchanges (take the LATEST exchange per order via `exchange\_sequence DESC`)

3\. Subtract refund items

4\. Exclude cancelled orders entirely



\*\*Do NOT rewrite the business logic.\*\* Use the same CTE pattern as `analytics.repository.js` which already computes effective\\\_orders using `DISTINCT ON (order\_id)` + `exchange\_sequence DESC`. Reference that pattern directly.



\### H5. Historical Cart Note



Current cart state ≠ historical cart. A current cart shows only what's in the cart NOW. Analytics event history (from `analytics\_events.cart\_added`) shows the full sequence of cart additions over time. These are different queries for different purposes.



\## I. First-Touch \& Registration Attribution



\### I1. user\\\_first\\\_touch Table



Created at registration, \*\*never updated\*\*:



```

svg

```



user\\\_first\\\_touch:

user\\\_id            → FK users.id CASCADE (PK — one record per user)

first\\\_visit\\\_session\\\_id        → FK visit\\\_sessions SET NULL (earliest known session)

registration\\\_visit\\\_session\\\_id → FK visit\\\_sessions SET NULL (session at registration moment)

first\\\_touch\\\_source            → VARCHAR(64) (from visit\\\_sessions.traffic\\\_source at first session)

first\\\_touch\\\_at                → TIMESTAMPTZ (visit\\\_sessions.started\\\_at of first session)

registered\\\_at                 → TIMESTAMPTZ NOT NULL DEFAULT NOW()



\### I2. Attribution Logic at Registration



At `registerUser()`, after user creation:



1\. Look up the current visit session from `X-Visit-Session-ID` header

2\. Look up known prior sessions via `identity\_links` for the guest\\\_session\\\_id (if any)

3\. The "first touch" = earliest `visit\_sessions.started\_at` across all known sessions for this `guest\_session\_id`

4\. The "registration session" = current visit session

5\. INSERT into `user\_first\_touch` (immutable)



\### I3. Journey Reconstruction



```

svg

```



user\\\_first\\\_touch.first\\\_touch\\\_source    → where they first discovered Silky

user\\\_first\\\_touch.first\\\_visit\\\_session\\\_id → first session details (device, referrer)

user\\\_first\\\_touch.registration\\\_visit\\\_session\\\_id → what session drove registration

user\\\_first\\\_touch.registered\\\_at         → registration timestamp

users.created\\\_at                       → same as registered\\\_at (redundant, but useful)

Then: first order from orders WHERE user\\\_id = ? ORDER BY created\\\_at ASC LIMIT 1



\## J. Client Section Design



\### J1. Endpoint



Admin tab `clientele\_clients` → `AdminClienteleClients.jsx`

Backend: `GET /api/admin/clientele/clients` (paginated, searchable)



\### J2. List View



Search by: name, email, phone Sort by: created\\\_at, total\\\_orders, lifetime\\\_spend

Columns:



| \*\*ColumnSource\*\* |                                                                              |

| ---------------- | ---------------------------------------------------------------------------- |

| Name             | `users.full\_name`                                                            |

| Email            | `users.email`                                                                |

| Phone            | `users.phone\_number`                                                         |

| Membre depuis    | `users.created\_at`                                                           |

| Commandes        | COUNT of `orders WHERE user\_id = users.id AND status <> 'cancelled'`         |

| Dépenses         | SUM effective\\\_total\\\_amount (using same pattern as analytics.repository.js) |



\### J3. Detail Page



`AdminClienteleClientDetail.jsx` — modal or inline expansion

Sections:



1\. \*\*Profile\*\* — name, email, phone, created\\\_at, updated\\\_at

2\. \*\*Première visite\*\* — `user\_first\_touch.first\_touch\_source`, `first\_touch\_at`

3\. \*\*Compte\*\* — registered\\\_at, registration\\\_visit session traffic source

4\. \*\*Résumé\*\* — total orders, lifetime spend, AOV, exchanges count, refunds count, cancelled count

5\. \*\*Commandes\*\* — full order history rendered using `<AdminOrders />` scoped to user orders

&#x20;  - Requires a new backend endpoint: `GET /api/admin/clientele/clients/:userId/orders`

&#x20;  - Reuse the AdminOrders component logic (filtered by userId from API)

&#x20;  - The order card is not extractable as-is; must pass user-scoped orders array to AdminOrders via props

6\. \*\*Panier actuel\*\* — current cart items from `carts + cart\_items WHERE user\_id`

7\. \*\*Favoris\*\* — current favourites from `favourites WHERE user\_id`

8\. \*\*Variantes nettes\*\* — calculated from orders/exchanges/refunds

9\. \*\*Avis produits\*\* — from `reviews WHERE user\_id`

10\. \*\*Avis boutique\*\* — from `store\_reviews WHERE user\_id`

11\. \*\*Messages\*\* — from `contact\_messages WHERE user\_id`

12\. \*\*Sessions connues\*\* — visit sessions from `visit\_sessions WHERE user\_id` (recent N)



\*\*Order history rendering\*\*: The `AdminOrders` component is self-contained and fetches from `api.getOrders()`. For Clientèle, a new scoped endpoint + scoped prop must be passed. The order card render logic should be extracted into a new `AdminOrderCard.jsx` component as part of Clientèle implementation to enable reuse without circular dependencies.



\---



\## K. Invités Section Design



\### K1. Endpoint



Admin tab `clientele\_invites` → `AdminClienteleInvites.jsx`

Backend: `GET /api/admin/clientele/invites` (paginated, searchable)



\### K2. List View



Search by: name, email, phone

Columns:



| \*\*ColumnSource\*\* |                                                                                   |

| ---------------- | --------------------------------------------------------------------------------- |

| Nom              | `guest\_profiles.display\_name`                                                     |

| Email            | `guest\_profiles.email`                                                            |

| Téléphone        | `guest\_profiles.phone`                                                            |

| Sessions connues | COUNT from `guest\_profile\_sessions WHERE guest\_profile\_id`                        |

| Commandes        | COUNT from orders linked via `guest\_profile\_sessions → guest\_session\_id → orders` |

| Depuis           | `guest\_profiles.created\_at`                                                       |



\### K3. Detail Page



`AdminClienteleInviteDetail.jsx`

\*\*WARNING BANNER (mandatory, top of detail):\*\*



```

svg

```



⚠️ Activité basée sur les sessions connues uniquement.

Cet invité peut avoir utilisé d'autres appareils ou navigateurs non liés à ce profil.

Style: yellow/amber `admin-warning` callout, displayed before ANY activity data.

Sections:



1\. \*\*Identité soumise\*\* — email, phone, display\\\_name, created\\\_at

2\. \*\*Sessions connues\*\* — list of guest\\\_session\\\_id values from `guest\_profile\_sessions`

3\. \*\*Commandes\*\* — orders linked via `guest\_profile\_sessions → guest\_session\_id → orders.guest\_session\_id`

4\. \*\*Avis produits\*\* — from `reviews WHERE guest\_session\_id IN (known sessions)`

5\. \*\*Avis boutique\*\* — from `store\_reviews WHERE guest\_session\_id IN (known sessions)`

6\. \*\*Messages\*\* — from `contact\_messages WHERE guest\_session\_id IN (known sessions)`



Orders must show the same order card display as AdminOrders (reuse scoped endpoint pattern).



\---



\## L. Suivi Marché Design



\### L1. Route / Tab



Admin tab `clientele\_suivi` → `AdminClienteleSuivi.jsx`



\### L2. Global Segment Filter



\- \*\*Tous\*\* (all identities)

\- \*\*Clients\*\* (filter: `analytics\_events.user\_id IS NOT NULL`)

\- \*\*Invités\*\* (filter: `analytics\_events.guest\_session\_id IS NOT NULL AND user\_id IS NULL`)



Note: "Invités" behavioral filter uses `guest\_session\_id` (anonymous browser), NOT `guest\_profile\_id`.



\### L3. Period Filter



7j | 30j | 90j | 1an | Tout

Applied to `analytics\_events.created\_at` and `visit\_sessions.started\_at`.



\### L4. Core Metrics



| \*\*MetricFormulaLabel\*\* |                                                           |                                             |

| ---------------------- | --------------------------------------------------------- | ------------------------------------------- |

| Navigateurs uniques    | COUNT(DISTINCT guest\\\_session\\\_id) WHERE user\\\_id IS NULL | Navigateurs anonymes                        |

| Utilisateurs actifs    | COUNT(DISTINCT user\\\_id) WHERE NOT NULL                   | Clients actifs                              |

| Comptes créés          | COUNT(users) in period                                    | Inscriptions                                |

| Profils invités        | COUNT(guest\\\_profiles) in period                          | Profils invités                             |

| Pages vues             | COUNT(events WHERE event\\\_type='page\\\_view')              | Pages vues                                  |

| Produits vus           | COUNT(events WHERE event\\\_type='product\\\_view')           | Vues produit                                |

| Ajouts panier          | COUNT(events WHERE event\\\_type='cart\\\_added')             | Ajouts panier                               |

| Commandes              | COUNT(orders) in period                                   | Commandes                                   |

| Revenu par session     | total\\\_revenue / COUNT(visit\\\_sessions)                   | \*\*Revenu par session\*\* (NOT "par visiteur") |

| Taux de conversion     | orders / visit\\\_sessions × 100%                           | CVR                                         |



\### L5. Funnel Metrics



```

Sessions → Product Views → Cart Adds → Checkout Starts → Orders

```



Each step: COUNT, % of previous step, % drop-off



\### L6. Traffic Source Breakdown



Source → Sessions | Orders | Revenue | CVR `visit\_sessions.traffic\_source` drives all source attribution. Traffic source is immutable per session (captured at session creation).



\### L7. Device Breakdown



`visit\_sessions.device\_type` → mobile / tablet / desktop / unknown Display: sessions %, orders %, revenue %



\### L8. Time-to-Convert Metrics (separate KPIs)



| \*\*MetricFormula\*\*                   |                                                                                      |

| ----------------------------------- | ------------------------------------------------------------------------------------ |

| Session → commande                  | AVG(orders.created\\\_at - visit\\\_sessions.started\\\_at) for orders linked to a session |

| Première visite → inscription       | AVG(users.created\\\_at - user\\\_first\\\_touch.first\\\_touch\\\_at)                         |

| Première visite → première commande | AVG(first\\\_order.created\\\_at - user\\\_first\\\_touch.first\\\_touch\\\_at)                  |



These are \*\*three separate metrics\*\* displayed separately with clear labels.



\### L9. Session Engagement



| \*\*MetricFormula\*\* |                                                             |

| ----------------- | ----------------------------------------------------------- |

| Sessions          | COUNT(visit\\\_sessions)                                      |

| Durée moyenne     | AVG(EXTRACT(EPOCH FROM (last\\\_activity\\\_at - started\\\_at))) |

| Pages / session   | AVG(page\\\_count)                                            |

| Sessions rebond   | COUNT WHERE page\\\_count = 1 (one event only)                |



\### L10. Governorate Distribution



Orders by governorate from `orders.shipping\_address` (parsed field or added `governorate` column).

Note: `drafts` table has a `governorate` column — orders do not. This is a design consideration. For Clientèle: parse shipping\\\_address TEXT or plan a `governorate` column addition on orders.



\## M. Database Schema \& Migrations



\### M1. Migration Pattern (existing, must follow exactly)



```

js

```



svg

// File: server/db/migrations/add\\\_clientele\\\_X.js

import { pool as defaultPool } from '../pool.js';

export async function runClienteleXMigration(poolInstance = defaultPool) {

const client = await poolInstance.connect();

try {

await client.query('BEGIN');

await client.query(\\`CREATE TABLE IF NOT EXISTS ...\\`);

await client.query('COMMIT');

} catch (err) {

await client.query('ROLLBACK');

throw err;

} finally {



```

client.release();

```



}

}

Register in `server/index.js` startup sequence.



\### M2. guest\\\_profiles



```

sql

```



svg

CREATE TABLE IF NOT EXISTS guest\\\_profiles (

id UUID PRIMARY KEY DEFAULT gen\\\_random\\\_uuid(),

email VARCHAR(255),

phone VARCHAR(32),

display\\\_name VARCHAR(255),

created\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

updated\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

CONSTRAINT guest\\\_profiles\\\_identity\\\_check CHECK (email IS NOT NULL OR phone IS NOT NULL)

);

CREATE UNIQUE INDEX IF NOT EXISTS idx\\\_guest\\\_profiles\\\_email

ON guest\\\_profiles (LOWER(email)) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx\\\_guest\\\_profiles\\\_phone

ON guest\\\_profiles (phone) WHERE phone IS NOT NULL;

Retention: Persistent identity — never in generic analytics reset.



\### M3. guest\\\_profile\\\_sessions



```

sql

```



svg

CREATE TABLE IF NOT EXISTS guest\\\_profile\\\_sessions (

id UUID PRIMARY KEY DEFAULT gen\\\_random\\\_uuid(),

guest\\\_profile\\\_id UUID NOT NULL REFERENCES guest\\\_profiles(id) ON DELETE CASCADE,

guest\\\_session\\\_id UUID NOT NULL,

linked\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

link\\\_source VARCHAR(64) NOT NULL DEFAULT 'checkout',

CONSTRAINT guest\\\_profile\\\_sessions\\\_session\\\_unique UNIQUE (guest\\\_session\\\_id)

);

CREATE INDEX IF NOT EXISTS idx\\\_guest\\\_profile\\\_sessions\\\_profile\\\_id

ON guest\\\_profile\\\_sessions (guest\\\_profile\\\_id);

CREATE INDEX IF NOT EXISTS idx\\\_guest\\\_profile\\\_sessions\\\_session\\\_id

ON guest\\\_profile\\\_sessions (guest\\\_session\\\_id);

`link\_source` ∈ `'checkout' | 'review' | 'contact' | 'store\_review' | 'manual'` Retention: Persistent identity — never in analytics reset.



\### M4. visit\\\_sessions



```

sql

```



svg

CREATE TABLE IF NOT EXISTS visit\\\_sessions (

id UUID PRIMARY KEY DEFAULT gen\\\_random\\\_uuid(),

user\\\_id UUID REFERENCES users(id) ON DELETE SET NULL,

guest\\\_session\\\_id UUID,

started\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

last\\\_activity\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

ended\\\_at TIMESTAMPTZ,

page\\\_count INTEGER NOT NULL DEFAULT 0,

traffic\\\_source VARCHAR(64),

referrer\\\_url TEXT,

user\\\_agent TEXT,

device\\\_type VARCHAR(16) DEFAULT 'unknown',

CONSTRAINT visit\\\_sessions\\\_owner\\\_check CHECK (user\\\_id IS NOT NULL OR guest\\\_session\\\_id IS NOT NULL),

CONSTRAINT visit\\\_sessions\\\_device\\\_type\\\_check

CHECK (device\\\_type IN ('mobile', 'tablet', 'desktop', 'unknown'))

);

CREATE INDEX IF NOT EXISTS idx\\\_visit\\\_sessions\\\_user\\\_id

ON visit\\\_sessions (user\\\_id) WHERE user\\\_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx\\\_visit\\\_sessions\\\_guest\\\_session\\\_id

ON visit\\\_sessions (guest\\\_session\\\_id) WHERE guest\\\_session\\\_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx\\\_visit\\\_sessions\\\_started\\\_at

ON visit\\\_sessions (started\\\_at);

CREATE INDEX IF NOT EXISTS idx\\\_visit\\\_sessions\\\_traffic\\\_source

ON visit\\\_sessions (traffic\\\_source) WHERE traffic\\\_source IS NOT NULL;

Retention: Disposable telemetry — can be cleared in analytics reset.



\### M5. analytics\\\_events



```

sql

```



svg

CREATE TABLE IF NOT EXISTS analytics\\\_events (

id UUID PRIMARY KEY DEFAULT gen\\\_random\\\_uuid(),

event\\\_type VARCHAR(64) NOT NULL,

user\\\_id UUID REFERENCES users(id) ON DELETE SET NULL,

guest\\\_session\\\_id UUID,

visit\\\_session\\\_id UUID REFERENCES visit\\\_sessions(id) ON DELETE SET NULL,

product\\\_id UUID REFERENCES products(id) ON DELETE SET NULL,

variant\\\_id UUID REFERENCES product\\\_variants(id) ON DELETE SET NULL,

order\\\_id UUID REFERENCES orders(id) ON DELETE SET NULL,

quantity INTEGER,

value NUMERIC(10, 3),

page\\\_url TEXT,

metadata JSONB,

client\\\_idempotency\\\_key VARCHAR(128),

created\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

CONSTRAINT analytics\\\_events\\\_owner\\\_check

CHECK (user\\\_id IS NOT NULL OR guest\\\_session\\\_id IS NOT NULL)

);

CREATE INDEX IF NOT EXISTS idx\\\_analytics\\\_events\\\_event\\\_type ON analytics\\\_events (event\\\_type);

CREATE INDEX IF NOT EXISTS idx\\\_analytics\\\_events\\\_user\\\_id

ON analytics\\\_events (user\\\_id) WHERE user\\\_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx\\\_analytics\\\_events\\\_guest\\\_session\\\_id

ON analytics\\\_events (guest\\\_session\\\_id) WHERE guest\\\_session\\\_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx\\\_analytics\\\_events\\\_visit\\\_session\\\_id

ON analytics\\\_events (visit\\\_session\\\_id) WHERE visit\\\_session\\\_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx\\\_analytics\\\_events\\\_product\\\_id

ON analytics\\\_events (product\\\_id) WHERE product\\\_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx\\\_analytics\\\_events\\\_order\\\_id

ON analytics\\\_events (order\\\_id) WHERE order\\\_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx\\\_analytics\\\_events\\\_created\\\_at ON analytics\\\_events (created\\\_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx\\\_analytics\\\_events\\\_idempotency

ON analytics\\\_events (event\\\_type, client\\\_idempotency\\\_key)

WHERE client\\\_idempotency\\\_key IS NOT NULL;

Retention: Disposable telemetry — can be cleared in analytics reset.



\### M6. identity\\\_links



```

sql

```



svg

CREATE TABLE IF NOT EXISTS identity\\\_links (

id UUID PRIMARY KEY DEFAULT gen\\\_random\\\_uuid(),

user\\\_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

guest\\\_session\\\_id UUID NOT NULL,

linked\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

link\\\_source VARCHAR(64) NOT NULL DEFAULT 'login',

CONSTRAINT identity\\\_links\\\_unique UNIQUE (user\\\_id, guest\\\_session\\\_id)

);

CREATE INDEX IF NOT EXISTS idx\\\_identity\\\_links\\\_user\\\_id ON identity\\\_links (user\\\_id);

CREATE INDEX IF NOT EXISTS idx\\\_identity\\\_links\\\_guest\\\_session\\\_id

ON identity\\\_links (guest\\\_session\\\_id);

`link\_source` ∈ `'login' | 'registration' | 'merge'` Retention: Persistent identity — never in analytics reset.



\### M7. user\\\_first\\\_touch



```

sql

```



svg

CREATE TABLE IF NOT EXISTS user\\\_first\\\_touch (

user\\\_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

first\\\_visit\\\_session\\\_id UUID REFERENCES visit\\\_sessions(id) ON DELETE SET NULL,

registration\\\_visit\\\_session\\\_id UUID REFERENCES visit\\\_sessions(id) ON DELETE SET NULL,

first\\\_touch\\\_source VARCHAR(64),

first\\\_touch\\\_at TIMESTAMPTZ,

registered\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

created\\\_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

`user\_id` is the PK — one immutable record per user. Never UPDATE after INSERT. Retention: Persistent identity — never in analytics reset.



\## N. Exact New Files



\### Backend



| \*\*PathPurpose\*\*                                      |                                                   |

| ---------------------------------------------------- | ------------------------------------------------- |

| `server/db/migrations/add\_guest\_profiles.js`         | guest\\\_profiles + guest\\\_profile\\\_sessions tables |

| `server/db/migrations/add\_visit\_sessions.js`         | visit\\\_sessions table                             |

| `server/db/migrations/add\_analytics\_events.js`       | analytics\\\_events table                           |

| `server/db/migrations/add\_identity\_links.js`         | identity\\\_links table                             |

| `server/db/migrations/add\_user\_first\_touch.js`       | user\\\_first\\\_touch table                          |

| `server/models/clientele.model.js`                   | Drizzle ORM models for all 6 new tables           |

| `server/repositories/visit\_session.repository.js`    | create, resolve, update session                   |

| `server/repositories/analytics\_event.repository.js`  | insert events, query by entity                    |

| `server/repositories/guest\_profile.repository.js`    | upsert by email/phone, link session               |

| `server/repositories/identity\_link.repository.js`    | insert link, lookup by user/session               |

| `server/repositories/user\_first\_touch.repository.js` | insert on registration                            |

| `server/repositories/clientele.repository.js`        | read-only Clientèle list/detail queries           |

| `server/services/visit\_session.service.js`           | resolve/create/expire sessions                    |

| `server/services/analytics\_event.service.js`         | emit events (server-side)                         |

| `server/services/guest\_profile.service.js`           | match/create profiles, link sessions              |

| `server/services/clientele.service.js`               | client/invite list+detail business logic          |

| `server/controllers/analytics\_event.controller.js`   | POST /api/events (client-fired events)            |

| `server/controllers/clientele.controller.js`         | GET /api/admin/clientele/\\\* endpoints             |

| `server/routes/events.routes.js`                     | /api/events endpoint                              |

| `server/routes/clientele.routes.js`                  | /api/admin/clientele/\\\* endpoints                 |

| `server/middleware/visitSession.js`                  | resolve/create visit session from header          |



\### Frontend



| \*\*PathPurpose\*\*                                  |                                                     |

| ------------------------------------------------ | --------------------------------------------------- |

| `src/pages/admin/AdminClienteleClients.jsx`      | Clients tab list page                               |

| `src/pages/admin/AdminClienteleClientDetail.jsx` | Registered client detail modal/panel                |

| `src/pages/admin/AdminClienteleInvites.jsx`      | Invités tab list page                               |

| `src/pages/admin/AdminClienteleInviteDetail.jsx` | Identified guest detail modal/panel                 |

| `src/pages/admin/AdminClienteleSuivi.jsx`        | Suivi Marché analytics tab                          |

| `src/components/admin/AdminOrderCard.jsx`        | Extracted reusable order card (from AdminOrders)    |

| `src/hooks/useVisitSession.js`                   | Hook to manage visit\\\_session\\\_id in sessionStorage |

| `src/hooks/useAnalyticsEvent.js`                 | Hook to emit analytics events                       |



\---



\## O. Exact Existing Files to Modify



| \*\*FileModification RequiredRisk\*\*    |                                                                                                   |                                |

| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------ |

| `server/index.js`                    | Add 5 new migration imports + await calls in startup sequence                                     | Low — same pattern as existing |

| `server/routes/index.js`             | Add `import eventsRoutes` and `import clienteleRoutes`; register `/events` and `/admin/clientele` | Low                            |

| `server/routes/admin.routes.js`      | Mount `clientele.routes.js` under `/clientele` with admin guard                                   | Low                            |

| `server/services/auth.service.js`    | In `registerUser()`: add call to create `identity\_links` + `user\_first\_touch`                     | Medium — in auth TX            |

| `src/pages/admin/AdminDashboard.jsx` | Add new `NAV\_SECTION` for Clientèle; add imports and conditional renders for 3 new tab components | Low                            |

| `src/App.jsx`                        | No change needed (admin stays at `/admin` route)                                                  | None                           |



\### What NOT to touch:



\- `src/api/client.js` — add new API methods via extension (new exported functions), do NOT modify existing ones

\- `server/services/order.service.js` — read-only from Clientèle

\- `server/repositories/order.repository.js` — read-only from Clientèle



\---



\## P. Exact Files to Keep Frozen



| \*\*FileReason\*\*                                |                                                                      |

| --------------------------------------------- | -------------------------------------------------------------------- |

| `server/middleware/guestSession.js`           | Identity generation and cookie management — must not change behavior |

| `server/utils/shopper.js`                     | Identity resolution for business logic — frozen                      |

| `server/repositories/order.repository.js`     | Business-critical order queries — frozen                             |

| `server/services/order.service.js`            | Order business logic and financial calculations — frozen             |

| `server/services/exchange.service.js`         | Exchange business rules — frozen                                     |

| `server/repositories/refund.repository.js`    | Refund business logic — frozen                                       |

| `server/repositories/cart.repository.js`      | Cart operations — frozen                                             |

| `src/context/CartContext.jsx`                 | Cart state management — frozen                                       |

| `src/context/FavoritesContext.jsx`            | Favourites state — frozen                                            |

| `src/context/AuthContext.jsx`                 | Auth context — frozen                                                |

| `server/repositories/analytics.repository.js` | Financial analytics — do NOT merge behavioral analytics here         |



\## Q. Data-Quality / Double-Counting Risks



| \*\*RiskMitigation\*\*                      |                                                                                                                                                                        |

| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| `page\_view` on refresh                  | `client\_idempotency\_key` = hash(event\\\_type + page\\\_url + visit\\\_session\\\_id + timestamp truncated to minute). Unique index prevents duplicate.                        |

| `cart\_added` retry                      | Server-emitted; idempotent with client key. Cart itself is already idempotent (quantity updates).                                                                      |

| `checkout\_started` duplication          | Client key + same session + same minute = deduplication. Multiple tab opens handled by per-tab `sessionStorage`.                                                       |

| `order\_placed` duplication              | Server-emitted using `order\_id`. Unique index on (event\\\_type, order\\\_id) in metadata or as FK.                                                                        |

| Multiple tabs, same `guest\_session\_id`  | Each tab has its own `visit\_session\_id` in `sessionStorage`. Events from different tabs have different `visit\_session\_id` values. Session ownership validated per tab. |

| Stale `sessionStorage` (old session ID) | Backend validates: if `last\_activity\_at + 30min < NOW`, creates new session, returns new ID. Frontend updates `sessionStorage`.                                        |

| Login/register transition duplicates    | At transition: current session gets `user\_id` set. Events before: `guest\_session\_id`. Events after: `user\_id`. Identity linked permanently via `identity\_links`.       |

| `NULL/NULL` orders                      | Explicit classification: `WHERE user\_id IS NULL AND guest\_session\_id IS NULL` → "Non attribué". Never counted in client/guest segments.                                |

| Draft-converted orders                  | Same as NULL/NULL. `draft\_conversions.draft\_id` → draft contact info available but NOT treated as identity.                                                            |

| Guest profile merge race                | `UNIQUE(guest\_session\_id)` on `guest\_profile\_sessions` prevents double-linking. `ON CONFLICT DO NOTHING` for safe concurrent inserts.                                  |

| User deletion effects                   | FK ON DELETE CASCADE removes `identity\_links`, `user\_first\_touch`. FK ON DELETE SET NULL on events/orders preserves history anonymously.                               |

| Product deletion                        | FK ON DELETE SET NULL on `analytics\_events.product\_id` preserves event history without product.                                                                        |

| Deleted reviews                         | No impact — `review\_submitted` event has no FK to reviews (event is immutable record).                                                                                 |



\---



\## R. Security \& Ownership Validation



\### R1. Visit Session Ownership



Every POST to `/api/events` with a `visit\_session\_id`:



1\. Look up session: `SELECT user\_id, guest\_session\_id, last\_activity\_at FROM visit\_sessions WHERE id = $1`

2\. Validate owner:

&#x20;  - If request is authenticated (`req.user.id`): session must have `user\_id = req.user.id`

&#x20;  - If guest (`req.guestSessionId`): session must have `guest\_session\_id = req.guestSessionId`

3\. Check not expired: `last\_activity\_at + 30min >= NOW()`

4\. If invalid or expired: create new session, return `X-New-Visit-Session-ID` header

5\. Update `last\_activity\_at` on valid sessions



\### R2. guest\\\_session\\\_id Injection Protection



\- All backend operations use `req.guestSessionId` (set by frozen `guestSession.js` middleware)

\- Never use a client-supplied `guest\_session\_id` body field directly for business operations

\- Analytics event validation: the `guest\_session\_id` stored must match `req.guestSessionId`



\### R3. Admin Access Control



All Clientèle endpoints use: `\[authMiddleware, adminMiddleware]`



\- `authMiddleware`: verifies JWT, rejects non-authenticated requests

\- `adminMiddleware`: rejects non-admin roles (role !== 'admin')



Pattern identical to existing: `const admin = \[authMiddleware, adminMiddleware]`



\### R4. Personal Data Exposure



\- Clientèle API never exposed to customer-facing routes

\- All `/api/admin/\*` routes require admin guard

\- Email and phone data returned only to authenticated admin sessions

\- No raw device fingerprinting — device\\\_type is classified (mobile/tablet/desktop/unknown)

\- No raw IP storage — not needed for Tunisian market analytics



\### R5. Identity Link Tampering



\- `identity\_links.UNIQUE(user\_id, guest\_session\_id)` prevents duplicate links

\- Identity links created only in server-side code during login/registration — never from client input

\- `user\_first\_touch` is insert-only — no update endpoint exists



\### R6. Replay Prevention



\- `client\_idempotency\_key` on analytics events prevents client-side replay (refresh, retry)

\- Server-emitted events (order\\\_placed) reference authoritative `order\_id` — not replayable



\---



\## S. Production Reset / Initialization



\### S1. Two Categories of Data



\*\*Disposable Telemetry\*\* (safe to reset for new measurement period):



\- `analytics\_events` — behavioral events

\- `visit\_sessions` — behavioral sessions

\- Any derived cache/summary tables



\*\*Persistent Identity/Attribution\*\* (NEVER reset with telemetry):



\- `guest\_profiles`

\- `guest\_profile\_sessions`

\- `identity\_links`

\- `user\_first\_touch`



\### S2. Recommended Reset Mechanism



Create a protected admin-only script: `server/scripts/reset\_analytics\_telemetry.js`



```

svg

```



Safety checks required before any DELETE:

1\\. NODE\\\_ENV must equal 'production\\\_reset' (explicit env flag, not 'production')

2\\. Must pass --confirm-reset flag via CLI

3\\. Script must print a warning and ask for typed confirmation: "YES I UNDERSTAND"

4\\. Script must log what it will delete and require 10-second countdown before proceeding

5\\. Script must NOT truncate identity tables under any circumstances

Reset operations (in order):



```

sql

```



svg

DELETE FROM analytics\\\_events;

DELETE FROM visit\\\_sessions;

\\-- NEVER touch: guest\\\_profiles, guest\\\_profile\\\_sessions, identity\\\_links, user\\\_first\\\_touch



\### S3. Initialization



On first production deployment, no seed data is needed for the new tables. Tables start empty. Analytics begin accumulating from the moment Clientèle is live.



\### S4. Environment Flag



Add a `resetAnalytics` flag to env config, default `false`. The reset script checks this flag. The flag is never set in normal `NODE\_ENV=production` startup.



\## T. Historical Data Limitations



\### T1. Historical Recoverable



Data where the current schema provides authoritative identity:



\- \*\*Orders with \\\*\\\*\\\*\\\*\*\*\*\*`user\_id`\*\*: fully attributable to registered customers in Clients section

\- \*\*Orders with \\\*\\\*\\\*\\\*\*\*\*\*`guest\_session\_id`\*\*: attributable to anonymous browser in Invités section

\- \*\*Reviews with \*\*\*\*\*\*\*\*`guest\_session\_id`\*\*\*\*\*\*\*\* or \\\*\\\*\\\*\\\*\*\*\*\*`user\_id`\*\*: attributable (Prompt 0 added these fields)

\- \*\*Contact messages with \*\*\*\*\*\*\*\*`guest\_session\_id`\*\*\*\*\*\*\*\* or \\\*\\\*\\\*\\\*\*\*\*\*`user\_id`\*\*: attributable (Prompt 0 added these)



\### T2. Historical Attributable Indirectly



\- \*\*Guest orders\*\* → after guest registers → `identity\_links` links old sessions → historical guest orders now visible under the registered client profile

\- \*\*Guest reviews\*\* → same path via `identity\_links`



\### T3. Permanently Unattributable



\- \*\*Old reviews\*\* created before Prompt 0 migration: have `user\_id = NULL`, `guest\_session\_id = NULL`, `email = NULL` → identity unknown

\- \*\*Old store\\\_reviews\*\* before Prompt 0: same situation

\- \*\*Old contact\\\_messages\*\* before Prompt 0: `guest\_session\_id = NULL` → identity unknown

\- \*\*All draft-converted orders\*\*: permanently NULL/NULL — "Non attribué"

\- \*\*All admin manual orders\*\*: permanently NULL/NULL — "Non attribué"

\- \*\*No historical behavioral analytics\*\*: page views, cart events etc. before Clientèle deployment have no records — analytics begin from deployment date



\*\*Never\*\* propose speculative backfills for any of the above.



\---



\## U. Assumption / Verification Flags



| \*\*ItemStatusNotes\*\*                            |                                                                                                                                      |                                                                    |

| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |

| `order\_source` column removed                  | \*\*VERIFIED\*\* — `remove\_order\_source.js` drops it                                                                                     | Use traffic\\\_source on visit\\\_sessions instead                     |

| `guest\_sessions` table does not exist          | \*\*VERIFIED\*\* — no migration creates it                                                                                               | Option A confirmed                                                 |

| Drafts have no identity fields                 | \*\*VERIFIED\*\* — `add\_draft\_tables.js` + `draft.model.js` — no user\\\_id/guest\\\_session\\\_id                                             | Draft orders = "Non attribué"                                      |

| Admin uses tab-based nav (not React Router)    | \*\*VERIFIED\*\* — `AdminDashboard.jsx` NAV\\\_SECTIONS + tab state                                                                        | Must add NAV\\\_SECTION                                              |

| `analytics.repository.js` = financial only     | \*\*VERIFIED\*\* — 629 lines, orders/exchanges/refunds revenue queries only                                                              | New behavioral layer needed                                        |

| `payment\_responsibility` field semantics       | \*\*VERIFIED\*\* — `CHECK IN ('customer\_paid','silky\_paid')`                                                                             | Use directly in Clientèle                                          |

| `exchange\_sequence` for chronological ordering | \*\*VERIFIED\*\* — `INTEGER DEFAULT 1`, used in analytics.repository.js CTE                                                              | Use `ORDER BY exchange\_sequence DESC`                              |

| AdminOrders order card is NOT extractable      | \*\*VERIFIED\*\* — render is inline in AdminOrders.jsx                                                                                   | New `AdminOrderCard.jsx` needed                                    |

| `idempotency\_keys` is mutually exclusive       | \*\*VERIFIED\*\* — `CHECK (user\_id IS NOT NULL AND guest\_session\_id IS NULL) OR (user\_id IS NULL AND guest\_session\_id IS NOT NULL)`      | Model Clientèle differently — events can have either               |

| Governorate on orders                          | \*\*NEEDS PRODUCT DECISION\*\* — `drafts` has `governorate` column, `orders` does NOT. Parse from `shipping\_address` TEXT or add column? | Defer for Phase 1 of Clientèle                                     |

| Chart library used in AdminAnalyticsCharts     | \*\*NEEDS CODE INSPECTION\*\* — file is 30,685 bytes, not read                                                                           | Likely Recharts — verify before building Suivi charts              |

| `product\_videos` migration content             | \*\*DEFERRED\*\* — not critical for Clientèle planning                                                                                   |                                                                    |

| `add\_favourites\_variant.js` migration content  | \*\*DEFERRED\*\* — `favourites` basic schema confirmed                                                                                   |                                                                    |

| Whether order confirmation event should exist  | \*\*NEEDS PRODUCT DECISION\*\* — no `order\_confirmed` event defined yet                                                                  | Add to event taxonomy if required                                  |

| UTM parameter capture                          | \*\*NEEDS PRODUCT DECISION\*\* — no UTM infrastructure currently exists                                                                  | Start with Referer-based classification; UTM = Phase 2             |

| Raw user\\\_agent storage privacy                | \*\*NEEDS PRODUCT DECISION\*\* — storing raw user\\\_agent text in visit\\\_sessions                                                         | Consider hashing or storing only device\\\_type if privacy preferred |



\## V. Phased Implementation Order



\### Phase 1 — Database Foundation



\*\*Files\*\*: 5 new migration files, `clientele.model.js` \*\*Dependencies\*\*: None (migrations only add new tables) \*\*Migration order\*\*: `add\_guest\_profiles` → `add\_visit\_sessions` → `add\_analytics\_events` → `add\_identity\_links` → `add\_user\_first\_touch` \*\*Backfill\*\*: None required. Tables start empty. \*\*Risk\*\*: Low — additive only \*\*Rollback\*\*: Drop newly created tables (all IF NOT EXISTS, idempotent) \*\*Tests\*\*: Verify tables exist, constraints work, indexes present



\### Phase 2 — Identity Linking Infrastructure



\*\*Files\*\*: `identity\_link.repository.js`, `user\_first\_touch.repository.js`, `guest\_profile.repository.js`, modifications to `auth.service.js` \*\*Dependencies\*\*: Phase 1 (identity\\\_links, user\\\_first\\\_touch tables must exist) \*\*Behavior\*\*: At every login/register, atomically create identity\\\_link + user\\\_first\\\_touch \*\*Risk\*\*: Medium — modifies auth.service.js (critical path, but additive calls) \*\*Rollback\*\*: Remove new repository calls from auth.service.js \*\*Tests\*\*: Register → verify identity\\\_links entry; Login again → verify no duplicate; user\\\_first\\\_touch immutable check



\### Phase 3 — Visit Session Infrastructure



\*\*Files\*\*: `visit\_session.repository.js`, `visit\_session.service.js`, `visitSession.middleware.js` \*\*Dependencies\*\*: Phase 1 (visit\\\_sessions table) \*\*Behavior\*\*: Middleware resolves/creates visit session on every API request; validates ownership \*\*Risk\*\*: Medium — new middleware on all routes \*\*Rollback\*\*: Remove middleware registration from app startup \*\*Tests\*\*: Session created on first request; session reused within 30min; new session created after 30min; ownership validation rejects wrong session



\### Phase 4 — Analytics Event Ingestion



\*\*Files\*\*: `analytics\_event.repository.js`, `analytics\_event.service.js`, `analytics\_event.controller.js`, `events.routes.js`, frontend `useAnalyticsEvent.js`, `useVisitSession.js` \*\*Dependencies\*\*: Phase 1 + Phase 3 (visit\\\_sessions must exist for FK) \*\*Backend\*\*: POST `/api/events` — validate ownership, insert event with deduplication \*\*Frontend\*\*: emit events on page load, product view, cart actions, checkout \*\*Risk\*\*: Medium — new API endpoint; frontend modifications to Product.jsx, Checkout.jsx, Cart.jsx, BuyNowModal.jsx \*\*Server-emitted events\*\*: add event emission to order, review, contact controllers (after business commit) \*\*Rollback\*\*: Remove event emission calls; disable events endpoint \*\*Tests\*\*: Verify idempotency (send same event twice → one record); verify ownership validation; verify server-emitted events on order placement



\### Phase 5 — Guest Profile Infrastructure



\*\*Files\*\*: `guest\_profile.service.js`, `guest\_profile.repository.js`, hook into review/contact/order controllers \*\*Dependencies\*\*: Phase 1 (guest\\\_profiles, guest\\\_profile\\\_sessions) \*\*Behavior\*\*: When guest provides email/phone at checkout/review/contact → upsert profile → link session \*\*Risk\*\*: Medium — modifies checkout and review flows (non-frozen controllers) \*\*Rollback\*\*: Remove profile linkage calls from controllers \*\*Tests\*\*: Same email twice → one profile; different browser same email → sessions linked to same profile; phone normalization test



\### Phase 6 — Derived Analytics / Query Layer



\*\*Files\*\*: `clientele.repository.js`, `clientele.service.js`, `clientele.controller.js`, `clientele.routes.js` \*\*Dependencies\*\*: Phases 1–5 all complete \*\*Behavior\*\*: Read-only admin queries for Clients, Invités, Suivi \*\*Risk\*\*: Low — read-only, no business logic \*\*Rollback\*\*: Remove routes registration \*\*Tests\*\*: Client list returns registered users with correct order counts; Invités excludes NULL profiles; Suivi metrics verify against manual calculation



\### Phase 7 — Clients UI



\*\*Files\*\*: `AdminClienteleClients.jsx`, `AdminClienteleClientDetail.jsx`, `AdminOrderCard.jsx` (extracted), modify `AdminDashboard.jsx` \*\*Dependencies\*\*: Phase 6 backend \*\*Risk\*\*: Low — new UI components + minimal AdminDashboard modification \*\*Tests\*\*: Search by name/email/phone; detail modal shows correct history; order card displays correctly



\### Phase 8 — Invités UI



\*\*Files\*\*: `AdminClienteleInvites.jsx`, `AdminClienteleInviteDetail.jsx` \*\*Dependencies\*\*: Phase 6 backend + Phase 7 (AdminOrderCard extracted) \*\*Risk\*\*: Low \*\*Verify\*\*: Warning banner always visible; session attribution limitation visible; orders only from known sessions



\### Phase 9 — Suivi Marché UI



\*\*Files\*\*: `AdminClienteleSuivi.jsx`, chart subcomponents \*\*Dependencies\*\*: Phase 6 backend \*\*Risk\*\*: Medium — chart library integration, metric correctness \*\*Tests\*\*: All metrics match direct SQL queries; period filters work; segment filters (Tous/Clients/Invités) correct; time-to-convert metrics use correct denominators



\---



\## W. Testing \& Regression Plan



\### W1. Database Integrity Tests



For each new table:



\- Insert valid row: succeeds

\- Violate CHECK constraint: fails

\- Violate UNIQUE: fails

\- FK violation (parent missing): fails

\- FK ON DELETE CASCADE/SET NULL: cascades correctly



\### W2. Identity Logic Tests



\- Register with email → `identity\_links` created → `user\_first\_touch` created

\- Login with known guest\\\_session → `identity\_links` entry upserted

\- Same (user\\\_id, guest\\\_session\\\_id) twice → no duplicate (UNIQUE constraint)

\- Register twice with same email → rejected (users.email UNIQUE)

\- Guest profile: same email from two sessions → one profile, two session links

\- Phone normalization: `+21612345678`, `21612345678`, `12345678` all normalize to `12345678`



\### W3. Visit Session Tests



\- First request: new session created

\- Second request within 30min: same session, `last\_activity\_at` updated

\- Request after 30min: new session created, `ended\_at` set on old

\- Wrong session ownership: rejected, new session returned in header

\- Login during session: session `user\_id` set



\### W4. Analytics Event Tests



\- Same `client\_idempotency\_key` twice: one record only (UNIQUE index)

\- Event without guest\\\_session\\\_id OR user\\\_id: rejected (CHECK constraint)

\- `order\_placed` server-emitted: exactly one event per order

\- Frontend `page\_view` on rapid refresh: idempotent via minute-truncated key



\### W5. Clientèle Query Tests



\- Client with 0 orders: shows correctly (no division errors)

\- Client with exchange: exchange listed; net-owned variants correct

\- NULL/NULL order: excluded from client/guest segments; appears only as "Non attribué"

\- Invité with 2 sessions: both sessions shown; all orders from both sessions shown

\- Invité warning banner: always rendered before activity data



\### W6. Regression Tests (existing functionality)



Run existing regression suite (19/19 confirmed from Prompt 0):



\- Order creation, confirmation, exchange, refund, cancellation: unchanged

\- Login/register flows: unchanged behavior (additive only)

\- Cart/favourites merge: unchanged

\- Guest session cookie: unchanged

\- Review/contact submission: unchanged



\## X. Final Conflict / Risk Summary



| \*\*RiskSeverityMitigation\*\*                          |                                                          |                                                                                                       |

| --------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |

| Admin tab architecture vs. aspirational routes      | \*\*HIGH\*\* — requires design acknowledgment                | Implement as NAV\\\_SECTION tabs, not React Router routes                                               |

| `order\_source` removed — traffic source history gap | \*\*MEDIUM\*\* — analytics start from zero                   | Document as historical limitation; traffic source starts accumulating on deployment                   |

| auth.service.js modification (identity\\\_links)      | \*\*MEDIUM\*\* — critical auth path                          | Additive async calls after main TX; full regression test                                              |

| Draft-converted orders permanently NULL/NULL        | \*\*LOW\*\* — documented limitation                          | UI labels clearly "Non attribué" with no guessed attribution                                          |

| AdminOrders order card not extractable              | \*\*MEDIUM\*\* — refactoring needed                          | Extract `AdminOrderCard.jsx` in Phase 7; test isolated card                                           |

| Governorate on orders missing                       | \*\*LOW\*\* — analytics metric gap                           | Defer to product decision; parse from shipping\\\_address as fallback                                   |

| visit\\\_session creation on every request            | \*\*MEDIUM\*\* — performance concern at scale                | Index on `guest\_session\_id` + `last\_activity\_at`; lazy expiration (no scheduled job needed initially) |

| analytics\\\_events table growth                      | \*\*LOW initially, HIGH long-term\*\*                        | Partition by `created\_at` month in a future phase; not needed for launch                              |

| Chart library unknown                               | \*\*LOW\*\* — verify AdminAnalyticsCharts.jsx before Phase 9 | Read AdminAnalyticsCharts.jsx fully before starting Suivi UI                                          |

| Multiple Clientèle agents using same blueprint      | \*\*LOW\*\*                                                  | Checkpoint file is authoritative; blueprint is the single source                                      |

