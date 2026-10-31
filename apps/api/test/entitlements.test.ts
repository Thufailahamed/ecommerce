import { describe, expect, it } from "vitest";
import { HttpError } from "../src/deps.js";
import { enableFeature, entitlementsFor, quota, recordUsage, requireCapability, requireQuota } from "../src/services/entitlements.js";
import { makeEnv, setPlan, setupStore } from "./helpers.js";

describe("entitlement service", () => {
  it("answers 402 for a plan gap and 403 for a preview the workspace is not in", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    await expect(requireCapability(env.deps, t.orgId, "experiments.run")).rejects.toMatchObject({ status: 402, code: "plan_limit" });
    await setPlan(env, t.orgId, "growth");
    await requireCapability(env.deps, t.orgId, "experiments.run");
    await expect(requireCapability(env.deps, t.orgId, "workflows.create")).rejects.toMatchObject({ status: 403, code: "feature_unavailable" });
    await enableFeature(env.deps, t.orgId, "workflows.create", null);
    await requireCapability(env.deps, t.orgId, "workflows.create");
    await expect(requireCapability(env.deps, t.orgId, "loyalty.enabled")).rejects.toBeInstanceOf(HttpError);
    await expect(enableFeature(env.deps, t.orgId, "loyalty.enabled", null)).rejects.toThrow(/not a preview/);
  });

  it("an unpaid subscription falls back to the free plan's capabilities", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    await setPlan(env, t.orgId, "growth");
    const { eq } = await import("drizzle-orm");
    const { schema } = await import("@convertflow/database");
    await env.deps.db.update(schema.subscriptions).set({ status: "past_due" }).where(eq(schema.subscriptions.organizationId, t.orgId));
    expect((await entitlementsFor(env.deps, t.orgId)).has("tools.upsell")).toBe(false);
  });

  it("counts usage per month and enforces the allowance", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    expect(await recordUsage(env.deps, t.orgId, "ai_generations", 2)).toEqual({ before: 0, after: 2 });
    expect(await recordUsage(env.deps, t.orgId, "ai_generations")).toEqual({ before: 2, after: 3 });
    expect(await quota(env.deps, t.orgId, "ai_generations")).toEqual({ used: 3, limit: 3, remaining: 0 });
    await expect(requireQuota(env.deps, t.orgId, "ai_generations", (q) => `all ${q.limit} used`)).rejects.toMatchObject({ status: 402, message: "all 3 used" });
    env.clock.t += 40 * 86_400_000; // next month
    expect((await quota(env.deps, t.orgId, "ai_generations")).used).toBe(0);
  });

  it("the billing endpoint reports limits and capabilities without claiming planned ones", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const r = await t.c.get(`/api/v1/billing/subscription?organizationId=${t.orgId}`);
    expect(r.json.data.usage).toEqual({ pageviews: 0, aiGenerations: 0 });
    expect(r.json.data.limits.ai_generations).toEqual({ used: 0, limit: 3 });
    const caps = Object.fromEntries(r.json.data.capabilities.map((c: { capability: string; granted: boolean }) => [c.capability, c.granted]));
    expect(caps["tools.toast"]).toBe(true);
    expect(caps["tools.sms"]).toBe(false);
    expect(caps["loyalty.enabled"]).toBe(false);
  });
});
