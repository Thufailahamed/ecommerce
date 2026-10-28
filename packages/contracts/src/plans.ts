import type { Tool } from "./tools";

export type PlanId = "free" | "starter" | "growth" | "scale";

/**
 * Single source of truth for plans. The API enforces these limits and the marketing site renders
 * them, so the pricing page cannot drift from what is actually enforced.
 */
export interface Plan {
  id: PlanId;
  priceUsdMonthly: number;
  maxStores: number;
  maxActiveCampaigns: number;
  aiGenerationsPerMonth: number;
  trackedPageviewsPerMonth: number;
  /** Back-in-stock email alerts. 0 = not included. */
  notificationsPerMonth: number;
  /** Holdout experiments (incrementality measurement). */
  experiments: boolean;
  /** Tools that may be published on this plan. Back-in-stock forms are governed by notificationsPerMonth instead. */
  tools: readonly Tool[];
}

export const PLANS: Record<PlanId, Plan> = {
  // TEMPORARY (testing): free plan has every tool and no practical limits. Restore the real free limits before launch.
  free: { id: "free", priceUsdMonthly: 0, maxStores: 1_000_000, maxActiveCampaigns: 1_000_000, aiGenerationsPerMonth: 1_000_000, trackedPageviewsPerMonth: 1_000_000_000, notificationsPerMonth: 1_000_000, experiments: true, tools: ["toast", "feed", "upsell", "sms", "email"] },
  starter: { id: "starter", priceUsdMonthly: 19, maxStores: 1, maxActiveCampaigns: 5, aiGenerationsPerMonth: 50, trackedPageviewsPerMonth: 25_000, notificationsPerMonth: 0, experiments: false, tools: ["toast", "feed", "email"] },
  growth: { id: "growth", priceUsdMonthly: 49, maxStores: 3, maxActiveCampaigns: 25, aiGenerationsPerMonth: 300, trackedPageviewsPerMonth: 150_000, notificationsPerMonth: 1_000, experiments: true, tools: ["toast", "feed", "upsell", "sms", "email"] },
  scale: { id: "scale", priceUsdMonthly: 149, maxStores: 10, maxActiveCampaigns: 50, aiGenerationsPerMonth: 2_000, trackedPageviewsPerMonth: 1_000_000, notificationsPerMonth: 10_000, experiments: true, tools: ["toast", "feed", "upsell", "sms", "email"] },
};
