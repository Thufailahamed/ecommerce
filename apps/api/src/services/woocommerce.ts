import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@convertflow/database";
import { isWooVariable, normalizeWooProduct, wooOrderFacts, type NormalizedProduct } from "@convertflow/integrations";
import { decrypt, encrypt } from "../lib/aes.js";
import { newId, randomToken, sha256Hex } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { recordAudit } from "./audit.js";
import { authorizeStore } from "./authz.js";
import { announceCatalogChange, upsertProducts } from "./catalog.js";
import { loadCredentials, saveCredentials } from "./credentials.js";
import { publishDomainEvent } from "./domain-events.js";
import { notifyRestock } from "./restock.js";
import type { SessionUser } from "./auth.js";

/**
 * WooCommerce: connecting a store (WooCommerce's own key approval at /wc-auth/v1/authorize, or keys pasted by hand),
 * REST API v3 access for catalog sync and health checks, and the webhooks this app creates at the store for products and
 * orders. The storefront side (script, page data, purchase reporting) is the WordPress plugin in apps/woocommerce-plugin.
 *
 * Requests only ever go to the store's own registered domain (or the configured mock in tests), never to a URL a merchant
 * typed in a request, which keeps server-side fetching from becoming an SSRF hole.
 *
 * VERIFICATION STATUS: written to WooCommerce's documented REST API v3, authentication endpoint and webhook delivery format,
 * and tested against a fake store. It has NEVER run against a real WooCommerce site (see docs/woocommerce.md).
 */

type Store = typeof schema.stores.$inferSelect;
type Connection = typeof schema.woocommerceConnections.$inferSelect;
const { woocommerceConnections: wc } = schema;

/** What the app subscribes to. "product.restored" is a product coming back from the trash. */
export const WOO_WEBHOOK_TOPICS = ["product.created", "product.updated", "product.deleted", "product.restored", "order.created", "order.updated"] as const;
/** Small pages: a variable product costs one more request for its variations, and a page must stay within Worker limits. */
export const WOO_PAGE_SIZE = 25;
export const WOO_MAX_PAGE = 400;
const STATE_TTL_S = 900;
const APP_NAME = "ConvertFlow";

interface WooKeys { consumerKey: string; consumerSecret: string }

const fetchOf = (d: Deps): typeof fetch => d.fetchFn ?? ((...a) => fetch(...a)); // never call fetch as a method: Workers throws "Illegal invocation"

/** The REST API root for a store: its own domain, or the configured stand-in (local mock) with "{domain}" replaced. */
const restBase = (d: Deps, store: Store) => {
  const tpl = d.secrets?.wooBaseUrl;
  return `${tpl ? tpl.replace("{domain}", store.domain).replace(/\/+$/, "") : `https://${store.domain}`}/wp-json/wc/v3`;
};
/** Where the store's browser approval page lives. Always the real store: the merchant's browser goes here, never a mock. */
const authorizePage = (store: Store) => `https://${store.domain}/wc-auth/v1/authorize`;
/** Every webhook this app creates for a store points here. */
const deliveryBase = (apiOrigin: string, storeId: string) => `${apiOrigin.replace(/\/+$/, "")}/api/v1/webhooks/woocommerce/${storeId}`;
/**
 * The delivery URL also names the connection (whose secret signs it), so every run, including two at once, agrees on which
 * webhooks are current: one pointing at this URL was made with this connection's secret, whoever made it.
 */
export const wooDeliveryUrl = (apiOrigin: string, storeId: string, connectionId: string) => `${deliveryBase(apiOrigin, storeId)}?c=${connectionId}`;
/** Any webhook of this app for this store, from any connection (exact base, so sto_ab never matches sto_abc). */
const isOurs = (url: string, base: string) => url === base || url.startsWith(`${base}?`);

/** True when this deployment can run the approval flow and receive webhooks. Manual keys and sync work without it. */
export const wooAppConfigured = (d: Deps) => Boolean(d.secrets?.apiOrigin && d.secrets.webOrigin && d.secrets.credentialKey);

/* ---------- REST client ---------- */

