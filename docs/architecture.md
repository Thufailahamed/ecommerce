# ConvertFlow AI — Architecture

## Platform foundation (current, 2026-10-29)

The platform is a modular monolith on Cloudflare Workers, built in these layers:

```
Merchant dashboard (Next.js)  ──►  API Worker (Hono, /api/v1)
                                    ├─ authz: permission catalog, tenant gate        (docs/permissions.md)
                                    ├─ domain services: campaigns, catalog, contacts, analytics, AI, billing
                                    ├─ audit: workspace + store log, correlation ids
                                    └─ platform events: store → queue → subscribers  (docs/event-catalog.md)
Commerce adapters: Shopify webhooks (verified), Woo/BigCommerce catalog sync, Klaviyo/Mailchimp lists
Storefront SDK ──► beacons ──► queue ──► aggregates (raw events never in D1)
```

- Modules talk through domain services and platform events. A module never reads another module's tables or imports
  its webhook handler.
- What exists, what is missing, and the risks are in `docs/platform-audit.md`. The build order is in
  `docs/implementation-roadmap.md`.
- The sections below are the original Phase 0 draft, kept for its verified vendor facts and decisions. Where it
  disagrees with the code (for example, billing is Stripe, and webhooks are handled synchronously), the code and the
  newer docs win.

---

# Original Phase 0 draft

Status: draft for approval. Verified against vendor docs on 2026-10-27 (see "Verified facts").

## 1. Verified facts that shape the design

| Area | Finding | Consequence |
|---|---|---|
| Shopify auth | Embedded apps use managed installation + OAuth2 **token exchange** (session token -> access token). Session tokens last 60s; validate on every request, persist the access token, do not exchange per request. | No redirect-based OAuth callback for the embedded flow. Session-token middleware in the Hono API. |
| Offline tokens | Public apps created on/after 2026-04-01 **must use expiring offline tokens** (90-day refresh token). Non-expiring tokens error from 2027-01-01. | Token storage needs `expires_at`, `refresh_token`, and a refresh job. Tokens are encrypted, in a separate table. |
| Admin API | Pin the API version on every request; unpinned requests default to the oldest supported version. 2026-10 is likely the newest stable, but confirm against live docs. | Pin the version in one config constant and document the quarterly upgrade. |
| `@shopify/shopify-api` | v15.0.1 exists. Its Workers/Hono compatibility is **unverified**. | Spike in Phase 2. Fallback: a thin typed client over `fetch` for token exchange, GraphQL, and HMAC checks (Web Crypto). |
| OpenNext | `@opennextjs/cloudflare` 1.20.x supports all Next.js 16 minors on the Node.js runtime. Node Middleware is unsupported. Worker size cap is 10 MiB compressed on paid. | Use Next 16, no Node Middleware, and watch bundle size. |
| D1 | 10 GB hard cap per DB. Single-threaded per DB. 1,000 queries per invocation. 100 bound params. 30s max query. | See section 4. Raw events must not live in D1. |
| Web Pixel | Docs page not retrieved (404). Treated as sandboxed with no DOM access, as the spec assumes. | Re-verify in Phase 5 before building. |

## 2. Components

```
Merchant browser -> web (Next.js/OpenNext Worker) -> api (Hono Worker) -> domain services -> D1 / R2 / KV / Queues / AI
Storefront       -> theme app embed -> sdk Worker (static JS + cached config) -> local rule evaluation
Web Pixel        -> POST /api/v1/events/batch -> validate + consent -> Queue -> consumer -> dedup -> aggregates
Shopify webhooks -> /api/v1/webhooks/shopify/* -> HMAC check -> idempotency row -> Queue -> consumer
AI studio        -> api -> context builder -> provider adapter -> Zod + policy validation -> draft -> approval -> immutable version
```

- **apps/web**: UI only. It holds no business rules and calls the API with a Shopify session token.
- **apps/api**: the single source of business logic. Routes call services, services call repositories. Every repository query takes a `storeId`.
- **apps/storefront-sdk**: a framework-free bundle plus a config-serving Worker. The published config is an immutable JSON blob in KV, keyed by store and version, with `Cache-Control` and a stale fallback. The SDK never calls an LLM.
- **packages/campaign-engine**: a pure, dependency-free evaluator, shared by the SDK, the live preview, and the server-side validator. This is what keeps the editor preview and the storefront identical.
- **packages/contracts**: Zod schemas for campaigns, rules, events, and API shapes.

## 3. Key decisions and trade-offs

1. **Modular monolith, 4 Workers** (web, api, sdk, pixel/ingest if split later). No microservices.
2. **Immutable versions**: `campaign_versions` rows are never updated. Publishing writes a new version, then the KV config pointer. Rollback re-points to an older version.
3. **Tenancy**: `organization -> store`. All tenant tables carry `store_id`. Repositories refuse queries without it, and there is a cross-tenant test suite.
4. **Billing**: Shopify is the source of truth. A webhook plus a reconciliation cron updates `subscriptions`, and entitlements are derived from it and never trusted from a flag alone.
5. **Attribution**: three separate concepts (observed, attributed with a documented rule, incremental via holdout). Phase 5 ships the first two only.

