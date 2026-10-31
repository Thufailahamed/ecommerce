"use client";
import clsx from "clsx";
import { Bot, Flag, Pencil, RotateCcw, Rocket, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { builder, relativeTime, type VersionRow } from "@/lib/builder";
import { useBuilder } from "./state";
import { Btn, IconButton } from "./controls";

const KIND = {
  ai: { icon: Bot, label: "AI" }, manual: { icon: Pencil, label: "Edit" }, restore: { icon: RotateCcw, label: "Restore" },
  publish: { icon: Rocket, label: "Published" }, initial: { icon: Flag, label: "Created" },
} as const;

export function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { site, flush, replaceDoc, canEdit, toast, doc } = useBuilder();
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    // Saving first means the newest checkpoint is in the list.
    void flush().then(() => builder.versions(site.id)).then(setRows).catch(() => setRows([]));
  }, [open, site.id, flush, doc]);

  const restore = async (v: VersionRow) => {
    setBusy(v.id);
    try {
      if (!(await flush())) throw new Error("Save your changes first");
      const fresh = await builder.get(site.id);
      const r = await builder.restore(site.id, v.id, fresh.revision);
      replaceDoc(r.draft, r.revision);
      toast(`Restored version ${v.number}. Undo brings back what you had.`, "ok");
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not restore", "error");
    } finally { setBusy(null); }
  };

  if (!open) return null;
  return (
    <aside aria-label="Version history" className="slide-in-r absolute inset-y-0 right-0 z-30 flex w-[340px] flex-col border-l border-line bg-surface shadow-2xl">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Version history</h2>
          <p className="text-[11px] text-ink-3">Every AI change, edit session and publish.</p>
        </div>
        <IconButton icon={X} label="Close history" onClick={onClose} />
      </header>
      <ol className="sidebar-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {rows === null && Array.from({ length: 6 }, (_, i) => <li key={i} className="skeleton m-2 h-12 rounded-lg" />)}
        {rows?.map((v, i) => {
          const k = KIND[v.kind];
          const Icon = k.icon;
          return (
            <li key={v.id} className="group relative flex gap-3 rounded-lg p-2 hover:bg-ink/[0.04]">
              <span className={clsx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", v.kind === "publish" ? "bg-ok/15 text-ok" : v.kind === "ai" ? "bg-brand-soft text-brand" : "bg-ink/[0.06] text-ink-3")}><Icon className="size-3.5" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{v.label}</div>
                <div className="text-[11px] text-ink-3">#{v.number} · {k.label} · {relativeTime(v.createdAt)}{i === 0 ? " · current" : ""}</div>
              </div>
              {i > 0 && canEdit && <Btn size="sm" variant="ghost" busy={busy === v.id} onClick={() => void restore(v)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">Restore</Btn>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
