import { defineConfig } from "@playwright/test";

/**
 * Real stack: Worker under workerd with fresh local D1, the production-built Next app, a static
 * "storefront" that serves the real SDK bundle, and a mock Resend server so emails can be read.
 * Prerequisite (the web URLs are baked in at build time):
 *   NEXT_PUBLIC_API_URL=http://localhost:8799 NEXT_PUBLIC_SDK_URL=http://localhost:4000 pnpm --filter @convertflow/web build
 *   pnpm --filter @convertflow/storefront-sdk build
 */
export const API = "http://localhost:8799";
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

// 32 bytes of 0x07, base64: a throwaway key for the local API only.
const KEY = Buffer.alloc(32, 7).toString("base64");
const VARS = [
  "ALLOWED_ORIGIN:http://localhost:3100",
  `CREDENTIAL_KEY:${KEY}`,
  "API_ORIGIN:http://localhost:8799",
  "RESEND_API_KEY:test_key",
  `RESEND_BASE_URL:${MAIL}`,
  `KLAVIYO_BASE_URL:${PROVIDERS}`,
  `MAILCHIMP_BASE_URL:${PROVIDERS}`,
  "EMAIL_FROM:noreply@example.com",
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
    {
      command: `node prepare.mjs && cd ../../apps/api && pnpm exec wrangler d1 migrations apply convertflow --local --persist-to ../../tests/e2e/.state && pnpm exec wrangler dev --local --port 8799 --persist-to ../../tests/e2e/.state ${VARS}`,
      url: `${API}/health`, timeout: 180_000, reuseExistingServer: false,
    },
    { command: "cd ../../apps/web && pnpm exec next start -p 3100", url: WEB, timeout: 90_000, reuseExistingServer: false },
    { command: "node static-server.mjs", url: `${STORE}/health`, timeout: 30_000, reuseExistingServer: false },
  ],
});
