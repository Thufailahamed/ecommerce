import { describe, expect, it } from "vitest";
import { COUNTER_EVENTS, EventType, TOOL_METRICS, Tool, isCounterEvent } from "./index";

describe("tool metric definitions", () => {
  it("define a non-empty, duplicate-free metric list with a label for every tool", () => {
    for (const tool of Tool.options) {
      const defs = TOOL_METRICS[tool];
      expect(defs.length, tool).toBeGreaterThan(0);
      expect(new Set(defs.map((d) => d.key)).size, tool).toBe(defs.length);
      for (const d of defs) expect(d.label.trim(), `${tool}.${d.key}`).not.toBe("");
    }
  });

  it("show a rate only next to the counts it is made from", () => {
    const needs: Record<string, string[]> = {
      ctr: ["impressions", "clicks"], dismissRate: ["impressions", "dismissals"], addToCartRate: ["impressions", "addToCarts"],
      requestRate: ["impressions", "requested"], confirmRate: ["requested", "confirmed"],
    };
    for (const tool of Tool.options) {
      const keys = TOOL_METRICS[tool].map((d) => d.key) as string[];
      for (const [rate, parts] of Object.entries(needs)) if (keys.includes(rate)) for (const p of parts) expect(keys, `${tool}: ${rate} needs ${p}`).toContain(p);
    }
  });

  it("attribute orders to a campaign's tool only for tools that have a link to a click", () => {
    for (const tool of ["toast", "feed", "upsell"] as const) expect(TOOL_METRICS[tool].map((d) => d.key)).toContain("attributedRevenue");
    for (const tool of ["email", "sms"] as const) expect(TOOL_METRICS[tool].map((d) => d.key)).not.toContain("attributedRevenue");
  });

  it("counter events are real event types, and nothing else is treated as one", () => {
    for (const e of COUNTER_EVENTS) expect(EventType.options).toContain(e);
    expect(isCounterEvent("form_submit_success")).toBe(true);
    expect(isCounterEvent("campaign_click")).toBe(false);
    expect(isCounterEvent("constructor")).toBe(false);
  });
});
