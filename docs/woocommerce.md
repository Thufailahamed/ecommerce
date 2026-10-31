# WooCommerce: connection, sync, webhooks, plugin, verification

**Status: built and tested against a fake WooCommerce site** (`apps/api/test/woocommerce.test.ts`, browser journey in
`tests/e2e/woocommerce.spec.ts` with `tests/e2e/mock-woocommerce.mjs`). **Never run against a real WordPress site.** The
WordPress plugin has never been installed anywhere (see `apps/woocommerce-plugin/README.md` for exactly what was checked).
Section 5 is the checklist that changes that.

## 1. What it does

| Piece | How | Code |
|---|---|---|
| Connect (one click) | Settings → WooCommerce → *Connect WooCommerce* (`POST /stores/:id/woocommerce/authorize`) sends the merchant to their own store's `https://<domain>/wc-auth/v1/authorize` with `scope=read_write`, a single-use `user_id` (15 min, KV), our `callback_url` and a `return_url` back to Settings | `services/woocommerce.ts` `beginAuthorize` |
| Key delivery | WooCommerce posts `{consumer_key, consumer_secret, key_permissions, user_id}` to `POST /api/v1/woocommerce/callback` from the store's server. Accepted only with an unused `user_id` from an approval this app started, for a store the starting user can still manage. Keys are stored encrypted but **not trusted yet**; the call answers fast because WooCommerce discards the keys if it fails or times out | `handleAuthCallback` |
| Finish | WooCommerce sends the browser back with `success=1`; the dashboard calls `POST /stores/:id/woocommerce/setup`, which checks the keys against the registered domain (a product read) and creates the webhooks. `success=0` changes nothing | `setupConnection` |
| Connect (keys) | *Use API keys instead*: keys are checked against the store **before** they are stored (`credentials_rejected` / `catalog_unreachable` / `woocommerce_api_not_found` otherwise); webhooks are created when the keys can write | `connectWithKeys` |
| Where requests go | Only `https://<the store's registered domain>/wp-json/wc/v3/…` (or `WOOCOMMERCE_BASE_URL` in tests), never a URL from a request: no SSRF. Basic auth; on a 401 over HTTPS, retried once with query-string keys (hosts that strip the Authorization header; WooCommerce documents this) | `wooRequest` |
| Catalog sync | 25 products a page (`X-WP-TotalPages` decides the last page), `status=any`. A simple product is its own variant (the id the storefront adds to cart); a **variable product's variants are its variations** (`/products/<id>/variations`, disabled ones skipped, option names as the title). `instock`/`outofstock` map to available/unavailable; `onbackorder` stays unknown | `syncWooPage`, `normalizeWooProduct` |
| Webhooks | Created at the store by the API: `product.created/updated/deleted/restored`, `order.created/updated`, delivery URL `/api/v1/webhooks/woocommerce/<storeId>`, `api_version: wp_api_v3`, a per-store random secret (encrypted at rest). *Repair* recreates any the store disabled and deletes ours made with an older secret; other apps' webhooks are never touched | `ensureWebhooks` |
| Webhook delivery | Signature `X-WC-Webhook-Signature` = base64 HMAC-SHA256 of the raw body with that store's secret, so another store's secret fails on this URL. Idempotent on delivery id + body hash (WooCommerce's delivery id can repeat within one second). WooCommerce's unsigned save-time ping (`webhook_id=N`) answers 200 and does nothing. Unknown or disconnected stores answer 404, so WooCommerce disables stale webhooks | `handleWooWebhook` |
| Product webhooks | A simple product is applied from the payload. A **variable** product is re-read with its variations from the queue (`woo_product_refresh`), because WooCommerce gives up on a delivery after about 5 s. A product that came back in stock triggers back-in-stock alerts | `refreshWooProduct`, `runWooProductRefresh` |
| Orders | `order.created` and `order.updated` become one `order.created` platform event per order (`woocommerce:<id>`), so the block checkout's draft (not counted) becoming `processing` later still counts once. Drafts, failed, cancelled and trashed orders are not purchases. Only id, total, currency and UTC time are read: nothing about the customer | `wooOrderFacts` |
| Purchases from the browser | The plugin calls `ConvertFlow.trackPurchase({ orderId: "woocommerce:<id>" })` on the order-received page (consenting visitors only). Same key as the webhook's conversion, so an order counts once and the browser adds attribution | `apps/woocommerce-plugin` |
| Disconnect | *Disconnect WooCommerce* deletes the app's webhooks at the store and the stored keys, keeps the store, catalog and campaigns. Disconnecting the store does the same first. Revoke the key in WooCommerce → Settings → Advanced → REST API | `disconnectWoo` |
| Health | Operations page: a live product read with the stored keys, plus whether all of the app's webhooks are still active at the store | `wooHealth` |
| Daily reconciliation | The existing catalog pass (`services/reconcile.ts`) walks every page and archives products the store no longer has | `syncCatalogPage` |

### Permissions
- One-click approval asks for **Read/Write**: creating webhooks needs write. Nothing else is written; the app never edits
  products, orders or settings.
- Read-only keys work for sync only: the status says webhooks are off and offers *Connect with Read/Write*.
- The WordPress user who approves must be able to manage WooCommerce (`manage_woocommerce`): WooCommerce enforces it.

## 2. Configuration

| Name | Purpose |
|---|---|
| `API_ORIGIN`, `ALLOWED_ORIGIN`, `CREDENTIAL_KEY` | Callback and webhook URLs, where merchants return to, key encryption. All three are needed for the one-click flow; without them the dashboard offers pasted keys only (webhooks still need `API_ORIGIN`) |
| `WOOCOMMERCE_BASE_URL` | Tests only: replaces `https://{domain}` for REST calls (`http://localhost:4600/{domain}` in e2e) |

WooCommerce requires `callback_url` to be HTTPS, and a store's `wp_safe_remote_post` refuses private addresses: the
one-click flow and webhook delivery only work with a public HTTPS API origin (not `pnpm dev:local`).

## 3. Merchant onboarding (what the dashboard says)
1. Add the store with platform *WooCommerce* and its domain (the WordPress site's address).
2. Settings → WooCommerce → *Connect WooCommerce*, approve in WordPress.
3. *Sync catalog now*. Webhooks keep it current afterwards.
4. Install the ConvertFlow plugin (`apps/woocommerce-plugin`), WooCommerce → ConvertFlow, paste the site key, choose the
   consent mode.

## 4. Known limits
- The store domain must be the WordPress site root: a WordPress installed in a subdirectory (`example.com/shop`) is not supported (the domain field drops paths).
- Pretty permalinks must be on (`/wp-json/` does not exist with Plain permalinks): the error says so.
- Products with more than 100 variations are imported with their first 100.
- Refunds and cancellations after purchase do not reduce conversions (same as Shopify).
- No uninstall signal: WooCommerce does not tell an app when its key is revoked. The health check and the next sync show `credentials_rejected`.

## 5. Verification on a real store (none of this has been done)
| # | Check | Pass when |
|---|---|---|
| 1 | One-click connect on an HTTPS WordPress + WooCommerce 9.x test site | Back on Settings: "WooCommerce is connected", 6 webhooks active; WooCommerce → Settings → Advanced → Webhooks lists them as Active |
| 2 | Decline on the approval page | "not approved"; nothing stored |
| 3 | Sync > 25 products, with one variable product (one variation out of stock, one disabled) and one draft | Counts match; variations are variants; the disabled one is absent |
| 4 | Edit a simple product's title; change a variation's stock | Both changes arrive within a minute (the variable one through the queue) |
| 5 | Trash a product, restore it | Archived, then active again |
| 6 | Place an order with the classic checkout and with the block checkout | One `order.created` event and one conversion each; the plugin's thank-you call does not add a second |
| 7 | Plugin: site key saved, page source on home / shop / category / product / cart / checkout | One `cf.js` tag with the right `data-site`; `ConvertFlowContext` has the right product and cart values |
| 8 | Disable a webhook in WooCommerce, then *Repair* | Health check reports it; Repair makes it active again |
| 9 | *Disconnect WooCommerce* | The app's webhooks are gone from the store |
| 10 | A host that strips `Authorization` (some CGI/FastCGI setups) | Sync works via the query-string fallback |
