import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { encrypt, decrypt } from "../src/lib/aes.js";
import { loadCredentials, saveCredentials } from "../src/services/credentials.js";
import { verifyStripeSignature } from "../src/services/stripe.js";
import { Client, linkShop, makeEnv, signup, validConfig } from "./helpers.js";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const hmac = async (secret: string, msg: string) => crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), new TextEncoder().encode(msg));
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

async function storeFor(env: Awaited<ReturnType<typeof makeEnv>>, platform = "custom", domain = "shop.example.com", email = "owner@example.com") {
  const u = await signup(env, email);
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform, name: "S", domain, currency: "USD" });
  if (platform === "shopify") await linkShop(env, s.json.data.id, domain);
  return { ...u, storeId: s.json.data.id as string, siteKey: s.json.data.siteKey as string };
}

describe("credential encryption", () => {
  it("round-trips, uses fresh IVs, and rejects tampering", async () => {
    const a = await encrypt("shpat_secret", KEY), b = await encrypt("shpat_secret", KEY);
    expect(a).not.toBe(b);
    expect(await decrypt(a, KEY)).toBe("shpat_secret");
    const bad = a.slice(0, -2) + (a.endsWith("AA") ? "BB" : "AA");
    await expect(decrypt(bad, KEY)).rejects.toThrow();
    await expect(encrypt("x", btoa("short"))).rejects.toThrow(/32 bytes/);
  });
  it("stores tokens only as ciphertext", async () => {
    const env = await makeEnv(undefined, { secrets: { credentialKey: KEY } });
    const s = await storeFor(env);
    await saveCredentials(env.deps, s.storeId, { accessToken: "shpat_plain", refreshToken: "r_plain" });
    const [row] = await env.deps.db.select().from(schema.integrationCredentials);
    expect(JSON.stringify(row)).not.toContain("shpat_plain");
    expect(JSON.stringify(row)).not.toContain("r_plain");
    expect(await loadCredentials(env.deps, s.storeId)).toMatchObject({ accessToken: "shpat_plain", refreshToken: "r_plain" });
  });
  it("refuses to store credentials without a key (fails closed)", async () => {
    const env = await makeEnv();
    const s = await storeFor(env);
    await expect(saveCredentials(env.deps, s.storeId, { accessToken: "x" })).rejects.toThrow(/not configured/);
  });
});

describe("shopify webhooks", () => {
  const SECRET = "shpss_test";
  const send = async (env: Awaited<ReturnType<typeof makeEnv>>, topic: string, body: unknown, over: { id?: string; sig?: string; shop?: string } = {}) => {
    const raw = JSON.stringify(body);
    return env.app.request("/api/v1/webhooks/shopify", { method: "POST", headers: {
      "x-shopify-hmac-sha256": over.sig ?? b64(await hmac(SECRET, raw)), "x-shopify-topic": topic,
      "x-shopify-shop-domain": over.shop ?? "mystore.myshopify.com", "x-shopify-webhook-id": over.id ?? crypto.randomUUID(), "content-type": "application/json",
    }, body: raw });
  };
  const setup = async () => {
    const env = await makeEnv(undefined, { secrets: { shopifyApiSecret: SECRET } });
    const s = await storeFor(env, "shopify", "mystore.myshopify.com");
    return { env, s };
  };

  it("rejects missing/forged signatures and works without Shopify configured", async () => {
    const { env } = await setup();
    expect((await send(env, "app/uninstalled", {}, { sig: "AAAA" })).status).toBe(401);
    expect((await send(env, "app/uninstalled", {}, { sig: "" })).status).toBe(401);
    const bare = await makeEnv();
    expect((await send(bare, "app/uninstalled", {})).status).toBe(503);
  });
  it("is idempotent on the webhook id", async () => {
    const { env } = await setup();
    const a = await (await send(env, "products/update", { id: 1, title: "A", status: "active" }, { id: "w1" })).json() as { outcome: string };
    const b = await (await send(env, "products/update", { id: 1, title: "A", status: "active" }, { id: "w1" })).json() as { outcome: string };
    expect([a.outcome, b.outcome]).toEqual(["processed", "duplicate"]);
    expect(await env.deps.db.select().from(schema.webhookEvents)).toHaveLength(1);
  });
  it("syncs products and records orders without double counting", async () => {
    const { env, s } = await setup();
    await send(env, "products/update", { id: 9, title: "Shoe", handle: "shoe", status: "active", variants: [{ id: 90, price: "10", inventory_management: "shopify", inventory_quantity: 2 }] });
    const order = { id: 555, total_price: "42.50", currency: "usd", created_at: "2026-10-27T10:00:00Z" };
    await send(env, "orders/create", order);
    await send(env, "orders/create", order); // different delivery id, same order
    expect((await env.deps.db.select().from(schema.products))[0]?.title).toBe("Shoe");
    const conv = await env.deps.db.select().from(schema.conversions);
    expect(conv).toHaveLength(1);
    expect(conv[0]).toMatchObject({ total: 42.5, currency: "USD", storeId: s.storeId });
  });
  it("app/uninstalled stops delivery and removes credentials", async () => {
    const { env, s } = await setup();
    await send(env, "app/uninstalled", {});
    const [st] = await env.deps.db.select().from(schema.stores).where(eq(schema.stores.id, s.storeId));
    expect(st?.status).toBe("disconnected");
    expect(JSON.parse((await env.kv.get(`config:${s.siteKey}`)) ?? "{}").deliveryEnabled).toBe(false);
  });
  it("shop/redact purges all store data; customer requests are logged", async () => {
    const { env, s } = await setup();
    await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig());
    await send(env, "customers/data_request", { shop_id: 1 });
    expect((await env.deps.db.select().from(schema.auditLogs)).some((a) => a.action === "customers/data_request")).toBe(true);
    await send(env, "shop/redact", { shop_id: 1 });
    expect(await env.deps.db.select().from(schema.stores)).toHaveLength(0);
    expect(await env.deps.db.select().from(schema.campaigns)).toHaveLength(0);
  });
});

