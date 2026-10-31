"use client";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List as ListIcon, Megaphone, Plus, Search, Sparkles } from "lucide-react";
import { api, ApiError, type CampaignGroup, type CampaignRow, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { TOOLS } from "@/lib/tools";
import { CAMPAIGN_TYPES, campaignsHref, isCampaignType, typeLabel, typeOf, type CampaignType } from "@/lib/campaign-types";
import { CampaignMenu } from "@/components/campaign-menu";
import { Badge, Button, Empty, ErrorNote, Input, Notice, PageHeader, Select, Skeleton, statusTone, tableClass } from "@/components/ui";
import { ToolGallery, ToolVisual } from "@/components/visuals";

/** Recent is everything not archived, newest first. Active is what is live or queued to go live. Archived is the rest. */
type View = "recent" | "active" | "archived";
const VIEWS: { key: View; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "active", label: "Active" },
  { key: "archived", label: "Archived" },
];

const inView = (c: CampaignRow, view: View) =>
  view === "recent" ? c.status !== "archived" : view === "active" ? c.status === "active" || c.status === "scheduled" : c.status === "archived";

function List({ store, initialType }: { store: Store; initialType: CampaignType | null }) {
  const base = `/api/v1/stores/${store.id}/campaigns`;
  const groupsBase = `/api/v1/stores/${store.id}/campaign-groups`;
  const router = useRouter();
  const { data, error, loading, reload } = useApi<CampaignRow[]>(base);
  const groupsApi = useApi<CampaignGroup[]>(groupsBase);
  const groups = groupsApi.data ?? [];
  // The URL is the source of truth for the folder, so sidebar links and the tabs agree even on client navigation.
  const folder = initialType ?? "all";
  const selectFolder = (key: "all" | CampaignType) => router.replace(campaignsHref(key), { scroll: false });
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("recent");
  const [group, setGroup] = useState<string>("all");
  const [newGroup, setNewGroup] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [status, setStatus] = useState("all");
  const [tool, setTool] = useState("all");
  const [layout, setLayout] = useState<"grid" | "list">("list");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = (e: unknown, fallback: string) => setActionError(e instanceof ApiError ? e.message : fallback);

  const act = async (id: string, action: string) => {
    setActionError(null);
    try { await api(`${base}/${id}/${action}`, { method: "POST", body: {} }); await reload(); }
    catch (e) { fail(e, "Action failed"); }
  };

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newGroup.trim();
    if (!name) return;
    setActionError(null);
    setNotice(null);
    try {
      const g = await api<CampaignGroup>(groupsBase, { method: "POST", body: { name } });
      setNewGroup("");
      // Stay on All: a new group is empty, so selecting it would hide the campaigns needed to fill it.
      setGroup("all");
      setNotice(`Group “${g.name}” created. Add campaigns from a campaign's ⋯ menu.`);
      await groupsApi.reload();
    } catch (err) { fail(err, "Could not create the group"); }
  };

  const deleteGroup = async () => {
    if (group === "all" || !window.confirm("Delete this group? Its campaigns are kept.")) return;
    setActionError(null);
    try { await api(`${groupsBase}/${group}`, { method: "DELETE" }); setGroup("all"); setRenaming(false); await groupsApi.reload(); }
    catch (err) { fail(err, "Could not delete the group"); }
  };

  const renameGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = renameValue.trim();
    if (group === "all" || !name) return;
    setActionError(null);
    try {
      await api(`${groupsBase}/${group}`, { method: "PATCH", body: { name } });
      setRenaming(false);
      await groupsApi.reload();
    } catch (err) { fail(err, "Could not rename the group"); }
  };

  const toggleMember = async (groupId: string, campaignId: string, member: boolean) => {
    setActionError(null);
    try {
      if (member) await api(`${groupsBase}/${groupId}/members/${campaignId}`, { method: "DELETE" });
      else await api(`${groupsBase}/${groupId}/members`, { method: "POST", body: { campaignIds: [campaignId] } });
      await groupsApi.reload();
    } catch (err) { fail(err, "Could not update the group"); }
  };

  const saveTemplate = async (c: CampaignRow) => {
    setActionError(null);
    setNotice(null);
    try {
      await api(`/api/v1/stores/${store.id}/campaign-templates`, { method: "POST", body: { name: c.name, campaignId: c.id } });
      setNotice(`Saved “${c.name}” as a template. Find it under Templates.`);
    } catch (err) { fail(err, "Could not save the template"); }
  };

  const counts = useMemo(() => {
    const all = data ?? [];
    return {
      folders: Object.fromEntries(CAMPAIGN_TYPES.map((t) => [t.key, all.filter((c) => typeOf(c) === t.key).length])) as Record<CampaignType, number>,
      views: Object.fromEntries(VIEWS.map((v) => [v.key, all.filter((c) => inView(c, v.key)).length])) as Record<View, number>,
    };
  }, [data]);

  const inGroup = (c: CampaignRow) => group === "all" || !!groups.find((g) => g.id === group)?.campaignIds.includes(c.id);
  const rows = (data ?? []).filter((c) =>
    inView(c, view) &&
    inGroup(c) &&
    (folder === "all" || typeOf(c) === folder) &&
    (status === "all" || c.status === status) &&
    (tool === "all" || c.tool === tool) &&
    c.name.toLowerCase().includes(q.toLowerCase()));

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [["name", "type", "tool", "status", "updated"].join(",")].concat(
      rows.map((c) => [esc(c.name), esc(typeLabel(typeOf(c))), esc(TOOLS[c.tool]?.name ?? c.tool), c.status, c.updatedAt].join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${store.name.replace(/\W+/g, "-").toLowerCase()}-campaigns.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  /** The ⋯ menu for one campaign. Both layouts use it, so the choices stay the same. */
  const menu = (c: CampaignRow) => (
    <CampaignMenu campaign={c} groups={groups}
      onAction={(action) => void act(c.id, action)}
      onToggleGroup={(groupId, member) => void toggleMember(groupId, c.id, member)}
      onSaveTemplate={() => void saveTemplate(c)} />
  );

  return (
    <>
      <PageHeader eyebrow="Campaigns" title="Campaigns" sub="Create, schedule and manage on-site campaigns."
        actions={<><Button onClick={exportCsv} disabled={rows.length === 0}>Export</Button><Link href="/app/studio"><Button><Sparkles className="size-4" />Generate with AI</Button></Link><Link href="/app/campaigns/new"><Button variant="primary"><Plus className="size-4" />New campaign</Button></Link></>} />

      {/* Folders, like the campaign types in the sidebar. Landing pages are listed so the structure is visible, but they are not built yet. */}
      <div role="tablist" aria-label="Campaign folders" className="mb-4 flex flex-wrap gap-2">
        {[{ key: "all" as const, label: "All", shipped: true }, ...CAMPAIGN_TYPES].map((t) => {
          const on = folder === t.key;
          const n = t.key === "all" ? (data?.length ?? 0) : counts.folders[t.key];
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} disabled={!t.shipped}
              onClick={() => selectFolder(t.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${on ? "bg-brand-solid text-white shadow-[0_8px_20px_-10px_rgba(35,80,255,1)] ring-brand-tint" : "bg-ink/[0.03] text-ink-2 ring-line hover:text-ink hover:ring-line-strong"}`}>
              {t.label}
              {t.shipped ? <span className={`num ml-1.5 ${on ? "opacity-80" : "text-ink-3"}`}>{n}</span> : <span className="ml-1.5 text-ink-3">Soon</span>}
            </button>
          );
        })}
      </div>

      {/* Groups: the merchant's own folders. Filter by one, then create, rename or delete. */}
      <div role="group" aria-label="Groups" className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-3">Groups</span>
        <button type="button" aria-pressed={group === "all"} onClick={() => { setGroup("all"); setRenaming(false); }}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${group === "all" ? "bg-ink/[0.08] text-ink ring-line-strong" : "text-ink-2 ring-line hover:text-ink"}`}>All</button>
        {groups.map((g) => (
          <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => { setGroup(g.id); setRenaming(false); }}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${group === g.id ? "bg-ink/[0.08] text-ink ring-line-strong" : "text-ink-2 ring-line hover:text-ink"}`}>
            {g.name}<span className="num ml-1.5 text-ink-3">{g.campaignIds.length}</span>
          </button>
        ))}
        <form onSubmit={createGroup} className="flex items-center gap-2">
          <Input aria-label="New group name" placeholder="New group" maxLength={60} className="w-40" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <Button type="submit" disabled={!newGroup.trim()}>Add group</Button>
        </form>
        {group !== "all" && !renaming && (
          <>
            <Button variant="ghost" onClick={() => { setRenameValue(groups.find((g) => g.id === group)?.name ?? ""); setRenaming(true); }}>Rename group</Button>
            <Button variant="ghost" onClick={() => void deleteGroup()}>Delete group</Button>
          </>
        )}
        {group !== "all" && renaming && (
          <form onSubmit={renameGroup} className="flex items-center gap-2">
            <Input aria-label="Group name" maxLength={60} className="w-40" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }} autoFocus />
            <Button type="submit" disabled={!renameValue.trim()}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
          </form>
        )}
      </div>

      {/* Recent / Active / Archived, then the layout toggle. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <div role="tablist" aria-label="Campaign views" className="flex gap-6">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
              className={`-mb-px border-b-2 pb-3 text-sm font-medium transition-colors ${view === v.key ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}>
              {v.label}<span className="num ml-1.5 text-ink-3">{counts.views[v.key]}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Layout" className="mb-2 flex gap-1">
          <button type="button" aria-pressed={layout === "grid"} aria-label="Grid view" onClick={() => setLayout("grid")} className={`grid size-8 place-items-center rounded-lg ${layout === "grid" ? "bg-ink/[0.08] text-ink" : "text-ink-3 hover:text-ink-2"}`}><LayoutGrid className="size-4" aria-hidden /></button>
          <button type="button" aria-pressed={layout === "list"} aria-label="List view" onClick={() => setLayout("list")} className={`grid size-8 place-items-center rounded-lg ${layout === "list" ? "bg-ink/[0.08] text-ink" : "text-ink-3 hover:text-ink-2"}`}><ListIcon className="size-4" aria-hidden /></button>
        </div>
      </div>

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

      <ErrorNote error={error ?? actionError ?? groupsApi.error} />
      {notice && <div className="mb-4"><Notice tone="ok" role="status">{notice}</Notice></div>}
      {loading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
      {!loading && data && data.length === 0 && (
        <Empty icon={Megaphone} visual={<ToolGallery tools={["toast", "feed", "email"]} />} title="No campaigns yet" body="Describe a goal and let AI draft a campaign, or build one yourself. Nothing goes live until you approve it."
          action={<div className="flex flex-wrap justify-center gap-2"><Link href="/app/studio"><Button variant="primary"><Sparkles className="size-4" />Generate with AI</Button></Link><Link href="/app/campaigns/new"><Button>Build manually</Button></Link></div>} />
      )}

      {!loading && data && data.length > 0 && layout === "grid" && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Campaigns">
          {rows.map((c) => {
            const live = c.status === "active" || c.status === "scheduled";
            return (
              <li key={c.id} className="card flex flex-col overflow-hidden">
                <div className="relative"><ToolVisual tool={c.tool} className="w-full" /></div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link className="font-medium transition-colors hover:text-brand hover:underline underline-offset-4" href={`/app/campaigns/${c.id}`}>{c.name}</Link>
                    {menu(c)}
                  </div>
                  <div className="text-xs text-ink-3">{typeLabel(typeOf(c))} · {TOOLS[c.tool]?.name ?? c.tool}</div>
                  <div className="mt-auto flex items-center justify-between gap-3">
                    <Badge tone={statusTone(c.status)} dot>{c.status}</Badge>
                    {c.status !== "archived" && c.status !== "draft" && (
                      <button type="button" role="switch" aria-checked={live} aria-label={`Active: ${c.name}`}
                        onClick={() => void act(c.id, live ? "pause" : "resume")}
                        className={`relative h-6 w-11 rounded-full transition-colors ${live ? "bg-brand-solid" : "bg-ink/[0.12]"}`}>
                        <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${live ? "left-[22px]" : "left-0.5"}`} aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {rows.length === 0 && <li className="col-span-full py-12 text-center text-ink-3">No campaigns match your filters.</li>}
        </ul>
      )}

      {!loading && data && data.length > 0 && layout === "list" && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Name</th><th className="font-medium">Type</th><th className="font-medium">Tool</th><th className="font-medium">Status</th><th className="font-medium">Updated</th><th className="w-px" /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="flex items-center gap-3.5">
                        <div className="w-16 shrink-0 sm:w-20"><ToolVisual tool={c.tool} /></div>
                        <Link className="font-medium transition-colors hover:text-brand hover:underline underline-offset-4" href={`/app/campaigns/${c.id}`}>{c.name}</Link>
                      </div>
                    </td>
                    <td className="text-ink-2">{typeLabel(typeOf(c))}</td>
                    <td className="text-ink-2">{TOOLS[c.tool]?.name ?? c.tool}</td>
                    <td><Badge tone={statusTone(c.status)} dot>{c.status}</Badge></td>
                    <td className="num whitespace-nowrap text-ink-2">{new Date(c.updatedAt).toLocaleDateString()}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {(c.status === "active" || c.status === "scheduled") && <Button variant="ghost" onClick={() => void act(c.id, "pause")}>Pause</Button>}
                        {c.status === "paused" && <Button variant="ghost" onClick={() => void act(c.id, "resume")}>Resume</Button>}
                        {c.status !== "archived" && <Button variant="ghost" onClick={() => void act(c.id, "duplicate")}>Duplicate</Button>}
                        {c.status !== "archived" && <Button variant="ghost" onClick={() => void act(c.id, "archive")}>Archive</Button>}
                        {menu(c)}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-ink-3">No campaigns match your filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Page() {
  const search = useSearchParams();
  const t = search.get("type");
  return <NeedStore>{(s) => <List store={s} initialType={isCampaignType(t) ? t : null} />}</NeedStore>;
}

export default function CampaignsPage() {
  // useSearchParams needs a Suspense boundary.
  return <Suspense fallback={<Skeleton className="h-96" />}><Page /></Suspense>;
}
