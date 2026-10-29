# Implementation checklist (six-tool expansion)

Rules: a box is ticked only when the behaviour was **executed** and the evidence is named. "Fake" means tested against an in-repo fake, not the real third party. Updated 2026-10-27.

Evidence key: `unit` vitest, `api` API integration tests (real migrations, in-memory SQLite), `sdk` jsdom tests of the storefront runtime, `e2e` Playwright in real Chromium against the real Worker runtime (workerd), `manual` not covered by automation.

## Phase 0 — Architecture
- [x] Repo inspected, gaps identified: `docs/architecture-v2.md` §1
- [x] Architecture diagram, data model plan, API plan, backlog: `docs/architecture-v2.md`
- [x] Baseline recorded before changes: 23/24 turbo tasks, with the web test task failing only because it ran concurrently with the Next build; passes alone (22/22). See "Known flakiness".

## Phase 1 — Shared foundation
- [x] `tool` on the campaign contract with per-tool schemas and cross-field rules (tool/format agreement, stray blocks rejected, required options): `unit` contracts (49)
- [x] Backwards compatibility: every pre-existing config still validates and maps to a tool: `unit`, `api`
- [x] Engine slots, cross-tool quiet period, already-subscribed guard, passive-surface rules, free-shipping eligibility: `unit` engine (36)
- [x] Migration 0002 (`campaigns.tool` + index) with backfill proven on pre-existing data: `unit` database (9)
- [x] Per-tool validation warnings, tool filter, tenancy of the filter, plan entitlements per tool, shipped-tool gate, downgrade handling: `api` (127)
- [x] `currency` in the published storefront config: `api`
- [x] Per-tool analytics counters (`metric_counters`, migration 0006): see Phase 6

## Phase 2 — Toast (NotiPop equivalent): SHIPPED
- [x] Kinds: announcement, product offer, coupon reveal, shipping incentive: `sdk`, `e2e`
- [x] Positions: four corners, full-width bottom on phones: `sdk` (pure placement), `e2e` (real layout in a 390px viewport)
- [x] Triggers: immediate, delay, scroll depth, idle, exit intent, add-to-cart, cart threshold: `sdk` (all but exit intent exercised; exit intent is pre-existing logic)
- [x] Page-view / product-view / collection-view are expressed as `page_type` targeting plus an immediate trigger (no separate trigger types by design)
- [x] Frequency, cooldown, dismissal memory, quiet period: `unit`, `sdk`, `e2e`
- [x] Reduced motion honoured; dismiss button accessible; Escape dismisses; auto-hide pauses on hover/focus and is not recorded as a dismissal; never takes focus; polite live region: `sdk`, `e2e` (axe clean)
- [x] Listener/timer cleanup (`ConvertFlow.destroy()`), no duplicate boot: `sdk`
- [x] Editor (shared editor, toast section) with live preview using the real renderer and a labelled sample cart: `unit` web, `e2e`
- [x] Tool landing page, sidebar navigation, tool column and filter in the campaign list: `e2e`
- [x] Journey from the brief: eligible sees, ineligible does not, click recorded, purchase attributed once, pause stops it, consent respected: `e2e` (12 tests)
- [ ] Platform cart detection: Shopify (`/cart/add`, `/cart.js`) and WooCommerce (`added_to_cart`) are **fake-tested only**. The generic `ConvertFlow.setCart()` / `trackAddToCart()` API is what is verified end to end.
- [ ] Zero-decimal currencies: `/cart.js` amounts are assumed to be in cents; unverified for JPY and similar.

## Phase 3 — Feed (NotiFeed equivalent): SHIPPED
- [x] Bell + panel, unread badge with an accessible name, "New" markers, category, date, optional image, product link, coupon code: `sdk` (22 tests), `e2e`
- [x] Read state in the shopper's own browser only: localStorage with analytics consent, tab-session storage without it, nothing sent, bounded to 200 entries: `sdk`, `e2e`
- [x] Ordering by the merchant's order, then newest, then id; expiry and scheduling via the shared schedule; targeting via the shared rules; items re-read on open so one that expired meanwhile disappears: `sdk`, `e2e`
- [x] Keyboard (Enter/Escape, focus returned to the bell), outside click, non-modal dialog, axe clean, phone viewport: `e2e`
- [x] Graceful failure: a failed config request shows nothing and does not throw; hidden entirely when empty; kill switch: `sdk`
- [x] Editor in the shared editor (no trigger, per-visit limits or goal for a persistent surface) with a live preview of the real feed: `unit` web, `e2e`
- [x] Analytics through the shared pipeline: opens count as impressions (once per item per session), item clicks as clicks and as the last click for attribution, one page-view event per page: `api` (7), `sdk`, `e2e`
- [x] No personal data in feed events (the contract strips extras); tenancy and forged versions rejected: `api`
- [ ] Cross-device read state: needs an authenticated customer identity; deliberately not built
- [ ] A toast in the same corner as the bell can overlap it (the editor does not warn yet)

