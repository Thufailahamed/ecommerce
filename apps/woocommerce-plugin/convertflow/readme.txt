=== ConvertFlow AI for WooCommerce ===
Contributors: convertflow
Tags: woocommerce, popups, conversion, campaigns, personalization
Requires at least: 6.2
Tested up to: 6.6
Requires PHP: 7.4
WC requires at least: 8.0
WC tested up to: 9.9
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Shows ConvertFlow AI on-site campaigns in your WooCommerce store, with exact page and cart context and purchase attribution.

== Description ==

ConvertFlow AI serves on-site campaigns (offers, sign-up forms, recommendations) through a small storefront script. This plugin connects a WooCommerce store to it:

* Loads the ConvertFlow storefront script (`cf.js`, async) on shop pages once you save your site key.
* Tells the script exactly what page the visitor is on (home, collection, product, cart, checkout, search, content), the product id, stock status and categories on product pages, the category on category pages, and the cart subtotal and item count. Nothing is guessed: anything unknown is left out.
* On the order-received page, reports the order (id, total and currency only) so the order can be attributed to the campaign that drove it. The same order is also recorded server-side from the WooCommerce order webhook, and both use the id `woocommerce:<order id>`, so each order counts once.
* Follows your consent setup: the WP Consent API, your own cookie banner, or "no consent required" where that applies to your store.

Product and order sync are handled separately by the ConvertFlow dashboard through the WooCommerce REST API.

Compatible with High-Performance Order Storage (HPOS) and the Cart and Checkout blocks.

== Installation ==

1. Upload the `convertflow` folder to `/wp-content/plugins/`, or upload the zip under Plugins > Add New > Upload Plugin.
2. Activate the plugin. WooCommerce must be active.
3. Go to WooCommerce > ConvertFlow, paste the site key from ConvertFlow > Settings > Install (it looks like `cf_AbC123xyz456`), choose a consent mode and save.

== Frequently Asked Questions ==

= Which consent mode should I pick? =

* **WP Consent API** (default when the WP Consent API plugin is active): ConvertFlow follows the visitor's "statistics" choice from any banner that supports the WP Consent API, including later changes.
* **My own cookie banner**: your banner sets `window.ConvertFlow.consent = true` (or `false`). Until it does, consent is treated as not given.
* **No consent required**: only if visitors in your store's jurisdiction do not need to opt in to analytics. You are responsible for this choice.

Campaigns are shown in every mode; the mode only controls whether ConvertFlow may store and send analytics.

= Does it work with page caching? =

Product and category data are the same for every visitor and cache safely. The cart subtotal and item count are written into the page; most caching plugins already skip caching for visitors with items in their cart (WooCommerce's `woocommerce_items_in_cart` cookie). If yours does not, configure it to bypass the cache when that cookie is set, otherwise cart-based campaigns can see a cached (wrong) cart.

= Can I change the page context? =

Use the `convertflow_page_context` filter. To stop the script on specific requests, use `convertflow_should_load`.

== Privacy ==

* The storefront script only stores identifiers or sends analytics events when the visitor has consented (according to the consent mode you choose). Showing a campaign does not require storage.
* Orders are reported from the order-received page as order id, order total and currency only. No name, email, address, phone number or other customer data is sent by this plugin. The order-received page is only handled when the order key in the URL matches the order.
* The plugin stores one site option (`convertflow_settings`) and one order meta value (`_convertflow_purchase_reported`, a timestamp) so an order is not reported twice.
* Data sent by the storefront script goes to the API URL shown in the settings. See the ConvertFlow AI privacy policy for how it is processed.

== Changelog ==

= 1.0.0 =
* First release.
