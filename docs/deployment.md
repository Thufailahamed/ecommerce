# Deployment runbook

Not yet executed against a real Cloudflare account. Follow in order and tick each item.

## 1. Provision (once per environment)
```
wrangler d1 create convertflow-<env>
wrangler kv namespace create CONFIG_KV
wrangler queues create convertflow-events-<env>
wrangler queues create convertflow-events-dlq-<env>
```
Put the ids in `apps/api/wrangler.jsonc` (staging/production under `env`). AI Gateway uses the auto-created `default` gateway; change `AI_GATEWAY_ID` in `apps/api/wrangler.jsonc` if you want a named gateway. Keep the default Workers AI model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` unless you have measured a better/cheaper one for your traffic. Create a Resend account, verify a sending domain (SPF + DKIM), and an API key.

## 2. Secrets (`wrangler secret put <NAME> --env <env>`) and vars
| Name | Needed for | If missing |
|---|---|---|
| `CREDENTIAL_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts platform tokens and MFA secrets; signs unsubscribe links | MFA, catalog connectors and restock alerts are unavailable (fail closed) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Password reset, email verification, invites, restock alerts | Those features return 503/degrade; **email verification is not enforced** and the app says so |
| `API_ORIGIN` (var) | Public API origin, e.g. `https://api.example.com`, used in links emailed to shoppers | Restock alerts unavailable |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER/GROWTH/SCALE` | Checkout, portal | Plan changes disabled |
| `SHOPIFY_API_SECRET` | Shopify webhook verification | Shopify webhooks return 503 |
| `TURNSTILE_SECRET` (+ `NEXT_PUBLIC_TURNSTILE_SITE_KEY` at web build) | Bot protection on signup | Signup unprotected |
| `RESEND_BASE_URL` (var, optional) | Point email at a mock or staging provider | Defaults to https://api.resend.com |
| `KLAVIYO_BASE_URL`, `MAILCHIMP_BASE_URL` (vars, optional) | Point a list provider at a mock or staging origin. A connection made through one is **never marked verified** | Default to the real services. Connecting a provider needs `CREDENTIAL_KEY`: the merchant's API key is stored encrypted with it |

List-provider sync jobs travel on the same queue as analytics (`convertflow-events`); the consumer re-queues a job that must wait with a delay, so keep `max_retries` for genuine crashes only. The daily cron also re-queues any pending sync job a lost enqueue left behind.

Set `ALLOWED_ORIGIN` to the web app's origin. Web and API must share a registrable domain (`app.x.com` + `api.x.com`) because the session cookie is `SameSite=Lax`.

## 3. Database
`wrangler d1 migrations apply convertflow-<env> --remote`. Migrations are generated with `pnpm --filter @convertflow/database db:generate`, reviewed in PRs, never auto-pushed. Before a destructive migration take a Time Travel bookmark.

## 4. Deploy
1. `pnpm verify`, then `pnpm e2e` green on CI.
2. API: `cd apps/api && wrangler deploy --env <env>`.
3. SDK: `pnpm --filter @convertflow/storefront-sdk build && cd apps/storefront-sdk && wrangler deploy`.
4. Web (public URLs are baked in at build time): `NEXT_PUBLIC_API_URL=https://api.<domain> NEXT_PUBLIC_SDK_URL=https://sdk.<domain> pnpm --filter @convertflow/web cf:build && cf:deploy`. The CSP's `connect-src` is derived from `NEXT_PUBLIC_API_URL`.
5. Stripe: add endpoint `https://api.<domain>/api/v1/webhooks/stripe` (events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`); enable the customer portal in the Stripe dashboard.
6. Cloudflare dashboard: rate-limiting rules on `/api/v1/auth/*`, `/api/v1/events/batch`, `/api/v1/notifications/*`; alerts on **DLQ depth**, Worker 5xx rate and queue consumer errors.

## 5. Post-deploy smoke test
Sign up (a verification email must arrive), confirm it, connect a store, publish a campaign, load a page with the snippet on a test domain, confirm the impression appears, pause it and confirm it disappears; run one AI generation and review it; run one Stripe test-mode checkout and open the portal; request a password reset; enable 2FA and sign in with it; invite a teammate; as a shopper request a back-in-stock alert and confirm both emails arrive and the unsubscribe link works.

## 6. Operations
- **Rollback**: `wrangler rollback` (Workers). A bad campaign: pause it, or use the per-store kill switch (live on the next config fetch: <= 60 s + the SDK's 1 h cache bounded by a render-time re-check).
- **Backups**: D1 Time Travel (30 days). Rehearse `node scripts/backup-drill.mjs` logic against staging with `wrangler d1 export --remote` / `execute --file`. The drill proves the dump restores row-for-row locally.
- **Capacity**: ingest is KV + queue only; the consumer does ~5 statements per 50-event batch. D1 is a single writer: watch queue backlog age. If sustained writes approach D1's limits, shard aggregates per organisation (50k databases allowed) or move `analytics_aggregates` behind the same interface to an analytical store.
- **Load test** (local): `node tests/load/events-load.mjs` (see header for setup). It verifies integrity as well as speed.
