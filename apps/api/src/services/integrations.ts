import { and, desc, eq, max } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { INTEGRATION_PROVIDERS, type IntegrationProvider, type IntegrationProviderKey } from "@convertflow/contracts";
import { type IntegrationAdapter, type IntegrationContext, type IntegrationHealth, type IntegrationStatus } from "@convertflow/integrations";
import { HttpError, type Deps } from "../deps.js";
import { connectionStatus } from "./sync.js";
import { checkProvider, listProviders } from "./providers.js";
import { installationStatus, shopifyHealth } from "./shopify-app.js";
import { connectionView, wooHealth } from "./woocommerce.js";

/**
 * The integration registry at run time: static metadata from `INTEGRATION_PROVIDERS` plus live state read from the
 * tables each integration already owns (webhook log, catalog credentials, provider connections). There is no separate
 * "integrations" table on purpose: a second copy of connection state would drift from the one the code acts on.
 */

type Store = typeof schema.stores.$inferSelect;

const lastProductSync = async (d: Deps, storeId: string) =>
  (await d.db.select({ at: max(schema.products.syncedAt) }).from(schema.products).where(eq(schema.products.storeId, storeId)))[0]?.at ?? null;

/**
 * Shopify: connected while the app is installed with a stored token. The latest webhook outcome is the passive signal;
 * the health check is a live, read-only Admin API call with the stored token.
 */
const shopifyAdapter = (d: Deps, store: Store): IntegrationAdapter => ({
  provider: "shopify",
  async getConnectionStatus(ctx) {
    const w = schema.webhookEvents;
    const [ok] = await d.db.select({ at: w.receivedAt }).from(w).where(and(eq(w.storeId, ctx.storeId), eq(w.status, "processed"))).orderBy(desc(w.receivedAt)).limit(1);
    const [bad] = await d.db.select({ at: w.receivedAt, topic: w.topic }).from(w).where(and(eq(w.storeId, ctx.storeId), eq(w.status, "failed"))).orderBy(desc(w.receivedAt)).limit(1);
    const failedLast = bad && (!ok || bad.at > ok.at);
    const install = await installationStatus(d, store);
    const lastSuccessAt = [ok?.at, await lastProductSync(d, ctx.storeId)].filter((x): x is string => !!x).sort().at(-1) ?? null;
    return {
      state: store.status !== "active" || !install.connected ? "not_connected" : failedLast ? "error" : "connected", verified: false,
      lastSuccessAt, lastError: failedLast ? `A ${bad.topic} webhook failed to process` : install.missingScopes.length ? `Missing scopes: ${install.missingScopes.join(", ")}` : null,
    };
  },
  async healthCheck(): Promise<IntegrationHealth> {
    const r = await shopifyHealth(d, store);
    return { ok: r.ok, checkedAt: d.now().toISOString(), detail: r.detail };
  },
});

/** Twilio Verify: one platform-wide service the operator configures; merchants cannot connect or change it. */
const phoneVerificationAdapter = (d: Deps): IntegrationAdapter => ({
  provider: "twilio",
  async getConnectionStatus() {
    return { state: d.phoneVerifier ? "connected" : "not_connected", verified: false, lastSuccessAt: null, lastError: d.phoneVerifier ? null : "SMS signup is not configured on this deployment" };
  },
});

/**
 * WooCommerce: connected while keys are stored; an error when the store disabled or refused the app's webhooks. Last success
 * is the newest of a synced product and a received webhook. The health check is a live, read-only REST call.
 */
