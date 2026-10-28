import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { normalizeShopifyProduct } from "@convertflow/integrations";
import { newId } from "../lib/crypto.js";
import type { Deps } from "../deps.js";
import { upsertProducts } from "./catalog.js";
import { logPrivacyRequest, purgeStoreData, storeByExternal } from "./privacy.js";
import { notifyRestock } from "./restock.js";

const enc = new TextEncoder();

/** Shopify signs the raw body: base64(HMAC-SHA256(secret, body)) in X-Shopify-Hmac-Sha256. */
export async function verifyShopifyHmac(rawBody: string, headerB64: string | undefined, secret: string): Promise<boolean> {
  if (!headerB64) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  let want: Uint8Array;
  try { want = Uint8Array.from(atob(headerB64), (c) => c.charCodeAt(0)); } catch { return false; }
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= (sig[i] ?? 0) ^ (want[i] ?? 0);
  return diff === 0;
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/**
 * Handles a verified webhook. Idempotent on the delivery id, so Shopify retries are harmless.
 * NOTE: written against Shopify's documented payloads; not exercised against a live Shopify store.
 */
export async function handleShopifyWebhook(d: Deps, h: { topic: string; shop: string; webhookId: string; body: unknown }): Promise<WebhookOutcome> {
  const store = await storeByExternal(d, "shopify", h.shop.toLowerCase());
  const fresh = await d.db.insert(schema.webhookEvents)
    .values({ id: newId("whk"), storeId: store?.id ?? null, platform: "shopify", deliveryId: h.webhookId, topic: h.topic, status: "received", receivedAt: d.now().toISOString() })
    .onConflictDoNothing().returning({ id: schema.webhookEvents.id });
  if (fresh.length === 0) return "duplicate";
  const mark = (status: "processed" | "failed") => d.db.update(schema.webhookEvents).set({ status }).where(eq(schema.webhookEvents.id, fresh[0]!.id));

  try {
    const body = (h.body && typeof h.body === "object" ? h.body : {}) as Record<string, unknown>;
    switch (h.topic) {
      case "app/uninstalled": {
        if (!store) break;
        await d.db.update(schema.stores).set({ status: "disconnected", deliveryEnabled: false, updatedAt: d.now().toISOString() }).where(eq(schema.stores.id, store.id));
        await d.db.delete(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, store.id));
        await d.kv.put(`config:${store.siteKey}`, JSON.stringify({ schemaVersion: 1, siteId: store.siteKey, generatedAt: d.now().toISOString(), deliveryEnabled: false, campaigns: [] }));
        await d.kv.put(`site:${store.siteKey}`, JSON.stringify({ id: store.id, active: false }));
        break;
      }
      case "shop/redact":
        if (store) await purgeStoreData(d, store.id);
        break;
      case "customers/redact":
      case "customers/data_request":
        // We keep no shopper PII: events are aggregated, conversions hold only order id, total and an anonymous session id.
        await logPrivacyRequest(d, store?.id ?? null, h.topic, String(body["shop_id"] ?? h.shop));
        break;
      case "products/create":
      case "products/update": {
        const p = normalizeShopifyProduct(body);
        if (store && p) {
          const r = await upsertProducts(d, store.id, [p]);
          if (r.restocked.length) await notifyRestock(d, store.id, r.restocked);
        }
        break;
      }
      case "products/delete": {
        if (store && body["id"] !== undefined) {
          await d.db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.externalId, String(body["id"])));
        }
        break;
      }
      case "orders/create": {
        const total = Number(body["total_price"]);
        if (store && body["id"] !== undefined && Number.isFinite(total)) {
          await d.db.insert(schema.conversions).values({
            id: newId("cnv"), storeId: store.id, orderId: `shopify:${String(body["id"])}`, total,
            currency: String(body["currency"] ?? store.currency).toUpperCase().slice(0, 3),
            occurredAt: typeof body["created_at"] === "string" ? new Date(body["created_at"]).toISOString() : d.now().toISOString(),
          }).onConflictDoNothing();
        }
        break;
      }
      default:
        await mark("processed");
        return "ignored";
    }
    await mark("processed");
    return "processed";
  } catch (e) {
    await mark("failed");
    throw e;
  }
}
