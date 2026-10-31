import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull();
const updatedAt = () => text("updated_at").notNull();

/* ---------- identity & tenancy ---------- */

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull(),
  /** PBKDF2 hash: "pbkdf2$iterations$salt$hash". Null for users created via a platform install. */
  passwordHash: text("password_hash"),
  name: text("name"),
  /** Null until the address is verified. Enforced for publishing/AI only when email delivery is configured. */
  emailVerifiedAt: text("email_verified_at"),
  /** TOTP secret, AES-GCM encrypted. */
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabled: integer("mfa_enabled", { mode: "boolean" }).notNull().default(false),
  /** SHA-256 hashes of unused single-use recovery codes. */
  recoveryHashes: text("recovery_hashes", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

/** Single-use, expiring tokens for password reset and email verification. Only the hash is stored. */
export const authTokens = sqliteTable("auth_tokens", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["password_reset", "email_verify"] }).notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: createdAt(),
}, (t) => [index("auth_tokens_user_idx").on(t.userId, t.type)]);

export const invitations = sqliteTable("invitations", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: text("invited_by").notNull(),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("invitations_token_uq").on(t.tokenHash), index("invitations_org_idx").on(t.organizationId)]);

export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const memberships = sqliteTable("memberships", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "admin", "editor", "viewer"] }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId)]);

export const sessions = sqliteTable("sessions", {
  /** SHA-256 of the session token; the raw token only lives in the cookie. */
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/** A connected storefront on any platform. */
export const stores = sqliteTable("stores", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  platform: text("platform", { enum: ["shopify", "woocommerce", "bigcommerce", "magento", "custom"] }).notNull(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  /** Platform-native identifier, e.g. myshopify domain. Null for custom sites. */
  externalId: text("external_id"),
  /** Public, non-secret identifier embedded in the storefront snippet. */
  siteKey: text("site_key").notNull(),
  currency: text("currency").notNull().default("USD"),
  deliveryEnabled: integer("delivery_enabled", { mode: "boolean" }).notNull().default(true),
  /** Margin guardrail. Null = promotions are not allowed on this store; a number caps any campaign's percentOff. */
  maxDiscountPercent: integer("max_discount_percent"),
  status: text("status", { enum: ["active", "disconnected"] }).notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("stores_site_key_uq").on(t.siteKey),
  uniqueIndex("stores_platform_external_uq").on(t.platform, t.externalId),
  index("stores_org_idx").on(t.organizationId),
]);

/** Secrets are kept apart from business tables. Values are encrypted with an env-bound key. */
export const integrationCredentials = sqliteTable("integration_credentials", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  expiresAt: text("expires_at"),
  scopes: text("scopes"),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("integration_credentials_store_uq").on(t.storeId)]);

/* ---------- catalog ---------- */

export const products = sqliteTable("products", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  handle: text("handle"),
  url: text("url"),
  status: text("status", { enum: ["active", "draft", "archived"] }).notNull().default("active"),
  imageUrl: text("image_url"),
  /** JSON array of collection external ids. */
  collectionIds: text("collection_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  syncedAt: text("synced_at").notNull(),
}, (t) => [
  uniqueIndex("products_store_external_uq").on(t.storeId, t.externalId),
  index("products_store_status_idx").on(t.storeId, t.status),
]);

export const productVariants = sqliteTable("product_variants", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  title: text("title"),
  price: real("price"),
  /** "unknown" is a first-class state: we never assume stock. */
  availability: text("availability", { enum: ["in_stock", "out_of_stock", "unknown"] }).notNull().default("unknown"),
  syncedAt: text("synced_at").notNull(),
}, (t) => [uniqueIndex("variants_store_external_uq").on(t.storeId, t.externalId), index("variants_product_idx").on(t.productId)]);

/**
 * Links a merchant sets between two products for the upsell tool: a complement is something that goes with it,
 * an alternative is something to buy instead (when it is unavailable). Only merchant-set links exist; nothing is inferred.
 * Both ends reference catalog rows, so removing a product removes its links.
 */
export const productRelationships = sqliteTable("product_relationships", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  relatedProductId: text("related_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["complement", "alternative"] }).notNull(),
  /** Higher is recommended first; ties break by the related product's catalog id so the result is stable. */
  weight: integer("weight").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("product_relationships_uq").on(t.storeId, t.productId, t.relatedProductId, t.kind),
  index("product_relationships_lookup_idx").on(t.storeId, t.productId, t.kind),
]);

