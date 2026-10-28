// UNVERIFIED against Shopify's sandbox: written to the documented web pixel API.
// Runs in Shopify's strict sandbox: no DOM access. It only reports completed checkouts.
// Shopify only runs this pixel for customers whose privacy settings allow analytics
// (see customer_privacy in shopify.extension.toml), which is our consent signal here.
import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, settings }) => {
  const siteKey = settings.site_key;
  const api = settings.api_url;
  if (!siteKey || !api) return;

  analytics.subscribe("checkout_completed", async (event) => {
    const checkout = event.data?.checkout;
    const orderId = checkout?.order?.id;
    const total = Number(checkout?.totalPrice?.amount);
    const currency = checkout?.totalPrice?.currencyCode;
    if (!orderId || !Number.isFinite(total) || !currency) return;

    // Last click written by the storefront script as "<campaignId>.<versionId>.<epochMs>".
    let lastClick;
    try {
      const raw = await browser.cookie.get("cf_lc");
      const [campaignId, versionId, at] = String(raw || "").split(".");
      if (campaignId && versionId && Number(at)) lastClick = { campaignId, versionId, clickedAt: new Date(Number(at)).toISOString() };
    } catch (_) { /* cookie unavailable: purchase is still counted, just not attributed */ }

    const body = {
      consent: true,
      events: [{
        eventId: `px_${String(orderId).replace(/\W/g, "")}`.slice(0, 64), // deterministic: retries and double fires are de-duplicated
        type: "purchase_observed", siteId: siteKey, sessionId: String(event.clientId || "unknown").padEnd(8, "0"),
        occurredAt: new Date(event.timestamp || Date.now()).toISOString(), schemaVersion: 1,
        // Same key the orders/create webhook uses, so one order is one conversion; the pixel adds attribution.
        order: { orderId: `shopify:${String(orderId).replace(/^gid:\/\/shopify\/Order\//, "")}`, total, currency, ...(lastClick ? { lastClick } : {}) },
      }],
    };
    try {
      await fetch(`${api}/api/v1/events/batch`, { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch (_) { /* never surface errors into checkout */ }
  });
});
