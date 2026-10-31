/**
 * Every external system the platform can talk to, and exactly which capabilities are built for each. This is the
 * single place the dashboard reads to describe an integration, so it can never claim more than exists.
 *
 * `verification`:
 * - `none_needed`: no third party is involved (manual import, the storefront SDK).
 * - `unverified`: built against the vendor's documented API and tested with fakes or recorded shapes, never run against
 *   the real service. The dashboard must say so.
 * - `verified`: run end to end against the real service. Nothing is in this state yet.
 *
 * A connection can still be individually verified (a list provider whose live check passed); see the API's status view.
 */

export const INTEGRATION_KINDS = ["commerce_platform", "list_provider", "messaging_provider"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const INTEGRATION_CAPABILITIES = {
  "storefront.sdk": "Campaigns are served on the storefront through the script snippet",
  "catalog.import": "Products can be imported as JSON or CSV",
  "catalog.sync": "Products are pulled from the platform's API on request",
  "catalog.webhooks": "Product changes arrive by signed webhook",
  "orders.webhooks": "New orders arrive by signed webhook and become platform events",
  "privacy.webhooks": "The platform's data-request and erasure webhooks are handled",
  "app.lifecycle": "Uninstalling the app at the platform disconnects the store",
  "oauth.install": "Installation and token exchange through the platform",
  "billing.platform": "Charges through the platform's own billing",
  "storefront.platform_setup": "The app sets up its own storefront pieces at the platform (purchase pixel, theme embed settings, plugin)",
  "inventory.webhooks": "Stock changes arrive by signed webhook and update availability (drives back-in-stock alerts)",
  "subscribers.sync": "Confirmed email subscribers are copied to a list, and opt-outs removed",
  "subscribers.sync_sms": "Verified SMS subscribers are copied with their SMS consent, and opt-outs removed",
  "phone.verification": "Shoppers confirm an SMS signup with a one-time code texted to their number",
} as const;
export type IntegrationCapability = keyof typeof INTEGRATION_CAPABILITIES;

export interface IntegrationProvider {
  key: string;
  name: string;
  kind: IntegrationKind;
  /** Built and tested (at the level `verification` states). */
  capabilities: readonly IntegrationCapability[];
  /** Named so the gap is visible; not built. */
  planned: readonly IntegrationCapability[];
  verification: "none_needed" | "unverified" | "verified";
}

const SDK: IntegrationCapability[] = ["storefront.sdk", "catalog.import"];

export const INTEGRATION_PROVIDERS = {
  shopify: {
    key: "shopify", name: "Shopify", kind: "commerce_platform", verification: "unverified",
    capabilities: [...SDK, "oauth.install", "catalog.sync", "catalog.webhooks", "inventory.webhooks", "orders.webhooks", "privacy.webhooks", "app.lifecycle", "billing.platform", "storefront.platform_setup"],
    planned: [],
  },
  // "oauth.install" is WooCommerce's own key approval (/wc-auth/v1/authorize), its equivalent of an OAuth install.
  // "storefront.platform_setup" is the WordPress plugin (apps/woocommerce-plugin): script, page data, purchase reporting.
  woocommerce: {
    key: "woocommerce", name: "WooCommerce", kind: "commerce_platform", verification: "unverified",
    capabilities: [...SDK, "oauth.install", "catalog.sync", "catalog.webhooks", "orders.webhooks", "storefront.platform_setup"], planned: [],
  },
  bigcommerce: { key: "bigcommerce", name: "BigCommerce", kind: "commerce_platform", verification: "unverified", capabilities: [...SDK, "catalog.sync"], planned: ["orders.webhooks"] },
  magento: { key: "magento", name: "Magento", kind: "commerce_platform", verification: "none_needed", capabilities: SDK, planned: ["catalog.sync"] },
  custom: { key: "custom", name: "Custom store", kind: "commerce_platform", verification: "none_needed", capabilities: SDK, planned: [] },
  klaviyo: { key: "klaviyo", name: "Klaviyo", kind: "list_provider", verification: "unverified", capabilities: ["subscribers.sync", "subscribers.sync_sms"], planned: [] },
  mailchimp: { key: "mailchimp", name: "Mailchimp", kind: "list_provider", verification: "unverified", capabilities: ["subscribers.sync"], planned: [] },
  // Platform-level: one Twilio Verify service for every store, configured with secrets by the operator, not by merchants.
  twilio: { key: "twilio", name: "Twilio Verify", kind: "messaging_provider", verification: "unverified", capabilities: ["phone.verification"], planned: [] },
} as const satisfies Record<string, IntegrationProvider>;

export type IntegrationProviderKey = keyof typeof INTEGRATION_PROVIDERS;