describe("stripe billing", () => {
  const SECRET = "whsec_test";
  const secrets = { stripeSecretKey: "sk_test", stripeWebhookSecret: SECRET, stripePrices: { starter: "price_s", growth: "price_g" }, webOrigin: "https://app.example.com" };
  const sign = async (raw: string, t: number) => `t=${t},v1=${hex(await hmac(SECRET, `${t}.${raw}`))}`;
  const hook = async (env: Awaited<ReturnType<typeof makeEnv>>, ev: unknown, header?: string) => {
    const raw = JSON.stringify(ev);
    return env.app.request("/api/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header ?? (await sign(raw, Math.floor(env.clock.t / 1000))) }, body: raw });
  };

  it("verifies signatures, rejects stale and forged ones", async () => {
    const now = 1_800_000_000_000, raw = "{}";
    const good = await sign(raw, now / 1000);
    expect(await verifyStripeSignature(raw, good, SECRET, now)).toBe(true);
    expect(await verifyStripeSignature(raw, good, "other", now)).toBe(false);
    expect(await verifyStripeSignature(raw, good, SECRET, now + 10 * 60_000)).toBe(false);
    expect(await verifyStripeSignature("{ }", good, SECRET, now)).toBe(false);
    expect(await verifyStripeSignature(raw, undefined, SECRET, now)).toBe(false);
  });
  it("creates a checkout session (owner only, configured only)", async () => {
    let seen: { url: string; body: string } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => { seen = { url, body: String(init.body) }; return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/x" }), { status: 200 }); }) as unknown as typeof fetch;
    const env = await makeEnv(undefined, { secrets, fetchFn });
    const u = await signup(env, "o@example.com");
    const r = await u.c.post("/api/v1/billing/checkout", { organizationId: u.orgId, plan: "starter" });
    expect(r.json.data.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    expect(seen?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(seen?.body).toContain(`client_reference_id=${u.orgId}`);
    expect(seen?.body).toContain("price_s");
    const other = await signup(env, "x@example.com");
    expect((await other.c.post("/api/v1/billing/checkout", { organizationId: u.orgId, plan: "starter" })).status).toBe(404);
    expect((await u.c.post("/api/v1/billing/checkout", { organizationId: u.orgId, plan: "scale" })).status).toBe(503); // no price configured
    const bare = await makeEnv();
    const b = await signup(bare, "b@example.com");
    expect((await b.c.post("/api/v1/billing/checkout", { organizationId: b.orgId, plan: "starter" })).status).toBe(503);
  });
  it("upgrades only via a verified webhook, and downgrades on cancellation", async () => {
    const env = await makeEnv(undefined, { secrets });
    const u = await signup(env, "o@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "S", domain: "shop.example.com", currency: "USD" });
    const sid = s.json.data.id as string;
    const live = async (name: string) => { const c = await u.c.post(`/api/v1/stores/${sid}/campaigns`, validConfig({ name })); return u.c.post(`/api/v1/stores/${sid}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt }); };
    expect((await live("one")).status).toBe(200);
    expect((await live("two")).status).toBe(402); // free: 1 live campaign

    expect((await hook(env, { id: "e0", type: "checkout.session.completed", data: { object: { client_reference_id: u.orgId, subscription: "sub_1", metadata: { plan: "starter" } } } }, "t=1,v1=bad")).status).toBe(401);
    expect((await live("two")).status).toBe(402); // forged webhook changed nothing

    await hook(env, { id: "e1", type: "checkout.session.completed", data: { object: { client_reference_id: u.orgId, subscription: "sub_1", metadata: { plan: "starter" } } } });
    expect((await live("two")).status).toBe(200); // starter: 5
    expect((await u.c.get(`/api/v1/billing/subscription?organizationId=${u.orgId}`)).json.data).toMatchObject({ plan: "starter", status: "active", billingConfigured: true });

    await hook(env, { id: "e2", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "past_due", metadata: { plan: "starter" }, current_period_end: 1_900_000_000 } } });
    expect((await u.c.get(`/api/v1/billing/subscription?organizationId=${u.orgId}`)).json.data.status).toBe("past_due");
    expect((await live("three")).status).toBe(402); // unpaid falls back to free limits

    await hook(env, { id: "e3", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled", metadata: {} } } });
    expect((await u.c.get(`/api/v1/billing/subscription?organizationId=${u.orgId}`)).json.data.status).toBe("cancelled");
  });
  it("ignores unknown events and unknown subscriptions", async () => {
    const env = await makeEnv(undefined, { secrets });
    expect(await (await hook(env, { id: "e", type: "invoice.created", data: { object: {} } })).json()).toMatchObject({ outcome: "ignored" });
    expect(await (await hook(env, { id: "e", type: "customer.subscription.updated", data: { object: { id: "sub_nope", status: "active" } } })).json()).toMatchObject({ outcome: "ignored" });
  });
});

describe("pageview metering", () => {
  it("stops delivery when the monthly allowance is exhausted", async () => {
    const env = await makeEnv();
    const s = await storeFor(env);
    const created = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig());
    await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${created.json.data.id}/publish`, { approve: true, approvedUpdatedAt: created.json.data.updatedAt });
    await env.deps.db.insert(schema.usageRecords).values({ organizationId: s.orgId, metric: "pageviews", period: "2026-10", count: 4999 });
    const ver = (await s.c.get(`/api/v1/stores/${s.storeId}/campaigns/${created.json.data.id}/versions`)).json.data[0].id as string;
    const ev = (id: string) => ({ eventId: id, type: "campaign_eligible", siteId: s.siteKey, campaignId: created.json.data.id, versionId: ver, sessionId: "sess_12345678", occurredAt: "2026-10-27T12:00:00.000Z", schemaVersion: 1 });
    const cfg = async () => (await (await env.app.request(`/sdk/v1/config/${s.siteKey}.json`)).json()) as { deliveryEnabled: boolean };
    expect((await cfg()).deliveryEnabled).toBe(true);
    await env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true, events: [ev("evt_aaaaaaaa"), ev("evt_bbbbbbbb")] }) });
    expect((await cfg()).deliveryEnabled).toBe(false);
    const sub = (await s.c.get(`/api/v1/billing/subscription?organizationId=${s.orgId}`)).json.data;
    expect(sub.usage.pageviews).toBe(5001);
  });
});

describe("account deletion & privacy", () => {
  it("requires the password, then erases the account and its stores", async () => {
    const env = await makeEnv();
    const s = await storeFor(env);
    await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig());
    expect((await s.c.req("DELETE", "/api/v1/auth/account", { password: "wrong-password-1" })).status).toBe(403);
    expect((await s.c.req("DELETE", "/api/v1/auth/account", { password: "correct-horse-battery" })).status).toBe(204);
    expect((await s.c.get("/api/v1/auth/me")).status).toBe(401);
    for (const t of [schema.users, schema.organizations, schema.stores, schema.campaigns, schema.memberships, schema.subscriptions, schema.sessions]) {
      expect(await env.deps.db.select().from(t)).toHaveLength(0);
    }
    expect((await new Client(env).post("/api/v1/auth/login", { email: "owner@example.com", password: "correct-horse-battery" })).status).toBe(401);
  });
  it("won't orphan a shared workspace", async () => {
    const env = await makeEnv();
    const a = await signup(env, "a@example.com");
    const b = await signup(env, "b@example.com");
    await env.deps.db.insert(schema.memberships).values({ id: "m_x", organizationId: a.orgId, userId: b.userId, role: "viewer", createdAt: "x" });
    expect((await a.c.req("DELETE", "/api/v1/auth/account", { password: "correct-horse-battery" })).status).toBe(409);
  });
});

describe("abuse controls", () => {
  it("enforces Turnstile on signup when configured", async () => {
    const calls: string[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => { calls.push(String(init.body)); return new Response(JSON.stringify({ success: String(init.body).includes("good") })); }) as unknown as typeof fetch;
    const env = await makeEnv(undefined, { secrets: { turnstileSecret: "ts_secret" }, fetchFn });
    const c = new Client(env);
    const creds = { email: "t@example.com", password: "correct-horse-battery" };
    expect((await c.post("/api/v1/auth/register", creds)).status).toBe(400);
    expect((await c.post("/api/v1/auth/register", { ...creds, turnstileToken: "bad" })).status).toBe(400);
    expect((await c.post("/api/v1/auth/register", { ...creds, turnstileToken: "good" })).status).toBe(201);
    expect(calls[0]).toContain("secret=ts_secret");
  });
  it("caps JSON request bodies", async () => {
    const env = await makeEnv();
    const u = await signup(env, "big@example.com");
    const r = await u.c.post("/api/v1/stores", { organizationId: "x".repeat(600_000), platform: "custom", name: "n", domain: "a.example.com" });
    expect(r.status).toBe(413);
  });
});
