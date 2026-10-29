"use client";
import Link from "next/link";
import { use, useState } from "react";
import { ArrowRight, CircleDollarSign, Download, Eye, Mail, MailCheck, MousePointerClick, Percent, Receipt, ShoppingBag } from "lucide-react";
import { PLANS, type PlanId } from "@convertflow/contracts";
import type { CampaignRow, Store } from "@/lib/api";
import { int, pct, useApi } from "@/lib/use-api";
import { useRange, type Analytics } from "@/lib/analytics";
import { NeedStore } from "@/components/need-store";
import { CampaignSteps } from "@/components/campaign-steps";
import { Funnel } from "@/components/visuals";
import { Badge, Button, ErrorNote, Metric, Notice, PageHeader, Select, SectionTitle, Skeleton, statusTone } from "@/components/ui";
import { TOOLS } from "@/lib/tools";
import { typeLabel, typeOf } from "@/lib/campaign-types";

interface Measure { label: string; value: number | null; help: string; format?: "count" | "money" | "rate"; missing?: true }
interface Subscription { plan: PlanId }

/** One campaign's numbers. Headline metrics first, then the shopper journey, then every measure with what it means. */
export function Performance({ store, id }: { store: Store; id: string }) {
  const [days, setDays] = useState(30);
  const range = useRange(days);
  const campaign = useApi<CampaignRow>(`/api/v1/stores/${store.id}/campaigns/${id}`);
  const analytics = useApi<Analytics>(`/api/v1/stores/${store.id}/analytics?${range}`);
  const plan = useApi<Subscription>(`/api/v1/billing/subscription?organizationId=${store.organizationId}`);
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: store.currency }).format(n);

  const c = campaign.data;
  const email = c?.tool === "email";
  const m = analytics.data?.campaigns.find((x) => x.campaignId === id);
  const form = analytics.data?.forms?.find((f) => f.campaignId === id);
  const viewers = m?.impressions ?? 0;
  const conversions = m?.clicks ?? 0;
  const orders = m?.attributedOrders ?? 0;
  const revenue = m?.attributedRevenue ?? 0;
  const subscribes = form?.confirmed ?? 0;
  const requests = form?.requested ?? 0;
  const deliveryFailed = form?.deliveryFailed ?? 0;
  const addToCarts = m?.addToCarts ?? 0;
  const convRate = viewers > 0 ? conversions / viewers : null;
  const orderRate = conversions > 0 ? orders / conversions : null;
  const aov = orders > 0 ? revenue / orders : null;
  const confirmRate = form?.confirmRate ?? (requests > 0 ? subscribes / requests : null);
  const requestRate = form?.requestRate ?? (viewers > 0 ? requests / viewers : null);
  const planTools = plan.data ? PLANS[plan.data.plan]?.tools : undefined;
  const emailNotInPlan = email && !!planTools && !planTools.includes("email") && (c?.status === "active" || c?.status === "scheduled");
  // A form campaign can have sign-up requests without a single click, so every outcome counts as activity.
  const noActivity = !!analytics.data && viewers === 0 && orders === 0 && conversions === 0 && requests === 0 && subscribes === 0 && addToCarts === 0;

  const measures: Measure[] = email ? [
    { label: "Viewers", value: viewers, help: "Times this campaign was shown, counted from browsers that accepted analytics." },
    { label: "Signup requests", value: requests, help: "Sign-up requests received by our server, including shoppers who declined analytics. Each one gets a confirmation email." },
    { label: "Confirmed subscribers", value: subscribes, help: "Shoppers who confirmed from their inbox. Counted on our server." },
    { label: "Confirmation rate", value: confirmRate, help: "Confirmed subscribers ÷ sign-up requests.", format: "rate" },
    { label: "Delivery failures", value: deliveryFailed, help: "Confirmation emails that could not be sent. Those shoppers are not confirmed and can try again." },
    { label: "Orders", value: orders, help: "Orders within 7 days of a click (last click), reported by the store." },
    { label: "Revenue", value: revenue, help: "Revenue from those orders. Not incremental: it includes orders that would have happened anyway.", format: "money" },
  ] : [
    { label: "Viewers", value: viewers, help: "Times this campaign was shown, counted from browsers that accepted analytics." },
    { label: "Conversions", value: conversions, help: "Clicks on the campaign's button." },
    { label: "Completions", value: null, help: "Finished multi-step flows, such as a quiz. Not measured yet.", missing: true },
    { label: "Subscribes", value: subscribes, help: "Sign-ups confirmed by email through this campaign's form. Counted on our server." },
    { label: "Added to cart", value: addToCarts, help: "Add-to-cart events after the campaign was shown." },
    { label: "Orders", value: orders, help: "Orders within 7 days of a click (last click), reported by the store." },
    { label: "Revenue", value: revenue, help: "Revenue from those orders. Not incremental: it includes orders that would have happened anyway.", format: "money" },
  ];

  const formatMeasure = (x: Measure) =>
    x.value === null ? "–" : x.format === "rate" ? pct(x.value) : x.format === "money" ? money(x.value) : int(x.value);

  const exportCsv = () => {
    const rows = email ? [
      ["metric", "value"],
      ["viewers", String(viewers)],
      ["signup_requests", String(requests)],
      ["confirmation_rate", confirmRate === null ? "" : (confirmRate * 100).toFixed(2)],
      ["confirmed", String(subscribes)],
      ["delivery_failed", String(deliveryFailed)],
      ["orders", String(orders)],
      ["revenue", revenue.toFixed(2)],
    ] : [
      ["metric", "value"],
      ["viewers", String(viewers)],
      ["conversions", String(conversions)],
      ["conversion_rate", convRate === null ? "" : (convRate * 100).toFixed(2)],
      ["orders", String(orders)],
      ["revenue", revenue.toFixed(2)],
      ["aov", aov === null ? "" : aov.toFixed(2)],
      ["subscribes", String(subscribes)],
      ["added_to_cart", String(addToCarts)],
    ];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${(campaign.data?.name ?? "campaign").replace(/\W+/g, "-").toLowerCase()}-report.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <CampaignSteps id={id} current="campaign" />

      <PageHeader eyebrow="Campaign" title={c?.name ?? "Campaign"}
        sub="How this campaign performed. Measured only from visitors who consented to analytics."
        actions={<div className="flex flex-wrap items-center gap-2"><Select aria-label="Date range" className="w-44" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select><Button onClick={exportCsv} disabled={!analytics.data}><Download className="size-4" aria-hidden />Export report</Button></div>} />

      {c && (
        <div className="-mt-3 mb-7 flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <Badge tone={statusTone(c.status)} dot>{c.status}</Badge>
          <span aria-hidden>·</span>
          <span>{typeLabel(typeOf(c))}</span>
          <span aria-hidden>·</span>
          <span>{TOOLS[c.tool]?.name ?? c.tool}</span>
        </div>
      )}

      <ErrorNote error={analytics.error ?? campaign.error} />
      {(analytics.loading || campaign.loading) && <Skeleton className="h-40" />}

      {analytics.data && (
        <div className="grid gap-6">
          {emailNotInPlan && (
            <Notice tone="warn" role="status">
              <span className="font-medium">This campaign cannot collect sign-ups on your current plan.</span> Email signup is not included in your plan, so the form is still shown but requests are discarded.{" "}
              <Link href="/app/settings#billing" className="inline-flex items-center gap-1 font-medium text-brand underline-offset-4 hover:underline">Change plan<ArrowRight className="size-3.5" aria-hidden /></Link>
            </Notice>
          )}
          {deliveryFailed > 0 && (
            <Notice tone="warn" role="status">
              {int(deliveryFailed)} confirmation {deliveryFailed === 1 ? "email" : "emails"} could not be sent in this period. Those shoppers were not confirmed; check your email sending setup.
            </Notice>
          )}
          {noActivity && !emailNotInPlan && (
            <Notice tone="brand" role="status">
              <span className="font-medium">No activity in this period yet.</span> Numbers appear once the campaign is live and the snippet is on your site.{" "}
              <Link href={`/app/campaigns/${id}/launch`} className="inline-flex items-center gap-1 font-medium text-brand underline-offset-4 hover:underline">Check launch settings<ArrowRight className="size-3.5" aria-hidden /></Link>
            </Notice>
          )}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {email ? (
              <>
                <Metric icon={Eye} label="Viewers" value={int(viewers)} note="Impressions" />
                <Metric icon={Mail} label="Signup requests" value={int(requests)} note="Server-counted" />
                <Metric icon={MailCheck} label="Confirmed" value={int(subscribes)} note="Subscribers" />
                <Metric icon={Percent} label="Confirmation rate" value={pct(confirmRate)} note="Confirmed ÷ requests" />
                <Metric icon={ShoppingBag} label="Orders" value={int(orders)} note="Attributed, 7 days" />
                <Metric icon={CircleDollarSign} label="Revenue" value={money(revenue)} note="Not incremental" />
              </>
            ) : (
              <>
                <Metric icon={Eye} label="Viewers" value={int(viewers)} note="Impressions" />
                <Metric icon={MousePointerClick} label="Conversions" value={int(conversions)} note="Clicks" />
                <Metric icon={Percent} label="Conversion rate" value={pct(convRate)} note="Clicks ÷ viewers" />
                <Metric icon={ShoppingBag} label="Orders" value={int(orders)} note="Attributed, 7 days" />
                <Metric icon={CircleDollarSign} label="Revenue" value={money(revenue)} note="Not incremental" />
                <Metric icon={Receipt} label="AOV" value={aov === null ? "–" : money(aov)} note="Revenue ÷ orders" />
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <section aria-labelledby="journey-h" className="card self-start p-6 md:p-7 lg:col-span-3">
              <SectionTitle id="journey-h" sub={email ? "From viewers to confirmed subscribers in the selected period." : "From viewers to orders in the selected period."}>Shopper journey</SectionTitle>
              <div className="mt-6">
                <Funnel steps={email ? [
                  { label: "Viewers", value: viewers },
                  { label: "Requests", value: requests },
                  { label: "Confirmed", value: subscribes },
                ] : [
                  { label: "Viewers", value: viewers },
                  { label: "Conversions", value: conversions },
                  { label: "Orders", value: orders },
                ]} />
              </div>
              <dl className="mt-7 grid grid-cols-2 gap-4 border-t border-line pt-5 text-sm">
                {email ? (
                  <>
                    <div>
                      <dt className="text-ink-3">Viewers to requests</dt>
                      <dd className="num mt-1 text-lg font-medium">{pct(requestRate)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Requests to confirmed</dt>
                      <dd className="num mt-1 text-lg font-medium">{pct(confirmRate)}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt className="text-ink-3">Viewers who clicked</dt>
                      <dd className="num mt-1 text-lg font-medium">{pct(convRate)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Clicks that ordered</dt>
                      <dd className="num mt-1 text-lg font-medium">{pct(orderRate)}</dd>
                    </div>
                  </>
                )}
              </dl>
              {email && <p className="mt-4 text-xs leading-relaxed text-ink-3">Requests and confirmations are counted on our server, so they include shoppers who declined analytics. The viewer-to-request rate is an estimate.</p>}
            </section>

            <section aria-labelledby="measures-h" className="card p-6 md:p-7 lg:col-span-2">
              <SectionTitle id="measures-h" sub="Every measure for this campaign.">Measures</SectionTitle>
              <ul className="mt-4 divide-y divide-line">
                {measures.map((x) => (
                  <li key={x.label} className="flex items-start justify-between gap-4 py-3.5">
                    <div className="min-w-0">
                      <div className="font-medium">{x.label}</div>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{x.help}</p>
                    </div>
                    {x.missing
                      ? <span className="shrink-0 rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-xs text-ink-3">Not tracked yet</span>
                      : <span className="num shrink-0 text-lg font-medium">{formatMeasure(x)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {analytics.data.notes[0] && <Notice>{analytics.data.notes[0]}</Notice>}
        </div>
      )}
    </>
  );
}

function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <NeedStore>{(s) => <Performance store={s} id={id} />}</NeedStore>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Inner params={params} />;
}
