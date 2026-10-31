# Shopify app: configuration, installation and verification

**Status: built and tested against a fake Shopify (unit and integration tests in `apps/api/test/shopify.test.ts`, browser
journey in `tests/e2e/shopify.spec.ts` with `tests/e2e/mock-shopify.mjs`). Never run against a real Shopify store**: no
Partner account was available. Section 5 is the checklist that changes that.

## 1. What the app does

| Piece | How | Code |
|---|---|---|
| Install from the App Store or the Shopify admin | Shopify opens the App URL (`/api/v1/shopify/install`) with a signed query. The HMAC (hex SHA-256 of the sorted, form-encoded parameters) and a 1-hour timestamp window are checked, then the merchant is sent to `https://<shop>/admin/oauth/authorize` with a single-use `state` (10 min, KV). An installed, linked shop goes straight to the dashboard instead | `services/shopify-app.ts` `handleAppLaunch` |
| Install from the dashboard | Settings → Shopify app → *Install on Shopify* (`POST /stores/:id/shopify/connect`). The `state` remembers the store and the signed-in user | `beginInstallForStore` |
| OAuth callback | Verifies HMAC, single-use state and that the shop matches; exchanges the code for an **offline** token (`POST /admin/oauth/access_token`); checks the granted scopes. A dashboard-started install is linked only if the **same user's session** arrives with the callback. An install that started in Shopify is held (token encrypted) for 30 minutes until a signed-in merchant claims it at `/connect/shopify` | `completeInstall`, `claimInstallation` |
| Shop ownership | A store's shop identity (`stores.external_id`, which routes webhooks) is set **only** by a completed install. Typing a `myshopify.com` domain when creating a store claims nothing | `services/stores.ts`, test "typing another merchant's shop domain claims nothing" |
| One shop, one store | A shop active in another workspace is refused (`shop_in_use`). A shop uninstalled from one workspace can be installed into another; the old store is detached and keeps its data until `shop/redact` | `linkStore` |
| Reinstall | Same workspace: the disconnected store is reactivated with its campaigns, catalog and history | `claimInstallation` |
| Catalog sync | Admin GraphQL `products(first: 10)` with up to 50 variants each and 10 collections, cursor pages, `availableForSale` as availability, numeric (legacy) ids so webhooks and `/cart.js` hit the same rows. `THROTTLED`/429 → 429 to the dashboard; 401/403 → "reconnect" | `syncShopifyPage` |
| Webhooks | HMAC (base64), idempotent on the delivery id. `inventory_levels/update` (re-reads the item's product so availability is Shopify's own `availableForSale` across locations; drives back-in-stock alerts), `app/uninstalled` (stop serving, drop the token, cancel Shopify billing, keep data), `app_subscriptions/update`, `products/*`, `orders/create`, `customers/data_request` (records which contacts match, ids only), `customers/redact` (erases matching contacts and their provider copies), `shop/redact` (purges the store) | `services/shopify.ts` |
| Billing | `appSubscriptionCreate` (USD, every 30 days, optional trial and test mode), approval on Shopify's page, return URL re-reads the charge from Shopify, `app_subscriptions/update` re-reads it too, so neither a forged return nor a stale webhook can grant a plan. A declined upgrade never cancels the current plan. Frozen → `past_due`, cancelled/expired → `cancelled`; both fall back to Free limits without deleting anything, and storefront configs are republished at once | `services/shopify-billing.ts` |
| Storefront setup (automatic) | On every install and reinstall the app **creates its web pixel** (`webPixelCreate` with `{site_key, api_url}`; an app pixel exists only once the app creates it, a merchant cannot add it by hand; `TAKEN` from an older install is adopted and updated) and writes the site key and origins into **app-data metafields** (`metafieldsSet` on `currentAppInstallation`, namespace `convertflow`) that the theme embed reads. Best effort: the outcome is stored on the installation and shown in Settings with *Retry setup* (`POST /stores/:id/shopify/setup`) | `runStorefrontSetup` |
| Theme app embed | Loads `cf.js` with the site key from the app metafields (block settings remain manual overrides). Settings links to the theme editor with `activateAppId=<client id>/convertflow-embed`, and `GET /stores/:id/shopify/theme-embed` reads the live theme's `config/settings_data.json` to say whether the embed is on | `apps/shopify-app/extensions/theme-app-extension`, `themeEmbedStatus` |
| Web pixel | Reports `checkout_completed` with the same order key the `orders/create` webhook uses, so an order counts once | `apps/shopify-app/extensions/web-pixel` |
| Uninstall from the dashboard | Disconnecting a Shopify store revokes the app's access (`DELETE /admin/api_permissions/current.json`, Shopify's documented app uninstall); the `app/uninstalled` that follows is a no-op | `uninstallFromShop` |

### Scopes (`read_products,read_inventory,read_orders,read_themes,write_pixels,read_customer_events`)
- `read_products`: catalog sync and product webhooks.
- `read_inventory`: `availableForSale`/stock on variants.
- `read_orders`: Shopify delivers `orders/*` webhooks only to apps holding it. Orders become observed purchases and
  attribution (`docs/analytics-definitions.md`); only the order id, total, currency and time are kept, no customer fields.
  Order webhooks also need **protected customer data access** requested in the Partner Dashboard (Level 1 is enough:
  no customer fields are used). Dropping `read_orders` is possible: remove `orders/create` from the toml and the scope
  from both places; purchases then come only from the web pixel (consenting visitors).
