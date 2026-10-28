import { describe, expect, it } from "vitest";
import { CampaignConfig, type PublishedCampaign, type StorefrontConfig } from "@convertflow/contracts";
import {
  QUIET_PERIOD_MS, evaluateCampaign, isSignalTriggerSatisfied, quietUntilAfterDismiss, remainingForFreeShipping,
  selectExperiences, type SuppressionState, type VisitorContext,
} from "./index.js";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const ctx = (o: Partial<VisitorContext> = {}): VisitorContext => ({
  now: NOW, pageType: "product", urlPath: "/products/shoe", device: "desktop", visitorType: "new", pagesViewed: 1, ...o,
});
const empty = (): SuppressionState => ({ sessionImpressions: {}, visitorImpressions: {}, dismissedAt: {}, clickedAt: {} });

const common = {
  schemaVersion: 1, creative: { headline: "Hi", ctaLabel: "Go", ctaUrl: "/c" }, style: {}, trigger: { type: "immediate" },
  targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" },
};
const mk = (id: string, over: Record<string, unknown>): PublishedCampaign => ({
  campaignId: id, versionId: `${id}_v1`, config: CampaignConfig.parse({ ...common, name: id, ...over }),
});
const toast = (id: string, over: Record<string, unknown> = {}) => mk(id, { tool: "toast", format: "toast", toast: {}, ...over });
const popup = (id: string, over: Record<string, unknown> = {}) => mk(id, { format: "popup", ...over });
const feed = (id: string, over: Record<string, unknown> = {}) => mk(id, { tool: "feed", format: "feed_item", feed: {}, ...over });
const emailForm = { collect: { email: true }, consentText: "I agree to receive marketing emails from this store.", privacyUrl: "/privacy" };
const smsForm = { collect: { phone: true }, consentText: "I agree to receive marketing texts. Reply STOP to opt out.", privacyUrl: "/privacy" };
const email = (id: string, over: Record<string, unknown> = {}) => mk(id, { tool: "email", format: "popup", form: emailForm, ...over });
const sms = (id: string, over: Record<string, unknown> = {}) => mk(id, { tool: "sms", format: "popup", form: smsForm, ...over });
const rec = (id: string, over: Record<string, unknown> = {}) => mk(id, { tool: "upsell", format: "recommendation", recommend: { source: "same_collection" }, ...over });
const cfg = (campaigns: PublishedCampaign[], deliveryEnabled = true): StorefrontConfig => ({ schemaVersion: 1, siteId: "s", generatedAt: "2026-10-27T00:00:00Z", deliveryEnabled, campaigns });

describe("slots: what may share the screen", () => {
  it("never shows a toast together with an interruptive signup popup (interruptive wins even at lower priority)", () => {
    const r = selectExperiences(cfg([toast("t", { priority: 90 }), email("e", { priority: 10 })]), ctx(), empty());
    expect(r.interruptive?.campaignId).toBe("e");
    expect(r.ambient).toBeUndefined();
    expect(r.decisions.find((d) => d.campaignId === "t")).toMatchObject({ eligible: false, reason: "outranked" });
  });
  it("shows one toast when nothing interruptive is eligible, the highest priority, ties by id", () => {
    const r = selectExperiences(cfg([toast("b", { priority: 10 }), toast("c", { priority: 90 }), toast("a", { priority: 90 })]), ctx(), empty());
    expect(r.ambient?.campaignId).toBe("a");
    expect(r.decisions.filter((d) => d.eligible)).toHaveLength(1);
  });
  it("passive surfaces coexist with everything and with each other", () => {
    const r = selectExperiences(cfg([popup("p"), feed("f1", { priority: 20 }), feed("f2", { priority: 80 }), rec("r")]), ctx(), empty());
    expect(r.interruptive?.campaignId).toBe("p");
    expect(r.passive.map((c) => c.campaignId).sort()).toEqual(["f1", "f2", "r"]);
  });
  it("orders passive experiences by priority", () => {
    const r = selectExperiences(cfg([feed("f1", { priority: 20 }), feed("f2", { priority: 80 }), feed("f3", { priority: 50 })]), ctx(), empty());
    expect(r.passive.map((c) => c.campaignId)).toEqual(["f2", "f3", "f1"]);
  });
  it("is deterministic regardless of input order", () => {
    const list = [toast("a", { priority: 50 }), toast("b", { priority: 50 }), feed("f"), popup("p", { priority: 5 })];
    const a = selectExperiences(cfg(list), ctx(), empty());
    const b = selectExperiences(cfg([...list].reverse()), ctx(), empty());
    expect(a.interruptive?.campaignId).toBe(b.interruptive?.campaignId);
    expect(a.ambient?.campaignId).toBe(b.ambient?.campaignId);
    expect(a.passive.map((c) => c.campaignId)).toEqual(b.passive.map((c) => c.campaignId));
  });
  it("the kill switch disables every tool", () => {
    const r = selectExperiences(cfg([toast("t"), feed("f"), email("e")], false), ctx(), empty());
    expect(r.interruptive ?? r.ambient).toBeUndefined();
    expect(r.passive).toEqual([]);
    expect(r.decisions.every((d) => d.reason === "delivery_disabled")).toBe(true);
  });
});

