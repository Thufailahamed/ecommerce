import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { permissionsFor } from "@convertflow/contracts";
import { newId } from "../src/lib/crypto.js";
import { can } from "../src/services/authz.js";
import { recordAudit, sanitizeSummary } from "../src/services/audit.js";
import {
  defineSubscriber, dispatchDomainEvent, publishDomainEvent, purgeDomainEvents, sweepDomainEvents, type Subscriber,
} from "../src/services/domain-events.js";
import { SUBSCRIBERS } from "../src/services/subscribers.js";
import { ORIGIN, linkShop, makeEnv, setupStore, signup, validConfig, type Env } from "./helpers.js";

const SECRET = "shpss_test";
const hmac = async (msg: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC",
  await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), new TextEncoder().encode(msg)))));
const shopify = async (env: Env, shop: string, topic: string, body: unknown, id = crypto.randomUUID()) => {
  const raw = JSON.stringify(body);
  return env.app.request("/api/v1/webhooks/shopify", { method: "POST", headers: {
    "x-shopify-hmac-sha256": await hmac(raw), "x-shopify-topic": topic, "x-shopify-shop-domain": shop, "x-shopify-webhook-id": id, "content-type": "application/json",
  }, body: raw });
};
const shopifyStore = async (env: Env, email: string, domain: string) => {
  const u = await signup(env, email);
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "shopify", name: "S", domain, currency: "USD" });
  await linkShop(env, s.json.data.id, domain);
  return { ...u, storeId: s.json.data.id as string };
};
/** Adds an existing account to a workspace with a role, as an accepted invitation would. */
const join = async (env: Env, orgId: string, email: string, role: "admin" | "editor" | "viewer") => {
  const u = await signup(env, email);
  await env.deps.db.insert(schema.memberships).values({ id: newId("mem"), organizationId: orgId, userId: u.userId, role, createdAt: new Date(env.clock.t).toISOString() });
  return u;
};
const publishOne = async (t: Awaited<ReturnType<typeof setupStore>>) => {
  const made = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns`, validConfig());
  const r = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${made.json.data.id}/publish`, { approve: true, approvedUpdatedAt: made.json.data.updatedAt });
  expect(r.status).toBe(200);
  return { campaignId: made.json.data.id as string, versionId: r.json.data.versionId as string };
};
const events = (env: Env, type?: string) => env.deps.db.select().from(schema.domainEvents).where(type ? eq(schema.domainEvents.type, type) : undefined);

describe("tenancy and permissions", () => {
  it("answers outsiders 404 and under-privileged members 403 on store and workspace routes", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const outsider = await signup(env, "out@example.com");
    const viewer = await join(env, t.orgId, "viewer@example.com", "viewer");
    const editor = await join(env, t.orgId, "editor@example.com", "editor");
    const { campaignId } = await publishOne(t);

    for (const path of [`/api/v1/stores/${t.storeId}`, `/api/v1/stores/${t.storeId}/audit`, `/api/v1/stores/${t.storeId}/platform-events`, `/api/v1/organizations/${t.orgId}/audit`]) {
      expect((await outsider.c.get(path)).status).toBe(404);
    }
    expect((await outsider.c.post(`/api/v1/stores/${t.storeId}/campaigns/${campaignId}/pause`)).status).toBe(404);
    expect((await viewer.c.post(`/api/v1/stores/${t.storeId}/campaigns/${campaignId}/pause`)).status).toBe(403);
    expect((await editor.c.get(`/api/v1/stores/${t.storeId}/audit`)).status).toBe(403);
    expect((await editor.c.get(`/api/v1/stores/${t.storeId}/platform-events`)).status).toBe(403);
    expect((await editor.c.get(`/api/v1/organizations/${t.orgId}/audit`)).status).toBe(403);
    expect((await editor.c.post(`/api/v1/stores/${t.storeId}/campaigns/${campaignId}/pause`)).status).toBe(204);
    // A member who may not create stores is told so (403), not that the workspace is missing.
    expect((await editor.c.post("/api/v1/stores", { organizationId: t.orgId, platform: "custom", name: "X", domain: "x.example.com", currency: "USD" })).status).toBe(403);
    expect((await outsider.c.post("/api/v1/stores", { organizationId: t.orgId, platform: "custom", name: "X", domain: "x.example.com", currency: "USD" })).status).toBe(404);
  });

  it("returns the caller's role and its permissions with the store", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const editor = await join(env, t.orgId, "editor@example.com", "editor");
    const r = await editor.c.get(`/api/v1/stores/${t.storeId}`);
    expect(r.json.data.role).toBe("editor");
    expect(r.json.data.permissions).toEqual(permissionsFor("editor"));
    expect(r.json.data.permissions).not.toContain("campaigns.publish");
  });

  it("can() never lets a store id from another workspace through, and refuses a permission asked of the wrong resource", async () => {
    const env = await makeEnv();
    const a = await setupStore(env, "a@example.com");
    const b = await setupStore(env, "b@example.com");
    const actor = { type: "user" as const, userId: a.userId };
    expect(await can(env.deps, actor, "campaigns.publish", { storeId: a.storeId })).toBe(true);
    expect(await can(env.deps, actor, "store.read", { storeId: b.storeId })).toBe(false);
    expect(await can(env.deps, actor, "billing.manage", { organizationId: b.orgId })).toBe(false);
    expect(await can(env.deps, actor, "store.read", { storeId: "" })).toBe(false);
    await expect(can(env.deps, actor, "billing.manage", { storeId: a.storeId })).rejects.toThrow(/not checked against/);
  });

  it("a Shopify product deletion only archives that shop's product, never another tenant's with the same id", async () => {
    const env = await makeEnv(undefined, { secrets: { shopifyApiSecret: SECRET } });
    const a = await shopifyStore(env, "a@example.com", "a-shop.myshopify.com");
    const b = await shopifyStore(env, "b@example.com", "b-shop.myshopify.com");
    const product = { id: 42, title: "Mug", status: "active", variants: [{ id: 420, price: "5" }] };
    await shopify(env, "a-shop.myshopify.com", "products/update", product);
    await shopify(env, "b-shop.myshopify.com", "products/update", product);
    await shopify(env, "a-shop.myshopify.com", "products/delete", { id: 42 });
    const rows = await env.deps.db.select({ storeId: schema.products.storeId, status: schema.products.status }).from(schema.products);
    expect(rows.find((r) => r.storeId === a.storeId)?.status).toBe("archived");
    expect(rows.find((r) => r.storeId === b.storeId)?.status).toBe("active");
  });
});

