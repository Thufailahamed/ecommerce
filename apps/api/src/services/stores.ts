import { and, eq, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { newId, randomToken } from "../lib/crypto.js";
import { getPlan } from "./entitlements.js";
import { HttpError, type Deps } from "../deps.js";
import type { SessionUser } from "./auth.js";
import { publishConfig } from "./campaigns.js";
import { putSite } from "./sites.js";
import { recordAudit } from "./audit.js";
import { authorizeOrganization } from "./authz.js";
import { publishDomainEvent } from "./domain-events.js";

const { stores, memberships } = schema;

/** Kept for existing callers; the entitlement service owns plans. */
export { getPlan };

export async function createStore(
  d: Deps, user: SessionUser,
  input: { organizationId: string; platform: "shopify" | "woocommerce" | "bigcommerce" | "magento" | "custom"; name: string; domain: string; currency: string },
) {
  await authorizeOrganization(d, { type: "user", userId: user.userId }, input.organizationId, "stores.create");

  const plan = await getPlan(d, input.organizationId);
  const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)` }).from(stores)
    .where(and(eq(stores.organizationId, input.organizationId), eq(stores.status, "active")));
  if (n >= plan.maxStores) throw new HttpError(402, "plan_limit", `Your plan allows ${plan.maxStores} connected store(s)`);

  const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new HttpError(400, "invalid_domain", "Enter a valid domain such as shop.example.com");

  const now = d.now().toISOString();
  const row = {
    id: newId("sto"), organizationId: input.organizationId, platform: input.platform, name: input.name, domain,
    // A Shopify store gets its shop identity only from a completed OAuth install (proof the merchant controls the shop):
    // webhooks are routed by it, so a typed-in domain must never claim another merchant's shop.
    externalId: input.platform === "custom" || input.platform === "shopify" ? null : domain, siteKey: `cf_${randomToken(12)}`,
    currency: input.currency.toUpperCase(), deliveryEnabled: true, status: "active" as const, createdAt: now, updatedAt: now,
  };
  await d.db.insert(stores).values(row);
  await publishConfig(d, row.id); // empty config, so the snippet works from the first load
  await recordAudit(d, { action: "store.created", actorId: user.userId, storeId: row.id, organizationId: row.organizationId, targetType: "store", targetId: row.id, summary: { platform: row.platform } });
  await publishDomainEvent(d, { type: "store.connected", payload: { storeId: row.id, platform: row.platform }, idempotencyKey: `store.connected:${row.id}`, storeId: row.id, organizationId: row.organizationId, source: "api" });
  return row;
}

export async function listStores(d: Deps, user: SessionUser) {
  return d.db.select({
    id: stores.id, name: stores.name, platform: stores.platform, domain: stores.domain, siteKey: stores.siteKey,
    currency: stores.currency, deliveryEnabled: stores.deliveryEnabled, organizationId: stores.organizationId,
  }).from(stores)
    .innerJoin(memberships, and(eq(memberships.organizationId, stores.organizationId), eq(memberships.userId, user.userId)))
    .where(eq(stores.status, "active"));
}

export async function setDelivery(d: Deps, user: SessionUser, storeId: string, enabled: boolean) {
  await d.db.update(stores).set({ deliveryEnabled: enabled, updatedAt: d.now().toISOString() }).where(eq(stores.id, storeId));
  await publishConfig(d, storeId);
  await recordAudit(d, { action: enabled ? "delivery.enabled" : "delivery.disabled", actorId: user.userId, storeId, targetType: "store", targetId: storeId });
}

/** Disconnect: stop serving immediately, drop credentials, mark inactive. Data deletion is a separate, explicit job. */
export async function disconnectStore(d: Deps, user: SessionUser, storeId: string) {
  const [s] = await d.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!s) return;
  await d.db.update(stores).set({ status: "disconnected", deliveryEnabled: false, updatedAt: d.now().toISOString() }).where(eq(stores.id, storeId));
  await d.db.delete(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, storeId));
  await d.kv.put(`config:${s.siteKey}`, JSON.stringify({ schemaVersion: 1, siteId: s.siteKey, generatedAt: d.now().toISOString(), deliveryEnabled: false, campaigns: [] }));
  await putSite(d, s.siteKey, { id: storeId, active: false });
  await recordAudit(d, { action: "store.disconnected", actorId: user.userId, storeId, organizationId: s.organizationId, targetType: "store", targetId: storeId, summary: { reason: "merchant" } });
  await publishDomainEvent(d, { type: "store.disconnected", payload: { storeId, reason: "merchant" }, idempotencyKey: `store.disconnected:${storeId}:${d.now().toISOString()}`, storeId, organizationId: s.organizationId, source: "api" });
}
