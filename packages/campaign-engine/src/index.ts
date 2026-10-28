import { slotOf, toolOf } from "@convertflow/contracts/slots";
import type { CampaignConfig, Condition, PublishedCampaign, RuleGroup, Slot, StorefrontConfig, Trigger } from "@convertflow/contracts";

export interface VisitorContext {
  now: number; // epoch ms
  pageType: "home" | "collection" | "product" | "cart" | "checkout" | "search" | "content" | "other";
  urlPath: string;
  device: "mobile" | "tablet" | "desktop";
  cartSubtotal?: number;
  cartItemCount?: number;
  productId?: string;
  collectionIds?: string[];
  /** undefined = unknown. Unknown never satisfies an availability condition. */
  productAvailable?: boolean;
  visitorType: "new" | "returning";
  pagesViewed: number;
}

export interface SuppressionState {
  sessionImpressions: Record<string, number>;
  visitorImpressions: Record<string, number>;
  dismissedAt: Record<string, number>;
  clickedAt: Record<string, number>;
  /** Legacy single-campaign guard: something is on screen, and anything else is blocked. Prefer `active`. */
  activeCampaignId?: string;
  /** What is on screen right now, with its slot, so only genuinely conflicting experiences are blocked. */
  active?: { campaignId: string; slot: Slot }[];
  /** Epoch ms until which interruptive and ambient experiences stay quiet (set after any dismissal). */
  quietUntil?: number;
  /** Channels this visitor is known to be subscribed on. A signup form for that channel is never shown. */
  subscribed?: { email?: boolean; sms?: boolean };
}

/** After a shopper dismisses anything, interruptive and ambient experiences wait this long. Passive surfaces are unaffected. */
export const QUIET_PERIOD_MS = 60_000;
export const quietUntilAfterDismiss = (now: number): number => now + QUIET_PERIOD_MS;

/** Two experiences conflict when both take attention: interruptive and ambient share the same screen space. Passive never conflicts. */
const conflicts = (a: Slot, b: Slot): boolean => a !== "passive" && b !== "passive";

export type Reason =
  | "delivery_disabled" | "before_start" | "after_end" | "targeting_mismatch"
  | "session_cap" | "visitor_cap" | "dismissed_recently" | "clicked_recently" | "other_active"
  | "quiet_period" | "already_subscribed" | "outranked" | "not_applicable";

export interface Decision {
  campaignId: string;
  versionId: string;
  eligible: boolean;
  reason?: Reason;
}

const DAY = 86_400_000;

export function evaluateCondition(c: Condition, ctx: VisitorContext): boolean {
  switch (c.field) {
    case "page_type": return (c.op === "in") === c.value.includes(ctx.pageType);
    case "url_path":
      if (c.op === "equals") return ctx.urlPath === c.value;
      if (c.op === "starts_with") return ctx.urlPath.startsWith(c.value);
      return ctx.urlPath.includes(c.value);
    case "device": return (c.op === "in") === c.value.includes(ctx.device);
    case "cart_subtotal": {
      const v = ctx.cartSubtotal;
      if (v === undefined) return false;
      if (c.op === "gte") return v >= c.value;
      if (c.op === "lte") return v <= c.value;
      return c.valueTo !== undefined && v >= c.value && v <= c.valueTo;
    }
    case "cart_item_count": {
      const v = ctx.cartItemCount;
      if (v === undefined) return false;
      return c.op === "gte" ? v >= c.value : v <= c.value;
    }
    case "product_id":
      if (ctx.productId === undefined) return false;
      return (c.op === "in") === c.value.includes(ctx.productId);
    case "collection_id": {
      if (!ctx.collectionIds) return false;
      const hit = ctx.collectionIds.some((id) => c.value.includes(id));
      return c.op === "in" ? hit : !hit;
    }
    case "visitor_type": return ctx.visitorType === c.value;
    case "pages_viewed": return ctx.pagesViewed >= c.value;
    case "product_available": return ctx.productAvailable !== undefined && ctx.productAvailable === c.value;
  }
}

export function evaluateRuleGroup(g: RuleGroup, ctx: VisitorContext): boolean {
  if (g.conditions.length === 0) return true;
  return g.match === "all"
    ? g.conditions.every((c) => evaluateCondition(c, ctx))
    : g.conditions.some((c) => evaluateCondition(c, ctx));
}