export type WooErrorKind = "auth" | "throttled" | "unreachable" | "server" | "not_found" | "unreadable" | "rejected";
export class WooApiError extends Error {
  constructor(readonly kind: WooErrorKind, readonly status: number) { super(`${kind} ${status}`); }
}

/** One REST call. Errors are classified; the store's own messages are not passed on (they can contain anything). */
async function wooRequest<T = unknown>(d: Deps, store: Store, keys: WooKeys, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ json: T; headers: Headers }> {
  const url = `${restBase(d, store)}${path}`;
  const send = async (queryAuth: boolean) => {
    const headers: Record<string, string> = { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) };
    let u = url;
    if (queryAuth) u += `${url.includes("?") ? "&" : "?"}consumer_key=${encodeURIComponent(keys.consumerKey)}&consumer_secret=${encodeURIComponent(keys.consumerSecret)}`;
    else headers["authorization"] = `Basic ${btoa(`${keys.consumerKey}:${keys.consumerSecret}`)}`;
    try { return await fetchOf(d)(u, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new WooApiError("unreachable", 0); }
  };
  let res = await send(false);
  // Some hosts strip the Authorization header before PHP sees it. WooCommerce documents query-string keys for HTTPS sites.
  if (res.status === 401 && url.startsWith("https://")) res = await send(true);
  if (res.status === 401 || res.status === 403) throw new WooApiError("auth", res.status);
  if (res.status === 429) throw new WooApiError("throttled", 429);
  if (res.status === 404) throw new WooApiError("not_found", 404);
  if (res.status >= 500 || res.status === 408) throw new WooApiError("server", res.status);
  if (!res.ok) throw new WooApiError("rejected", res.status);
  try { return { json: (await res.json()) as T, headers: res.headers }; }
  catch { throw new WooApiError("unreadable", res.status); }
}

/** What a merchant is told when a store call fails. Codes match the catalog sync's, so the dashboard and cron treat them alike. */
export function wooHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (!(e instanceof WooApiError)) return new HttpError(502, "catalog_error", "Your store returned an unexpected response.");
  switch (e.kind) {
    case "auth": return new HttpError(422, "credentials_rejected", "Your store rejected the credentials. Check the keys and their permissions (read access to products), or connect again.");
    case "throttled": return new HttpError(429, "catalog_throttled", "Your store is limiting requests right now. Try again in a few seconds.");
    case "unreachable": return new HttpError(502, "catalog_unreachable", "Could not reach your store. Check that it is online.");
    case "not_found": return new HttpError(422, "woocommerce_api_not_found", "Your store's WooCommerce REST API was not found. Check that WooCommerce is active, the domain is the WordPress site, and permalinks are not set to Plain.");
    case "unreadable": return new HttpError(502, "catalog_error", "Your store returned an unreadable response.");
    default: return new HttpError(502, "catalog_error", `Your store returned an error (${e.status}).`);
  }
}

/* ---------- stored connection ---------- */

async function connectionRow(d: Deps, storeId: string): Promise<Connection | null> {
  const [r] = await d.db.select().from(wc).where(eq(wc.storeId, storeId)).limit(1);
  return r ?? null;
}

/** The stored keys for a WooCommerce store, or a 409 telling the merchant to connect. */
export async function wooKeys(d: Deps, store: Store): Promise<WooKeys> {
  if (store.platform !== "woocommerce") throw new HttpError(409, "wrong_platform", "This store is not registered as WooCommerce");
  const c = await loadCredentials(d, store.id);
  let parsed: { kind?: string; consumerKey?: string; consumerSecret?: string } | undefined;
  try { parsed = c ? JSON.parse(c.accessToken) as typeof parsed : undefined; } catch { throw new HttpError(409, "not_connected", "Stored credentials are unreadable. Reconnect."); }
  if (!parsed || parsed.kind !== "woocommerce" || !parsed.consumerKey || !parsed.consumerSecret) throw new HttpError(409, "not_connected", "Connect your catalog credentials first");
  return { consumerKey: parsed.consumerKey, consumerSecret: parsed.consumerSecret };
}

