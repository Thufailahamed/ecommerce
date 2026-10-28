import { describe, expect, it } from "vitest";
import { CampaignConfig, EventBatch, SafeUrl, Schedule, TrackedEvent } from "./index";

const base = {
  schemaVersion: 1, name: "n", format: "popup",
  creative: { headline: "H", ctaLabel: "Go", ctaUrl: "/x" },
  style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] },
  frequency: {}, goal: { type: "clicks" },
};

describe("SafeUrl", () => {
  it.each(["/", "/collections/all?x=1", "https://shop.example.com/p"])("accepts %s", (u) => expect(SafeUrl.safeParse(u).success).toBe(true));
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "//evil.com", "data:text/html,<script>", "http://plain.com", "vbscript:x", " https://x.com", "", "ftp://x.com", "/\\evil.com"])(
    "rejects %j", (u) => expect(SafeUrl.safeParse(u).success).toBe(false));
  it("rejects control characters and trailing whitespace", () => {
    expect(SafeUrl.safeParse("/a\nb").success).toBe(false);
    expect(SafeUrl.safeParse("/a\tb").success).toBe(false);
    expect(SafeUrl.safeParse("https://x.com/ ").success).toBe(false);
  });
  it("rejects over-long URLs", () => expect(SafeUrl.safeParse("/" + "a".repeat(2100)).success).toBe(false));
});

describe("CampaignConfig", () => {
  it("applies safe defaults", () => {
    const c = CampaignConfig.parse(base);
    expect(c.frequency.maxImpressionsPerSession).toBe(1);
    expect(c.frequency.suppressAfterDismissDays).toBe(7);
    expect(c.priority).toBe(50);
    expect(c.style.placement).toBe("center");
  });
  it("enforces copy and range limits", () => {
    expect(CampaignConfig.safeParse({ ...base, creative: { ...base.creative, headline: "x".repeat(91) } }).success).toBe(false);
    expect(CampaignConfig.safeParse({ ...base, creative: { ...base.creative, headline: "   " } }).success).toBe(false);
    expect(CampaignConfig.safeParse({ ...base, priority: 101 }).success).toBe(false);
    expect(CampaignConfig.safeParse({ ...base, trigger: { type: "delay", seconds: 301 } }).success).toBe(false);
    expect(CampaignConfig.safeParse({ ...base, style: { radius: 99 } }).success).toBe(false);
    expect(CampaignConfig.safeParse({ ...base, style: { accent: "red" } }).success).toBe(false);
  });
  it("rejects unknown trigger/condition kinds and wrong schema version", () => {
    expect(CampaignConfig.safeParse({ ...base, trigger: { type: "eval", code: "x" } }).success).toBe(false);
    expect(CampaignConfig.safeParse({ ...base, targeting: { match: "all", conditions: [{ field: "js", op: "eq", value: "1" }] } }).success).toBe(false);
    expect(CampaignConfig.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false);
  });
  it("caps rule count", () => {
    const c = { field: "visitor_type", op: "equals", value: "new" };
    expect(CampaignConfig.safeParse({ ...base, targeting: { match: "any", conditions: Array(21).fill(c) } }).success).toBe(false);
  });
});

describe("Schedule", () => {
  it("requires end after start", () => {
    expect(Schedule.safeParse({ startsAt: "2026-01-02T00:00:00Z", endsAt: "2026-01-01T00:00:00Z" }).success).toBe(false);
    expect(Schedule.safeParse({ startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-02T00:00:00Z" }).success).toBe(true);
    expect(Schedule.safeParse({ startsAt: "not-a-date" }).success).toBe(false);
  });
});

describe("events", () => {
  const ev = { eventId: "evt_12345678", type: "campaign_click", siteId: "cf_x", sessionId: "sess_12345678", occurredAt: "2026-10-27T00:00:00.000Z", schemaVersion: 1 };
  it("requires explicit consent=true", () => {
    expect(EventBatch.safeParse({ consent: true, events: [ev] }).success).toBe(true);
    expect(EventBatch.safeParse({ consent: false, events: [ev] }).success).toBe(false);
    expect(EventBatch.safeParse({ events: [ev] }).success).toBe(false);
  });
  it("bounds batch size and validates types", () => {
    expect(EventBatch.safeParse({ consent: true, events: [] }).success).toBe(false);
    expect(EventBatch.safeParse({ consent: true, events: Array(51).fill(ev) }).success).toBe(false);
    expect(TrackedEvent.safeParse({ ...ev, type: "page_view" }).success).toBe(false);
    expect(TrackedEvent.safeParse({ ...ev, order: { orderId: "1", total: -5, currency: "USD" } }).success).toBe(false);
    expect(TrackedEvent.safeParse({ ...ev, order: { orderId: "1", total: 5, currency: "US" } }).success).toBe(false);
  });
});