describe("on-screen conflicts", () => {
  it("a toast on screen blocks another toast and a popup, but not the feed or inline items", () => {
    const s = empty(); s.active = [{ campaignId: "t1", slot: "ambient" }];
    expect(evaluateCampaign(toast("t2"), ctx(), s).reason).toBe("other_active");
    expect(evaluateCampaign(popup("p"), ctx(), s).reason).toBe("other_active");
    expect(evaluateCampaign(feed("f"), ctx(), s).eligible).toBe(true);
    expect(evaluateCampaign(rec("r"), ctx(), s).eligible).toBe(true);
  });
  it("does not conflict with itself", () => {
    const s = empty(); s.active = [{ campaignId: "t1", slot: "ambient" }];
    expect(evaluateCampaign(toast("t1"), ctx(), s).eligible).toBe(true);
  });
  it("legacy activeCampaignId still blocks (backwards compatible)", () => {
    const s = empty(); s.activeCampaignId = "other";
    expect(evaluateCampaign(popup("p"), ctx(), s).reason).toBe("other_active");
  });
});

describe("cross-tool quiet period after a dismissal", () => {
  it("silences interruptive and ambient experiences, for exactly the quiet period", () => {
    const s = empty(); s.quietUntil = quietUntilAfterDismiss(NOW);
    expect(evaluateCampaign(toast("t"), ctx(), s).reason).toBe("quiet_period");
    expect(evaluateCampaign(email("e"), ctx(), s).reason).toBe("quiet_period");
    expect(evaluateCampaign(toast("t"), ctx({ now: NOW + QUIET_PERIOD_MS - 1 }), s).reason).toBe("quiet_period");
    expect(evaluateCampaign(toast("t"), ctx({ now: NOW + QUIET_PERIOD_MS }), s).eligible).toBe(true);
  });
  it("never hides passive surfaces", () => {
    const s = empty(); s.quietUntil = NOW + 1e9;
    expect(evaluateCampaign(feed("f"), ctx(), s).eligible).toBe(true);
    expect(evaluateCampaign(rec("r"), ctx(), s).eligible).toBe(true);
  });
  it("a dismissed popup is not followed straight away by a different tool's toast", () => {
    const s = empty(); s.dismissedAt["p"] = NOW; s.quietUntil = quietUntilAfterDismiss(NOW);
    const r = selectExperiences(cfg([popup("p"), toast("t"), feed("f")]), ctx({ now: NOW + 1000 }), s);
    expect(r.interruptive).toBeUndefined();
    expect(r.ambient).toBeUndefined();
    expect(r.passive.map((c) => c.campaignId)).toEqual(["f"]);
  });
});

describe("passive surfaces ignore impression caps and click cooldowns", () => {
  it("a feed item stays available after being seen and clicked", () => {
    const s = empty(); s.sessionImpressions["f"] = 99; s.visitorImpressions["f"] = 99; s.clickedAt["f"] = NOW - 1;
    expect(evaluateCampaign(feed("f"), ctx(), s).eligible).toBe(true);
  });
  it("an interruptive campaign with the same history is suppressed", () => {
    const s = empty(); s.sessionImpressions["p"] = 1;
    expect(evaluateCampaign(popup("p"), ctx(), s).reason).toBe("session_cap");
  });
  it("a dismissed passive form stays dismissed", () => {
    const s = empty(); s.dismissedAt["i"] = NOW - 1000;
    const inline = mk("i", { tool: "sms", format: "inline", form: smsForm }); // inline email forms are not valid yet, inline SMS forms are
    expect(evaluateCampaign(inline, ctx(), s).reason).toBe("dismissed_recently");
  });
});

describe("already subscribed", () => {
  it("hides email forms from email subscribers and sms forms from sms subscribers, per channel", () => {
    const s = empty(); s.subscribed = { email: true };
    expect(evaluateCampaign(email("e"), ctx(), s).reason).toBe("already_subscribed");
    expect(evaluateCampaign(sms("s"), ctx(), s).eligible).toBe(true);
    s.subscribed = { sms: true };
    expect(evaluateCampaign(sms("s"), ctx(), s).reason).toBe("already_subscribed");
    expect(evaluateCampaign(email("e"), ctx(), s).eligible).toBe(true);
  });
  it("does not hide a back-in-stock form (it is per product, not per channel)", () => {
    const s = empty(); s.subscribed = { email: true };
    expect(evaluateCampaign(mk("r", { format: "restock" }), ctx(), s).eligible).toBe(true);
  });
  it("does not affect non-signup tools", () => {
    const s = empty(); s.subscribed = { email: true, sms: true };
    expect(evaluateCampaign(toast("t"), ctx(), s).eligible).toBe(true);
  });
});