const credentialKey = (d: Deps) => {
  const k = d.secrets?.credentialKey;
  if (!k) throw new HttpError(503, "not_configured", "Credential encryption key is not configured");
  return k;
};

/**
 * Stores the keys (encrypted) and the connection record. A reconnect keeps the webhook secret and the webhooks already
 * created with it; only a first connection makes a new secret.
 */
async function saveConnection(d: Deps, store: Store, keys: WooKeys, method: Connection["method"], keyPermissions: string | null, verified: boolean): Promise<void> {
  const key = credentialKey(d);
  await saveCredentials(d, store.id, { accessToken: JSON.stringify({ kind: "woocommerce", ...keys }), scopes: "woocommerce" });
  const now = d.now().toISOString();
  const existing = await connectionRow(d, store.id);
  if (existing) {
    await d.db.update(wc).set({ method, keyPermissions, verifiedAt: verified ? now : null, connectedAt: now, updatedAt: now }).where(eq(wc.id, existing.id));
    return;
  }
  await d.db.insert(wc).values({
    id: newId("woc"), storeId: store.id, method, keyPermissions, encryptedWebhookSecret: await encrypt(randomToken(32), key),
    webhookIds: [], webhookState: "pending", webhookError: null, verifiedAt: verified ? now : null, lastWebhookAt: null, connectedAt: now, updatedAt: now,
  });
}

/** A read the keys must allow, and proof the site answers as WooCommerce (an array of products). */
async function verifyKeys(d: Deps, store: Store, keys: WooKeys): Promise<void> {
  const { json } = await wooRequest(d, store, keys, "GET", "/products?per_page=1&_fields=id");
  if (!Array.isArray(json)) throw new WooApiError("unreadable", 200);
}

/* ---------- connecting ---------- */

/**
 * Keys pasted by the merchant. They are checked against the store before anything is stored, then the app tries to create
 * its webhooks (which needs Read/Write keys; Read-only keys still sync, and the status says webhooks are off).
 */
export async function connectWithKeys(d: Deps, user: SessionUser, store: Store, keys: WooKeys) {
  if (store.platform !== "woocommerce") throw new HttpError(409, "wrong_platform", "This store is not registered as WooCommerce");
  credentialKey(d); // no request goes out before we know the keys can be stored
  try { await verifyKeys(d, store, keys); } catch (e) { throw wooHttpError(e); }
  await saveConnection(d, store, keys, "manual", null, true);
  await recordAudit(d, { action: "woocommerce.connected", actorId: user.userId, storeId: store.id, organizationId: store.organizationId, targetType: "store", targetId: store.id, summary: { method: "manual" } });
  await ensureWebhooks(d, store);
}

/**
 * Starts WooCommerce's own approval page: the merchant signs in to their WordPress admin and approves Read/Write keys for
 * this app; WooCommerce then posts the keys to our callback and sends the browser back to the dashboard.
 */
export async function beginAuthorize(d: Deps, user: SessionUser, store: Store): Promise<string> {
  if (store.platform !== "woocommerce") throw new HttpError(409, "wrong_platform", "This store is not registered as WooCommerce");
  if (!wooAppConfigured(d)) throw new HttpError(503, "not_configured", "Connecting WooCommerce stores is not configured on this deployment. Paste API keys instead.");
  const api = d.secrets!.apiOrigin!.replace(/\/+$/, ""), web = d.secrets!.webOrigin!.replace(/\/+$/, "");
  const nonce = randomToken(24);
  await d.kv.put(`woo:state:${nonce}`, JSON.stringify({ storeId: store.id, userId: user.userId }), { expirationTtl: STATE_TTL_S });
  const q = new URLSearchParams({
    app_name: APP_NAME, scope: "read_write", user_id: nonce,
    // WooCommerce appends success=1|0 and user_id to this when it sends the merchant back.
    return_url: `${web}/app/settings?woocommerce=returned&store=${encodeURIComponent(store.id)}`,
    callback_url: `${api}/api/v1/woocommerce/callback`,
  });
  return `${authorizePage(store)}?${q.toString()}`;
}

