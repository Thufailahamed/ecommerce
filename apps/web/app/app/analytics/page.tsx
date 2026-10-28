"use client";
import { useState } from "react";
import type { Store, CampaignRow } from "@/lib/api";
import { int, pct, useApi } from "@/lib/use-api";
import { useRange, type Analytics } from "@/lib/analytics";
import { FormResults } from "@/components/form-results";
import { NeedStore } from "@/components/need-store";
import { ToolAnalyticsView, ViewTabs, type View as AnalyticsView } from "@/components/tool-analytics";
import { Empty, ErrorNote, Metric, PageHeader, Select, Skeleton } from "@/components/ui";

function View({ store }: { store: Store }) {
  const [view, setView] = useState<AnalyticsView>("overview");
  const [days, setDays] = useState(30);
  const range = useRange(days);
  const { data, error, loading } = useApi<Analytics>(`/api/v1/stores/${store.id}/analytics?${range}`);
  const names = useApi<CampaignRow[]>(`/api/v1/stores/${store.id}/campaigns`);
  const nameOf = (id: string) => names.data?.find((c) => c.id === id)?.name ?? id;
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: store.currency }).format(n);
  const max = Math.max(1, ...(data?.campaigns.map((c) => c.impressions) ?? [1]));

  return (
    <>
      <PageHeader title="Analytics" sub="First-party campaign activity. Collected only from visitors who gave consent."
        actions={<Select aria-label="Date range" className="w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select>} />
      <ViewTabs value={view} onChange={setView} />
      {view === "tools" ? <ToolAnalyticsView store={store} range={range} /> : <div role="tabpanel" id="analytics-panel" aria-labelledby="analytics-tab-overview">
      <ErrorNote error={error} />
      {loading && <Skeleton className="h-40" />}
      {data && data.totals.impressions === 0 && data.totals.observedOrders === 0 && data.experiments.length === 0 && !data.forms?.length && (
        <Empty title="No activity in this period" body="Once a published campaign is shown to visitors who have consented to analytics, impressions and clicks appear here. Check Settings to confirm the snippet is installed." />
      )}
      {data && (data.totals.impressions > 0 || data.totals.observedOrders > 0 || data.experiments.length > 0 || (data.forms?.length ?? 0) > 0) && (
        <>
          <div className="grid grid-cols-2 gap-6 border-b border-line pb-8 md:grid-cols-4">
            <Metric label="Eligible visitors" value={int(data.totals.eligible)} />
            <Metric label="Impressions" value={int(data.totals.impressions)} />
            <Metric label="Clicks" value={int(data.totals.clicks)} note={`CTR ${pct(data.totals.ctr)}`} />
            <Metric label="Dismissals" value={int(data.totals.dismissals)} />
          </div>
          <div className="grid grid-cols-2 gap-6 border-b border-line py-8 md:grid-cols-4">
            <Metric label="Observed orders" value={int(data.totals.observedOrders)} note="All orders reported" />
            <Metric label="Observed revenue" value={money(data.totals.observedRevenue)} />
            <Metric label="Attributed orders" value={int(data.totals.attributedOrders)} note="Last click, 7 days" />
            <Metric label="Attributed revenue" value={money(data.totals.attributedRevenue)} note="Not incremental" />
          </div>
          <p className="mt-4 border-l-2 border-warn bg-warn/10 px-3 py-2 text-sm">{data.notes[0]}</p>
          <h2 className="mb-3 mt-10 text-sm font-semibold">By campaign</h2>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-2 font-medium">Campaign</th><th className="w-1/3 font-medium">Impressions</th><th className="text-right font-medium">Clicks</th><th className="text-right font-medium">CTR</th><th className="text-right font-medium">Attributed</th></tr></thead>
            <tbody>{data.campaigns.map((c) => (
              <tr key={c.campaignId} className="border-b border-line">
                <td className="py-3 font-medium">{nameOf(c.campaignId)}</td>
                <td><div className="flex items-center gap-2"><div className="h-2 rounded-sm bg-brand" style={{ width: `${(c.impressions / max) * 100}%`, minWidth: 2 }} /><span className="num text-ink-2">{int(c.impressions)}</span></div></td>
                <td className="num text-right">{int(c.clicks)}</td><td className="num text-right">{pct(c.ctr)}</td>
                <td className="num text-right">{c.attributedOrders} · {money(c.attributedRevenue)}</td>
              </tr>))}</tbody>
          </table>
          {data.forms && <FormResults forms={data.forms} nameOf={nameOf} />}
          {data.experiments.length > 0 && (
            <section aria-labelledby="exp-h" className="mt-12">
              <h2 id="exp-h" className="text-sm font-semibold">Holdout experiments: estimated real impact</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-2">A share of consenting visitors never saw the campaign. Comparing orders per session between the two groups estimates what the campaign actually caused, unlike attributed revenue above.</p>
              <div className="mt-4 space-y-4">
                {data.experiments.map((x) => (
                  <article key={x.campaignId} className="card p-5">
                    <h3 className="font-medium">{nameOf(x.campaignId)}</h3>
                    <table className="mt-3 w-full text-sm">
                      <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-1.5 font-medium">Group</th><th className="text-right font-medium">Sessions</th><th className="text-right font-medium">Orders</th><th className="text-right font-medium">Orders per 100 sessions</th></tr></thead>
                      <tbody>
                        {([["Saw the campaign", x.treatment, x.treatmentRate], ["Held out (control)", x.holdout, x.holdoutRate]] as const).map(([label, a, r]) => (
                          <tr key={label} className="border-b border-line"><td className="py-2">{label}</td><td className="num text-right">{int(a.sessions)}</td><td className="num text-right">{int(a.orders)}</td><td className="num text-right">{r === null ? "–" : (r * 100).toFixed(2)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-3 text-sm" data-testid="verdict">
                      {x.verdict === "insufficient_data" && <>Not enough data for a reliable answer yet. We wait for at least 200 sessions in each group and 20 orders in total, because smaller samples produce confident-looking noise.</>}
                      {x.verdict === "not_significant" && <>No reliable difference detected so far. This does not prove the campaign does nothing; it may need more traffic.</>}
                      {x.verdict === "significant_positive" && <><span className="font-medium text-ok">Likely a real increase:</span> visitors who saw it ordered about {pct(x.relativeLift)} more per session (p = {x.pValue?.toFixed(4)}).</>}
                      {x.verdict === "significant_negative" && <><span className="font-medium text-danger">Likely a real decrease:</span> visitors who saw it ordered about {pct(x.relativeLift === null ? null : Math.abs(x.relativeLift))} fewer per session (p = {x.pValue?.toFixed(4)}). Consider pausing it.</>}
                    </p>
                    <p className="mt-1 text-xs text-ink-3">An estimate from randomised groups, not a guarantee. Arms are reported by visitors&apos; browsers.</p>
                  </article>
                ))}
              </div>
            </section>
          )}
          <p className="mt-4 text-xs text-ink-3">Data freshness: latest day with events {data.freshness.latestDay ?? "none"}. Events are processed asynchronously and may lag by a few minutes.</p>
        </>
      )}
      </div>}
    </>
  );
}

export default function Page() { return <NeedStore>{(s) => <View store={s} />}</NeedStore>; }
