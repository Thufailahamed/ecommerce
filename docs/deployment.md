# Deployment runbook

**Not yet executed against a real Cloudflare account.** Every command below follows Cloudflare's documented Wrangler CLI
(v4) but none has been run against real resources from this repository. Follow in order and tick each item.

## 0. Environments
| Environment | API Worker | Where config lives | Data |
|---|---|---|---|
| development (local) | `wrangler dev` / `pnpm dev:local` | top level of `apps/api/wrangler.jsonc` + `apps/api/.dev.vars` | `.local-dev/` (local D1/KV) |
| staging | `convertflow-api-staging` | `env.staging` in each `wrangler.jsonc` | its own D1, KV, queues |
| production | `convertflow-api-production` | `env.production` | its own D1, KV, queues |

Wrangler does **not** inherit bindings (`d1_databases`, `kv_namespaces`, `queues`, `ai`) or `vars` into `env.*`: each
environment declares its own (they are filled with `REPLACE_WITH_…` placeholders until provisioned). Never point staging at
production resources.

## 1. Provision (once per environment)
```
wrangler d1 create convertflow-<env>
wrangler kv namespace create CONFIG_KV --env <env>
wrangler queues create convertflow-events-<env>
wrangler queues create convertflow-events-dlq-<env>
```
Put the ids in `apps/api/wrangler.jsonc` under `env.<env>`. AI Gateway uses the auto-created `default` gateway; set
`AI_GATEWAY_ID` for a named one. DNS: the web app and the API must share a registrable domain (`app.<domain>` and
`api.<domain>`) because the session cookie is `SameSite=Lax`; the SDK can live anywhere (`sdk.<domain>` recommended).
Add custom domains to each Worker (Workers → Settings → Domains & Routes).

## 2. Secrets (`wrangler secret put <NAME> --env <env>`) and vars
| Name | Needed for | If missing |
|---|---|---|
| `CREDENTIAL_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts platform tokens, provider keys and MFA secrets; signs unsubscribe links. **Rotating it makes stored tokens unreadable** (docs/operations.md) | MFA, catalog connectors, list providers, Shopify installs, email and SMS signup unavailable (fail closed) |
| `ALLOWED_ORIGIN`, `API_ORIGIN` (vars) | The web app's origin (CORS, CSRF, redirects) and the API's public origin (links in emails, OAuth callback, billing return) | The app does not work / email links, Shopify and signups unavailable |
| `RESEND_API_KEY`, `EMAIL_FROM` | Account email, signup confirmations, restock alerts | Those features degrade; **email signup forms cannot be published** |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER/GROWTH/SCALE` | Card billing for non-Shopify merchants | Card plan changes disabled |
| `SHOPIFY_API_KEY` (var), `SHOPIFY_API_SECRET` | Shopify app install, sync, billing; webhook HMAC | Installs answer 503; webhooks answer 503 without the secret |
| `SHOPIFY_SCOPES`, `SHOPIFY_API_VERSION`, `SHOPIFY_BILLING_TEST`, `SHOPIFY_TRIAL_DAYS` (vars, optional) | See docs/shopify.md. **Set `SHOPIFY_BILLING_TEST=true` on staging**, never on production | Defaults |
| `TWILIO_ACCOUNT_SID`, `TWILIO_VERIFY_SERVICE_SID` (vars), `TWILIO_AUTH_TOKEN` (secret) | SMS signup verification codes (docs/sms.md) | **SMS signup forms cannot be published** |
| `TURNSTILE_SECRET` (+ `NEXT_PUBLIC_TURNSTILE_SITE_KEY` at web build) | Bot protection on signup | Signup unprotected |
| `AI_GATEWAY_ACCOUNT_ID` (var), `AI_GATEWAY_TOKEN`, `AI_GATEWAY_AUTH_TOKEN` (secrets) | AI store builder through AI Gateway's REST endpoint | Falls back to the `AI` binding (Workers AI models only) |
| `AI_COST_RATES` (var, optional) | Cost estimates per model (USD per million tokens) | No cost estimates, never wrong ones |
| `*_BASE_URL` overrides (`RESEND_`, `KLAVIYO_`, `MAILCHIMP_`, `TWILIO_VERIFY_`, `SHOPIFY_ADMIN_`, `AI_GATEWAY_`) | Mocks for local and e2e runs only | **Must be unset in staging and production**; a provider reached through one is never marked verified |

## 3. Database
- Generate: `pnpm --filter @convertflow/database db:generate` (reviewed in a PR with its migration test; `pnpm lint`
  fails if a migration has no test). Validate: `pnpm db:check` applies every migration to a fresh local D1.
- Apply: `cd apps/api && wrangler d1 migrations list DB --env <env> --remote` (read the pending list), then
  `wrangler d1 migrations apply DB --env <env> --remote`. On production, first record a Time Travel bookmark
  (`wrangler d1 time-travel info DB --env production`). Migrations so far are additive (new tables/columns, backfills);
  a destructive one needs a written plan and a restore rehearsal on staging.
- Never as a side effect of a deploy: the `deploy` workflow applies migrations only when asked, after an approver.

## 4. Deploy
Manual (`.github/workflows/deploy.yml`, run from the Actions tab) or by hand:
1. `pnpm lint && pnpm verify && pnpm e2e` green (CI runs all three).
2. API: `cd apps/api && wrangler deploy --env <env>`.
3. SDK: `pnpm --filter @convertflow/storefront-sdk build && cd apps/storefront-sdk && wrangler deploy --env <env>`. The
   whole `dist/` directory deploys together: `cf.js` loads `cf-<tool>.<hash>.js` from the same place.
4. Web (public URLs are baked in at build time): `NEXT_PUBLIC_API_URL=https://api.<domain> NEXT_PUBLIC_SDK_URL=https://sdk.<domain> pnpm --filter @convertflow/web cf:build`, then `cd apps/web && wrangler deploy --env <env>`.
5. Stripe: webhook endpoint `https://api.<domain>/api/v1/webhooks/stripe` (`checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`); enable the customer portal.
6. Shopify: `shopify app deploy` from `apps/shopify-app` after replacing the placeholders (docs/shopify.md).
7. Cloudflare: rate-limiting rules on `/api/v1/auth/*`, `/api/v1/events/batch`, `/api/v1/notifications/*`,
   `/api/v1/shopify/*`; the alerts in docs/operations.md.

## 5. Post-deploy smoke test
Automated in the deploy workflow: `/health`, `/api/v1/openapi.json`, `cf.js`. By hand on staging: sign up (a verification
email arrives), confirm, connect a store, publish a campaign, load a page with the snippet, see the impression, pause it
and see it disappear; one AI generation; a Stripe test-mode checkout and the portal; password reset; 2FA; invite a
teammate; an email signup confirmed from the inbox; an SMS signup with a real test phone; a Shopify development-store
install, sync and test-mode charge (docs/shopify.md §5).

## 6. Rollback, backups, incidents
See `docs/operations.md`.
