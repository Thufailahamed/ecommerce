"use client";
import Link from "next/link";
import { useState } from "react";
import { Megaphone, Plus, Search, Sparkles } from "lucide-react";
import { api, ApiError, type CampaignRow, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { TOOLS } from "@/lib/tools";
import { Badge, Button, Empty, ErrorNote, Input, PageHeader, Select, Skeleton, statusTone, tableClass } from "@/components/ui";
import { ToolGallery, ToolVisual } from "@/components/visuals";

function List({ store }: { store: Store }) {
  const base = `/api/v1/stores/${store.id}/campaigns`;
  const { data, error, loading, reload } = useApi<CampaignRow[]>(base);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [tool, setTool] = useState("all");
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (id: string, action: string) => {
    setActionError(null);
    try { await api(`${base}/${id}/${action}`, { method: "POST", body: {} }); await reload(); }
    catch (e) { setActionError(e instanceof ApiError ? e.message : "Action failed"); }
  };

  const rows = (data ?? []).filter((c) => (status === "all" || c.status === status) && (tool === "all" || c.tool === tool) && c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader eyebrow="Campaigns" title="Campaigns" sub="Create, schedule and manage on-site campaigns."
        actions={<><Link href="/app/studio"><Button><Sparkles className="size-4" />Generate with AI</Button></Link><Link href="/app/campaigns/new"><Button variant="primary"><Plus className="size-4" />New campaign</Button></Link></>} />

      <div className="card-flat mb-5 flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input aria-label="Search campaigns" placeholder="Search campaigns" className="w-full pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Filter by status" className="w-full sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["all", "draft", "scheduled", "active", "paused", "archived"].map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
        </Select>
        <Select aria-label="Filter by tool" className="w-full sm:w-44" value={tool} onChange={(e) => setTool(e.target.value)}>
          <option value="all">All tools</option>
          {Object.values(TOOLS).filter((t) => t.shipped).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
        </Select>
      </div>

      <ErrorNote error={error ?? actionError} />
      {loading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
      {!loading && data && data.length === 0 && (
        <Empty icon={Megaphone} visual={<ToolGallery tools={["toast", "feed", "email"]} />} title="No campaigns yet" body="Describe a goal and let AI draft a campaign, or build one yourself. Nothing goes live until you approve it."
          action={<div className="flex flex-wrap justify-center gap-2"><Link href="/app/studio"><Button variant="primary"><Sparkles className="size-4" />Generate with AI</Button></Link><Link href="/app/campaigns/new"><Button>Build manually</Button></Link></div>} />
      )}
      {!loading && data && data.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Name</th><th className="font-medium">Tool</th><th className="font-medium">Status</th><th className="font-medium">Updated</th><th className="w-px" /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="flex items-center gap-3.5">
                        <div className="w-16 shrink-0 sm:w-20"><ToolVisual tool={c.tool} /></div>
                        <Link className="font-medium transition-colors hover:text-brand hover:underline underline-offset-4" href={`/app/campaigns/${c.id}`}>{c.name}</Link>
                      </div>
                    </td>
                    <td className="text-ink-2">{TOOLS[c.tool]?.name ?? c.tool}</td>
                    <td><Badge tone={statusTone(c.status)} dot>{c.status}</Badge></td>
                    <td className="num whitespace-nowrap text-ink-2">{new Date(c.updatedAt).toLocaleDateString()}</td>
                    <td>
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        {(c.status === "active" || c.status === "scheduled") && <Button variant="ghost" onClick={() => void act(c.id, "pause")}>Pause</Button>}
                        {c.status === "paused" && <Button variant="ghost" onClick={() => void act(c.id, "resume")}>Resume</Button>}
                        {c.status !== "archived" && <Button variant="ghost" onClick={() => void act(c.id, "duplicate")}>Duplicate</Button>}
                        {c.status !== "archived" && <Button variant="ghost" onClick={() => void act(c.id, "archive")}>Archive</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-ink-3">No campaigns match your filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export default function Page() { return <NeedStore>{(s) => <List store={s} />}</NeedStore>; }
