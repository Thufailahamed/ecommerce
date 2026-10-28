import Link from "next/link";
import type { ReactNode } from "react";
import { Accessibility, ArrowDown, ArrowUpRight, BarChart3, BellRing, Boxes, Check, Clock, Code2, Eye, FileCheck, FlaskConical, Gauge, Globe, History, Layers, LayoutTemplate, Lock, MousePointerClick, Plus, Power, ShieldCheck, Sparkles, Store, Target, Users, X } from "lucide-react";
import { PLANS } from "@convertflow/contracts";
import { BRAND } from "@/lib/brand";
import { HeroDemo } from "./hero-demo";
import { Marquee, Panel, Reveal, Scaled } from "./fx";
import { BarMock, Photo, PopupMock, SlideInMock, STORES, StoreMock, ToastMock, type PhotoKey, type StoreName } from "./art";
import { Flows, Industries, TemplateRows } from "./industries";
import { Studio } from "./story";

/* ---------- shared bits ---------- */
export function SectionHead({ eyebrow, title, sub, className = "" }: { eyebrow: string; title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="eyebrow">{eyebrow}</p>
      <Reveal mask><h2 className="h2 mt-4">{title}</h2></Reveal>
      {sub && <Reveal delay={120}><p className="lead mt-5 max-w-2xl">{sub}</p></Reveal>}
    </div>
  );
}

const Hexagon = () => <span aria-hidden className="mx-[0.3em] inline-block size-[0.55em] bg-current align-middle [clip-path:polygon(25%_4%,75%_4%,100%_50%,75%_96%,25%_96%,0_50%)]" />;

/** Isometric cube drawn from three faces. */
function Cube({ className = "", tone = "blue" }: { className?: string; tone?: "blue" | "white" | "dark" }) {
  const f = { blue: ["#7c9cff", "#2350ff", "#1636b8"], white: ["#ffffff", "#d3d9ea", "#9aa3bd"], dark: ["#2a2e3b", "#1b1e29", "#101219"] }[tone];
  return (
    <svg viewBox="0 0 52 60" className={className} aria-hidden>
      <polygon points="26,0 52,15 26,30 0,15" fill={f[0]} />
      <polygon points="0,15 26,30 26,60 0,45" fill={f[1]} />
      <polygon points="52,15 26,30 26,60 52,45" fill={f[2]} />
    </svg>
  );
}

