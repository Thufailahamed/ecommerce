import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { KEY, makeEnv, signup, type Env } from "./helpers.js";

/**
 * WooCommerce against a fake store that follows the documented REST API v3 (products, variations, webhooks), the
 * /wc-auth/v1/authorize key delivery and the webhook signature format. A pass here says nothing about a live WordPress site
 * (see docs/woocommerce.md).
 */

const WEB = "https://app.example.com";
const API = "https://api.example.com";
const DOMAIN = "woo.example.com";
const secrets = { credentialKey: KEY, webOrigin: WEB, apiOrigin: API };
const CK = "ck_0123456789abcdef0123456789abcdef01234567";
const CS = "cs_0123456789abcdef0123456789abcdef01234567";
const enc = new TextEncoder();
const sign = async (secret: string, body: string) => {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(body)))));
};

interface Hook { id: number; topic: string; status: string; delivery_url: string; secret: string }

/** One WooCommerce site: keys with permissions, a catalog with variable products, and the webhooks apps create. */
class FakeWoo {
  keys = new Map<string, { secret: string; permissions: "read" | "read_write" }>([[CK, { secret: CS, permissions: "read_write" }]]);
  products: Record<string, unknown>[] = [];
  variations = new Map<number, Record<string, unknown>[]>();
  hooks: Hook[] = [];
  nextHookId = 100;
  /** Hosts that drop the Authorization header before PHP: only query-string keys get through. */
  stripsAuthHeader = false;
  calls: { method: string; url: string }[] = [];
  simple(n: number, over: Record<string, unknown> = {}) {
    return { id: n, name: `Item ${n}`, type: "simple", status: "publish", permalink: `https://${DOMAIN}/product/item-${n}/`, stock_status: "instock", price: "9.99", categories: [{ id: 3 }], ...over };
  }
  fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    this.calls.push({ method, url });
    const json = (status: number, j: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json", ...headers } });
    if (u.host !== DOMAIN || !u.pathname.startsWith("/wp-json/wc/v3/")) return json(404, { code: "rest_no_route" });
    const header = (init?.headers as Record<string, string> | undefined)?.["authorization"];
    let ck: string | null = null, cs: string | null = null;
    if (header && !this.stripsAuthHeader) [ck, cs] = atob(header.replace(/^Basic /, "")).split(":") as [string, string];
    else { ck = u.searchParams.get("consumer_key"); cs = u.searchParams.get("consumer_secret"); }
    const key = ck ? this.keys.get(ck) : undefined;
    if (!key || key.secret !== cs) return json(401, { code: "woocommerce_rest_cannot_view" });
    const path = u.pathname.slice("/wp-json/wc/v3".length);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET" && key.permissions === "read") return json(401, { code: "woocommerce_rest_cannot_create" });

    if (path === "/products" && method === "GET") {
      const per = Number(u.searchParams.get("per_page")), page = Number(u.searchParams.get("page") ?? 1);
      const rows = this.products.slice((page - 1) * per, page * per);
      return json(200, rows, { "x-wp-totalpages": String(Math.max(1, Math.ceil(this.products.length / per))) });
    }
    let m = /^\/products\/(\d+)\/variations$/.exec(path);
    if (m) return json(200, this.variations.get(Number(m[1])) ?? []);
    m = /^\/products\/(\d+)$/.exec(path);
    if (m) { const p = this.products.find((x) => x["id"] === Number(m![1])); return p ? json(200, p) : json(404, { code: "woocommerce_rest_product_invalid_id" }); }
    if (path === "/webhooks" && method === "GET") return json(200, this.hooks.map(({ secret: _s, ...h }) => h));
    if (path === "/webhooks" && method === "POST") {
      expect(body).toMatchObject({ status: "active", api_version: "wp_api_v3" });
      const h = { id: this.nextHookId++, topic: body.topic, status: "active", delivery_url: body.delivery_url, secret: body.secret };
      this.hooks.push(h);
      return json(201, { id: h.id, topic: h.topic, status: h.status, delivery_url: h.delivery_url });
    }
    m = /^\/webhooks\/(\d+)$/.exec(path);
    if (m && method === "DELETE") {
      const i = this.hooks.findIndex((h) => h.id === Number(m![1]));
      if (i < 0) return json(404, {});
      const [h] = this.hooks.splice(i, 1);
      return json(200, { id: h!.id });
    }
    return json(404, { code: "rest_no_route" });
  }) as unknown as typeof fetch;
  /** WooCommerce delivering one of the app's webhooks for `topic`, signed with the secret it was created with. */
  async deliver(env: Env, topic: string, payload: unknown, opts: { secret?: string; deliveryId?: string } = {}) {
    const h = this.hooks.find((x) => x.topic === topic);
    if (!h) throw new Error(`no webhook for ${topic}`);
    const raw = JSON.stringify(payload);
    return env.app.request(new URL(h.delivery_url).pathname, { method: "POST", body: raw, headers: {
      "content-type": "application/json", "x-wc-webhook-topic": topic, "x-wc-webhook-delivery-id": opts.deliveryId ?? crypto.randomUUID().replace(/-/g, ""),
      "x-wc-webhook-signature": await sign(opts.secret ?? h.secret, raw), "x-wc-webhook-source": `https://${DOMAIN}/`,
    } });
  }
}