export function evaluateCampaign(p: PublishedCampaign, ctx: VisitorContext, s: SuppressionState): Decision {
  const { config: cfg, campaignId, versionId } = p;
  const no = (reason: Reason): Decision => ({ campaignId, versionId, eligible: false, reason });

  const start = cfg.schedule.startsAt ? Date.parse(cfg.schedule.startsAt) : undefined;
  const end = cfg.schedule.endsAt ? Date.parse(cfg.schedule.endsAt) : undefined;
  if (start !== undefined && ctx.now < start) return no("before_start");
  if (end !== undefined && ctx.now >= end) return no("after_end");

  if (!evaluateRuleGroup(cfg.targeting, ctx)) return no("targeting_mismatch");

  // A free-shipping toast states a fact about the shopper's cart, so it needs a known cart that is still short of the threshold.
  if (cfg.toast?.kind === "shipping_incentive" && cfg.toast.freeShippingThreshold !== undefined
    && remainingForFreeShipping(cfg.toast.freeShippingThreshold, ctx.cartSubtotal) === undefined) return no("not_applicable");

  // A recommendation block that says it belongs on the product page has nothing to anchor to anywhere else.
  if (cfg.recommend?.placement === "product_page" && ctx.pageType !== "product") return no("not_applicable");

  const slot = slotOf(cfg);
  const passive = slot === "passive";

  // A signup form for a channel the visitor already subscribed on is pointless and annoying. (Restock is per product, so it is exempt.)
  const tool = toolOf(cfg);
  if (cfg.format !== "restock" && ((tool === "email" && s.subscribed?.email) || (tool === "sms" && s.subscribed?.sms))) return no("already_subscribed");

  // Impression caps and click cooldowns exist to stop repeated interruptions. Passive surfaces (feed bell, inline
  // forms, inline recommendations) are part of the page, so a cap would make them vanish after the first view.
  const f = cfg.frequency;
  if (!passive) {
    if ((s.sessionImpressions[campaignId] ?? 0) >= f.maxImpressionsPerSession) return no("session_cap");
    if (f.maxImpressionsPerVisitor !== undefined && (s.visitorImpressions[campaignId] ?? 0) >= f.maxImpressionsPerVisitor) return no("visitor_cap");
  }
  const d = s.dismissedAt[campaignId];
  if (d !== undefined && ctx.now - d < f.suppressAfterDismissDays * DAY) return no("dismissed_recently");
  if (!passive) {
    const k = s.clickedAt[campaignId];
    if (k !== undefined && ctx.now - k < f.suppressAfterClickDays * DAY) return no("clicked_recently");
    if (s.quietUntil !== undefined && ctx.now < s.quietUntil) return no("quiet_period");
  }
  if (s.activeCampaignId !== undefined && s.activeCampaignId !== campaignId) return no("other_active");
  if (s.active?.some((a) => a.campaignId !== campaignId && conflicts(a.slot, slot))) return no("other_active");

  return { campaignId, versionId, eligible: true };
}

export interface Selection {
  winner?: PublishedCampaign;
  decisions: Decision[];
}

/** Deterministic: highest priority wins, ties broken by campaignId. */
export function selectCampaign(cfg: StorefrontConfig, ctx: VisitorContext, s: SuppressionState): Selection {
  if (!cfg.deliveryEnabled) {
    return {
      decisions: cfg.campaigns.map((c) => ({
        campaignId: c.campaignId, versionId: c.versionId, eligible: false, reason: "delivery_disabled" as const,
      })),
    };
  }
  const decisions = cfg.campaigns.map((c) => evaluateCampaign(c, ctx, s));
  const eligible = cfg.campaigns.filter((_, i) => decisions[i]?.eligible);
  eligible.sort((a, b) => b.config.priority - a.config.priority || a.campaignId.localeCompare(b.campaignId));
  const winner = eligible[0];
  return winner ? { winner, decisions } : { decisions };
}

/**
 * Deterministic experiment arm for a visitor and campaign: FNV-1a over "visitor:campaign" mapped to 0-99.
 * The same visitor always lands in the same arm for a campaign, and arms are independent across campaigns.
 */
