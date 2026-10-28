"use client";
import Link from "next/link";
import { use } from "react";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import type { CampaignRow, Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { ProductLinks } from "@/components/product-links";
import { Badge, Button, Empty, ErrorNote, Metric, PageHeader, Skeleton, statusTone } from "@/components/ui";
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
      <PageHeader title={meta.name} sub={meta.about}
        actions={meta.shipped
          ? <Link href={newHref}><Button variant="primary"><Plus className="size-4" />New campaign</Button></Link>
          : <Badge>Not available yet</Badge>} />
      <ErrorNote error={camps.error ?? integ.error} />

      {meta.shipped && (
        <div className="grid grid-cols-2 gap-6 border-b border-line pb-8 md:grid-cols-3">
          <Metric label="Live campaigns" value={camps.loading ? "–" : String(live)} />
          <Metric label="Total campaigns" value={camps.loading ? "–" : String(rows.length)} />
          <Metric label="Status" value={integ.data?.configPublished ? "Live on your store" : "Not live yet"} note={integ.data?.configPublished ? undefined : "Publish a campaign and install the snippet"} />
        </div>
      )}

      <h2 className="mb-1 mt-8 text-sm font-semibold">Setup</h2>
      <ul>
        {meta.setup.map((s, i) => {
          const done = meta.shipped && i === 0 && (integ.data?.configPublished ?? false);
          const Icon = done ? CheckCircle2 : Circle;
          return <li key={s} className="flex items-center gap-3 border-b border-line py-3 text-sm"><Icon className={done ? "size-5 text-ok" : "size-5 text-ink-3"} aria-hidden />{s}{done && <span className="sr-only"> (done)</span>}</li>;
        })}
      </ul>

      <h2 className="mb-3 mt-8 text-sm font-semibold">Campaigns</h2>
      {camps.loading && <Skeleton className="h-24" />}
      {!camps.loading && !meta.shipped && (
        <Empty title={`${meta.name} is not available yet`} body="It is built on the same targeting, scheduling, consent and analytics as the tools you can use today, and cannot be published until its whole path has been finished and tested." />
      )}
      {!camps.loading && meta.shipped && rows.length === 0 && (
        <Empty title={`No ${meta.name.toLowerCase()} campaigns yet`} body="Nothing is shown to shoppers until you create a campaign and approve it."
          action={<Link href={newHref}><Button variant="primary">Create your first campaign</Button></Link>} />
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm" aria-label="Campaigns">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-2 font-medium">Name</th><th className="font-medium">Status</th><th className="font-medium">Updated</th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id} className="border-b border-line">
              <td className="py-3"><Link className="font-medium hover:underline" href={`/app/campaigns/${c.id}`}>{c.name}</Link></td>
              <td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
              <td className="num text-ink-2">{new Date(c.updatedAt).toLocaleDateString()}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {tool === "upsell" && meta.shipped && <ProductLinks store={store} />}
    </>
  );
}

export default function Page({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = use(params);
  if (!isTool(tool)) notFound();
  return <NeedStore>{(s) => <ToolPage store={s} tool={tool} />}</NeedStore>;
}
