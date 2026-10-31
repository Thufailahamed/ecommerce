import { and, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { HttpError, type Deps } from "../deps.js";
import { recordAudit } from "./audit.js";
import { announceCatalogChange } from "./catalog.js";
import { notifyRestock } from "./restock.js";
import { reconcileShopifyCharge } from "./shopify-billing.js";
import { syncShopifyPage } from "./shopify-app.js";
import { syncCatalogPage } from "./sync.js";

/**
 * Daily reconciliation of data that webhooks keep current but can miss: a lost or failed webhook must not leave a
 * product on sale that the platform deleted, or a plan active that Shopify cancelled.
 *
 * Catalog: one full pass per connected store, a page per queue message (the same paging the dashboard's sync uses, so no
 * message exceeds Worker limits). Only a pass that reached the last page archives what the platform no longer has; a pass
 * that fails part-way changes nothing beyond the pages it imported.
 */

type Store = typeof schema.stores.$inferSelect;
const MAX_PAGES = 2000;
const MAX_RETRIES = 5;

export interface CatalogReconcileMessage { kind: "catalog_reconcile"; storeId: string; startedAt: string; page: number; cursor: string | null; retries: number }
export const isCatalogReconcileMessage = (m: unknown): m is CatalogReconcileMessage =>
  !!m && typeof m === "object" && (m as CatalogReconcileMessage).kind === "catalog_reconcile" && typeof (m as CatalogReconcileMessage).storeId === "string";

/** Stores whose catalog of record is a connected platform (manual-import stores have nothing to reconcile against). */
async function connectedStores(d: Deps): Promise<Store[]> {
  const ic = schema.integrationCredentials;
  return d.db.select({ s: schema.stores }).from(schema.stores).innerJoin(ic, eq(ic.storeId, schema.stores.id))
    .where(and(eq(schema.stores.status, "active"), inArray(schema.stores.platform, ["shopify", "woocommerce", "bigcommerce"]), isNotNull(ic.encryptedAccessToken)))
    .then((rows) => rows.map((r) => r.s));
}

async function send(d: Deps, msg: CatalogReconcileMessage, delaySeconds?: number): Promise<void> {
  if (d.enqueueEvents) await d.enqueueEvents(msg, delaySeconds ? { delaySeconds } : undefined);
  else await runCatalogReconcile(d, msg); // tests and local runs without a queue: walk the pages inline
}

/** Cron: start a pass for every connected store. Returns how many were started. */
export async function scheduleCatalogReconcile(d: Deps): Promise<number> {
  const stores = await connectedStores(d);
  const startedAt = d.now().toISOString();
  for (const s of stores) {
    try { await send(d, { kind: "catalog_reconcile", storeId: s.id, startedAt, page: 1, cursor: null, retries: 0 }); }
    catch (e) { console.error(JSON.stringify({ level: "error", where: "catalog_reconcile_schedule", storeId: s.id, message: e instanceof Error ? e.message : String(e) })); }
  }
  return stores.length;
}

/** One page of a pass; queues the next page, or finishes the pass on the last one. Never throws: a failed pass is audited. */
export async function runCatalogReconcile(d: Deps, msg: CatalogReconcileMessage): Promise<void> {
  const [store] = await d.db.select().from(schema.stores).where(eq(schema.stores.id, msg.storeId)).limit(1);
  if (!store || store.status !== "active") return;
  let next: { page: number; cursor: string | null } | null;
  try {
    if (store.platform === "shopify") {
      const r = await syncShopifyPage(d, store, msg.cursor);
      if (r.restocked.length) await notifyRestock(d, store.id, r.restocked);
      next = r.nextCursor ? { page: msg.page + 1, cursor: r.nextCursor } : null;
    } else {
      const r = await syncCatalogPage(d, store, msg.page);
      if (r.restocked.length) await notifyRestock(d, store.id, r.restocked);
      next = r.nextPage ? { page: r.nextPage, cursor: null } : null;
    }
  } catch (e) {
    // Throttling or a brief outage: try this page again later. Anything else ends the pass, visibly.
    const retryable = e instanceof HttpError && (e.status === 429 || e.status === 502);
    if (retryable && msg.retries < MAX_RETRIES) { await send(d, { ...msg, retries: msg.retries + 1 }, 30 * (msg.retries + 1)); return; }
    await recordAudit(d, { action: "catalog.reconcile_failed", actorId: null, actorType: "system", storeId: store.id, organizationId: store.organizationId, targetType: "store", targetId: store.id, summary: { page: msg.page, reason: e instanceof HttpError ? e.code : "unexpected" } });
    return;
  }
  if (next && next.page <= MAX_PAGES) { await send(d, { ...msg, ...next, retries: 0 }, store.platform === "shopify" ? 1 : undefined); return; }
  if (next) return; // a catalog this large is never archived from a partial pass

  // The whole catalog was read: anything not seen since the pass started is gone from the platform.
  const gone = await d.db.update(schema.products).set({ status: "archived" })
    .where(and(eq(schema.products.storeId, store.id), ne(schema.products.status, "archived"), lt(schema.products.syncedAt, msg.startedAt)))
    .returning({ id: schema.products.id });
  if (gone.length) await announceCatalogChange(d, store.id, "sync", `reconcile:${store.id}:${msg.startedAt}`, { created: 0, updated: 0, archived: gone.length, restocked: [] });
  await recordAudit(d, { action: "catalog.reconciled", actorId: null, actorType: "system", storeId: store.id, organizationId: store.organizationId, targetType: "store", targetId: store.id, summary: { pages: msg.page, archived: gone.length } });
}

/** Cron: re-read every Shopify-billed workspace's current charge, in case a webhook was lost. Returns how many changed. */
export async function reconcileShopifyBilling(d: Deps): Promise<number> {
  const subs = await d.db.select({ org: schema.subscriptions.organizationId }).from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.provider, "shopify"), inArray(schema.subscriptions.status, ["active", "trialing", "past_due"]), isNotNull(schema.subscriptions.providerRef)));
  let changed = 0;
  for (const s of subs) {
    try { if (await reconcileShopifyCharge(d, s.org)) changed++; }
    catch (e) { console.error(JSON.stringify({ level: "error", where: "billing_reconcile", organizationId: s.org, message: e instanceof Error ? e.message : String(e) })); }
  }
  return changed;
}