- `read_themes`: read the live theme's settings to tell the merchant whether the app embed is on (nothing is written to themes).
- `write_pixels` + `read_customer_events`: required by `webPixelCreate`/`webPixelUpdate`, the only way an app pixel is activated.
- Installs from before these scopes show *missing scopes* in Settings and *Reconnect*; launching the app from the Shopify admin also re-runs authorization.
- `shopify.app.toml` and `SHOPIFY_SCOPES` (default in `shopify-app.ts`) must be identical; `pnpm lint` fails if they drift.

## 2. Configuration

API Worker (`wrangler secret put` for secrets):

| Name | Kind | Purpose |
|---|---|---|
| `SHOPIFY_API_KEY` | var | Client id from the Partner Dashboard |
| `SHOPIFY_API_SECRET` | secret | Client secret: verifies HMACs and exchanges codes |
| `API_ORIGIN`, `ALLOWED_ORIGIN`, `CREDENTIAL_KEY` | var / var / secret | Callback and return URLs, where merchants are sent back, token encryption. All required for installs |
| `SHOPIFY_SCOPES` | var, optional | Default `read_products,read_inventory,read_orders,read_themes,write_pixels,read_customer_events` |
| `SDK_ORIGIN` | var, optional | Where `cf.js` is served; written to the embed's `sdk_url` metafield. Without it the embed uses its built-in default (edit the liquid file's default before `shopify app deploy`) |
| `SHOPIFY_API_VERSION` | var, optional | Default `2026-10`. Shopify supports a version for about 12 months: bump it with the toml's `api_version` each quarter after testing |
| `SHOPIFY_BILLING_TEST` | var | `true` on development stores and during review (test charges are free) |
| `SHOPIFY_TRIAL_DAYS` | var, optional | Free trial on new subscriptions; default 0 |

Without `SHOPIFY_API_KEY` + secret + origins + key, every install route answers 503 and the dashboard says the app is
not configured; webhooks still verify with the secret alone.

## 3. Partner Dashboard and `shopify.app.toml`
1. Create the app; put the client id in `apps/shopify-app/shopify.app.toml`; replace every `api.example.com` with the API origin.
2. `application_url` = `https://api.<domain>/api/v1/shopify/install`; redirect URL = `https://api.<domain>/api/v1/shopify/callback`.
3. `embedded = false` and `use_legacy_install_flow = true`: the dashboard is a standalone web app and the API runs the
   authorization code grant. **Check the current App Store requirements before submitting**: Shopify has been moving
   public apps to embedded admin experiences with session tokens and managed installation. If that is required for
   listing, the token exchange flow replaces section 1's callback; storage, linking, sync and billing stay as they are.
4. Request protected customer data access (for `orders/create`).
5. `shopify app deploy` from `apps/shopify-app` (registers webhooks, the theme embed and the pixel).

## 4. Merchant onboarding (what the dashboard tells them)
1. Install (App Store, or Settings → Shopify app → *Install on Shopify*); approve the scopes.
2. *Sync catalog from Shopify* (Settings). Webhooks keep it current afterwards.
3. *Open theme editor* (Settings): it opens with **ConvertFlow campaigns** switched on, the site key already filled in; save. *Check again* confirms it from the live theme.
4. Nothing to do for the purchase pixel: the app created it on install (Settings shows *Purchase pixel active*, or *Retry setup*).
5. Choose a plan in Settings: with the app installed, plans are charged through Shopify.

## 5. Verification on a development store (none of this has been done)
| # | Check | Pass when |
|---|---|---|
| 1 | Install from the dashboard with a dev store | Lands on Settings "Shopify is connected"; `GET /stores/:id/shopify` shows the scopes |
| 2 | Install from the Partner Dashboard "Test on development store" link | `/connect/shopify` asks for a workspace; claiming creates the store with the shop's name and currency |
| 3 | Sync a catalog of > 10 products with variants, one sold out, one draft | Counts match the Shopify admin; the sold-out variant is `out_of_stock`; ids are numeric |
| 4 | Edit a product in the admin | `products/update` arrives (HMAC passes) and changes the same row |
| 5 | Theme embed on, upsell campaign live | Recommendations show; *Add to cart* adds the right variant via `/cart/add.js` |
| 6 | Place a test order | One `orders/create` event, one conversion; the pixel's purchase does not double count |
| 7 | Billing in test mode: subscribe, approve | Plan changes only after approval; a decline leaves it unchanged |
| 8 | Freeze/cancel the charge (Partner Dashboard) | `app_subscriptions/update` arrives; plan falls back to Free; paid-tool campaigns stop being served, none deleted |
| 9 | Uninstall | Store disconnected, token gone, subscription cancelled |
| 10 | Reinstall | Same store reactivated with its data |
| 11 | Trigger the three privacy webhooks from the Partner Dashboard | `customers/redact` erases matching contacts; `shop/redact` (48 h after uninstall) purges the store |
| 12 | Rate limits | A large catalog sync survives `THROTTLED` (the dashboard retries the page) |
| 13 | API version | No deprecation warnings in the app's API health report |
| 14 | Fresh install | Settings shows *Purchase pixel active*; Shopify admin → Settings → Customer events lists the ConvertFlow pixel as connected |
| 15 | *Open theme editor*, save | The embed is on with the site key prefilled (no paste); *Check again* says *App embed is on*; page source has one `cf.js` tag |
| 16 | Change a tracked variant's stock to 0 and back at one location | `inventory_levels/update` arrives; availability follows; the back-in-stock alert goes out once |
| 17 | Disconnect the store in the dashboard | The app disappears from the Shopify admin's apps list |
| 18 | An install made before the new scopes | Settings shows the missing scopes; *Reconnect* grants them and *Retry setup* creates the pixel |
