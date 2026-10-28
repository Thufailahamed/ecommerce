"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, ApiError, type CampaignRow, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { TOOLS } from "@/lib/tools";
import { Badge, Button, Empty, ErrorNote, Input, PageHeader, Select, Skeleton, statusTone } from "@/components/ui";

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
      <PageHeader title="Campaigns" sub="Create, schedule and manage on-site campaigns."
        actions={<><Link href="/app/studio"><Button>Generate with AI</Button></Link><Link href="/app/campaigns/new"><Button variant="primary"><Plus className="size-4" />New campaign</Button></Link></>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-ink-3" aria-hidden /><Input aria-label="Search campaigns" placeholder="Search" className="w-64 pl-8" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select aria-label="Filter by status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["all", "draft", "scheduled", "active", "paused", "archived"].map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
        </Select>
        <Select aria-label="Filter by tool" className="w-44" value={tool} onChange={(e) => setTool(e.target.value)}>
          <option value="all">All tools</option>
          {Object.values(TOOLS).filter((t) => t.shipped).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
        </Select>
      </div>
      <ErrorNote error={error ?? actionError} />
      {loading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
      {!loading && data && data.length === 0 && (
        <Empty title="No campaigns yet" body="Describe a goal and let AI draft a campaign, or build one yourself. Nothing goes live until you approve it."
          action={<div className="flex gap-2"><Link href="/app/studio"><Button variant="primary">Generate with AI</Button></Link><Link href="/app/campaigns/new"><Button>Build manually</Button></Link></div>} />
      )}
      {!loading && data && data.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-2 font-medium">Name</th><th className="font-medium">Tool</th><th className="font-medium">Status</th><th className="font-medium">Updated</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line">
                <td className="py-3"><Link className="font-medium hover:underline" href={`/app/campaigns/${c.id}`}>{c.name}</Link></td>
                <td className="text-ink-2">{TOOLS[c.tool]?.name ?? c.tool}</td>
                <td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                <td className="num text-ink-2">{new Date(c.updatedAt).toLocaleDateString()}</td>
                <td className="space-x-1 text-right">
                  {(c.status === "active" || c.status === "scheduled") && <Button variant="ghost" onClick={() => void act(c.id, "pause")}>Pause</Button>}
                  {c.status === "paused" && <Button variant="ghost" onClick={() => void act(c.id, "resume")}>Resume</Button>}
                  {c.status !== "archived" && <Button variant="ghost" onClick={() => void act(c.id, "duplicate")}>Duplicate</Button>}
                  {c.status !== "archived" && <Button variant="ghost" onClick={() => void act(c.id, "archive")}>Archive</Button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-ink-3">No campaigns match your filters.</td></tr>}
          </tbody>
        </table>
      )}
    </>
  );
}

export default function Page() { return <NeedStore>{(s) => <List store={s} />}</NeedStore>; }
