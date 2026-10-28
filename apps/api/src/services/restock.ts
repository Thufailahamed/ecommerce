import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { b64url, newId, randomToken, sha256Hex } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { emailEnabled, templates } from "./email.js";
import { rollupAvailability } from "./catalog.js";
import { revokeConsent } from "./contacts.js";
import { getPlan } from "./stores.js";

const { subscribers, stores, products, productVariants, suppressionRecords, usageRecords } = schema;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_PER_RUN = 100;
const enc = new TextEncoder();

const emailHash = (storeId: string, email: string) => sha256Hex(`${storeId}:${email.toLowerCase()}`);

function apiLink(d: Deps, path: string, token: string): string {
  const o = d.secrets?.apiOrigin;
  if (!o) throw new HttpError(503, "not_configured", "API origin is not configured");
  return `${o}${path}?token=${encodeURIComponent(token)}`;
}

/** Stateless unsubscribe token: "<subscriberId>.<HMAC-SHA256(id)>". Rebuildable for any later email, nothing sensitive stored. */
async function hmacKey(d: Deps) {
  const k = d.secrets?.credentialKey;
  if (!k) return null;
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(k), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function unsubscribeToken(d: Deps, subscriberId: string): Promise<string | null> {
  const key = await hmacKey(d);
  if (!key) return null;
  return `${subscriberId}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`unsub:${subscriberId}`))))}`;
}

/** Features that send email to shoppers need email delivery, the signing key and the API origin. */
export const restockAvailable = (d: Deps): boolean => emailEnabled(d) && Boolean(d.secrets?.credentialKey) && Boolean(d.secrets?.apiOrigin);

/**
 * Public, unauthenticated: a shopper asks to be told when a product is back. Always answers the same way
 * (no signal about plans, suppression or existing subscriptions). Double opt-in: nothing is sent to the
 * address except the confirmation until the shopper confirms.
 */
export async function subscribeRestock(d: Deps, input: { siteKey: string; productId: string; email: string }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254 || !restockAvailable(d)) return;
  const [store] = await d.db.select().from(stores).where(eq(stores.siteKey, input.siteKey)).limit(1);
  if (!store || store.status !== "active") return;
  if ((await getPlan(d, store.organizationId)).notificationsPerMonth <= 0) return;
  const [product] = await d.db.select().from(products).where(and(eq(products.storeId, store.id), eq(products.externalId, input.productId))).limit(1);
  if (!product) return;
  const [suppressed] = await d.db.select({ id: suppressionRecords.id }).from(suppressionRecords).where(and(eq(suppressionRecords.storeId, store.id), eq(suppressionRecords.emailHash, await emailHash(store.id, email)))).limit(1);
  if (suppressed) return;

  const [existing] = await d.db.select().from(subscribers).where(and(eq(subscribers.storeId, store.id), eq(subscribers.productExternalId, input.productId), eq(subscribers.email, email))).limit(1);
  if (existing && existing.status !== "pending" && existing.status !== "notified") return; // already confirmed / unsubscribed
  const confirm = randomToken(24);
  const now = d.now().toISOString();
  let id = existing?.id;
  if (existing) {
    await d.db.update(subscribers).set({ status: "pending", confirmHash: await sha256Hex(confirm), createdAt: now, confirmedAt: null, notifiedAt: null }).where(eq(subscribers.id, existing.id));
  } else {
    id = newId("sub");
    await d.db.insert(subscribers).values({ id, storeId: store.id, productExternalId: input.productId, email, status: "pending", confirmHash: await sha256Hex(confirm), createdAt: now });
  }
  try {
    const unsub = apiLink(d, "/api/v1/notifications/unsubscribe", (await unsubscribeToken(d, id!))!);
    await d.email!.send(templates.restockConfirm(email, apiLink(d, "/api/v1/notifications/confirm", confirm), store.name, product.title, unsub));
  } catch (e) { console.error(JSON.stringify({ level: "error", where: "restock_confirm_email", message: e instanceof Error ? e.message : "send failed" })); }
}

export async function confirmSubscription(d: Deps, token: string): Promise<boolean> {
  const r = await d.db.update(subscribers).set({ status: "confirmed", confirmedAt: d.now().toISOString() })
    .where(and(eq(subscribers.confirmHash, await sha256Hex(token)), eq(subscribers.status, "pending"))).returning({ id: subscribers.id });
  return r.length > 0;
}

/** Idempotent. Also adds the address to the store's suppression list so it can never be re-subscribed by mistake. */
export async function unsubscribe(d: Deps, token: string): Promise<boolean> {
  const [id] = token.split(".");
  const key = await hmacKey(d);
  if (!id || !key) return false;
  const want = await unsubscribeToken(d, id);
  // constant-time compare of equal-length strings
  if (!want || want.length !== token.length || [...want].reduce((a, c, i) => a | (c.charCodeAt(0) ^ token.charCodeAt(i)), 0) !== 0) return false;
  const [s] = await d.db.select().from(subscribers).where(eq(subscribers.id, id)).limit(1);
  if (!s) return false;
  await d.db.update(subscribers).set({ status: "unsubscribed" }).where(and(eq(subscribers.storeId, s.storeId), eq(subscribers.email, s.email)));
  await d.db.insert(suppressionRecords).values({ id: newId("sup"), storeId: s.storeId, emailHash: await emailHash(s.storeId, s.email), reason: "unsubscribed", createdAt: d.now().toISOString() }).onConflictDoNothing();
  await revokeConsent(d, s.storeId, "email", s.email, "restock_unsubscribe"); // suppression is store-wide, so a marketing contact for this address must show as opted out too
  return true;
}

