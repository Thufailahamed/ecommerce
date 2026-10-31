import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { KEY, makeEnv, setPlan, signup, validConfig, type Env } from "./helpers.js";

/**
 * The Shopify app against a fake Shopify that follows the documented OAuth and Admin GraphQL shapes. A pass here says the
 * app does what it should with those shapes; it says nothing about the live Shopify API (see docs/shopify.md).
 */

const SECRET = "shpss_test_secret";
const API_KEY = "client_123";
const WEB = "https://app.example.com";
const API = "https://api.example.com";
const SHOP = "ember-oak.myshopify.com";
const SCOPES = "read_products,read_inventory,read_orders,read_themes,write_pixels,read_customer_events";
const secrets = { credentialKey: KEY, webOrigin: WEB, apiOrigin: API, shopifyApiKey: API_KEY, shopifyApiSecret: SECRET };
const enc = new TextEncoder();
const hex = async (msg: string) => {
  const k = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg))), (b) => b.toString(16).padStart(2, "0")).join("");
};
const b64 = async (msg: string) => {
  const k = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)))));
};

interface Charge { id: string; name: string; status: string; test: boolean; trialDays: number; createdAt: string; currentPeriodEnd: string | null }
type Product = { legacyResourceId: string; title: string; handle: string | null; status: string; onlineStoreUrl: string | null; featuredMedia: unknown; collections: { nodes: { legacyResourceId: string }[] }; variants: { pageInfo: { hasNextPage: boolean }; nodes: { legacyResourceId: string; title: string | null; price: string | null; availableForSale: boolean }[] } };

/** A stateful stand-in for one or more shops: issues codes and tokens, serves products, holds app subscriptions. */
class FakeShopify {
  codes = new Map<string, { shop: string; scope: string }>();
  tokens = new Map<string, string>(); // shop -> token
  products: Product[] = [];
  charges = new Map<string, Charge>();
  shopInfo = { name: "Ember & Oak", currencyCode: "EUR", primaryDomain: { host: "emberandoak.example" } };
  calls: { url: string; body: unknown; token?: string }[] = [];
  pixels = new Map<string, { id: string; settings: string }>(); // shop -> the app pixel
  metafields = new Map<string, Record<string, string>>(); // shop -> app-data metafields
  themeSettings: string | null = null; // config/settings_data.json of the live theme
  refuse = new Set<string>(); // mutations to answer with a userError
  next: { status?: number; gqlError?: string } | undefined;
  approve(shop: string, scope = SCOPES) { const code = `code_${this.codes.size + 1}`; this.codes.set(code, { shop, scope }); return code; }
  product(n: number, over: Partial<Product> = {}): Product {
    return { legacyResourceId: String(1000 + n), title: `Product ${n}`, handle: `product-${n}`, status: "ACTIVE", onlineStoreUrl: null, featuredMedia: { preview: { image: { url: `https://cdn.shopify.com/p${n}.jpg` } } },
      collections: { nodes: [{ legacyResourceId: "77" }] }, variants: { pageInfo: { hasNextPage: false }, nodes: [{ legacyResourceId: String(5000 + n), title: "Default", price: "19.50", availableForSale: true }] }, ...over };
  }
  fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const token = (init?.headers as Record<string, string> | undefined)?.["x-shopify-access-token"];
    this.calls.push({ url, body, ...(token ? { token } : {}) });
    const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
    const shop = u.hostname;
    if (u.pathname === "/admin/oauth/access_token") {
      const c = this.codes.get(body.code);
      if (!c || c.shop !== shop || body.client_id !== API_KEY || body.client_secret !== SECRET) return json(400, { error: "invalid_request" });
      this.codes.delete(body.code);
      const t = `shpat_${shop}_${this.tokens.size + 1}`;
      this.tokens.set(shop, t);
      return json(200, { access_token: t, scope: c.scope });
    }
    if (u.pathname === "/admin/api_permissions/current.json" && init?.method === "DELETE") {
      if (!token || this.tokens.get(shop) !== token) return json(401, {});
      this.tokens.delete(shop);
      return json(200, {});
    }
    if (u.pathname !== "/admin/api/2026-10/graphql.json") return json(404, {});
    if (this.next) { const n = this.next; this.next = undefined; if (n.status) return json(n.status, {}); return json(200, { errors: [{ message: "x", extensions: { code: n.gqlError } }] }); }
    if (!token || this.tokens.get(shop) !== token) return json(401, { errors: "[API] Invalid API key or access token" });
    const q: string = body.query, v = body.variables ?? {};
    if (q.includes("products(")) {
      const start = v.after ? Number(v.after) : 0;
      const page = this.products.slice(start, start + 10);
      const more = start + 10 < this.products.length;
      return json(200, { data: { products: { pageInfo: { hasNextPage: more, endCursor: more ? String(start + 10) : null }, nodes: page } } });
    }
    if (q.includes("webPixelCreate")) {
      if (this.refuse.has("webPixelCreate")) return json(200, { data: { webPixelCreate: { userErrors: [{ code: "INVALID", field: ["settings"], message: "x" }], webPixel: null } } });
      if (this.pixels.has(shop)) return json(200, { data: { webPixelCreate: { userErrors: [{ code: "TAKEN", field: [], message: "taken" }], webPixel: null } } });
      const p = { id: `gid://shopify/WebPixel/${this.pixels.size + 1}`, settings: v.settings };
      this.pixels.set(shop, p);
      return json(200, { data: { webPixelCreate: { userErrors: [], webPixel: { id: p.id } } } });
    }
    if (q.includes("webPixelUpdate")) {
      const p = this.pixels.get(shop);
      if (!p || p.id !== v.id) return json(200, { data: { webPixelUpdate: { userErrors: [{ code: "NOT_FOUND", field: ["id"], message: "x" }], webPixel: null } } });
      p.settings = v.settings;
      return json(200, { data: { webPixelUpdate: { userErrors: [], webPixel: { id: p.id } } } });
    }
    if (q.includes("webPixel {")) return json(200, { data: { webPixel: this.pixels.get(shop) ? { id: this.pixels.get(shop)!.id } : null } });
    if (q.includes("currentAppInstallation")) return json(200, { data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
    if (q.includes("metafieldsSet")) {
      const m = this.metafields.get(shop) ?? {};
      for (const x of v.metafields) { expect(x).toMatchObject({ ownerId: "gid://shopify/AppInstallation/1", namespace: "convertflow", type: "single_line_text_field" }); m[x.key] = x.value; }
      this.metafields.set(shop, m);
      return json(200, { data: { metafieldsSet: { userErrors: [], metafields: v.metafields.map((x: { key: string }) => ({ key: x.key })) } } });
    }
    if (q.includes("themes(")) return json(200, { data: { themes: { nodes: [{ name: "Dawn", files: { nodes: this.themeSettings === null ? [] : [{ body: { content: this.themeSettings } }] } }] } } });
    if (q.includes("inventoryItem(")) {
      // In this fake an inventory item id is its variant id.
      const variantId = String(v.id).split("/").pop();
      const product = this.products.find((p) => p.variants.nodes.some((x) => x.legacyResourceId === variantId));
      return json(200, { data: { inventoryItem: product ? { variant: { product } } : null } });
    }
    if (q.includes("primaryDomain")) return json(200, { data: { shop: this.shopInfo } });
    if (q.includes("shop { name }")) return json(200, { data: { shop: { name: this.shopInfo.name } } });
    if (q.includes("appSubscriptionCreate")) {
      const id = `gid://shopify/AppSubscription/${900 + this.charges.size}`;
      this.charges.set(id, { id, name: v.name, status: "PENDING", test: v.test, trialDays: v.trialDays ?? 0, createdAt: "2026-10-27T12:00:00.000Z", currentPeriodEnd: null });
      return json(200, { data: { appSubscriptionCreate: { userErrors: [], confirmationUrl: `https://${shop}/admin/charges/1/${id.split("/").pop()}/RecurringApplicationCharge/confirm`, appSubscription: { id, status: "PENDING" } } } });
    }
    if (q.includes("node(id:")) return json(200, { data: { node: this.charges.get(v.id) ?? null } });
    if (q.includes("appSubscriptionCancel")) {
      const c = this.charges.get(v.id);
      if (c) c.status = "CANCELLED";
      return json(200, { data: { appSubscriptionCancel: { userErrors: [], appSubscription: c ? { id: c.id, status: "CANCELLED" } : null } } });
    }
    return json(200, { errors: [{ message: "unknown", extensions: { code: "UNKNOWN" } }] });
  }) as unknown as typeof fetch;
}

