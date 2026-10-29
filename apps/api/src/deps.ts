import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { schema } from "@convertflow/database";
import type { CampaignAIProvider } from "@convertflow/ai";
import type { ProviderAdapter, ProviderKey } from "@convertflow/integrations";

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
  shopifyApiSecret?: string;
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
  /** Set when Workers AI calls are routed through Cloudflare AI Gateway. */
  aiGatewayId?: string;
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
}

export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 | 504, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}