## 4. D1 and analytics decision

D1 holds transactional data: tenancy, catalog, campaigns, versions, subscriptions, and aggregates. It does **not** hold raw high-volume events.

- Ingest -> Queue -> batched consumer writes **hourly/daily aggregates** to D1 (`analytics_aggregates`), using a few multi-row `batch()` calls per message batch.
- Raw event telemetry goes to Analytics Engine for operational metrics. Optionally, raw events are archived to R2 as NDJSON for replay.
- Dedup uses a unique `event_id` in a short-retention `event_dedup` table, with TTL cleanup by cron.
- **Known limit**: Analytics Engine is sampled and has bounded retention, so it is not the system of record for revenue. Revenue comes from Shopify order webhooks into `conversions`.
- **Migration path**: if one store's traffic saturates the single-writer D1, move aggregates to a sharded D1 per organization (50k DBs allowed) or to ClickHouse/BigQuery behind the same `AnalyticsStore` interface.

## 5. Initial schema (summary)

Tables are as listed in the spec section 11. Conventions: `id` is a TEXT ULID, `shopify_*_id` is TEXT (GID), and every row has `created_at`/`updated_at`. Tenant tables have `store_id NOT NULL` and a composite index starting with it.

Key uniques: `stores(shop_domain)`, `products(store_id, shopify_product_id)`, `product_variants(store_id, shopify_variant_id)`, `webhook_events(store_id, shopify_webhook_id)`, `campaign_versions(campaign_id, version)`, `campaign_events(store_id, event_id)`, `usage_records(store_id, metric, period)`.

Secrets: `integration_credentials` (encrypted access and refresh tokens, `expires_at`) is separate from `integrations`.

## 6. Core API contracts (shape)

All responses use `{ data }` or `{ error: { code, message, requestId } }`. Mutations accept an `Idempotency-Key`.

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/v1/campaigns` | session, role >= editor | creates a draft |
| `POST /api/v1/campaigns/:id/validate` | session | the engine plus policy checks, returns warnings |
| `POST /api/v1/campaigns/:id/publish` | session, role >= admin | requires `approvedVersionId`, writes an audit log, entitlement checked |
| `POST /api/v1/campaigns/:id/rollback` | session, role >= admin | re-points to a prior version |
| `POST /api/v1/campaigns/:id/generate` | session | rate limited, usage metered, the result is always a draft |
| `POST /api/v1/events/batch` | public key + Turnstile or origin check | size capped, consent required, schema version checked |
| `POST /api/v1/webhooks/shopify/:topic` | HMAC | idempotent, returns 200 fast, queued |

Full OpenAPI will be generated from route schemas with `@hono/zod-openapi`.

## 7. Design system direction

- Type: Inter (UI), Geist Mono (IDs and numbers). One optional display face (Manrope) for headings only.
- Colour: warm off-white canvas `#F7F5F0`, ink `#16181A`, signature forest green `#14513B`, amber and red for state only. Chart palette to be validated through the dataviz skill. Dark tokens are defined from day one.
- Shell: collapsible sidebar, store switcher, command menu, and a page header with one predictable primary action. Flat layout with hairline dividers and limited use of cards.
- Signature screen: the campaign editor is three panes (config | live preview using `campaign-engine` and the SDK renderer | validation and publish rail).

## 8. Backlog (dependency order)

1. Monorepo, tsconfig strict, lint, vitest, CI, wrangler configs (staging/prod).
2. `contracts` (campaign, rules, events) and `campaign-engine` (with unit tests). These are pure and testable first.
3. `database` (Drizzle schema, migration 0001) and tenant-scoped repositories.
4. API skeleton: error layer, request IDs, session-token middleware, health endpoint.
5. Shopify: token exchange, webhook HMAC and idempotency, catalog sync.
6. Campaign CRUD, versions, publish/rollback, KV config publishing.
7. SDK, theme embed, bundle-size measurement.
8. Pixel, ingestion, queues, aggregates, dashboard.
9. AI provider, studio.
10. Billing, privacy webhooks, security tests.

## 9. Blocking decisions (need the owner)

1. **Shopify Partner account, dev store, and Cloudflare account** are needed for Phases 2 and later. Until then, development uses local miniflare/D1 and fixtures.
2. **AI provider**: Workers AI (via AI Gateway) or an Anthropic/OpenAI key. The adapter makes this replaceable, but one is needed for Phase 6.
3. **Billing path**: Shopify managed pricing (plans configured in the Partner Dashboard) versus the Billing API (plans in code). Recommendation: the Billing API, since entitlements need to be enforced and reconciled in our own code.
