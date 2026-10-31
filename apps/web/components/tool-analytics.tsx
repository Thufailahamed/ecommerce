"use client";
import Link from "next/link";
import { useRef } from "react";
import { TOOL_METRICS, type ToolMetricDef } from "@convertflow/contracts";
import type { Store } from "@/lib/api";
import { TOOLS, TOOL_ORDER } from "@/lib/tools";
import { int, pct, useApi } from "@/lib/use-api";
import type { ToolAnalytics, ToolMetrics, ToolRollup } from "@/lib/analytics";
import { Badge, Empty, ErrorNote, Metric, Skeleton, statusTone } from "@/components/ui";

export type View = "overview" | "tools";
const VIEWS: { id: View; label: string }[] = [{ id: "overview", label: "Overview" }, { id: "tools", label: "By tool" }];

/** Overview / By tool switch. A real tablist: arrow keys move between tabs, and only the selected one is in the tab order. */
export function ViewTabs({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === "ArrowRight" ? (i + 1) % VIEWS.length : e.key === "ArrowLeft" ? (i + VIEWS.length - 1) % VIEWS.length : e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const v = VIEWS[next]!;
    onChange(v.id);
    refs.current[v.id]?.focus();
  };
  return (
    <div role="tablist" aria-label="Analytics view" className="mb-8 inline-flex gap-1 rounded-full border border-line bg-surface p-1">
      {VIEWS.map((v, i) => (
        <button key={v.id} ref={(el) => { refs.current[v.id] = el; }} role="tab" id={`analytics-tab-${v.id}`} aria-selected={value === v.id} aria-controls="analytics-panel"
          tabIndex={value === v.id ? 0 : -1} onClick={() => onChange(v.id)} onKeyDown={(e) => move(e, i)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${value === v.id ? "seg-active" : "text-ink-2 hover:text-ink"}`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function formatMetric(def: ToolMetricDef, value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "–";
  if (def.format === "rate") return pct(value);
  if (def.format === "money") return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  return int(value);
}

export type SectionState = "unavailable" | "no_campaigns" | "no_activity" | "data";
/** What a tool's section should say. A tool with no campaigns is not the same as a live campaign nobody has seen yet. */
export function sectionState(shipped: boolean, r: ToolRollup): SectionState {
  const m = r.metrics;
  const active = m.eligible + m.impressions + m.clicks + m.dismissals + m.addToCarts + m.formSubmitAttempts + m.formSubmitSuccesses + m.formSubmitFailures + m.requested + m.confirmed + m.deliveryFailed + m.attributedOrders;
  if (active > 0) return "data";
  if (!shipped && r.campaigns === 0) return "unavailable";
  if (r.campaigns === 0) return "no_campaigns";
  return "no_activity";
}

const valueOf = (m: ToolMetrics, key: ToolMetricDef["key"]) => (m as unknown as Record<string, number | null>)[key];

function ToolSection({ r, currency }: { r: ToolRollup; currency: string }) {
  const meta = TOOLS[r.tool];
  const defs = TOOL_METRICS[r.tool];
  const state = sectionState(meta.shipped, r);
  const id = `tool-${r.tool}-h`;
  const max = Math.max(1, ...r.byCampaign.map((c) => c.impressions));
  return (
    <section aria-labelledby={id} className="card mb-6 p-6 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={id} className="font-display text-base font-bold uppercase tracking-wide">{meta.name}</h2>
        {!meta.shipped && <Badge>Not available yet</Badge>}
        {meta.shipped && r.campaigns > 0 && <span className="text-sm text-ink-3">{r.live} live of {r.campaigns} {r.campaigns === 1 ? "campaign" : "campaigns"}</span>}
      </div>

      {state === "unavailable" && <p className="mt-2 text-sm text-ink-2">This tool is not available yet, so there is nothing to measure.</p>}
      {state === "no_campaigns" && (
        <Empty title={`No ${meta.name.toLowerCase()} campaigns yet`} body="Numbers appear here once a campaign is published and shown to visitors who have consented to analytics."
          action={<Link href={`/app/tools/${r.tool}`} className="text-sm font-semibold text-brand hover:underline">Go to {meta.name}</Link>} />
      )}
      {state === "no_activity" && <p className="mt-3 text-sm text-ink-2" data-testid={`${r.tool}-quiet`}>No activity in this period. Check that the campaign is live and the snippet is installed.</p>}

      {state === "data" && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {defs.map((d) => <Metric key={d.key} label={d.label} value={formatMetric(d, valueOf(r.metrics, d.key), currency)} {...(d.note ? { note: d.note } : {})} />)}
          </div>
          {r.metrics.deliveryFailed > 0 && (
            <p className="mt-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm leading-relaxed">
              {int(r.metrics.deliveryFailed)} confirmation {r.metrics.deliveryFailed === 1 ? "email" : "emails"} could not be sent in this period. Those shoppers were not confirmed; check your email sending setup.
            </p>
          )}
          <div className="mt-6 overflow-hidden rounded-2xl border border-line">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr:hover]:bg-ink/[0.025] [&_td]:px-4 [&_td]:py-3 [&_th]:bg-ink/[0.02] [&_th]:px-4 [&_th]:py-3">
              <caption className="sr-only">{meta.name} by campaign</caption>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  <th scope="col" className="font-medium">Campaign</th>
                  {defs.map((d) => <th key={d.key} scope="col" className="text-right font-medium">{d.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {r.byCampaign.map((c) => (
                  <tr key={c.campaignId}>
                    <th scope="row" className="text-left font-medium">
                      <Link href={`/app/campaigns/${c.campaignId}`} className="hover:underline">{c.name}</Link>{" "}
                      <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                    </th>
                    {defs.map((d) => (
                      <td key={d.key} className="num text-right">
                        {d.key === "impressions"
                          ? <div className="flex items-center justify-end gap-2"><div aria-hidden className="h-2 rounded-full bg-gradient-to-r from-brand-solid to-brand-glow" style={{ width: `${Math.max(4, (c.impressions / max) * 48)}px` }} /><span>{int(c.impressions)}</span></div>
                          : formatMetric(d, valueOf(c, d.key), currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Per-tool rollups for a date range, from `GET /stores/:id/analytics/tools`. */
export function ToolAnalyticsView({ store, range }: { store: Store; range: string }) {
  const { data, error, loading } = useApi<ToolAnalytics>(`/api/v1/stores/${store.id}/analytics/tools?${range}`);
  const byTool = new Map(data?.tools.map((t) => [t.tool, t]));
  return (
    <div role="tabpanel" id="analytics-panel" aria-labelledby="analytics-tab-tools">
      <ErrorNote error={error} />
      {loading && <Skeleton className="h-40" />}
      {data && (
        <>
          {TOOL_ORDER.map((tool) => { const r = byTool.get(tool); return r ? <ToolSection key={tool} r={r} currency={store.currency} /> : null; })}
          <ul className="mt-6 space-y-2">
            {data.notes.map((n) => <li key={n} className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm leading-relaxed">{n}</li>)}
          </ul>
          <p className="mt-4 text-xs text-ink-3">Data freshness: latest day with events {data.freshness.latestDay ?? "none"}. Events are processed asynchronously and may lag by a few minutes.</p>
        </>
      )}
    </div>
  );
}