describe("signal triggers", () => {
  it("add_to_cart fires only after a real add-to-cart", () => {
    const t = { type: "add_to_cart", delaySeconds: 0 } as const;
    expect(isSignalTriggerSatisfied(t, {})).toBe(false);
    expect(isSignalTriggerSatisfied(t, { addedToCart: false })).toBe(false);
    expect(isSignalTriggerSatisfied(t, { addedToCart: true })).toBe(true);
  });
  it("cart_threshold fires at or above the threshold, never on an unknown subtotal", () => {
    const t = { type: "cart_threshold", subtotal: 75 } as const;
    expect(isSignalTriggerSatisfied(t, {})).toBe(false);
    expect(isSignalTriggerSatisfied(t, { cartSubtotal: 74.99 })).toBe(false);
    expect(isSignalTriggerSatisfied(t, { cartSubtotal: 75 })).toBe(true);
  });
  it("timing triggers are not signal-gated", () => expect(isSignalTriggerSatisfied({ type: "delay", seconds: 5 }, {})).toBe(true));
});

describe("free shipping remaining", () => {
  it("computes the real gap and rounds to cents", () => {
    expect(remainingForFreeShipping(75, 60)).toBe(15);
    expect(remainingForFreeShipping(75, 74.995)).toBe(0.01);
    expect(remainingForFreeShipping(75, 0)).toBe(75);
  });
  it("returns nothing when the cart is unknown, invalid or already qualifies", () => {
    expect(remainingForFreeShipping(75, undefined)).toBeUndefined();
    expect(remainingForFreeShipping(75, 75)).toBeUndefined();
    expect(remainingForFreeShipping(75, 120)).toBeUndefined();
    expect(remainingForFreeShipping(75, Number.NaN)).toBeUndefined();
    expect(remainingForFreeShipping(75, -1)).toBeUndefined();
  });
});

describe("free-shipping toast eligibility", () => {
  const ship = (threshold = 75) => toast("s", { toast: { kind: "shipping_incentive", freeShippingThreshold: threshold } });
  it("shows only when the cart is known and still short of the threshold", () => {
    expect(evaluateCampaign(ship(), ctx({ cartSubtotal: 60 }), empty()).eligible).toBe(true);
    expect(evaluateCampaign(ship(), ctx({ cartSubtotal: 0 }), empty()).eligible).toBe(true);
  });
  it("never shows for an unknown cart or a cart that already qualifies", () => {
    expect(evaluateCampaign(ship(), ctx(), empty()).reason).toBe("not_applicable");
    expect(evaluateCampaign(ship(), ctx({ cartSubtotal: 75 }), empty()).reason).toBe("not_applicable");
    expect(evaluateCampaign(ship(), ctx({ cartSubtotal: 200 }), empty()).reason).toBe("not_applicable");
  });
  it("does not affect other toast kinds", () => {
    expect(evaluateCampaign(toast("a"), ctx(), empty()).eligible).toBe(true);
  });
});

describe("recommendation placements", () => {
  it("a product-page block is only eligible on a product page", () => {
    expect(evaluateCampaign(rec("r"), ctx({ pageType: "product" }), empty()).eligible).toBe(true);
    for (const pageType of ["home", "collection", "cart", "checkout", "search", "content", "other"] as const) {
      expect(evaluateCampaign(rec("r"), ctx({ pageType }), empty())).toMatchObject({ eligible: false, reason: "not_applicable" });
    }
  });
  it("cart and toast placements are not tied to a page type by the engine (targeting decides)", () => {
    for (const placement of ["cart", "toast"]) expect(evaluateCampaign(rec("r", { recommend: { source: "same_collection", placement } }), ctx({ pageType: "home" }), empty()).eligible).toBe(true);
  });
  it("inline placements are passive and a toast placement is ambient, so only the toast takes part in arbitration", () => {
    const inline = rec("i"), floating = rec("f", { recommend: { source: "same_collection", placement: "toast" } });
    const r = selectExperiences(cfg([inline, floating]), ctx(), empty());
    expect(r.passive.map((c) => c.campaignId)).toEqual(["i"]);
    expect(r.ambient?.campaignId).toBe("f");
    const withPopup = selectExperiences(cfg([floating, popup("p")]), ctx(), empty());
    expect(withPopup.interruptive?.campaignId).toBe("p");
    expect(withPopup.ambient).toBeUndefined(); // a toast-placed recommendation never sits on top of a popup
  });
  it("a dismissed recommendation toast stays suppressed, while an inline block ignores impression caps", () => {
    const floating = rec("f", { recommend: { source: "same_collection", placement: "toast" } });
    const s = empty(); s.dismissedAt["f"] = NOW - 1000;
    expect(evaluateCampaign(floating, ctx(), s).reason).toBe("dismissed_recently");
    const t = empty(); t.sessionImpressions["r"] = 99;
    expect(evaluateCampaign(rec("r"), ctx(), t).eligible).toBe(true);
  });
});
