import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { FakeTextProvider, type CompletionRequest } from "@convertflow/ai";
import { newId } from "../src/lib/crypto.js";
import { enableFeature } from "../src/services/entitlements.js";
import { unsupportedNumbers } from "../src/services/ai-tasks.js";
import { handleShopifyWebhook } from "../src/services/shopify.js";
import { linkShop, makeEnv, setPlan, setupStore, signup, validConfig, type Env } from "./helpers.js";

const join = async (env: Env, orgId: string, email: string, role: "admin" | "editor" | "viewer") => {
  const u = await signup(env, email);
  await env.deps.db.insert(schema.memberships).values({ id: newId("mem"), organizationId: orgId, userId: u.userId, role, createdAt: new Date(env.clock.t).toISOString() });
  return u;
};

/** 1,200 impressions and 48 clicks yesterday for one live campaign: CTR 4.0%. */
async function seedActivity(env: Env, storeId: string, campaignId: string) {
  const [c] = await env.deps.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
  await env.deps.db.insert(schema.analyticsAggregates).values({ storeId, campaignId, versionId: c!.publishedVersionId!, day: "2026-10-26", eligible: 3000, impressions: 1200, clicks: 48 });
}

async function setup(respond: (req: CompletionRequest) => string) {
  const env = await makeEnv();
  const fake = new FakeTextProvider(respond);
  env.deps.aiText = fake;
  const t = await setupStore(env);
  await setPlan(env, t.orgId, "growth");
  const made = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns`, validConfig());
  await t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${made.json.data.id}/publish`, { approve: true, approvedUpdatedAt: made.json.data.updatedAt });
  return { env, t, fake, campaignId: made.json.data.id as string };
}

describe("catalog platform events", () => {
  it("one event per import batch with counts only, and none when nothing changed", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const product = (id: string, available: boolean) => ({ externalId: id, title: `P${id}`, variants: [{ externalId: `${id}-v`, available }] });
    await t.c.post(`/api/v1/stores/${t.storeId}/products/import`, { products: [product("1", false), product("2", true)] });
    await t.c.post(`/api/v1/stores/${t.storeId}/products/import`, { products: [product("1", true)] });
    const events = await env.deps.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.type, "catalog.products_changed"));
    expect(events.map((e) => e.payload)).toEqual([
      { origin: "import", created: 2, updated: 0, archived: 0, restockedExternalIds: [] },
      { origin: "import", created: 0, updated: 1, archived: 0, restockedExternalIds: ["1"] },
    ]);
    expect(events.every((e) => e.privacy === "none" && e.storeId === t.storeId)).toBe(true);
  });

  it("a Shopify product webhook delivered twice records one event; a delete of an unknown product records none", async () => {
    const env = await makeEnv();
    const u = await signup(env, "s@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "shopify", name: "S", domain: "s.myshopify.com", currency: "USD" });
    await linkShop(env, s.json.data.id, "s.myshopify.com");
    const body = { id: 77, title: "Hat", handle: "hat", status: "active", variants: [{ id: 1, title: "Default", price: "10.00", inventory_quantity: 3 }] };
    for (let i = 0; i < 2; i++) await handleShopifyWebhook(env.deps, { topic: "products/create", shop: "s.myshopify.com", webhookId: "w1", body });
    await handleShopifyWebhook(env.deps, { topic: "products/delete", shop: "s.myshopify.com", webhookId: "w2", body: { id: 999 } });
    await handleShopifyWebhook(env.deps, { topic: "products/delete", shop: "s.myshopify.com", webhookId: "w3", body: { id: 77 } });
    const events = await env.deps.db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.type, "catalog.products_changed"), eq(schema.domainEvents.storeId, s.json.data.id)));
    expect(events.map((e) => [e.source, (e.payload as { created: number; archived: number }).created, (e.payload as { archived: number }).archived])).toEqual([["shopify_webhook", 1, 0], ["shopify_webhook", 0, 1]]);
  });
});

