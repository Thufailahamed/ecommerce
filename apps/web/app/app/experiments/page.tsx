"use client";
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import type { CampaignRow, Store } from "@/lib/api";
import { int, pct, useApi } from "@/lib/use-api";
import { useRange, type Analytics } from "@/lib/analytics";
import { NeedStore } from "@/components/need-store";
import { Badge, Empty, ErrorNote, PageHeader, Select, Skeleton, tableClass } from "@/components/ui";

const VERDICT: Record<string, { tone: "ok" | "danger" | "warn" | "neutral"; label: string }> = {
  significant_positive: { tone: "ok", label: "Likely lift" },
  significant_negative: { tone: "danger", label: "Likely decrease" },
  not_significant: { tone: "neutral", label: "No clear difference" },
  insufficient_data: { tone: "warn", label: "Gathering data" },
};

/** Holdout experiments: visitors who saw a campaign against a random group that did not. Set per campaign in the Builder. */
function Experiments({ store }: { store: Store }) {
  const [days, setDays] = useState(30);
  const range = useRange(days);
  const analytics = useApi<Analytics>(`/api/v1/stores/${store.id}/analytics?${range}`);
  const campaigns = useApi<CampaignRow[]>(`/api/v1/stores/${store.id}/campaigns`);
  const nameOf = (cid: string) => campaigns.data?.find((c) => c.id === cid)?.name ?? cid;
  const experiments = analytics.data?.experiments ?? [];

  return (
    <>
      <PageHeader eyebrow="Insights" title="Experiments" sub="Holdout tests: does a campaign change what shoppers buy, compared with a random group that never sees it?"
        actions={<Select aria-label="Date range" className="w-44" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select>} />
      <ErrorNote error={analytics.error} />
      {analytics.loading && <Skeleton className="h-40" />}
      {analytics.data && experiments.length === 0 && (
        <Empty icon={FlaskConical} title="No experiments yet" body="Turn on a holdout in a campaign's Builder, under the Test tab. A share of consenting visitors then never sees the campaign, so you get a fair comparison." />
      )}
      {experiments.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Holdout experiments</caption>
              <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Campaign</th><th className="text-right font-medium">Sessions shown</th><th className="text-right font-medium">Sessions held out</th><th className="text-right font-medium">Relative lift</th><th className="font-medium">Result</th></tr></thead>
              <tbody>
                {experiments.map((x) => {
                  const v = VERDICT[x.verdict] ?? VERDICT.insufficient_data!;
                  return (
                    <tr key={x.campaignId}>
                      <td className="font-medium">{nameOf(x.campaignId)}</td>
                      <td className="num text-right">{int(x.treatment.sessions)}</td>
                      <td className="num text-right">{int(x.holdout.sessions)}</td>
                      <td className="num text-right">{pct(x.relativeLift)}</td>
                      <td><Badge tone={v.tone} dot>{v.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <NeedStore>{(s) => <Experiments store={s} />}</NeedStore>;
}
