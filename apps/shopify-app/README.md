# Shopify app

The Shopify app configuration (`shopify.app.toml`) and its two extensions: a theme app embed that loads the storefront
script, and a web pixel that reports completed checkouts. The server side lives in the API Worker:

| What | Where | State |
|---|---|---|
| Install / launch (App URL), OAuth authorization code grant, offline token, claim by a workspace, reinstall | `apps/api/src/services/shopify-app.ts` | Built; tested against a fake Shopify |
| Admin GraphQL catalog sync (products, variants, `availableForSale`, collections, cursor pages, throttling) | same | Built; tested against a fake Shopify |
| Webhooks: HMAC, idempotency, `app/uninstalled`, `app_subscriptions/update`, `products/*`, `orders/create`, `customers/data_request`, `customers/redact`, `shop/redact` | `apps/api/src/services/shopify.ts` | Built; tested with signed fixtures |
| Shopify Billing (`appSubscriptionCreate`, return URL, webhook-driven state, cancel, trial) | `apps/api/src/services/shopify-billing.ts` | Built; tested against a fake Shopify |
| Storefront setup: creates the web pixel (`webPixelCreate`), writes the embed's site key to app metafields, reads whether the embed is on, uninstall from the dashboard, `inventory_levels/update` | `apps/api/src/services/shopify-app.ts` | Built; tested against a fake Shopify |
| Theme app embed, web pixel | `extensions/` | Written to the documented formats; **never deployed** |

**Nothing here has run against a real Shopify store**: no Partner account was available. `docs/shopify.md` is the
setup guide and the checklist that verifies each piece on a development store.
