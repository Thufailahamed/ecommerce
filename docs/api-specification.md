# API

The API is described by an OpenAPI 3.1 document served by the API itself:

```
GET /api/v1/openapi.json        (public)
```

It is built from the same Zod request schemas the handlers validate with, and `apps/api/test/openapi.test.ts` fails if any route that the server serves is undocumented, or any documented route is not served. Keeping a hand-written copy here would drift, so this file only records conventions:

- Responses: `{ "data": ... }` or `{ "error": { "code", "message", "details?", "requestId" } }`. Every response carries `x-request-id`.
- Auth: session cookie `cf_session` (HttpOnly). State-changing app requests must also carry `Origin` equal to the web app origin (CSRF). Webhooks authenticate by signature; the events and notification endpoints are public and credential-less (CORS `*`).
- Roles: viewer < editor < admin < owner (`x-minimum-role` in the document). Foreign or unknown resource ids return **404**, never 403, so ids cannot be probed across tenants.
- Plans: limits (stores, live campaigns, AI drafts, pageviews, restock alerts, experiments) are enforced server-side and returned as `402 plan_limit`.
- Idempotency: event ingestion and webhooks are idempotent on their delivery/event ids; publishing is guarded by `approvedUpdatedAt` (409 `stale_approval`).
- Analytics: `GET /stores/:storeId/analytics` is the overall view (totals, per-campaign, per-form, experiments); `GET /stores/:storeId/analytics/tools` is the same data grouped by tool (`toast`, `feed`, `upsell`, `sms`, `email`, always all five) with each tool's primary metrics (defined once in `packages/contracts/src/tool-metrics.ts`) and a per-campaign drill-down. Both take `from` and `to` (`YYYY-MM-DD`; the tools route allows at most 366 days). A rate is `null` when its denominator is zero. Views, clicks and add-to-carts come only from visitors who consented to analytics; sign-up requests and confirmations are counted on the server. Attributed revenue is last click within 7 days and is not incremental.
- Public endpoints that must not leak state (`/notifications/restock`, `/auth/forgot-password`) answer identically whatever the account, plan or subscription state.
