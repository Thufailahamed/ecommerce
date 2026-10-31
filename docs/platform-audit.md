# Platform audit (2026-10-29)

Written before any foundation change, against the repository as it stood, then updated with what this round built
(section 6). Sources: the code itself, `docs/status.md`, `docs/checklist.md`, `docs/architecture-v2.md`, and checks
actually run on this machine (Windows, Node 24, pnpm 12). Nothing below is claimed from a file's existence alone.

## 0. Baseline checks (run before any edit)

| Check | Result |
|---|---|
| `pnpm verify` (typecheck + test + build, 24 turbo tasks) | 21/24. The 3 not passing were `storefront-sdk#test`, which hit the known jsdom "Timeout waiting for worker to respond" start-up error (106 tests passed, one worker never started), plus the two web tasks that turbo then skipped |
| `storefront-sdk` tests, rerun alone | **140/140** |
| `web` tests / typecheck / production build, run alone | **133/133**, typecheck clean, `next build` succeeded |
| Per-package unit/integration tests in the verify run | contracts 54, database 29, campaign-engine 40, ai 89, integrations 25, api 291 (+1 skipped: the opt-in live AI probe) |
| Playwright e2e, load test, backup drill, OpenNext build, `pnpm audit` | **Not run in this round** (they need built apps, ports and, for OpenNext, symlinks this machine refuses) |

So the baseline is green, with the SDK flake documented in `docs/checklist.md` ("Known flakiness") reproduced once.

## 1. What exists

| Area | Where | State |
|---|---|---|
| Monorepo | pnpm workspace + turbo; `apps/{web,api,storefront-sdk,shopify-app}`, `packages/{contracts,campaign-engine,database,ai,integrations}`, `tests/{e2e,load}` | Modular monolith, 3 deployable Workers (web via OpenNext, api, sdk static) |
| Web | Next.js 16, React 19, Tailwind 4, lucide-react, OpenNext for Cloudflare | Dashboard, campaign workspace (folders, groups, templates, five steps), AI studio, analytics, subscribers, settings, marketing site. **No shadcn/Radix, TanStack Query, React Hook Form or Motion**: a hand-built `components/ui.tsx` design system and a small `use-api` hook instead |
| API | Hono 4.13 on Workers, `apps/api/src/app.ts` (one router) + `services/*` | Versioned `/api/v1`, `{data}` / `{error:{code,message,requestId}}`, request ids, structured request logs, CSRF origin check, per-isolate rate limits, OpenAPI generated from the route list and kept in sync by a test |
| Database | D1 + Drizzle, migrations 0000-0007 (generated, plus hand-written backfills), each with a migration test | 34 tables: identity/tenancy, catalog, campaigns + immutable versions, analytics aggregates, contacts/consent/suppression, provider sync, billing/usage, audit |
| Tenancy | `organizations -> memberships(role) -> stores`; `auth.requireStore(min role)` per route | 404 for foreign/missing stores, 403 for under-privileged members, 48 store routes gated |
| Tools | `SHIPPED_TOOLS = toast, feed, upsell, email` | **NotiPop (toast), NotiFeed (feed), NotiSell (upsell), NotiEmail (email) shipped; NotiSMS not built** (schema, contract and plan entries exist; publish and the public route refuse it). Code uses neutral keys because the Noti* names are a competitor's marketed names (`architecture-v2.md` §6) |
| Storefront | `apps/storefront-sdk`: 10 KB core + per-tool chunks loaded on demand, size budget enforced by the build | Shared deterministic engine (`packages/campaign-engine`) with slot arbitration |
| Analytics | Beacon -> KV site lookup -> Queue -> consumer: dedup ledger, daily aggregates, `metric_counters`, last-click attribution, holdout experiments | Raw events are never stored in D1 (a decision already taken and load-tested locally) |
| AI | `packages/ai`: provider interface, Workers AI adapter through AI Gateway, prompt builder with injection hygiene, per-tool policy validator; generations metered in `ai_generations` + `usage_records` | Output is always a draft; publish has its own approval guard. One live generation (toast) was verified; the rest against fakes |
| Integrations | Catalog: Shopify (webhook-normalised), WooCommerce and BigCommerce (live sync, fake-tested). Lists: Klaviyo + Mailchimp adapters behind one interface | Provider credentials AES-GCM encrypted; "verified" only after a live check passes |
| Billing | Stripe checkout/portal/webhooks; plans in `contracts/plans.ts` with per-tool entitlements; `effectivePlan` falls back to free when unpaid | Fake/fixture-tested only |
| Privacy | Contacts + append-only consent log, per-channel hashed suppression, double opt-in, erasure, retention purges, store purge, Shopify GDPR webhooks | Email and SMS consent are separate channels |
| Jobs | One queue (analytics batches + provider sync jobs) with DLQ; one daily cron (purges, republish, restock drain, sync sweep) | No R2, Analytics Engine or Durable Objects in use |
| Shopify | HMAC-verified webhook endpoint (uninstall, products, orders, GDPR); theme embed + web pixel drafts | **OAuth/token exchange, Admin API sync and Shopify Billing are not built**; the app files are unverified drafts |