export function assignGroup(visitorId: string, campaignId: string, holdoutPercent: number): "treatment" | "holdout" {
  let h = 0x811c9dc5;
  const s = `${visitorId}:${campaignId}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % 100 < holdoutPercent ? "holdout" : "treatment";
}

export function describeCondition(c: Condition): string {
  switch (c.field) {
    case "page_type": return `Page type ${c.op === "in" ? "is" : "is not"} ${c.value.join(" or ")}`;
    case "url_path": return `URL path ${c.op.replace("_", " ")} "${c.value}"`;
    case "device": return `Device ${c.op === "in" ? "is" : "is not"} ${c.value.join(" or ")}`;
    case "cart_subtotal":
      return c.op === "between"
        ? `Cart subtotal between ${c.value} and ${c.valueTo ?? "?"}`
        : `Cart subtotal ${c.op === "gte" ? "at least" : "at most"} ${c.value}`;
    case "cart_item_count": return `Cart has ${c.op === "gte" ? "at least" : "at most"} ${c.value} items`;
    case "product_id": return `Product ${c.op === "in" ? "is" : "is not"} one of ${c.value.length} selected`;
    case "collection_id": return `Collection ${c.op === "in" ? "is" : "is not"} one of ${c.value.length} selected`;
    case "visitor_type": return `Visitor is ${c.value}`;
    case "pages_viewed": return `Viewed at least ${c.value} pages`;
    case "product_available": return `Product is ${c.value ? "in stock" : "out of stock"}`;
  }
}

export function describeRuleGroup(g: RuleGroup): string {
  if (g.conditions.length === 0) return "Shown to all visitors";
  return g.conditions.map(describeCondition).join(g.match === "all" ? " AND " : " OR ");
}

export type { CampaignConfig };

export interface Experiences {
  /** At most one interruptive and one ambient experience, and never both at once (interruptive wins). */
  interruptive?: PublishedCampaign;
  ambient?: PublishedCampaign;
  /** Everything eligible on the page itself (feed items, inline forms, inline recommendations), best first. */
  passive: PublishedCampaign[];
  decisions: Decision[];
}

const byRank = (a: PublishedCampaign, b: PublishedCampaign): number => b.config.priority - a.config.priority || a.campaignId.localeCompare(b.campaignId);

/**
 * Cross-tool arbitration. Deterministic: the same config, visitor and state always give the same result.
 * Every campaign is evaluated on its own rules first; then slots are resolved so a toast never appears on top of a
 * signup popup, and the most relevant (highest priority, then lowest id) experience wins each slot.
 */
export function selectExperiences(cfg: StorefrontConfig, ctx: VisitorContext, s: SuppressionState): Experiences {
  if (!cfg.deliveryEnabled) {
    return { passive: [], decisions: cfg.campaigns.map((c) => ({ campaignId: c.campaignId, versionId: c.versionId, eligible: false, reason: "delivery_disabled" as const })) };
  }
  const decisions = cfg.campaigns.map((c) => evaluateCampaign(c, ctx, s));
  const eligible = cfg.campaigns.filter((_, i) => decisions[i]?.eligible).sort(byRank);
  const inSlot = (slot: Slot) => eligible.filter((c) => slotOf(c.config) === slot);

  const interruptive = inSlot("interruptive")[0];
  let ambient = inSlot("ambient")[0];
  if (interruptive) ambient = undefined;

  const chosen = new Set<string>([...(interruptive ? [interruptive.campaignId] : []), ...(ambient ? [ambient.campaignId] : []), ...inSlot("passive").map((c) => c.campaignId)]);
  const final = decisions.map((d) => (d.eligible && !chosen.has(d.campaignId) ? { ...d, eligible: false, reason: "outranked" as const } : d));

  return { ...(interruptive ? { interruptive } : {}), ...(ambient ? { ambient } : {}), passive: inSlot("passive"), decisions: final };
}

/** Moment-based signals the SDK observes. Timing triggers (delay, scroll, idle, exit intent) are handled by the SDK itself. */
export interface TriggerSignals { cartSubtotal?: number; addedToCart?: boolean }

/**
 * For signal-based triggers, whether the signal has arrived. Unknown never counts: a threshold trigger with no
 * known subtotal does not fire, and add_to_cart only fires after a real add-to-cart was observed.
 */
export function isSignalTriggerSatisfied(t: Trigger, sig: TriggerSignals): boolean {
  switch (t.type) {
    case "add_to_cart": return sig.addedToCart === true;
    case "cart_threshold": return sig.cartSubtotal !== undefined && sig.cartSubtotal >= t.subtotal;
    default: return true;
  }
}

/** The amount left to reach free shipping, or undefined when the cart is unknown or the threshold already met. */
export function remainingForFreeShipping(threshold: number, cartSubtotal: number | undefined): number | undefined {
  if (cartSubtotal === undefined || !(cartSubtotal >= 0) || cartSubtotal >= threshold) return undefined;
  // Round the gap UP to the next cent (with a tolerance for float noise): never tell a shopper "$0.00 more" while still short.
  return Math.max(0.01, Math.ceil((threshold - cartSubtotal) * 100 - 1e-9) / 100);
}
