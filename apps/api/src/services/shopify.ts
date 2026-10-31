import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { normalizeShopifyProduct } from "@convertflow/integrations";
import { newId } from "../lib/crypto.js";
import type { Deps } from "../deps.js";
import { recordAudit } from "./audit.js";
import { announceCatalogChange, upsertProducts } from "./catalog.js";
import { publishDomainEvent } from "./domain-events.js";
import { logPrivacyRequest, purgeStoreData, storeByExternal } from "./privacy.js";
import { notifyRestock } from "./restock.js";
import { markUninstalled, refreshByInventoryItem } from "./shopify-app.js";
import { cancelOnUninstall, handleSubscriptionWebhook } from "./shopify-billing.js";
import { eraseContact, normalizeEmail, normalizePhone } from "./contacts.js";

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

/** Contacts in this store with the email or phone in a Shopify privacy payload's `customer` object. */
async function matchingContacts(d: Deps, storeId: string, body: Record<string, unknown>): Promise<string[]> {
  const customer = (body["customer"] && typeof body["customer"] === "object" ? body["customer"] : {}) as Record<string, unknown>;
  const email = typeof customer["email"] === "string" ? normalizeEmail(customer["email"]) : null;
  const phone = typeof customer["phone"] === "string" ? normalizePhone(customer["phone"]) : null;
  const c = schema.contacts;
  const ids = new Set<string>();
  if (email) for (const r of await d.db.select({ id: c.id }).from(c).where(and(eq(c.storeId, storeId), eq(c.email, email)))) ids.add(r.id);
  if (phone) for (const r of await d.db.select({ id: c.id }).from(c).where(and(eq(c.storeId, storeId), eq(c.phone, phone)))) ids.add(r.id);
  return [...ids];
}

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
        await markUninstalled(d, h.shop.toLowerCase());
        if (!store) break;
        await cancelOnUninstall(d, store.organizationId, h.shop.toLowerCase()); // Shopify ends the app's charges on uninstall
        await d.db.update(schema.stores).set({ status: "disconnected", deliveryEnabled: false, updatedAt: d.now().toISOString() }).where(eq(schema.stores.id, store.id));
        await d.db.delete(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, store.id));
        await d.kv.put(`config:${store.siteKey}`, JSON.stringify({ schemaVersion: 1, siteId: store.siteKey, generatedAt: d.now().toISOString(), deliveryEnabled: false, campaigns: [] }));
        await d.kv.put(`site:${store.siteKey}`, JSON.stringify({ id: store.id, active: false }));
        await recordAudit(d, { action: "store.disconnected", actorId: null, actorType: "platform", storeId: store.id, organizationId: store.organizationId, targetType: "store", targetId: store.id, summary: { reason: "platform_uninstalled" } });
        await publishDomainEvent(d, { type: "store.disconnected", payload: { storeId: store.id, reason: "platform_uninstalled" }, idempotencyKey: `shopify:${h.webhookId}`, storeId: store.id, organizationId: store.organizationId, source: "shopify_webhook" });
        break;
      }
      case "shop/redact":
        if (store) await purgeStoreData(d, store.id);
        break;
      case "customers/redact": {
        // Analytics hold no shopper PII (aggregates; conversions keep an order id, total and an anonymous session id). Signup
        // contacts do: erase the ones with this customer's email or phone, with their consent history and provider copies.
        const ids = store ? await matchingContacts(d, store.id, body) : [];
        for (const id of ids) await eraseContact(d, store!.id, id);
        await logPrivacyRequest(d, store?.id ?? null, h.topic, String(body["shop_id"] ?? h.shop));
        if (store && ids.length) await recordAudit(d, { action: "privacy.customer_redacted", actorId: null, actorType: "platform", storeId: store.id, organizationId: store.organizationId, targetType: "privacy_request", targetId: `shopify:${h.webhookId}`, summary: { contactsErased: ids.length } });
        break;
      }
      case "customers/data_request": {
        // Shopify expects the app to give the merchant this customer's data. Record which contacts match (ids only), so the
        // merchant can open them (consent history included) from Subscribers and pass them on; nothing is sent automatically.
        const ids = store ? await matchingContacts(d, store.id, body) : [];
        await logPrivacyRequest(d, store?.id ?? null, h.topic, String(body["shop_id"] ?? h.shop));
        if (store) await recordAudit(d, { action: "privacy.data_requested", actorId: null, actorType: "platform", storeId: store.id, organizationId: store.organizationId, targetType: "privacy_request", targetId: `shopify:${h.webhookId}`, summary: { contactIds: ids.slice(0, 20).join(",") || "none" } });
        break;
      }
      case "app_subscriptions/update":
        await handleSubscriptionWebhook(d, store, h.shop.toLowerCase(), body);
        break;
      case "products/create":
      case "products/update": {
        const p = normalizeShopifyProduct(body);
        if (store && p) {
          const r = await upsertProducts(d, store.id, [p]);
          await announceCatalogChange(d, store.id, "webhook", `shopify:${h.webhookId}`, r);
          if (r.restocked.length) await notifyRestock(d, store.id, r.restocked);
        }
        break;
      }
      case "inventory_levels/update": {
        // Names an inventory item at one location. The product is re-read from Shopify so availability covers every location.
        const item = body["inventory_item_id"];
        if (store && store.status === "active" && (typeof item === "number" || typeof item === "string")) {
          const r = await refreshByInventoryItem(d, store, String(item));
          if (r) {
            await announceCatalogChange(d, store.id, "webhook", `shopify:${h.webhookId}`, r);
            if (r.restocked.length) await notifyRestock(d, store.id, r.restocked);
          }
        }
        break;
      }
      case "products/delete": {
        // Scoped to the store the webhook is for: product ids are only unique within one shop.
        if (store && body["id"] !== undefined) {
          const gone = await d.db.update(schema.products).set({ status: "archived" })
            .where(and(eq(schema.products.storeId, store.id), eq(schema.products.externalId, String(body["id"])))).returning({ id: schema.products.id });
          await announceCatalogChange(d, store.id, "webhook", `shopify:${h.webhookId}`, { created: 0, updated: 0, archived: gone.length, restocked: [] });
        }
        break;
      }
      case "orders/create": {
        // Recorded as a platform event; analytics turns it into a conversion (see services/subscribers.ts).
        const total = Number(body["total_price"]);
        const placed = typeof body["created_at"] === "string" ? Date.parse(body["created_at"]) : NaN;
        const currency = String(body["currency"] ?? store?.currency ?? "").toUpperCase();
        if (store && body["id"] !== undefined && Number.isFinite(total) && total >= 0 && /^[A-Z]{3}$/.test(currency)) {
          const externalOrderId = String(body["id"]).slice(0, 100);
          await publishDomainEvent(d, {
            type: "order.created", payload: { platform: "shopify", externalOrderId, total, currency, placedAt: new Date(Number.isNaN(placed) ? d.now().getTime() : placed).toISOString() },
            // The order, not the delivery: Shopify can send the same order under several webhook ids.
            idempotencyKey: `order.created:shopify:${externalOrderId}:${store.id}`, storeId: store.id, organizationId: store.organizationId, source: "shopify_webhook",
          });
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