export const webhookEvents = sqliteTable("webhook_events", {
  id: id(),
  storeId: text("store_id").references(() => stores.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  /** Delivery id supplied by the platform; the idempotency key. */
  deliveryId: text("delivery_id").notNull(),
  topic: text("topic").notNull(),
  status: text("status", { enum: ["received", "processed", "failed"] }).notNull().default("received"),
  receivedAt: text("received_at").notNull(),
}, (t) => [uniqueIndex("webhook_delivery_uq").on(t.platform, t.deliveryId)]);

/* ---------- campaigns ---------- */

export const campaigns = sqliteTable("campaigns", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "scheduled", "active", "paused", "archived"] }).notNull().default("draft"),
  /** Which tool renders this campaign. Derived from the config on every save; kept as a column so per-tool pages and counts need no JSON parsing. */
  tool: text("tool", { enum: ["toast", "feed", "upsell", "sms", "email"] }).notNull().default("toast"),
  /** Working copy being edited. Not served to storefronts. */
  draftConfig: text("draft_config", { mode: "json" }).$type<unknown>().notNull(),
  /** The published, served version. Null until first publish. */
  publishedVersionId: text("published_version_id"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("campaigns_store_status_idx").on(t.storeId, t.status), index("campaigns_store_tool_idx").on(t.storeId, t.tool, t.status)]);