async function world() {
  const woo = new FakeWoo();
  const env = await makeEnv(undefined, { secrets, fetchFn: woo.fetch });
  const u = await signup(env, "owner@example.com");
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "woocommerce", name: "Woo", domain: DOMAIN, currency: "USD" });
  return { env, woo, ...u, storeId: s.json.data.id as string, siteKey: s.json.data.siteKey as string };
}
type World = Awaited<ReturnType<typeof world>>;

/** The approval round trip: the dashboard asks for the link, WooCommerce posts the keys, the merchant lands back. */
async function approve(w: World, permissions: "read" | "read_write" = "read_write") {
  const r = await w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/authorize`);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const url = new URL(r.json.data.authorizeUrl);
  w.woo.keys.set(CK, { secret: CS, permissions });
  // Server to server: no cookie and no browser Origin header.
  const cb = await w.env.app.request("/api/v1/woocommerce/callback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key_id: 7, user_id: url.searchParams.get("user_id"), consumer_key: CK, consumer_secret: CS, key_permissions: permissions }) });
  expect(cb.status).toBe(200);
  const setup = await w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/setup`);
  expect(setup.status, JSON.stringify(setup.json)).toBe(200);
  return { url, setup: setup.json.data };
}

describe("WooCommerce connection", () => {
  it("sends the merchant to their own store's approval page with this app's callback and return URLs", async () => {
    const w = await world();
    const r = await w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/authorize`);
    const url = new URL(r.json.data.authorizeUrl);
    expect(url.origin + url.pathname).toBe(`https://${DOMAIN}/wc-auth/v1/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      app_name: "ConvertFlow", scope: "read_write", callback_url: `${API}/api/v1/woocommerce/callback`,
      return_url: `${WEB}/app/settings?woocommerce=returned&store=${w.storeId}`,
    });
    expect(url.searchParams.get("user_id")).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const outsider = await signup(w.env, "x@example.com");
    expect((await outsider.c.post(`/api/v1/stores/${w.storeId}/woocommerce/authorize`)).status).toBe(404);
    const bare = await makeEnv();
    const b = await signup(bare, "b@example.com");
    const s = await b.c.post("/api/v1/stores", { organizationId: b.orgId, platform: "woocommerce", name: "W", domain: DOMAIN, currency: "USD" });
    expect((await b.c.post(`/api/v1/stores/${s.json.data.id}/woocommerce/authorize`)).status).toBe(503);
  });

  it("approved keys are stored encrypted, checked against the store, and the webhooks are created; nothing secret is ever returned", async () => {
    const w = await world();
    const { setup } = await approve(w);
    expect(setup).toMatchObject({ connected: true, method: "authorize", keyPermissions: "read_write", verifiedAt: expect.any(String), webhooks: { state: "active", count: 6, error: null } });
    expect(w.woo.hooks.map((h) => h.topic).sort()).toEqual(["order.created", "order.updated", "product.created", "product.deleted", "product.restored", "product.updated"]);
    const [conn] = await w.env.deps.db.select().from(schema.woocommerceConnections);
    expect(new Set(w.woo.hooks.map((h) => h.delivery_url))).toEqual(new Set([`${API}/api/v1/webhooks/woocommerce/${w.storeId}?c=${conn!.id}`]));
    expect(new Set(w.woo.hooks.map((h) => h.secret)).size).toBe(1);
    const secret = w.woo.hooks[0]!.secret;
    for (const p of [`/api/v1/stores/${w.storeId}/woocommerce`, `/api/v1/stores/${w.storeId}/integration`, `/api/v1/stores/${w.storeId}/integrations`, `/api/v1/stores/${w.storeId}/audit`]) {
      const body = JSON.stringify((await w.c.get(p)).json);
      for (const s of [CK, CS, secret]) expect(body, p).not.toContain(s);
    }
    const rows = JSON.stringify([...await w.env.deps.db.select().from(schema.integrationCredentials), ...await w.env.deps.db.select().from(schema.woocommerceConnections)]);
    for (const s of [CS, secret]) expect(rows).not.toContain(s);
    // Requests only ever went to the store's own domain.
    for (const c of w.woo.calls) expect(new URL(c.url).host).toBe(DOMAIN);
    // Setup again is a no-op at the store.
    await w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/setup`);
    expect(w.woo.hooks).toHaveLength(6);
  });

  it("a key delivery needs the single-use state from an approval this app started, for a store the merchant still manages", async () => {
    const w = await world();
    const post = (b: unknown) => w.env.app.request("/api/v1/woocommerce/callback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const keys = { consumer_key: CK, consumer_secret: CS, key_permissions: "read_write" };
    expect((await post({ ...keys, user_id: "x".repeat(32) })).status).toBe(404);
    expect((await post({ user_id: "x".repeat(32), consumer_key: "nope", consumer_secret: CS, key_permissions: "read_write" })).status).toBe(400);
    const url = new URL((await w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/authorize`)).json.data.authorizeUrl);
    const nonce = url.searchParams.get("user_id")!;
    expect((await post({ ...keys, user_id: nonce })).status).toBe(200);
    expect((await post({ ...keys, user_id: nonce })).status).toBe(404); // replay
    // A merchant removed from the workspace between starting and finishing cannot connect the store.
    const w2 = await world();
    const nonce2 = new URL((await w2.c.post(`/api/v1/stores/${w2.storeId}/woocommerce/authorize`)).json.data.authorizeUrl).searchParams.get("user_id")!;
    await w2.env.deps.db.delete(schema.memberships).where(eq(schema.memberships.userId, w2.userId));
    const r = await w2.env.app.request("/api/v1/woocommerce/callback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...keys, user_id: nonce2 }) });
    expect(r.status).toBe(404);
    expect(await w2.env.deps.db.select().from(schema.integrationCredentials)).toHaveLength(0);
  });

  it("read-only keys still sync, and the status says webhooks are off", async () => {
    const w = await world();
    w.woo.products = [w.woo.simple(1)];
    const { setup } = await approve(w, "read");
    expect(setup.webhooks).toMatchObject({ state: "read_only", count: 0 });
    expect((await w.c.post(`/api/v1/stores/${w.storeId}/integration/sync`, { page: 1 })).json.data).toMatchObject({ imported: 1, nextPage: null });
    const reg = (await w.c.get(`/api/v1/stores/${w.storeId}/integrations`)).json.data.find((x: { key: string }) => x.key === "woocommerce");
    expect(reg.status).toMatchObject({ state: "connected", lastError: expect.stringMatching(/read-only/) });
  });

  it("repair recreates a webhook WooCommerce disabled and removes ones made with an old secret, and duplicates", async () => {
    const w = await world();
    await approve(w);
    const current = w.woo.hooks[0]!.delivery_url;
    w.woo.hooks.push({ id: 997, topic: "order.created", status: "active", delivery_url: current, secret: w.woo.hooks[0]!.secret }); // a concurrent run's duplicate
    w.woo.hooks[0]!.status = "disabled"; // WooCommerce disables a webhook after repeated failed deliveries
    w.woo.hooks.push({ id: 999, topic: "product.updated", status: "active", delivery_url: `${API}/api/v1/webhooks/woocommerce/${w.storeId}`, secret: "old" });
    w.woo.hooks.push({ id: 998, topic: "product.updated", status: "active", delivery_url: "https://someone-else.example/hook", secret: "theirs" });
    const health = await w.c.post(`/api/v1/stores/${w.storeId}/integrations/woocommerce/health`);
    expect(health.json.data).toMatchObject({ ok: false, detail: expect.stringMatching(/disabled/) });
    const r = await w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/setup`);
    expect(r.json.data.webhooks).toMatchObject({ state: "active", count: 6 });
    expect(w.woo.hooks.filter((h) => h.delivery_url.startsWith(API))).toHaveLength(6);
    expect(w.woo.hooks.find((h) => h.id === 999 || h.id === 997)).toBeUndefined();
    expect(w.woo.hooks.every((h) => h.status === "active")).toBe(true);
    expect(w.woo.hooks.find((h) => h.id === 998)).toBeTruthy(); // never touches another app's webhook
    expect((await w.c.post(`/api/v1/stores/${w.storeId}/integrations/woocommerce/health`)).json.data.ok).toBe(true);
  });

  it("keys pasted by hand are checked first, and get webhooks when they can write", async () => {
    const w = await world();
    const bad = await w.c.post(`/api/v1/stores/${w.storeId}/integration/connect`, { kind: "woocommerce", consumerKey: CK, consumerSecret: "cs_wrongwrongwrong" });
    expect([bad.status, bad.json.error.code]).toEqual([422, "credentials_rejected"]);
    expect(await w.env.deps.db.select().from(schema.integrationCredentials)).toHaveLength(0);
    await w.c.post(`/api/v1/stores/${w.storeId}/integration/connect`, { kind: "woocommerce", consumerKey: CK, consumerSecret: CS });
    expect((await w.c.get(`/api/v1/stores/${w.storeId}/woocommerce`)).json.data).toMatchObject({ connected: true, method: "manual", webhooks: { state: "active", count: 6 } });
  });

  it("falls back to query-string keys on hosts that drop the Authorization header", async () => {
    const w = await world();
    w.woo.stripsAuthHeader = true;
    w.woo.products = [w.woo.simple(1)];
    await approve(w);
    expect((await w.c.post(`/api/v1/stores/${w.storeId}/integration/sync`, { page: 1 })).json.data.imported).toBe(1);
  });

  it("disconnecting WooCommerce deletes the webhooks at the store and the keys, and keeps the store and catalog", async () => {
    const w = await world();
    w.woo.products = [w.woo.simple(1)];
    await approve(w);
    await w.c.post(`/api/v1/stores/${w.storeId}/integration/sync`, { page: 1 });
    const hookUrl = new URL(w.woo.hooks[0]!.delivery_url).pathname;
    // One the app did not record (left by an earlier, interrupted run) goes too.
    w.woo.hooks.push({ id: 996, topic: "product.updated", status: "active", delivery_url: `${API}/api/v1/webhooks/woocommerce/${w.storeId}?c=woc_old`, secret: "x" });
    expect((await w.c.del(`/api/v1/stores/${w.storeId}/woocommerce`)).status).toBe(204);
    expect(w.woo.hooks).toHaveLength(0);
    expect(await w.env.deps.db.select().from(schema.integrationCredentials)).toHaveLength(0);
    expect(await w.env.deps.db.select().from(schema.products)).toHaveLength(1);
    expect((await w.c.get(`/api/v1/stores/${w.storeId}/woocommerce`)).json.data).toMatchObject({ connected: false });
    // A delivery that was already in flight is refused, so WooCommerce stops sending.
    expect((await w.env.app.request(hookUrl, { method: "POST", body: "{}" })).status).toBe(404);
    // Disconnecting the whole store does the same.
    const w2 = await world();
    await approve(w2);
    expect((await w2.c.del(`/api/v1/stores/${w2.storeId}`)).status).toBe(204);
    expect(w2.woo.hooks).toHaveLength(0);
  });
});

describe("WooCommerce catalog", () => {
  it("pages with WooCommerce's total-pages header and imports variable products with their variations", async () => {
    const w = await world();
    w.woo.products = Array.from({ length: 30 }, (_, i) => w.woo.simple(i + 1));
    w.woo.products.push({ ...w.woo.simple(31), type: "variable", price: "" });
    w.woo.variations.set(31, [
      { id: 311, status: "publish", price: "20", stock_status: "instock", attributes: [{ name: "Size", option: "S" }] },
      { id: 312, status: "publish", price: "22", stock_status: "outofstock", attributes: [{ name: "Size", option: "M" }] },
    ]);
    await approve(w);
    const p1 = await w.c.post(`/api/v1/stores/${w.storeId}/integration/sync`, { page: 1 });
    expect(p1.json.data).toMatchObject({ imported: 25, nextPage: 2 });
    const p2 = await w.c.post(`/api/v1/stores/${w.storeId}/integration/sync`, { page: 2 });
    expect(p2.json.data).toMatchObject({ imported: 6, nextPage: null });
    const [tee] = await w.env.deps.db.select().from(schema.products).where(eq(schema.products.externalId, "31"));
    const vs = await w.env.deps.db.select().from(schema.productVariants).where(eq(schema.productVariants.productId, tee!.id));
    expect(vs.map((v) => [v.externalId, v.title, v.price, v.availability]).sort()).toEqual([["311", "S", 20, "in_stock"], ["312", "M", 22, "out_of_stock"]]);
  });
});

describe("WooCommerce webhooks", () => {
  it("applies signed product changes once, and refuses unsigned, forged and cross-store deliveries", async () => {
    const w = await world();
    w.woo.products = [w.woo.simple(1)];
    await approve(w);
    await w.c.post(`/api/v1/stores/${w.storeId}/integration/sync`, { page: 1 });
    const title = async () => (await w.env.deps.db.select().from(schema.products).where(eq(schema.products.externalId, "1")))[0]!.title;
    const r = await w.woo.deliver(w.env, "product.updated", w.woo.simple(1, { name: "Renamed" }), { deliveryId: "d1" });
    expect(await r.json()).toMatchObject({ outcome: "processed" });
    expect(await title()).toBe("Renamed");
    expect(await (await w.woo.deliver(w.env, "product.updated", w.woo.simple(1, { name: "Renamed" }), { deliveryId: "d1" })).json()).toMatchObject({ outcome: "duplicate" });
    // Same delivery id, different change in the same second: still applied.
    await w.woo.deliver(w.env, "product.updated", w.woo.simple(1, { name: "Again" }), { deliveryId: "d1" });
    expect(await title()).toBe("Again");
    expect((await w.woo.deliver(w.env, "product.updated", w.woo.simple(1, { name: "Forged" }), { secret: "guess" })).status).toBe(401);
    expect(await title()).toBe("Again");
    // Another store's secret does not work on this store's URL.
    const other = await world();
    await approve(other);
    const raw = JSON.stringify(w.woo.simple(1, { name: "Cross" }));
    const cross = await w.env.app.request(`/api/v1/webhooks/woocommerce/${w.storeId}`, { method: "POST", body: raw, headers: { "x-wc-webhook-topic": "product.updated", "x-wc-webhook-delivery-id": "x", "x-wc-webhook-signature": await sign(other.woo.hooks[0]!.secret, raw) } });
    expect(cross.status).toBe(401);
    // WooCommerce's save-time ping is unsigned and answered without doing anything.
    const ping = await w.env.app.request(`/api/v1/webhooks/woocommerce/${w.storeId}`, { method: "POST", body: "webhook_id=101", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(await ping.json()).toMatchObject({ outcome: "ping" });
    expect((await w.env.app.request(`/api/v1/webhooks/woocommerce/sto_nope`, { method: "POST", body: "webhook_id=1" })).status).toBe(404);
  });

  it("a variable product is re-read with its variations; a deleted product is archived", async () => {
    const w = await world();
    const tee = { ...w.woo.simple(5), type: "variable", price: "" };
    w.woo.products = [tee];
    w.woo.variations.set(5, [{ id: 51, status: "publish", price: "10", stock_status: "outofstock", attributes: [{ name: "Size", option: "L" }] }]);
    await approve(w);
    await w.c.post(`/api/v1/stores/${w.storeId}/integration/sync`, { page: 1 });
    w.woo.variations.set(5, [{ id: 51, status: "publish", price: "10", stock_status: "instock", attributes: [{ name: "Size", option: "L" }] }]);
    await w.woo.deliver(w.env, "product.updated", { ...tee, variations: [51] }); // the payload has no variation stock
    const [v] = await w.env.deps.db.select().from(schema.productVariants).where(eq(schema.productVariants.externalId, "51"));
    expect(v!.availability).toBe("in_stock");
    const events = await w.env.deps.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.type, "catalog.products_changed"));
    expect(events.some((e) => e.source === "woocommerce_webhook" && (e.payload as { restockedExternalIds: string[] }).restockedExternalIds.includes("5"))).toBe(true);
    await w.woo.deliver(w.env, "product.deleted", { id: 5 });
    expect((await w.env.deps.db.select().from(schema.products).where(eq(schema.products.externalId, "5")))[0]!.status).toBe("archived");
  });

  it("an order becomes one conversion keyed like the plugin's purchase report, whatever order of created/updated/browser", async () => {
    const w = await world();
    await approve(w);
    const order = { id: 1201, status: "checkout-draft", total: "59.90", currency: "USD", date_created_gmt: "2026-10-27T10:00:00", billing: { email: "shopper@example.com" } };
    await w.woo.deliver(w.env, "order.created", order); // block checkout draft: not a purchase yet
    expect(await w.env.deps.db.select().from(schema.conversions)).toHaveLength(0);
    await w.woo.deliver(w.env, "order.updated", { ...order, status: "processing" });
    await w.woo.deliver(w.env, "order.updated", { ...order, status: "completed" });
    const conv = await w.env.deps.db.select().from(schema.conversions).where(eq(schema.conversions.storeId, w.storeId));
    expect(conv).toHaveLength(1);
    expect(conv[0]).toMatchObject({ orderId: "woocommerce:1201", total: 59.9, currency: "USD", occurredAt: "2026-10-27T10:00:00.000Z" });
    const evs = await w.env.deps.db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.type, "order.created"), eq(schema.domainEvents.storeId, w.storeId)));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.source).toBe("woocommerce_webhook");
    expect(JSON.stringify(evs[0]!.payload)).not.toContain("shopper@example.com");
    // The plugin's browser report for the same order adds nothing.
    await w.env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true, events: [{ eventId: "evt_px_1201", type: "purchase_observed", siteId: w.siteKey, sessionId: "sess_12345678", occurredAt: "2026-10-27T10:01:00.000Z", schemaVersion: 1, order: { orderId: "woocommerce:1201", total: 59.9, currency: "USD" } }] }) });
    expect(await w.env.deps.db.select().from(schema.conversions).where(eq(schema.conversions.storeId, w.storeId))).toHaveLength(1);
  });
});

describe("WooCommerce setup run twice at once", () => {
  it("converges on one webhook per topic, and disconnect leaves none behind", async () => {
    const w = await world();
    await approve(w);
    w.woo.hooks = []; // as if nothing had been created yet
    await Promise.all([w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/setup`), w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/setup`)]);
    await w.c.post(`/api/v1/stores/${w.storeId}/woocommerce/setup`); // the next pass removes any duplicates
    expect(w.woo.hooks.map((h) => h.topic).sort()).toEqual([...new Set(w.woo.hooks.map((h) => h.topic))].sort());
    expect(w.woo.hooks).toHaveLength(6);
    await w.c.del(`/api/v1/stores/${w.storeId}/woocommerce`);
    expect(w.woo.hooks).toHaveLength(0);
  });
});