## 2. Working and verified (by tests that were executed)

Everything in the baseline table above, i.e. the API integration suite (real migrations on in-memory SQLite, a real
Hono app), the SDK runtime in jsdom, the web components, and the per-migration tests. Earlier rounds additionally
ran 88 Playwright journeys against the real Worker runtime (`docs/status.md`); those were **not rerun now**.

Not verified against real third parties at all: Cloudflare deploy, Stripe, Resend, Klaviyo, Mailchimp, Shopify,
WooCommerce, BigCommerce, and AI generations other than one toast (`docs/status.md` "Launch blockers").

## 3. Partially implemented

- **Authorization**: correct, but expressed as a minimum role literal at each of 48 call sites plus three hand-written
  owner checks for billing and a duplicate role ladder in `team.ts`. No catalog the dashboard could read, so the UI
  could only guess from the role.
- **Audit log**: 14 inline `insert(auditLogs)` calls across 8 files. Store-level rows had no `organization_id` (only `store.created`
  set it), no request/correlation id, no actor type (webhook and system rows were indistinguishable from "unknown
  user"), and `GET /stores/:id/audit` returned the **oldest** 100 rows because it had no ordering.
- **Shopify**: webhook processing only, written against documented payloads; never run against Shopify.
- **SMS**: data model and contract only.
- **Per-tool analytics**: browser form-submit counters have no source yet (`checklist.md` Phase 6).
- **Entitlements**: `PLANS` is the single source and enforced server-side, but checks are spread over services
  (`assertEntitled`, `assertActiveCapacity`, AI metering, restock quota, pageview metering) rather than one service.

## 4. Missing (relative to the foundation brief)

| Capability | Status before this round |
|---|---|
| Internal platform event bus (typed envelope, subscribers, delivery records, replay) | Missing. Modules called each other directly (the webhook wrote conversions itself) |
| Workflow engine | Missing |
| AI action registry, approval queue, AI Commerce Manager | Missing (AI generation exists for campaign drafts only) |
| Generic integration registry (capability-typed adapters, connection health table) | Missing: catalog connectors and list providers have separate, non-shared shapes |
| Customer identity abstraction | Contacts exist per store; no anonymous-session reference, no platform customer reference (deliberately: no verified source) |
| Order reference model | `conversions` only (order id, total, currency, session, experiment arm) |
| Central entitlement service + usage metering service | Missing as a service (see §3) |
| Module registry / feature flags for the dashboard | Partial: `apps/web/lib/tools.ts` registers the five tools with a `shipped` flag; no generic module registry or permission-aware navigation |
| Operational status page | Missing |
| Analytics Engine / R2 archive | Missing (planned in `architecture.md` §4, never wired) |

## 5. Must be preserved

1. Immutable `campaign_versions`, the approval-staleness guard on publish, rollback-as-new-version, the kill switch.
2. The hot path: event ingestion never touches D1 synchronously (KV + queue), and the consumer's batched writes.
3. The consent model: append-only consent events, per-channel suppression by hash, double opt-in, "pending is never exported".
4. Tenancy semantics: 404 for anything outside the caller's workspace, 403 for an under-privileged member.
5. The storefront bundle budget (core under 12 KB gzip): nothing in this work may be imported by the SDK.
6. Honest labelling: nothing third-party is "verified" until it ran against the real service.
7. Existing API response shapes the web app reads.

## 6. Foundation changes: proposed, and what this round built

Dependency order, smallest set that unblocks every later module (full plan: `docs/implementation-roadmap.md`).

**Built and tested in this round (Phase 1 core + Phase 2 event platform, one vertical slice):**

| Change | Files | Evidence |
|---|---|---|
| Permission catalog (24 permissions, store and workspace scopes, one role ladder), shared by API and dashboard | `packages/contracts/src/permissions.ts` | contracts `platform.test.ts`: the ladder holds, and every threshold equals what the routes enforced before |
| Central authorization: `authorizeStore`, `authorizeOrganization`, `can()`. All 48 store routes, store creation, billing and invites go through it; `requireStore` is gone | `apps/api/src/services/authz.ts`, `app.ts`, `stores.ts` | The route rewrite asserted each permission's threshold equals the old literal; api `platform.test.ts` (outsider 404 / member 403 / cross-workspace `can()`) and the full existing suite |
| Audit service: workspace id always filled (from the store if needed), actor type, correlation id = the request id, sanitised summary; newest-first paginated store and workspace audit endpoints | `services/audit.ts`, `lib/request-context.ts`, migration 0008 | api `platform.test.ts`; migration test backfills existing rows |
| Platform event bus: versioned typed envelope, catalog of 9 events with strict payload schemas and privacy classes, stored before delivery, idempotent per workspace key, queue hand-off, per-subscriber delivery records, retry/sweep/replay, retention, erasure | `packages/contracts/src/domain-events.ts`, `services/domain-events.ts`, `services/subscribers.ts`, `index.ts` (queue + cron) | api `platform.test.ts` (duplicate delivery, failing subscriber, retry not re-running successes, lost enqueue + sweep, extension fixture, erasure, retention, store purge) |
| Real producers: store connected/disconnected, campaign published/paused/resumed/archived, Shopify order created, customer subscribed/unsubscribed | `stores.ts`, `campaigns.ts`, `shopify.ts`, `contacts.ts` | as above |
| Real consumer: platform orders become conversions through a subscriber instead of inside the webhook handler | `subscribers.ts` | the pre-existing "no double counting" webhook test still passes through the new path |
| Operational visibility: per-store platform-event status with each subscriber's outcome, and an audited retry | `GET /stores/:id/platform-events`, `POST .../retry` | api `platform.test.ts` |
| **Bug fix (cross-tenant write)**: Shopify `products/delete` archived every store's product with that external id | `shopify.ts` | api `platform.test.ts` (two shops, same product id) |
| **Bug fix**: store audit listing returned the oldest rows | `services/audit.ts` | api `platform.test.ts` |

**Built later the same day** (originally listed here as proposed): entitlement and usage service, integration
registry, dashboard module registry, catalog platform events, workflow engine with the action registry and approval
queue, AI task registry with a governed path, metric registry, consent facade, and the AI Commerce Manager. Migrations
0009-0011. See `docs/status.md` (top section) for what was verified, and `docs/implementation-roadmap.md` for what
still needs a deploy or accounts.

## 7. Migration and compatibility risks

| Risk | Mitigation / status |
|---|---|
| Migration 0008 adds three columns to `audit_logs` and two tables; it backfills `actor_type` and `organization_id`. Additive only, no rewrite of existing data beyond those columns | Migration test runs it over seeded pre-0008 rows. **Never applied to real Cloudflare D1** |
| Behaviour change: a workspace member below admin who tries to create a store now gets **403** instead of 404 (outsiders still get 404). Matches every other workspace route | Covered by a test; no existing test or UI relied on the 404 |
| Behaviour change: `GET /stores/:id/audit` now returns newest first with `nextCursor`, and rows carry the new fields. No dashboard screen reads it | Documented in OpenAPI |
| Behaviour change: a Shopify order with an unusable amount or a non-ISO currency is now ignored instead of being stored with a truncated currency | Covered by a test |
| Conversions from Shopify orders are now written by a subscriber: with a queue they arrive seconds later instead of inside the webhook request. A failing subscriber no longer fails the webhook (Shopify no longer retries); the platform event is retried instead (queue retries, daily sweep, manual retry) | Covered by tests; queue-path delivery has **not** run on real Cloudflare Queues |
| `hono/context-storage` uses `AsyncLocalStorage`; it relies on the `nodejs_compat` flag already in `wrangler.jsonc` | Verified under Node in tests only; first deploy must confirm correlation ids appear |
| Event volume in D1: one row per platform event (orders, publishes, consent changes), not per page view. Retention 30 days (delivered or pseudonymous), 90 days otherwise | Cheap at current scale; revisit if order volume per store is high (`docs/event-catalog.md`) |
| One queue now carries three message kinds | Messages are discriminated; unknown shapes still go to analytics processing as before |
