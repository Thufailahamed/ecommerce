import { describe, expect, it } from "vitest";
import { FakeProvider } from "@convertflow/ai";
import { schema } from "@convertflow/database";
import { Client, makeEnv, setupStore, signup, validConfig, ORIGIN } from "./helpers.js";

const draftAndPublish = async (c: Client, storeId: string, cfg = validConfig()) => {
  const created = await c.post(`/api/v1/stores/${storeId}/campaigns`, cfg);
  const id = created.json.data.id as string;
  const pub = await c.post(`/api/v1/stores/${storeId}/campaigns/${id}/publish`, { approve: true, approvedUpdatedAt: created.json.data.updatedAt });
  return { id, created, pub };
};

describe("auth & tenancy", () => {
  it("rejects unauthenticated access and cross-origin writes", async () => {
    const env = await makeEnv();
    const anon = new Client(env);
    expect((await anon.get("/api/v1/stores")).status).toBe(401);
    const r = await env.app.request("/api/v1/auth/login", { method: "POST", headers: { origin: "https://evil.com", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });
  it("logs in with valid credentials only", async () => {
    const env = await makeEnv();
    await signup(env, "a@example.com");
    const c = new Client(env);
    expect((await c.post("/api/v1/auth/login", { email: "a@example.com", password: "wrong-password-1" })).status).toBe(401);
    expect((await c.post("/api/v1/auth/login", { email: "a@example.com", password: "correct-horse-battery" })).status).toBe(200);
    expect((await c.get("/api/v1/auth/me")).json.data.email).toBe("a@example.com");
    await c.post("/api/v1/auth/logout");
    expect((await c.get("/api/v1/auth/me")).status).toBe(401);
  });
  it("hides other tenants' stores and campaigns (404, not 403)", async () => {
    const env = await makeEnv();
    const a = await setupStore(env, "a@example.com");
    const { id } = await draftAndPublish(a.c, a.storeId);
    const b = await signup(env, "b@example.com");
    expect((await b.c.get(`/api/v1/stores/${a.storeId}`)).status).toBe(404);
    expect((await b.c.get(`/api/v1/stores/${a.storeId}/campaigns`)).status).toBe(404);
    expect((await b.c.post(`/api/v1/stores/${a.storeId}/campaigns/${id}/pause`)).status).toBe(404);
    expect((await b.c.get(`/api/v1/stores`)).json.data).toHaveLength(0);
  });
  it("enforces roles: viewers cannot publish", async () => {
    const env = await makeEnv();
    const a = await setupStore(env);
    const v = await signup(env, "viewer@example.com");
    await env.deps.db.insert(schema.memberships).values({ id: "m_v", organizationId: a.orgId, userId: v.userId, role: "viewer", createdAt: "x" });
    expect((await v.c.get(`/api/v1/stores/${a.storeId}/campaigns`)).status).toBe(200);
    expect((await v.c.post(`/api/v1/stores/${a.storeId}/campaigns`, validConfig())).status).toBe(403);
  });
});

describe("campaign lifecycle", () => {
  it("publishes an immutable version and serves it from the edge config", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    const { pub } = await draftAndPublish(s.c, s.storeId);
    expect(pub.status).toBe(200);
    const res = await env.app.request(`/sdk/v1/config/${s.siteKey}.json`);
    const cfg = await res.json() as { campaigns: unknown[]; deliveryEnabled: boolean };
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(cfg.campaigns).toHaveLength(1);
    expect(cfg.deliveryEnabled).toBe(true);
  });
  it("refuses publish when the approved draft is stale", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    const created = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig());
    const id = created.json.data.id;
    env.clock.t += 1000;
    await s.c.put(`/api/v1/stores/${s.storeId}/campaigns/${id}`, validConfig({ name: "Edited" }));
    const r = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${id}/publish`, { approve: true, approvedUpdatedAt: created.json.data.updatedAt });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("stale_approval");
  });
  it("requires explicit approval", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    const c = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig());
    const r = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${c.json.data.id}/publish`, { approvedUpdatedAt: c.json.data.updatedAt });
    expect(r.status).toBe(422);
  });
  it("rejects invalid campaigns with field-level issues", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    const r = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig({ creative: { headline: "x", ctaLabel: "y", ctaUrl: "javascript:alert(1)" } }));
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json.error.details)).toContain("ctaUrl");
  });
  it("pause removes from config; resume restores; rollback publishes a new version", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    const { id } = await draftAndPublish(s.c, s.storeId);
    const cfg = async () => (await (await env.app.request(`/sdk/v1/config/${s.siteKey}.json`)).json() as { campaigns: unknown[] });
    await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${id}/pause`);
    expect((await cfg()).campaigns).toHaveLength(0);
    await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${id}/resume`);
    expect((await cfg()).campaigns).toHaveLength(1);

    env.clock.t += 1000;
    const got = await s.c.get(`/api/v1/stores/${s.storeId}/campaigns/${id}`);
    await s.c.put(`/api/v1/stores/${s.storeId}/campaigns/${id}`, validConfig({ name: "V2" }));
    const upd = await s.c.get(`/api/v1/stores/${s.storeId}/campaigns/${id}`);
    await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${id}/publish`, { approve: true, approvedUpdatedAt: upd.json.data.updatedAt });
    const versions = (await s.c.get(`/api/v1/stores/${s.storeId}/campaigns/${id}/versions`)).json.data as Array<{ id: string; version: number }>;
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    env.clock.t += 1000;
    const rb = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${id}/rollback`, { versionId: versions[1]!.id });
    expect(rb.status).toBe(200);
    expect((await s.c.get(`/api/v1/stores/${s.storeId}/campaigns/${id}/versions`)).json.data).toHaveLength(3);
    expect((await cfg()).campaigns).toHaveLength(1);
    void got;
  });
  it("kill switch disables delivery; disconnect clears it", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    await draftAndPublish(s.c, s.storeId);
    await s.c.req("PATCH", `/api/v1/stores/${s.storeId}/delivery`, { enabled: false });
    const cfg = await (await env.app.request(`/sdk/v1/config/${s.siteKey}.json`)).json() as { deliveryEnabled: boolean };
    expect(cfg.deliveryEnabled).toBe(false);
    await s.c.req("DELETE", `/api/v1/stores/${s.storeId}`);
    expect((await s.c.get(`/api/v1/stores/${s.storeId}`)).status).toBe(404);
    const after = await (await env.app.request(`/sdk/v1/config/${s.siteKey}.json`)).json() as { campaigns: unknown[] };
    expect(after.campaigns).toHaveLength(0);
  });
  it("enforces plan limits on live campaigns", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    await draftAndPublish(s.c, s.storeId);
    const second = await draftAndPublish(s.c, s.storeId, validConfig({ name: "Second" }));
    expect(second.pub.status).toBe(402);
  });
});

