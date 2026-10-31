import { z } from "zod";
import { CampaignConfig, CampaignGroupInput, CampaignTemplateInput, EventBatch, GroupMembersInput, PLANS } from "@convertflow/contracts";
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
  { m: "get", p: "/api/v1/organizations/:orgId/audit", s: "Workspace audit log including every store's entries, newest first (query: limit, cursor)", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/organizations/:orgId/invites", s: "Invite someone by email. Returns a shareable link even without email delivery.", auth: "session", role: "admin" },
  { m: "delete", p: "/api/v1/organizations/:orgId/invites/:inviteId", s: "Revoke a pending invite", auth: "session", role: "admin" },
  { m: "patch", p: "/api/v1/organizations/:orgId/members/:userId", s: "Change a member's role", auth: "session", role: "owner" },
  { m: "delete", p: "/api/v1/organizations/:orgId/members/:userId", s: "Remove a member, or leave the workspace yourself", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/invitations/accept", s: "Accept an invitation (signed-in email must match the invite)", auth: "session" },

  { m: "get", p: "/api/v1/stores", s: "Stores you can access", auth: "session" },
  { m: "post", p: "/api/v1/stores", s: "Connect a store (plan-limited)", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId", s: "Store details, with your role and the permissions it holds", auth: "session", role: "viewer" },
  { m: "delete", p: "/api/v1/stores/:storeId", s: "Disconnect a store", auth: "session", role: "owner" },
  { m: "patch", p: "/api/v1/stores/:storeId/delivery", s: "Kill switch: pause or resume all campaigns", auth: "session", role: "admin" },
  { m: "patch", p: "/api/v1/stores/:storeId/settings", s: "Set the maximum discount any promotion may use (null = promotions off)", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/integration", s: "Install snippet, catalog and connection status", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/stores/:storeId/integration/connect", s: "Store encrypted WooCommerce/BigCommerce catalog credentials", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/integration/sync", s: "Import one page of the live catalog. WooCommerce/BigCommerce: send page, loop until nextPage is null. Shopify: send cursor (null first), loop until nextCursor is null; truncatedVariants counts products with more than 50 variants.", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/shopify/connect", s: "Start installing the Shopify app for this store (body: shop = <name>.myshopify.com). Returns the Shopify authorization URL; the callback links the shop only for the same signed-in user.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/shopify", s: "Shopify installation status for this store: shop, granted and missing scopes, install and uninstall times. Never the token.", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/shopify/install", s: "Shopify App URL (install and launch from the Shopify admin). HMAC- and timestamp-verified; redirects to authorization, or to the dashboard when already installed.", auth: "signature" },
  { m: "get", p: "/api/v1/shopify/callback", s: "Shopify OAuth callback: verifies HMAC, single-use state and shop, exchanges the code for an offline token, then links the store or holds the install for claiming. Redirects to the dashboard.", auth: "signature" },
  { m: "post", p: "/api/v1/stores/:storeId/shopify/setup", s: "Create or update the app web pixel and write the site key into the theme app embed settings (runs on install; retry here). Returns pixelActive, embedSettingsSavedAt, error.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/shopify/theme-embed", s: "Live check of whether the app embed is switched on in the published theme (enabled, disabled or unknown), with the theme editor link that activates it.", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/woocommerce/authorize", s: "Start WooCommerce key approval for this store. Returns the store /wc-auth/v1/authorize URL; WooCommerce posts the keys to /woocommerce/callback.", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/woocommerce/callback", s: "WooCommerce key delivery (server to server). Accepted only with the single-use state from an approval this app started.", auth: "signature" },
  { m: "get", p: "/api/v1/stores/:storeId/woocommerce", s: "WooCommerce connection: method, key permissions, verification, webhook state. Never the keys or the webhook secret.", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/woocommerce/setup", s: "Verify the stored keys against the store and create or repair the app webhooks. Safe to repeat.", auth: "session", role: "admin" },
  { m: "delete", p: "/api/v1/stores/:storeId/woocommerce", s: "Disconnect WooCommerce: delete the app webhooks at the store and the stored keys. The store, campaigns and catalog stay.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/shopify/claim", s: "Which shop a pending install link is for (query: token)", auth: "session" },
  { m: "post", p: "/api/v1/shopify/claim", s: "Attach a pending Shopify install to a workspace (body: token, organizationId). Reactivates that workspace's store for the shop or creates one within the plan's store limit.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/workflows", s: "Automation workflows (preview: 403 feature_unavailable unless the workspace has workflows.create)", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/workflows", s: "Create a workflow draft (body: name, definition). Drafts never run.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/workflows/:id", s: "A workflow", auth: "session", role: "editor" },
  { m: "put", p: "/api/v1/stores/:storeId/workflows/:id", s: "Replace the draft (body: name, definition)", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/workflows/:id/activate", s: "Activate the reviewed draft as a new immutable version ({approve:true, approvedUpdatedAt}); runs on the activating member's authority", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/workflows/:id/pause", s: "Pause; scheduled runs are cancelled", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/workflows/:id/archive", s: "Archive; scheduled runs are cancelled", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/workflows/:id/runs", s: "The last 50 runs with each guard, condition and action outcome", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/stores/:storeId/action-requests", s: "Actions waiting for (or decided by) a merchant, from workflows and the AI manager (query: status, origin, planId)", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/action-requests/:id/approve", s: "Approve and run a pending action on your authority (you need the action's own permission)", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/action-requests/:id/reject", s: "Reject a pending action", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/stores/:storeId/integrations", s: "Integration registry for the store: its commerce platform and every list provider, with built and planned capabilities, verification state and live connection status", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/integrations/:provider/health", s: "Run the provider's live health check (409 when it has none)", auth: "session", role: "admin" },
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
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/ai-generate", s: "Generate a draft with AI, or refine a saved draft (metered, never published)", auth: "session", role: "editor", note: "Body: objective, optional campaignId (refines that draft in place; only drafts are accepted), tool (auto|toast|feed|upsell|sms|email; a tool that is not shipped answers 409 tool_unavailable), feedback, freeShippingThreshold, consentText, privacyUrl, allowedPromotion. The AI never writes consent text or invents promotions, urgency, social proof or shipping claims; the response lists repairs and warnings." },
  { m: "post", p: "/api/v1/stores/:storeId/ai/insights", s: "Plain-language summary of aggregate performance (body: days 7|30|90). Metered. The model sees aggregate figures only and may quote no number that is not in them; with no data the answer is a fixed sentence and no model is called.", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/ai/plans", s: "AI Commerce Manager (preview: needs ai.commerce_manager). Body: objective. Proposes at most five registered actions; each that passes the registry, schema, store rules, campaign policy and evidence checks becomes a pending action request (planId). Nothing is executed. Metered.", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/publish", s: "Publish with explicit approval ({approve:true, approvedUpdatedAt}); 409 if the draft changed", auth: "session", role: "admin", note: "Checks plan entitlements, email verification and the promotion guardrail." },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/pause", s: "Pause a live campaign", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/resume", s: "Resume a paused campaign", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/archive", s: "Archive", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/duplicate", s: "Duplicate into a new draft", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/campaigns/:id/rollback", s: "Republish an earlier version as a new one", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/campaigns/:id/versions", s: "Immutable version history", auth: "session", role: "viewer" },

  { m: "get", p: "/api/v1/stores/:storeId/campaign-groups", s: "Groups (merchant folders) with their campaign ids", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/stores/:storeId/campaign-groups", s: "Create a group (max 50 per store; names unique per store)", auth: "session", role: "editor", body: CampaignGroupInput },
  { m: "patch", p: "/api/v1/stores/:storeId/campaign-groups/:groupId", s: "Rename a group", auth: "session", role: "editor", body: CampaignGroupInput },
  { m: "delete", p: "/api/v1/stores/:storeId/campaign-groups/:groupId", s: "Delete a group. Its campaigns are kept.", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/campaign-groups/:groupId/members", s: "Add campaigns to a group (body: campaignIds, all must belong to this store)", auth: "session", role: "editor", body: GroupMembersInput },
  { m: "delete", p: "/api/v1/stores/:storeId/campaign-groups/:groupId/members/:campaignId", s: "Remove a campaign from a group. Idempotent.", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/stores/:storeId/campaign-templates", s: "Saved templates (config is fetched when a campaign is made from one)", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/stores/:storeId/campaign-templates", s: "Save a campaign's valid draft as a template (body: name, campaignId; max 50 per store)", auth: "session", role: "editor", body: CampaignTemplateInput },
  { m: "delete", p: "/api/v1/stores/:storeId/campaign-templates/:templateId", s: "Delete a saved template", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/stores/:storeId/campaign-templates/:templateId/campaigns", s: "Start a new draft campaign from a saved template. Nothing is published.", auth: "session", role: "editor" },

  { m: "get", p: "/api/v1/stores/:storeId/analytics", s: "Totals, per-campaign metrics, attributed revenue and experiment results (query: from, to)", auth: "session", role: "viewer" },
  { m: "get", p: "/api/v1/stores/:storeId/analytics/tools", s: "Per-tool rollups (toast, feed, upsell, sms, email) with a per-campaign drill-down (query: from, to; at most 366 days)", auth: "session", role: "viewer" },
  { m: "get", p: "/api/v1/stores/:storeId/audit", s: "Audit log, newest first (query: limit <= 100, cursor from nextCursor)", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/platform-events", s: "Recent platform events for the store with each subscriber's delivery status (query: status = pending|delivered|failed, limit). Payloads are not returned.", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/platform-events/:eventId/retry", s: "Deliver an undelivered platform event again; subscribers that already succeeded are not re-run. Audited.", auth: "session", role: "admin" },

  { m: "get", p: "/api/v1/stores/:storeId/contacts", s: "List contacts, newest first (query: limit, cursor, email, phone, channel + status)", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/stores/:storeId/contacts/export", s: "CSV of everyone currently subscribed on one channel (query: channel = email|sms, default email; up to 50,000; header x-export-truncated when cut). Audited.", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/contacts/:contactId/opt-out", s: "Record an opt-out the merchant received elsewhere (body: channel = email|sms): unsubscribes, suppresses the identifier and removes list-provider copies. Audited.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/contacts/:contactId", s: "A contact with its full consent history", auth: "session", role: "editor" },
  { m: "delete", p: "/api/v1/stores/:storeId/contacts/:contactId", s: "Erase a contact and its consent history (a hashed suppression entry from any opt-out remains). Their list-provider copies are unsubscribed first; header x-provider-cleanup-failed names any provider that could not be reached.", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/providers", s: "Klaviyo and Mailchimp connection status, chosen list, whether a check has passed against the live provider, and sync counts", auth: "session", role: "editor" },
  { m: "put", p: "/api/v1/stores/:storeId/providers/:provider", s: "Connect a provider (body apiKey: checked against the provider, stored encrypted, never returned) and/or choose its list (listId, optional syncExisting)", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/stores/:storeId/providers/:provider/lists", s: "Lists the stored key can see (also re-checks the connection)", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/providers/:provider/check", s: "Re-run the connection check and record the outcome", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/stores/:storeId/providers/:provider/retry", s: "Put failed sync jobs back in the queue", auth: "session", role: "admin" },
  { m: "delete", p: "/api/v1/stores/:storeId/providers/:provider", s: "Disconnect a provider (its sync jobs are removed; people already copied there stay)", auth: "session", role: "admin" },

  { m: "get", p: "/api/v1/sites", s: "AI-built stores in a workspace (query: organizationId)", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/sites", s: "Create a store (plan-limited). Body: organizationId, name?, prompt?, currency, preset?", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/sites/:siteId", s: "A store with its draft document, revision, AI availability and usage", auth: "session", role: "viewer" },
  { m: "patch", p: "/api/v1/sites/:siteId", s: "Rename (editor); change the public address or notification email (admin)", auth: "session", role: "editor" },
  { m: "delete", p: "/api/v1/sites/:siteId", s: "Archive a store: unpublished immediately, payment key removed", auth: "session", role: "admin" },
  { m: "put", p: "/api/v1/sites/:siteId/draft", s: "Save the draft document ({document, revision}); 409 stale_revision when someone else saved first", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/sites/:siteId/versions", s: "Version history (AI turns, checkpoints, restores, publishes), newest first", auth: "session", role: "viewer" },
  { m: "get", p: "/api/v1/sites/:siteId/versions/:versionId", s: "One version with its document", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/sites/:siteId/versions/:versionId/restore", s: "Copy a version into the draft ({revision})", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/sites/:siteId/publish", s: "Publish the reviewed draft ({approve:true, revision}); 422 not_ready lists what blocks it", auth: "session", role: "admin" },
  { m: "post", p: "/api/v1/sites/:siteId/unpublish", s: "Take the store offline", auth: "session", role: "admin" },
  { m: "put", p: "/api/v1/sites/:siteId/payments", s: "Connect ({stripeSecretKey}: checked against Stripe, stored encrypted, never returned) or disconnect (null) the merchant's Stripe account", auth: "session", role: "admin" },
  { m: "get", p: "/api/v1/sites/:siteId/messages", s: "The builder conversation", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/sites/:siteId/chat", s: "One AI builder turn ({message, selection?, path?, mode?}). Responds with server-sent events: start, status, delta, doc, ops, done | error. Metered.", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/sites/:siteId/assets", s: "Uploaded and generated images", auth: "session", role: "viewer" },
  { m: "post", p: "/api/v1/sites/:siteId/assets", s: "Upload an image (raw bytes, <= 4 MB; type sniffed from the bytes; query alt?)", auth: "session", role: "editor" },
  { m: "post", p: "/api/v1/sites/:siteId/assets/generate", s: "Generate an image with AI ({prompt, alt?}). Metered.", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/sites/:siteId/orders", s: "Orders placed on the published store, newest first", auth: "session", role: "editor" },
  { m: "patch", p: "/api/v1/sites/:siteId/orders/:orderId", s: "Mark an order paid (offline payment), fulfilled or cancelled", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/sites/:siteId/submissions", s: "Newsletter sign-ups and contact messages", auth: "session", role: "editor" },
  { m: "get", p: "/api/v1/storefront/:slug", s: "Public: the published store document. CORS *, briefly cacheable.", auth: "none" },
  { m: "get", p: "/api/v1/storefront/assets/:assetId", s: "Public: an image (immutable, cached for a year)", auth: "none" },
  { m: "post", p: "/api/v1/storefront/:slug/checkout", s: "Public: place an order. Priced on the server from the published catalogue; returns a Stripe Checkout URL when the store takes card payment.", auth: "none" },
  { m: "get", p: "/api/v1/storefront/:slug/orders/:orderId", s: "Public: an order, with the token from its confirmation link (query: token). Confirms Stripe payment.", auth: "none" },
  { m: "post", p: "/api/v1/storefront/:slug/forms", s: "Public: newsletter sign-up or contact message. Always 202.", auth: "none" },

  { m: "get", p: "/api/v1/billing/plans", s: "Plan limits (the same data the pricing page renders)", auth: "none" },
  { m: "get", p: "/api/v1/billing/subscription", s: "Plan, status and usage for a workspace (query: organizationId)", auth: "session" },
  { m: "post", p: "/api/v1/billing/checkout", s: "Start Stripe Checkout (owner only)", auth: "session", role: "owner" },
  { m: "post", p: "/api/v1/billing/portal", s: "Open the Stripe customer portal (owner only)", auth: "session", role: "owner" },
  { m: "post", p: "/api/v1/billing/shopify/subscribe", s: "Start a Shopify Billing subscription for a paid plan (body: organizationId, plan, optional storeId). Returns Shopify's approval URL; nothing changes until Shopify reports the charge active.", auth: "session", role: "owner" },
  { m: "get", p: "/api/v1/billing/shopify/return", s: "Shopify's return URL after approval (query: store, charge_id). The charge's state is read from Shopify, then the browser goes to Settings.", auth: "none" },
  { m: "post", p: "/api/v1/billing/shopify/cancel", s: "Cancel the workspace's Shopify subscription (body: organizationId). The plan falls back to Free; nothing is deleted.", auth: "session", role: "owner" },

  { m: "post", p: "/api/v1/notifications/restock", s: "Public: request a back-in-stock alert. Always 202. Double opt-in by email.", auth: "none" },
  { m: "get", p: "/api/v1/notifications/confirm", s: "Public: confirm a back-in-stock subscription (single-use token)", auth: "none" },
  { m: "get", p: "/api/v1/notifications/unsubscribe", s: "Public: unsubscribe (signed token)", auth: "none" },
  { m: "post", p: "/api/v1/notifications/unsubscribe", s: "Public: RFC 8058 one-click unsubscribe", auth: "none" },
  { m: "post", p: "/api/v1/notifications/subscribe", s: "Public: request a marketing email subscription through a published email form (body: siteId, campaignId, email, optional firstName, consent=true). Always 202. Double opt-in; the consent text is the form's, read server-side.", auth: "none" },
  { m: "get", p: "/api/v1/notifications/subscribe/confirm", s: "Public: confirm a marketing email subscription (single-use token). Shows the form's incentive code, if it had one, only now.", auth: "none" },
  { m: "get", p: "/api/v1/notifications/subscribe/unsubscribe", s: "Public: unsubscribe from marketing email (signed token)", auth: "none" },
  { m: "post", p: "/api/v1/notifications/subscribe/unsubscribe", s: "Public: RFC 8058 one-click unsubscribe from marketing email", auth: "none" },
  { m: "post", p: "/api/v1/notifications/sms/subscribe", s: "Public: request an SMS subscription through a published SMS form (body: siteId, campaignId, phone in E.164, optional firstName, consent=true). Texts a one-time code. 202 whatever happens, except 422 phone_undeliverable for a number the provider will not text.", auth: "none" },
  { m: "post", p: "/api/v1/notifications/sms/confirm", s: "Public: confirm an SMS subscription with the texted code (body: siteId, campaignId, phone, code). 200 with the form's incentive, if any; 422 invalid_code otherwise.", auth: "none" },

  { m: "get", p: "/api/v1/recommendations", s: "Public: products for a live upsell campaign (query: siteId, campaignId, productId?, cart? comma-separated catalog ids, subtotal?). Options come from the live campaign, not the request. Only in-stock products are returned; every reason to show nothing returns the same empty list. Never cached.", auth: "none" },

  { m: "post", p: "/api/v1/webhooks/shopify", s: "Shopify webhooks (HMAC-verified, idempotent): app/uninstalled, app_subscriptions/update, products/*, inventory_levels/update, orders/create and the privacy topics (customers/data_request, customers/redact, shop/redact)", auth: "signature" },
  { m: "post", p: "/api/v1/webhooks/woocommerce/:storeId", s: "WooCommerce webhooks for one store (product.*, order.created, order.updated). Signed with that store secret (X-WC-Webhook-Signature); idempotent; unsigned delivery pings answer ok.", auth: "signature" },
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
