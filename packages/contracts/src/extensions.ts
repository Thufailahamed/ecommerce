import { z } from "zod";

/**
 * Contracts for modules that are NOT built: post-purchase, reviews, loyalty and referrals. They exist so a future module
 * plugs into the shared foundation (platform events, entitlements, consent, audit) instead of growing a parallel one, and
 * so the shapes can be reviewed before any code depends on them. Nothing here is a product:
 * - The events below are not in `DOMAIN_EVENTS`, so `publishDomainEvent` cannot record them; a module moves its events
 *   there in the same change that builds and tests it.
 * - The matching capabilities (`loyalty.enabled`, `reviews.enabled`, `post_purchase.enabled`) are `planned` and are never
 *   granted, whatever the plan or flags.
 * - No reviews, points or returns are stored anywhere, and none may be invented: reviews come only from real customers or
 *   an import from a review platform, with their source recorded.
 */

const Id = z.string().min(1).max(100);
const Currency = z.string().regex(/^[A-Z]{3}$/);
const When = z.iso.datetime();

/* ---------- planned platform events ---------- */

export const PLANNED_DOMAIN_EVENTS = {
  "order.fulfilled": {
    version: 1, privacy: "none", module: "post_purchase",
    description: "The commerce platform reported an order (or part of it) shipped. Needs read_fulfillments (Shopify) when built.",
    payload: z.object({ platform: z.enum(["shopify"]), externalOrderId: Id, status: z.enum(["partial", "fulfilled"]), trackingUrl: z.url().max(2048).nullable(), fulfilledAt: When }).strict(),
  },
  "order.refunded": {
    version: 1, privacy: "none", module: "post_purchase",
    description: "Money was returned on an order. Loyalty reverses points for the refunded amount; analytics never subtracts it from attributed revenue retroactively.",
    payload: z.object({ platform: z.enum(["shopify"]), externalOrderId: Id, amount: z.number().positive(), currency: Currency, refundedAt: When }).strict(),
  },
  "order.return_requested": {
    version: 1, privacy: "none", module: "post_purchase",
    description: "A customer asked to return or exchange items on an order.",
    payload: z.object({ platform: z.enum(["shopify"]), externalOrderId: Id, kind: z.enum(["return", "exchange"]), lineCount: z.number().int().positive(), requestedAt: When }).strict(),
  },
  "review.submitted": {
    version: 1, privacy: "pseudonymous", module: "reviews",
    description: "A review arrived (storefront form or platform import) and awaits moderation. Never shown before approval.",
    payload: z.object({ reviewId: Id, productExternalId: Id, rating: z.number().int().min(1).max(5), source: z.enum(["storefront_form", "platform_import"]), contactId: Id.nullable() }).strict(),
  },
  "review.moderated": {
    version: 1, privacy: "none", module: "reviews",
    description: "A merchant approved, rejected or flagged a review.",
    payload: z.object({ reviewId: Id, from: z.enum(["pending", "approved", "rejected", "flagged"]), to: z.enum(["approved", "rejected", "flagged"]) }).strict(),
  },
  "loyalty.points_changed": {
    version: 1, privacy: "pseudonymous", module: "loyalty",
    description: "A contact's points balance changed by one ledger entry.",
    payload: z.object({ contactId: Id, delta: z.number().int().refine((n) => n !== 0, "a ledger entry changes the balance"), reason: z.enum(["order", "refund_reversal", "redemption", "referral", "manual_adjustment"]), balance: z.number().int().min(0) }).strict(),
  },
  "referral.attributed": {
    version: 1, privacy: "pseudonymous", module: "loyalty",
    description: "An order was attributed to a referral code within the referral window.",
    payload: z.object({ referrerContactId: Id, externalOrderId: Id, code: z.string().regex(/^[A-Z0-9-]{4,32}$/) }).strict(),
  },
} as const;
export type PlannedDomainEventType = keyof typeof PLANNED_DOMAIN_EVENTS;

/* ---------- reviews ---------- */

