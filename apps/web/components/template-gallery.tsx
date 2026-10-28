"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Bell, LayoutTemplate, MessageSquare, PanelBottom, PanelRight, Plus, Search, ShoppingBag, SlidersHorizontal, Sparkles, Square } from "lucide-react";
import type { CampaignRow, Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { TOOLS } from "@/lib/tools";
import { FORMAT_LABEL, GOAL_LABEL, TEMPLATES, type Template, type TemplateFormat, type TemplateGoal } from "@/lib/templates";
import { Badge, Input } from "./ui";
import { ToolVisual } from "./visuals";
import { TemplateThumb } from "./template-thumb";

type Kind = "any" | "starter" | "mine";

const FORMATS = Object.keys(FORMAT_LABEL) as TemplateFormat[];
const GOALS = Object.keys(GOAL_LABEL) as TemplateGoal[];

/** Sections shown when nothing is filtered, in the order a merchant is most likely to want them. */
const SECTIONS: { id: string; title: string; sub: string; match: (t: Template) => boolean }[] = [
  { id: "signups", title: "Email signup templates", sub: "Collect consented subscribers with double opt-in", match: (t) => t.goal === "signups" },
  { id: "toast", title: "Toast templates", sub: "Small, non-blocking messages in a corner", match: (t) => t.format === "toast" },
  { id: "upsell", title: "Upsell templates", sub: "Recommend in-stock products that shoppers can add in place", match: (t) => t.format === "recommendation" },
  { id: "feed", title: "Notification feed templates", sub: "Cards in a bell shoppers can reopen", match: (t) => t.format === "feed" },
  { id: "announce", title: "Announcement templates", sub: "Popups, bars and slide-ins for news and offers", match: (t) => t.goal === "announce" && ["popup", "bar", "slide_in"].includes(t.format) },
  { id: "restock", title: "Back-in-stock", sub: "Alert shoppers when a sold-out product returns", match: (t) => t.goal === "restock" },
];

function Radio({ name, value, checked, label, count, onChange }: { name: string; value: string; checked: boolean; label: string; count?: number; onChange(): void }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-white/[0.04] ${checked ? "text-ink" : "text-ink-2"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="size-4 accent-[#2350ff]" />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="num text-xs text-ink-3">{count}</span>}
    </label>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="mb-6"><legend className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{title}</legend><div className="flex flex-col">{children}</div></fieldset>;
}

function TemplateCard({ t, currency }: { t: Template; currency: string }) {
  return (
    <Link href={`/app/campaigns/new?template=${t.id}`} className="group card-hover flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-brand-tint focus-visible:border-brand">
      <div className="p-2 pb-0"><TemplateThumb config={t.config()} currency={currency} /></div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug">{t.name}</h3>
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
        </div>
        <p className="text-xs leading-relaxed text-ink-2">{t.blurb}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          <Badge>{FORMAT_LABEL[t.format]}</Badge>
          {t.growth && <Badge tone="warn">Growth</Badge>}
        </div>
        {t.needs && <p className="pt-1 text-[11px] leading-relaxed text-ink-3">Needs: {t.needs}</p>}
      </div>
    </Link>
  );
}

function MineCard({ c }: { c: CampaignRow }) {
  return (
    <Link href={`/app/campaigns/new?from=${c.id}`} className="group card-hover flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-brand-tint focus-visible:border-brand">
      <div className="p-2 pb-0"><ToolVisual tool={c.tool} /></div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="text-sm font-semibold leading-snug">{c.name}</h3>
        <p className="text-xs text-ink-2">Start a new draft from this campaign&apos;s current settings.</p>
        <div className="mt-auto flex items-center gap-1.5 pt-2"><Badge>{TOOLS[c.tool]?.name ?? c.tool}</Badge><Badge dot>{c.status}</Badge></div>
      </div>
    </Link>
  );
}

const grid = "grid gap-5 sm:grid-cols-2 xl:grid-cols-3";

export function TemplateGallery({ store }: { store: Store }) {
  const mine = useApi<CampaignRow[]>(`/api/v1/stores/${store.id}/campaigns`);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("any");
  const [format, setFormat] = useState<TemplateFormat | "all">("all");
  const [goal, setGoal] = useState<TemplateGoal | "all">("all");
  const [showFilters, setShowFilters] = useState(false);

  const filtered = format !== "all" || goal !== "all" || q.trim() !== "" || kind !== "any";
  const query = q.trim().toLowerCase();
  const templates = useMemo(() => TEMPLATES.filter((t) =>
    (format === "all" || t.format === format) && (goal === "all" || t.goal === goal) &&
    (!query || `${t.name} ${t.blurb} ${FORMAT_LABEL[t.format]} ${GOAL_LABEL[t.goal]}`.toLowerCase().includes(query))), [format, goal, query]);
  const myCampaigns = useMemo(() => (mine.data ?? []).filter((c) => c.status !== "archived" && (!query || c.name.toLowerCase().includes(query))), [mine.data, query]);
  const showStarters = kind !== "mine";
  const showMine = kind === "mine";
  const reset = () => { setQ(""); setKind("any"); setFormat("all"); setGoal("all"); };

  const tiles: { label: string; icon: typeof Square; format: TemplateFormat }[] = [
    { label: "Popups", icon: Square, format: "popup" },
    { label: "Slide-ins", icon: PanelRight, format: "slide_in" },
    { label: "Bars", icon: PanelBottom, format: "bar" },
    { label: "Toasts", icon: MessageSquare, format: "toast" },
    { label: "Feed", icon: Bell, format: "feed" },
    { label: "Upsells", icon: ShoppingBag, format: "recommendation" },
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
      <aside aria-label="Template filters" className="lg:sticky lg:top-6 lg:self-start">
        <div className="relative mb-3 lg:mb-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input aria-label="Search templates" placeholder="Search templates" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" aria-expanded={showFilters} aria-controls="template-filters" onClick={() => setShowFilters((v) => !v)}
          className="mb-4 inline-flex h-9 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink-2 hover:text-ink lg:hidden">
          <SlidersHorizontal className="size-4" aria-hidden />Filters{filtered && <span aria-hidden className="size-1.5 rounded-full bg-brand" />}
        </button>
        <div id="template-filters" className={`${showFilters ? "block" : "hidden"} lg:block`}>
          <FilterGroup title="Template type">
            <Radio name="kind" value="any" checked={kind === "any"} label="Any" onChange={() => setKind("any")} />
            <Radio name="kind" value="starter" checked={kind === "starter"} label="Ready-made" count={TEMPLATES.length} onChange={() => setKind("starter")} />
            <Radio name="kind" value="mine" checked={kind === "mine"} label="My campaigns" {...(mine.data ? { count: mine.data.filter((c) => c.status !== "archived").length } : {})} onChange={() => setKind("mine")} />
          </FilterGroup>
          <FilterGroup title="Campaign format">
            <Radio name="format" value="all" checked={format === "all"} label="All formats" onChange={() => setFormat("all")} />
            {FORMATS.map((f) => <Radio key={f} name="format" value={f} checked={format === f} label={FORMAT_LABEL[f]} count={TEMPLATES.filter((t) => t.format === f).length} onChange={() => setFormat(f)} />)}
          </FilterGroup>
          <FilterGroup title="Goal">
            <Radio name="goal" value="all" checked={goal === "all"} label="All goals" onChange={() => setGoal("all")} />
            {GOALS.map((g) => <Radio key={g} name="goal" value={g} checked={goal === g} label={GOAL_LABEL[g]} count={TEMPLATES.filter((t) => t.goal === g).length} onChange={() => setGoal(g)} />)}
          </FilterGroup>
          {filtered && <button type="button" onClick={reset} className="px-2 text-sm font-medium text-brand hover:underline underline-offset-4">Clear filters</button>}
        </div>
      </aside>

      <div className="min-w-0">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          <Link href="/app/campaigns/new?start=blank" className="group flex h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm font-medium text-ink-2 transition-colors hover:border-brand-tint hover:bg-brand-soft hover:text-ink">
            <Plus className="size-5" aria-hidden />From scratch
            <span className="text-[11px] font-normal text-ink-3">Popup, slide-in or bar</span>
          </Link>
          <Link href="/app/studio" className="group flex h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-brand-tint bg-brand-soft text-sm font-medium text-brand transition-colors hover:bg-brand-solid/25 hover:text-ink">
            <Sparkles className="size-5" aria-hidden />Chat with AI
            <span className="text-[11px] font-normal text-ink-2">Describe a goal, review the draft</span>
          </Link>
          {tiles.map(({ label, icon: Icon, format: f }) => (
            <button key={f} type="button" aria-pressed={format === f} onClick={() => { setFormat(format === f ? "all" : f); setKind("any"); }}
              className={`group flex h-36 flex-col items-center justify-center gap-2 rounded-2xl border text-sm font-medium transition-colors ${format === f ? "border-brand bg-brand-soft text-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"}`}>
              <Icon className="size-5" aria-hidden />{label}
              <span className="num text-[11px] font-normal text-ink-3">{TEMPLATES.filter((t) => t.format === f).length} templates</span>
            </button>
          ))}
        </div>

        <div aria-live="polite" className="mt-10">
          {showMine && (
            <section aria-labelledby="mine-h">
              <h2 id="mine-h" className="mb-1 font-display text-lg font-bold uppercase tracking-tight">My campaigns</h2>
              <p className="mb-5 text-sm text-ink-2">Use a campaign you already made as the starting point for a new draft.</p>
              {mine.loading && <p className="text-sm text-ink-3">Loading…</p>}
              {!mine.loading && myCampaigns.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-3">No campaigns to reuse yet. Start from a ready-made template and it will show up here.</p>}
              <div className={grid}>{myCampaigns.map((c) => <MineCard key={c.id} c={c} />)}</div>
            </section>
          )}

          {showStarters && filtered && (
            <section aria-labelledby="results-h">
              <h2 id="results-h" className="mb-5 font-display text-lg font-bold uppercase tracking-tight">{templates.length} {templates.length === 1 ? "template" : "templates"}</h2>
              {templates.length === 0
                ? <p className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-3">No templates match. <button type="button" className="font-medium text-brand hover:underline underline-offset-4" onClick={reset}>Clear filters</button></p>
                : <div className={grid}>{templates.map((t) => <TemplateCard key={t.id} t={t} currency={store.currency} />)}</div>}
            </section>
          )}

          {showStarters && !filtered && SECTIONS.map((s) => {
            const items = TEMPLATES.filter(s.match);
            if (items.length === 0) return null;
            return (
              <section key={s.id} aria-labelledby={`${s.id}-h`} className="mb-12">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 id={`${s.id}-h`} className="font-display text-lg font-bold uppercase tracking-tight">{s.title}</h2>
                    <p className="mt-1 text-sm text-ink-2">{s.sub}</p>
                  </div>
                  <span className="num text-xs text-ink-3">{items.length} {items.length === 1 ? "template" : "templates"}</span>
                </div>
                <div className={grid}>{items.map((t) => <TemplateCard key={t.id} t={t} currency={store.currency} />)}</div>
              </section>
            );
          })}
        </div>

        <p className="mt-2 flex items-center gap-2 text-xs text-ink-3"><LayoutTemplate className="size-3.5" aria-hidden />Previews use sample products and copy. Your own products, prices and stock are used once the campaign is live.</p>
      </div>
    </div>
  );
}