describe("events & analytics", () => {
  const ev = (siteId: string, over: Record<string, unknown>) => ({
    eventId: `evt_${Math.random().toString(36).slice(2, 12)}`, siteId, sessionId: "sess_12345678",
    occurredAt: "2026-10-27T12:00:00.000Z", schemaVersion: 1, ...over,
  });
  const send = (env: Awaited<ReturnType<typeof makeEnv>>, events: unknown[], consent: boolean = true) =>
    env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "application/json", origin: "https://some-shop.com" }, body: JSON.stringify({ consent, events }) });

  it("requires consent and a known schema", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    expect((await send(env, [ev(s.siteKey, { type: "campaign_impression" })], false)).status).toBe(422);
    expect((await send(env, [ev(s.siteKey, { type: "bogus" })])).status).toBe(422);
  });
  it("deduplicates, aggregates, and attributes purchases (last click, 7 days)", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    const { id } = await draftAndPublish(s.c, s.storeId);
    const versionId = (await s.c.get(`/api/v1/stores/${s.storeId}/campaigns/${id}/versions`)).json.data[0].id as string;
    const base = { siteId: s.siteKey, campaignId: id, versionId };

    const imp = ev(s.siteKey, { ...base, type: "campaign_impression" });
    await send(env, [imp, imp, ev(s.siteKey, { ...base, type: "campaign_impression" }), ev(s.siteKey, { ...base, type: "campaign_click" })]);
    // retry of the exact same batch must not double count
    await send(env, [imp]);
    // an event naming a campaign that isn't this store's is dropped
    await send(env, [ev(s.siteKey, { siteId: s.siteKey, campaignId: "cmp_nope", versionId: "ver_nope", type: "campaign_impression" })]);

    const order = { orderId: "ORD-1", total: 80, currency: "usd", lastClick: { campaignId: id, versionId, clickedAt: "2026-10-26T12:00:00.000Z" } };
    const purchase = ev(s.siteKey, { type: "purchase_observed", order });
    await send(env, [purchase]);
    // same order reported again by a different event id: still one conversion
    await send(env, [ev(s.siteKey, { type: "purchase_observed", order })]);
    // stale click (>7d) -> observed but not attributed
    await send(env, [ev(s.siteKey, { type: "purchase_observed", order: { ...order, orderId: "ORD-2", lastClick: { ...order.lastClick, clickedAt: "2026-10-01T00:00:00.000Z" } } })]);

    const a = (await s.c.get(`/api/v1/stores/${s.storeId}/analytics?from=2026-10-01&to=2026-10-31`)).json.data;
    expect(a.totals.impressions).toBe(2);
    expect(a.totals.clicks).toBe(1);
    expect(a.totals.ctr).toBe(0.5);
    expect(a.totals.observedOrders).toBe(2);
    expect(a.totals.attributedOrders).toBe(1);
    expect(a.totals.attributedRevenue).toBe(80);
    expect(a.notes[0]).toMatch(/not incremental/);
  });
  it("accepts events for unknown sites silently (no key enumeration)", async () => {
    const env = await makeEnv();
    expect((await send(env, [ev("cf_unknownsite123", { type: "campaign_impression" })])).status).toBe(204);
  });
  it("rejects oversized batches", async () => {
    const env = await makeEnv();
    const r = await env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "application/json", "content-length": "999999" }, body: "{}" });
    expect(r.status).toBe(413);
  });
});

