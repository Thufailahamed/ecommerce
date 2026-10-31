import { STORE_METRICS, type MetricKind } from "@convertflow/contracts";
import type { Deps } from "../deps.js";
import { getAnalytics } from "./analytics.js";

export interface Evidence {
  range: { from: string; to: string };
  /** Latest UTC day any figure was counted, or null when there is no data at all. */
  latestDay: string | null;
  metrics: { key: string; label: string; kind: MetricKind; value: number | null }[];
  campaigns: { id: string; impressions: number; clicks: number; ctr: number | null; attributedOrders: number }[];
}

/**
 * Aggregate, non-personal figures for a store over the last `days`, keyed by the metric registry. This is what the AI
 * is allowed to see about performance, and what a recommendation must cite: it never contains a shopper.
 */
export async function metricSnapshot(d: Deps, storeId: string, days = 30): Promise<Evidence> {
  const to = d.now().toISOString().slice(0, 10);
  const from = new Date(d.now().getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const a = await getAnalytics(d, storeId, from, to);
  const totals = a.totals as Record<string, number | null>;
  return {
    range: { from, to },
    latestDay: a.freshness.latestDay,
    metrics: STORE_METRICS.filter((m) => m.key in totals).map((m) => ({ key: m.key, label: m.label, kind: m.kind, value: totals[m.key] ?? null })),
    campaigns: a.campaigns.slice(0, 20).map((c) => {
      const imp = Number(c.impressions), clk = Number(c.clicks);
      return { id: c.campaignId, impressions: imp, clicks: clk, ctr: imp > 0 ? clk / imp : null, attributedOrders: Number(c.attributedOrders) };
    }),
  };
}

/** Every number in the evidence, in the forms a summary may legitimately quote it (as is, rounded, or as a percentage). */
export function evidenceNumbers(e: Evidence): Set<string> {
  const out = new Set<string>([String(e.range.from.slice(0, 4))]);
  const add = (v: number | null, rate = false) => {
    if (v === null || !Number.isFinite(v)) return;
    out.add(String(v)); out.add(String(Math.round(v))); out.add(v.toFixed(2)); out.add(v.toFixed(1));
    if (rate) { const p = v * 100; out.add(p.toFixed(1)); out.add(p.toFixed(2)); out.add(String(Math.round(p))); }
  };
  for (const m of e.metrics) add(m.value, m.key === "ctr");
  for (const c of e.campaigns) { add(c.impressions); add(c.clicks); add(c.attributedOrders); add(c.ctr, true); }
  return out;
}