describe("AI insights", () => {
  it("answers by rule, without calling a model, when there is no data", async () => {
    const { t, fake } = await setup(() => { throw new Error("must not be called"); });
    const r = await t.c.post(`/api/v1/stores/${t.storeId}/ai/insights`, { days: 7 });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ generatedBy: "rule", highlights: [] });
    expect(fake.requests).toHaveLength(0);
  });

  it("shows the model aggregate evidence only, and rejects (and logs) an answer that invents a figure", async () => {
    let answer = JSON.stringify({ summary: "Your campaign had 1200 impressions and a 4.0% click-through rate.", highlights: ["48 clicks"] });
    const { env, t, fake, campaignId } = await setup(() => answer);
    await seedActivity(env, t.storeId, campaignId);
    const ok = await t.c.post(`/api/v1/stores/${t.storeId}/ai/insights`, { days: 7 });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ generatedBy: "ai", summary: expect.stringContaining("1200"), stale: false });
    expect(fake.requests[0]?.user).toContain("<evidence>");
    expect(fake.requests[0]?.user).not.toMatch(/@example\.com/);

    answer = JSON.stringify({ summary: "Revenue grew to 5400 this week.", highlights: [] });
    const bad = await t.c.post(`/api/v1/stores/${t.storeId}/ai/insights`, { days: 7 });
    expect(bad.status).toBe(422);
    expect(bad.json.error.details).toEqual(["figures not in the evidence: 5400"]);
    const logs = await env.deps.db.select().from(schema.aiGenerations).where(eq(schema.aiGenerations.task, "insights.summarize"));
    expect(logs.map((l) => l.status).sort()).toEqual(["rejected", "succeeded"]);
    expect((await env.deps.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.metric, "ai_generations")))[0]?.count).toBe(2);
  });

  it("treats small counts and evidence numbers as supported, anything else as invented", () => {
    expect(unsupportedNumbers("3 campaigns, 1,200 views, 7.5%", new Set(["1200"]))).toEqual(["7.5"]);
  });
});

