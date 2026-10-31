# Operations: observability, alerting, incidents, backup and recovery

Nothing here has run in production (no Cloudflare account). It describes what the code emits and what to wire up.

## What the code emits
| Signal | Where | Notes |
|---|---|---|
| One structured log line per request: `requestId`, method, path, status, ms | `apps/api/src/app.ts` | No query strings or bodies (they can carry tokens). `x-request-id` is returned on every response and is the Cloudflare ray id when present |
| Error lines `{"level":"error", where, message}` | queue consumer, provider sync, SMS verification, Shopify, email | Messages never include an address, number, token or a provider's response body |
| Correlation id on audit rows and platform events | `lib/request-context.ts` | The request id, or `wfrun:<id>` / `aireq:<id>` for automations |
| Platform event delivery status | `GET /stores/:id/platform-events?status=failed`, Operations page | Per-subscriber outcome and an audited retry |
| Integration health | `GET /stores/:id/integrations`, `POST .../:provider/health` | Shopify and Klaviyo/Mailchimp checks are live, read-only calls |
| Provider sync status | Subscribers page, `provider_sync_jobs` | Failures are visible per contact; retry from the page |
| Usage vs plan | `GET /billing/subscription` | Including `sms_verifications` |

## Alerts to configure (Cloudflare dashboard → Notifications, plus Workers Logs queries)
| Alert | Threshold to start with | Why |
|---|---|---|
| DLQ `convertflow-events-dlq` depth | > 0 for 15 min | A batch failed 5 times: analytics, a sync job or a platform event is stuck |
| Worker 5xx rate (api) | > 1% over 5 min | Bugs or a dependency down |
| Queue consumer errors / backlog age | backlog older than 10 min | D1 is a single writer: sustained backlog means capacity work (docs/architecture.md) |
| Cron `0 3 * * *` failed | any | Retention purges, restock drain, sync and event sweeps did not run |
| `level":"error","where":"sms_verification_start"` rate | > 20/hour | Twilio outage or abuse; check Twilio spend |
| `where":"provider_sync_run"` / `provider_erasure` | any | A list provider is rejecting us |
| Shopify webhooks `status=failed` (webhook_events) | any in 1 hour | Usually an unhandled payload shape |
| Pageview hard stops (orgs at 100% of `pageviews`) | daily report | Merchants whose campaigns stopped serving |

## Incident response
1. **Own it**: one incident lead (name them in `docs/production-launch-checklist.md` before launch); a channel; a timeline.
2. **Contain**:
   - Bad campaign or SDK behaviour on storefronts: per-store kill switch (Settings → Delivery) or pause the campaign; global:
     roll the SDK Worker back (`wrangler rollback` in `apps/storefront-sdk`). Stores fall back to "show nothing" when the API
     is down; the SDK never blocks rendering.
   - API regression: `wrangler rollback` (api). Migrations are additive; never roll a migration back by hand, restore
     instead (below).
   - Leaked secret: rotate it (`wrangler secret put`). `CREDENTIAL_KEY` rotation makes stored tokens unreadable: merchants
     must reconnect Shopify/WooCommerce/BigCommerce/Klaviyo/Mailchimp; plan a re-encryption job before rotating deliberately.
     Shopify: rotate the client secret in the Partner Dashboard and update `SHOPIFY_API_SECRET` (webhooks fail until both match).
   - Abuse of public signup endpoints: Cloudflare rate-limiting rule on `/api/v1/notifications/*`; Twilio spend cap.
3. **Assess personal data impact**: which tables (contacts, consent_events, users, sessions), which stores, which period.
   The audit log (`/organizations/:id/audit`) and request ids tie actions to actors.
4. **Notify**: affected merchants (they are the controllers of their shoppers' data); supervisory authorities within the
   applicable deadline (GDPR: 72 hours) when the processor agreement or law requires it; Shopify if Shopify merchant data
   is involved. Counsel decides the wording.
5. **Recover and review**: post-incident review within 5 working days, with a regression test for the cause.

## Backup and recovery
- **D1 Time Travel** keeps 30 days of point-in-time history. Before any production migration, record a bookmark
  (`wrangler d1 time-travel info DB --env production`; the deploy workflow prints it).
- **Restore**: `wrangler d1 time-travel restore DB --env production --bookmark <bookmark>` (or `--timestamp`). This replaces
  the database: stop the queue consumer first (deploy with the consumer removed, or pause the queue) so it does not write
  during the restore, then republish storefront configs (the daily cron does it; or redeploy and let the next config
  fetch rebuild from D1).
- **Off-site copy**: `wrangler d1 export DB --env production --remote --output backup-<date>.sql` weekly to storage you
  control (encrypted: it holds shopper emails and phone numbers).
- **Drill**: `node scripts/backup-drill.mjs` proves an export restores row-for-row into an empty database (local). Rerun
  it against the current schema (0013) and against a staging export before launch; it last ran before migration 0003.
- **KV** holds only derived data (configs, site lookups, OAuth states): it is rebuilt from D1 on a miss.
- **Recovery objectives** (targets, not measured): RPO ≤ 1 minute with Time Travel; RTO ≤ 1 hour.

## Rollback
| What | How | Data impact |
|---|---|---|
| API Worker | `wrangler rollback --env <env>` | None; the database keeps the newer schema, which older code tolerates because migrations are additive |
| SDK | `wrangler rollback` in `apps/storefront-sdk` | Core and tool scripts roll back together (content-hashed names) |
| Web | `wrangler rollback` in `apps/web` | None |
| A campaign | Rollback publishes an old version as a new immutable version | History kept |
| A migration | Not reversible in place: restore from Time Travel | Loses writes after the bookmark |
