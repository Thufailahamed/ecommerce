# Storefront SDK: what a store can provide

The snippet loads `cf.js` with `data-site` (the site key) and `data-api`. Everything below is optional; anything the SDK is not told is treated as **unknown, never guessed**.

## Page data

```html
<script>
  window.ConvertFlowContext = { pageType: "product", productId: "12345", collectionIds: ["run"], productAvailable: true };
</script>
```

Shopify supplies `pageType` and `productId` itself. Elsewhere, set `productId` (the **same id your catalog import uses**) on product pages: back-in-stock forms and every product-based recommendation source (same collection, goes well with, alternatives) need it.

## Consent

`window.ConvertFlow = { consent: true | false }`, from your cookie banner. Without consent the SDK still **renders** campaigns (and recommendations, and lets shoppers add to the cart) but stores nothing, sends nothing and sets no cookie.

## Cart

| Call | Purpose |
|---|---|
| `ConvertFlow.setCart({ subtotal, itemCount, productIds })` | Tell the SDK what is in the cart. `subtotal` is in store currency. `productIds` are catalog ids and keep recommendations from offering what is already in the cart. |
| `ConvertFlow.trackAddToCart(cart?)` | Tell the SDK something was just added (optionally with the new cart state). |

Shopify is read automatically (`/cart.js`). WooCommerce is detected through the `added_to_cart` event, which carries no totals, so call `setCart` for a subtotal.

## Upsell: adding a recommended product to the cart

Recommended products can be added **without leaving the page**. In order of preference the SDK uses:

1. **Your own function**, for any custom store or platform plugin. Define it before the SDK loads (or before the first recommendation is drawn):

   ```js
   window.ConvertFlow = window.ConvertFlow || {};
   window.ConvertFlow.addToCart = async function (item) {
     // item = { productId: "12345", variantId: "98765" (when the product has exactly one), quantity: 1 }
     await myStore.cart.add(item.productId, item.variantId, 1);   // throw or reject if it could not be added
     return { subtotal: myStore.cart.subtotal(), itemCount: myStore.cart.count(), productIds: myStore.cart.productIds() }; // optional
   };
   ```
2. **Shopify**: `POST <root>cart/add.js` with the numeric variant id.
3. **WooCommerce**: the store's own `wc-ajax=add_to_cart` endpoint, then Woo's `added_to_cart` event so its mini-cart refreshes.

With none of these a product simply **links to its page** (the button says "View"). Products with several variants always link to their page so the shopper can choose options. The Shopify and WooCommerce paths are tested against fakes only (see `docs/checklist.md`).

### Where an inline block appears

Product-page and cart blocks are part of the page. Mark the spot:

```html
<div data-convertflow-recommendations></div>              <!-- any placement -->
<div data-convertflow-recommendations="cart"></div>       <!-- only the cart block -->
<div data-convertflow-recommendations="product_page"></div>
```

Without a marked spot the block goes at the end of `<main>`, else the end of `<body>`. A toast-placed recommendation floats in a corner and needs no spot. A cart *drawer* that is created after page load is not detected: put the marker inside it.

## Lifecycle

`ConvertFlow.destroy()` removes everything the SDK added (UI, listeners, timers, cart hooks) and allows a fresh boot.

## What the server is asked

A recommendation block calls `GET /api/v1/recommendations?siteId&campaignId&productId?&cart?&subtotal?`. The request names the campaign and the page only: **the options (source, count, collections) always come from the campaign that is live**, never from the request. Only products the catalog positively says are in stock are returned, and every reason to show nothing (unknown site, paused campaign, kill switch, a plan without the tool) gives the same empty answer. Responses are never cached, so availability is current; each view costs a few D1 reads (see `docs/checklist.md`, Phase 4).

## Hosting: the whole `dist/` directory, not just `cf.js`

`cf.js` is the only script every page downloads (about 10 KB gzip). Toast, feed, upsell and email-form renderers are separate scripts, `cf-<tool>.<hash>.js`, that `cf.js` fetches **from the same directory** the first time a campaign of that tool is eligible (it starts the fetch as soon as that campaign is chosen, so the script is usually there when its trigger fires). Serve the whole `apps/storefront-sdk/dist/` directory; the `_headers` file there gives the tool scripts a one-year `immutable` cache (their names change with their content, and the core is built knowing the current names, so a cached core can never ask for a script from another release) and `cf.js` a one-hour cache.

- A page that only uses a plain popup, slide-in or bar downloads nothing but `cf.js`.
- If a tool script fails to load (blocked, offline, wrong host), that tool shows nothing on that page and is not retried in a loop; other campaigns are unaffected.
- A site with a Content-Security-Policy must allow the SDK's origin in `script-src` (the tool scripts come from the same origin as `cf.js`). This has not been tested against a real CSP.

## Email signup forms

Popup, slide-in, announcement-bar and **inline** forms. An inline form is part of the page, not an overlay: it goes where you put an element with the attribute `data-convertflow-form`, else at the end of `<main>`, else at the end of the page. It needs no trigger and is shown to anyone who has not already signed up. After signing up it stays on screen to show the confirmation message.

```html
<div data-convertflow-form></div>
```

A form may ask for a first name (optional for the shopper). The consent words are the merchant's, read by the server from the published form. If the form has an incentive (a discount code), it is **never drawn on the page**: the shopper receives it on the confirmation page and by email only after confirming from their inbox.
