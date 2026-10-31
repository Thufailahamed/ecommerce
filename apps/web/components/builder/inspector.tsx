"use client";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, MessageSquareText, Trash2, X } from "lucide-react";
import { findSectionById, SECTION_DEFS, type FieldDef } from "@convertflow/store-builder";
import { useBuilder } from "./state";
import { FieldList } from "./fields";
import { IconButton } from "./controls";

const STYLE_FIELDS: FieldDef[] = [
  { key: "background", label: "Background", kind: "select", options: [
    { value: "default", label: "Page" }, { value: "surface", label: "Surface" }, { value: "primary", label: "Primary" }, { value: "accent", label: "Accent" }, { value: "inverse", label: "Inverse" },
  ] },
  { key: "spacing", label: "Spacing", kind: "select", options: [{ value: "sm", label: "Tight" }, { value: "md", label: "Normal" }, { value: "lg", label: "Roomy" }] },
];

/** Edits the selected section. Every change is an update_section operation, so the same validation as the AI applies. */
export function Inspector() {
  const { doc, selectedId, select, apply, canEdit, setTab, composerRef } = useBuilder();
  const found = selectedId ? findSectionById(doc, selectedId) : null;
  if (!found) return null;
  const { section, pageId } = found;
  const page = doc.pages.find((p) => p.id === pageId)!;
  const index = page.sections.findIndex((s) => s.id === section.id);
  const def = SECTION_DEFS[section.type];
  const patch = (props: Record<string, unknown>, key: string) => apply([{ op: "update_section", section: section.id, props }], `${section.id}:${key}`);
  const duplicate = () => {
    const { id: _id, ...rest } = section;
    const r = apply([{ op: "add_section", page: page.id, after: section.id, section: rest }]);
    const added = r.applied[0]?.target;
    if (added) select(added);
  };

  return (
    <aside aria-label="Section settings" className="slide-in-r flex w-[340px] shrink-0 flex-col border-l border-line bg-surface">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{page.title} · section {index + 1}</div>
          <h2 className="mt-0.5 truncate text-[15px] font-semibold text-ink">{def.label}</h2>
        </div>
        <IconButton icon={X} label="Close section settings" onClick={() => select(null)} />
      </header>
      <div className="flex items-center gap-0.5 border-b border-line px-3 py-1.5">
        <IconButton icon={ArrowUp} label="Move up" disabled={!canEdit || index === 0} onClick={() => apply([{ op: "move_section", section: section.id, to: index - 1 }])} />
        <IconButton icon={ArrowDown} label="Move down" disabled={!canEdit || index === page.sections.length - 1} onClick={() => apply([{ op: "move_section", section: section.id, to: index + 1 }])} />
        <IconButton icon={section.hidden ? Eye : EyeOff} label={section.hidden ? "Show section" : "Hide section"} disabled={!canEdit} onClick={() => apply([{ op: "update_section", section: section.id, props: { hidden: !section.hidden } }])} />
        <IconButton icon={Copy} label="Duplicate" disabled={!canEdit} onClick={duplicate} />
        <IconButton icon={Trash2} label="Delete section" tone="danger" disabled={!canEdit} onClick={() => { apply([{ op: "remove_section", section: section.id }]); select(null); }} />
        <button type="button" onClick={() => { setTab("chat"); setTimeout(() => composerRef.current?.focus(), 50); }}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand-soft px-2.5 text-[12px] font-medium text-brand transition-colors hover:bg-brand-solid hover:text-white">
          <MessageSquareText className="size-3.5" aria-hidden />Ask AI
        </button>
      </div>
      <fieldset disabled={!canEdit} className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
        {section.hidden && <p className="mx-4 mt-4 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-ink">Hidden: shoppers don&apos;t see this section.</p>}
        <div className="p-4"><FieldList fields={def.fields} value={section as unknown as Record<string, unknown>} onPatch={patch} /></div>
        <div className="border-t border-line p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Style</div>
          <FieldList fields={STYLE_FIELDS} value={section as unknown as Record<string, unknown>} onPatch={patch} />
        </div>
      </fieldset>
    </aside>
  );
}
