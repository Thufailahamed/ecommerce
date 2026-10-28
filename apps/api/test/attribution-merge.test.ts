import { describe, expect, it } from "vitest";
import { schema } from "@convertflow/database";
import { makeEnv, setupStore, validConfig } from "./helpers.js";

describe("purchase from webhook and pixel merge into one conversion", () => {
  it("counts once and still attributes", async () => {
    const env = await makeEnv(undefined, { secrets: { shopifyApiSecret: "s" } });
    const s = await setupStore(env);
    const c = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns`, validConfig());
    await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    const ver = (await s.c.get(`/api/v1/stores/${s.storeId}/campaigns/${c.json.data.id}/versions`)).json.data[0].id as string;

    // 1) server-side record arrives first (e.g. a webhook): no attribution info
    await env.deps.db.insert(schema.conversions).values({ id: "cnv_x", storeId: s.storeId, orderId: "shopify:777", total: 50, currency: "USD", occurredAt: "2026-10-27T11:00:00.000Z" });
    // 2) pixel reports the same order with a last click
    await env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true, events: [{
      eventId: "px_gid777abc", type: "purchase_observed", siteId: s.siteKey, sessionId: "sess_12345678", occurredAt: "2026-10-27T11:05:00.000Z", schemaVersion: 1,
      order: { orderId: "shopify:777", total: 50, currency: "USD", lastClick: { campaignId: c.json.data.id, versionId: ver, clickedAt: "2026-10-27T10:00:00.000Z" } },
    }] }) });
    expect(await env.deps.db.select().from(schema.conversions)).toHaveLength(1);
    expect(await env.deps.db.select().from(schema.attributionRecords)).toHaveLength(1);
  });
});
