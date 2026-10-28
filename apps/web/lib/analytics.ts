"use client";
import { useMemo } from "react";
import type { Tool } from "@convertflow/contracts";
import { isoDay } from "./use-api";

export interface Arm { sessions: number; orders: number; revenue: number }
export interface Experiment {
  campaignId: string; treatment: Arm; holdout: Arm;
  treatmentRate: number | null; holdoutRate: number | null; relativeLift: number | null; pValue: number | null;
  verdict: "insufficient_data" | "not_significant" | "significant_positive" | "significant_negative";
}

export interface Analytics {
  totals: { eligible: number; impressions: number; clicks: number; dismissals: number; addToCarts?: number; ctr: number | null; observedOrders: number; observedRevenue: number; attributedOrders: number; attributedRevenue: number };
  campaigns: { campaignId: string; impressions: number; clicks: number; dismissals: number; addToCarts?: number; ctr: number | null; attributedOrders: number; attributedRevenue: number }[];
  /** Email signup forms: server-side request and confirmation counts, with browser-reported impressions alongside. */
  forms?: { campaignId: string; impressions: number; requested: number; confirmed: number; deliveryFailed?: number; requestRate: number | null; confirmRate: number | null }[];
  experiments: Experiment[];
  freshness: { latestDay: string | null };
  notes: string[];
}

/** Everything one campaign or one tool is measured by. Keys match `ToolMetricKey` in the contracts. A rate is null when its denominator is zero. */
export interface ToolMetrics {
  eligible: number; impressions: number; clicks: number; dismissals: number; addToCarts: number;
  formSubmitAttempts: number; formSubmitSuccesses: number; formSubmitFailures: number;
  requested: number; confirmed: number; deliveryFailed: number;
  attributedOrders: number; attributedRevenue: number;
  ctr: number | null; dismissRate: number | null; addToCartRate: number | null; requestRate: number | null; confirmRate: number | null;
}
export interface ToolRollup {
  tool: Tool; campaigns: number; live: number; metrics: ToolMetrics;
  byCampaign: ({ campaignId: string; name: string; status: string } & ToolMetrics)[];
}
export interface ToolAnalytics { range: { from: string; to: string }; tools: ToolRollup[]; freshness: { latestDay: string | null }; notes: string[] }

export function useRange(days: number) {
  return useMemo(() => {
    const to = new Date(), from = new Date(Date.now() - (days - 1) * 86_400_000);
    return `from=${isoDay(from)}&to=${isoDay(to)}`;
  }, [days]);
}