describe("AI Commerce Manager", () => {
  const plan = (proposals: unknown[]) => JSON.stringify({ interpretation: "Reduce interruptions for shoppers", proposals });

  it("is a preview behind its own capability, and needs ai.generate", async () => {
    const { env, t } = await setup(() => plan([]));
    const path = `/api/v1/stores/${t.storeId}/ai/plans`;
    expect((await t.c.post(path, { objective: "Make the store less noisy" })).json.error.code).toBe("feature_unavailable");
    await enableFeature(env.deps, t.orgId, "ai.commerce_manager", null);
    expect((await t.c.post(path, { objective: "Make the store less noisy" })).status).toBe(201);
    const viewer = await join(env, t.orgId, "v@example.com", "viewer");
    expect((await viewer.c.post(path, { objective: "Make the store less noisy" })).status).toBe(403);
  });

  it("queues only proposals that pass every check, executes nothing, and runs one only on an approver's authority", async () => {
    let proposals: unknown[] = [];
    const { env, t, fake, campaignId } = await setup(() => plan(proposals));
    await enableFeature(env.deps, t.orgId, "ai.commerce_manager", null);
    await seedActivity(env, t.storeId, campaignId);
    const other = await setupStore(env, "other@example.com");
    const foreign = await other.c.post(`/api/v1/stores/${other.storeId}/campaigns`, validConfig());
    proposals = [
      { action: "campaign.pause", input: { campaignId }, rationale: "It had 1200 impressions but only 48 clicks.", evidence: ["impressions", "clicks"] },
      { action: "report.recommend", input: { title: "Watch click-through", metrics: ["ctr", "impressions"] }, rationale: "CTR is 4.0%.", evidence: ["ctr"] },
      { action: "campaign.pause", input: { campaignId: foreign.json.data.id }, rationale: "Pause it.", evidence: [] },
      { action: "report.recommend", input: { title: "Revenue", metrics: ["revenue_per_visitor"] }, rationale: "Revenue rose 37%.", evidence: ["profit"] },
      { action: "campaign.create_draft", input: { config: validConfig({ creative: { headline: "Take 20% off today", body: "Limited time.", ctaLabel: "Shop", ctaUrl: "/collections/all" } }) }, rationale: "A promotion could help.", evidence: [] },
    ];
    const discardedOf = (data: { discarded: { action: string; reasons: string[] }[] }) =>
      Object.fromEntries(data.discarded.map((x, i) => [`${i}:${x.action}`, x.reasons.join(" | ")]));
    const r = await t.c.post(`/api/v1/stores/${t.storeId}/ai/plans`, { objective: "Make the store less noisy" });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.data.requestIds).toHaveLength(2);
    expect(discardedOf(r.json.data)).toEqual({
      "0:campaign.pause": expect.stringMatching(/does not have/),
      "1:report.recommend": expect.stringMatching(/unknown metrics: profit.*figures not in the evidence: 37.*unknown metrics: revenue_per_visitor/),
      "2:campaign.create_draft": expect.stringMatching(/discount|promotion|%/i),
    });
    proposals = [
      { action: "note.record", input: { text: "hi" }, rationale: "x", evidence: [] },
      { action: "db.drop", input: {}, rationale: "x", evidence: [] },
    ];
    const r2 = await t.c.post(`/api/v1/stores/${t.storeId}/ai/plans`, { objective: "Make the store less noisy" });
    expect(r2.json.data.requestIds).toEqual([]);
    expect(discardedOf(r2.json.data)).toEqual({ "0:note.record": expect.stringMatching(/cannot be used by the AI/), "1:db.drop": "not a registered action" });
    // The model saw the registry and aggregate figures, never a contact or another tenant's data.
    expect(fake.requests[0]?.user).toContain("campaign.pause");
    expect(fake.requests[0]?.user).not.toContain(other.storeId);

    // Nothing ran yet.
    expect((await env.deps.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)))[0]?.status).toBe("active");
    const pending = await t.c.get(`/api/v1/stores/${t.storeId}/action-requests?status=pending&origin=ai&planId=${r.json.data.planId}`);
    expect(pending.json.data).toHaveLength(2);
    const pause = (pending.json.data as { id: string; action: string; evidence: { metrics: { key: string }[] }; expiresAt: string }[]).find((x) => x.action === "campaign.pause")!;
    expect(pause.evidence.metrics.map((m) => m.key).sort()).toEqual(["clicks", "impressions"]);
    expect(Date.parse(pause.expiresAt) - env.clock.t).toBe(3 * 86_400_000);

    // A viewer cannot approve it; an editor (who holds campaigns.write) can, and it runs once.
    const viewer = await join(env, t.orgId, "v@example.com", "viewer");
    expect((await viewer.c.post(`/api/v1/stores/${t.storeId}/action-requests/${pause.id}/approve`)).status).toBe(403);
    const editor = await join(env, t.orgId, "e@example.com", "editor");
    expect((await editor.c.post(`/api/v1/stores/${t.storeId}/action-requests/${pause.id}/approve`)).json.data.status).toBe("executed");
    expect((await env.deps.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)))[0]?.status).toBe("paused");
    const [paused] = await env.deps.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.type, "campaign.paused"));
    expect(paused?.correlationId).toBe(`aireq:${pause.id}`);
    expect((await env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "ai_plan.created"))).map((a) => a.summary))
      .toEqual(expect.arrayContaining([{ proposed: 5, queued: 2, discarded: 3 }, { proposed: 2, queued: 0, discarded: 2 }]));
  });

  it("queues a policy-checked campaign draft that, once approved, is created as a draft and never published", async () => {
    let proposals: unknown[] = [];
    const { env, t } = await setup(() => plan(proposals));
    await enableFeature(env.deps, t.orgId, "ai.commerce_manager", null);
    proposals = [{ action: "campaign.create_draft", input: { config: validConfig({ name: "Gentle welcome" }) }, rationale: "A calmer welcome message.", evidence: [] }];
    const r = await t.c.post(`/api/v1/stores/${t.storeId}/ai/plans`, { objective: "Welcome new visitors more gently" });
    expect(r.json.data.discarded).toEqual([]);
    const [id] = r.json.data.requestIds as string[];
    const done = await t.c.post(`/api/v1/stores/${t.storeId}/action-requests/${id}/approve`);
    const created = await env.deps.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, done.json.data.result.campaignId));
    expect(created[0]).toMatchObject({ name: "Gentle welcome", status: "draft", publishedVersionId: null });
  });

  it("rejects the whole answer when it does not match the task schema, and still meters it", async () => {
    const { env, t } = await setup(() => "I think you should pause things");
    await enableFeature(env.deps, t.orgId, "ai.commerce_manager", null);
    const r = await t.c.post(`/api/v1/stores/${t.storeId}/ai/plans`, { objective: "Make the store less noisy" });
    expect(r.status).toBe(422);
    expect(await env.deps.db.select().from(schema.actionRequests)).toHaveLength(0);
    expect((await env.deps.db.select().from(schema.aiGenerations).where(eq(schema.aiGenerations.task, "objective.plan")))[0]?.status).toBe("rejected");
  });
});