/** Immutable. Rows are inserted, never updated. */
export const campaignVersions = sqliteTable("campaign_versions", {
  id: id(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  storeId: text("store_id").notNull(),
  version: integer("version").notNull(),
  config: text("config", { mode: "json" }).$type<unknown>().notNull(),
  publishedBy: text("published_by"),
  source: text("source", { enum: ["manual", "ai", "rollback"] }).notNull().default("manual"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("campaign_versions_uq").on(t.campaignId, t.version)]);

/* ---------- campaign groups and saved templates ---------- */

/** A merchant's own grouping of campaigns, e.g. "Black Friday". Groups never affect what storefronts serve. */
export const campaignGroups = sqliteTable("campaign_groups", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("campaign_groups_name_uq").on(t.storeId, t.name)]);

/** A campaign can sit in several groups. Deleting either side removes the link only. */
export const campaignGroupMembers = sqliteTable("campaign_group_members", {
  groupId: text("group_id").notNull().references(() => campaignGroups.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  storeId: text("store_id").notNull(),
  addedAt: text("added_at").notNull(),
}, (t) => [primaryKey({ columns: [t.groupId, t.campaignId] }), index("campaign_group_members_campaign_idx").on(t.campaignId)]);

/** A reusable draft saved from a campaign. Holds the config only: never versions, status or analytics. */
export const campaignTemplates = sqliteTable("campaign_templates", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: text("config", { mode: "json" }).$type<unknown>().notNull(),
  sourceCampaignId: text("source_campaign_id"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
}, (t) => [index("campaign_templates_store_idx").on(t.storeId)]);

/* ---------- analytics ---------- */

/** Short-retention dedup ledger; raw events are never stored in D1. */
export const eventDedup = sqliteTable("event_dedup", {
  storeId: text("store_id").notNull(),
  eventId: text("event_id").notNull(),
  seenAt: text("seen_at").notNull(),
}, (t) => [uniqueIndex("event_dedup_uq").on(t.storeId, t.eventId), index("event_dedup_seen_idx").on(t.seenAt)]);

export const analyticsAggregates = sqliteTable("analytics_aggregates", {
  storeId: text("store_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  versionId: text("version_id").notNull(),
  /** UTC day, YYYY-MM-DD. */
  day: text("day").notNull(),
  eligible: integer("eligible").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  dismissals: integer("dismissals").notNull().default(0),
  subscriptions: integer("subscriptions").notNull().default(0),
  /** Recommendation add-to-carts (upsell tool): a shopper added a recommended product without leaving the page. */
  addToCarts: integer("add_to_carts").notNull().default(0),
}, (t) => [uniqueIndex("aggregates_uq").on(t.storeId, t.campaignId, t.versionId, t.day)]);

/**
 * Tool-specific counters that have no column in `analytics_aggregates`, so a new metric needs no migration of that table.
 * `metric` is the event type that produced it (for example `form_submit_success`). Same grain, dedup and consent gate as the
 * aggregates; no personal data. Reads are always filtered by store.
 */
export const metricCounters = sqliteTable("metric_counters", {
  storeId: text("store_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  versionId: text("version_id").notNull(),
  /** UTC day, YYYY-MM-DD. */
  day: text("day").notNull(),
  metric: text("metric").notNull(),
  value: integer("value").notNull().default(0),
}, (t) => [
  uniqueIndex("metric_counters_uq").on(t.storeId, t.campaignId, t.versionId, t.day, t.metric),
  index("metric_counters_store_day_idx").on(t.storeId, t.day),
]);

/** Orders observed from platform webhooks or the SDK. Attribution is a separate, explicit step. */
export const conversions = sqliteTable("conversions", {
  id: id(),
  storeId: text("store_id").notNull(),
  orderId: text("order_id").notNull(),
  total: real("total").notNull(),
  currency: text("currency").notNull(),
  sessionId: text("session_id"),
  /** Experiment arm of the purchasing visitor, when known (client-reported). */
  expCampaignId: text("exp_campaign_id"),
  expGroup: text("exp_group", { enum: ["treatment", "holdout"] }),
  occurredAt: text("occurred_at").notNull(),
}, (t) => [uniqueIndex("conversions_order_uq").on(t.storeId, t.orderId)]);

/** Sessions randomised into each arm, per day. Orders per exposed session is the experiment's outcome metric. */
export const experimentStats = sqliteTable("experiment_stats", {
  storeId: text("store_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  versionId: text("version_id").notNull(),
  group: text("group", { enum: ["treatment", "holdout"] }).notNull(),
  day: text("day").notNull(),
  sessions: integer("sessions").notNull().default(0),
}, (t) => [uniqueIndex("experiment_stats_uq").on(t.storeId, t.campaignId, t.versionId, t.group, t.day)]);

/** Back-in-stock subscribers. Double opt-in: only "confirmed" rows are ever emailed. */
export const subscribers = sqliteTable("subscribers", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  productExternalId: text("product_external_id").notNull(),
  email: text("email").notNull(),
  status: text("status", { enum: ["pending", "confirmed", "notified", "unsubscribed"] }).notNull().default("pending"),
  /** SHA-256 of the one-time confirmation token. Unsubscribe uses a stateless signed token instead. */
  confirmHash: text("confirm_hash").notNull(),
  createdAt: createdAt(),
  confirmedAt: text("confirmed_at"),
  notifiedAt: text("notified_at"),
}, (t) => [
  uniqueIndex("subscribers_unique").on(t.storeId, t.productExternalId, t.email),
  uniqueIndex("subscribers_confirm_uq").on(t.confirmHash),
  index("subscribers_product_idx").on(t.storeId, t.productExternalId, t.status),
]);

export const attributionRecords = sqliteTable("attribution_records", {
  id: id(),
  storeId: text("store_id").notNull(),
  conversionId: text("conversion_id").notNull().references(() => conversions.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull(),
  versionId: text("version_id").notNull(),
  /** Named rule so the number is never mistaken for causal lift. */
  rule: text("rule", { enum: ["last_click_7d"] }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("attribution_conv_uq").on(t.conversionId, t.rule)]);

/* ---------- notifications & consent ---------- */

export const consentRecords = sqliteTable("consent_records", {
  id: id(),
  storeId: text("store_id").notNull(),
  subjectRef: text("subject_ref").notNull(),
  purpose: text("purpose", { enum: ["analytics", "marketing_email"] }).notNull(),
  granted: integer("granted", { mode: "boolean" }).notNull(),
  createdAt: createdAt(),
});

/**
 * Addresses and numbers that must never be contacted again, stored only as a hash so the entry outlives the contact.
 * `emailHash` holds the hash of whichever identifier the channel uses (the column name predates SMS).
 */
export const suppressionRecords = sqliteTable("suppression_records", {
  id: id(),
  storeId: text("store_id").notNull(),
  emailHash: text("email_hash").notNull(),
  channel: text("channel", { enum: ["email", "sms"] }).notNull().default("email"),
  reason: text("reason", { enum: ["unsubscribed", "bounced", "deletion_request"] }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("suppression_channel_uq").on(t.storeId, t.channel, t.emailHash)]);

export const CONSENT_STATUSES = ["none", "pending", "subscribed", "unsubscribed"] as const;

/**
 * One row per person per store, shared by every tool that collects or messages contacts. The statuses are a
 * denormalised view of `consent_events` (the source of truth) so lists and sends do not have to replay the log.
 * Restock subscribers are deliberately NOT contacts: asking for one stock alert is not marketing consent.
 */
export const contacts = sqliteTable("contacts", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  /** Lower-cased. Null for an SMS-only contact. */
  email: text("email"),
  /** E.164, e.g. +14155550123. Null for an email-only contact. */
  phone: text("phone"),
  /** Given by the shopper on a form that asks for it. Optional, never required to subscribe. */
  firstName: text("first_name"),
  emailStatus: text("email_status", { enum: CONSENT_STATUSES }).notNull().default("none"),
  smsStatus: text("sms_status", { enum: CONSENT_STATUSES }).notNull().default("none"),
  /** Where the contact first came from, e.g. "form:<campaignId>" or "import". */
  source: text("source").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  // NULLs are distinct in SQLite, so email-only and phone-only contacts never collide.
  uniqueIndex("contacts_store_email_uq").on(t.storeId, t.email),
  uniqueIndex("contacts_store_phone_uq").on(t.storeId, t.phone),
  index("contacts_store_created_idx").on(t.storeId, t.createdAt),
]);

/**
 * Append-only proof of consent. Rows are never updated: a later event supersedes an earlier one. They go when the
 * contact is erased (cascade); the hashed suppression entry is what remains after an opt-out.
 */
export const consentEvents = sqliteTable("consent_events", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: ["email", "sms"] }).notNull(),
  /** `delivery_failed`: the confirmation message for a `requested` event could not be sent, so that request does not start the cooldown. */
  event: text("event", { enum: ["requested", "confirmed", "revoked", "delivery_failed"] }).notNull(),
  source: text("source").notNull(),
  /** The published form version that collected the request, so what the shopper was promised (an incentive) is what is honoured. */
  versionId: text("version_id"),
  /** The exact words the shopper saw, on `requested` events. */
  consentText: text("consent_text"),
  consentTextHash: text("consent_text_hash"),
  privacyUrl: text("privacy_url"),
  /** SHA-256 of the one-time confirmation token, on `requested` events. */
  tokenHash: text("token_hash"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("consent_events_token_uq").on(t.tokenHash),
  index("consent_events_contact_idx").on(t.contactId, t.channel, t.createdAt),
]);

/* ---------- list providers (Klaviyo, Mailchimp, later an SMS provider) ---------- */

/** Platforms a merchant's confirmed subscribers can be synced to. A new one is an adapter plus an entry here. */
export const PROVIDERS = ["klaviyo", "mailchimp"] as const;
export type ProviderKey = (typeof PROVIDERS)[number];

/** One connection per provider per store. The key is encrypted at rest (AES-GCM, same path as platform credentials) and never returned by any route. */
export const providerConnections = sqliteTable("provider_connections", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: PROVIDERS }).notNull(),
  /** AES-GCM encrypted JSON: {"apiKey": "..."}. */
  encryptedCredentials: text("encrypted_credentials").notNull(),
  /** The list or audience confirmed subscribers are added to. Nothing syncs until one is chosen. */
  listId: text("list_id"),
  listName: text("list_name"),
  status: text("status", { enum: ["connected", "error"] }).notNull().default("connected"),
  /** Set only when a connection check succeeded against the provider's real API. A staging or test endpoint never sets it. */
  verifiedAt: text("verified_at"),
  lastCheckedAt: text("last_checked_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("provider_connections_store_provider_uq").on(t.storeId, t.provider)]);

export const SYNC_STATUSES = ["pending", "synced", "failed", "skipped_no_consent", "skipped_suppressed"] as const;

/**
 * The work of keeping one contact's subscription in step with one provider. There is one row per (contact, provider,
 * channel) holding the CURRENT wish (`action`): confirming consent sets it to subscribe, an opt-out to unsubscribe. A
 * subscribe job is only ever created from a confirmed subscription, and is re-checked against current consent and
 * suppression at the moment it runs. Rows go with the contact (erasure); the provider copy is removed first.
 */
export const providerSyncJobs = sqliteTable("provider_sync_jobs", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: PROVIDERS }).notNull(),
  channel: text("channel", { enum: ["email", "sms"] }).notNull(),
  action: text("action", { enum: ["subscribe", "unsubscribe"] }).notNull(),
  status: text("status", { enum: SYNC_STATUSES }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  /** When a pending job may next be tried (backoff, or the provider's Retry-After). */
  nextAttemptAt: text("next_attempt_at"),
  /** The provider's own id for the profile or member, when it gives one. */
  providerRef: text("provider_ref"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("provider_sync_jobs_uq").on(t.contactId, t.provider, t.channel),
  index("provider_sync_jobs_due_idx").on(t.status, t.nextAttemptAt),
  index("provider_sync_jobs_store_idx").on(t.storeId, t.status),
]);

/* ---------- billing & operations ---------- */

export const subscriptions = sqliteTable("subscriptions", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["free", "starter", "growth", "scale"] }).notNull().default("free"),
  status: text("status", { enum: ["active", "trialing", "past_due", "cancelled"] }).notNull().default("active"),
  /** Provider's id (Shopify subscription GID or other billing provider). Source of truth lives there. */
  providerRef: text("provider_ref"),
  /** Stripe customer id (billing portal), or the myshopify domain the Shopify charge belongs to. */
  customerRef: text("customer_ref"),
  currentPeriodEnd: text("current_period_end"),
  /** Who bills this workspace: "stripe" or "shopify". Null for a workspace that never paid. Webhooks from one provider never change the other's subscription. */
  provider: text("provider", { enum: ["stripe", "shopify"] }),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("subscriptions_org_uq").on(t.organizationId)]);