describe("audit log", () => {
  it("records the workspace and the request id with every store-level entry", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const res = await env.app.request(`/api/v1/stores/${t.storeId}/settings`, { method: "PATCH", headers: { origin: ORIGIN, cookie: t.c.cookie, "content-type": "application/json" }, body: JSON.stringify({ maxDiscountPercent: 20 }) });
    expect(res.status).toBe(204);
    const [row] = await env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "store.max_discount_set"));
    expect(row).toMatchObject({ organizationId: t.orgId, storeId: t.storeId, actorId: t.userId, actorType: "user", summary: { maxDiscountPercent: 20 } });
    expect(row?.correlationId).toBe(res.headers.get("x-request-id"));
  });

  it("keeps personal data and secrets out of summaries", async () => {
    expect(sanitizeSummary({ email: "a@b.co", apiKey: "k", firstName: "A", version: 2, reason: "x".repeat(500) })).toEqual({ version: 2, reason: "x".repeat(120) });
    expect(sanitizeSummary({ token: "t" })).toBeNull();
  });

  it("lists newest first with a cursor, and the workspace view includes every store's entries but no other workspace's", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const other = await setupStore(env, "other@example.com");
    for (let i = 0; i < 5; i++) { env.clock.t += 1000; await recordAudit(env.deps, { action: `test.${i}`, actorId: t.userId, storeId: t.storeId }); }
    await recordAudit(env.deps, { action: "test.elsewhere", actorId: other.userId, storeId: other.storeId });

    const first = await t.c.get(`/api/v1/stores/${t.storeId}/audit?limit=3`);
    expect(first.json.data.map((r: { action: string }) => r.action)).toEqual(["test.4", "test.3", "test.2"]);
    const next = await t.c.get(`/api/v1/stores/${t.storeId}/audit?limit=3&cursor=${encodeURIComponent(first.json.nextCursor)}`);
    expect(next.json.data.map((r: { action: string }) => r.action)).toEqual(["test.1", "test.0", "store.created"]);

    const org = (await t.c.get(`/api/v1/organizations/${t.orgId}/audit?limit=100`)).json.data.map((r: { action: string }) => r.action);
    expect(org).toContain("store.created");
    expect(org).not.toContain("test.elsewhere");
    expect((await t.c.get(`/api/v1/organizations/${other.orgId}/audit`)).status).toBe(404);
  });
});