/* ---------- image cards right after the intro: product shots with a campaign and a true fact on top ---------- */
export function ImageCards() {
  const cards: { p: PhotoKey; store: StoreName; v: string; l: string; tag: string; overlay: ReactNode }[] = [
    { p: "p-hikers", store: "Northpeak", v: "< 15 KB", l: "core storefront script, gzipped. The build fails if it grows past this.", tag: "Outdoor · slide-in", overlay: <SlideInMock title="Compare our top 3" cta="Compare" product="p-sneaker-white" compact /> },
    { p: "p-serum-apply", store: "Lumen Skin", v: "0", l: "campaigns published without your explicit approval.", tag: "Beauty · email signup", overlay: <PopupMock title="First access" body="Join the list." cta="Subscribe" email compact /> },
    { p: "p-chair-blue", store: "Hearth Home", v: "1 tag", l: "to install on Shopify, WooCommerce, BigCommerce, Magento or custom.", tag: "Home · announcement bar", overlay: <BarMock text="Free shipping over $75" compact /> },
  ];
  return (
    <section aria-label="Highlights" className="relative bg-canvas pb-24 pt-20">
      <div className="wrap">
        <Reveal className="text-center">
          <p className="eyebrow justify-center">One engine</p>
          <h2 className="h2 mx-auto mt-4 max-w-4xl">Every kind of store, <span className="text-grad">one script</span></h2>
          <p className="mx-auto mt-5 max-w-xl text-[15px] text-ink-2">Popups, bars, slide-ins, toasts, upsells, email signups and back-in-stock alerts, all delivered by one lightweight script.</p>
        </Reveal>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {cards.map((c, i) => (
            <Reveal key={c.p} delay={i * 120} className="spot group relative aspect-[4/5] overflow-hidden rounded-[1.75rem] sm:aspect-[16/10] lg:aspect-[4/5]">
              <Photo k={c.p} w={900} className="absolute inset-0 size-full transition-transform duration-[1.4s] [transition-timing-function:var(--ease-out)] group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#05060a] via-[#05060a]/30 to-transparent" />
              <span className="absolute left-4 top-4 z-10 rounded-full bg-black/40 px-3 py-1 text-[12px] font-semibold text-white backdrop-blur">{c.tag}</span>
              <div className="absolute right-4 top-14 w-[62%] overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/20 transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:-translate-y-2 group-hover:rotate-[-1.5deg] sm:w-[48%] lg:w-[66%]">
                <Scaled width={420} height={260}><StoreMock name={c.store} {...STORES[c.store]} cols={4} compact>{c.overlay}</StoreMock></Scaled>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                <div className="font-display text-5xl font-bold">{c.v}</div>
                <p className="mt-2 max-w-xs text-[14px] text-white/80">{c.l}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <ul aria-label="At a glance" className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          {([[LayoutTemplate, "3 formats", "popup, slide-in and bar"], [Sparkles, "AI drafts", "from your real catalog"], [ShieldCheck, "Policy checks", "before you ever see a draft"], [Code2, "Runs locally", "no AI call on your storefront"]] as const).map(([Icon, v, l], i) => (
            <Reveal as="li" key={v} delay={i * 80} className="spot rounded-[1.25rem] bg-surface p-5 ring-1 ring-white/5 transition-colors hover:ring-brand-tint">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-soft"><Icon className="size-5 text-brand" aria-hidden /></span>
              <div className="mt-4 font-display text-xl font-bold">{v}</div>
              <p className="mt-1 text-[13px] text-ink-3">{l}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- photo wall: moments a campaign is for, masonry of lifestyle shots with the campaign on top ---------- */
export function PhotoWall() {
  const tiles: { k: PhotoKey; h: string; label: string; ui: ReactNode }[] = [
    { k: "p-shopper", h: "aspect-[3/4]", label: "Welcome a first-time visitor", ui: <MiniCard title="Welcome in" sub="Popup · after 8 seconds" /> },
    { k: "p-sneaker", h: "aspect-square", label: "Compare before buying", ui: <MiniCard title="Compare top 3" sub="Slide-in · 50% scroll" /> },
    { k: "p-capsules", h: "aspect-[4/5]", label: "Restock alerts", ui: <MiniCard title="Back in stock" sub="One email, double opt-in" /> },
    { k: "p-fashion-blue", h: "aspect-[3/4]", label: "Complete the look", ui: <MiniCard title="Add the watch" sub="Upsell · in stock only" /> },
    { k: "p-dog-beach", h: "aspect-[4/3]", label: "Launch news", ui: <MiniCard title="New: chew-proof toys" sub="Toast · 1 per session" /> },
    { k: "p-headphones", h: "aspect-square", label: "Help undecided shoppers", ui: <MiniCard title="Still deciding?" sub="Slide-in · 3+ pages viewed" /> },
    { k: "p-shopper-laptop", h: "aspect-[4/5]", label: "Free-shipping nudge", ui: <MiniCard title="$12 to free shipping" sub="Bar · cart over $40" /> },
    { k: "p-serum", h: "aspect-[3/4]", label: "Grow your list", ui: <MiniCard title="First access" sub="Email signup · consent" /> },
  ];
  return (
    <Panel label="Campaign moments" className="bg-canvas pb-24 pt-16">
      <div className="wrap">
        <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end">
          <SectionHead eyebrow="Moments" title={<>Made for the moments <span className="text-grad">that matter</span></>} />
          <p className="text-[15px] text-ink-2 md:text-right">Each moment is a campaign you can draft in a sentence, target precisely and cap so shoppers are never nagged.</p>
        </div>
        <div className="mt-12 columns-2 gap-4 md:columns-3 lg:columns-4 [&>*]:mb-4">
          {tiles.map((t, i) => (
            <Reveal key={t.k} delay={(i % 4) * 90} className={`spot group relative break-inside-avoid overflow-hidden rounded-[1.5rem] ${t.h}`}>
              <Photo k={t.k} w={600} alt="" className="absolute inset-0 size-full transition-transform duration-[1.4s] [transition-timing-function:var(--ease-out)] group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent opacity-90 transition-opacity group-hover:opacity-100" />
              <div className="absolute inset-x-3 top-3 translate-y-1 opacity-0 transition-all duration-500 [transition-timing-function:var(--ease-out)] group-hover:translate-y-0 group-hover:opacity-100 max-md:translate-y-0 max-md:opacity-100">{t.ui}</div>
              <p className="absolute inset-x-4 bottom-4 text-[15px] font-semibold text-white">{t.label}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function MiniCard({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/95 p-2 pr-3 text-[#0a0c14] shadow-xl backdrop-blur">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-solid text-white"><Sparkles className="size-4" aria-hidden /></span>
      <span className="min-w-0"><span className="block truncate text-[12.5px] font-bold">{title}</span><span className="block truncate text-[11px] text-black/55">{sub}</span></span>
    </div>
  );
}

/* ---------- names-only integrations strip (no third-party logos) ---------- */
export function IntegrationStrip() {
  const names = ["Shopify", "WooCommerce", "BigCommerce", "Magento", "Any website", "Klaviyo", "Mailchimp", "CSV export"];
  return (
    <div aria-label="Works with" className="border-y border-white/10 bg-canvas py-6">
      <Marquee duration={30}>
        {names.map((n) => <span key={n} className="flex items-center gap-3 whitespace-nowrap px-8 font-display text-[clamp(1rem,1.6vw,1.375rem)] font-bold uppercase text-white/35"><Store className="size-5" aria-hidden />{n}</span>)}
      </Marquee>
    </div>
  );
}

/* ---------- about: blue band with marquee, dark panel with problems and outcomes ---------- */
export function About() {
  const rows: [string, string, string][] = [
    ["Same popup for everyone", "Templates that ignore the page and the shopper.", "Drafts built from your real catalog and rules."],
    ["Discounts by default", "A code shown to every visitor, margin and all.", "Promotions only when you explicitly authorise them."],
    ["Widgets that fight", "Five tools competing for the same screen.", "One engine picks one campaign, deterministically."],
    ["No idea what worked", "Revenue claimed for anything that was shown.", "Observed, attributed and incremental kept apart."],
  ];
  return (
    <Panel label="About" className="bg-brand-solid">
      <Marquee duration={16} className="py-8 text-white md:py-10">
        {[0, 1].map((k) => <span key={k} className="display flex items-center whitespace-nowrap pr-[0.3em] text-[clamp(3rem,8vw,7rem)]">Get to know {BRAND.name} better<Hexagon /></span>)}
      </Marquee>
      <div className="trap bg-surface pb-24 pt-14 text-white">
        <div className="wrap">
          <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
            <p className="eyebrow">About</p>
            <Reveal mask><p className="font-display text-[clamp(1.125rem,2.2vw,2rem)] font-semibold uppercase leading-[1.25] text-white/90">
              Most on-site tools make it easy to show something. {BRAND.name} helps you decide what is appropriate for this shopper, on this page, right now, <span className="text-grad">and prove what happened afterwards.</span>
            </p></Reveal>
          </div>
          <div className="mt-14 grid gap-3 border-t border-white/10 pt-10 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map(([t, bad, good], i) => (
              <Reveal key={t} delay={i * 90} className="spot flex flex-col overflow-hidden rounded-[1.25rem] bg-canvas ring-1 ring-white/10">
                <div className="p-5">
                  <span className="num text-[11px] text-white/40">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-2 font-display text-[15px] font-bold uppercase">{t}</h3>
                  <p className="mt-2 flex gap-2 text-[14px] text-white/55"><X className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={3} aria-hidden />{bad}</p>
                </div>
                <p className="mt-auto flex gap-2 bg-brand-solid p-5 text-[14px] font-medium text-white"><Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} aria-hidden />{good}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- industries (light) ---------- */
export function IndustriesSection() {
  return (
    <Panel id="use-cases" label="Use cases by industry" className="on-light bg-paper pb-24 pt-16">
      <div aria-hidden className="dots-dark pointer-events-none absolute inset-0 [mask-image:linear-gradient(#000,transparent_40%)]" />
      <div className="wrap relative">
        <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end">
          <SectionHead eyebrow="Use cases" title={<>Built for <span className="text-grad">your</span> store</>} />
          <p className="text-[15px] text-ink-2 md:text-right">Pick an industry to see the campaign a store like yours would start with. Every example is a format the product ships; the stores are illustrative.</p>
        </div>
        <div className="mt-10"><Industries /></div>
      </div>
    </Panel>
  );
}

/* ---------- flows (dark) ---------- */
export function FlowsSection() {
  return (
    <Panel id="how-it-plays-out" label="How campaigns play out" className="overflow-hidden bg-canvas pb-24 pt-16">
      <div aria-hidden className="glow-orb -left-40 top-20 size-[50vmax] opacity-50" />
      <div className="wrap relative">
        <SectionHead eyebrow="How it plays out" title={<>From first visit to <span className="text-grad">measured result</span></>} sub="Four common goals, step by step, with the guardrails that come built in." />
        <div className="mt-12"><Flows /></div>
      </div>
    </Panel>
  );
}

/* ---------- pillars: numbered light rows that stack as you scroll ---------- */
function PillarVisual({ i }: { i: number }) {
  if (i === 0) return <div className="overflow-hidden rounded-[1.25rem]"><Scaled width={800} height={500}><StoreMock name="Northpeak" {...STORES["Northpeak"]}><Studio mode="goal" /></StoreMock></Scaled></div>;
  if (i === 2) return <div className="overflow-hidden rounded-[1.25rem]"><Scaled width={800} height={500}><StoreMock name="Lumen Skin" {...STORES["Lumen Skin"]} accent="#8a3b55"><PopupMock title="First access to new shades" body="Join for launches and restocks." cta="Sign me up" product="p-cream" email /></StoreMock></Scaled></div>;
  const body = i === 1 ? (
    <div className="w-full max-w-sm space-y-2">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-danger">The AI cannot</p>
      {["Invent a discount, coupon or price", "Claim stock we do not know", "Link shoppers to another website", "Publish anything by itself"].map((t) => <div key={t} className="flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5 text-[13px] text-white/85"><X className="size-4 text-danger" strokeWidth={3} aria-hidden />{t}</div>)}
    </div>
  ) : i === 3 ? (
    <div className="w-full max-w-sm space-y-2">
      {[["v3", "live", true], ["v2", "previous", false], ["v1", "first draft", false]].map(([v, l, live]) => (
        <div key={String(v)} className={`flex items-center justify-between rounded-xl px-4 py-3 text-[13px] ${live ? "bg-brand-solid text-white" : "bg-white/5 text-white/60"}`}><span><span className="num font-semibold">{v}</span> · {l}</span>{live ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-solid">Live</span> : <span>Roll back</span>}</div>
      ))}
      <div className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 text-[13px] text-white/60"><Power className="size-4 text-danger" aria-hidden />Store-wide kill switch</div>
    </div>
  ) : (
    <div className="flex h-40 w-full max-w-sm items-end gap-2">
      {[38, 52, 44, 61, 57, 70, 66, 78, 72, 92].map((h, k) => <div key={k} className="flex-1 rounded-t-md bg-[linear-gradient(180deg,#8fb0ff,#2350ff)]" style={{ height: `${h}%` }} />)}
    </div>
  );
  return <div className="grid h-64 place-items-center overflow-hidden rounded-[1.25rem] bg-[#0a0c14] p-6 md:h-80">{body}</div>;
}

export function Pillars() {
  const rows: [typeof Sparkles, string, string, string[]][] = [
    [Sparkles, "AI campaign studio", "Describe a goal in plain English, plus any constraints. The AI sees your catalog titles, links and availability, and treats store text as data, never as instructions.", ["Editable draft with trigger, audience and copy", "An explanation of why it chose them", "Works from your real catalog"]],
    [ShieldCheck, "Guardrails by design", "Model output is treated as untrusted. It is schema-checked and policy-checked on our servers before it ever reaches your editor, and a stale approval is refused if the draft changed after you reviewed it.", ["Cannot invent a discount, coupon or price", "Cannot claim stock we do not know", "Cannot link to another site or publish by itself"]],
    [Layers, "Live, exact preview", "Every proposal is rendered in a live preview on desktop and mobile using the same renderer your storefront runs. What you approve is what shoppers see.", ["Same code as the storefront", "Desktop and mobile", "Edit any word, rule or colour"]],
    [History, "Versions and rollback", "Publishing creates an immutable version. Restore any earlier one as a new version, pause a single campaign, or switch everything off with the store-wide kill switch.", ["Immutable publishes", "One-click rollback", "Store-wide kill switch"]],
    [BarChart3, "Honest analytics", "A purchase after an impression does not prove the campaign caused it. Observed, attributed and incremental are kept apart so you never over-read a dashboard.", ["Consent-first recording", "7-day last-click attribution, labelled", "Holdout experiments for real lift"]],
  ];
  return (
    <section id="features" aria-label="Core capabilities" className="relative isolate">
      {rows.map(([Icon, t, d, pts], i) => (
        <div key={t} className={`trap sticky ${i % 2 ? "bg-white" : "bg-paper"} text-[#0a0c14]`} style={{ top: `${4.5 + i * 4.75}rem`, zIndex: i + 1, minHeight: `calc(100dvh - ${4.5 + i * 4.75}rem)` }}>
          <div className="wrap">
            <div className="flex h-[4.75rem] items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-solid text-white shadow-[0_10px_24px_-10px_rgba(35,80,255,1)]"><Icon className="size-5" aria-hidden /></span>
              <h3 className="display truncate text-[clamp(1.1rem,3vw,2.5rem)]">{t}</h3>
              <span aria-hidden className="display ml-auto text-[clamp(1.5rem,3vw,2.75rem)] text-transparent [-webkit-text-stroke:1.5px_rgba(35,80,255,.45)]">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <div className="grid gap-8 pb-16 pt-6 md:grid-cols-[1.2fr_1fr] md:pb-24">
              <PillarVisual i={i} />
              <div>
                <p className="eyebrow !text-brand-solid">Capability</p>
                <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-black/70">{d}</p>
                <ul className="mt-8 divide-y divide-black/10 border-y border-black/10">
                  {pts.map((p) => <li key={p} className="flex items-center gap-3 py-4 text-[15px] font-medium"><span className="grid size-5 place-items-center rounded-full bg-brand-solid text-white"><Check className="size-3" strokeWidth={3} aria-hidden /></span>{p}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

/* ---------- template gallery on the blue panel ---------- */
export function Templates() {
  return (
    <Panel id="templates" label="Templates" className="overflow-hidden bg-brand-solid pb-20 pt-14 text-white">
      <div aria-hidden className="dots pointer-events-none absolute inset-0 opacity-60" />
      <div className="wrap relative grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end">
        <div>
          <p className="eyebrow !text-white">Starting points</p>
          <Reveal mask><h2 className="h2 mt-4">Start from a template, <span className="text-white/60">or a sentence</span></h2></Reveal>
        </div>
        <div className="md:text-right">
          <p className="text-[15px] text-white/80">Every template is an editable draft: change the copy, rules and colours, preview it on your store, then approve.</p>
          <Link href="/signup" className="btn btn-white mt-5">Browse templates <ArrowUpRight className="size-4" aria-hidden /></Link>
        </div>
      </div>
      <div className="relative mt-12"><TemplateRows /></div>
    </Panel>
  );
}

/* ---------- decision engine + analytics, white panel under a dark marquee ---------- */
export function Engine() {
  const steps = [
    ["Delivery on?", "Store-wide kill switch and plan limits"],
    ["Published & valid?", "Only immutable, validated versions"],
    ["On schedule?", "Start and end times, evaluated in the browser"],
    ["Right audience?", "Page, device, cart, visitor rules"],
    ["Trigger met?", "Delay, scroll, idle or exit intent"],
    ["Within limits?", "Session caps, dismissals, recent clicks"],
    ["Any conflict?", "Highest priority wins, ties broken by id"],
    ["Render & record", "One experience, one consented event"],
  ];
  const cols = [
    [Eye, "Observed", "Every order reported for your store in the period. A fact, not a claim about campaigns."],
    [MousePointerClick, "Attributed", "Orders placed within 7 days after a shopper clicked a campaign (last click). Shows association."],
    [FileCheck, "Incremental", "What a campaign actually caused. Only shown for holdout experiments, once the sample is large enough."],
  ] as const;
  return (
    <Panel id="engine" label="Decision engine" className="bg-[#0a0c14]">
      <Marquee duration={18} reverse className="py-6 text-white">
        {[0, 1].map((k) => <span key={k} className="display flex items-center whitespace-nowrap pr-[0.3em] text-[clamp(2.5rem,6vw,5.5rem)]">One engine decides<span className="text-brand"><Hexagon /></span><span className="text-outline">Not five widgets arguing</span><span className="text-brand"><Hexagon /></span></span>)}
      </Marquee>
      <div className="trap on-light bg-white pb-24 pt-14">
        <div className="wrap">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr_1.6fr]">
            <h2 className="h3">Decision engine</h2>
            <div className="relative h-72 overflow-hidden rounded-[1.25rem] bg-[#0a0c14] lg:h-auto">
              <div className="pulse-line absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2" />
              {(["white", "white", "blue"] as const).map((tone, k) => <div key={k} className="float absolute left-1/2 w-12 -translate-x-1/2" style={{ top: `${12 + k * 26}%`, animationDelay: `${k * 0.5}s` }}><Cube tone={tone} /></div>)}
            </div>
            <div>
              <p className="text-[17px] leading-relaxed text-black/70">Every page view runs the same deterministic pipeline, locally in the browser. No network call to an AI model happens on your storefront, and if our API is unreachable the last published campaigns keep working.</p>
              <ol className="mt-8 grid gap-px overflow-hidden rounded-[1.25rem] border border-black/10 bg-black/10 sm:grid-cols-2">
                {steps.map(([t, d], i) => (
                  <Reveal as="li" key={t} delay={i * 50} className="group bg-paper p-5 transition-colors hover:bg-brand-solid hover:text-white">
                    <span className="num text-xs font-semibold text-brand-solid group-hover:text-white/70">{String(i + 1).padStart(2, "0")}</span>
                    <h3 className="mt-2 font-display text-[15px] font-bold uppercase">{t}</h3>
                    <p className="mt-1 text-[13px] text-black/60 group-hover:text-white/80">{d}</p>
                  </Reveal>
                ))}
              </ol>
              <p className="mt-5 text-[13px] text-black/50">Unknown data never counts as a match: if a cart value or stock status is not available, the rule simply does not pass.</p>
            </div>
          </div>

          <div className="mt-20 grid gap-8 border-t border-black/10 pt-14 lg:grid-cols-[1fr_1fr_1.6fr]">
            <h2 className="h3">Analytics you can defend</h2>
            <div className="relative h-72 overflow-hidden rounded-[1.25rem] bg-[#0a0c14] p-6 lg:h-auto" aria-hidden>
              <div className="flex h-full items-end gap-2">
                {[38, 52, 44, 61, 57, 70, 66, 78, 72, 92].map((h, i) => <Reveal key={i} delay={i * 60} className="flex-1"><div className="rounded-t-md bg-[linear-gradient(180deg,#8fb0ff,#2350ff)]" style={{ height: `${h * 2}px` }} /></Reveal>)}
              </div>
            </div>
            <div>
              <p className="text-[17px] leading-relaxed text-black/70">A purchase after an impression does not prove the campaign caused it. We keep three ideas apart so you never over-read a dashboard.</p>
              <ul className="mt-6 divide-y divide-black/10 border-y border-black/10">
                {cols.map(([Icon, t, d]) => (
                  <li key={t} className="grid gap-3 py-5 sm:grid-cols-[2.5rem_9rem_1fr]">
                    <Icon className="size-5 text-brand-solid" aria-hidden />
                    <span className="font-display text-[15px] font-bold uppercase">{t}</span>
                    <span className="text-[14px] text-black/60">{d}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[["Attributed", "Included on every plan"], ["Incremental", "On Growth and Scale plans"]].map(([t, d]) => (
                  <div key={t} className="rounded-[1.25rem] bg-[#0a0c14] p-5 text-white">
                    <div className="font-display text-2xl font-bold text-[#8fb0ff]">{t}</div>
                    <p className="mt-2 text-[13px] text-white/60">{d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- every feature, compact ---------- */
export function Features() {
  const items: [typeof Sparkles, string, string][] = [
    [Sparkles, "AI campaign studio", "Describe a goal, get an editable draft with trigger, audience, copy and an explanation of why."],
    [Layers, "Visual editor", "Live preview on desktop and mobile that uses the exact renderer your storefront runs."],
    [Target, "Rules and targeting", "Page type, URL, device, cart value, visitor type and more, with a plain-English summary."],
    [Clock, "Schedules", "Start and end campaigns on a date without touching them again."],
    [Gauge, "Frequency control", "Per-session caps and suppression after dismissals or clicks, so shoppers are not nagged."],
    [History, "Versions and rollback", "Every publish is immutable. Restore any earlier version as a new one."],
    [Power, "Kill switch", "Pause every campaign on a store instantly, without editing anything."],
    [BarChart3, "Honest analytics", "Impressions, clicks, observed orders and attributed revenue, clearly labelled."],
    [Lock, "Consent first", "Nothing is recorded until your site signals analytics consent."],
    [Boxes, "Catalog aware", "Import products from JSON or CSV. Unknown stock stays unknown."],
    [Globe, "Any platform", "One script tag. A small JavaScript API for page context and purchase tracking."],
    [Accessibility, "Accessible by default", "Keyboard and screen-reader friendly campaigns that respect reduced motion."],
    [FlaskConical, "Holdout experiments", "Hold a share of visitors out as a control group to estimate real lift."],
    [BellRing, "Back-in-stock alerts", "Shoppers opt in by email and get one alert when a product returns."],
    [Users, "Teams and two-step sign-in", "Invite colleagues with roles, and protect every account with an authenticator app."],
  ];
  return (
    <Panel label="All features" className="bg-canvas pb-24 pt-16 text-white">
      <div className="wrap">
        <SectionHead eyebrow="Everything included" title={<>Run on-site campaigns <span className="text-grad">well</span></>} sub="Built around control and clarity, not volume." />
        <div className="mt-14 grid gap-px overflow-hidden rounded-[1.25rem] bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(([Icon, t, d], i) => (
            <div key={t} className="spot group bg-[#0b0d14] p-6 transition-colors duration-300 hover:bg-brand-solid">
              <div className="flex items-center justify-between"><Icon className="size-5 text-brand transition-colors group-hover:text-white" aria-hidden /><span className="num text-xs text-white/30 group-hover:text-white/60">{String(i + 1).padStart(2, "0")}</span></div>
              <h3 className="mt-6 font-display text-[15px] font-bold uppercase">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/50 group-hover:text-white/85">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ---------- live demo + platforms: blue block with a ticker ---------- */
export function TryIt() {
  const rows = [
    ["Shopify", "Script tag or theme app embed. Webhooks for products, orders and privacy requests are built; a native install flow is in development."],
    ["WooCommerce", "Script tag, live catalog sync with a read-only API key, or JSON/CSV import."],
    ["BigCommerce", "Script tag, live catalog sync with a read-only API token, or JSON/CSV import."],
    ["Magento", "Script tag and product import (JSON or CSV)."],
    ["Any website", "Script tag, plus a small JavaScript API to provide page context and report purchases."],
  ];
  return (
    <Panel id="platforms" label="Live demo and platforms" className="bg-white px-2 py-2 md:px-4 md:py-4">
      <div className="on-blue relative overflow-hidden rounded-[1.5rem] bg-[linear-gradient(135deg,#2350ff,#1636b8)] pb-6">
        <div aria-hidden className="dots pointer-events-none absolute inset-0 opacity-50" />
        <Marquee duration={22} className="relative py-6">
          {[0, 1].map((k) => <span key={k} className="display whitespace-nowrap text-[clamp(1.75rem,3.4vw,3rem)]">/ try it live / start free / try it live / start free&nbsp;</span>)}
        </Marquee>
        <div className="relative grid gap-4 px-3 md:px-6 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <div className="on-deep"><HeroDemo /></div>
            <p className="mt-3 text-[12px] text-white/70">Interactive, illustrative example. Rendered by the same code that runs on your storefront.</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-[1.25rem] bg-white/10 p-5 ring-1 ring-white/15">
              <span className="flex items-center gap-3"><span className="size-2 rounded-full bg-white" /><span className="font-display text-lg font-bold uppercase">Install</span></span>
              <code className="num truncate rounded-full bg-[#0a0c14] px-4 py-2 text-[12px] text-brand-glow">&lt;script async src=&quot;…/cf.js&quot;&gt;</code>
            </div>
            <div className="rounded-[1.25rem] bg-[#0a0c14] p-5 text-white">
              <h3 className="font-display text-xl font-bold uppercase">Works where your store lives</h3>
              <ul className="mt-4 space-y-2">
                {rows.map(([n, d]) => (
                  <li key={n}>
                    <details className="group rounded-2xl bg-white/5 px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-center gap-3 text-[15px] font-semibold [&::-webkit-details-marker]:hidden"><Store className="size-4 text-brand-glow" aria-hidden />{n}<Plus className="ml-auto size-4 text-white/50 transition-transform group-open:rotate-45" aria-hidden /></summary>
                      <p className="mt-2 pl-7 text-[13px] leading-relaxed text-white/60">{d}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
            <Link href="/signup" className="btn btn-white btn-lg w-full">Create a free workspace <ArrowUpRight className="size-4" aria-hidden /></Link>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- big statement band ---------- */
export function Statement() {
  return (
    <Panel label="Launch" className="overflow-hidden bg-surface py-16 md:py-24">
      <div aria-hidden className="glow-orb -right-40 -top-20 size-[40vmax]" />
      <div className="wrap relative grid items-center gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <Reveal mask><h2 className="display text-[clamp(2.5rem,7.4vw,7rem)] leading-[0.98]">
            Launch your <span className="text-grad">first campaign</span> this afternoon
          </h2></Reveal>
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <Link href="/signup" className="btn btn-primary btn-lg">Start free <ArrowUpRight className="size-4" aria-hidden /></Link>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-white/60">
              {["Free plan available", "One script tag, any platform", "AI drafts, you approve", "Roll back in one click"].map((t) => <li key={t} className="flex items-center gap-2"><Check className="size-4 text-brand" strokeWidth={3} aria-hidden />{t}</li>)}
            </ul>
          </div>
        </div>
        <div aria-hidden className="relative hidden aspect-square lg:block">
          {(["p-sneaker", "p-serum-apply", "p-headphones", "p-chair-blue"] as const).map((p, i) => (
            <div key={p} className="absolute w-[46%]" style={{ left: `${[2, 52, 6, 50][i]}%`, top: `${[2, 10, 52, 58][i]}%`, rotate: `${[-6, 5, 4, -4][i]}deg` }}>
              <div className="float aspect-square overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10" style={{ animationDelay: `${i * 0.7}s` }}><Photo k={p} w={500} className="size-full" /></div>
            </div>
          ))}
          <div className="absolute inset-x-[8%] top-[44%] h-16"><ToastMock text="Campaign approved" sub="v3 is live on your store" /></div>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- pricing (rendered from the same PLANS the API enforces) ---------- */
export function Pricing() {
  const common = ["All three campaign formats", "Targeting, scheduling and frequency caps", "Versions, rollback and kill switch", "Consent-based analytics"];
  const plans = [PLANS.free, PLANS.starter, PLANS.growth, PLANS.scale];
  return (
    <Panel id="pricing" label="Pricing" className="on-light bg-white pb-24 pt-16">
      <div className="wrap">
        <div className="grid gap-6 border-b border-black/10 pb-10 md:grid-cols-[1fr_1fr]">
          <h2 className="h2">Simple <span className="text-grad">plans</span></h2>
          <p className="self-end text-[15px] text-black/60 md:justify-self-end md:text-right">Limits enforced by the server. Launch pricing, subject to change.<br />Prices in USD per month.</p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p, i) => {
            const hl = p.id === "starter";
            return (
              <Reveal key={p.id} delay={i * 90} className={`spot flex flex-col rounded-[1.25rem] p-6 transition-transform duration-500 [transition-timing-function:var(--ease-out)] hover:-translate-y-1.5 ${hl ? "bg-[linear-gradient(160deg,#2350ff,#1636b8)] text-white shadow-[0_30px_60px_-30px_rgba(35,80,255,1)]" : "bg-paper"}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-bold uppercase">{p.id}</h3>
                  {hl && <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-solid">Start here</span>}
                </div>
                <div className="mt-8 font-display text-5xl font-bold">${p.priceUsdMonthly}<span className={`ml-1 font-sans text-sm font-medium ${hl ? "text-white/60" : "text-black/50"}`}>/ month</span></div>
                <ul className={`mt-8 flex-1 space-y-3 border-t pt-6 text-[14px] ${hl ? "border-white/20" : "border-black/10"}`}>
                  {[`${p.maxActiveCampaigns} live campaign${p.maxActiveCampaigns > 1 ? "s" : ""}`, `${p.aiGenerationsPerMonth.toLocaleString("en-US")} AI drafts / month`, `${p.trackedPageviewsPerMonth.toLocaleString("en-US")} tracked pageviews / month`, `${p.maxStores} connected store${p.maxStores > 1 ? "s" : ""}`, ...(p.notificationsPerMonth ? [`${p.notificationsPerMonth.toLocaleString("en-US")} restock alerts / month`] : []), ...(p.experiments ? ["Holdout experiments"] : [])].map((t) => (
                    <li key={t} className="flex gap-2.5"><Check className={`mt-0.5 size-4 shrink-0 ${hl ? "" : "text-brand-solid"}`} strokeWidth={3} aria-hidden /><span>{t}</span></li>
                  ))}
                </ul>
                <Link href="/signup" className={`btn mt-8 w-full ${hl ? "btn-white" : "btn-dark"}`}>{p.priceUsdMonthly === 0 ? "Start free" : `Choose ${p.id[0]!.toUpperCase()}${p.id.slice(1)}`}</Link>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-8 max-w-3xl text-[13px] text-black/50">Every plan includes: {common.join(" · ")}. When a monthly pageview allowance is used up, campaigns pause until the next period or an upgrade.</p>
      </div>
    </Panel>
  );
}

/* ---------- FAQ ---------- */
export const FAQ: [string, string][] = [
  ["Does it work outside Shopify?", "Yes. One script tag works on Shopify, WooCommerce, BigCommerce, Magento or a custom build. Products can be imported from JSON or CSV."],
  ["Will AI publish anything on its own?", "Never. AI only creates a draft. You review a live preview and explicitly approve before anything reaches shoppers."],
  ["Can the AI invent discounts or stock claims?", "No. Proposals that mention a promotion you did not authorise, or claim availability we cannot verify, are rejected before you see them."],
  ["Do you track visitors without consent?", "No. Events are only recorded after your site signals analytics consent. Without consent, campaigns can still display, but nothing is recorded."],
  ["What happens if your servers are down?", "Your storefront keeps working. The script runs locally and uses the last published configuration. No AI call happens on a shopper's page view."],
  ["What does “attributed revenue” mean?", "Orders placed within 7 days after a shopper clicked a campaign. It shows association, not proven lift, and is labelled that way in the product."],
  ["How big is the script?", "The core script every page loads is under 15 KB gzipped, and the build fails if it ever grows past that. Each tool you use (toasts, the notification feed, recommendations, email forms) is one more script of about 3 KB, loaded only on pages where a campaign of that tool can show."],
  ["Can I measure whether a campaign really works?", "Yes, on Growth and Scale. A holdout experiment keeps a share of consenting visitors from seeing the campaign and compares their orders with everyone else’s. We withhold a verdict until the sample is large enough, and label it an estimate."],
  ["Can I roll back a mistake?", "Yes. Every publish is a new immutable version. Restore an earlier one, pause a single campaign, or switch off delivery for the whole store."],
];

export function Faq() {
  return (
    <section id="faq" aria-label="FAQ" className="trap relative z-10 rounded-b-[2rem] bg-surface pb-20 pt-16 text-white">
      <div className="wrap grid gap-12 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="h2">FAQ</h2>
          <p className="mt-6 text-[15px] text-white/50">Still have a question?</p>
          <Link href="/signup" className="mt-2 inline-flex items-center gap-2 text-[15px] font-semibold text-brand underline-offset-4 hover:underline">Create a free workspace and look around <ArrowDown className="size-4 -rotate-90" aria-hidden /></Link>
        </div>
        <div className="border-t border-white/10">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group border-b border-white/10">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[clamp(1rem,1.6vw,1.25rem)] font-semibold uppercase [&::-webkit-details-marker]:hidden">
                {q}<span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/5 transition-all duration-300 group-open:rotate-45 group-open:bg-brand-solid"><Plus className="size-4" aria-hidden /></span>
              </summary>
              <p className="max-w-2xl pb-6 leading-relaxed text-white/60">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