async function world(extra: Record<string, unknown> = {}) {
  const shopify = new FakeShopify();
  const env = await makeEnv(undefined, { secrets: { ...secrets, ...extra }, fetchFn: shopify.fetch });
  return { env, shopify };
}
const signed = async (env: Env, q: Record<string, string>) => {
  const p = { timestamp: String(Math.floor(env.clock.t / 1000)), ...q };
  const s = new URLSearchParams(); for (const k of Object.keys(p).sort()) s.append(k, p[k as keyof typeof p]!);
  return `${s.toString()}&hmac=${await hex(s.toString())}`;
};
const get = (env: Env, path: string, cookie?: string) => env.app.request(path, { headers: cookie ? { cookie } : {} });
const location = (r: Response) => r.headers.get("location") ?? "";
const hook = async (env: Env, topic: string, shop: string, body: unknown, id = crypto.randomUUID()) => {
  const raw = JSON.stringify(body);
  return env.app.request("/api/v1/webhooks/shopify", { method: "POST", headers: { "x-shopify-hmac-sha256": await b64(raw), "x-shopify-topic": topic, "x-shopify-shop-domain": shop, "x-shopify-webhook-id": id, "content-type": "application/json" }, body: raw });
};
/** A merchant with a Shopify store, connected from the dashboard. */
async function connected(w: Awaited<ReturnType<typeof world>>, email = "owner@example.com", shop = SHOP) {
  const u = await signup(w.env, email);
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "shopify", name: "Ember", domain: shop, currency: "EUR" });
  const storeId = s.json.data.id as string;
  const r = await u.c.post(`/api/v1/stores/${storeId}/shopify/connect`, { shop });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const state = new URL(r.json.data.authorizeUrl).searchParams.get("state")!;
  const cb = await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve(shop), shop, state, host: "aG9zdA" })}`, u.c.cookie);
  expect(location(cb).startsWith(`${WEB}/app/settings?shopify=connected&store=sto_`), location(cb)).toBe(true);
  return { ...u, storeId, siteKey: s.json.data.siteKey as string, state };
}

describe("Shopify install from the dashboard", () => {
  it("sends the merchant to their own shop's authorization page with the app's client id, scopes and callback", async () => {
    const w = await world();
    const u = await signup(w.env, "o@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "shopify", name: "E", domain: SHOP, currency: "USD" });
    const r = await u.c.post(`/api/v1/stores/${s.json.data.id}/shopify/connect`, { shop: "https://Ember-Oak.myshopify.com/admin" });
    const url = new URL(r.json.data.authorizeUrl);
    expect(url.origin + url.pathname).toBe(`https://${SHOP}/admin/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: API_KEY, scope: SCOPES, redirect_uri: `${API}/api/v1/shopify/callback` });
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32}$/);
    for (const bad of ["evil.com", "ember-oak.myshopify.com.evil.com", "shop.myshopify.co", "../x.myshopify.com"]) {
      expect((await u.c.post(`/api/v1/stores/${s.json.data.id}/shopify/connect`, { shop: bad })).status, bad).toBe(422);
    }
  });

  it("links the shop, stores the token encrypted and never returns it", async () => {
    const w = await world();
    const m = await connected(w);
    const [store] = await w.env.deps.db.select().from(schema.stores).where(eq(schema.stores.id, m.storeId));
    expect(store).toMatchObject({ externalId: SHOP, status: "active" });
    const [cred] = await w.env.deps.db.select().from(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, m.storeId));
    expect(cred!.encryptedAccessToken).not.toContain("shpat_");
    const status = await m.c.get(`/api/v1/stores/${m.storeId}/shopify`);
    expect(status.json.data).toMatchObject({ configured: true, shop: SHOP, status: "installed", connected: true, scopes: SCOPES.split(","), missingScopes: [] });
    for (const path of [`/api/v1/stores/${m.storeId}/shopify`, `/api/v1/stores/${m.storeId}/integration`, `/api/v1/stores/${m.storeId}/integrations`, `/api/v1/stores/${m.storeId}/audit`]) {
      expect(JSON.stringify((await m.c.get(path)).json), path).not.toContain("shpat_");
    }
    const audit = await w.env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "shopify.installed"));
    expect(audit).toHaveLength(1);
  });

  it("refuses a forged, stale or replayed callback, and one finished by a different signed-in user", async () => {
    const w = await world();
    const u = await signup(w.env, "a@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "shopify", name: "E", domain: SHOP, currency: "USD" });
    const start = async () => new URL((await u.c.post(`/api/v1/stores/${s.json.data.id}/shopify/connect`, { shop: SHOP })).json.data.authorizeUrl).searchParams.get("state")!;
    const err = (r: Response) => new URL(location(r)).searchParams.get("error");

    let state = await start();
    const forged = (await signed(w.env, { code: w.shopify.approve(SHOP), shop: SHOP, state })).replace(/hmac=[0-9a-f]+/, `hmac=${"0".repeat(64)}`);
    expect(err(await get(w.env, `/api/v1/shopify/callback?${forged}`, u.c.cookie))).toBe("invalid_signature");
    const stale = await signed(w.env, { code: w.shopify.approve(SHOP), shop: SHOP, state, timestamp: String(Math.floor(w.env.clock.t / 1000) - 7200) });
    expect(err(await get(w.env, `/api/v1/shopify/callback?${stale}`, u.c.cookie))).toBe("invalid_signature");

    const intruder = await signup(w.env, "intruder@example.com");
    state = await start();
    expect(err(await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve(SHOP), shop: SHOP, state })}`, intruder.c.cookie))).toBe("signed_out");
    expect(err(await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve(SHOP), shop: SHOP, state })}`, u.c.cookie))).toBe("expired"); // the state was spent

    state = await start();
    expect(err(await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve("other.myshopify.com"), shop: "other.myshopify.com", state })}`, u.c.cookie))).toBe("shop_mismatch");
    state = await start();
    expect(err(await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve(SHOP, "read_products"), shop: SHOP, state })}`, u.c.cookie))).toBe("missing_scopes");

    expect(await w.env.deps.db.select().from(schema.integrationCredentials)).toHaveLength(0);
    expect(await w.env.deps.db.select().from(schema.shopifyInstallations)).toHaveLength(0);
  });

  it("typing another merchant's shop domain claims nothing: no webhooks arrive and the real owner can still install", async () => {
    const w = await world();
    const squatter = await signup(w.env, "squatter@example.com");
    const fake = await squatter.c.post("/api/v1/stores", { organizationId: squatter.orgId, platform: "shopify", name: "Not mine", domain: SHOP, currency: "USD" });
    const [row] = await w.env.deps.db.select().from(schema.stores).where(eq(schema.stores.id, fake.json.data.id));
    expect(row!.externalId).toBeNull();
    await hook(w.env, "products/create", SHOP, { id: 1, title: "Secret product", status: "active", variants: [] });
    expect(await w.env.deps.db.select().from(schema.products)).toHaveLength(0);

    const owner = await connected(w, "owner@example.com");
    await hook(w.env, "products/create", SHOP, { id: 2, title: "Real product", status: "active", variants: [] });
    const products = await w.env.deps.db.select({ storeId: schema.products.storeId }).from(schema.products);
    expect(products).toEqual([{ storeId: owner.storeId }]);
  });

  it("is admin-only and tenant-scoped", async () => {
    const w = await world();
    const m = await connected(w);
    const other = await signup(w.env, "other@example.com");
    expect((await other.c.post(`/api/v1/stores/${m.storeId}/shopify/connect`, { shop: SHOP })).status).toBe(404);
    expect((await other.c.get(`/api/v1/stores/${m.storeId}/shopify`)).status).toBe(404);
    expect((await other.c.post(`/api/v1/stores/${m.storeId}/integration/sync`, { cursor: null })).status).toBe(404);
  });

  it("answers 503 on a deployment that is not set up as a Shopify app", async () => {
    const env = await makeEnv(undefined, { secrets: { credentialKey: KEY } });
    const u = await signup(env, "o@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "shopify", name: "E", domain: SHOP, currency: "USD" });
    expect((await u.c.post(`/api/v1/stores/${s.json.data.id}/shopify/connect`, { shop: SHOP })).status).toBe(503);
    expect((await env.app.request(`/api/v1/shopify/install?shop=${SHOP}`)).status).toBe(503);
  });
});

