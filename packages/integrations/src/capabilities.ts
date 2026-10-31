import type { NormalizedProduct } from "./index";
import type { ProviderAdapter } from "./providers";

/**
 * Capability-typed integration contracts. A provider implements only the interfaces for what it can actually do;
 * nothing implements a giant generic interface. Which providers implement which capability is listed in
 * `INTEGRATION_PROVIDERS` (@convertflow/contracts), and only built capabilities are listed there.
 */

export interface IntegrationContext { storeId: string; storeDomain: string }

export type ConnectionState = "not_connected" | "connected" | "error" | "not_applicable";

export interface IntegrationStatus {
  state: ConnectionState;
  /** True only after a check against the real service passed. */
  verified: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface IntegrationHealth { ok: boolean; checkedAt: string; detail: string }

/** Every adapter: what it is, whether it is connected, and (when it can) a live health check. */
export interface IntegrationAdapter {
  readonly provider: string;
  getConnectionStatus(ctx: IntegrationContext): Promise<IntegrationStatus>;
  /** Null when the provider has no safe, side-effect-free check. */
  healthCheck?(ctx: IntegrationContext): Promise<IntegrationHealth>;
}

/** Pulls the catalog a page at a time (WooCommerce and BigCommerce today). */
export interface CatalogSource {
  fetchProductsPage(page: number): Promise<{ products: NormalizedProduct[]; nextPage: number | null }>;
}

/** Copies consenting subscribers to a marketing list (Klaviyo and Mailchimp today). */
export type ListProvider = ProviderAdapter;

/* ---------- contracts for future modules: types only, nothing implements them yet ---------- */

/** A review platform the reviews module would read from. Not built. */
export interface ReviewSource {
  fetchReviewsSince(sinceIso: string, cursor?: string): Promise<{ reviews: { externalId: string; productExternalId: string; rating: number; createdAt: string }[]; cursor: string | null }>;
}

/** A loyalty provider the loyalty module would award points through. Not built. */
export interface LoyaltyProvider {
  awardPoints(customerRef: string, points: number, idempotencyKey: string): Promise<void>;
}

/** A returns or fulfilment provider the post-purchase module would read from. Not built. */
export interface FulfillmentSource {
  fulfillmentStatus(orderExternalId: string): Promise<{ status: "unfulfilled" | "partial" | "fulfilled" | "returned"; trackingUrl: string | null }>;
}
