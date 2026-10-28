"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BarChart3, Bell, LayoutDashboard, Mail, Megaphone, MessageSquare, Plus, Search, Settings, ShoppingBag, Smartphone, Sparkles, Users, type LucideIcon } from "lucide-react";
import { TOOLS, TOOL_ORDER } from "@/lib/tools";

interface Command { id: string; group: "Go to" | "Tools" | "Actions"; label: string; hint?: string; href: string; icon: LucideIcon }

const TOOL_ICON: Record<string, LucideIcon> = { toast: MessageSquare, feed: Bell, upsell: ShoppingBag, sms: Smartphone, email: Mail };

const COMMANDS: Command[] = [
  { id: "overview", group: "Go to", label: "Overview", href: "/app", icon: LayoutDashboard },
  { id: "campaigns", group: "Go to", label: "Campaigns", href: "/app/campaigns", icon: Megaphone },
  { id: "subscribers", group: "Go to", label: "Subscribers", href: "/app/subscribers", icon: Users },
  { id: "studio", group: "Go to", label: "AI studio", href: "/app/studio", icon: Sparkles },
  { id: "analytics", group: "Go to", label: "Analytics", href: "/app/analytics", icon: BarChart3 },
  { id: "settings", group: "Go to", label: "Settings", href: "/app/settings", icon: Settings },
  { id: "new-campaign", group: "Actions", label: "New campaign", hint: "Build by hand", href: "/app/campaigns/new", icon: Plus },
  { id: "generate", group: "Actions", label: "Generate with AI", hint: "Describe a goal", href: "/app/studio", icon: Sparkles },
  ...TOOL_ORDER.map((k): Command => ({ id: `tool-${k}`, group: "Tools", label: TOOLS[k].name, hint: TOOLS[k].shipped ? undefined : "Not available yet", href: `/app/tools/${k}`, icon: TOOL_ICON[k] ?? Megaphone })),
];

/**
 * ⌘K / Ctrl+K command palette. Opens from the keyboard, from "/" outside text fields, or from the sidebar button.
 * Arrow keys move through results, Enter opens, Escape closes. Focus returns to whatever opened it.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return COMMANDS.filter((c) => !needle || c.label.toLowerCase().includes(needle) || c.group.toLowerCase().includes(needle));
  }, [q]);

  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => {
    if (open) { setQ(""); setTimeout(() => input.current?.focus(), 0); }
  }, [open]);

  if (!open) return null;

  const go = (c: Command) => { onOpenChange(false); router.push(c.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (results.length ? (i + 1) % results.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (results.length ? (i + results.length - 1) % results.length : 0)); }
    else if (e.key === "Enter") { const c = results[active]; if (c) { e.preventDefault(); go(c); } }
    else if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
  };

  const groups = (["Go to", "Actions", "Tools"] as const).map((g) => ({ g, items: results.filter((c) => c.group === g) })).filter((x) => x.items.length);
  let index = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="presentation">
      <button aria-label="Close search" tabIndex={-1} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div role="dialog" aria-modal="true" aria-label="Search pages and actions" className="palette-in relative w-full max-w-xl overflow-hidden rounded-[1.5rem] border border-line-strong bg-surface shadow-[0_40px_120px_-30px_rgba(35,80,255,0.6)]">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="size-4 text-brand" aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
            aria-autocomplete="list"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search pages, tools and actions"
            className="h-14 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-3 focus-visible:outline-none"
          />
          <kbd className="rounded-md border border-line bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-ink-3">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2">
          {groups.map(({ g, items }) => (
            <li key={g} role="presentation" className="pb-1">
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{g}</div>
              <ul role="presentation" className="space-y-0.5">
                {items.map((c) => {
                  index += 1;
                  const i = index;
                  const on = i === active;
                  const Icon = c.icon;
                  return (
                    <li key={c.id} id={`${listId}-${c.id}`} role="option" aria-selected={on}
                      onMouseEnter={() => setActive(i)} onClick={() => go(c)}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${on ? "bg-brand-soft text-ink" : "text-ink-2"}`}>
                      <span className={`grid size-8 place-items-center rounded-lg transition-colors ${on ? "bg-brand-solid text-white" : "bg-white/[0.05] text-ink-3"}`}><Icon className="size-4" aria-hidden /></span>
                      <span className="flex-1 font-medium">{c.label}</span>
                      {c.hint && <span className="text-xs text-ink-3">{c.hint}</span>}
                      {on && <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-3">Enter</kbd>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-10 text-center text-sm text-ink-3">Nothing matches “{q}”.</li>}
        </ul>
        <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[11px] text-ink-3">
          <span>Navigate with ↑ ↓, open with Enter</span>
          <span className="hidden sm:inline">Toggle with Ctrl K or ⌘ K</span>
        </div>
      </div>
    </div>
  );
}

/** Keyboard shortcut wiring, kept separate so the palette itself stays a plain controlled component. */
export function useCommandShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onOpen(); }
      else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onOpen(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onOpen]);
}