/**
 * Data minimisation: a shopper's email is only needed until their one alert is sent. Unconfirmed sign-ups are dropped
 * after 7 days; alerted and unsubscribed rows after 30. The hashed suppression entry (not the address) outlives them,
 * so an unsubscribed person still cannot be re-subscribed.
 */
export async function purgeSubscribers(d: Deps): Promise<number> {
  const ago = (days: number) => new Date(d.now().getTime() - days * 86_400_000).toISOString();
  let n = 0;
  for (const cond of [
    and(eq(subscribers.status, "pending"), lt(subscribers.createdAt, ago(7))),
    and(eq(subscribers.status, "notified"), lt(subscribers.notifiedAt, ago(30))),
    and(eq(subscribers.status, "unsubscribed"), lt(subscribers.createdAt, ago(30))),
  ]) n += (await d.db.delete(subscribers).where(cond).returning({ id: subscribers.id })).length;
  return n;
}

/**
 * Sends one-time "available again" emails for confirmed subscribers whose product is currently in stock.
 * Respects the plan's monthly quota and caps each run, leaving the rest for the next run (daily cron).
 */
export async function notifyRestock(d: Deps, storeId: string, onlyProducts?: string[]): Promise<{ sent: number; remaining: number }> {
  if (!restockAvailable(d)) return { sent: 0, remaining: 0 };
  const [store] = await d.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store || store.status !== "active") return { sent: 0, remaining: 0 };
  const plan = await getPlan(d, store.organizationId);
  const period = d.now().toISOString().slice(0, 7);
  const [u] = await d.db.select().from(usageRecords).where(and(eq(usageRecords.organizationId, store.organizationId), eq(usageRecords.metric, "notifications"), eq(usageRecords.period, period))).limit(1);
  let budget = Math.min(MAX_PER_RUN, plan.notificationsPerMonth - (u?.count ?? 0));
  if (budget <= 0) return { sent: 0, remaining: 0 };

  const subs = await d.db.select().from(subscribers).where(and(eq(subscribers.storeId, storeId), eq(subscribers.status, "confirmed"), ...(onlyProducts ? [inArray(subscribers.productExternalId, onlyProducts)] : [])));
  let sent = 0, remaining = 0;
  const cache = new Map<string, { title: string; url: string } | null>();
  for (const s of subs) {
    if (!cache.has(s.productExternalId)) {
      const [p] = await d.db.select().from(products).where(and(eq(products.storeId, storeId), eq(products.externalId, s.productExternalId))).limit(1);
      const vs = p ? await d.db.select({ availability: productVariants.availability }).from(productVariants).where(eq(productVariants.productId, p.id)) : [];
      cache.set(s.productExternalId, p && p.status === "active" && rollupAvailability(vs) === "in_stock" ? { title: p.title, url: p.url ?? (p.handle ? `/products/${p.handle}` : "/") } : null);
    }
    const info = cache.get(s.productExternalId);
    if (!info) continue;
    if (budget <= 0) { remaining++; continue; }
    // Claim the row first so a concurrent run cannot double-send.
    const claimed = await d.db.update(subscribers).set({ status: "notified", notifiedAt: d.now().toISOString() }).where(and(eq(subscribers.id, s.id), eq(subscribers.status, "confirmed"))).returning({ id: subscribers.id });
    if (!claimed[0]) continue;
    const productUrl = info.url.startsWith("http") ? info.url : `https://${store.domain}${info.url.startsWith("/") ? "" : "/"}${info.url}`;
    try {
      const unsub = apiLink(d, "/api/v1/notifications/unsubscribe", (await unsubscribeToken(d, s.id))!);
      await d.email!.send(templates.restockAvailable(s.email, store.name, info.title, productUrl, unsub));
      sent++; budget--;
    } catch (e) {
      await d.db.update(subscribers).set({ status: "confirmed", notifiedAt: null }).where(eq(subscribers.id, s.id)); // retry next run
      console.error(JSON.stringify({ level: "error", where: "restock_send", message: e instanceof Error ? e.message : "send failed" }));
    }
  }
  if (sent > 0) {
    await d.db.insert(usageRecords).values({ organizationId: store.organizationId, metric: "notifications", period, count: sent })
      .onConflictDoUpdate({ target: [usageRecords.organizationId, usageRecords.metric, usageRecords.period], set: { count: sql`${usageRecords.count} + ${sent}` } });
  }
  return { sent, remaining };
}
