# ConvertFlow AI

AI-assisted on-site campaigns for **any online store** (Shopify, WooCommerce, BigCommerce, Magento, custom). Branding is a working name.

Merchant describes a goal -> AI drafts a campaign from the real catalog -> server validates it -> live preview -> merchant approves -> immutable published version -> edge-served to the storefront -> consent-aware analytics.

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Zod schemas: campaign config, rules, events (shared by API, SDK, editor) |
| `packages/campaign-engine` | Pure, deterministic eligibility / selection engine (SDK, preview and server share it) |
| `packages/database` | Drizzle schema + generated D1 migrations |
| `packages/ai` | Provider interface, Workers AI adapter, prompt builder, policy validator |
| `apps/api` | Hono Worker: auth, stores, campaigns, catalog, events, analytics, AI |
| `apps/storefront-sdk` | The `<script>` that runs on stores (+ the renderer reused by the editor preview) |
| `apps/web` | Next.js app: marketing site, dashboard, campaign editor, AI studio, analytics, settings |

## Develop

```
pnpm install
pnpm verify          # typecheck + unit/integration tests + builds (+ SDK size budget)
pnpm e2e             # real browser + real Worker runtime; first build web/SDK with the URLs in tests/e2e/playwright.config.ts
pnpm dev:local       # the whole stack on this machine (see below)
```
`pnpm dev:local` needs no Cloudflare account. On first run it creates `apps/api/.dev.vars`, builds the SDK, creates the local database under `.local-dev/` (all migrations) and starts four services:

| Service | URL |
|---|---|
| Web app (dashboard) | http://localhost:3200 |
| API | http://localhost:8790 (`/health`) |
| Local inbox (stands in for Resend: every email the app sends appears here, with clickable links) | http://localhost:4100 |
| Demo storefront (loads the real SDK) | http://localhost:4000/products/running-shoe?site=YOUR_SITE_KEY&consent=0 |

Other commands: `pnpm dev:db` (create or upgrade the database only), `pnpm dev:plan you@example.com growth` (give an account a plan, as a Stripe webhook would; email signup needs `starter` or higher), `pnpm dev:reset` (delete the local database; stop `dev:local` first). Ports 3000 and 8787 are avoided on purpose.

Workers AI is not available in local mode; AI generation needs a deployed Worker or `wrangler dev --remote`. Cron jobs (retention purges, restock drain) do not run locally; trigger one with `curl "http://127.0.0.1:8790/cdn-cgi/local/scheduled"` (the URL wrangler prints at startup; not exercised by me).

Other checks:
```
node tests/load/events-load.mjs        # throughput + exact-count integrity + replay idempotency (see its header for setup)
node scripts/backup-drill.mjs          # export, restore into an empty DB, prove every row is identical
```
API reference: `GET /api/v1/openapi.json` (generated; a test keeps it in sync with the router).

Docs: `docs/status.md` (what is verified and the launch blockers), `docs/deployment.md`, `docs/security.md`, `docs/api-specification.md`.

## Deploy (not yet done: needs a Cloudflare account)

1. `wrangler d1 create convertflow`, `wrangler kv namespace create CONFIG_KV`, `wrangler queues create convertflow-events`; put the ids in `apps/api/wrangler.jsonc`.
2. `wrangler d1 migrations apply convertflow --remote`, then `wrangler deploy`.
3. Host the whole `apps/storefront-sdk/dist/` directory on any static/CDN origin (e.g. a Worker with static assets). `cf.js` is the only script every page loads; it fetches `cf-<tool>.<hash>.js` from the same directory the first time a campaign of that tool is eligible, so those files must be served next to it (the `_headers` file in `dist` sets their long cache lifetime).
4. Web: `pnpm --filter @convertflow/web cf:build && cf:deploy` (OpenNext build **not yet verified**).
5. Set `ALLOWED_ORIGIN` to the web app's origin. Web and API must share a registrable domain (cookie is `SameSite=Lax`).

## Status

See `docs/status.md` for exactly what is verified vs. not built.
