import { describe, expect, it } from "vitest";
import { schema } from "@convertflow/database";
import { SHIPPED_TOOLS } from "@convertflow/contracts";
import { makeEnv, setupStore, validConfig, type Env } from "./helpers.js";

const feed = (o: Record<string, unknown> = {}) => validConfig({ tool: "feed", format: "feed_item", feed: { category: "Offers" }, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, ...o });
const ev = (siteId: string, o: Record<string, unknown>) => ({ eventId: `e_${Math.random().toString(36).slice(2, 14)}`, siteId, sessionId: "sess_12345678", occurredAt: "2026-10-27T12:00:00.000Z", schemaVersion: 1, ...o });
const send = (env: Env, events: unknown[]) => env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ consent: true, events }) });

async function liveFeed(env?: Env) {
  const e = env ?? (await makeEnv());
  const s = await setupStore(e, `f${Math.random().toString(36).slice(2, 8)}@example.com`);
  const base = `/api/v1/stores/${s.storeId}/campaigns`;
  const c = await s.c.post(base, feed());
  const pub = await s.c.post(`${base}/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
  const versionId = (await s.c.get(`${base}/${c.json.data.id}/versions`)).json.data[0].id as string;
  return { env: e, ...s, base, publishStatus: pub.status, campaignId: c.json.data.id as string, versionId };
}

describe("feed is a shipped tool", () => {
  it("is in the shipped list and publishes on the free plan", async () => {
    expect(SHIPPED_TOOLS.has("feed")).toBe(true);
    const t = await liveFeed();
    expect(t.publishStatus).toBe(200);
  });

  it("is served with the version's publication date so the feed can show and order by it", async () => {
    const t = await liveFeed();
    const cfg = await (await t.env.app.request(`/sdk/v1/config/${t.siteKey}.json`)).json() as { campaigns: { campaignId: string; publishedAt?: string; config: { tool?: string; feed?: { category: string } } }[] };
    const served = cfg.campaigns.find((c) => c.campaignId === t.campaignId)!;
    expect(served.config).toMatchObject({ tool: "feed", feed: { category: "Offers" } });
    expect(served.publishedAt).toBe("2026-10-27T12:00:00.000Z"); // the test clock
  });

  it("a scheduled feed item expires from the served config's rules (endsAt is carried for the SDK to enforce)", async () => {
    const e = await makeEnv();
    const s = await setupStore(e);
    const base = `/api/v1/stores/${s.storeId}/campaigns`;
    const c = await s.c.post(base, feed({ schedule: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" } }));
    await s.c.post(`${base}/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    const cfg = await (await e.app.request(`/sdk/v1/config/${s.siteKey}.json`)).json() as { campaigns: { config: { schedule: { endsAt?: string } } }[] };
    expect(cfg.campaigns[0]!.config.schedule.endsAt).toBe("2026-11-01T00:00:00Z");
  });
});

describe("feed analytics", () => {
  it("counts items shown in an opened panel as impressions and item clicks as clicks, once each", async () => {
    const t = await liveFeed();
    const base = { siteId: t.siteKey, campaignId: t.campaignId, versionId: t.versionId };
    const dup = ev(t.siteKey, { ...base, type: "feed_open" });
    const res = await send(t.env, [dup, dup, ev(t.siteKey, { ...base, type: "feed_open" }), ev(t.siteKey, { ...base, type: "feed_item_click" })]);
    expect(res.status).toBe(202);
    const [row] = await t.env.deps.db.select().from(schema.analyticsAggregates);
    expect(row).toMatchObject({ campaignId: t.campaignId, impressions: 2, clicks: 1, dismissals: 0 }); // the repeated event id was counted once
  });

  it("shows feed activity in the merchant's analytics, per campaign", async () => {
    const t = await liveFeed();
    const base = { siteId: t.siteKey, campaignId: t.campaignId, versionId: t.versionId };
    await send(t.env, [ev(t.siteKey, { ...base, type: "campaign_eligible" }), ev(t.siteKey, { ...base, type: "feed_open" }), ev(t.siteKey, { ...base, type: "feed_item_click" })]);
    const r = await t.c.get(`/api/v1/stores/${t.storeId}/analytics?from=2026-10-27&to=2026-10-27`);
    expect(r.json.data.totals).toMatchObject({ eligible: 1, impressions: 1, clicks: 1 });
    expect(r.json.data.campaigns[0]).toMatchObject({ campaignId: t.campaignId, ctr: 1 });
  });

  it("ignores feed events that reference another store's campaign or a forged version", async () => {
    const a = await liveFeed();
    const b = await liveFeed(a.env);
    // b's site key with a's campaign: must create nothing.
    await send(a.env, [
      ev(b.siteKey, { siteId: b.siteKey, type: "feed_open", campaignId: a.campaignId, versionId: a.versionId }),
      ev(b.siteKey, { siteId: b.siteKey, type: "feed_open", campaignId: b.campaignId, versionId: "ver_forged" }),
    ]);
    const rows = await a.env.deps.db.select().from(schema.analyticsAggregates);
    expect(rows).toHaveLength(0);
  });

  it("feed events carry no personal data: the contract strips anything extra", async () => {
    const t = await liveFeed();
    const base = { siteId: t.siteKey, campaignId: t.campaignId, versionId: t.versionId };
    const res = await send(t.env, [ev(t.siteKey, { ...base, type: "feed_open", email: "a@b.co", userAgent: "x" })]);
    expect(res.status).toBe(202);
    const [row] = await t.env.deps.db.select().from(schema.analyticsAggregates);
    expect(JSON.stringify(row)).not.toContain("a@b.co");
  });
});