/**
 * One row per Shopify shop that has authorised the app. The offline token lives here only while the install is waiting to
 * be claimed by a workspace (an install that started in Shopify, not in our dashboard); once linked it moves to the
 * store's `integration_credentials` and is cleared here. Uninstalling keeps the row (with status) for reinstalls and audits.
 */
export const shopifyInstallations = sqliteTable("shopify_installations", {
  id: id(),
  /** The permanent myshopify.com domain, lower-cased. */
  shop: text("shop").notNull(),
  storeId: text("store_id").references(() => stores.id, { onDelete: "set null" }),
  status: text("status", { enum: ["pending", "installed", "uninstalled"] }).notNull(),
  /** Granted scopes, comma-separated, exactly as Shopify returned them. */
  scopes: text("scopes").notNull(),
  /** AES-GCM; only set while status is "pending". */
  encryptedPendingToken: text("encrypted_pending_token"),
  /** SHA-256 of the one-time token that lets a signed-in merchant attach a pending install to a workspace. */
  claimTokenHash: text("claim_token_hash"),
  claimExpiresAt: text("claim_expires_at"),
  installedAt: text("installed_at").notNull(),
  uninstalledAt: text("uninstalled_at"),
  /** The app's web pixel at Shopify (gid), once `webPixelCreate` succeeded. Purchases are reported only while it exists. */
  webPixelId: text("web_pixel_id"),
  /** When the site key and origins were written to the app-data metafields the theme app embed reads. */
  appMetafieldsSetAt: text("app_metafields_set_at"),
  /** Why the last storefront setup (pixel, metafields) did not finish; null when it did. No Shopify text, only our codes. */
  setupError: text("setup_error"),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("shopify_installations_shop_uq").on(t.shop),
  uniqueIndex("shopify_installations_claim_uq").on(t.claimTokenHash),
  index("shopify_installations_store_idx").on(t.storeId),
]);