const CallbackBody = z.object({
  key_id: z.union([z.number(), z.string()]).optional(),
  user_id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  consumer_key: z.string().regex(/^ck_[A-Za-z0-9]{8,80}$/),
  consumer_secret: z.string().regex(/^cs_[A-Za-z0-9]{8,80}$/),
  key_permissions: z.enum(["read", "write", "read_write"]),
});

/**
 * WooCommerce posts the approved keys here, from the store's server, before sending the merchant back. The single-use
 * `user_id` we put in the approval link is the only thing that ties the post to a store, and only the merchant who started
 * the approval (and their store) ever sees it. The keys are stored but not trusted yet: the dashboard runs `setupConnection`
 * when the merchant lands back, which checks them against the registered domain. Answering quickly matters: WooCommerce
 * discards the keys if this call fails or times out.
 */
export async function handleAuthCallback(d: Deps, raw: unknown): Promise<{ storeId: string }> {
  const b = CallbackBody.safeParse(raw);
  if (!b.success) throw new HttpError(400, "invalid_request", "Not a WooCommerce key delivery");
  const stateKey = `woo:state:${b.data.user_id}`;
  const state = await d.kv.get(stateKey);
  if (!state || state === "used") throw new HttpError(404, "invalid_state", "This approval has expired or was already used. Connect again from Settings.");
  await d.kv.put(stateKey, "used", { expirationTtl: STATE_TTL_S }); // single use
  let s: { storeId?: string; userId?: string };
  try { s = JSON.parse(state) as typeof s; } catch { throw new HttpError(404, "invalid_state", "This approval has expired. Connect again from Settings."); }
  if (!s.storeId || !s.userId) throw new HttpError(404, "invalid_state", "This approval has expired. Connect again from Settings.");
  // The merchant who started it must still be allowed to manage the store's integrations.
  const { store } = await authorizeStore(d, { type: "user", userId: s.userId }, s.storeId, "integrations.manage");
  if (store.platform !== "woocommerce" || store.status !== "active") throw new HttpError(409, "wrong_platform", "This store can no longer be connected");
  await saveConnection(d, store, { consumerKey: b.data.consumer_key, consumerSecret: b.data.consumer_secret }, "authorize", b.data.key_permissions, false);
  await recordAudit(d, { action: "woocommerce.connected", actorId: s.userId, storeId: store.id, organizationId: store.organizationId, targetType: "store", targetId: store.id, summary: { method: "authorize", permissions: b.data.key_permissions } });
  return { storeId: store.id };
}

/**
 * Checks the stored keys against the store and makes sure the app's webhooks exist and are active. Run when the merchant
 * returns from the approval page, from "Repair", and safe to run any number of times.
 */
export async function setupConnection(d: Deps, store: Store) {
  const keys = await wooKeys(d, store);
  let conn = await connectionRow(d, store.id);
  if (!conn) { await saveConnection(d, store, keys, "manual", null, false); conn = (await connectionRow(d, store.id))!; } // keys stored before connections existed
  try { await verifyKeys(d, store, keys); } catch (e) { throw wooHttpError(e); }
  await d.db.update(wc).set({ verifiedAt: d.now().toISOString(), updatedAt: d.now().toISOString() }).where(eq(wc.id, conn.id));
  await ensureWebhooks(d, store);
  return connectionView(d, store);
}

interface WooWebhook { id: number; topic: string; status: string; delivery_url: string }

/**
 * Makes the store's webhooks match WOO_WEBHOOK_TOPICS: one active webhook per topic at this connection's delivery URL.
 * Ours from an older connection (another secret), duplicates, and ones WooCommerce disabled after failed deliveries are
 * deleted, and missing topics created. Safe to run concurrently: runs converge on the next pass. Never throws: the outcome
 * is recorded on the connection for the dashboard.
 */
