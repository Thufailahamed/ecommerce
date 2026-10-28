"use client";
import Link from "next/link";
import { use } from "react";
import { notFound } from "next/navigation";
import { Activity, CheckCircle2, Circle, Layers, Plus, Radio } from "lucide-react";
import type { CampaignRow, Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { ToolVisual } from "@/components/visuals";
import { ProductLinks } from "@/components/product-links";
import { Badge, Button, Empty, ErrorNote, Metric, PageHeader, SectionTitle, Skeleton, statusTone, tableClass } from "@/components/ui";
import { TOOLS, isTool } from "@/lib/tools";
import type { Tool } from "@convertflow/contracts";

interface Integration { configPublished: boolean; hasCatalog: boolean }

function ToolPage({ store, tool }: { store: Store; tool: Tool }) {
  const meta = TOOLS[tool];
  const camps = useApi<CampaignRow[]>(`/api/v1/stores/${store.id}/campaigns?tool=${tool}`);
  const integ = useApi<Integration>(`/api/v1/stores/${store.id}/integration`);
  const rows = camps.data ?? [];
  const live = rows.filter((c) => c.status === "active" || c.status === "scheduled").length;
  const newHref = `/app/campaigns/new?tool=${tool}`;

  return (
    <>
      <PageHeader eyebrow={meta.shipped ? "Tool" : "Coming soon"} title={meta.name} sub={meta.about}
        actions={meta.shipped
          ? <Link href={newHref}><Button variant="primary"><Plus className="size-4" />New campaign</Button></Link>
          : <Badge>Not available yet</Badge>} />
      <ErrorNote error={camps.error ?? integ.error} />

      {meta.shipped && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Metric icon={Radio} label="Live campaigns" value={camps.loading ? "–" : String(live)} />
          <Metric icon={Layers} label="Total campaigns" value={camps.loading ? "–" : String(rows.length)} />
          <Metric icon={Activity} label="Status" value={integ.data?.configPublished ? "Live" : "Not live yet"} note={integ.data?.configPublished ? "Live on your store" : "Publish a campaign and install the snippet"} />
        </div>
      )}

      {meta.shipped && (
        <section aria-labelledby="look-h" className="card mt-8 grid items-center gap-8 overflow-hidden p-6 md:grid-cols-[1fr_minmax(0,22rem)] md:p-8">
          <div>
            <SectionTitle id="look-h">How it looks to shoppers</SectionTitle>
            <p className="font-display text-lg font-bold uppercase leading-snug tracking-tight md:text-xl"><span className="text-grad">{meta.tagline}</span></p>
            <p className="mt-3 text-xs text-ink-3">A preview with sample copy and products. Your own campaigns replace it once you create them.</p>
          </div>
          <ToolVisual tool={tool} />
        </section>
      )}

      <section aria-labelledby="setup-h" className="card mt-8 p-6 md:p-7">
        <SectionTitle id="setup-h">Setup</SectionTitle>
        <ol className="grid gap-2">
          {meta.setup.map((s, i) => {
            const done = meta.shipped && i === 0 && (integ.data?.configPublished ?? false);
            const Icon = done ? CheckCircle2 : Circle;
            return (
              <li key={s} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-sm">
                <Icon className={done ? "size-5 shrink-0 text-ok" : "size-5 shrink-0 text-ink-3"} aria-hidden />
                <span className={done ? "text-ink-2" : "text-ink"}>{s}</span>
                {done && <Badge tone="ok">Done</Badge>}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="campaigns-h" className="mt-8">
        <SectionTitle id="campaigns-h">Campaigns</SectionTitle>
        {camps.loading && <Skeleton className="h-24" />}
        {!camps.loading && !meta.shipped && (
          <Empty title={`${meta.name} is not available yet`} body="It is built on the same targeting, scheduling, consent and analytics as the tools you can use today, and cannot be published until its whole path has been finished and tested." />
        )}
        {!camps.loading && meta.shipped && rows.length === 0 && (
          <Empty visual={<div className="mx-auto w-64 max-w-full"><ToolVisual tool={tool} /></div>} title={`No ${meta.name.toLowerCase()} campaigns yet`} body="Nothing is shown to shoppers until you create a campaign and approve it."
            action={<Link href={newHref}><Button variant="primary">Create your first campaign</Button></Link>} />
        )}
        {rows.length > 0 && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className={tableClass} aria-label="Campaigns">
                <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Name</th><th className="font-medium">Status</th><th className="font-medium">Updated</th></tr></thead>
                <tbody>{rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="font-medium hover:text-brand hover:underline underline-offset-4" href={`/app/campaigns/${c.id}`}>{c.name}</Link></td>
                    <td><Badge tone={statusTone(c.status)} dot>{c.status}</Badge></td>
                    <td className="num whitespace-nowrap text-ink-2">{new Date(c.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {tool === "upsell" && meta.shipped && <div className="mt-8"><ProductLinks store={store} /></div>}
    </>
  );
}

export default function Page({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = use(params);
  if (!isTool(tool)) notFound();
  return <NeedStore>{(s) => <ToolPage store={s} tool={tool} />}</NeedStore>;
}