describe("Shopify install from the Shopify admin, then claimed by a workspace", () => {
  async function installFromShopify(w: Awaited<ReturnType<typeof world>>, shop = SHOP) {
    const launch = await get(w.env, `/api/v1/shopify/install?${await signed(w.env, { shop })}`);
    expect(launch.status).toBe(302);
    const auth = new URL(location(launch));
    expect(auth.hostname).toBe(shop);
    const cb = await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve(shop), shop, state: auth.searchParams.get("state")! })}`);
    const claim = new URL(location(cb)).searchParams.get("claim");
    expect(claim, location(cb)).toBeTruthy();
    return claim!;
  }

  it("creates the store from what Shopify says about the shop, links it, and the claim link works once", async () => {
    const w = await world();
    const token = await installFromShopify(w);
    const [pending] = await w.env.deps.db.select().from(schema.shopifyInstallations);
    expect(pending).toMatchObject({ shop: SHOP, status: "pending", storeId: null });
    expect(pending!.encryptedPendingToken).not.toContain("shpat_");

    const u = await signup(w.env, "owner@example.com");
    expect((await u.c.get(`/api/v1/shopify/claim?token=${token}`)).json.data.shop).toBe(SHOP);
    const r = await u.c.post("/api/v1/shopify/claim", { token, organizationId: u.orgId });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.data.created).toBe(true);
    const [store] = await w.env.deps.db.select().from(schema.stores).where(eq(schema.stores.id, r.json.data.storeId));
    expect(store).toMatchObject({ name: "Ember & Oak", currency: "EUR", domain: "emberandoak.example", externalId: SHOP, platform: "shopify", organizationId: u.orgId });
    const [inst] = await w.env.deps.db.select().from(schema.shopifyInstallations);
    expect(inst).toMatchObject({ status: "installed", storeId: store!.id, encryptedPendingToken: null, claimTokenHash: null });
    expect((await u.c.post("/api/v1/shopify/claim", { token, organizationId: u.orgId })).status).toBe(404);

    // Opening the app from the Shopify admin again goes straight to the dashboard.
    const again = await get(w.env, `/api/v1/shopify/install?${await signed(w.env, { shop: SHOP })}`);
    expect(location(again)).toBe(`${WEB}/app?store=${encodeURIComponent(store!.id)}`);
    expect((await get(w.env, `/api/v1/shopify/install?shop=${SHOP}&timestamp=1&hmac=${"a".repeat(64)}`)).status).toBe(401);
  });

  it("expires an unclaimed install, refuses a shop active in another workspace, and respects the store limit", async () => {
    const w = await world();
    const stale = await installFromShopify(w);
    w.env.clock.t += 31 * 60_000;
    const u = await signup(w.env, "late@example.com");
    expect((await u.c.post("/api/v1/shopify/claim", { token: stale, organizationId: u.orgId })).status).toBe(404);

    const first = await signup(w.env, "first@example.com");
    expect((await first.c.post("/api/v1/shopify/claim", { token: await installFromShopify(w), organizationId: first.orgId })).status).toBe(201);
    // Another workspace tries to connect the same, still-installed shop from its own dashboard: refused, nothing moves.
    const second = await signup(w.env, "second@example.com");
    const s2 = await second.c.post("/api/v1/stores", { organizationId: second.orgId, platform: "shopify", name: "Copy", domain: "copy.example.com", currency: "USD" });
    const state = new URL((await second.c.post(`/api/v1/stores/${s2.json.data.id}/shopify/connect`, { shop: SHOP })).json.data.authorizeUrl).searchParams.get("state")!;
    const cb = await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve(SHOP), shop: SHOP, state })}`, second.c.cookie);
    expect(new URL(location(cb)).searchParams.get("error")).toBe("shop_in_use");
    const owners = await w.env.deps.db.select({ org: schema.stores.organizationId }).from(schema.stores).where(eq(schema.stores.externalId, SHOP));
    expect(owners).toEqual([{ org: first.orgId }]);
    // Opening the app from the Shopify admin for an installed shop goes to the dashboard, never to a new claim.
    expect(new URL(location(await get(w.env, `/api/v1/shopify/install?${await signed(w.env, { shop: SHOP })}`))).pathname).toBe("/app");

    const full = await signup(w.env, "full@example.com");
    await full.c.post("/api/v1/stores", { organizationId: full.orgId, platform: "custom", name: "Mine", domain: "mine.example.com", currency: "USD" });
    const limited = await full.c.post("/api/v1/shopify/claim", { token: await installFromShopify(w, "another.myshopify.com"), organizationId: full.orgId });
    expect(limited.status).toBe(402);
    expect((await second.c.post("/api/v1/shopify/claim", { token: "x".repeat(32), organizationId: first.orgId })).status).toBe(404); // not their workspace
  });

  it("someone outside the workspace cannot claim into it", async () => {
    const w = await world();
    const token = await installFromShopify(w);
    const owner = await signup(w.env, "owner@example.com");
    const stranger = await signup(w.env, "stranger@example.com");
    expect((await stranger.c.post("/api/v1/shopify/claim", { token, organizationId: owner.orgId })).status).toBe(404);
    expect((await w.env.deps.db.select().from(schema.shopifyInstallations))[0]!.status).toBe("pending");
  });
});