export const REVIEW_STATES = ["pending", "approved", "rejected", "flagged"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const Review = z.object({
  id: Id,
  storeId: Id,
  productExternalId: Id,
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(5000),
  /** The person, by internal contact id, when known. Display names are the reviewer's own words, never generated. */
  contactId: Id.nullable(),
  displayName: z.string().trim().min(1).max(60),
  source: z.enum(["storefront_form", "platform_import"]),
  /** For an import: the review platform's own id, so a re-import updates instead of duplicating. */
  externalId: Id.optional(),
  /** "Verified purchase" only with the order it refers to. */
  orderRef: Id.nullable(),
  state: z.enum(REVIEW_STATES),
  createdAt: When,
}).strict().superRefine((r, ctx) => {
  if (r.source === "platform_import" && !r.externalId) ctx.addIssue({ code: "custom", path: ["externalId"], message: "An imported review keeps the review platform's id" });
});
export type Review = z.infer<typeof Review>;
export const isVerifiedPurchase = (r: Pick<Review, "orderRef">): boolean => r.orderRef !== null;

/** Moderation is a small state machine: nothing returns to pending, and only approved reviews are ever shown. */
const MODERATION: Record<ReviewState, readonly ReviewState[]> = {
  pending: ["approved", "rejected", "flagged"],
  flagged: ["approved", "rejected"],
  approved: ["rejected", "flagged"],
  rejected: ["approved"],
};
export const canModerate = (from: ReviewState, to: ReviewState): boolean => MODERATION[from].includes(to);
export const isPublic = (r: Pick<Review, "state">): boolean => r.state === "approved";

/* ---------- loyalty and referrals ---------- */

export const LoyaltyLedgerEntry = z.object({
  contactId: Id,
  delta: z.number().int().refine((n) => n !== 0, "a ledger entry changes the balance"),
  reason: z.enum(["order", "refund_reversal", "redemption", "referral", "manual_adjustment"]),
  orderRef: Id.optional(),
  /** One entry per outcome: the platform event's idempotency key, or the redemption id. */
  idempotencyKey: z.string().min(1).max(200),
  at: When,
}).strict();
export type LoyaltyLedgerEntry = z.infer<typeof LoyaltyLedgerEntry>;

export const Reward = z.object({
  id: Id,
  kind: z.enum(["percent_off", "fixed_off", "free_shipping"]),
  costPoints: z.number().int().positive(),
  /** percent_off: 1-90 (the store's discount ceiling still applies); fixed_off: an amount in store currency; free_shipping: 0. */
  value: z.number().min(0),
}).strict().superRefine((r, ctx) => {
  if (r.kind === "percent_off" && (r.value < 1 || r.value > 90)) ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage reward is between 1 and 90" });
});
export type Reward = z.infer<typeof Reward>;

export const ReferralAttribution = z.object({
  referrerContactId: Id, code: z.string().regex(/^[A-Z0-9-]{4,32}$/), externalOrderId: Id,
  /** Days after the code was used within which an order counts. Self-referral is refused by the module, not by this shape. */
  windowDays: z.number().int().min(1).max(90), attributedAt: When,
}).strict();

export interface EarnRule { pointsPerCurrencyUnit: number; minimumOrder: number }

/** Points for an order, rounded down: an order under the minimum earns nothing. */
export const pointsForOrder = (total: number, rule: EarnRule): number => (total >= rule.minimumOrder && total > 0 ? Math.floor(total * rule.pointsPerCurrencyUnit) : 0);

/**
 * Applies new entries to a ledger. Entries are idempotent by key (a redelivered event awards once), and a redemption that
 * would take the balance below zero is refused rather than recorded.
 */
export function applyLedger(existing: readonly LoyaltyLedgerEntry[], incoming: readonly LoyaltyLedgerEntry[]): { ledger: LoyaltyLedgerEntry[]; refused: LoyaltyLedgerEntry[] } {
  const ledger = [...existing];
  const keys = new Set(existing.map((e) => e.idempotencyKey));
  const refused: LoyaltyLedgerEntry[] = [];
  const balance = (contactId: string) => ledger.filter((e) => e.contactId === contactId).reduce((n, e) => n + e.delta, 0);
  for (const e of incoming) {
    if (keys.has(e.idempotencyKey)) continue;
    if (e.reason === "redemption" && balance(e.contactId) + e.delta < 0) { refused.push(e); continue; }
    // A refund reversal never pushes a balance below zero either: it takes back at most what is there.
    const entry = e.reason === "refund_reversal" ? { ...e, delta: Math.max(e.delta, -balance(e.contactId)) } : e;
    keys.add(e.idempotencyKey);
    if (entry.delta !== 0) ledger.push(entry);
  }
  return { ledger, refused };
}

/* ---------- post-purchase ---------- */

export const ReturnRequest = z.object({
  externalOrderId: Id, kind: z.enum(["return", "exchange"]),
  lines: z.array(z.object({ variantExternalId: Id, quantity: z.number().int().positive(), reason: z.enum(["too_small", "too_large", "damaged", "not_as_described", "changed_mind", "other"]) }).strict()).min(1).max(50),
  state: z.enum(["requested", "approved", "received", "refunded", "rejected"]),
}).strict();
export type ReturnRequest = z.infer<typeof ReturnRequest>;