## Phase 4 — Upsell (NotiSell equivalent): SHIPPED
SDK API for stores (page data, `ConvertFlow.addToCart`, where a block goes): `docs/storefront-sdk.md`.
- [x] Deterministic recommender with five sources: merchant picks, same collection, merchant-set complements, merchant-set alternatives (only for a product the catalog says is sold out), and the free-shipping gap (only products every in-stock option of which closes the real gap; an unknown or already-qualifying cart shows nothing). Ties break by catalog id, so the order is stable: `api` (upsell.test.ts, 37; it caught a random-row-id tie-break, now fixed)
- [x] Availability: only products the catalog positively says are in stock are ever returned; sold out, unknown stock, draft, archived, no-variant and missing products are all skipped; the viewed product, what is in the cart and the merchant's exclusions never come back; links the browser cannot safely follow are dropped or replaced by the handle path: `api`
- [x] Tenancy: another store's product ids, campaign ids and links never resolve (404 or the same empty answer): `api`
- [x] Public `GET /api/v1/recommendations`: options come from the live campaign, never the request; paused, unpublished, kill-switched, non-upsell, other-store and plan-downgraded all give the identical empty answer; CORS `*` without credentials; `no-store`; rate limited; bounded input: `api`
- [x] Merchant product links (migration 0004 `product_relationships`, unique per pair and kind, cascade with products and stores): create/update/list/remove, self-links and unknown products refused, 50 per product and 5,000 per store, viewers read, editors write, audited, tenant-isolated: `api`, `unit` database (18)
- [x] Storefront block (row, grid, list; product page, cart, or a corner toast): real links, formatted prices, text-only rendering, untrusted URLs, aria live status, focus never stolen by the toast placement, phone viewport and axe clean: `sdk` (34 in recommend.test.ts), `e2e`
- [x] Add to cart: the store's own `ConvertFlow.addToCart`, with in-flight double-click protection, an honest failure message and retry, "Added" that stays, and keyboard focus kept (a regression the e2e found: a repaint after adding dropped focus and could remove the added card; fixed, covered by `sdk` and `e2e`): `sdk`, `e2e`. Products with several variants, or sites with no way to add, link to the product page instead of pretending
- [x] Events through the shared pipeline: `recommendation_impression` (impressions), `recommendation_click` (clicks, and the last click for attribution), `recommendation_add_to_cart` (new `add_to_carts` aggregate, shown in analytics totals and per campaign); consent gate respected, nothing sent or stored without it; no personal data: `api`, `sdk`, `e2e` (a purchase after adding from the block is attributed)
- [x] Engine: a product-page block is only eligible on a product page; cart and toast placements follow targeting; inline blocks are passive, the toast placement ambient (never on top of a popup): `unit` engine (40)
- [x] Holdout experiments apply to inline blocks too: `sdk`
- [x] Editor (shared editor): source, collections or picks, placement, layout, count, prices, add-to-cart switch, free-shipping threshold; retargets an untouched page rule when the placement changes; warns about an empty catalog, a cart block with no cart targeting, custom stores without an add-to-cart function, and alternatives needing synced stock; live preview with the real renderer and **labelled sample products**. Typing a comma or clearing the count no longer fights the field (found by the tests): `unit` web (15), `e2e`
- [x] Product links page on the tool's page, and the tool is out of "Soon" everywhere: `unit` web, `e2e`
- [x] Journey: link products, build in the editor, publish, shopper sees only in-stock same-collection products in order, add to cart (instant, slow, flaky, none), analytics and attribution, no consent, phone + axe, a product selling out disappears and returns, toast placement, pause removes it: `e2e` (15 in upsell.spec.ts)
- [ ] **Shopify and WooCommerce add-to-cart are fake-tested only** (`/cart/add.js` with the numeric or GraphQL variant id; wc-ajax `add_to_cart` then `added_to_cart`). The store's own `ConvertFlow.addToCart` is the path verified end to end in a browser
- [ ] Shopify `/cart.js` product ids (used to keep in-cart products out of cart blocks) are fake-tested only, and the catalog's Shopify variant ids have never been seen from a real sync (Shopify OAuth/Admin API is not built)
- [ ] Each block view costs a few D1 reads (viewed product, links, variants, store, plan) and nothing is cached, so availability is current. Fine at this scale; the load test has **not** been rerun with it. A short KV cache would trade freshness for fewer reads
- [ ] A product-page block excludes what is in the cart only as far as the cart was known when the page loaded; the cart is not re-read after the shopper's own add (by design: nothing moves under their cursor)
- [ ] The editor's product picker lists the first 50 catalog products (the existing products endpoint's default). Collections are entered as catalog collection ids by hand
- [ ] A cart *drawer* created after page load is not detected: the merchant puts `data-convertflow-recommendations` inside it
- [ ] Not built, deliberately: frequently-bought-together from order history, "N people bought this", AI ranking (no verified order data, and no fabricated social proof)
- [x] SDK size: the upsell renderer is now a lazily loaded script and the core is 10,278 B gzip (was 15,242 B with 118 B of headroom against the 15 KB claim). See the Phase 5 SDK items.