const wooAdapter = (d: Deps, store: Store): IntegrationAdapter => ({
  provider: "woocommerce",
  async getConnectionStatus(ctx) {
    const v = await connectionView(d, store);
    const lastSuccessAt = [v.webhooks.lastReceivedAt, await lastProductSync(d, ctx.storeId)].filter((x): x is string => !!x).sort().at(-1) ?? null;
    if (!v.connected) return { state: "not_connected", verified: false, lastSuccessAt, lastError: null };
    const lastError = v.webhooks.state === "failed" ? "The store refused the app's webhooks. Use Repair in Settings."
      : v.webhooks.state === "read_only" ? "The keys are read-only, so product and order webhooks are off" : null;
    return { state: v.webhooks.state === "failed" ? "error" : "connected", verified: false, lastSuccessAt, lastError };
  },
  async healthCheck(): Promise<IntegrationHealth> {
    const r = await wooHealth(d, store);
    return { ok: r.ok, checkedAt: d.now().toISOString(), detail: r.detail };
  },
});

/** BigCommerce: connected when credentials are stored; last success is the newest synced product. */
const catalogConnectorAdapter = (d: Deps, provider: string): IntegrationAdapter => ({
  provider,
  async getConnectionStatus(ctx) {
    const c = await connectionStatus(d, ctx.storeId);
    return { state: c.connected ? "connected" : "not_connected", verified: false, lastSuccessAt: await lastProductSync(d, ctx.storeId), lastError: null };
  },
});

/** Manual-import stores: nothing to connect. */
const manualAdapter = (d: Deps, provider: string): IntegrationAdapter => ({
  provider,
  async getConnectionStatus(ctx) {
    return { state: "not_applicable", verified: false, lastSuccessAt: await lastProductSync(d, ctx.storeId), lastError: null };
  },
});

/** Klaviyo / Mailchimp: state from the stored connection; the health check is the provider's real connection check. */
const { PROVIDERS } = schema;
const listProviderAdapter = (d: Deps, provider: (typeof PROVIDERS)[number]): IntegrationAdapter => ({
  provider,
  async getConnectionStatus(ctx) {
    const v = (await listProviders(d, ctx.storeId)).find((p) => p.provider === provider);
    if (!v?.connected) return { state: "not_connected", verified: false, lastSuccessAt: null, lastError: null };
    return { state: v.status === "error" ? "error" : "connected", verified: v.verified, lastSuccessAt: v.status === "error" ? null : v.lastCheckedAt, lastError: v.lastError };
  },
  async healthCheck(ctx): Promise<IntegrationHealth> {
    const checkedAt = d.now().toISOString();
    try { await checkProvider(d, ctx.storeId, provider); return { ok: true, checkedAt, detail: "The provider accepted the stored key" }; }
    catch (e) { return { ok: false, checkedAt, detail: e instanceof HttpError ? e.message : "The check failed" }; }
  },
});

/** The adapters that apply to this store: its own commerce platform, plus every list provider. */
export function adaptersFor(d: Deps, store: Store): IntegrationAdapter[] {
  const platform = store.platform === "shopify" ? shopifyAdapter(d, store)
    : store.platform === "woocommerce" ? wooAdapter(d, store)
    : store.platform === "bigcommerce" ? catalogConnectorAdapter(d, store.platform)
    : manualAdapter(d, store.platform);
  return [platform, ...PROVIDERS.map((p) => listProviderAdapter(d, p)), phoneVerificationAdapter(d)];
}

export interface IntegrationView extends IntegrationProvider { status: IntegrationStatus; healthCheckAvailable: boolean }

export async function listIntegrations(d: Deps, store: Store): Promise<IntegrationView[]> {
  const ctx: IntegrationContext = { storeId: store.id, storeDomain: store.domain };
  return Promise.all(adaptersFor(d, store).map(async (a) => ({
    ...INTEGRATION_PROVIDERS[a.provider as IntegrationProviderKey],
    status: await a.getConnectionStatus(ctx),
    healthCheckAvailable: Boolean(a.healthCheck),
  })));
}

export async function checkIntegrationHealth(d: Deps, store: Store, provider: string): Promise<IntegrationHealth> {
  const a = adaptersFor(d, store).find((x) => x.provider === provider);
  if (!a) throw new HttpError(404, "not_found", "That integration does not apply to this store");
  if (!a.healthCheck) throw new HttpError(409, "health_check_unavailable", "This integration has no live check");
  return a.healthCheck({ storeId: store.id, storeDomain: store.domain });
}
