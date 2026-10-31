# ConvertFlow AI for WooCommerce (WordPress plugin)

The WooCommerce counterpart of the Shopify theme app embed
(`apps/shopify-app/extensions/theme-app-extension/blocks/convertflow-embed.liquid`) and web pixel
(`apps/shopify-app/extensions/web-pixel/src/index.js`). It only does the storefront part; catalog sync and
product/order webhooks go through the WooCommerce REST API from the ConvertFlow server.

What it does:

- **Settings** (WooCommerce > ConvertFlow, `manage_woocommerce`): site key (`^cf_[A-Za-z0-9_-]{6,64}$`), script URL,
  API URL (https only, unless WP_DEBUG or localhost) and consent mode (`wp_consent_api` / `banner` / `implied`), stored in
  the `convertflow_settings` option.
- **Front end** (only with a valid site key; never in admin, REST, AJAX, cron or feeds): an inline script in `wp_head` that
  sets `window.ConvertFlow.consent` per the consent mode and `window.ConvertFlowContext` with exact page data (`pageType`,
  `productId`, `productAvailable`, `collectionIds`, `cartSubtotal`, `cartItemCount`; unknown values are omitted), then
  `<script async src="{sdk_url}/cf.js" data-site="{site_key}" data-api="{api_url}"></script>`.
- **Purchases**: on the order-received page (order key in the URL must match the order) it calls
  `ConvertFlow.trackPurchase({ orderId: "woocommerce:<id>", total, currency })` once (waits up to 15 s for the SDK) and
  marks the order with `_convertflow_purchase_reported`. The `woocommerce:` prefix matches the id the server records from
  the order webhook, so an order counts once and the browser call only adds attribution. No customer PII is sent.
- Declares HPOS (`custom_order_tables`) and `cart_checkout_blocks` compatibility. Does nothing (and shows a notice) when
  WooCommerce is not active.

Files: `convertflow/convertflow.php` (bootstrap), `convertflow/includes/class-convertflow-settings.php`,
`convertflow/includes/class-convertflow-frontend.php`, `convertflow/uninstall.php`, `convertflow/readme.txt`.

Hooks for developers: `convertflow_page_context` (filter the context array), `convertflow_should_load` (bool).
The default URLs can be overridden by defining `CONVERTFLOW_DEFAULT_SDK_URL` / `CONVERTFLOW_DEFAULT_API_URL` in
`wp-config.php`.

## Build the zip

```sh
cd apps/woocommerce-plugin && zip -r convertflow.zip convertflow
```

Upload `convertflow.zip` under Plugins > Add New > Upload Plugin.

## Status: UNVERIFIED

Written to the documented WordPress and WooCommerce APIs. It has **not** been installed or run on any WordPress or
WooCommerce site, and there are no automated tests for it. When it was written, PHP was not installed on the
development machine and Docker was not running, so `php -l` was **not** run. What was run instead:

- Every `.php` file was parsed with the JavaScript PHP parser `php-parser@3.1.5` (glayzzle) in PHP 7.4 and 8.3 mode:
  all parsed without errors (the same check rejects a deliberately broken file). This catches syntax errors only, not
  undefined functions, type errors or runtime behaviour.
- The two inline scripts, assembled as the PHP builds them, were run in Node with fake `window`/`document`: consent
  follows `wp_has_consent("statistics")` and the `wp_listen_for_consent_change` event, and the purchase snippet waits for
  `ConvertFlow.trackPurchase` and calls it exactly once.
- Files were re-read by hand for PHP 7.4 compatibility and WordPress escaping/sanitizing.

Before release, at minimum:

- `php -l` every file on PHP 7.4 and 8.3, and run PHPCS with the WordPress Coding Standards.
- On a test store (classic and block checkout, HPOS on and off): save settings (valid and invalid key, http URL),
  check the page source on home / shop / category / product / cart / checkout / search pages, place an order and confirm
  one `ConvertFlow.trackPurchase` call with `woocommerce:<id>` and no second call after reloading the thank-you page.
- With the WP Consent API plugin and a compatible banner: confirm `ConvertFlow.consent` follows the "statistics" choice.
- Confirm the block order-confirmation template fires `woocommerce_thankyou` (a `wp_footer` fallback covers it if not).

Known side effect: saving the `_convertflow_purchase_reported` meta uses `$order->save()`, which fires WooCommerce's
order-updated hooks (and so an `order.updated` webhook) once per order.
