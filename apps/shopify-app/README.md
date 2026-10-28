# Shopify app (UNVERIFIED)

These files follow Shopify's documented formats but **have never been deployed or tested** because no Partner account was available. Treat them as a starting point, not a verified integration.

## What is implemented server-side (tested with fixtures)
- `POST /api/v1/webhooks/shopify`: HMAC verification, idempotency, `app/uninstalled`, `products/*`, `orders/create`, and GDPR topics (`customers/data_request`, `customers/redact`, `shop/redact`).

## What still has to be done by someone with a Partner account
1. Create the app, put `client_id` in `shopify.app.toml`, set `SHOPIFY_API_SECRET` (`wrangler secret put`).
2. **Install/auth flow is not built.** A store is currently registered from the dashboard (platform = Shopify, domain = `x.myshopify.com`), which is enough for the app embed, pixel and webhooks, but not for Admin API catalog sync. For that, implement token exchange / expiring offline tokens (credentials storage with AES-GCM already exists: `services/credentials.ts`).
3. `shopify app deploy`, then enable the *ConvertFlow campaigns* app embed in the theme editor and paste the site key.
4. Verify the pixel's `browser.cookie.get("cf_lc")` attribution works in Shopify's sandbox; if not, purchases are still counted but unattributed.
5. App Store review may require an embedded admin experience (`embedded = true`, App Bridge). This app uses its own web dashboard; confirm current requirements before submitting.
6. Billing for Shopify-distributed installs must use Shopify's Billing API, not Stripe. Not implemented.