/**
 * A WooCommerce store's live connection (REST API keys live encrypted in `integration_credentials`). One per store.
 * Webhooks are created at the store by the API with a per-store secret, which signs every delivery.
 */
export const woocommerceConnections = sqliteTable("woocommerce_connections", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  /** "authorize": WooCommerce's /wc-auth/v1/authorize approval; "manual": keys pasted by the merchant. */
  method: text("method", { enum: ["authorize", "manual"] }).notNull(),
  /** What the key may do, as WooCommerce reported it ("read", "write", "read_write"), or null when unknown (manual keys). */
  keyPermissions: text("key_permissions"),
  /** AES-GCM; the secret WooCommerce signs webhook deliveries with (X-WC-Webhook-Signature). */
  encryptedWebhookSecret: text("encrypted_webhook_secret").notNull(),
  /** Ids of the webhooks this app created at the store, so they can be checked, repaired and deleted. */
  webhookIds: text("webhook_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
  webhookState: text("webhook_state", { enum: ["pending", "active", "failed", "read_only"] }).notNull().default("pending"),
  /** One of our own error codes; never text from the store. */
  webhookError: text("webhook_error"),
  /** Verified against the store's REST API: the keys work and the site is WooCommerce. Null until then. */
  verifiedAt: text("verified_at"),
  lastWebhookAt: text("last_webhook_at"),
  connectedAt: text("connected_at").notNull(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("woocommerce_connections_store_uq").on(t.storeId)]);

export const usageRecords = sqliteTable("usage_records", {
  organizationId: text("organization_id").notNull(),
  /** USAGE_METRICS in @convertflow/contracts. */
  metric: text("metric", { enum: ["pageviews", "ai_generations", "notifications", "workflow_executions", "builder_messages", "ai_images", "sms_verifications"] }).notNull(),
  /** YYYY-MM */
  period: text("period").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [uniqueIndex("usage_uq").on(t.organizationId, t.metric, t.period)]);

/**
 * Preview capabilities switched on for one workspace (`CAPABILITIES` with availability "preview"). Presence is the flag.
 * Set by staff, never by a merchant request; a planned capability is never granted whatever is stored here.
 */
export const organizationFeatures = sqliteTable("organization_features", {
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  feature: text("feature").notNull(),
  enabledBy: text("enabled_by"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.feature] })]);

