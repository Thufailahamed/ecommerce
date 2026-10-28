import { describe, expect, it } from "vitest";
import { CampaignConfig, TrackedEvent, slotOf, toolOf } from "./index";

const base = {
  schemaVersion: 1, name: "n", format: "popup",
  creative: { headline: "H", ctaLabel: "Go", ctaUrl: "/x" },
  style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] },
  frequency: {}, goal: { type: "clicks" },
};
const form = {
  collect: { email: true }, consentText: "I agree to receive marketing emails from this store. Unsubscribe any time.",
  privacyUrl: "/policies/privacy-policy",
};
const smsForm = {
  collect: { phone: true }, consentText: "I agree to receive recurring marketing texts. Msg & data rates may apply. Reply STOP to opt out.",
  privacyUrl: "/policies/privacy-policy",
};
const ok = (v: unknown) => CampaignConfig.safeParse(v).success;
const issues = (v: unknown) => { const r = CampaignConfig.safeParse(v); return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`); };

describe("backwards compatibility", () => {
  it("campaigns saved before tools existed still validate and map to a tool", () => {
    expect(ok(base)).toBe(true);
    expect(toolOf({ format: "popup" })).toBe("toast");
    expect(toolOf({ format: "slide_in" })).toBe("toast");
    expect(toolOf({ format: "restock" })).toBe("email");
    expect(ok({ ...base, format: "restock" })).toBe(true);
  });
  it("new formats cannot be used without a tool", () => {
    for (const format of ["toast", "inline", "feed_item", "recommendation"]) expect(ok({ ...base, format })).toBe(false);
  });
});

describe("tool and format agreement", () => {
  it("rejects a format the tool cannot render", () => {
    expect(ok({ ...base, tool: "toast", format: "feed_item" })).toBe(false);
    expect(ok({ ...base, tool: "feed", format: "popup" })).toBe(false);
    expect(ok({ ...base, tool: "upsell", format: "toast", recommend: { source: "manual", productIds: ["p"] } })).toBe(false);
  });
  it("accepts a toast with defaults", () => {
    const c = CampaignConfig.parse({ ...base, tool: "toast", format: "toast", toast: {} });
    expect(c.toast).toMatchObject({ kind: "announcement", corner: "bottom_left", animation: "slide" });
  });
  it("rejects option blocks that belong to another tool (they would be silently ignored)", () => {
    expect(ok({ ...base, tool: "toast", format: "toast", feed: { category: "x" } })).toBe(false);
    expect(ok({ ...base, tool: "toast", format: "toast", form })).toBe(false);
    expect(ok({ ...base, tool: "feed", format: "feed_item", toast: {} })).toBe(false);
  });
});

describe("toast", () => {
  it("shipping incentive needs a threshold and bounds duration", () => {
    expect(ok({ ...base, tool: "toast", format: "toast", toast: { kind: "shipping_incentive" } })).toBe(false);
    expect(ok({ ...base, tool: "toast", format: "toast", toast: { kind: "shipping_incentive", freeShippingThreshold: 75 } })).toBe(true);
    expect(ok({ ...base, tool: "toast", format: "toast", toast: { durationSeconds: 1 } })).toBe(false);
    expect(ok({ ...base, tool: "toast", format: "toast", toast: { durationSeconds: 121 } })).toBe(false);
  });
  it("supports cart triggers and rejects bad ones", () => {
    expect(ok({ ...base, tool: "toast", format: "toast", trigger: { type: "add_to_cart" } })).toBe(true);
    expect(ok({ ...base, tool: "toast", format: "toast", trigger: { type: "cart_threshold", subtotal: 75 } })).toBe(true);
    expect(ok({ ...base, tool: "toast", format: "toast", trigger: { type: "cart_threshold", subtotal: 0 } })).toBe(false);
    expect(ok({ ...base, tool: "toast", format: "toast", trigger: { type: "cart_threshold", subtotal: -5 } })).toBe(false);
  });
});

describe("feed", () => {
  it("accepts a feed item and defaults its options", () => {
    const c = CampaignConfig.parse({ ...base, tool: "feed", format: "feed_item", feed: {} });
    expect(c.feed).toEqual({ category: "Updates", order: 100, audience: "public", position: "bottom_right" });
  });
});

describe("upsell", () => {
  const rec = (r: object) => ({ ...base, tool: "upsell", format: "recommendation", recommend: r });
  it("needs recommendation options", () => expect(ok({ ...base, tool: "upsell", format: "recommendation" })).toBe(false));
  it("manual needs products; shipping_threshold needs a threshold", () => {
    expect(ok(rec({ source: "manual" }))).toBe(false);
    expect(ok(rec({ source: "manual", productIds: ["p1"] }))).toBe(true);
    expect(ok(rec({ source: "shipping_threshold" }))).toBe(false);
    expect(ok(rec({ source: "shipping_threshold", freeShippingThreshold: 75 }))).toBe(true);
  });
  it("caps products and can never claim to recommend unavailable items", () => {
    expect(ok(rec({ source: "same_collection", maxProducts: 7 }))).toBe(false);
    expect(ok(rec({ source: "same_collection", onlyAvailable: false }))).toBe(false);
    expect(CampaignConfig.parse(rec({ source: "same_collection" })).recommend?.onlyAvailable).toBe(true);
  });
  it("rejects unknown (algorithmic) sources that are not built", () => {
    expect(ok(rec({ source: "frequently_bought_together" }))).toBe(false);
    expect(ok(rec({ source: "ai" }))).toBe(false);
  });
});

describe("signup forms and consent", () => {
  it("email needs a form that collects an email", () => {
    expect(ok({ ...base, tool: "email", format: "popup" })).toBe(false);
    expect(ok({ ...base, tool: "email", format: "popup", form })).toBe(true);
    expect(ok({ ...base, tool: "email", format: "popup", form: smsForm })).toBe(false);
  });
  it("sms needs a form that collects a phone", () => {
    expect(ok({ ...base, tool: "sms", format: "popup" })).toBe(false);
    expect(ok({ ...base, tool: "sms", format: "popup", form: smsForm })).toBe(true);
    expect(ok({ ...base, tool: "sms", format: "popup", form })).toBe(false);
  });
  it("requires real consent text and a safe privacy link", () => {
    expect(ok({ ...base, tool: "email", format: "popup", form: { ...form, consentText: "ok" } })).toBe(false);
    expect(ok({ ...base, tool: "email", format: "popup", form: { ...form, privacyUrl: "javascript:alert(1)" } })).toBe(false);
    expect(ok({ ...base, tool: "email", format: "popup", form: { ...form, privacyUrl: undefined } })).toBe(false);
  });
  it("consent is never pre-ticked and double opt-in defaults on", () => {
    const f = CampaignConfig.parse({ ...base, tool: "email", format: "popup", form }).form!;
    expect(f.consentCheckbox).toBe(true);
    expect(f.doubleOptIn).toBe(true);
    expect(issues({ ...base, tool: "email", format: "popup", form: { ...form, consentCheckbox: false } }).length).toBeGreaterThan(0);
  });
  it("email forms can use every layout, a first name and an incentive; phone and single opt-in are still rejected, not ignored", () => {
    const email = (extra: Record<string, unknown>, f: Record<string, unknown> = form) => ({ ...base, tool: "email", format: "popup", form: f, ...extra });
    for (const format of ["popup", "slide_in", "inline", "announcement_bar"]) expect(ok(email({ format })), format).toBe(true);
    expect(ok(email({}, { ...form, collect: { email: true, firstName: true } }))).toBe(true);
    expect(ok(email({ promotion: { code: "WELCOME10", percentOff: 10 } }))).toBe(true);
    expect(issues(email({}, { ...form, collect: { email: true, phone: true } }))).toEqual(["form.collect.phone: Phone collection is not available on email forms: use the SMS tool for phone numbers"]);
    expect(issues(email({}, { ...form, doubleOptIn: false }))).toEqual(["form.doubleOptIn: Single opt-in is not available: shoppers always confirm by email"]);
  });
  it("legacy restock forms need no form block", () => expect(ok({ ...base, format: "restock" })).toBe(true));
});

describe("slots", () => {
  it("classifies every tool and format into a slot", () => {
    expect(slotOf({ format: "popup" })).toBe("interruptive");
    expect(slotOf({ format: "slide_in" })).toBe("ambient");
    expect(slotOf({ format: "announcement_bar" })).toBe("ambient");
    expect(slotOf({ tool: "toast", format: "toast" })).toBe("ambient");
    expect(slotOf({ tool: "feed", format: "feed_item" })).toBe("passive");
    expect(slotOf({ tool: "upsell", format: "recommendation", recommend: { placement: "product_page" } })).toBe("passive");
    expect(slotOf({ tool: "upsell", format: "recommendation", recommend: { placement: "toast" } })).toBe("ambient");
    expect(slotOf({ tool: "email", format: "popup" })).toBe("interruptive");
    expect(slotOf({ tool: "sms", format: "slide_in" })).toBe("interruptive");
    expect(slotOf({ tool: "email", format: "inline" })).toBe("passive");
    expect(slotOf({ tool: "email", format: "announcement_bar" })).toBe("ambient");
    expect(slotOf({ format: "restock" })).toBe("interruptive");
  });
});

describe("new events", () => {
  const ev = { eventId: "evt_12345678", siteId: "cf_x", sessionId: "sess_12345678", occurredAt: "2026-10-27T00:00:00.000Z", schemaVersion: 1 };
  it.each(["feed_open", "feed_item_click", "recommendation_impression", "recommendation_click", "recommendation_add_to_cart", "form_submit_attempt", "form_submit_success", "form_submit_failure"])(
    "accepts %s", (type) => expect(TrackedEvent.safeParse({ ...ev, type }).success).toBe(true));
  it("still rejects unknown types, and events carry no field for personal data", () => {
    expect(TrackedEvent.safeParse({ ...ev, type: "form_submit_email" }).success).toBe(false);
    const parsed = TrackedEvent.parse({ ...ev, type: "form_submit_success", email: "a@b.co", phone: "+15555550100" } as never);
    expect(parsed).not.toHaveProperty("email");
    expect(parsed).not.toHaveProperty("phone");
  });
});