export async function ensureWebhooks(d: Deps, store: Store): Promise<void> {
  const conn = await connectionRow(d, store.id);
  if (!conn) return;
  const record = (webhookState: Connection["webhookState"], webhookError: string | null, webhookIds?: number[]) =>
    d.db.update(wc).set({ webhookState, webhookError, ...(webhookIds ? { webhookIds } : {}), updatedAt: d.now().toISOString() }).where(eq(wc.id, conn.id));
  const api = d.secrets?.apiOrigin;
  if (!api || !d.secrets?.credentialKey) { await record("failed", "not_configured"); return; }
  let keys: WooKeys, secret: string;
  try { keys = await wooKeys(d, store); secret = await decrypt(conn.encryptedWebhookSecret, d.secrets.credentialKey); }
  catch { await record("failed", "not_connected"); return; }
  const deliveryUrl = wooDeliveryUrl(api, store.id, conn.id);
  const base = deliveryBase(api, store.id);

  let existing: WooWebhook[];
  try {
    const { json } = await wooRequest<unknown>(d, store, keys, "GET", "/webhooks?per_page=100");
    existing = (Array.isArray(json) ? json : []).filter((h): h is WooWebhook => !!h && typeof h === "object" && typeof (h as WooWebhook).id === "number");
  } catch (e) {
    await record(e instanceof WooApiError && e.kind === "auth" ? "read_only" : "failed", e instanceof WooApiError && e.kind !== "auth" ? `store_${e.kind}` : null);
    return;
  }
  const keep = new Map<string, number>();
  for (const h of existing.filter((x) => typeof x.delivery_url === "string" && isOurs(x.delivery_url, base))) {
    if (h.delivery_url === deliveryUrl && h.status === "active" && (WOO_WEBHOOK_TOPICS as readonly string[]).includes(h.topic) && !keep.has(h.topic)) keep.set(h.topic, h.id);
    else await wooRequest(d, store, keys, "DELETE", `/webhooks/${h.id}?force=true`).catch(() => undefined);
  }
  for (const topic of WOO_WEBHOOK_TOPICS.filter((t) => !keep.has(t))) {
    try {
      const { json } = await wooRequest<{ id?: unknown }>(d, store, keys, "POST", "/webhooks", {
        name: `${APP_NAME}: ${topic}`, topic, delivery_url: deliveryUrl, secret, status: "active", api_version: "wp_api_v3",
      });
      if (typeof json?.id !== "number") throw new WooApiError("unreadable", 200);
      keep.set(topic, json.id);
    } catch (e) {
      const ids = [...keep.values()];
      // Read-only keys can list webhooks but not create them: the catalog still syncs; nothing arrives by webhook.
      if (e instanceof WooApiError && e.kind === "auth") await record("read_only", null, ids);
      else await record("failed", e instanceof WooApiError ? `store_${e.kind}` : "unexpected", ids);
      return;
    }
  }
  await record("active", null, [...keep.values()]);
}

/**
 * Deletes every webhook of this app for this store, recorded or not (best effort: the store may be gone or the keys
 * revoked). Recorded ids are deleted even when the list cannot be read.
 */
async function removeWebhooks(d: Deps, store: Store): Promise<void> {
  const conn = await connectionRow(d, store.id);
  let keys: WooKeys;
  try { keys = await wooKeys(d, store); } catch { return; }
  const ids = new Set(conn?.webhookIds ?? []);
  const api = d.secrets?.apiOrigin;
  if (api) {
    const base = deliveryBase(api, store.id);
    const listed = await wooRequest<unknown>(d, store, keys, "GET", "/webhooks?per_page=100").then((r) => (Array.isArray(r.json) ? r.json as WooWebhook[] : [])).catch(() => [] as WooWebhook[]);
    for (const h of listed) if (typeof h?.delivery_url === "string" && isOurs(h.delivery_url, base) && typeof h.id === "number") ids.add(h.id);
  }
  for (const id of ids) await wooRequest(d, store, keys, "DELETE", `/webhooks/${id}?force=true`).catch(() => undefined);
}