describe("Shopify catalog sync", () => {
  it("imports every page by cursor with Shopify's own availability and numeric ids, and the product webhook updates the same rows", async () => {
    const w = await world();
    const m = await connected(w);
    w.shopify.products = Array.from({ length: 12 }, (_, i) => w.shopify.product(i + 1));
    w.shopify.products[1] = w.shopify.product(2, { status: "DRAFT", featuredMedia: { preview: { image: { url: "http://insecure.example/p.jpg" } } },
      variants: { pageInfo: { hasNextPage: true }, nodes: [{ legacyResourceId: "6002", title: "S", price: "10.00", availableForSale: false }, { legacyResourceId: "6003", title: "M", price: null, availableForSale: true }] } });
    const sync = (cursor: string | null) => m.c.post(`/api/v1/stores/${m.storeId}/integration/sync`, { cursor });
    const p1 = await sync(null);
    expect(p1.json.data).toMatchObject({ imported: 10, created: 10, nextCursor: "10", truncatedVariants: 1 });
    const p2 = await sync(p1.json.data.nextCursor);
    expect(p2.json.data).toMatchObject({ imported: 2, nextCursor: null });
    expect(w.shopify.calls.filter((c) => c.url.endsWith("/graphql.json")).every((c) => c.token?.startsWith("shpat_"))).toBe(true);

    const products = await w.env.deps.db.select().from(schema.products).where(eq(schema.products.storeId, m.storeId));
    expect(products).toHaveLength(12);
    const p2row = products.find((p) => p.externalId === "1002")!;
    expect(p2row).toMatchObject({ status: "draft", imageUrl: null, handle: "product-2", url: "/products/product-2", collectionIds: ["77"] });
    const variants = await w.env.deps.db.select().from(schema.productVariants).where(eq(schema.productVariants.productId, p2row.id));
    expect(variants.map((v) => [v.externalId, v.availability, v.price]).sort()).toEqual([["6002", "out_of_stock", 10], ["6003", "in_stock", null]]);

    // The REST-shaped product webhook carries the same numeric ids, so it updates the synced row rather than adding one.
    await hook(w.env, "products/update", SHOP, { id: 1001, title: "Renamed", status: "active", handle: "product-1", variants: [{ id: 5001, price: "21.00", inventory_management: null }] });
    const after = await w.env.deps.db.select().from(schema.products).where(eq(schema.products.storeId, m.storeId));
    expect(after).toHaveLength(12);
    expect(after.find((p) => p.externalId === "1001")!.title).toBe("Renamed");
  });

  it("explains throttling and a revoked token, and never imports from a store without the app", async () => {
    const w = await world();
    const m = await connected(w);
    w.shopify.next = { gqlError: "THROTTLED" };
    const t = await m.c.post(`/api/v1/stores/${m.storeId}/integration/sync`, { cursor: null });
    expect([t.status, t.json.error.code]).toEqual([429, "shopify_throttled"]);
    w.shopify.next = { status: 503 };
    expect((await m.c.post(`/api/v1/stores/${m.storeId}/integration/sync`, { cursor: null })).json.error.code).toBe("shopify_unavailable");
    w.shopify.tokens.set(SHOP, "rotated");
    const revoked = await m.c.post(`/api/v1/stores/${m.storeId}/integration/sync`, { cursor: null });
    expect([revoked.status, revoked.json.error.code]).toEqual([409, "shopify_reauthorize"]);
    const health = await m.c.post(`/api/v1/stores/${m.storeId}/integrations/shopify/health`);
    expect(health.json.data).toMatchObject({ ok: false });

    const bare = await signup(w.env, "bare@example.com");
    const s = await bare.c.post("/api/v1/stores", { organizationId: bare.orgId, platform: "shopify", name: "B", domain: "bare.myshopify.com", currency: "USD" });
    expect((await bare.c.post(`/api/v1/stores/${s.json.data.id}/integration/sync`, { cursor: null })).json.error.code).toBe("not_connected");
  });
});