## Phase 5 — Email signup: SHIPPED (capture, export, and copy to Klaviyo / Mailchimp). Marketing email sending and SMS: NOT BUILT
The email tool is in `SHIPPED_TOOLS`: a merchant can build a popup, slide-in, bar or inline form (optional first name, optional incentive revealed only after confirming), shoppers sign up and confirm, and the merchant can export the list or have confirmed subscribers copied to Klaviyo and/or Mailchimp. **No marketing email is sent from this app** (only the confirmation and the incentive email); the list is for the platform the merchant already uses. **The Klaviyo and Mailchimp adapters have never been run against the real services**: they are tested against recorded request shapes, a fake and a mock server, and the dashboard says "Not verified against the live provider" until a connection check with the merchant's real key passes.
- [x] Unified contacts + append-only consent log + per-channel suppression (migration 0003): `unit` database (14; upgrade keeps existing suppression rows as email, per-channel uniqueness, E.164/email uniqueness with NULLs, cascade on erasure and store removal), `api` (18)
- [x] Double opt-in: request -> confirm (single use, 7-day expiry, refused after an opt-out) with the exact consent text and its hash stored; per-address 10-minute cooldown; identical public answer whatever the plan/site/suppression: `api`
- [x] Opt-out by signed link and RFC 8058 one-click (channel is part of the signature), idempotent, hashed suppression, store-scoped; a back-in-stock opt-out also opts the address out of marketing: `api`
- [x] Merchant list (cursor, exact-address and status filters), contact + consent history, erasure (admin only, audited without personal data, suppression survives), tenancy and roles: `api`
- [x] Retention: never-confirmed contacts after 7 days, anyone not subscribed after 30, wired into the daily cron: `api` (the cron wiring itself is not exercised)
- [x] The public sign-up route is gated on `SHIPPED_TOOLS.has("email")`: `api`
- [x] The server records the **published form's** consent text and privacy link, read by campaign id; anything the browser claims about the words is ignored; a paused, unpublished, other-store or downgraded-plan form collects nothing and answers identically; a republish changes later sign-ups only: `api`
- [x] Contract: email forms may be popup, slide-in, announcement bar or inline, may ask for a first name and carry an incentive; phone and single opt-in are still rejected rather than silently ignored: `unit` contracts (54), `api`
- [x] Storefront form (shared renderer, so the editor preview is the real thing): unticked consent box carrying the exact words, privacy link, blocks submit until valid + ticked, error and retry, confirm-by-email message; the browser sends only address + campaign id + `consent:true`; not shown again after signing up (session, or localStorage with consent); nothing recorded without analytics consent: `sdk` (87)
- [x] Editor: email section (style incl. bar and inline, first name, consent text, privacy link, confirmation message, sign-up incentive with the store-limit hint), contract validation blocks bad input, warns when the words never mention unsubscribing, hides the button link, no trigger or per-visit limits for an inline form, says plainly that this app does not send marketing email: `unit` web, `e2e`
- [x] Subscribers page: status filter, exact-address lookup, load more, erase (two-step), CSV export of current subscribers only (spreadsheet-formula-safe, admin only, audited, capped at 50,000): `api`, `e2e`
- [x] Journey: build in the editor -> shopper must tick the box -> confirmation email carries the consent words -> pending is not exported -> confirm once -> exported -> consent proof visible -> axe + 390 px -> one-click unsubscribe -> erase -> cannot be re-added: `e2e` (8)
### Storefront script: per-tool scripts loaded on demand
- [x] The core `cf.js` is 10,278 B gzip (was 15,242); toast, feed, upsell and email are separate scripts (2.7 / 3.2 / 3.7 / 3.2 KB gzip) fetched the first time a campaign of that tool is eligible, started early so they are usually there when the trigger fires. All together 23.0 KB (budget 35 KB); the build fails over 12 KB core, 35 KB total, or the 15 KB marketing claim. `sdk` (lazy.test: a plain popup downloads nothing else, one request per tool, a failed or non-registering script shows nothing and is not retried in a loop, destroy before arrival draws nothing), `e2e` (every existing spec runs through the real lazy loading)
- [x] Tool script names carry a content hash, set into the core at build time, so a cached core can never request a script from a different release; they are served `immutable`, the core with a short cache. Hosting must serve the whole `dist/` directory (README, `docs/storefront-sdk.md`)
- [ ] A strict Content-Security-Policy on a merchant's site must allow the SDK origin for scripts (the tool scripts come from the same origin as `cf.js`); not tested against a real CSP
- [ ] Core + tool scripts versioning relies on a deploy replacing all files together; there is no protocol-version handshake beyond the hashed names