/** Disconnect WooCommerce but keep the store, its campaigns and its catalog. The keys can then be revoked in WooCommerce. */
export async function disconnectWoo(d: Deps, actorId: string | null, store: Store): Promise<void> {
  await removeWebhooks(d, store);
  await d.db.delete(wc).where(eq(wc.storeId, store.id));
  await d.db.delete(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, store.id));
  await recordAudit(d, { action: "woocommerce.disconnected", actorId, actorType: actorId ? "user" : "system", storeId: store.id, organizationId: store.organizationId, targetType: "store", targetId: store.id });
}

/** Connection state for the dashboard. Never includes keys or the webhook secret. */
export async function connectionView(d: Deps, store: Store) {
  const conn = await connectionRow(d, store.id);
  const creds = await d.db.select({ id: schema.integrationCredentials.id }).from(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, store.id)).limit(1);
  return {
    configured: wooAppConfigured(d), connected: creds.length > 0,
    method: conn?.method ?? null, keyPermissions: conn?.keyPermissions ?? null, verifiedAt: conn?.verifiedAt ?? null, connectedAt: conn?.connectedAt ?? null,
    webhooks: { state: conn?.webhookState ?? "pending", error: conn?.webhookError ?? null, count: conn?.webhookIds.length ?? 0, topics: [...WOO_WEBHOOK_TOPICS], lastReceivedAt: conn?.lastWebhookAt ?? null },
  };
}

/** A read-only call proving the keys still work, plus whether the store still has the app's webhooks switched on. */
export async function wooHealth(d: Deps, store: Store): Promise<{ ok: boolean; detail: string }> {
  try {
    const keys = await wooKeys(d, store);
    await verifyKeys(d, store, keys);
    const conn = await connectionRow(d, store.id);
    if (!conn?.webhookIds.length) return { ok: true, detail: "The store accepted the stored keys. Webhooks are not set up, so changes arrive only when you sync." };
    const { json } = await wooRequest<unknown>(d, store, keys, "GET", "/webhooks?per_page=100");
    const mine = (Array.isArray(json) ? json as WooWebhook[] : []).filter((h) => conn.webhookIds.includes(h.id));
    const active = mine.filter((h) => h.status === "active").length;
    if (active < conn.webhookIds.length) return { ok: false, detail: `${conn.webhookIds.length - active} of the app's webhooks are missing or disabled at the store. Use Repair in Settings.` };
    return { ok: true, detail: "The store accepted the stored keys and all webhooks are active" };
  } catch (e) {
    return { ok: false, detail: wooHttpError(e).message };
  }
}

/* ---------- catalog ---------- */

async function variationsOf(d: Deps, store: Store, keys: WooKeys, productId: string): Promise<unknown[]> {
  const { json } = await wooRequest<unknown>(d, store, keys, "GET", `/products/${encodeURIComponent(productId)}/variations?per_page=100`);
  return Array.isArray(json) ? json : [];
}

/** One page of products, variable products with their variations. The caller loops until `nextPage` is null. */
export async function syncWooPage(d: Deps, store: Store, page: number) {
  if (!Number.isInteger(page) || page < 1 || page > WOO_MAX_PAGE) throw new HttpError(422, "validation_failed", "Invalid page");
  const keys = await wooKeys(d, store);
  const items: NormalizedProduct[] = [];
  let nextPage: number | null;
  try {
    const { json, headers } = await wooRequest<unknown>(d, store, keys, "GET", `/products?per_page=${WOO_PAGE_SIZE}&page=${page}&status=any`);
    const rows = Array.isArray(json) ? json : [];
    for (const raw of rows) {
      const p = normalizeWooProduct(raw, isWooVariable(raw) ? await variationsOf(d, store, keys, String((raw as { id: unknown }).id)) : undefined);
      if (p) items.push(p);
    }
    const totalPages = Number(headers.get("x-wp-totalpages"));
    nextPage = Number.isInteger(totalPages) && totalPages > 0 ? (page < totalPages ? page + 1 : null) : rows.length === WOO_PAGE_SIZE ? page + 1 : null;
  } catch (e) { throw wooHttpError(e); }
  const r = items.length ? await upsertProducts(d, store.id, items) : { created: 0, updated: 0, restocked: [] as string[] };
  await announceCatalogChange(d, store.id, "sync", newId("syn"), r);
  return { imported: items.length, created: r.created, updated: r.updated, restocked: r.restocked, nextPage };
}

