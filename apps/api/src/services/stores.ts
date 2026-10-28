import { and, eq, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { newId, randomToken } from "../lib/crypto.js";
import { effectivePlan } from "../plans.js";
import { HttpError, type Deps } from "../deps.js";
import type { SessionUser } from "./auth.js";
import { publishConfig } from "./campaigns.js";
import { putSite } from "./sites.js";

const { stores, memberships, subscriptions } = schema;

export async function getPlan(d: Deps, organizationId: string) {
  const [s] = await d.db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  return effectivePlan(s?.plan ?? "free", s?.status ?? "active");
}

export async function createStore(
  d: Deps, user: SessionUser,
  input: { organizationId: string; platform: "shopify" | "woocommerce" | "bigcommerce" | "magento" | "custom"; name: string; domain: string; currency: string },
) {
  const [m] = await d.db.select().from(memberships)
    .where(and(eq(memberships.organizationId, input.organizationId), eq(memberships.userId, user.userId))).limit(1);
  if (!m || (m.role !== "owner" && m.role !== "admin")) throw new HttpError(404, "not_found", "Organization not found");

  const plan = await getPlan(d, input.organizationId);
  const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)` }).from(stores)
    .where(and(eq(stores.organizationId, input.organizationId), eq(stores.status, "active")));
  if (n >= plan.maxStores) throw new HttpError(402, "plan_limit", `Your plan allows ${plan.maxStores} connected store(s)`);

  const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new HttpError(400, "invalid_domain", "Enter a valid domain such as shop.example.com");

  const now = d.now().toISOString();
  const row = {
    id: newId("sto"), organizationId: input.organizationId, platform: input.platform, name: input.name, domain,
    externalId: input.platform === "custom" ? null : domain, siteKey: `cf_${randomToken(12)}`,
    currency: input.currency.toUpperCase(), deliveryEnabled: true, status: "active" as const, createdAt: now, updatedAt: now,
  };
  await d.db.insert(stores).values(row);
  await publishConfig(d, row.id); // empty config, so the snippet works from the first load
  await d.db.insert(schema.auditLogs).values({ id: newId("aud"), storeId: row.id, organizationId: row.organizationId, actorId: user.userId, action: "store.created", targetType: "store", targetId: row.id, createdAt: now });
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
  await d.db.insert(schema.auditLogs).values({ id: newId("aud"), storeId, actorId: user.userId, action: enabled ? "delivery.enabled" : "delivery.disabled", targetType: "store", targetId: storeId, createdAt: d.now().toISOString() });
}

/** Disconnect: stop serving immediately, drop credentials, mark inactive. Data deletion is a separate, explicit job. */
export async function disconnectStore(d: Deps, user: SessionUser, storeId: string) {
  const [s] = await d.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!s) return;
  await d.db.update(stores).set({ status: "disconnected", deliveryEnabled: false, updatedAt: d.now().toISOString() }).where(eq(stores.id, storeId));
  await d.db.delete(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, storeId));
  await d.kv.put(`config:${s.siteKey}`, JSON.stringify({ schemaVersion: 1, siteId: s.siteKey, generatedAt: d.now().toISOString(), deliveryEnabled: false, campaigns: [] }));
  await putSite(d, s.siteKey, { id: storeId, active: false });
  await d.db.insert(schema.auditLogs).values({ id: newId("aud"), storeId, actorId: user.userId, action: "store.disconnected", targetType: "store", targetId: storeId, createdAt: d.now().toISOString() });
}