describe("platform events", () => {
  it("publishing a campaign records one versioned event with the request id and no personal data", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const { campaignId, versionId } = await publishOne(t);
    const [e] = await events(env, "campaign.published");
    expect(e).toMatchObject({ organizationId: t.orgId, storeId: t.storeId, schemaVersion: 1, source: "api", privacy: "none", status: "delivered", payload: { campaignId, versionId, version: 1, tool: "toast", origin: "manual" } });
    expect(e?.correlationId).toBeTruthy();
    expect(await events(env, "store.connected")).toHaveLength(1);
  });

  it("a Shopify order becomes one event and one conversion however often it is delivered", async () => {
    const env = await makeEnv(undefined, { secrets: { shopifyApiSecret: SECRET } });
    const s = await shopifyStore(env, "a@example.com", "a-shop.myshopify.com");
    const order = { id: 555, total_price: "42.50", currency: "usd", created_at: "2026-10-27T10:00:00Z" };
    await shopify(env, "a-shop.myshopify.com", "orders/create", order);
    await shopify(env, "a-shop.myshopify.com", "orders/create", order); // a different delivery id for the same order
    const evs = await events(env, "order.created");
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ source: "shopify_webhook", correlationId: expect.any(String), payload: { platform: "shopify", externalOrderId: "555", total: 42.5, currency: "USD", placedAt: "2026-10-27T10:00:00.000Z" } });
    const conv = await env.deps.db.select().from(schema.conversions);
    expect(conv).toMatchObject([{ storeId: s.storeId, orderId: "shopify:555", total: 42.5, currency: "USD" }]);
    // An order with an unusable amount or currency is not an outcome: no event.
    await shopify(env, "a-shop.myshopify.com", "orders/create", { id: 556, total_price: "abc", currency: "USD" });
    await shopify(env, "a-shop.myshopify.com", "orders/create", { id: 557, total_price: "1", currency: "dollars" });
    expect(await events(env, "order.created")).toHaveLength(1);
  });

  it("a new module subscribes to paid orders without touching the webhook code (extension fixture)", async () => {
    const env = await makeEnv(undefined, { secrets: { shopifyApiSecret: SECRET } });
    await shopifyStore(env, "a@example.com", "a-shop.myshopify.com");
    const seen: number[] = [];
    const loyaltyFixture = defineSubscriber({ name: "fixture.loyalty_points", events: ["order.created"], async handle(_d, e) { seen.push(Math.floor(e.payload.total)); } });
    env.deps.subscribers = [...SUBSCRIBERS, loyaltyFixture];
    await shopify(env, "a-shop.myshopify.com", "orders/create", { id: 1, total_price: "19.99", currency: "USD", created_at: "2026-10-27T10:00:00Z" });
    expect(seen).toEqual([19]);
  });

  it("a failing subscriber is visible and retryable; subscribers that succeeded are not run again", async () => {
    const env = await makeEnv(undefined, { secrets: { shopifyApiSecret: SECRET } });
    const s = await shopifyStore(env, "a@example.com", "a-shop.myshopify.com");
    let healthy = false, okRuns = 0;
    const flaky: Subscriber = defineSubscriber({ name: "fixture.flaky", events: ["order.created"], async handle() { if (!healthy) throw new Error("downstream unavailable"); } });
    const counter: Subscriber = defineSubscriber({ name: "fixture.counter", events: ["order.created"], async handle() { okRuns++; } });
    env.deps.subscribers = [...SUBSCRIBERS, counter, flaky];

    const r = await shopify(env, "a-shop.myshopify.com", "orders/create", { id: 9, total_price: "10", currency: "USD", created_at: "2026-10-27T10:00:00Z" });
    expect(r.status).toBe(200); // the webhook is not failed by a downstream consumer
    const failed = await s.c.get(`/api/v1/stores/${s.storeId}/platform-events?status=failed`);
    expect(failed.json.data).toHaveLength(1);
    const ev = failed.json.data[0];
    expect(ev.lastError).toContain("fixture.flaky: downstream unavailable");
    expect(ev.deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ subscriber: "fixture.flaky", status: "failed" }),
      expect.objectContaining({ subscriber: "fixture.counter", status: "succeeded" }),
      expect.objectContaining({ subscriber: "analytics.record_platform_order", status: "succeeded" }),
    ]));
    expect(JSON.stringify(failed.json)).not.toContain("payload");

    // Another workspace cannot see or retry it.
    const other = await setupStore(env, "other@example.com");
    expect((await other.c.post(`/api/v1/stores/${other.storeId}/platform-events/${ev.id}/retry`)).status).toBe(404);

    healthy = true;
    expect((await s.c.post(`/api/v1/stores/${s.storeId}/platform-events/${ev.id}/retry`)).status).toBe(202);
    const [after] = await env.deps.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.id, ev.id));
    expect(after).toMatchObject({ status: "delivered", attempts: 2, lastError: null });
    expect(okRuns).toBe(1);
    expect((await s.c.post(`/api/v1/stores/${s.storeId}/platform-events/${ev.id}/retry`)).status).toBe(404); // nothing left to deliver
    expect((await env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "platform_event.retried")))).toHaveLength(1);
  });

  it("with a queue, publishing only enqueues; the sweep re-hands events whose enqueue was lost", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const sent: unknown[] = [];
    let lose = true;
    env.deps.enqueueDomainEvent = async (m) => { if (lose) throw new Error("queue unavailable"); sent.push(m); };
    const r = await publishDomainEvent(env.deps, { type: "campaign.paused", payload: { campaignId: "cmp_x" }, idempotencyKey: "k1", storeId: t.storeId, source: "api" });
    const [row] = await env.deps.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.id, r.id));
    expect(row?.status).toBe("pending");
    lose = false;
    expect(await sweepDomainEvents(env.deps)).toBe(0); // too recent: may still be in flight
    env.clock.t += 6 * 60_000;
    expect(await sweepDomainEvents(env.deps)).toBe(1);
    expect(sent).toEqual([{ kind: "domain_event", eventId: r.id }]);
    await dispatchDomainEvent(env.deps, r.id);
    expect(await sweepDomainEvents(env.deps)).toBe(0);
  });

  it("is idempotent per workspace key, and refuses payloads outside the contract", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const a = await publishDomainEvent(env.deps, { type: "campaign.archived", payload: { campaignId: "c1" }, idempotencyKey: "same", storeId: t.storeId, source: "api" });
    const b = await publishDomainEvent(env.deps, { type: "campaign.archived", payload: { campaignId: "c1" }, idempotencyKey: "same", storeId: t.storeId, source: "api" });
    expect(b).toEqual({ id: a.id, duplicate: true });
    await expect(publishDomainEvent(env.deps, { type: "customer.subscribed", payload: { contactId: "c", channel: "email", email: "a@b.co" } as never, idempotencyKey: "x", storeId: t.storeId, source: "api" })).rejects.toThrow(/invalid customer.subscribed payload/);
    await expect(publishDomainEvent(env.deps, { type: "campaign.archived", payload: { campaignId: "c1" }, idempotencyKey: "y", storeId: "sto_missing", source: "api" })).rejects.toThrow(/no workspace/);
  });

  it("erasing a contact deletes the pseudonymous events about them; retention purges old events", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const now = new Date(env.clock.t).toISOString();
    await env.deps.db.insert(schema.contacts).values({ id: "con_1", storeId: t.storeId, email: "a@example.com", emailStatus: "subscribed", source: "import", createdAt: now, updatedAt: now });
    await publishDomainEvent(env.deps, { type: "customer.subscribed", payload: { contactId: "con_1", channel: "email" }, idempotencyKey: "s1", storeId: t.storeId, source: "storefront" });
    await publishDomainEvent(env.deps, { type: "customer.subscribed", payload: { contactId: "con_2", channel: "email" }, idempotencyKey: "s2", storeId: t.storeId, source: "storefront" });
    expect((await t.c.del(`/api/v1/stores/${t.storeId}/contacts/con_1`)).status).toBe(204);
    const left = (await events(env, "customer.subscribed")).map((e) => (e.payload as { contactId: string }).contactId);
    expect(left).toEqual(["con_2"]);

    env.clock.t += 31 * 86_400_000;
    await purgeDomainEvents(env.deps);
    expect(await events(env, "customer.subscribed")).toHaveLength(0); // pseudonymous: 30 days at most
    expect((await events(env)).length).toBe(0); // everything else here was delivered, so also past its 30 days
  });

  it("store purge removes the store's events with it", async () => {
    const env = await makeEnv(undefined, { secrets: { shopifyApiSecret: SECRET } });
    const s = await shopifyStore(env, "a@example.com", "a-shop.myshopify.com");
    await shopify(env, "a-shop.myshopify.com", "orders/create", { id: 2, total_price: "5", currency: "USD", created_at: "2026-10-27T10:00:00Z" });
    await shopify(env, "a-shop.myshopify.com", "app/uninstalled", {});
    const kinds = (await events(env)).map((e) => e.type).sort();
    expect(kinds).toEqual(["order.created", "store.connected", "store.disconnected"]);
    const [aud] = await env.deps.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "store.disconnected"), eq(schema.auditLogs.storeId, s.storeId)));
    expect(aud).toMatchObject({ actorType: "platform", actorId: null, summary: { reason: "platform_uninstalled" } });
    await shopify(env, "a-shop.myshopify.com", "shop/redact", { shop_id: 1 });
    expect(await events(env)).toHaveLength(0);
    expect(await env.deps.db.select().from(schema.domainEventDeliveries)).toHaveLength(0);
  });
});