/** Re-reads one product (and its variations) from the store: how a variable product's webhook is applied. */
export async function refreshWooProduct(d: Deps, store: Store, productId: string, key: string): Promise<void> {
  const keys = await wooKeys(d, store);
  let p: NormalizedProduct | null;
  try {
    const { json } = await wooRequest<unknown>(d, store, keys, "GET", `/products/${encodeURIComponent(productId)}`);
    p = normalizeWooProduct(json, isWooVariable(json) ? await variationsOf(d, store, keys, productId) : undefined);
  } catch (e) {
    if (e instanceof WooApiError && e.kind === "not_found") { await archiveProduct(d, store, productId, key); return; }
    throw wooHttpError(e);
  }
  if (p) await applyProduct(d, store, p, key);
}

async function applyProduct(d: Deps, store: Store, p: NormalizedProduct, key: string): Promise<void> {
  const r = await upsertProducts(d, store.id, [p]);
  await announceCatalogChange(d, store.id, "webhook", key, r, "woocommerce");
  if (r.restocked.length) await notifyRestock(d, store.id, r.restocked);
}

async function archiveProduct(d: Deps, store: Store, productId: string, key: string): Promise<void> {
  // Scoped to this store: product ids are only unique within one site.
  const gone = await d.db.update(schema.products).set({ status: "archived" })
    .where(and(eq(schema.products.storeId, store.id), eq(schema.products.externalId, productId))).returning({ id: schema.products.id });
  await announceCatalogChange(d, store.id, "webhook", key, { created: 0, updated: 0, archived: gone.length, restocked: [] }, "woocommerce");
}

/* ---------- variable-product refresh, off the webhook's clock ---------- */

/**
 * WooCommerce gives up on a delivery after about 5 seconds and disables a webhook after repeated failures, so a variable
 * product (which needs more requests to the store) is refreshed from the queue instead of inside the webhook.
 */
export interface WooProductRefreshMessage { kind: "woo_product_refresh"; storeId: string; productId: string; key: string; retries: number }
export const isWooProductRefreshMessage = (m: unknown): m is WooProductRefreshMessage =>
  !!m && typeof m === "object" && (m as WooProductRefreshMessage).kind === "woo_product_refresh" && typeof (m as WooProductRefreshMessage).storeId === "string";

export async function runWooProductRefresh(d: Deps, msg: WooProductRefreshMessage): Promise<void> {
  const [store] = await d.db.select().from(schema.stores).where(eq(schema.stores.id, msg.storeId)).limit(1);
  if (!store || store.status !== "active" || store.platform !== "woocommerce") return;
  try { await refreshWooProduct(d, store, msg.productId, msg.key); }
  catch (e) {
    const retryable = e instanceof HttpError && (e.status === 429 || e.status === 502);
    if (retryable && msg.retries < 5 && d.enqueueEvents) { await d.enqueueEvents({ ...msg, retries: msg.retries + 1 }, { delaySeconds: 30 * (msg.retries + 1) }); return; }
    // The daily reconciliation pass picks the product up again; record why this one did not apply.
    await recordAudit(d, { action: "woocommerce.product_refresh_failed", actorId: null, actorType: "system", storeId: store.id, organizationId: store.organizationId, targetType: "product", targetId: msg.productId.slice(0, 100), summary: { reason: e instanceof HttpError ? e.code : "unexpected" } });
  }
}

/* ---------- webhooks ---------- */

const enc = new TextEncoder();
/** WooCommerce signs the raw body: base64(HMAC-SHA256(secret, body)) in X-WC-Webhook-Signature. */
export async function verifyWooSignature(rawBody: string, headerB64: string | undefined, secret: string): Promise<boolean> {
  if (!headerB64) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  let want: Uint8Array;
  try { want = Uint8Array.from(atob(headerB64.trim()), (c) => c.charCodeAt(0)); } catch { return false; }
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= (sig[i] ?? 0) ^ (want[i] ?? 0);
  return diff === 0;
}

