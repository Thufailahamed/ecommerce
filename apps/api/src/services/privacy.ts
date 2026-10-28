import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";

const s = schema;

/**
 * Hard-deletes everything held for a store. Used by shop/redact webhooks and account deletion.
 * Order matters only for tables without cascading foreign keys.
 */
export async function purgeStoreData(d: Deps, storeId: string) {
  const [store] = await d.db.select().from(s.stores).where(eq(s.stores.id, storeId)).limit(1);
  if (!store) return;
  await d.db.delete(s.analyticsAggregates).where(eq(s.analyticsAggregates.storeId, storeId));
  await d.db.delete(s.metricCounters).where(eq(s.metricCounters.storeId, storeId));
  await d.db.delete(s.experimentStats).where(eq(s.experimentStats.storeId, storeId));
  await d.db.delete(s.eventDedup).where(eq(s.eventDedup.storeId, storeId));
  await d.db.delete(s.attributionRecords).where(eq(s.attributionRecords.storeId, storeId));
  await d.db.delete(s.conversions).where(eq(s.conversions.storeId, storeId));
  await d.db.delete(s.consentRecords).where(eq(s.consentRecords.storeId, storeId));
  await d.db.delete(s.suppressionRecords).where(eq(s.suppressionRecords.storeId, storeId));
  await d.db.delete(s.aiGenerations).where(eq(s.aiGenerations.storeId, storeId));
  await d.db.delete(s.webhookEvents).where(eq(s.webhookEvents.storeId, storeId));
  await d.db.delete(s.auditLogs).where(eq(s.auditLogs.storeId, storeId));
  // cascades: campaigns -> versions, products -> variants, credentials
  await d.db.delete(s.campaigns).where(eq(s.campaigns.storeId, storeId));
  await d.db.delete(s.products).where(eq(s.products.storeId, storeId));
  await d.db.delete(s.integrationCredentials).where(eq(s.integrationCredentials.storeId, storeId));
  await d.db.delete(s.stores).where(eq(s.stores.id, storeId));
  await d.kv.put(`config:${store.siteKey}`, JSON.stringify({ schemaVersion: 1, siteId: store.siteKey, generatedAt: d.now().toISOString(), deliveryEnabled: false, campaigns: [] }), { expirationTtl: 3600 });
  await d.kv.put(`site:${store.siteKey}`, JSON.stringify({ id: "", active: false }), { expirationTtl: 3600 });
}

/**
 * Deletes the user. Organizations where they are the only member are deleted with all their stores.
 * Refuses if they co-own an organization with other members (ownership must be transferred first).
 */
export async function deleteAccount(d: Deps, userId: string) {
  const mine = await d.db.select().from(s.memberships).where(eq(s.memberships.userId, userId));
  const orgIds = mine.map((m) => m.organizationId);
  const sole: string[] = [];
  if (orgIds.length) {
    const all = await d.db.select().from(s.memberships).where(inArray(s.memberships.organizationId, orgIds));
    for (const org of orgIds) {
      const others = all.filter((m) => m.organizationId === org && m.userId !== userId);
      if (others.length === 0) sole.push(org);
      else if (mine.find((m) => m.organizationId === org)?.role === "owner" && !others.some((m) => m.role === "owner"))
        throw new HttpError(409, "transfer_ownership", "Transfer ownership of shared workspaces before deleting your account");
    }
  }
  for (const org of sole) {
    const stores = await d.db.select({ id: s.stores.id }).from(s.stores).where(eq(s.stores.organizationId, org));
    for (const st of stores) await purgeStoreData(d, st.id);
    await d.db.delete(s.usageRecords).where(eq(s.usageRecords.organizationId, org));
    await d.db.delete(s.subscriptions).where(eq(s.subscriptions.organizationId, org));
    await d.db.delete(s.organizations).where(eq(s.organizations.id, org));
  }
  await d.db.delete(s.sessions).where(eq(s.sessions.userId, userId));
  await d.db.delete(s.memberships).where(eq(s.memberships.userId, userId));
  await d.db.delete(s.users).where(eq(s.users.id, userId));
}

/** Records a request we cannot fulfil automatically so it is not silently dropped. */
export async function logPrivacyRequest(d: Deps, storeId: string | null, action: string, ref: string) {
  await d.db.insert(s.auditLogs).values({ id: newId("aud"), storeId, action, targetType: "privacy_request", targetId: ref, createdAt: d.now().toISOString() });
}

export async function storeByExternal(d: Deps, platform: "shopify", externalId: string) {
  const [st] = await d.db.select().from(s.stores).where(and(eq(s.stores.platform, platform), eq(s.stores.externalId, externalId))).limit(1);
  return st ?? null;
}