export const aiGenerations = sqliteTable("ai_generations", {
  id: id(),
  storeId: text("store_id").notNull(),
  requestedBy: text("requested_by"),
  prompt: text("prompt").notNull(),
  status: text("status", { enum: ["succeeded", "rejected", "failed"] }).notNull(),
  /** AI_TASKS key in @convertflow/ai. Rows from before the task registry are campaign generations. */
  task: text("task").notNull().default("campaign.generate"),
  organizationId: text("organization_id"),
  provider: text("provider"),
  model: text("model"),
  durationMs: integer("duration_ms"),
  /** Null when no rate is configured for the model: a cost is never guessed. */
  estimatedCostUsd: real("estimated_cost_usd"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [index("ai_gen_store_idx").on(t.storeId, t.createdAt)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: id(),
  storeId: text("store_id"),
  organizationId: text("organization_id"),
  actorId: text("actor_id"),
  /** `user` (a signed-in member), `platform` (a verified webhook) or `system` (scheduled or internal work). */
  actorType: text("actor_type", { enum: ["user", "platform", "system"] }).notNull().default("user"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  /** The request that caused it, so an audit row can be matched to logs and platform events. */
  correlationId: text("correlation_id"),
  /** Small, non-personal facts about the change (a new role, a discount ceiling). Never addresses, names or secrets. */
  summary: text("summary", { mode: "json" }).$type<Record<string, string | number | boolean | null>>(),
  createdAt: createdAt(),
}, (t) => [index("audit_store_idx").on(t.storeId, t.createdAt), index("audit_org_idx").on(t.organizationId, t.createdAt)]);

/* ---------- platform events ---------- */

/**
 * Internal platform events (contract: `@convertflow/contracts` DOMAIN_EVENTS), stored before they are delivered so a
 * lost queue message, a failed subscriber or a replay never loses or doubles one. Short retention; see
 * docs/event-catalog.md. Storefront analytics beacons never come here.
 */
export const domainEvents = sqliteTable("domain_events", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** Null for workspace-level events. Not a foreign key: store purge deletes these explicitly. */
  storeId: text("store_id"),
  type: text("type").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  source: text("source", { enum: ["api", "shopify_webhook", "woocommerce_webhook", "storefront", "scheduler", "system"] }).notNull(),
  correlationId: text("correlation_id"),
  /** Unique per workspace: the same outcome published twice is recorded once. */
  idempotencyKey: text("idempotency_key").notNull(),
  privacy: text("privacy", { enum: ["none", "pseudonymous"] }).notNull(),
  payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
  occurredAt: text("occurred_at").notNull(),
  recordedAt: text("recorded_at").notNull(),
  /** `delivered` once every subscriber has succeeded; `failed` while at least one has not. */
  status: text("status", { enum: ["pending", "delivered", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  deliveredAt: text("delivered_at"),
}, (t) => [
  uniqueIndex("domain_events_idem_uq").on(t.organizationId, t.idempotencyKey),
  index("domain_events_store_idx").on(t.storeId, t.recordedAt),
  index("domain_events_status_idx").on(t.status, t.recordedAt),
]);

/** One row per (event, subscriber) that has run, so a redelivered event only runs the subscribers that have not succeeded. */
export const domainEventDeliveries = sqliteTable("domain_event_deliveries", {
  eventId: text("event_id").notNull().references(() => domainEvents.id, { onDelete: "cascade" }),
  subscriber: text("subscriber").notNull(),
  status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.eventId, t.subscriber] })]);

/* ---------- automation: actions, approvals, workflows ---------- */

/**
 * The approval queue shared by workflows and the AI Commerce Manager. A request names one registered action
 * (`ACTIONS` in @convertflow/contracts) with validated input; it runs only after a member with the action's permission
 * approves it, and then on that member's authority. Inputs are bounded by the action schemas; rationale is plain text.
 */
export const actionRequests = sqliteTable("action_requests", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  action: text("action").notNull(),
  input: text("input", { mode: "json" }).$type<unknown>().notNull(),
  origin: text("origin", { enum: ["workflow", "ai"] }).notNull(),
  status: text("status", { enum: ["pending", "rejected", "executed", "failed", "expired"] }).notNull().default("pending"),
  /** Why it is proposed (AI explanation, or the workflow's own summary). Plain text, never rendered as HTML. */
  rationale: text("rationale"),
  /** The figures the proposal relied on (metric ids, values, periods) so the merchant can check them. */
  evidence: text("evidence", { mode: "json" }).$type<unknown>(),
  requestedBy: text("requested_by"),
  workflowRunId: text("workflow_run_id"),
  /** Groups the proposals made for one merchant objective (AI Commerce Manager). */
  planId: text("plan_id"),
  decidedBy: text("decided_by"),
  decidedAt: text("decided_at"),
  result: text("result", { mode: "json" }).$type<unknown>(),
  error: text("error"),
  expiresAt: text("expires_at").notNull(),
  createdAt: createdAt(),
}, (t) => [index("action_requests_store_status_idx").on(t.storeId, t.status, t.createdAt), index("action_requests_plan_idx").on(t.planId)]);

export const workflows = sqliteTable("workflows", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "active", "paused", "archived"] }).notNull().default("draft"),
  /** Working copy. Never executed. */
  draftDefinition: text("draft_definition", { mode: "json" }).$type<unknown>().notNull(),
  activeVersionId: text("active_version_id"),
  /** Runs act on this member's authority, re-checked on every run. */
  activatedBy: text("activated_by"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("workflows_store_status_idx").on(t.storeId, t.status)]);