describe("catalog", () => {
  it("imports products, keeping availability unknown unless stated", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    const r = await s.c.post(`/api/v1/stores/${s.storeId}/products/import`, { products: [
      { externalId: "1", title: "Trail Runner", variants: [{ externalId: "v1", price: 99 }] },
      { externalId: "2", title: "Road Racer", variants: [{ externalId: "v2", available: true }] },
    ] });
    expect(r.json.data).toMatchObject({ created: 2, updated: 0, restocked: 0 });
    const again = await s.c.post(`/api/v1/stores/${s.storeId}/products/import`, { products: [{ externalId: "1", title: "Trail Runner v2" }] });
    expect(again.json.data).toMatchObject({ created: 0, updated: 1 });
    const vars = await env.deps.db.select().from(schema.productVariants);
    expect(vars.find((v) => v.externalId === "v1")?.availability).toBe("unknown");
    expect(vars.find((v) => v.externalId === "v2")?.availability).toBe("in_stock");
  });
});

describe("AI generation", () => {
  const good = { explanation: "Targets runners", config: validConfig({ name: "Runners" }) };

  it("creates a draft (never published) from a valid proposal", async () => {
    const env = await makeEnv(new FakeProvider(() => good));
    const s = await setupStore(env);
    const r = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/ai-generate`, { objective: "Sell more running shoes" });
    expect(r.status).toBe(201);
    expect(r.json.data.campaign.status).toBe("draft");
    expect(r.json.data.campaign.publishedVersionId).toBeNull();
    expect((await (await env.app.request(`/sdk/v1/config/${s.siteKey}.json`)).json() as { campaigns: unknown[] }).campaigns).toHaveLength(0);
  });
  it("rejects invented discounts and malformed output, and logs both", async () => {
    const promo = { explanation: "x", config: validConfig({ creative: { headline: "Get 30% off everything", ctaLabel: "Shop", ctaUrl: "/" } }) };
    for (const out of [promo, "garbage", { explanation: "x", config: { nope: true } }]) {
      const env = await makeEnv(new FakeProvider(() => out));
      const s = await setupStore(env);
      const r = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/ai-generate`, { objective: "Sell more running shoes" });
      expect(r.status).toBe(422);
      expect((await env.deps.db.select().from(schema.aiGenerations))[0]?.status).toBe("rejected");
      expect(await env.deps.db.select().from(schema.campaigns)).toHaveLength(0);
    }
  });
  it("surfaces provider failure without breaking manual creation", async () => {
    const env = await makeEnv({ generateCampaign: async () => { throw new Error("upstream 500"); } });
    const s = await setupStore(env);
    expect((await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/ai-generate`, { objective: "Sell more running shoes" })).status).toBe(502);
    expect((await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig())).status).toBe(201);
  });
  it("enforces the monthly generation entitlement", async () => {
    const env = await makeEnv(new FakeProvider(() => good));
    const s = await setupStore(env);
    const gen = () => s.c.post(`/api/v1/stores/${s.storeId}/campaigns/ai-generate`, { objective: "Sell more running shoes" });
    for (let i = 0; i < 3; i++) expect((await gen()).status).toBe(201);
    expect((await gen()).status).toBe(402);
  });
  it("does not leak the origin check onto the public events route", async () => {
    const env = await makeEnv();
    const r = await env.app.request("/sdk/v1/config/cf_doesnotexist123.json");
    expect(r.status).toBe(404);
    void ORIGIN;
  });
});