describe("Shopify storefront setup: pixel and theme embed", () => {
  it("install creates the app pixel and writes the embed settings, so the merchant pastes nothing", async () => {
    const w = await world({ sdkOrigin: "https://sdk.example.com" });
    const m = await connected(w);
    expect(JSON.parse(w.shopify.pixels.get(SHOP)!.settings)).toEqual({ site_key: m.siteKey, api_url: API });
    expect(w.shopify.metafields.get(SHOP)).toEqual({ site_key: m.siteKey, api_url: API, sdk_url: "https://sdk.example.com/cf.js" });
    const status = await m.c.get(`/api/v1/stores/${m.storeId}/shopify`);
    expect(status.json.data.setup).toMatchObject({ pixelActive: true, embedSettingsSavedAt: expect.any(String), error: null });
    expect(status.json.data.setup.themeEditorUrl).toBe(`https://${SHOP}/admin/themes/current/editor?context=apps&activateAppId=${encodeURIComponent(`${API_KEY}/convertflow-embed`)}`);
    // Running it again updates the same pixel rather than creating another.
    const again = await m.c.post(`/api/v1/stores/${m.storeId}/shopify/setup`);
    expect(again.json.data).toMatchObject({ pixelActive: true, error: null });
    expect(w.shopify.pixels.size).toBe(1);
  });

  it("a refused pixel is reported and can be retried; an existing pixel from an older install is adopted", async () => {
    const w = await world();
    w.shopify.refuse.add("webPixelCreate");
    const m = await connected(w);
    expect((await m.c.get(`/api/v1/stores/${m.storeId}/shopify`)).json.data.setup).toMatchObject({ pixelActive: false, error: "pixel_rejected" });
    const [audit] = await w.env.deps.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.storeId, m.storeId), eq(schema.auditLogs.action, "shopify.setup_incomplete")));
    expect(audit).toBeTruthy();
    // The pixel exists at Shopify already (made by an earlier install): webPixelCreate says TAKEN, the app finds and updates it.
    w.shopify.refuse.clear();
    w.shopify.pixels.set(SHOP, { id: "gid://shopify/WebPixel/77", settings: "{}" });
    const r = await m.c.post(`/api/v1/stores/${m.storeId}/shopify/setup`);
    expect(r.json.data).toMatchObject({ pixelActive: true, error: null });
    expect(JSON.parse(w.shopify.pixels.get(SHOP)!.settings).site_key).toBe(m.siteKey);
    expect((await m.c.post(`/api/v1/stores/${m.storeId}/shopify/setup`, {})).status).toBe(200);
    const viewer = await signup(w.env, "outsider@example.com");
    expect((await viewer.c.post(`/api/v1/stores/${m.storeId}/shopify/setup`)).status).toBe(404);
  });

  it("reads whether the app embed is on in the live theme", async () => {
    const w = await world();
    const m = await connected(w);
    const embed = () => m.c.get(`/api/v1/stores/${m.storeId}/shopify/theme-embed`);
    expect((await embed()).json.data).toMatchObject({ state: "unknown", theme: "Dawn" });
    const settings = (disabled: boolean) => `/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n${JSON.stringify({ current: { blocks: { "123": { type: "shopify://apps/convertflow-ai/blocks/convertflow-embed/abc-123", disabled, settings: {} } } } })}`;
    w.shopify.themeSettings = settings(true);
    expect((await embed()).json.data.state).toBe("disabled");
    w.shopify.themeSettings = settings(false);
    expect((await embed()).json.data).toMatchObject({ state: "enabled", themeEditorUrl: expect.stringContaining("activateAppId=") });
    w.shopify.themeSettings = JSON.stringify({ current: "Default" }); // a theme still on a preset
    expect((await embed()).json.data.state).toBe("disabled");
  });
});

describe("Shopify stock changes", () => {
  it("inventory_levels/update re-reads the product, updates availability and reports the restock", async () => {
    const w = await world();
    const m = await connected(w);
    w.shopify.products = [w.shopify.product(1, { variants: { pageInfo: { hasNextPage: false }, nodes: [{ legacyResourceId: "5001", title: "Default", price: "19.50", availableForSale: false }] } })];
    await m.c.post(`/api/v1/stores/${m.storeId}/integration/sync`, { cursor: null });
    const variant = async () => (await w.env.deps.db.select().from(schema.productVariants).where(eq(schema.productVariants.externalId, "5001")))[0]!.availability;
    expect(await variant()).toBe("out_of_stock");
    w.shopify.products[0]!.variants.nodes[0]!.availableForSale = true;
    const r = await hook(w.env, "inventory_levels/update", SHOP, { inventory_item_id: 5001, location_id: 1, available: 4 });
    expect(r.status).toBe(200);
    expect(await variant()).toBe("in_stock");
    const events = await w.env.deps.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.type, "catalog.products_changed"));
    expect(events.some((e) => (e.payload as { restockedExternalIds: string[] }).restockedExternalIds.includes("1001"))).toBe(true);
    // An item Shopify does not know, or a malformed id, changes nothing.
    expect((await hook(w.env, "inventory_levels/update", SHOP, { inventory_item_id: 999999 })).status).toBe(200);
    expect((await hook(w.env, "inventory_levels/update", SHOP, { inventory_item_id: "1; drop" })).status).toBe(200);
  });
});

