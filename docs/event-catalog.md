# Platform event catalog

The contract is `packages/contracts/src/domain-events.ts`; this page explains it. The bus is
`apps/api/src/services/domain-events.ts`, and subscribers are registered in `apps/api/src/services/subscribers.ts`.

Platform events are **not** storefront analytics beacons (`packages/contracts/src/events.ts`). Beacons are anonymous,
high volume, reported by browsers, and only ever aggregated. Platform events are low volume and record outcomes that
the server or a verified commerce platform confirmed. Each one is stored before it is delivered.

## Rules

1. **Outcomes only.** An event is emitted only after the thing it names is durable (the row is written, the webhook
   signature is verified). An attempted request that failed emits nothing.
2. **Minimal payloads.** Payloads are ids and the facts a consumer needs. They never contain an address, a phone
   number, a name, free text a shopper typed, or a credential. The schemas are `.strict()`, so an extra field is rejected
   instead of being carried along.
3. **Privacy class.** `none`: no link to a person. `pseudonymous`: carries a contact id. Pseudonymous events are deleted
   when that contact is erased and never kept longer than 30 days. Nothing more sensitive is allowed on the bus.
4. **Versioned.** `schemaVersion` comes from the catalog. A breaking payload change means a new version, and both
   versions are accepted until every consumer has moved.
5. **Idempotent publication.** `idempotencyKey` is unique per workspace. If the same outcome is published twice, it is
   recorded once (the second call returns `duplicate: true`).
6. **At-least-once delivery.** Subscribers must be idempotent. Only a subscriber that already **succeeded** for an event
   is skipped on redelivery.

## Envelope

| Field | Meaning |
|---|---|
| `id` | `evt_…`, assigned when recorded |
| `type`, `schemaVersion` | From the catalog |
| `organizationId`, `storeId` | Tenant. The workspace is looked up from the store when the producer does not pass it |
| `occurredAt` / `recordedAt` | When it happened (e.g. order placed) / when the platform recorded it |
| `source` | `api`, `shopify_webhook`, `storefront`, `scheduler`, `system` |
| `correlationId` | The request id (`x-request-id`) of the request that caused it, so it can be matched to logs and audit rows |
| `idempotencyKey` | See rule 5 |
| `privacy` | See rule 3 |
| `payload` | Typed per event type |

## Events (version 1)

| Type | Emitted when | Producer | Idempotency key | Payload | Privacy | Subscribers |
|---|---|---|---|---|---|---|
| `store.connected` | A store row is created | `stores.createStore` | `store.connected:<storeId>` | storeId, platform | none | none yet |
| `store.disconnected` | A merchant disconnects, or Shopify reports `app/uninstalled` | `stores.disconnectStore`, Shopify webhook | time-scoped (merchant) / webhook id | storeId, reason | none | none yet |
| `campaign.published` | A new immutable version is served (publish or rollback) | `campaigns.publish` | `campaign.published:<versionId>` | campaignId, versionId, version, tool, origin | none | none yet |
| `campaign.paused` / `.resumed` | Status changed by a merchant | `campaigns.pause/resume` | `<type>:<campaignId>:<timestamp>` | campaignId | none | none yet |
| `campaign.archived` | First archive only | `campaigns.archive` | `campaign.archived:<campaignId>` | campaignId | none | none yet |
| `order.created` | Shopify sends a verified `orders/create` with a numeric total ≥ 0 and an ISO currency | Shopify webhook | `order.created:shopify:<orderId>:<storeId>` (the order, not the delivery) | platform, externalOrderId, total, currency, placedAt | none | `analytics.record_platform_order` (writes `conversions`) |
| `catalog.products_changed` | One import, one catalog sync page, or one Shopify product webhook created, updated or archived at least one product | `catalog.announceCatalogChange` (import route, `sync.syncCatalogPage`, Shopify `products/*`) | `catalog:<imp_/syn_ id>` or `catalog:shopify:<webhook id>` | origin (import/sync/webhook), created, updated, archived, restockedExternalIds (≤100) | none | none beyond workflows |
| `customer.subscribed` | Double opt-in confirmed on one channel | `contacts.confirmOptIn` | `consent:<consent event id>` | contactId, channel | pseudonymous | none yet |
| `customer.unsubscribed` | Consent revoked on one channel (and the identifier suppressed) | `contacts.revokeConsent` | `consent:<consent event id>` | contactId, channel | pseudonymous | none yet |
| `action.executed` | A registered action ran from an approved request or a workflow run | `actions.runAction` | `action:<request or run id>:<action>:<time>` | action, origin, outcome, requestId?, workflowRunId? | none | none yet |

Every type is also delivered to `workflows.trigger` (`services/workflows.ts`), which starts the store's active
workflows whose trigger matches. It ignores events whose `correlationId` starts with `wfrun:`, so a workflow's own
effects can never trigger a workflow.