/** Immutable. A definition is executed only from a version. */
export const workflowVersions = sqliteTable("workflow_versions", {
  id: id(),
  workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  storeId: text("store_id").notNull(),
  version: integer("version").notNull(),
  definition: text("definition", { mode: "json" }).$type<unknown>().notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("workflow_versions_uq").on(t.workflowId, t.version)]);

/** One per (version, trigger). The unique key is what makes a redelivered trigger a no-op. */
export const workflowRuns = sqliteTable("workflow_runs", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  /** The triggering platform event id, or "day:YYYY-MM-DD" for a scheduled run. */
  triggerKey: text("trigger_key").notNull(),
  status: text("status", { enum: ["scheduled", "running", "succeeded", "skipped", "failed", "cancelled"] }).notNull().default("scheduled"),
  runAt: text("run_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  /** What each condition and action did, in order. Ids and outcomes only. */
  steps: text("steps", { mode: "json" }).$type<unknown[]>().notNull().default([]),
  error: text("error"),
  createdAt: createdAt(),
  finishedAt: text("finished_at"),
}, (t) => [
  uniqueIndex("workflow_runs_trigger_uq").on(t.versionId, t.triggerKey),
  index("workflow_runs_due_idx").on(t.status, t.runAt),
  index("workflow_runs_workflow_idx").on(t.workflowId, t.createdAt),
]);