describe("Shopify uninstall and reinstall", () => {
  it("disconnecting the store in the dashboard uninstalls the app at Shopify", async () => {
    const w = await world();
    const m = await connected(w);
    expect(w.shopify.tokens.has(SHOP)).toBe(true);
    expect((await m.c.del(`/api/v1/stores/${m.storeId}`)).status).toBe(204);
    expect(w.shopify.tokens.has(SHOP)).toBe(false); // access revoked: Shopify uninstalls the app
    const [inst] = await w.env.deps.db.select().from(schema.shopifyInstallations).where(eq(schema.shopifyInstallations.shop, SHOP));
    expect(inst!.status).toBe("uninstalled");
    // Shopify's app/uninstalled arrives afterwards and is harmless.
    expect((await hook(w.env, "app/uninstalled", SHOP, { domain: SHOP })).status).toBe(200);
  });

  it("uninstall stops serving and drops the token but keeps the data; a reinstall into the same workspace brings the same store back", async () => {
    const w = await world();
    const m = await connected(w);
    await setPlan(w.env, m.orgId, "growth");
    const camp = await m.c.post(`/api/v1/stores/${m.storeId}/campaigns`, validConfig());
    expect((await hook(w.env, "app/uninstalled", SHOP, { id: 1, domain: SHOP })).status).toBe(200);
    const [store] = await w.env.deps.db.select().from(schema.stores).where(eq(schema.stores.id, m.storeId));
    expect(store).toMatchObject({ status: "disconnected", deliveryEnabled: false });
    expect(await w.env.deps.db.select().from(schema.integrationCredentials)).toHaveLength(0);
    expect((await w.env.deps.db.select().from(schema.shopifyInstallations))[0]).toMatchObject({ status: "uninstalled" });
    expect(JSON.parse(w.env.kv.get(`config:${m.siteKey}`)!)).toMatchObject({ deliveryEnabled: false, campaigns: [] });

    const launch = await get(w.env, `/api/v1/shopify/install?${await signed(w.env, { shop: SHOP })}`);
    const state = new URL(location(launch)).searchParams.get("state")!;
    const cb = await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve(SHOP), shop: SHOP, state })}`);
    const claim = new URL(location(cb)).searchParams.get("claim")!;
    const r = await m.c.post("/api/v1/shopify/claim", { token: claim, organizationId: m.orgId });
    expect(r.json.data).toEqual({ storeId: m.storeId, created: false });
    const [back] = await w.env.deps.db.select().from(schema.stores).where(eq(schema.stores.id, m.storeId));
    expect(back).toMatchObject({ status: "active", deliveryEnabled: true });
    expect((await m.c.get(`/api/v1/stores/${m.storeId}/campaigns/${camp.json.data.id}`)).status).toBe(200);
  });

  it("a shop uninstalled from one workspace can be installed into another; the old store keeps its data until shop/redact", async () => {
    const w = await world();
    const a = await connected(w, "a@example.com");
    await hook(w.env, "app/uninstalled", SHOP, { id: 1 });
    const launch = await get(w.env, `/api/v1/shopify/install?${await signed(w.env, { shop: SHOP })}`);
    const cb = await get(w.env, `/api/v1/shopify/callback?${await signed(w.env, { code: w.shopify.approve(SHOP), shop: SHOP, state: new URL(location(launch)).searchParams.get("state")! })}`);
    const b = await signup(w.env, "b@example.com");
    const r = await b.c.post("/api/v1/shopify/claim", { token: new URL(location(cb)).searchParams.get("claim")!, organizationId: b.orgId });
    expect(r.status).toBe(201);
    expect(r.json.data.storeId).not.toBe(a.storeId);
    const [old] = await w.env.deps.db.select().from(schema.stores).where(eq(schema.stores.id, a.storeId));
    expect(old).toMatchObject({ status: "disconnected", externalId: null });
    const installs = await w.env.deps.db.select().from(schema.shopifyInstallations).where(eq(schema.shopifyInstallations.shop, SHOP));
    expect(installs).toEqual([expect.objectContaining({ status: "installed", storeId: r.json.data.storeId })]);
    expect(await w.env.deps.db.select().from(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, a.storeId))).toHaveLength(0);
  });
});

describe("Shopify Billing", () => {
  async function billed(extra: Record<string, unknown> = {}) {
    const w = await world(extra);
    const m = await connected(w);
    const upsell = await m.c.post(`/api/v1/stores/${m.storeId}/campaigns`, validConfig({ name: "Recs", tool: "upsell", format: "recommendation", recommend: { source: "same_collection" } }));
    const toast = await m.c.post(`/api/v1/stores/${m.storeId}/campaigns`, validConfig({ name: "Toast", tool: "toast", format: "toast", toast: {} }));
    const subscribe = (plan = "growth") => m.c.post("/api/v1/billing/shopify/subscribe", { organizationId: m.orgId, plan });
    const sub = async () => (await w.env.deps.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, m.orgId)))[0]!;
    const served = () => (JSON.parse(w.env.kv.get(`config:${m.siteKey}`)!) as { campaigns: { config: { tool?: string } }[] }).campaigns.map((c) => c.config.tool).sort();
    const back = async (chargeId: string) => location(await get(w.env, `/api/v1/billing/shopify/return?store=${m.storeId}&charge_id=${chargeId.split("/").pop()}`));
    return { ...w, m, upsellId: upsell.json.data.id as string, toastId: toast.json.data.id as string, subscribe, sub, served, back };
  }
  const publish = async (b: Awaited<ReturnType<typeof billed>>, id: string) => {
    const c = await b.m.c.get(`/api/v1/stores/${b.m.storeId}/campaigns/${id}`);
    return b.m.c.post(`/api/v1/stores/${b.m.storeId}/campaigns/${id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
  };

  it("nothing changes until Shopify reports the charge active, and then the plan applies at once", async () => {
    const b = await billed();
    const r = await b.subscribe();
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(new URL(r.json.data.confirmationUrl).hostname).toBe(SHOP);
    const [charge] = [...b.shopify.charges.values()];
    expect(charge).toMatchObject({ name: "ConvertFlow Growth", status: "PENDING", test: false, trialDays: 0 });
    const create = b.shopify.calls.find((c) => (c.body as { query?: string } | undefined)?.query?.includes("appSubscriptionCreate"))!;
    expect((create.body as { variables: unknown }).variables).toMatchObject({ lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: 49, currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } }], returnUrl: `${API}/api/v1/billing/shopify/return?store=${b.m.storeId}` });

    // Returning before approval (or with a declined charge) changes nothing.
    expect(await b.back(charge!.id)).toBe(`${WEB}/app/settings?billing=pending&store=${b.m.storeId}`);
    expect((await b.sub()).plan).toBe("free");
    expect((await publish(b, b.upsellId)).status).toBe(402);

    charge!.status = "ACTIVE"; charge!.currentPeriodEnd = "2026-11-26T12:00:00.000Z";
    expect(await b.back(charge!.id)).toBe(`${WEB}/app/settings?billing=success&store=${b.m.storeId}`);
    expect(await b.sub()).toMatchObject({ plan: "growth", status: "active", provider: "shopify", providerRef: charge!.id, customerRef: SHOP, currentPeriodEnd: "2026-11-26T12:00:00.000Z" });
    expect((await publish(b, b.upsellId)).status).toBe(200);
    expect((await publish(b, b.toastId)).status).toBe(200);
    expect(b.served()).toEqual(["toast", "upsell"]);
    const view = await b.m.c.get(`/api/v1/billing/subscription?organizationId=${b.m.orgId}`);
    expect(view.json.data).toMatchObject({ plan: "growth", provider: "shopify", shopifyBilling: { available: true, storeIds: [b.m.storeId] } });
  });

  it("a frozen or cancelled charge drops paid tools from the storefront without touching the campaigns; a declined upgrade keeps the current plan", async () => {
    const b = await billed();
    await b.subscribe("growth");
    const growth = [...b.shopify.charges.values()][0]!;
    growth.status = "ACTIVE";
    await b.back(growth.id);
    await publish(b, b.upsellId); await publish(b, b.toastId);

    await b.subscribe("scale");
    const scale = [...b.shopify.charges.values()][1]!;
    scale.status = "DECLINED";
    expect(await b.back(scale.id)).toBe(`${WEB}/app/settings?billing=declined&store=${b.m.storeId}`);
    expect(await hook(b.env, "app_subscriptions/update", SHOP, { app_subscription: { admin_graphql_api_id: scale.id, name: scale.name, status: "DECLINED" } })).toBeTruthy();
    expect(await b.sub()).toMatchObject({ plan: "growth", status: "active", providerRef: growth.id });

    growth.status = "FROZEN";
    await hook(b.env, "app_subscriptions/update", SHOP, { app_subscription: { admin_graphql_api_id: growth.id, name: growth.name, status: "FROZEN" } });
    expect((await b.sub()).status).toBe("past_due");
    expect(b.served()).toEqual(["toast"]); // the free plan cannot serve upsells
    const upsell = await b.m.c.get(`/api/v1/stores/${b.m.storeId}/campaigns/${b.upsellId}`);
    expect(upsell.json.data.status).toBe("active"); // nothing was unpublished or deleted

    growth.status = "ACTIVE";
    await hook(b.env, "app_subscriptions/update", SHOP, { app_subscription: { admin_graphql_api_id: growth.id, name: growth.name, status: "ACTIVE" } });
    expect(b.served()).toEqual(["toast", "upsell"]); // restored as soon as payment is
  });

  it("a webhook's status is re-read from Shopify, so a forged or stale payload cannot grant a plan", async () => {
    const b = await billed();
    await b.subscribe("scale");
    const pending = [...b.shopify.charges.values()][0]!;
    await hook(b.env, "app_subscriptions/update", SHOP, { app_subscription: { admin_graphql_api_id: pending.id, name: pending.name, status: "ACTIVE" } });
    expect((await b.sub()).plan).toBe("free"); // Shopify still says PENDING
  });

  it("cancel, uninstall and trials", async () => {
    const b = await billed({ shopifyTrialDays: 7, shopifyBillingTest: true });
    await b.subscribe("starter");
    const c = [...b.shopify.charges.values()][0]!;
    expect(c).toMatchObject({ trialDays: 7, test: true });
    c.status = "ACTIVE";
    await b.back(c.id);
    expect(await b.sub()).toMatchObject({ plan: "starter", status: "trialing" });
    b.env.clock.t += 8 * 86_400_000;
    await hook(b.env, "app_subscriptions/update", SHOP, { app_subscription: { admin_graphql_api_id: c.id, name: c.name, status: "ACTIVE" } });
    expect((await b.sub()).status).toBe("active");

    expect((await b.m.c.post("/api/v1/billing/shopify/cancel", { organizationId: b.m.orgId })).status).toBe(204);
    expect(c.status).toBe("CANCELLED");
    expect((await b.sub()).status).toBe("cancelled");
    expect((await b.m.c.post("/api/v1/billing/shopify/cancel", { organizationId: b.m.orgId })).status).toBe(409);

    await b.subscribe("growth");
    const g = [...b.shopify.charges.values()][1]!;
    g.status = "ACTIVE"; await b.back(g.id);
    await hook(b.env, "app/uninstalled", SHOP, { id: 1 });
    expect((await b.sub()).status).toBe("cancelled"); // Shopify ends the app's charges on uninstall
  });

  it("only the owner can change the plan, and card billing is refused while Shopify bills the workspace", async () => {
    const b = await billed({ stripeSecretKey: "sk_test_x", stripePrices: { starter: "price_s", growth: "price_g", scale: "price_c" } });
    await b.subscribe("growth");
    const g = [...b.shopify.charges.values()][0]!;
    g.status = "ACTIVE"; await b.back(g.id);
    const stripe = await b.m.c.post("/api/v1/billing/checkout", { organizationId: b.m.orgId, plan: "scale" });
    expect([stripe.status, stripe.json.error.code]).toEqual([409, "billed_by_shopify"]);
    const other = await signup(b.env, "other@example.com");
    expect((await other.c.post("/api/v1/billing/shopify/subscribe", { organizationId: b.m.orgId, plan: "scale" })).status).toBe(404);
    // A Stripe event about some other subscription never touches the Shopify-billed workspace.
    const { handleStripeEvent } = await import("../src/services/stripe.js");
    await b.env.deps.db.update(schema.subscriptions).set({ providerRef: "sub_stripe" }).where(eq(schema.subscriptions.organizationId, b.m.orgId));
    expect(await handleStripeEvent(b.env.deps, { id: "e", type: "customer.subscription.deleted", data: { object: { id: "sub_stripe" } } })).toBe("ignored");
    expect((await b.sub()).status).toBe("active");
  });
});

