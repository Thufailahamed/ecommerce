import { describe, expect, it } from "vitest";
import {
  CAPABILITIES, DOMAIN_EVENTS, PLANNED_DOMAIN_EVENTS, PLANS, Review, Reward, ReturnRequest, applyLedger, canModerate, capabilityGranted,
  isPublic, isVerifiedPurchase, pointsForOrder, type LoyaltyLedgerEntry,
} from "./index";

const T = "2026-10-29T10:00:00.000Z";
const entry = (o: Partial<LoyaltyLedgerEntry>): LoyaltyLedgerEntry => ({ contactId: "ctc_1", delta: 10, reason: "order", idempotencyKey: "k", at: T, ...o });

describe("planned extension contracts", () => {
  it("no planned event can be published: none is in the live catalog, and each names its module and privacy class", () => {
    for (const [type, e] of Object.entries(PLANNED_DOMAIN_EVENTS)) {
      expect(Object.keys(DOMAIN_EVENTS), type).not.toContain(type);
      expect(["none", "pseudonymous"]).toContain(e.privacy);
      expect(["post_purchase", "reviews", "loyalty"]).toContain(e.module);
    }
  });

  it("their modules can never be switched on: the capabilities are planned and refused on every plan and flag", () => {
    for (const c of ["loyalty.enabled", "reviews.enabled", "post_purchase.enabled"] as const) {
      expect(CAPABILITIES[c].availability).toBe("planned");
      for (const p of Object.values(PLANS)) expect(capabilityGranted(c, p, new Set([c]))).toBe(false);
    }
  });

  it("event payloads stay minimal and strict: no addresses or names on the bus", () => {
    const fulfilled = PLANNED_DOMAIN_EVENTS["order.fulfilled"].payload;
    expect(fulfilled.safeParse({ platform: "shopify", externalOrderId: "1", status: "fulfilled", trackingUrl: null, fulfilledAt: T }).success).toBe(true);
    expect(fulfilled.safeParse({ platform: "shopify", externalOrderId: "1", status: "fulfilled", trackingUrl: null, fulfilledAt: T, email: "a@example.com" }).success).toBe(false);
    expect(PLANNED_DOMAIN_EVENTS["loyalty.points_changed"].payload.safeParse({ contactId: "c", delta: 0, reason: "order", balance: 0 }).success).toBe(false);
  });
});

describe("reviews", () => {
  const review = { id: "rev_1", storeId: "sto_1", productExternalId: "1001", rating: 5, body: "Fits well.", contactId: null, displayName: "Ada", source: "storefront_form", orderRef: null, state: "pending", createdAt: T };
  it("accepts a real review shape, requires a platform id for imports and an order for 'verified purchase'", () => {
    expect(Review.safeParse(review).success).toBe(true);
    expect(Review.safeParse({ ...review, rating: 6 }).success).toBe(false);
    expect(Review.safeParse({ ...review, source: "platform_import" }).success).toBe(false);
    expect(Review.safeParse({ ...review, source: "platform_import", externalId: "judgeme_9" }).success).toBe(true);
    expect(isVerifiedPurchase(review as Review)).toBe(false);
    expect(isVerifiedPurchase({ orderRef: "shopify:1" })).toBe(true);
  });
  it("moderation never returns to pending and only approved reviews are public", () => {
    expect(canModerate("pending", "approved")).toBe(true);
    expect(canModerate("approved", "pending")).toBe(false);
    expect(canModerate("rejected", "flagged")).toBe(false);
    expect(isPublic({ state: "pending" })).toBe(false);
    expect(isPublic({ state: "flagged" })).toBe(false);
    expect(isPublic({ state: "approved" })).toBe(true);
  });
});

describe("loyalty and referrals", () => {
  it("earns whole points over the minimum only", () => {
    expect(pointsForOrder(49.99, { pointsPerCurrencyUnit: 1, minimumOrder: 10 })).toBe(49);
    expect(pointsForOrder(9.99, { pointsPerCurrencyUnit: 1, minimumOrder: 10 })).toBe(0);
    expect(pointsForOrder(0, { pointsPerCurrencyUnit: 5, minimumOrder: 0 })).toBe(0);
  });
  it("a redelivered event awards once, a redemption cannot overdraw, and a refund takes back at most what is there", () => {
    const earn = entry({ delta: 40, idempotencyKey: "order.created:shopify:1" });
    let r = applyLedger([], [earn, earn]);
    expect(r.ledger).toHaveLength(1);
    r = applyLedger(r.ledger, [entry({ delta: -100, reason: "redemption", idempotencyKey: "red_1" })]);
    expect(r.refused).toHaveLength(1);
    r = applyLedger(r.ledger, [entry({ delta: -30, reason: "redemption", idempotencyKey: "red_2" }), entry({ delta: -40, reason: "refund_reversal", idempotencyKey: "order.refunded:1" })]);
    expect(r.ledger.map((e) => e.delta)).toEqual([40, -30, -10]);
    expect(r.ledger.reduce((n, e) => n + e.delta, 0)).toBe(0);
  });
  it("rewards respect sensible bounds", () => {
    expect(Reward.safeParse({ id: "r", kind: "percent_off", costPoints: 100, value: 10 }).success).toBe(true);
    expect(Reward.safeParse({ id: "r", kind: "percent_off", costPoints: 100, value: 95 }).success).toBe(false);
    expect(Reward.safeParse({ id: "r", kind: "free_shipping", costPoints: 0, value: 0 }).success).toBe(false);
  });
});

describe("post-purchase", () => {
  it("a return names lines and reasons, and nothing else", () => {
    expect(ReturnRequest.safeParse({ externalOrderId: "1", kind: "exchange", lines: [{ variantExternalId: "5001", quantity: 1, reason: "too_small" }], state: "requested" }).success).toBe(true);
    expect(ReturnRequest.safeParse({ externalOrderId: "1", kind: "return", lines: [], state: "requested" }).success).toBe(false);
  });
});