### Email form features
- [x] Inline and announcement-bar layouts, shared renderer with the popup (the editor preview is the real thing): `sdk` (signup.test 11: same form in all four layouts, unticked box with the exact words, inline is not fixed/not dismissible, bar lays out in a row), `e2e`
- [x] Inline forms are a passive surface: mounted at `data-convertflow-form`, else the end of `<main>`, else the page; shown without a trigger; one eligible-page-view and one impression event; stay on screen after signing up to show the confirmation; hidden from someone who already signed up: `sdk`, `e2e`
- [x] First name (optional for the shopper): stored only when the published form asks for it, name-like characters only and at most 60 (no markup, formula or control characters), sent to the providers, a column in the CSV export: `api`, `sdk`, `e2e`
- [x] Incentive revealed only after confirming: never drawn on the form (any layout) or in the confirmation email; shown on the single-use confirmation page and emailed once; the version the shopper used is honoured (a later republish does not change it); not given if the store's ceiling dropped below it or promotions were turned off since; escaped on the page; same publish-time guardrail as every discount: `api` (7), `sdk`, `e2e`
- [x] A confirmation email that fails to send no longer holds the shopper in the 10-minute cooldown (a `delivery_failed` event frees only its own request): `api`
- [x] Per-form counts: sign-up requests and confirmations from the server (per store, per period; a confirmation rate from server counts on both sides), browser-reported impressions alongside, request rate labelled an estimate: `api`, `e2e`
- [ ] The incentive code is the merchant's one shared code (not single-use or personal); making it unique per shopper needs the store platform's discount API
- [ ] If the incentive email fails to send, the shopper has only the confirmation page (the link works once)