describe("Shopify privacy webhooks act on signup contacts", () => {
  it("customers/redact erases the matching contact and nothing else; customers/data_request records which contacts match", async () => {
    const w = await world();
    const m = await connected(w);
    const now = new Date(w.env.clock.t).toISOString();
    await w.env.deps.db.insert(schema.contacts).values([
      { id: "ctc_a", storeId: m.storeId, email: "ada@example.com", phone: null, emailStatus: "subscribed", source: "form:x", createdAt: now, updatedAt: now },
      { id: "ctc_b", storeId: m.storeId, email: null, phone: "+14155550123", smsStatus: "subscribed", source: "form:y", createdAt: now, updatedAt: now },
      { id: "ctc_c", storeId: m.storeId, email: "other@example.com", phone: null, emailStatus: "subscribed", source: "form:x", createdAt: now, updatedAt: now },
    ]);
    await hook(w.env, "customers/data_request", SHOP, { shop_id: 1, shop_domain: SHOP, customer: { id: 7, email: "ADA@example.com", phone: "+1 415 555 0123" }, data_request: { id: 9 } });
    const req = await w.env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "privacy.data_requested"));
    expect(JSON.stringify(req[0]!.summary)).toMatch(/ctc_a/);
    expect(JSON.stringify(req[0]!.summary)).toMatch(/ctc_b/);
    expect(JSON.stringify(req[0]!.summary)).not.toContain("ada@example.com");

    await hook(w.env, "customers/redact", SHOP, { shop_id: 1, shop_domain: SHOP, customer: { id: 7, email: "ada@example.com", phone: "+14155550123" }, orders_to_redact: [] });
    const left = await w.env.deps.db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.storeId, m.storeId));
    expect(left.map((r) => r.id)).toEqual(["ctc_c"]);
  });

  it("only touches the store the webhook is for", async () => {
    const w = await world();
    const a = await connected(w, "a@example.com", "a-shop.myshopify.com");
    const b = await connected(w, "b@example.com", "b-shop.myshopify.com");
    const now = new Date(w.env.clock.t).toISOString();
    await w.env.deps.db.insert(schema.contacts).values([
      { id: "ctc_a", storeId: a.storeId, email: "ada@example.com", emailStatus: "subscribed", source: "form:x", createdAt: now, updatedAt: now },
      { id: "ctc_b", storeId: b.storeId, email: "ada@example.com", emailStatus: "subscribed", source: "form:x", createdAt: now, updatedAt: now },
    ]);
    await hook(w.env, "customers/redact", "a-shop.myshopify.com", { customer: { email: "ada@example.com" } });
    const rows = await w.env.deps.db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.email, "ada@example.com")));
    expect(rows.map((r) => r.id)).toEqual(["ctc_b"]);
  });
});

