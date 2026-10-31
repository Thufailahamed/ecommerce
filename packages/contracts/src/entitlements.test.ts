import { describe, expect, it } from "vitest";
import { CAPABILITIES, USAGE_METRICS, capabilityGranted, monthlyLimit, type Capability } from "./entitlements";
import { PLANS } from "./plans";

const none = new Set<string>();

describe("entitlements", () => {
  it("grants generally available capabilities from the plan alone", () => {
    expect(capabilityGranted("tools.upsell", PLANS.free, none)).toBe(false);
    expect(capabilityGranted("tools.upsell", PLANS.growth, none)).toBe(true);
    expect(capabilityGranted("experiments.run", PLANS.starter, none)).toBe(false);
    expect(capabilityGranted("restock.alerts", PLANS.growth, none)).toBe(true);
  });

  it("grants a preview only to a workspace with its flag, and still only on a plan that includes it", () => {
    expect(capabilityGranted("workflows.create", PLANS.scale, none)).toBe(false);
    expect(capabilityGranted("workflows.create", PLANS.scale, new Set(["workflows.create"]))).toBe(true);
    expect(capabilityGranted("workflows.create", PLANS.free, new Set(["workflows.create"]))).toBe(false);
  });

  it("never grants a planned capability, whatever the plan or flags", () => {
    const planned = (Object.keys(CAPABILITIES) as Capability[]).filter((c) => CAPABILITIES[c].availability === "planned");
    expect(planned).toEqual(expect.arrayContaining(["loyalty.enabled", "reviews.enabled", "post_purchase.enabled"]));
    for (const c of planned) for (const p of Object.values(PLANS)) expect(capabilityGranted(c, p, new Set(planned))).toBe(false);
  });

  it("grants SMS signup only on plans that include the tool and an SMS verification allowance", () => {
    expect(capabilityGranted("tools.sms", PLANS.growth, none)).toBe(true);
    expect(capabilityGranted("tools.sms", PLANS.scale, none)).toBe(true);
    expect(capabilityGranted("tools.sms", PLANS.starter, none)).toBe(false);
    expect(capabilityGranted("tools.sms", PLANS.free, none)).toBe(false);
    for (const p of Object.values(PLANS)) expect(capabilityGranted("tools.sms", p, none)).toBe(p.tools.includes("sms") && monthlyLimit(p, "sms_verifications") > 0);
  });

  it("maps each metered quantity to the plan's monthly allowance", () => {
    expect(monthlyLimit(PLANS.free, "pageviews")).toBe(PLANS.free.trackedPageviewsPerMonth);
    expect(monthlyLimit(PLANS.growth, "ai_generations")).toBe(PLANS.growth.aiGenerationsPerMonth);
    expect(monthlyLimit(PLANS.starter, "workflow_executions")).toBe(0);
    for (const m of USAGE_METRICS) for (const p of Object.values(PLANS)) expect(monthlyLimit(p, m)).toBeGreaterThanOrEqual(0);
  });
});