/* ---------- AI store builder ---------- */

/**
 * A store built with the AI builder. The draft document is the working copy the editor and the AI change; shoppers only
 * ever see a published version. The document format is `SiteDocument` in @convertflow/store-builder.
 */
export const sites = sqliteTable("sites", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Public address: /s/<slug>. Unique across the platform. */
  slug: text("slug").notNull(),
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
  draft: text("draft", { mode: "json" }).$type<unknown>().notNull(),
  /** Increments on every draft write; writers send the revision they edited (optimistic concurrency). */
  revision: integer("revision").notNull().default(1),
  publishedVersionId: text("published_version_id"),
  publishedAt: text("published_at"),
  /** The first prompt, kept for the store card and for "build again". */
  prompt: text("prompt"),
  /** The brand brief from the first build (summary, voice, image art direction), reused so later edits stay on-brand. */
  brief: text("brief", { mode: "json" }).$type<Record<string, unknown>>(),
  /** A chat turn holds this until it finishes, so two turns never write the same draft at once. */
  busyUntil: text("busy_until"),
  /** The merchant's own Stripe secret key, AES-GCM encrypted. Null: orders are taken without online payment. */
  stripeSecretEnc: text("stripe_secret_enc"),
  /** Where order and contact-form notifications go. */
  notifyEmail: text("notify_email"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("sites_slug_uq").on(t.slug), index("sites_org_idx").on(t.organizationId, t.status)]);

/** Immutable snapshots: every AI turn, checkpoint, restore and publish. Restoring copies a snapshot into the draft. */
export const siteVersions = sqliteTable("site_versions", {
  id: id(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  kind: text("kind", { enum: ["ai", "manual", "restore", "publish", "initial"] }).notNull(),
  label: text("label").notNull(),
  document: text("document", { mode: "json" }).$type<unknown>().notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("site_versions_uq").on(t.siteId, t.number)]);

/** The builder conversation. Content is plain text; `meta` holds the changes, steps and suggestions shown with it. */
export const siteMessages = sqliteTable("site_messages", {
  id: id(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  versionId: text("version_id"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
}, (t) => [index("site_messages_site_idx").on(t.siteId, t.createdAt)]);

/** Uploaded or generated images. Bytes live in KV under `asset:<id>`; this row is the index and the owner check. */
export const siteAssets = sqliteTable("site_assets", {
  id: id(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["upload", "ai"] }).notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  alt: text("alt"),
  prompt: text("prompt"),
  createdAt: createdAt(),
}, (t) => [index("site_assets_site_idx").on(t.siteId, t.createdAt)]);

/**
 * An order placed on a published store. Lines and totals are priced on the server from the published document, never
 * from the browser. Customer details are personal data: erased with the site, and never shown to the AI.
 */
export const siteOrders = sqliteTable("site_orders", {
  id: id(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  status: text("status", { enum: ["pending_payment", "paid", "unpaid", "fulfilled", "cancelled"] }).notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  address: text("address", { mode: "json" }).$type<Record<string, string>>().notNull(),
  lines: text("lines", { mode: "json" }).$type<unknown[]>().notNull(),
  currency: text("currency").notNull(),
  subtotal: real("subtotal").notNull(),
  shipping: real("shipping").notNull(),
  total: real("total").notNull(),
  note: text("note"),
  /** Stripe Checkout session id when paid online. */
  paymentRef: text("payment_ref"),
  /** SHA-256 of the token in the shopper's confirmation link: only that link can read the order back. */
  accessHash: text("access_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("site_orders_number_uq").on(t.siteId, t.number), index("site_orders_site_idx").on(t.siteId, t.createdAt)]);

/** Newsletter sign-ups and contact messages from a published store. */
export const siteSubmissions = sqliteTable("site_submissions", {
  id: id(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["newsletter", "contact"] }).notNull(),
  email: text("email").notNull(),
  name: text("name"),
  message: text("message"),
  createdAt: createdAt(),
}, (t) => [index("site_submissions_site_idx").on(t.siteId, t.kind, t.createdAt), index("site_submissions_email_idx").on(t.siteId, t.kind, t.email)]);