describe("daily reconciliation", () => {
  it("a full catalog pass archives products Shopify no longer has; a pass that fails part-way archives nothing", async () => {
    const { scheduleCatalogReconcile } = await import("../src/services/reconcile.js");
    const w = await world();
    const m = await connected(w);
    w.shopify.products = Array.from({ length: 12 }, (_, i) => w.shopify.product(i + 1));
    await scheduleCatalogReconcile(w.env.deps);
    const active = async () => (await w.env.deps.db.select().from(schema.products).where(and(eq(schema.products.storeId, m.storeId), eq(schema.products.status, "active")))).map((p) => p.externalId).sort();
    expect(await active()).toHaveLength(12);

    // Product 1003 is deleted in Shopify and its products/delete webhook never arrives.
    w.env.clock.t += 86_400_000;
    w.shopify.products = w.shopify.products.filter((p) => p.legacyResourceId !== "1003");
    w.shopify.next = { status: 503 }; // the first attempt fails; the page is retried
    await scheduleCatalogReconcile(w.env.deps);
    expect(await active()).not.toContain("1003");
    expect(await active()).toHaveLength(11);
    const audit = await w.env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "catalog.reconciled"));
    expect(audit.at(-1)!.summary).toMatchObject({ pages: 2, archived: 1 });

    // A pass that cannot finish (the token was revoked) must not archive anything it did not get to see.
    w.env.clock.t += 86_400_000;
    w.shopify.tokens.set(SHOP, "revoked");
    await scheduleCatalogReconcile(w.env.deps);
    expect(await active()).toHaveLength(11);
    expect(await w.env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "catalog.reconcile_failed"))).toHaveLength(1);
  });

  it("a lost app_subscriptions/update webhook is caught by the daily billing re-check, and an unchanged charge is left alone", async () => {
    const { reconcileShopifyBilling } = await import("../src/services/reconcile.js");
    const w = await world();
    const m = await connected(w);
    await m.c.post("/api/v1/billing/shopify/subscribe", { organizationId: m.orgId, plan: "growth" });
    const charge = [...w.shopify.charges.values()][0]!;
    charge.status = "ACTIVE";
    await get(w.env, `/api/v1/billing/shopify/return?store=${m.storeId}&charge_id=${charge.id.split("/").pop()}`);
    const audits = async () => (await w.env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "billing.shopify_status"))).length;
    const before = await audits();
    expect(await reconcileShopifyBilling(w.env.deps)).toBe(0); // nothing changed, nothing written
    expect(await audits()).toBe(before);

    charge.status = "FROZEN"; // Shopify froze it; the webhook was lost
    expect(await reconcileShopifyBilling(w.env.deps)).toBe(1);
    const [sub] = await w.env.deps.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, m.orgId));
    expect(sub!.status).toBe("past_due");
  });
});
