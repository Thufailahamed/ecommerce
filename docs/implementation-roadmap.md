# Foundation roadmap (dependency order)

The starting point is `docs/platform-audit.md`. Legend: **Done** means built and tested here (unit/integration tests on
in-memory SQLite and jsdom; nothing below has run on real Cloudflare infrastructure unless it says so). **Needs a
deploy** or **Needs accounts** cannot be finished on a development machine.

The rule for every phase: wrap and centralise what already works. Do not rebuild it, and do not ship an empty package
or an interface without a real implementation behind it.

## Phase 0: audit and architecture (done)
`docs/platform-audit.md`, plus this plan.

## Phase 1: shared platform foundation

| Item | State | Notes |
|---|---|---|
| Permission catalog + central authorization | **Done** | `docs/permissions.md` |
| Audit service (workspace, actor type, correlation id, summary; paginated store and workspace logs) | **Done** | migration 0008 |
| Entitlement service | **Done** | `services/entitlements.ts`: `entitlementsFor`, `requireCapability`, capability catalog with `ga`/`preview`/`planned` availability (`contracts/entitlements.ts`), preview flags in `organization_features` (0009). Campaign publishing, active-campaign capacity, AI, restock and pageview metering use it |
| Usage metering service | **Done** | `recordUsage` / `quota` / `requireQuota` over `usage_records` with a typed metric list (pageviews, ai_generations, notifications, workflow_executions) |
| Integration registry | **Done** | Capability-typed provider catalog (`contracts/integrations.ts`) with built vs planned capabilities and verification state; run-time adapters read live state from the tables each integration already owns (`services/integrations.ts`). Deliberately no second `integrations` table: a copy of connection state would drift |
| Dashboard module registry | **Done** | `apps/web/lib/modules.ts`: route, nav, permission and capability per module; preview modules appear only when the workspace holds the capability |
| Commerce core: order reference | Needs accounts (Shopify OAuth) | `order_refs` filled from `order.*` events. Do not mirror Shopify orders |

## Phase 2: event platform

| Item | State |
|---|---|
| Envelope, catalog, strict payloads, privacy classes | **Done** |
| Store-then-deliver, idempotent publish, queue hand-off, per-subscriber delivery records, retry, sweep, retention, erasure | **Done** |
| Producers: store, campaign lifecycle, Shopify orders, consent, actions | **Done** |
| Catalog events (batched per import, sync page or webhook) | **Done**: `catalog.products_changed` |
| Platform-event status endpoint + audited retry | **Done** |
| Queue-path delivery on real Cloudflare Queues, alert on DLQ depth | Needs a deploy |
| Dedicated queue for platform events | Only if volume or retry semantics require it (the `enqueueDomainEvent` seam exists) |

## Phase 3: workflow engine primitives (done, preview)
`docs/workflow-engine.md`. Versioned Zod-validated definitions; event and daily-schedule triggers; a closed condition
set; actions only from the registry, each declaring permission and side effects; execution as a bus subscriber with
one run per `(version, trigger)`; hourly and monthly caps; loop prevention by correlation id; audit and per-step run
records; an approval queue. Dashboard: `/app/automations` (presets + JSON editor, review-before-activate, runs,
approvals).

## Phase 4: AI platform (done)
`packages/ai/src/tasks.ts`: a task registry (`campaign.generate`, `insights.summarize`, `objective.plan`) with output
schemas and token caps. `services/ai-tasks.ts`: an authorised context assembled from domain services by scope (no
contacts or orders, ever), one governed `runAITask` path (capability → allowance → bounded call → schema → business
rules → metered and logged with provider, model, tokens, estimated cost, duration), and number-grounding against the
evidence. Migration 0011.

## Phase 5: analytics and privacy (done)
- Metric registry with source, denominator, window and limitations: `contracts/metrics.ts`, `docs/analytics-definitions.md`.
- Consent facade `canContact(store, contact, channel)`: `services/consent.ts`, used by the workflow condition.
- Analytics Engine for operational telemetry: needs a deploy (not wired).

## Phase 6: AI Commerce Manager (done, preview)
`services/commerce-manager.ts`, `POST /stores/:id/ai/plans`, dashboard `/app/manager`. The model proposes at most five
registry actions. Each must pass the origin rule, its input schema, store-scoped rules (an active campaign of this
store), the campaign policy gate with no promotion authorised, and evidence checks (known metric keys, no invented
numbers). Survivors become pending requests grouped by `planId` that expire after 3 days. A request runs only when a
member with the action's permission approves it, on their authority. Proposals are recommendations and drafts, plus
pausing a campaign.

## Phase 7: verification (not done: needs infrastructure)
- Rerun Playwright, the load test (now with platform events) and the backup drill on the 0011 schema.
- Apply 0008-0011 to a staging D1.
- Confirm that correlation ids appear under `nodejs_compat`, and queue-delayed workflow runs on real Queues.
- Live AI runs of `insights.summarize` and `objective.plan` (only campaign generation for the toast tool has run live).
- Linux CI.