Catalog changes are batched on purpose: one event per batch, never per product, so a 100-product import is one row.

Browser-reported purchases (`purchase_observed` beacons) do **not** emit `order.created`. They are spoofable and stay
analytics-only. Both paths write the same `conversions` row (unique per store and order id), so an order is counted once.

### Proposed, not yet emitted

Each of these needs a real producer before it is added to the catalog. None should be published speculatively.

| Type | Needs |
|---|---|
| Per-product catalog or inventory events | Not planned: `catalog.products_changed` is the batched form, and back-in-stock ids are inside it |
| `order.paid`, `order.cancelled`, `order.refunded`, `fulfillment.updated` | Shopify webhook topics plus OAuth (not built) |
| `cart.item_added`, `cart.abandoned` | A server-side cart signal. Browser beacons alone cannot define "abandoned" |
| `campaign.impression`, `campaign.clicked` | Stay as aggregated beacons. Per-impression platform events would be unbounded volume in D1 |
| `review.created`, `loyalty.points_earned` | The modules that own them |

## Delivery

```
producer --(insert, unique per workspace key)--> domain_events [pending]
         --> enqueueDomainEvent({kind:"domain_event", eventId})       (no queue: dispatch inline)
queue consumer --> dispatchDomainEvent:
         for each subscriber of the type not already succeeded:
             run handler -> domain_event_deliveries (succeeded | failed, attempts, lastError)
         all ok  -> domain_events [delivered]
         any bad -> domain_events [failed], throw -> queue retry (max 5, then DLQ)
daily cron --> sweepDomainEvents: re-hand pending (lost enqueue) and failed with attempts < 5, older than 5 minutes
merchant/operator --> POST /stores/:id/platform-events/:eventId/retry   (audited)
```

A failing subscriber never fails the producer. For example, a Shopify webhook still answers 200. The event stays
visible at `GET /api/v1/stores/:storeId/platform-events?status=failed` with each subscriber's outcome. Payloads are
not returned there.

**Replay**: retrying an event re-runs only the subscribers that have not succeeded. To deliberately re-run a
subscriber that already succeeded (for example after fixing a bug in it), delete its row from
`domain_event_deliveries` and retry. That is an operator action, and it is not exposed in the API.

## Retention

- Delivered events: 30 days.
- Pseudonymous events: 30 days in any state, and immediately on that contact's erasure.
- Undelivered events: 90 days.
- Store purge (`shop/redact`, account deletion): all of the store's events.
- Workspace deletion: cascades.

## Adding a subscriber

```ts
// apps/api/src/services/subscribers.ts (or the module's own file, listed in SUBSCRIBERS)
const awardPoints = defineSubscriber({
  name: "loyalty.award_points",          // stable: renaming makes old events look undelivered to it
  events: ["order.created"],
  async handle(d, e) {                     // e.payload is typed for order.created
    // must be idempotent: key any write on e.id or the order id
  },
});
```

A module subscribes to events. It never imports another module's webhook handler or tables. The test
`platform.test.ts › a new module subscribes to paid orders without touching the webhook code` exercises this path
with a fixture subscriber.

## Volume note

Every platform event is one D1 row plus one row per subscriber. At expected volumes (orders, publishes and consent
changes, not page views) this is small. If a store's order volume makes it significant, move `domain_events` to its
own D1 database first. The bus API does not change.

## Planned events (contracts only, not publishable)

`packages/contracts/src/extensions.ts › PLANNED_DOMAIN_EVENTS` defines the payloads future modules will need. They are
deliberately **not** in `DOMAIN_EVENTS`, so `publishDomainEvent` rejects them until the module that emits them is built
and tested (and moves them into the live catalog in the same change). See `docs/extension-points.md`.

| Type | Module | Privacy | Payload |
|---|---|---|---|
| `order.fulfilled` | post-purchase | none | platform, externalOrderId, status (partial/fulfilled), trackingUrl, fulfilledAt |
| `order.refunded` | post-purchase | none | platform, externalOrderId, amount, currency, refundedAt |
| `order.return_requested` | post-purchase | none | platform, externalOrderId, kind (return/exchange), lineCount, requestedAt |
| `review.submitted` | reviews | pseudonymous | reviewId, productExternalId, rating, source, contactId |
| `review.moderated` | reviews | none | reviewId, from, to |
| `loyalty.points_changed` | loyalty | pseudonymous | contactId, delta (non-zero), reason, balance (≥ 0) |
| `referral.attributed` | loyalty | pseudonymous | referrerContactId, externalOrderId, code |

`apps/api/test/extension-points.test.ts` shows a loyalty fixture awarding points exactly once for an order Shopify
delivers twice, using the contract's ledger rules on the live `order.created` event.
