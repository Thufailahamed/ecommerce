"use client";
import clsx from "clsx";
import Link from "next/link";
import {
  AlertCircle, ArrowLeft, Check, CloudUpload, ExternalLink, Eye, History, Laptop, Loader2, MessageSquare, MousePointerClick, Package,
  PanelsTopLeft, Palette, Redo2, Rocket, Settings, Smartphone, Tablet, Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { pagePath, resolveRoute } from "@convertflow/store-builder";
import { builder, storeUrl } from "@/lib/builder";
import { useBuilder, type Tab } from "./state";
import { PreviewFrame } from "./preview-frame";
import { ChatPanel } from "./chat-panel";
import { DesignPanel } from "./design-panel";
import { PagesPanel } from "./pages-panel";
import { ProductsPanel } from "./products-panel";
import { SettingsPanel } from "./settings-panel";
import { Inspector } from "./inspector";
import { PublishDialog } from "./publish-dialog";
import { HistoryDrawer } from "./history-drawer";
import { Btn, IconButton, Segmented } from "./controls";

const TABS: { key: Tab; label: string; icon: typeof MessageSquare }[] = [
  { key: "chat", label: "AI chat", icon: MessageSquare },
  { key: "design", label: "Design", icon: Palette },
  { key: "pages", label: "Pages", icon: PanelsTopLeft },
  { key: "products", label: "Products", icon: Package },
  { key: "settings", label: "Settings", icon: Settings },
];

function SaveStatus() {
  const { saveState, saveError, flush, reload } = useBuilder();
  if (saveState === "conflict") {
    return (
      <span className="flex items-center gap-2 text-[12px] text-warn" role="alert">
        <AlertCircle className="size-3.5" aria-hidden />{saveError}
        <button type="button" onClick={() => void reload()} className="font-semibold underline underline-offset-2">Reload</button>
      </span>
    );
  }
  if (saveState === "error") {
    return (
      <span className="flex items-center gap-2 text-[12px] text-danger" role="alert" title={saveError ?? ""}>
        <AlertCircle className="size-3.5" aria-hidden />Not saved
        <button type="button" onClick={() => void flush()} className="font-semibold underline underline-offset-2">Retry</button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-ink-3" aria-live="polite">
      {saveState === "saving" ? <><Loader2 className="size-3 animate-spin" aria-hidden />Saving…</>
        : saveState === "dirty" ? <><CloudUpload className="size-3" aria-hidden />Unsaved</>
        : <><Check className="size-3" aria-hidden />Saved</>}
    </span>
  );
}

function SiteName() {
  const { site, updateSite, canEdit, toast } = useBuilder();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  useEffect(() => setName(site.name), [site.name]);
  const commit = async () => {
    setEditing(false);
    const v = name.trim();
    if (!v || v === site.name) { setName(site.name); return; }
    try { const r = await builder.update(site.id, { name: v }); updateSite({ name: r.name }); }
    catch { setName(site.name); toast("Could not rename the store", "error"); }
  };
  return editing ? (
    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void commit()} maxLength={80} aria-label="Store name"
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(site.name); setEditing(false); } }}
      className="h-7 w-48 rounded-md border border-brand bg-ink/[0.04] px-2 text-[14px] font-semibold text-ink focus:outline-none" />
  ) : (
    <button type="button" disabled={!canEdit} onClick={() => setEditing(true)} title="Rename" className="max-w-[220px] truncate rounded-md px-1.5 py-0.5 text-[14px] font-semibold text-ink transition-colors hover:bg-ink/[0.06] disabled:hover:bg-transparent">{site.name}</button>
  );
}

function RouteSwitcher() {
  const { doc, path, setPath } = useBuilder();
  const route = resolveRoute(doc, path);
  const current = route.kind === "page" ? pagePath(route.page) : path;
  const options = [
    ...doc.pages.map((p) => ({ value: pagePath(p), label: p.title })),
    { value: "/collections/all", label: "All products" },
    ...doc.collections.map((c) => ({ value: `/collections/${c.slug}`, label: `Collection: ${c.title}` })),
    ...(doc.products[0] ? [{ value: `/products/${doc.products[0].slug}`, label: "Product page" }] : []),
    { value: "/cart", label: "Cart" },
    { value: "/checkout", label: "Checkout" },
  ];
  const known = options.some((o) => o.value === current);
  return (
    <select aria-label="Page shown in preview" value={known ? current : "__other"} onChange={(e) => setPath(e.target.value)}
      className="h-8 max-w-[200px] truncate rounded-lg border border-line bg-ink/[0.03] px-2.5 text-[12px] font-medium text-ink hover:border-line-strong focus:border-brand focus:outline-none">
      {!known && <option value="__other" className="bg-surface">{path}</option>}
      {options.map((o) => <option key={o.value} value={o.value} className="bg-surface">{o.label}</option>)}
    </select>
  );
}