/** WooCommerce's delivery test when a webhook is saved: an unsigned form post of the webhook id. */
export const isWooPing = (rawBody: string, signature: string | undefined) => !signature && /^webhook_id=\d{1,20}$/.test(rawBody.trim());

export type WooWebhookOutcome = "processed" | "duplicate" | "ignored" | "ping";

/**
 * A delivery to this store's webhook URL. The store is named in the URL, but nothing is trusted until the body's signature
 * matches that store's own secret. Idempotent: the delivery id plus a hash of the body is the key (WooCommerce's delivery id
 * alone can repeat for two changes in the same second).
 */
export async function handleWooWebhook(d: Deps, storeId: string, h: { raw: string; signature: string | undefined; topic: string; deliveryId: string }): Promise<WooWebhookOutcome> {
  const [store] = await d.db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const conn = store && store.platform === "woocommerce" ? await connectionRow(d, store.id) : null;
  // Unknown or disconnected: a non-2xx answer makes WooCommerce disable a webhook that should no longer exist.
  if (!store || !conn || store.status !== "active" || !d.secrets?.credentialKey) throw new HttpError(404, "not_found", "No WooCommerce connection here");
  if (isWooPing(h.raw, h.signature)) return "ping";
  const secret = await decrypt(conn.encryptedWebhookSecret, d.secrets.credentialKey);
  if (!(await verifyWooSignature(h.raw, h.signature, secret))) throw new HttpError(401, "invalid_signature", "Invalid signature");
  let body: Record<string, unknown>;
  try { const j: unknown = JSON.parse(h.raw); body = j && typeof j === "object" ? j as Record<string, unknown> : {}; }
  catch { throw new HttpError(400, "invalid_json", "Invalid JSON"); }

  const deliveryKey = `${store.id}:${h.deliveryId.slice(0, 80)}:${(await sha256Hex(h.raw)).slice(0, 16)}`;
  const fresh = await d.db.insert(schema.webhookEvents)
    .values({ id: newId("whk"), storeId: store.id, platform: "woocommerce", deliveryId: deliveryKey, topic: h.topic.slice(0, 60), status: "received", receivedAt: d.now().toISOString() })
    .onConflictDoNothing().returning({ id: schema.webhookEvents.id });
  if (fresh.length === 0) return "duplicate";
  const mark = (status: "processed" | "failed") => d.db.update(schema.webhookEvents).set({ status }).where(eq(schema.webhookEvents.id, fresh[0]!.id));
  await d.db.update(wc).set({ lastWebhookAt: d.now().toISOString() }).where(eq(wc.id, conn.id));
  const key = `woocommerce:${fresh[0]!.id}`;

  try {
    switch (h.topic) {
      case "product.created":
      case "product.updated":
      case "product.restored": {
        if (body["id"] === undefined) break;
        const productId = String(body["id"]).slice(0, 100);
        if (isWooVariable(body)) {
          const msg: WooProductRefreshMessage = { kind: "woo_product_refresh", storeId: store.id, productId, key, retries: 0 };
          if (d.enqueueEvents) await d.enqueueEvents(msg); else await runWooProductRefresh(d, msg);
          break;
        }
        const p = normalizeWooProduct(body);
        if (p) await applyProduct(d, store, p, key);
        break;
      }
      case "product.deleted":
        if (body["id"] !== undefined) await archiveProduct(d, store, String(body["id"]).slice(0, 100), key);
        break;
      case "order.created":
      case "order.updated": {
        // order.updated too: the block checkout creates a draft first, and the order becomes a purchase on a later update.
        const o = wooOrderFacts(body);
        if (!o) break;
        await publishDomainEvent(d, {
          type: "order.created", payload: { platform: "woocommerce", externalOrderId: o.externalOrderId, total: o.total, currency: o.currency, placedAt: o.placedAt ?? d.now().toISOString() },
          // The order, not the delivery: created and every later update carry the same order.
          idempotencyKey: `order.created:woocommerce:${o.externalOrderId}:${store.id}`, storeId: store.id, organizationId: store.organizationId, source: "woocommerce_webhook",
        });
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
