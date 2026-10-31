# AI store builder

Merchants describe a store in plain language. The AI designs it (brand, theme, pages), writes the copy, drafts a
catalogue and generates images; the merchant refines it by chatting or by editing directly in a live preview, then
publishes it at `/s/<address>` with a working cart and checkout.

## How it fits together

| Piece | Where |
|---|---|
| Store document schema, section library, operation engine, publish checklist, prompts, model-output parsing, cart pricing | `packages/store-builder` (pure, no I/O, shared by API and web) |
| Chat and image models over Cloudflare AI Gateway (REST or the Workers AI binding), streaming | `packages/ai/src/gateway.ts` |
| Sites, versions, drafts, publishing, payments key, the chat agent, assets, storefront commerce | `apps/api/src/services/builder/*`, routes in `apps/api/src/routes/builder.ts` |
| Tables `sites`, `site_versions`, `site_messages`, `site_assets`, `site_orders`, `site_submissions` | migration `0012_ai_store_builder.sql` |
| Editor (`/builder/<id>`): chat, live preview iframe, inspector, design, pages, products, settings, history, publish | `apps/web/components/builder/*` |
| Draft preview (`/preview/<id>`), framed by the editor and driven by `postMessage` | `apps/web/app/preview` |
| Published storefront (`/s/<slug>/…`): home and pages, product, collection, cart, checkout, order confirmation | `apps/web/components/storefront/*`, `apps/web/app/s` |
| Dashboard: stores list and the prompt box (`/app/sites`), orders and form submissions (`/app/sites/<id>/orders`) | `apps/web/app/app/sites` |

### Why a document and operations, not generated code

A store is a JSON document (`SiteDocument`): theme tokens, pages made of 14 typed section types, products, collections,
navigation and settings. The model never writes HTML or JavaScript. It proposes **operations**
(`update_section`, `add_product`, `set_theme`…), and every operation is validated against the schema before it lands.
The consequences:

- **Safe to publish**: text is plain (markup and control characters are stripped), links must be store paths or http(s)
  (`javascript:`, protocol-relative and backslash tricks are refused), images are uploaded assets or https only, and SVG
  uploads are refused (types are sniffed from the bytes).
- **Robust to model mistakes**: prices like `"$24.00"`, `#fff` colours, font names instead of keys and links written
  as strings are repaired; an invalid optional value is dropped rather than losing the whole section; one bad operation
  never blocks the others; unreadable palettes are repaired to WCAG 4.5:1.
- **One renderer**: the editor preview and the live store are the same React components, so what the merchant sees is
  what shoppers get, at real device widths (the preview is an iframe).
- **Editable by hand**: every inspector change is the same kind of operation, with undo/redo and version history.

## The chat agent

`POST /api/v1/sites/:id/chat` answers with server-sent events (`start`, `status`, `delta`, `doc`, `ops`, `done` |
`error`). One turn holds a per-site lock (`sites.busy_until`, 3 minutes, extended while working), so two turns never
write the same draft.

- **First message on an empty store: the build.** Brief (brand, palette, fonts, art direction) → catalogue (8-12
  products in 2-4 collections) → home page → About / FAQ / Contact, navigation, SEO, announcement → images (up to 16,
  4 at a time) → checks. Each step is a small JSON call with one corrective retry, and the preview updates after each
  one. A failed step falls back to a sensible default and says so in the reply; the store is always usable.
- **Every later message: an edit turn.** The model sees a compact summary of the store (all ids), the selected section in
  full, the page being viewed and the recent conversation. It replies `<message>…</message><ops>[…]</ops>
  <suggestions>[…]</suggestions>`; the message streams to the merchant while the operations are written. Malformed
  operations get one corrective retry. New images the edit asks for are generated (up to 4).
- **Honesty rules** are in every prompt: no invented reviews, ratings, press, certifications, guarantees, delivery times
  or discounts; testimonials the model writes are marked `sample` and **block publishing** until the merchant replaces
  them with real quotes (or hides the section). Logo strips get a "check these are real" warning.
