"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MoreHorizontal } from "lucide-react";
import type { CampaignGroup, CampaignRow } from "@/lib/api";

const item = "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-ink/[0.06] hover:text-ink";
const label = "px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3";
/** Layout effects only run in the browser; this keeps server rendering quiet without a second component. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface Props {
  campaign: Pick<CampaignRow, "id" | "name" | "status">;
  groups: CampaignGroup[];
  onAction: (action: "duplicate" | "archive") => void;
  onToggleGroup: (groupId: string, member: boolean) => void;
  onSaveTemplate: () => void;
}

/**
 * The ⋯ menu on each campaign: the steps, the group membership toggles, saving as a template, and the
 * duplicate and archive actions. The panel is portalled to the page body and positioned from its button, so the
 * table's horizontal scroll container cannot clip it. It closes on a choice, an outside click, Escape or scroll.
 */
export function CampaignMenu({ campaign, groups, onAction, onToggleGroup, onSaveTemplate }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const base = `/app/campaigns/${campaign.id}`;
  const archived = campaign.status === "archived";

  // The panel is portalled to the end of the body, so a keyboard user would otherwise tab past it. Focus its first
  // choice on open; Escape and outside clicks already return or move focus in the usual way.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("a, button") ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at < 0
      ? (e.key === "ArrowDown" ? 0 : items.length - 1)
      : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const toggle = () => {
    if (!open && button.current) {
      const r = button.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((o) => !o);
  };

  // The panel is portalled, so it can hang below the viewport when its row is near the bottom. Measure it after
  // the first render and flip it above the button (or clamp it) before the browser paints.
  useIsoLayoutEffect(() => {
    if (!open || !panel.current || !button.current) return;
    const p = panel.current.getBoundingClientRect();
    const b = button.current.getBoundingClientRect();
    const margin = 8, gap = 6;
    let top = b.bottom + gap;
    if (top + p.height > window.innerHeight - margin) top = b.top - gap - p.height;
    top = Math.max(margin, Math.min(top, window.innerHeight - p.height - margin));
    const right = Math.max(margin, window.innerWidth - b.right);
    setPos((old) => old && Math.abs(old.top - top) < 1 && old.right === right ? old : { top, right });
  }, [open]);

  /** Runs a choice and closes the menu. */
  const choose = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <>
      <button ref={button} type="button" aria-label={`More actions for ${campaign.name}`} aria-expanded={open} aria-haspopup="true" onClick={toggle}
        className="grid size-8 cursor-pointer place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ink/[0.06] hover:text-ink">
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={panel} style={{ position: "fixed", top: pos.top, right: pos.right }} onKeyDown={onPanelKey}
          className="z-50 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
          <Link href={`${base}/performance`} className={item} onClick={choose(() => {})}>Campaign</Link>
          <Link href={base} className={item} onClick={choose(() => {})}>Builder</Link>
          <Link href={`${base}/preview`} className={item} onClick={choose(() => {})}>Preview</Link>
          <Link href={`${base}/launch`} className={item} onClick={choose(() => {})}>Launch</Link>
          <Link href={`${base}/submissions`} className={item} onClick={choose(() => {})}>Submissions</Link>
          {!archived && <button type="button" className={item} onClick={choose(() => onAction("duplicate"))}>Duplicate</button>}
          <button type="button" className={item} onClick={choose(onSaveTemplate)}>Save as template</button>
          {!archived && <button type="button" className={item} onClick={choose(() => onAction("archive"))}>Archive</button>}

          <div className={label} id={`groups-${campaign.id}`}>Groups</div>
          {groups.length === 0 && <p className="px-3 pb-2 text-xs text-ink-3">No groups yet. Create one above the list.</p>}
          <div role="group" aria-labelledby={`groups-${campaign.id}`}>
            {groups.map((g) => {
              const member = g.campaignIds.includes(campaign.id);
              return (
                <button key={g.id} type="button" aria-pressed={member} className={item} onClick={() => onToggleGroup(g.id, member)}>
                  <span>{g.name}</span>{member && <Check className="size-4 text-brand" aria-label="In this group" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
