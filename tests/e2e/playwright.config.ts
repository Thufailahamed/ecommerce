import { defineConfig } from "@playwright/test";

/**
 * Real stack: Worker under workerd with fresh local D1, the production-built Next app, a static
 * "storefront" that serves the real SDK bundle, and a mock Resend server so emails can be read.
 * Prerequisite (the web URLs are baked in at build time):
 *   NEXT_PUBLIC_API_URL=http://localhost:8799 NEXT_PUBLIC_SDK_URL=http://localhost:4000 pnpm --filter @convertflow/web build
 *   pnpm --filter @convertflow/storefront-sdk build
 */
// Overridable (E2E_API_PORT) like the ports below, for when a load-test Worker already holds 8799; build web with the same URL.
export const API_PORT = process.env["E2E_API_PORT"] ?? "8799";
export const API = `http://localhost:${API_PORT}`;
export const WEB = "http://localhost:3100";
// The storefront and mailbox ports can be overridden so the suite can run next to a developer stack that already uses
// 4000/4100 (scripts/dev-local.mjs): E2E_STORE_PORT=4010 E2E_MAIL_PORT=4110. Defaults are unchanged.
export const STORE_PORT = process.env["E2E_STORE_PORT"] ?? "4000";
export const MAIL_PORT = process.env["E2E_MAIL_PORT"] ?? "4100";
export const STORE = `http://localhost:${STORE_PORT}`;
export const MAIL = `http://localhost:${MAIL_PORT}`;
// A stand-in for Klaviyo and Mailchimp (mock-providers.mjs), overridable with E2E_PROVIDER_PORT. The API is pointed at it, so a connection made here is never "verified".
export const PROVIDER_PORT = process.env["E2E_PROVIDER_PORT"] ?? "4200";
export const PROVIDERS = `http://localhost:${PROVIDER_PORT}`;
// A stand-in for Shopify's server-side APIs (mock-shopify.mjs). The browser still goes to https://<shop>.myshopify.com for
// authorization and billing approval; shopify.spec.ts answers those with page.route, playing the merchant at Shopify.
export const SHOPIFY_PORT = process.env["E2E_SHOPIFY_PORT"] ?? "4500";
export const SHOPIFY_MOCK = `http://localhost:${SHOPIFY_PORT}`;
export const SHOPIFY_SECRET = "e2e_shopify_secret";
// A stand-in for WooCommerce sites' REST API (mock-woocommerce.mjs). The browser still goes to https://<domain>/wc-auth/v1/authorize;
// woocommerce.spec.ts answers that with page.route, playing the merchant and WooCommerce.
export const WOO_PORT = process.env["E2E_WOO_PORT"] ?? "4600";
export const WOO_MOCK = `http://localhost:${WOO_PORT}`;
// A stand-in for Cloudflare AI Gateway (mock-ai-gateway.mjs) so the store builder's real pipeline runs end to end.
export const AI_PORT = process.env["E2E_AI_PORT"] ?? "4300";
export const AI_GATEWAY = `http://localhost:${AI_PORT}`;

// 32 bytes of 0x07, base64: a throwaway key for the local API only.
const KEY = Buffer.alloc(32, 7).toString("base64");
const VARS = [
  "ALLOWED_ORIGIN:http://localhost:3100",
  `CREDENTIAL_KEY:${KEY}`,
  `API_ORIGIN:${API}`,
  "RESEND_API_KEY:test_key",
  `RESEND_BASE_URL:${MAIL}`,
  `KLAVIYO_BASE_URL:${PROVIDERS}`,
  `MAILCHIMP_BASE_URL:${PROVIDERS}`,
  "EMAIL_FROM:noreply@example.com",
  "AI_GATEWAY_ACCOUNT_ID:e2e-account",
  "AI_GATEWAY_TOKEN:e2e-token",
  `AI_GATEWAY_BASE_URL:${AI_GATEWAY}`,
  // SMS signup: Twilio Verify, answered by mock-providers.mjs (codes readable at /__sms).
  "TWILIO_ACCOUNT_SID:ACe2e00000000000000000000000000000",
  "TWILIO_AUTH_TOKEN:e2e_token",
  "TWILIO_VERIFY_SERVICE_SID:VAe2e",
  `TWILIO_VERIFY_BASE_URL:${PROVIDERS}`,
  // The Shopify app, with its Admin API answered by mock-shopify.mjs.
  "SHOPIFY_API_KEY:e2e_client_id",
  `SHOPIFY_API_SECRET:${SHOPIFY_SECRET}`,
  `SHOPIFY_ADMIN_BASE_URL:${SHOPIFY_MOCK}/{shop}`,
  // WooCommerce REST calls, answered by mock-woocommerce.mjs.
  `WOOCOMMERCE_BASE_URL:${WOO_MOCK}/{domain}`,
].map((v) => `--var ${v}`).join(" ");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: WEB, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "node mock-resend.mjs", url: `${MAIL}/health`, timeout: 30_000, reuseExistingServer: false },
    { command: "node mock-providers.mjs", url: `${PROVIDERS}/health`, timeout: 30_000, reuseExistingServer: false },
    { command: "node mock-ai-gateway.mjs", url: `${AI_GATEWAY}/health`, timeout: 30_000, reuseExistingServer: false },
    { command: "node mock-shopify.mjs", url: `${SHOPIFY_MOCK}/health`, timeout: 30_000, reuseExistingServer: false },
    { command: "node mock-woocommerce.mjs", url: `${WOO_MOCK}/health`, timeout: 30_000, reuseExistingServer: false },
    {
      command: `node prepare.mjs && cd ../../apps/api && pnpm exec wrangler d1 migrations apply convertflow --local --persist-to ../../tests/e2e/.state && pnpm exec wrangler dev --local --port ${API_PORT} --persist-to ../../tests/e2e/.state ${VARS}`,
      url: `${API}/health`, timeout: 180_000, reuseExistingServer: false,
    },
    { command: "cd ../../apps/web && pnpm exec next start -p 3100", url: WEB, timeout: 90_000, reuseExistingServer: false },
    { command: "node static-server.mjs", url: `${STORE}/health`, timeout: 30_000, reuseExistingServer: false },
  ],
});
