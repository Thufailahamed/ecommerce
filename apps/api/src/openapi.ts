import { z } from "zod";
import { CampaignConfig, EventBatch, PLANS } from "@convertflow/contracts";
import { CatalogProductInput } from "./services/catalog.js";

type Auth = "none" | "session" | "signature";
type Role = "viewer" | "editor" | "admin" | "owner";
interface R { m: "get" | "post" | "put" | "patch" | "delete"; p: string; s: string; auth?: Auth; role?: Role; body?: z.ZodType; note?: string }

/**
 * Every route the app serves. `openapi.test.ts` fails if this list and the real router disagree, so the
 * document cannot drift. Request bodies reference the same Zod schemas the handlers validate with.
 */
const ROUTES: R[] = [
  { m: "get", p: "/health", s: "Liveness probe", auth: "none" },
  { m: "get", p: "/api/v1/openapi.json", s: "This document", auth: "none" },
  { m: "get", p: "/sdk/v1/config/:file", s: "Edge-served storefront config for a site key (<key>.json). Public, CORS *, cacheable.", auth: "none" },
  { m: "post", p: "/api/v1/events/batch", s: "Ingest consented analytics events (<=50, <=64 KB). 202 accepted; 204 for unknown sites.", auth: "none", body: EventBatch },

  { m: "post", p: "/api/v1/auth/register", s: "Create an account and workspace. Sends a verification email when email is configured.", auth: "none" },
  { m: "post", p: "/api/v1/auth/login", s: "Sign in. Returns 401 mfa_required when a second factor is needed (resend with `code`).", auth: "none" },
  { m: "post", p: "/api/v1/auth/forgot-password", s: "Request a password reset email. Identical response whether or not the account exists.", auth: "none" },
  { m: "post", p: "/api/v1/auth/reset-password", s: "Set a new password with a single-use token. Signs out all devices.", auth: "none" },
  { m: "post", p: "/api/v1/auth/verify-email", s: "Confirm an email address with a single-use token.", auth: "none" },
  { m: "post", p: "/api/v1/auth/logout", s: "End the current session", auth: "session" },
  { m: "get", p: "/api/v1/auth/me", s: "Current user and their workspaces", auth: "session" },
  { m: "get", p: "/api/v1/auth/security", s: "MFA and email-verification status", auth: "session" },
  { m: "post", p: "/api/v1/auth/resend-verification", s: "Resend the verification email", auth: "session" },
  { m: "post", p: "/api/v1/auth/mfa/start", s: "Begin TOTP enrolment; returns the secret and otpauth URL", auth: "session" },
  { m: "post", p: "/api/v1/auth/mfa/confirm", s: "Confirm TOTP with a code; returns single-use recovery codes once", auth: "session" },
  { m: "post", p: "/api/v1/auth/mfa/disable", s: "Turn MFA off (needs password and a current code)", auth: "session" },
  { m: "delete", p: "/api/v1/auth/account", s: "Permanently delete the account (needs password)", auth: "session" },

  { m: "post", p: "/api/v1/organizations", s: "Create another workspace (max 5 owned)", auth: "session" },
  { m: "get", p: "/api/v1/organizations/:orgId/team", s: "Members and pending invites", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/organizations/:orgId/invites", s: "Invite someone by email. Returns a shareable link even without email delivery.", auth: "session", role: "admin" },
  { m: "delete", p: "/api/v1/organizations/:orgId/invites/:inviteId", s: "Revoke a pending invite", auth: "session", role: "admin" },
  { m: "patch", p: "/api/v1/organizations/:orgId/members/:userId", s: "Change a member's role", auth: "session", role: "owner" },
  { m: "delete", p: "/api/v1/organizations/:orgId/members/:userId", s: "Remove a member, or leave the workspace yourself", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/invitations/accept", s: "Accept an invitation (signed-in email must match the invite)", auth: "session" },

  { m: "get", p: "/api/v1/stores", s: "Stores you can access", auth: "session" },
  { m: "post", p: "/api/v1/stores", s: "Connect a store (plan-limited)", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId", s: "Store details", auth: "session", role: "viewer" },
  { m: "delete", p: "/api/v1/stores/:storeId", s: "Disconnect a store", auth: "session", role: "owner" },
  { m: "patch", p: "/api/v1/stores/:storeId/delivery", s: "Kill switch: pause or resume all campaigns", auth: "session", role: "admin" },
  { m: "patch", p: "/api/v1/stores/:storeId/settings", s: "Set the maximum discount any promotion may use (null = promotions off)", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/integration", s: "Install snippet, catalog and connection status", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/stores/:storeId/integration/connect", s: "Store encrypted WooCommerce/BigCommerce catalog credentials", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/integration/sync", s: "Import one page of the live catalog; loop until nextPage is null", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/stores/:storeId/products", s: "Catalog", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/stores/:storeId/products/import", s: "Upsert up to 100 products; detects restocks and sends alerts", auth: "session", role: "editor", body: z.object({ products: z.array(CatalogProductInput).max(100) }) },

  { m: "get", p: "/api/v1/stores/:storeId/relationships", s: "Merchant-set product links for the upsell tool (optional query: productId, a catalog id)", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/stores/:storeId/relationships", s: "Link two catalog products as a complement or an alternative (body: productId, relatedProductId, kind, weight). 201 when new, 200 when it updated an existing link.", auth: "session", role: "editor" },
  { m: "delete", p: "/api/v1/stores/:storeId/relationships/:id", s: "Remove a product link", auth: "session", role: "editor" },

  { m: "get", p: "/api/v1/stores/:storeId/campaigns", s: "List campaigns (optional query: tool = toast|feed|upsell|sms|email)", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns", s: "Create a draft", auth: "session", role: "editor", body: CampaignConfig },
  { m: "get", p: "/api/v1/stores/:storeId/campaigns/:id", s: "Get a campaign", auth: "session", role: "viewer" },
  { m: "put", p: "/api/v1/stores/:storeId/campaigns/:id", s: "Update the draft", auth: "session", role: "editor", body: CampaignConfig },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/validate", s: "Validate a config; returns issues and warnings", auth: "session", role: "viewer", body: CampaignConfig },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/ai-generate", s: "Generate a draft with AI (metered, never published)", auth: "session", role: "editor", note: "Body: objective, optional tool (auto|toast|feed|upsell|sms|email; a tool that is not shipped answers 409 tool_unavailable), freeShippingThreshold, consentText, privacyUrl, allowedPromotion. The AI never writes consent text or invents promotions, urgency, social proof or shipping claims; the response lists repairs and warnings." },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/publish", s: "Publish with explicit approval ({approve:true, approvedUpdatedAt}); 409 if the draft changed", auth: "session", role: "admin", note: "Checks plan entitlements, email verification and the promotion guardrail." },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/pause", s: "Pause a live campaign", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/resume", s: "Resume a paused campaign", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/archive", s: "Archive", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/duplicate", s: "Duplicate into a new draft", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/rollback", s: "Republish an earlier version as a new one", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/campaigns/:id/versions", s: "Immutable version history", auth: "session", role: "viewer" },

  { m: "get", p: "/api/v1/stores/:storeId/analytics", s: "Totals, per-campaign metrics, attributed revenue and experiment results (query: from, to)", auth: "session", role: "viewer" },
  { m: "get", p: "/api/v1/stores/:storeId/analytics/tools", s: "Per-tool rollups (toast, feed, upsell, sms, email) with a per-campaign drill-down (query: from, to; at most 366 days)", auth: "session", role: "viewer" },
  { m: "get", p: "/api/v1/stores/:storeId/audit", s: "Audit log", auth: "session", role: "admin" },

  { m: "get", p: "/api/v1/stores/:storeId/contacts", s: "List contacts, newest first (query: limit, cursor, email, phone, channel + status)", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/stores/:storeId/contacts/export", s: "CSV of everyone currently subscribed by email (up to 50,000; header x-export-truncated when cut). Audited.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/contacts/:contactId", s: "A contact with its full consent history", auth: "session", role: "editor" },
  { m: "delete", p: "/api/v1/stores/:storeId/contacts/:contactId", s: "Erase a contact and its consent history (a hashed suppression entry from any opt-out remains). Their list-provider copies are unsubscribed first; header x-provider-cleanup-failed names any provider that could not be reached.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/providers", s: "Klaviyo and Mailchimp connection status, chosen list, whether a check has passed against the live provider, and sync counts", auth: "session", role: "editor" },
  { m: "put", p: "/api/v1/stores/:storeId/providers/:provider", s: "Connect a provider (body apiKey: checked against the provider, stored encrypted, never returned) and/or choose its list (listId, optional syncExisting)", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/providers/:provider/lists", s: "Lists the stored key can see (also re-checks the connection)", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/providers/:provider/check", s: "Re-run the connection check and record the outcome", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/providers/:provider/retry", s: "Put failed sync jobs back in the queue", auth: "session", role: "admin" },
  { m: "delete", p: "/api/v1/stores/:storeId/providers/:provider", s: "Disconnect a provider (its sync jobs are removed; people already copied there stay)", auth: "session", role: "admin" },

  { m: "get", p: "/api/v1/billing/plans", s: "Plan limits (the same data the pricing page renders)", auth: "none" },
  { m: "get", p: "/api/v1/billing/subscription", s: "Plan, status and usage for a workspace (query: organizationId)", auth: "session" },
  { m: "post", p: "/api/v1/billing/checkout", s: "Start Stripe Checkout (owner only)", auth: "session", role: "owner" },
  { m: "post", p: "/api/v1/billing/portal", s: "Open the Stripe customer portal (owner only)", auth: "session", role: "owner" },

  { m: "post", p: "/api/v1/notifications/restock", s: "Public: request a back-in-stock alert. Always 202. Double opt-in by email.", auth: "none" },
  { m: "get", p: "/api/v1/notifications/confirm", s: "Public: confirm a back-in-stock subscription (single-use token)", auth: "none" },
  { m: "get", p: "/api/v1/notifications/unsubscribe", s: "Public: unsubscribe (signed token)", auth: "none" },
  { m: "post", p: "/api/v1/notifications/unsubscribe", s: "Public: RFC 8058 one-click unsubscribe", auth: "none" },
  { m: "post", p: "/api/v1/notifications/subscribe", s: "Public: request a marketing email subscription through a published email form (body: siteId, campaignId, email, optional firstName, consent=true). Always 202. Double opt-in; the consent text is the form's, read server-side.", auth: "none" },
  { m: "get", p: "/api/v1/notifications/subscribe/confirm", s: "Public: confirm a marketing email subscription (single-use token). Shows the form's incentive code, if it had one, only now.", auth: "none" },
  { m: "get", p: "/api/v1/notifications/subscribe/unsubscribe", s: "Public: unsubscribe from marketing email (signed token)", auth: "none" },
  { m: "post", p: "/api/v1/notifications/subscribe/unsubscribe", s: "Public: RFC 8058 one-click unsubscribe from marketing email", auth: "none" },

  { m: "get", p: "/api/v1/recommendations", s: "Public: products for a live upsell campaign (query: siteId, campaignId, productId?, cart? comma-separated catalog ids, subtotal?). Options come from the live campaign, not the request. Only in-stock products are returned; every reason to show nothing returns the same empty list. Never cached.", auth: "none" },

  { m: "post", p: "/api/v1/webhooks/shopify", s: "Shopify webhooks (HMAC-verified, idempotent)", auth: "signature" },
  { m: "post", p: "/api/v1/webhooks/stripe", s: "Stripe webhooks (signature-verified)", auth: "signature" },
];

const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z]+)/g, "{$1}");
export const documentedRoutes = () => ROUTES.map((r) => `${r.m.toUpperCase()} ${r.p}`);

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const params = [...r.p.matchAll(/:([A-Za-z]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    (paths[toOpenApiPath(r.p)] ??= {})[r.m] = {
      summary: r.s,
      ...(r.note ? { description: r.note } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(r.body, { unrepresentable: "any" }) } } } } : {}),
      security: r.auth === "session" ? [{ sessionCookie: [] }] : r.auth === "signature" ? [{ webhookSignature: [] }] : [],
      ...(r.role ? { "x-minimum-role": r.role } : {}),
      responses: {
        "200": { description: "Success: { data } (or 202/204 where noted)" },
        default: { description: "Error: { error: { code, message, details?, requestId } }" },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "ConvertFlow API", version: "1.0.0", description: "Plan limits are enforced server-side. Foreign or unknown resource ids return 404." },
    servers: [{ url: "/" }],
    components: { securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "cf_session" },
      webhookSignature: { type: "apiKey", in: "header", name: "x-shopify-hmac-sha256 / stripe-signature" },
    }, schemas: { Plans: { type: "object", example: PLANS } } },
    paths,
  };
}
