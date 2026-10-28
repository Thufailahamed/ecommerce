import { describe, expect, it, vi } from "vitest";
import { schema } from "@convertflow/database";
import { processEvents } from "../src/services/events.js";
import { makeEnv, setupStore, validConfig, type Env } from "./helpers.js";

async function live() {
  const env = await makeEnv();
  const s = await setupStore(env);
  const c = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig());
  await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
  const versionId = (await s.c.get(`/api/v1/stores/${s.storeId}/campaigns/${c.json.data.id}/versions`)).json.data[0].id as string;
  return { env, ...s, campaignId: c.json.data.id as string, versionId };
}
const ev = (siteId: string, o: Record<string, unknown>) => ({ eventId: `e_${Math.random().toString(36).slice(2, 14)}`, siteId, sessionId: "sess_12345678", occurredAt: "2026-10-27T12:00:00.000Z", schemaVersion: 1, ...o });
const send = (env: Env, events: unknown[]) => env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ consent: true, events }) });
const totals = async (env: Env) => (await env.deps.db.select().from(schema.analyticsAggregates));

describe("event ingestion path", () => {
  it("makes no D1 query at all on the hot path when the site is cached", async () => {
    const t = await live();
    const queued: unknown[] = [];
    t.env.deps.enqueueEvents = async (m) => { queued.push(m); };
    const spy = vi.spyOn(t.env.deps.db, "select");
    const res = await send(t.env, [ev(t.siteKey, { type: "campaign_impression", campaignId: t.campaignId, versionId: t.versionId })]);
    expect(res.status).toBe(202);
    expect(queued).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled(); // KV + queue only: nothing to contend with the consumer's writes
  });
  it("falls back to D1 once on a cold cache, then serves from KV", async () => {
    const t = await live();
    t.env.kv.delete(`site:${t.siteKey}`);
    const spy = vi.spyOn(t.env.deps.db, "select");
    await send(t.env, [ev(t.siteKey, { type: "campaign_impression", campaignId: t.campaignId, versionId: t.versionId })]);
    const afterFirst = spy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(JSON.parse(t.env.kv.get(`site:${t.siteKey}`)!)).toMatchObject({ id: t.storeId, active: true });
    await send(t.env, [ev(t.siteKey, { type: "campaign_impression", campaignId: t.campaignId, versionId: t.versionId })]);
    expect(spy.mock.calls.length - afterFirst).toBeLessThanOrEqual(5); // only the inline processing, no store lookup
  });
  it("a disconnect stops ingestion immediately, even though the site entry was cached", async () => {
    const t = await live();
    expect((await send(t.env, [ev(t.siteKey, { type: "campaign_impression", campaignId: t.campaignId, versionId: t.versionId })])).status).toBe(202);
    await t.c.req("DELETE", `/api/v1/stores/${t.storeId}`);
    expect((await send(t.env, [ev(t.siteKey, { type: "campaign_impression", campaignId: t.campaignId, versionId: t.versionId })])).status).toBe(204);
    expect((await totals(t.env))[0]?.impressions).toBe(1);
  });
  it("negatively caches unknown site keys so scanners cannot hammer the database", async () => {
    const env = await makeEnv();
    expect((await send(env, [ev("cf_doesnotexist01", { type: "campaign_impression" })])).status).toBe(204);
    expect(JSON.parse(env.kv.get("site:cf_doesnotexist01")!)).toEqual({ id: "", active: false });
    const spy = vi.spyOn(env.deps.db, "select");
    expect((await send(env, [ev("cf_doesnotexist01", { type: "campaign_impression" })])).status).toBe(204);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("batched event processing", () => {
  it("counts a full 50-event mixed batch exactly, including ids repeated inside the batch", async () => {
    const t = await live();
    const base = { siteId: t.siteKey, campaignId: t.campaignId, versionId: t.versionId };
    const events: Record<string, unknown>[] = [];
    for (let i = 0; i < 20; i++) events.push(ev(t.siteKey, { ...base, type: "campaign_impression" }));
    for (let i = 0; i < 12; i++) events.push(ev(t.siteKey, { ...base, type: "campaign_eligible" }));
    for (let i = 0; i < 6; i++) events.push(ev(t.siteKey, { ...base, type: "campaign_click" }));
    for (let i = 0; i < 3; i++) events.push(ev(t.siteKey, { ...base, type: "campaign_dismiss" }));
    events.push(ev(t.siteKey, { ...base, type: "notification_subscribed" }));
    events.push({ ...events[0]!, type: "campaign_impression" }, { ...events[1]! }); // two repeats of existing ids
    events.push(ev(t.siteKey, { ...base, versionId: "ver_forged", type: "campaign_impression" })); // forged version
    events.push(ev(t.siteKey, { ...base, type: "campaign_impression", occurredAt: "2026-10-28T01:00:00.000Z" })); // next day
    const r = await processEvents(t.env.deps, { storeId: t.storeId, events: events as never });
    expect(r).toEqual({ accepted: 43, duplicates: 2, rejected: 1 });
    const rows = (await totals(t.env)).sort((a, b) => a.day.localeCompare(b.day));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ day: "2026-10-27", impressions: 20, eligible: 12, clicks: 6, dismissals: 3, subscriptions: 1 });
    expect(rows[1]).toMatchObject({ day: "2026-10-28", impressions: 1 });
  });
  it("is idempotent when the same message is delivered again (queue retry)", async () => {
    const t = await live();
    const base = { siteId: t.siteKey, campaignId: t.campaignId, versionId: t.versionId };
    const events = Array.from({ length: 50 }, () => ev(t.siteKey, { ...base, type: "campaign_impression" }));
    await processEvents(t.env.deps, { storeId: t.storeId, events: events as never });
    const again = await processEvents(t.env.deps, { storeId: t.storeId, events: events as never });
    expect(again).toEqual({ accepted: 0, duplicates: 50, rejected: 0 });
    expect((await totals(t.env))[0]?.impressions).toBe(50);
  });
  it("uses a small, constant number of queries per batch regardless of its size", async () => {
    const t = await live();
    const base = { siteId: t.siteKey, campaignId: t.campaignId, versionId: t.versionId };
    const run = async (n: number) => {
      const events = Array.from({ length: n }, () => ev(t.siteKey, { ...base, type: "campaign_impression" }));
      const s = vi.spyOn(t.env.deps.db, "select"), i = vi.spyOn(t.env.deps.db, "insert");
      await processEvents(t.env.deps, { storeId: t.storeId, events: events as never });
      const total = s.mock.calls.length + i.mock.calls.length;
      s.mockRestore(); i.mockRestore();
      return total;
    };
    const small = await run(5), big = await run(50);
    expect(big).toBeLessThanOrEqual(small + 2); // dedup chunks (<=2) are the only thing that grows
    expect(big).toBeLessThanOrEqual(8);
  });
  it("experiment arms in one batch are summed per arm", async () => {
    const t = await live();
    const base = { siteId: t.siteKey, campaignId: t.campaignId, versionId: t.versionId, type: "experiment_assigned" };
    const events = [...Array(7).fill(0).map(() => ev(t.siteKey, { ...base, group: "treatment" })), ...Array(3).fill(0).map(() => ev(t.siteKey, { ...base, group: "holdout" }))];
    await processEvents(t.env.deps, { storeId: t.storeId, events: events as never });
    const rows = await t.env.deps.db.select().from(schema.experimentStats);
    expect(Object.fromEntries(rows.map((r) => [r.group, r.sessions]))).toEqual({ treatment: 7, holdout: 3 });
  });
});
