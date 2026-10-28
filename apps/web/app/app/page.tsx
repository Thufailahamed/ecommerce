"use client";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { CampaignRow, Store } from "@/lib/api";
import { int, pct, useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { Button, ErrorNote, Metric, PageHeader, Skeleton } from "@/components/ui";
import { useRange, type Analytics } from "@/lib/analytics";

interface Integration { configPublished: boolean; hasCatalog: boolean }

function Step({ done, title, body, href, cta }: { done: boolean; title: string; body: string; href: string; cta: string }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-start gap-3 border-b border-line py-4">
      <Icon className={done ? "mt-0.5 size-5 text-ok" : "mt-0.5 size-5 text-ink-3"} aria-hidden />
      <div className="flex-1"><div className="font-medium">{title}{done && <span className="sr-only"> (done)</span>}</div><p className="text-sm text-ink-2">{body}</p></div>
      {!done && <Link href={href}><Button>{cta}</Button></Link>}
    </li>
  );
}

function Overview({ store }: { store: Store }) {
  const range = useRange(7);
  const camps = useApi<CampaignRow[]>(`/api/v1/stores/${store.id}/campaigns`);
  const stats = useApi<Analytics>(`/api/v1/stores/${store.id}/analytics?${range}`);
  const integ = useApi<Integration>(`/api/v1/stores/${store.id}/integration`);

  const live = camps.data?.filter((c) => c.status === "active" || c.status === "scheduled").length ?? 0;
  const hasEvents = (stats.data?.totals.eligible ?? 0) > 0 || (stats.data?.totals.impressions ?? 0) > 0;
  const loading = camps.loading || stats.loading || integ.loading;

  return (
    <>
      <PageHeader title={store.name} sub={`${store.domain} · ${store.platform}`} />
      <ErrorNote error={camps.error ?? stats.error ?? integ.error} />
      {loading ? <Skeleton className="h-32" /> : (
        <div className="grid grid-cols-2 gap-6 border-b border-line pb-8 md:grid-cols-4">
          <Metric label="Live campaigns" value={int(live)} note={store.deliveryEnabled ? "Delivery on" : "Delivery paused"} />
          <Metric label="Eligible visitors (7d)" value={int(stats.data?.totals.eligible ?? 0)} />
          <Metric label="Impressions (7d)" value={int(stats.data?.totals.impressions ?? 0)} />
          <Metric label="Click-through (7d)" value={pct(stats.data?.totals.ctr ?? null)} />
        </div>
      )}
      <h2 className="mb-1 mt-10 text-sm font-semibold">Setup checklist</h2>
      <ul>
        <Step done={integ.data?.hasCatalog ?? false} title="Add your products" body="Import your catalog so AI can reference real products and availability." href="/app/settings" cta="Import products" />
        <Step done={(camps.data?.length ?? 0) > 0} title="Create your first campaign" body="Describe a goal to AI or build one by hand." href="/app/studio" cta="Open AI studio" />
        <Step done={live > 0} title="Approve and publish" body="Drafts never go live until you approve them." href="/app/campaigns" cta="Review drafts" />
        <Step done={hasEvents} title="Install the snippet and see first activity" body="Add the one-line script to your storefront. Activity appears once visitors consent to analytics." href="/app/settings" cta="Get snippet" />
      </ul>
    </>
  );
}

export default function Page() { return <NeedStore>{(s) => <Overview store={s} />}</NeedStore>; }