- Store text is fenced and escaped in prompts so it cannot pose as instructions.
- Each turn is one `builder_messages` usage unit and each image one `ai_images` unit (plan limits in
  `packages/contracts/src/plans.ts`); every model call is logged in `ai_generations` (task `site.build`, `site.edit`,
  `site.image`) with tokens, duration and cost when `AI_COST_RATES` has the model.
- Stop (the merchant presses stop or closes the tab) aborts the model call; what was already saved stays.

## Drafts, versions and publishing

- The draft is saved with optimistic concurrency (`revision`): a stale write gets 409 and the editor offers a reload.
- Versions: every AI turn, restores, publishes, and manual edits (coalesced into one checkpoint per 5 minutes per
  member). 150 kept per store; publish snapshots are never pruned.
- Publishing requires the `sites.publish` permission (admin), a verified email when email is configured, the exact
  revision the merchant reviewed, and a clean checklist (`checkSite`): at least one product, no sample testimonials, no
  broken internal links. Warnings (missing images, zero prices, no contact email, no SEO description) are shown but do
  not block.
- Shoppers only ever see the published snapshot (cached in KV under `site:pub:<slug>`). Later draft edits are invisible
  until published again.

## Storefront commerce

- Cart in the shopper's browser; **prices are always recomputed on the server** from the published catalogue
  (`priceCart`), including option validation, sold-out products and shipping (`settings.shipping`: flat rate, free over
  a threshold).
- **Payments**: a merchant can connect their own Stripe secret key (checked against Stripe, AES-GCM encrypted with
  `CREDENTIAL_KEY`, never returned). Checkout then creates a Stripe Checkout Session on the merchant's account and the
  order is `pending_payment` until Stripe reports that exact session (matched by `client_reference_id`) as paid.
  Without a key, orders are recorded `unpaid` and the merchant arranges payment, then marks them paid/fulfilled.
- The order confirmation link carries a random token (only its hash is stored). Customer and merchant emails go
  through the existing email provider when configured.
- Newsletter sign-ups and contact messages are stored per store, exportable as CSV, and contact messages are emailed to
  the store's notification address.

## Configuration

| Variable | Meaning |
|---|---|
| `AI_GATEWAY_ACCOUNT_ID` (var), `AI_GATEWAY_TOKEN` (secret) | Use AI Gateway's REST endpoint (`/compat/chat/completions`, `/workers-ai/<model>`). Works locally (`apps/api/.dev.vars`) and deployed. The token is a Cloudflare API token with Workers AI read access. |
| `AI_GATEWAY_ID` | Gateway name (default `default`, auto-created on first use). |
| `AI_GATEWAY_AUTH_TOKEN` (secret) | Only for an Authenticated Gateway (`cf-aig-authorization`). |
| `BUILDER_AI_MODEL` | Provider-first model id. Default `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Any model the gateway can route, e.g. a stronger one through AI Gateway's provider keys. |
| `BUILDER_IMAGE_MODEL`, `BUILDER_IMAGES=off` | Image model (default `@cf/black-forest-labs/flux-1-schnell`); `off` keeps placeholders. |
| `AI_GATEWAY_BASE_URL` | Replaces the gateway origin (the e2e mock). |

Without REST credentials a deployed Worker uses the `AI` binding through `AI_GATEWAY_ID` (Workers AI models only).
With neither, the editor still works by hand and the chat says the AI is not configured.

To try the AI locally: add to `apps/api/.dev.vars`
```
AI_GATEWAY_ACCOUNT_ID=<your account id>
AI_GATEWAY_TOKEN=<API token with Workers AI read>
```
then `pnpm dev:local` and open http://localhost:3200/app/sites.

## Permissions

`sites.read` (viewer), `sites.write` (editor: create, edit, chat), `sites.publish` (admin: publish, unpublish, archive,
address, payments, notification email), `sites.orders` (editor). Foreign or archived sites are 404.

## Limits (by design for now)

- Stores live at `/s/<address>` on the app's domain. Custom domains are not built.
- No inventory counts (a product is in stock or sold out), no discount codes, no taxes, no customer accounts.
- One currency per store; prices in that currency.
- Images are stored in KV (4 MB each). Move to R2 before stores carry large media libraries.