### Copy to Klaviyo and Mailchimp (adapters are UNVERIFIED against the live services)
- [x] One channel-generic adapter interface with typed failures (auth, rate limit, transient, rejected), a recording fake and two real adapters built on the vendors' documented REST APIs; the provider's response body is never copied into an error (it can echo the address); a Klaviyo list link is only followed on the same origin; the MD5 Mailchimp needs is checked against standard vectors and, in e2e, against Node's own: `unit` integrations (19), `e2e`
- [x] Migration 0005 (connections, sync jobs, first name, form version on consent events) keeps existing contacts and consent history; one connection per provider per store; one job per contact, provider and channel; cascade on erasure and store removal: `unit` database (5)
- [x] Connections: the key is checked against the provider before it is stored, encrypted at rest (AES-GCM, same path as platform credentials), never returned or audited; admin-only changes, editors can read status, other stores see nothing; a key change keeps the chosen list only if it is still visible; a missing encryption key fails safe (503): `api` (43 in `providers.test`)
- [x] A connection is **verified only when a check passed against the provider's real origin**; against a staging or mock origin (e2e) or a fake it is never verified, and the dashboard says "Not verified against the live provider": `api`, `unit` web, `e2e`
- [x] A subscribe job is created only from a confirmed subscription and only when a provider has a list; it re-checks current consent and suppression at the moment it runs (an opt-out in between wins); pending requests, unsubscribed people and suppressed addresses are never sent; "also add everyone already subscribed" is the merchant's explicit choice: `api`, `e2e`
- [x] Retries: a rate limit waits at least as long as the provider asked (capped at 6 h), outages back off 30 s, 1 min, 2 min ... up to 6 h, give up visibly after 8 attempts; auth failure flags the connection; a refusal is permanent and shown; failed jobs are retried by the merchant (after fixing the key) or stay put; a daily sweep re-queues anything a lost enqueue stranded; a lost enqueue never breaks the confirmation; the queue consumer re-queues a waiting job with a delay (the queue's own retry limit is smaller than ours): `api`
- [x] Opt-outs propagate: an unsubscribe (link or one-click) removes the person from every list; a subscribe that never reached the provider is cancelled instead; **an opt-out that lands while a subscribe is in flight is not lost** (the attempt is recorded before the call, and a superseded subscribe queues a fresh removal): `api` (a race that the first version of this code lost; the test found it), `e2e`
- [x] Erasure unsubscribes them at each provider first, then erases locally even if a provider is down (named in `x-provider-cleanup-failed`, audited by provider name only, never by address). It does **not** delete their profile at the provider (that can hold order history): the dashboard says so: `api`, `e2e`
- [x] Subscribers page: connect and choose a list, copied / waiting / failed counts, retry failed, check connection, two-step disconnect, per-person status ("In Klaviyo", "Adding…", "Klaviyo failed", "Removed from…") that refreshes itself while anything is waiting, axe clean with the panel: `unit` web (7), `e2e` (11 in `provider.spec`)
- [ ] **Never run against real Klaviyo or Mailchimp.** Endpoints, headers, the Klaviyo `revision`, scopes and payload shapes follow the vendors' public docs and have not been executed. Klaviyo's first-name handling (a profile import before the subscription job) in particular is unconfirmed
- [ ] Klaviyo and Mailchimp each take one list per store; no per-form list mapping, no tags or segments
- [ ] Deleting a store or account removes its contacts and sync jobs (cascade) **without** unsubscribing them at the provider; only erasing one person, an opt-out, or the merchant removing them does. Disconnecting a provider likewise leaves everyone already copied on that list (the dashboard says so)
- [ ] The first name of a pending contact asking again overwrites the earlier one; no merge of an email and a phone into one person; no CSV import
- [ ] Migration 0005 has never run on real Cloudflare D1; the load test has not been rerun
- [ ] Sync status refresh on the subscribers page is polling (every 4 s for about 2 min while something is waiting); a job backing off from an outage stays "Adding…" until its next try

### Still not built
- [ ] SMS: the service and schema are channel-generic and tested, and the provider interface already carries a channel, but there is **no public SMS route or form** and no SMS adapter (no provider, so no way to confirm by text)
- [ ] Sending marketing email or flows from this app (deliberately out of scope: the merchant's platform sends)

## Phase 6 — Analytics: PER-TOOL ROLLUPS BUILT; ONE COUNTER HAS NO SOURCE YET
- [x] Per-campaign impressions, clicks, dismissals, attributed orders/revenue, holdout experiments (pre-existing, still passing): `api`
- [x] Migration 0006 `metric_counters` (store, campaign, version, day, metric, value; unique per metric per day; no personal data; indexed for the store + date-range read); existing `analytics_aggregates` rows are untouched: `unit` database (`migration-0006.test.ts`, 4)
- [x] Counted through the existing queue consumer, so it inherits event-id dedup, the consent gate and the version-belongs-to-this-store check (a forged version, another campaign's version and another store's campaign are rejected); multi-row upsert, so a 50-event batch adds one statement per 15 counters, not one per event: `api` (`tool-analytics.test.ts`)
- [x] Tool metrics map onto the shared columns (feed item view -> impressions, feed item click -> clicks, recommendation add-to-cart -> add-to-carts) and onto counters where no column exists; one shared definition of each tool's primary metrics (`packages/contracts/src/tool-metrics.ts`) used by the API and the dashboard: `unit` contracts (4)
- [x] `GET /api/v1/stores/:storeId/analytics/tools?from&to` (session, viewer, store-scoped, 404 across tenants, 422 on malformed/reversed/over-366-day ranges): all five tools always present, per-tool metrics and rates (a rate is `null`, never 0%, when nothing was shown), per-campaign drill-down (live or active-in-range campaigns only), attributed orders and revenue under the clicked campaign's tool; its per-tool impressions, clicks and add-to-carts sum to the overall view's totals: `api` (16)
- [x] Per-form signup numbers: sign-up requests and confirmations counted on the server per form (including shoppers who declined analytics), request rate (an estimate: browsers that consented only), confirmation rate, and confirmation emails that failed to send: `api`, `unit` web
- [x] Dashboard: Overview / By tool tabs (keyboard-operable tablist), one section per tool with its own metrics and notes, honest states (not available / no campaigns yet / live but quiet / data), dash for undefined rates, drill-down table with links, failed-confirmation warning, error state: `unit` web (`tool-analytics.test.tsx`, 9). Not run in a browser by this change; the parent's e2e pass should open it
- [x] Store purge removes `metric_counters` and `experiment_stats` (the latter was missing from the purge before): `api`
- [ ] **Browser-reported form submissions (`form_submit_attempt|success|failure`) have no source**: the event types, ingestion and counters exist and are tested, but the storefront SDK does not send them, so they read zero in production and are deliberately not shown on the dashboard. The server-side sign-up request and confirmation counts are the real numbers. Hand-off: the SDK form renderer must emit them, then add `formSubmitSuccesses` to `FORM` in `tool-metrics.ts`
- [ ] No time series or charts (totals per range only); no SMS metrics until the SMS tool ships (its section shows "not available" and its metric list is the shared form list)
- [ ] Reads sum counters per request with no caching; fine at current volumes, unmeasured under load (the load test has not been rerun)
- [ ] Migration 0006 has never run on real Cloudflare D1

## Phase 7 — AI studio: EXTENDED (generation logic tested against fakes; Gateway/model and one full generation live)
The generation and policy paths ran against `FakeProvider` / `RecordedProvider` (`packages/ai`). A minimal live call through AI Gateway `default` to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` succeeded (42 prompt / 2 completion tokens, 1.53 neurons), and one full toast generation produced a valid draft (775 prompt / 215 completion tokens, `gateway: true`). **Feed, upsell, email and refinement flows have not been run live**, so output quality and cost for the larger tool configs are still unknown. The studio only ever produces a **draft**: publishing keeps its own approval guard.
- [x] Tool selection: the request takes `tool` (`auto` or omitted lets the model choose among shipped tools; `toast|feed|upsell|email` build exactly that tool; `sms` is accepted by the schema but refused with 409 `tool_unavailable` **before** the model is called or a generation is metered, because it is not in `SHIPPED_TOOLS`). A model that builds a different tool than requested, or picks an unshipped one, is rejected. `suggestTool` gives the model a hint only: `unit` ai (89), `api` `ai-tools.test.ts` (30)
- [x] Per-tool config: the prompt carries each tool's schema rules; output is validated by the existing per-tool contracts (`CampaignConfig`). Toast, feed and upsell have one format each, so a missing tool or wrong format is repaired, not rejected: `unit` ai, `api`
- [x] Deterministic repairs the server owns, each reported to the merchant: consent wording (the model **never** writes it; merchant text or a standard template is used), unticked separate consent box, double opt-in, email-only / phone-only fields, privacy link (merchant-supplied or `/privacy-policy` with a warning), dropped terms link, priority capped at 50 so a draft cannot outrank the merchant's campaigns: `unit` ai, `api`
- [x] Policy rejections on every tool: invented discounts (unless authorised), stock/scarcity without known availability, urgency and countdowns, social proof (counts, ratings, best-seller, "N people bought this"), shipping amounts or delivery times the merchant did not supply, markup in copy, model-set images/promotion/experiment/picked products/schedule dates, off-site links, coupon toasts, targeting on product ids not in the catalog, any collection ids: `unit` ai (the claim cases run against all four tools), `api`
- [x] Shipping: a free-shipping toast or shipping-gap recommendation is only accepted with the merchant-supplied threshold, unchanged: `unit` ai, `api`
- [x] Upsell: recommended and excluded products must exist in the catalog the model was shown, and manual picks must be known in stock (unknown and out of stock are rejected): `unit` ai, `api` (including an empty catalog)
- [x] Prompt-injection hygiene: catalog text is JSON data in a fenced block with `<` and `>` escaped, control characters stripped, titles capped, ids and urls the model could not use safely dropped; a hostile title cannot close the fence; the merchant's consent text and privacy URL are never shown to the model; model explanation is stripped of markup and rendered as text: `unit` ai, `api`, `unit` web (no `<img>`/`<script>` created)
- [x] Metering and access unchanged: a rejected output still counts, a refused tool does not, the monthly entitlement applies across tools, the log row records the requested tool: `api`
- [x] Studio UI: tool picker (unshipped tools listed and disabled), per-tool inputs (free-shipping threshold, consent wording, privacy link) validated before a generation is spent, live real-renderer preview with desktop/mobile, "Changed by the server before saving", "Check before you publish", and per-tool facts to verify: `unit` web `studio.test.tsx`
- [x] Conversational refinement: the request carries `campaignId`; the server loads that draft, sends the previous config (without merchant-owned consent/privacy/terms text) and feedback to the model, and updates the same draft. Live campaigns, other stores' campaigns and invalid drafts are refused. The UI has click-to-select on headline/body/button/form, field-scoped instructions, quick suggestions, chat history, and a busy preview overlay: `unit` ai, `api`, `unit` web, `e2e` (generation response mocked)
- [x] Model route: default `@cf/meta/llama-3.3-70b-instruct-fp8-fast` through the auto-created AI Gateway `default` (`AI_MODEL`/`AI_GATEWAY_ID` overridable); response reports the model, token usage and whether the gateway was used: `unit` web, `api`
- [x] **Live AI Gateway/model connectivity**: verified with a minimal direct call through AI Gateway `default` on the default model (42 prompt / 2 completion tokens, 1.53 neurons)
- [x] **One live full generation (toast)**: prompt → live model → policy gate → stored draft; 775 prompt / 215 completion tokens, `gateway: true`, with shorthand/bare-config repairs exercised
- [ ] **Full live generations for feed, upsell, email and refinement**: not executed. Review generations for each, check `max_tokens`, quality, cost, and the model id
- [ ] The studio does not yet suggest a tool in the UI (`suggestTool` only hints the model); collection ids and the product picker are still chosen in the editor, not by the AI
- [ ] The generation log has no `tool` column (the tool is prefixed to the stored prompt); adding one needs a migration
- [x] `e2e` for the studio page: generation, gateway/model display, click-to-select, feedback, same-draft refinement and device switching (AI response mocked so no live model/cost is involved)

## Phase 8 — Commercial readiness: PARTIAL
- [x] Per-tool entitlements enforced on the backend (`api`)
- [x] SDK size budget enforced by the build: core 10,278 B gzip against a 12 KB budget and the "under 15 KB" claim (which now says "core"), 23.0 KB with every tool script, 35 KB total budget. Lazy per-tool loading is built (see Phase 5).
- [ ] Marketing/pricing pages do not yet list the per-tool entitlements (deliberately: unshipped tools must not be advertised)
- [ ] Linux CI run, security review of the new surfaces, docs for the new SDK API (`setCart`, `trackAddToCart`, `destroy`)

## Known flakiness
- `growth.spec.ts` "team › invite by link…" failed once in a full run: it calls `selectOption("editor")` and then immediately `reload()` without waiting for the role request, so it can read the old role. It passed on its own (10/10). Pre-existing; not touched by the upsell work.
- The SDK/web vitest tasks sometimes fail with "Failed to start threads worker … Timeout waiting for worker to respond" when the machine is busy (a developer stack was running). It is a jsdom worker start-up timeout, not an assertion; rerunning passes.
- `pnpm verify` ran the web test task concurrently with the Next build once and it reported "no tests"; run alone it passes. One SDK test run once reported 32 tests instead of 55, and passed 55/55 on three consecutive reruns. Neither has been root-caused.

## Cannot be completed without accounts (see `docs/status.md`)
Cloudflare deploy, Workers AI, Stripe, Resend, Klaviyo, Mailchimp, SMS provider, Shopify, WooCommerce, BigCommerce, legal review, trademark/name search.
