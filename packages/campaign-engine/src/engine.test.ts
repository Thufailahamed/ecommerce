import { describe, expect, it } from "vitest";
import type { PublishedCampaign, StorefrontConfig } from "@convertflow/contracts";
import { CampaignConfig } from "@convertflow/contracts";
import { evaluateCampaign, selectCampaign, type SuppressionState, type VisitorContext } from "./index.js";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const ctx = (o: Partial<VisitorContext> = {}): VisitorContext => ({
  now: NOW, pageType: "product", urlPath: "/products/shoe", device: "desktop",
  visitorType: "new", pagesViewed: 1, ...o,
});
const empty = (): SuppressionState => ({ sessionImpressions: {}, visitorImpressions: {}, dismissedAt: {}, clickedAt: {} });

const mk = (id: string, over: Record<string, unknown> = {}): PublishedCampaign => ({
  campaignId: id, versionId: `${id}_v1`,
  config: CampaignConfig.parse({
    schemaVersion: 1, name: id, format: "popup",
    creative: { headline: "Hi", ctaLabel: "Go", ctaUrl: "/collections/all" },
    style: {}, trigger: { type: "immediate" },
    targeting: { match: "all", conditions: [] },
    frequency: {}, goal: { type: "clicks" }, ...over,
  }),
});

describe("targeting", () => {
  it("matches page type", () => {
    const c = mk("a", { targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["product"] }] } });
    expect(evaluateCampaign(c, ctx(), empty()).eligible).toBe(true);
    expect(evaluateCampaign(c, ctx({ pageType: "home" }), empty()).reason).toBe("targeting_mismatch");
  });
  it("any vs all", () => {
    const conds = [
      { field: "device", op: "in", value: ["mobile"] },
      { field: "visitor_type", op: "equals", value: "new" },
    ];
    expect(evaluateCampaign(mk("a", { targeting: { match: "any", conditions: conds } }), ctx(), empty()).eligible).toBe(true);
    expect(evaluateCampaign(mk("a", { targeting: { match: "all", conditions: conds } }), ctx(), empty()).eligible).toBe(false);
  });
  it("unknown data never satisfies a condition", () => {
    const c = mk("a", { targeting: { match: "all", conditions: [{ field: "product_available", op: "equals", value: true }] } });
    expect(evaluateCampaign(c, ctx({ productAvailable: undefined }), empty()).eligible).toBe(false);
    expect(evaluateCampaign(c, ctx({ productAvailable: true }), empty()).eligible).toBe(true);
    const cart = mk("b", { targeting: { match: "all", conditions: [{ field: "cart_subtotal", op: "gte", value: 50 }] } });
    expect(evaluateCampaign(cart, ctx(), empty()).eligible).toBe(false);
    expect(evaluateCampaign(cart, ctx({ cartSubtotal: 50 }), empty()).eligible).toBe(true);
  });
});

describe("schedule", () => {
  it("respects start and end (end exclusive)", () => {
    const c = mk("a", { schedule: { startsAt: "2026-10-27T12:00:00Z", endsAt: "2026-10-28T12:00:00Z" } });
    expect(evaluateCampaign(c, ctx({ now: NOW - 1 }), empty()).reason).toBe("before_start");
    expect(evaluateCampaign(c, ctx(), empty()).eligible).toBe(true);
    expect(evaluateCampaign(c, ctx({ now: Date.parse("2026-10-28T12:00:00Z") }), empty()).reason).toBe("after_end");
  });
});

describe("frequency", () => {
  it("session cap", () => {
    const s = empty(); s.sessionImpressions["a"] = 1;
    expect(evaluateCampaign(mk("a"), ctx(), s).reason).toBe("session_cap");
  });
  it("dismiss and click suppression windows", () => {
    const s = empty(); s.dismissedAt["a"] = NOW - 6 * 86_400_000;
    expect(evaluateCampaign(mk("a"), ctx(), s).reason).toBe("dismissed_recently");
    s.dismissedAt["a"] = NOW - 8 * 86_400_000;
    expect(evaluateCampaign(mk("a"), ctx(), s).eligible).toBe(true);
    s.clickedAt["a"] = NOW - 1000;
    expect(evaluateCampaign(mk("a"), ctx(), s).reason).toBe("clicked_recently");
  });
  it("does not stack on an active campaign", () => {
    const s = empty(); s.activeCampaignId = "other";
    expect(evaluateCampaign(mk("a"), ctx(), s).reason).toBe("other_active");
  });
});

describe("selection", () => {
  const cfg = (campaigns: PublishedCampaign[], deliveryEnabled = true): StorefrontConfig => ({
    schemaVersion: 1, siteId: "s", generatedAt: "2026-10-27T00:00:00Z", deliveryEnabled, campaigns,
  });
  it("highest priority wins, ties by id", () => {
    const r = selectCampaign(cfg([mk("b", { priority: 10 }), mk("c", { priority: 90 }), mk("a", { priority: 90 })]), ctx(), empty());
    expect(r.winner?.campaignId).toBe("a");
  });
  it("kill switch disables everything", () => {
    const r = selectCampaign(cfg([mk("a")], false), ctx(), empty());
    expect(r.winner).toBeUndefined();
    expect(r.decisions[0]?.reason).toBe("delivery_disabled");
  });
});

describe("contract validation", () => {
  it("rejects javascript:, protocol-relative, data: and http CTA URLs", () => {
    for (const bad of ["javascript:alert(1)", "//evil.com", "data:text/html,x", "http://insecure.com"]) {
      expect(() => mk("a", { creative: { headline: "x", ctaLabel: "y", ctaUrl: bad } })).toThrow();
    }
  });
});
