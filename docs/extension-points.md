# Extension points for future modules

The brief's future domains are **not built**. This page records how each would attach to the shared foundation, and what
proves that it can. Contracts live in `packages/contracts/src/extensions.ts`; fixtures in
`packages/contracts/src/extensions.test.ts` and `apps/api/test/extension-points.test.ts`.

Rules every module follows:
- It subscribes to platform events (`services/subscribers.ts`), never to another module's webhook handler.
- Its events are added to `DOMAIN_EVENTS` (and become publishable) only in the change that builds and tests the module.
  Until then they sit in `PLANNED_DOMAIN_EVENTS`, which `publishDomainEvent` cannot record.
- It is gated by its capability in `CAPABILITIES`. `loyalty.enabled`, `reviews.enabled` and `post_purchase.enabled`
  are `planned`: never granted, whatever the plan or feature flag (tested), so no merchant can see a stub.
- Contacts, consent (`canContact`), suppression, audit, entitlements, usage metering and the AI governance path are
  reused, never re-implemented.

| Domain | What exists to build on | Contract defined here | Proven by | Missing before it can ship |
|---|---|---|---|---|
| Marketing automation | Workflow engine (event and daily triggers, delays, consent-aware conditions, approvals, caps, loop prevention), action registry | — | `test/workflows.test.ts` | Sending channels: this app sends no marketing email or SMS; actions would call the merchant's provider |
| AI shopping assistant | Catalog service (tenant-scoped products, variants, availability), recommendation service (in-stock only, never fabricated), add-to-cart adapters in the SDK, the AI governance path (authorised context, schema validation, metering) | — | `test/upsell.test.ts`, `test/ai-manager.test.ts` | A conversational surface, product search ranking, an evaluation set |
| Loyalty and referrals | `order.created` events (idempotent per order), contacts | `LoyaltyLedgerEntry`, `Reward`, `ReferralAttribution`, `pointsForOrder`, `applyLedger` (idempotent, no overdraft, refunds take back at most the balance), events `loyalty.points_changed`, `referral.attributed` | A fixture subscriber awards points once for an order Shopify delivers twice | Customer identity (linking orders to contacts needs a customer scope and consent), storage, redemption via the platform's discount API |
| Reviews / UGC | Products, contacts, moderation-style approvals | `Review` (rating 1-5, source required, platform id for imports, verified purchase only with an order), moderation state machine (`canModerate`, only approved is public), events `review.submitted`, `review.moderated` | Contract tests. **No review is created anywhere: reviews may only come from real customers or a review platform import** | Collection form, import adapter (`ReviewSource` in `packages/integrations`), moderation UI |
| Post-purchase | `orders/create` webhook, platform events | `order.fulfilled`, `order.refunded`, `order.return_requested`, `ReturnRequest` | Contract tests | Shopify `read_fulfillments`/`read_returns` scopes and their webhooks; tracking page |
| Product intelligence | Catalog (products, variants, availability, prices, collections), conversions (order totals), per-campaign analytics | — | Existing analytics tests | **Cost and margin are not available**: no platform sync carries cost, and margin-aware recommendations stay a store-level discount ceiling until a cost source (Shopify `InventoryItem.unitCost` with `read_inventory`) is synced and verified |