export function Editor() {
  const b = useBuilder();
  const { site, tab, setTab, device, setDevice, previewMode, setPreviewMode, undo, redo, canUndo, canRedo, canEdit, selectedId, toasts, streaming } = b;
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const live = site.status === "published";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      {/* ---------- top bar ---------- */}
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Link href="/app/sites" aria-label="Back to stores" className="grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ink/[0.07] hover:text-ink"><ArrowLeft className="size-4" /></Link>
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        <SiteName />
        <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", live ? "bg-ok/10 text-ok ring-ok/25" : "bg-ink/[0.05] text-ink-3 ring-line")}>
          <span aria-hidden className={clsx("size-1.5 rounded-full", live ? "bg-ok" : "bg-ink-3")} />{live ? "Live" : "Draft"}
        </span>
        <span className="ml-2 hidden lg:block"><SaveStatus /></span>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 md:flex">
          <RouteSwitcher />
          <div className="w-[120px]"><Segmented iconOnly value={device} onChange={setDevice} options={[{ value: "desktop", label: "Desktop", icon: Laptop }, { value: "tablet", label: "Tablet", icon: Tablet }, { value: "mobile", label: "Mobile", icon: Smartphone }]} /></div>
          <div className="w-[84px]"><Segmented iconOnly value={previewMode} onChange={setPreviewMode} options={[{ value: "edit", label: "Select sections", icon: MousePointerClick }, { value: "preview", label: "Preview", icon: Eye }]} /></div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!canEdit || !canUndo} onClick={undo} />
          <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!canEdit || !canRedo} onClick={redo} />
          <IconButton icon={History} label="Version history" active={historyOpen} onClick={() => setHistoryOpen((v) => !v)} />
          <a href={live ? storeUrl(site.slug) : `/preview/${site.id}`} target="_blank" rel="noreferrer" aria-label={live ? "Open live store" : "Open draft preview in a new tab"} title={live ? "Open live store" : "Open draft preview"}
            className="grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ink/[0.07] hover:text-ink"><ExternalLink className="size-4" /></a>
          <Btn variant="primary" className="ml-1" onClick={() => setPublishOpen(true)} disabled={Boolean(streaming)}><Rocket className="size-3.5" aria-hidden />{live ? "Publish changes" : "Publish"}</Btn>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ---------- left: tabs + panel ---------- */}
        <nav aria-label="Editor panels" className="flex w-14 shrink-0 flex-col items-center gap-1 on-deep border-r border-line bg-deep py-3">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.key;
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-label={t.label} aria-current={on ? "page" : undefined} title={t.label}
                className={clsx("relative grid size-10 place-items-center rounded-xl transition-colors", on ? "bg-brand-solid text-white shadow-[0_8px_20px_-8px_rgba(35,80,255,1)]" : "text-ink-3 hover:bg-ink/[0.06] hover:text-ink")}>
                <Icon className="size-[18px]" />
                {t.key === "chat" && streaming && !on && <span className="absolute right-1.5 top-1.5 size-2 animate-pulse rounded-full bg-brand" />}
              </button>
            );
          })}
        </nav>
        <section aria-label={TABS.find((t) => t.key === tab)?.label} className="flex w-[380px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
            <h2 className="text-[13px] font-semibold text-ink">{TABS.find((t) => t.key === tab)?.label}</h2>
            {tab === "chat" && site.ai.model && <span className="truncate pl-3 font-mono text-[10px] text-ink-3" title="Model, via Cloudflare AI Gateway">{site.ai.model.split("/").at(-1)}</span>}
            {!canEdit && !streaming && <span className="text-[11px] text-ink-3">View only</span>}
          </div>
          {tab === "chat" && <ChatPanel />}
          {tab === "design" && <DesignPanel />}
          {tab === "pages" && <PagesPanel />}
          {tab === "products" && <ProductsPanel />}
          {tab === "settings" && <SettingsPanel />}
        </section>

        {/* ---------- canvas ---------- */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <PreviewFrame />
          {streaming && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden"><div className="h-full w-full animate-pulse bg-gradient-to-r from-brand-solid via-brand-glow to-brand-solid" /></div>}
        </main>

        {selectedId && <Inspector />}
        <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
      </div>

      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} />

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[90] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={clsx("pop-in pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-[13px] shadow-2xl backdrop-blur",
            t.tone === "error" ? "border-danger/40 bg-[#fff1f0] text-danger shadow-lg" : t.tone === "ok" ? "border-ok/30 bg-[#ecfdf3] text-ok shadow-lg" : "border-line-strong bg-surface text-ink shadow-lg")}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
