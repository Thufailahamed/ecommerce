"use client";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowUp, ExternalLink, Globe, Package, Paintbrush, Receipt, Sparkles, Store, Wand2 } from "lucide-react";
import { imageUrl, THEME_PRESETS } from "@convertflow/store-builder";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { roleHolds } from "@/lib/modules";
import { ASSET_BASE, builder, relativeTime, storeUrl, type SiteSummary } from "@/lib/builder";
import { ErrorNote, PageHeader, Skeleton } from "@/components/ui";

const IDEAS = [
  "A minimalist ceramics studio selling handmade mugs and vases",
  "Specialty coffee roaster with beans, gear and subscriptions",
  "Clean skincare for sensitive skin, soft and clinical",
  "Limited-drop streetwear label, dark and high contrast",
  "Organic dog treats and accessories, playful and bright",
];
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "JPY", "SGD", "AED"];

function SiteCard({ s }: { s: SiteSummary }) {
  const p = s.preview;
  const hero = p?.heroImage ? imageUrl(p.heroImage, ASSET_BASE) : "";
  const pal = p?.palette;
  return (
    <article className="card card-hover group flex flex-col overflow-hidden">
      <Link href={`/builder/${s.id}`} className="relative block aspect-[16/10] overflow-hidden" style={{ background: pal?.background ?? "#111" }} aria-label={`Open ${s.name} in the builder`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {hero && <img src={hero} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-105" />}
        <div className="absolute inset-0" style={{ background: hero ? "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.65) 100%)" : undefined }} />
        <div className="absolute inset-x-4 bottom-4">
          <div className="truncate text-lg font-semibold" style={{ color: hero ? "#fff" : pal?.text }}>{s.name}</div>
          {p?.tagline && <div className="mt-0.5 line-clamp-1 text-[12px]" style={{ color: hero ? "rgba(255,255,255,.8)" : pal?.muted }}>{p.tagline}</div>}
        </div>
        {pal && (
          <div className="absolute right-3 top-3 flex gap-1 rounded-full bg-black/30 p-1 backdrop-blur">
            {[pal.primary, pal.accent, pal.surface].map((c, i) => <span key={i} className="size-3 rounded-full ring-1 ring-white/20" style={{ background: c }} />)}
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ring-1", s.status === "published" ? "bg-ok/10 text-ok ring-ok/25" : "bg-ink/[0.05] text-ink-3 ring-line")}>
            <span aria-hidden className={clsx("size-1.5 rounded-full", s.status === "published" ? "bg-ok" : "bg-ink-3")} />{s.status === "published" ? "Live" : "Draft"}
          </span>
          {p && <span className="flex items-center gap-1"><Package className="size-3" aria-hidden />{p.products}</span>}
          <span className="ml-auto">Edited {relativeTime(s.updatedAt)}</span>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <Link href={`/builder/${s.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand-solid px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-solid-hover"><Paintbrush className="size-3.5" aria-hidden />Edit</Link>
          <Link href={`/app/sites/${s.id}/orders`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[12px] font-semibold text-ink transition-colors hover:bg-ink/[0.06]"><Receipt className="size-3.5" aria-hidden />Orders</Link>
          {s.status === "published" && <a href={storeUrl(s.slug)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-ink"><ExternalLink className="size-3.5" aria-hidden />View</a>}
        </div>
      </div>
    </article>
  );
}

export default function SitesPage() {
  const { me, store } = useSession();
  const router = useRouter();
  const [orgId, setOrgId] = useState(store?.organizationId ?? me.organizations[0]?.id ?? "");
  const org = me.organizations.find((o) => o.id === orgId);
  const canWrite = roleHolds(org?.role, "sites.write");
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [preset, setPreset] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try { setSites(await builder.list(orgId)); } catch (e) { setError(e instanceof Error ? e.message : "Could not load your stores"); setSites([]); }
  }, [orgId]);
  useEffect(() => { setSites(null); void load(); }, [load]);

  const create = async (opts: { blank?: boolean } = {}) => {
    if (!opts.blank && prompt.trim().length < 8) { setError("Tell the AI a little more: what you sell, and the feel you want."); return; }
    setBusy(true); setError(null);
    try {
      const r = await builder.create({ organizationId: orgId, currency, ...(preset ? { preset } : {}), ...(opts.blank ? { name: "My store" } : { prompt: prompt.trim() }) });
      router.push(`/builder/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "plan_limit" ? `${e.message} Manage your plan in Settings.` : e instanceof Error ? e.message : "Could not create the store");
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader eyebrow="AI store builder" title="Build a store" sub="Describe what you sell. The AI designs the store, writes the copy, drafts products and creates images, then you refine it in chat or by hand and publish." />

      {canWrite && (
        <section aria-label="Start a new store" className="relative mb-12 overflow-hidden rounded-[1.75rem] border border-line bg-gradient-to-b from-brand-solid/[0.12] to-transparent p-1">
          <div aria-hidden className="glow-orb -top-24 left-1/2 size-80 -translate-x-1/2 opacity-60" />
          <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="relative rounded-[1.5rem] border border-line-strong bg-canvas/80 p-4 backdrop-blur md:p-5">
            <label htmlFor="store-prompt" className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink"><Sparkles className="size-4 text-brand" aria-hidden />What store do you want to build?</label>
            <textarea id="store-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={2000}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void create(); } }}
              placeholder="e.g. A sustainable activewear brand for women called Northwind. Clean, sporty, lots of white space, with leggings, sports bras and jackets."
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 rounded-full border border-line bg-ink/[0.03] px-3 text-[12px] text-ink focus:border-brand focus:outline-none">
                {CURRENCIES.map((c) => <option key={c} value={c} className="bg-surface">{c}</option>)}
              </select>
              <select aria-label="Starting style" value={preset} onChange={(e) => setPreset(e.target.value)} className="h-9 rounded-full border border-line bg-ink/[0.03] px-3 text-[12px] text-ink focus:border-brand focus:outline-none">
                <option value="" className="bg-surface">Style: let AI choose</option>
                {THEME_PRESETS.map((p) => <option key={p.key} value={p.key} className="bg-surface">Style: {p.label}</option>)}
              </select>
              {me.organizations.length > 1 && (
                <select aria-label="Workspace" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="h-9 rounded-full border border-line bg-ink/[0.03] px-3 text-[12px] text-ink focus:border-brand focus:outline-none">
                  {me.organizations.map((o) => <option key={o.id} value={o.id} className="bg-surface">{o.name}</option>)}
                </select>
              )}
              <button type="button" onClick={() => void create({ blank: true })} disabled={busy} className="h-9 rounded-full px-3 text-[12px] font-medium text-ink-3 transition-colors hover:text-ink">Start blank</button>
              <button type="submit" disabled={busy || prompt.trim().length < 8}
                className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-brand-solid px-5 text-sm font-semibold text-white shadow-[0_10px_28px_-12px_rgba(35,80,255,1)] transition-all hover:bg-brand-solid-hover disabled:opacity-50">
                {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Wand2 className="size-4" aria-hidden />}Build my store<ArrowUp className="size-4 rotate-45" aria-hidden />
              </button>
            </div>
          </form>
          <div className="relative flex flex-wrap gap-2 px-4 pb-4 pt-3">
            {IDEAS.map((i) => <button key={i} type="button" onClick={() => setPrompt(i)} className="rounded-full border border-line bg-ink/[0.02] px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:border-brand-tint hover:text-ink">{i}</button>)}
          </div>
        </section>
      )}

      <ErrorNote error={error} />

      <div className="mb-4 flex items-end justify-between">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-ink">Your stores</h2>
        {sites && sites.length > 0 && <span className="text-[12px] text-ink-3">{sites.length} store{sites.length === 1 ? "" : "s"}</span>}
      </div>
      {sites === null ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-72 rounded-3xl" />)}</div>
      ) : sites.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line-strong p-10 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand"><Store className="size-5" aria-hidden /></div>
          <p className="text-sm text-ink-2">No stores yet. Describe one above and it will be ready to review in a couple of minutes.</p>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-ink-3"><Globe className="size-3.5" aria-hidden />Published stores get their own address you can share right away.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{sites.map((s) => <SiteCard key={s.id} s={s} />)}</div>
      )}
    </div>
  );
}
