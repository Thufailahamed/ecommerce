"use client";
import Link from "next/link";
import { BarChart3, CheckCircle2, Eye, Globe, Megaphone, MousePointerClick, Sparkles, Users } from "lucide-react";
import type { CampaignRow, Store } from "@/lib/api";
import { int, pct, useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { Badge, Button, ErrorNote, LiveDot, Metric, SectionTitle, Skeleton } from "@/components/ui";
import { useRange, type Analytics } from "@/lib/analytics";

interface Integration { configPublished: boolean; hasCatalog: boolean }

function Hero({ store, live }: { store: Store; live: number }) {
  return (
    <section aria-labelledby="store-h" className="card relative overflow-hidden p-6 md:p-9">
      <div aria-hidden className="pointer-events-none absolute inset-0 grid-lines opacity-70" />
      <div aria-hidden className="glow-orb -right-24 -top-28 size-80 opacity-50" />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="eyebrow mb-4">Overview</div>
          <h1 id="store-h" className="font-display text-3xl font-extrabold uppercase tracking-tight md:text-4xl">
            <span className="text-grad">{store.name}</span>
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1.5"><Globe className="size-3.5" aria-hidden />{store.domain}</span>
            <span aria-hidden className="text-ink-3">·</span>
            <span className="capitalize">{store.platform}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={store.deliveryEnabled ? "ok" : "warn"} dot>
            {store.deliveryEnabled ? "Delivery on" : "Delivery paused"}
          </Badge>
          <Badge tone={live > 0 ? "ok" : "neutral"}>{live} live</Badge>
          <Link href="/app/studio"><Button variant="primary"><Sparkles className="size-4" aria-hidden />Open AI studio</Button></Link>
        </div>
      </div>
    </section>
  );
}

interface Step { done: boolean; title: string; body: string; href: string; cta: string }

function Checklist({ steps }: { steps: Step[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  const pctDone = Math.round((doneCount / steps.length) * 100);
  return (
    <section aria-labelledby="checklist-h" className="card mt-8 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <SectionTitle id="checklist-h" sub="Finish these to start showing campaigns to shoppers.">Setup checklist</SectionTitle>
        </div>
        <div className="w-full max-w-xs">
          <div className="mb-2 flex items-center justify-between text-xs text-ink-2">
            <span>{doneCount} of {steps.length} complete</span>
            <span className="num font-medium text-ink">{pctDone}%</span>
          </div>
          <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="progress-fill h-full rounded-full" style={{ width: `${pctDone}%` }} />
          </div>
        </div>
      </div>

      <ol className="mt-7 grid gap-3">
        {steps.map((s, i) => {
          const isNext = i === next;
          return (
            <li key={s.title} className={`flex flex-wrap items-center gap-4 rounded-2xl border p-4 transition-colors md:flex-nowrap md:p-5 ${isNext ? "border-brand-tint bg-brand-soft" : "border-line bg-white/[0.02]"}`}>
              <span className={`grid size-10 shrink-0 place-items-center rounded-full ring-1 ${s.done ? "bg-ok/15 text-ok ring-ok/30" : isNext ? "bg-brand-solid text-white ring-brand-tint" : "bg-white/[0.04] text-ink-3 ring-white/10"}`}>
                {s.done ? <CheckCircle2 className="size-5" aria-hidden /> : <span className="num text-sm font-semibold">{i + 1}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={`font-medium ${s.done ? "text-ink-2" : "text-ink"}`}>{s.title}</h3>
                  {s.done && <Badge tone="ok">Done</Badge>}
                  {isNext && <Badge tone="neutral">Next</Badge>}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{s.body}</p>
              </div>
              {!s.done && (
                <Link href={s.href} className="w-full md:w-auto">
                  <Button variant={isNext ? "primary" : "secondary"} className="w-full md:w-auto">{s.cta}</Button>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
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

  const steps: Step[] = [
    { done: integ.data?.hasCatalog ?? false, title: "Add your products", body: "Import your catalog so AI can reference real products and availability.", href: "/app/settings", cta: "Import products" },
    { done: (camps.data?.length ?? 0) > 0, title: "Create your first campaign", body: "Describe a goal to AI or build one by hand.", href: "/app/studio", cta: "Open AI studio" },
    { done: live > 0, title: "Approve and publish", body: "Drafts never go live until you approve them.", href: "/app/campaigns", cta: "Review drafts" },
    { done: hasEvents, title: "Install the snippet and see first activity", body: "Add the one-line script to your storefront. Activity appears once visitors consent to analytics.", href: "/app/settings", cta: "Get snippet" },
  ];

  return (
    <>
      <Hero store={store} live={live} />
      <ErrorNote error={camps.error ?? stats.error ?? integ.error} />
      {loading ? (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric icon={Megaphone} label="Live campaigns" value={int(live)} note={store.deliveryEnabled ? "Delivery on" : "Delivery paused"} />
          <Metric icon={Users} label="Eligible visitors (7d)" value={int(stats.data?.totals.eligible ?? 0)} />
          <Metric icon={Eye} label="Impressions (7d)" value={int(stats.data?.totals.impressions ?? 0)} />
          <Metric icon={MousePointerClick} label="Click-through (7d)" value={pct(stats.data?.totals.ctr ?? null)} />
        </div>
      )}
      {!loading && !hasEvents && (
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-3"><BarChart3 className="size-3.5" aria-hidden />Numbers fill in once a live campaign reaches visitors who consented to analytics.</p>
      )}
      {loading ? <Skeleton className="mt-8 h-80" /> : <Checklist steps={steps} />}
    </>
  );
}

export default function Page() { return <NeedStore>{(s) => <Overview store={s} />}</NeedStore>; }
