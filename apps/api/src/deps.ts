import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { schema } from "@convertflow/database";
import type { CampaignAIProvider, ChatModel, ImageModel, TextAIProvider } from "@convertflow/ai";
import type { PhoneVerifier, ProviderAdapter, ProviderKey } from "@convertflow/integrations";
import type { DomainEventMessage, Subscriber } from "./services/domain-events.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = BaseSQLiteDatabase<"async", any, typeof schema>;

export interface KeyValue {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/** Secrets and provider settings. Every field is optional: a missing one disables that feature rather than failing open. */
export interface Secrets {
  /** base64, 32 bytes. Encrypts stored platform credentials (AES-GCM). */
  credentialKey?: string;
  /** Shopify app client id (public) and secret. Both are needed for installs; the secret alone verifies webhooks. */
  shopifyApiKey?: string;
  shopifyApiSecret?: string;
  /** Scopes requested on install (default read_products,read_inventory). */
  shopifyScopes?: string[];
  /** Admin API version, e.g. "2026-10". */
  shopifyApiVersion?: string;
  /** Replaces https://{shop} for Admin API and token calls (a local mock in tests). Contains the literal "{shop}". */
  shopifyAdminBaseUrl?: string;
  /** Replaces https://{domain} for WooCommerce REST calls (a local mock in tests). Contains the literal "{domain}". */
  wooBaseUrl?: string;
  /** Public origin the storefront script (cf.js) is served from. Written to the Shopify theme embed settings; absent: the embed default. */
  sdkOrigin?: string;
  /** Shopify Billing charges are created as test charges (development stores, review). */
  shopifyBillingTest?: boolean;
  /** Free trial days on new Shopify subscriptions. Default 0. */
  shopifyTrialDays?: number;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePrices?: Partial<Record<"starter" | "growth" | "scale", string>>;
  turnstileSecret?: string;
  /** Public origin of the merchant web app (Stripe return URLs, links in emails). */
  webOrigin?: string;
  /** Public origin of this API (confirm/unsubscribe links in emails sent to shoppers). */
  apiOrigin?: string;
  resendApiKey?: string;
  emailFrom?: string;
  /** Replaces a list provider's API origin (staging, or a local mock for end-to-end runs). A connection through one is never "verified". */
  providerBaseUrls?: Partial<Record<ProviderKey, string>>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

/** Transactional email behind an interface so the provider can be swapped without touching business logic. */
export interface EmailProvider {
  send(m: EmailMessage): Promise<void>;
}

export interface Deps {
  db: Db;
  kv: KeyValue;
  ai?: CampaignAIProvider;
  /** Generic model access for AI tasks other than campaign generation (services/ai-tasks.ts). */
  aiText?: TextAIProvider;
  /** Recorded with every AI call. */
  aiProviderName?: string;
  /** USD per million tokens by model id, from AI_COST_RATES. A model without a rate gets no cost estimate. */
  aiCostRates?: Record<string, { inputPerMTok: number; outputPerMTok: number }>;
  /** Set when Workers AI calls are routed through Cloudflare AI Gateway. */
  aiGatewayId?: string;
  /** The AI store builder's chat model (AI Gateway). Absent: the builder's AI is unavailable and says so. */
  builderChat?: ChatModel;
  /** Image generation for built stores. Absent: images stay as placeholders the merchant can upload over. */
  builderImages?: ImageModel;
  now: () => Date;
  secrets?: Secrets;
  /** Absent when no provider is configured: email-dependent features then fail closed or degrade explicitly. */
  email?: EmailProvider;
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Queue producer when running as a Worker; absent in tests where events are processed inline. */
  enqueueEvents?: (msg: unknown, opts?: { delaySeconds?: number }) => Promise<void>;
  /** Tests inject adapters (a recording fake). In production adapters are built from the connection's stored key. */
  providers?: Partial<Record<ProviderKey, ProviderAdapter>>;
  /** Texts one-time codes that confirm an SMS signup (Twilio Verify). Absent: SMS signup forms cannot be published and collect nothing. */
  phoneVerifier?: PhoneVerifier;
  /**
   * Queue producer for platform events. Its own seam (production points it at the same queue binding) so platform
   * events can move to a dedicated queue without touching analytics or sync. Absent: events are delivered inline.
   */
  enqueueDomainEvent?: (msg: DomainEventMessage) => Promise<void>;
  /**
   * Overrides the request id as the correlation id for audit rows and platform events. Set on a copy of Deps when an
   * automation acts ("wfrun:<id>", "aireq:<id>"), which is also how workflows avoid triggering themselves.
   */
  correlationId?: string;
  /** Who reacts to platform events. Set by the composition root (`index.ts`, the test harness) from `SUBSCRIBERS`. */
  subscribers?: readonly Subscriber[];
}

export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}
