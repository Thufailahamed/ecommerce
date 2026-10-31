"use client";
import clsx from "clsx";
import { ChevronRight, Eye, EyeOff, FileText, GripVertical, Home, Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { pagePath, resolveRoute, SECTION_CATEGORIES, SECTION_DEFS, sectionLabel, type Page, type SectionType } from "@convertflow/store-builder";
import { useBuilder } from "./state";
import { Btn, IconButton, Modal, PanelSection, TextField } from "./controls";

function AddSectionDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (t: SectionType) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a section" wide>
      <div className="space-y-5 p-5">
        {SECTION_CATEGORIES.map((cat) => {
          const defs = Object.values(SECTION_DEFS).filter((d) => d.category === cat.key);
          return (
            <div key={cat.key}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{cat.label}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {defs.map((d) => (
                  <button key={d.type} type="button" onClick={() => { onAdd(d.type); onClose(); }}
                    className="rounded-xl border border-line bg-ink/[0.02] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand-tint hover:bg-brand-soft">
                    <div className="text-[13px] font-semibold text-ink">{d.label}</div>
                    <div className="mt-0.5 text-[12px] leading-snug text-ink-3">{d.description}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function PageSettings({ page, onClose }: { page: Page; onClose: () => void }) {
  const { apply, setPath, canEdit } = useBuilder();
  const set = (props: Record<string, unknown>, key: string) => apply([{ op: "update_page", page: page.id, props }], `page:${page.id}:${key}`);
  return (
    <Modal open onClose={onClose} title={`${page.title} settings`}
      footer={page.slug !== "" && canEdit ? <Btn variant="danger" onClick={() => { apply([{ op: "remove_page", page: page.id }]); setPath("/"); onClose(); }}><Trash2 className="size-3.5" aria-hidden />Delete page</Btn> : undefined}>
      <fieldset disabled={!canEdit} className="space-y-4 p-5">
        <TextField label="Title" value={page.title} max={80} onChange={(v) => set({ title: v }, "title")} />
        {page.slug !== "" && <TextField label="Address" value={page.slug} max={60} hint="Lowercase words joined by dashes" onChange={(v) => set({ slug: v }, "slug")} />}
        <TextField label="Search title" value={page.seo.title ?? ""} max={70} placeholder={page.title} onChange={(v) => set({ seo: { ...page.seo, title: v || undefined } }, "seot")} />
        <TextField label="Search description" value={page.seo.description ?? ""} max={170} onChange={(v) => set({ seo: { ...page.seo, description: v || undefined } }, "seod")} />
      </fieldset>
    </Modal>
  );
}

export function PagesPanel() {
  const { doc, path, setPath, apply, select, selectedId, canEdit } = useBuilder();
  const [adding, setAdding] = useState(false);
  const [newPage, setNewPage] = useState<string | null>(null);
  const [settings, setSettings] = useState<Page | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const route = resolveRoute(doc, path);
  const current = route.kind === "page" ? route.page : doc.pages.find((p) => p.slug === "")!;

  const addSection = (type: SectionType) => {
    const after = selectedId && current.sections.some((s) => s.id === selectedId) ? selectedId : undefined;
    const r = apply([{ op: "add_section", page: current.id, ...(after ? { after } : {}), section: { type } }]);
    if (r.applied[0]) select(r.applied[0].target);
  };
  const createPage = () => {
    const title = (newPage ?? "").trim();
    if (!title) return;
    const r = apply([{ op: "add_page", page: { title, sections: [{ type: "rich_text", heading: title, body: "Write something here." }] } }]);
    const added = r.doc.pages.find((p) => p.id === r.applied[0]?.target);
    if (added) {
      setPath(pagePath(added));
      // New pages go in the header menu, where shoppers can find them.
      if (r.doc.navigation.header.length < 8) apply([{ op: "set_navigation", navigation: { header: [...r.doc.navigation.header, { label: added.title.slice(0, 40), href: pagePath(added) }] } }]);
    }
    setNewPage(null);
  };

  return (
    <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
      <PanelSection title="Pages" action={canEdit ? <Btn size="sm" variant="ghost" onClick={() => setNewPage("")}><Plus className="size-3.5" aria-hidden />Page</Btn> : undefined}>
        <ul className="-mx-1 space-y-0.5">
          {doc.pages.map((p) => {
            const on = p.id === current.id && route.kind === "page";
            return (
              <li key={p.id} className={clsx("group flex items-center rounded-lg pr-1 transition-colors", on ? "bg-ink/[0.08]" : "hover:bg-ink/[0.04]")}>
                <button type="button" onClick={() => setPath(pagePath(p))} className="flex h-9 min-w-0 flex-1 items-center gap-2.5 px-2 text-left text-[13px]">
                  {p.slug === "" ? <Home className="size-3.5 shrink-0 text-ink-3" aria-hidden /> : <FileText className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
                  <span className={clsx("truncate", on ? "font-medium text-ink" : "text-ink-2")}>{p.title}</span>
                  <span className="ml-auto truncate font-mono text-[11px] text-ink-3">{pagePath(p)}</span>
                </button>
                <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><IconButton size="sm" icon={Settings2} label={`${p.title} settings`} onClick={() => setSettings(p)} /></span>
              </li>
            );
          })}
        </ul>
        {newPage !== null && (
          <form onSubmit={(e) => { e.preventDefault(); createPage(); }} className="flex gap-2">
            <div className="flex-1"><TextField value={newPage} onChange={setNewPage} placeholder="Page title, e.g. Our process" max={80} autoFocus /></div>
            <Btn type="submit" size="sm" variant="primary" disabled={!newPage.trim()}>Add</Btn>
          </form>
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {[{ label: "All products", p: "/collections/all" }, { label: "Cart", p: "/cart" }, ...(doc.products[0] ? [{ label: "Product page", p: `/products/${doc.products[0].slug}` }] : [])].map((x) => (
            <button key={x.p} type="button" onClick={() => setPath(x.p)} className={clsx("rounded-full border px-2.5 py-1 text-[11px] transition-colors", path === x.p ? "border-brand bg-brand-soft text-ink" : "border-line text-ink-3 hover:text-ink")}>{x.label}</button>
          ))}
        </div>
      </PanelSection>

      {route.kind === "page" ? (
        <PanelSection title={`Sections · ${current.title}`} action={canEdit ? <Btn size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus className="size-3.5" aria-hidden />Section</Btn> : undefined}>
          {current.sections.length === 0 && <p className="text-[12px] text-ink-3">This page is empty. Add a section, or ask the AI to design it.</p>}
          <ol className="-mx-1 space-y-1">
            {current.sections.map((s, i) => (
              <li key={s.id} draggable={canEdit}
                onDragStart={(e) => { setDragId(s.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (dragId) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== s.id) apply([{ op: "move_section", section: dragId, to: i }]); setDragId(null); }}
                onDragEnd={() => setDragId(null)}
                className={clsx("group flex items-center gap-1 rounded-lg border transition-colors", selectedId === s.id ? "border-brand bg-brand-soft" : "border-transparent hover:bg-ink/[0.04]", dragId === s.id && "opacity-40")}>
                <GripVertical className={clsx("ml-1 size-3.5 shrink-0 text-ink-3", canEdit && "cursor-grab")} aria-hidden />
                <button type="button" onClick={() => select(s.id)} className={clsx("flex h-9 min-w-0 flex-1 items-center gap-2 text-left text-[13px]", s.hidden && "opacity-50")}>
                  <span className="truncate text-ink-2">{sectionLabel(s)}</span>
                </button>
                <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton size="sm" icon={s.hidden ? EyeOff : Eye} label={s.hidden ? "Show" : "Hide"} disabled={!canEdit} onClick={() => apply([{ op: "update_section", section: s.id, props: { hidden: !s.hidden } }])} />
                  <IconButton size="sm" icon={ChevronRight} label="Edit" onClick={() => select(s.id)} />
                </span>
              </li>
            ))}
          </ol>
        </PanelSection>
      ) : (
        <PanelSection title="Built-in page">
          <p className="text-[12px] leading-relaxed text-ink-3">Product, collection, cart and checkout pages are laid out for you and use your theme. Edit products in the Products tab.</p>
        </PanelSection>
      )}

      <AddSectionDialog open={adding} onClose={() => setAdding(false)} onAdd={addSection} />
      {settings && <PageSettings page={doc.pages.find((p) => p.id === settings.id) ?? settings} onClose={() => setSettings(null)} />}
    </div>
  );
}
