import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, BadgeCheck, Bell, Check, Code2, Database, Download, FlaskConical, Gauge, Inbox, Lock, Mail, MousePointer2, PauseCircle, RotateCcw, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, Store, Timer, Users, Zap } from "lucide-react";
import { LogoMark } from "../logo";
import { BarMock, FeedMock, Photo, PopupMock, SlideInMock, STORES, StoreMock, ToastMock, UpsellMock, type PhotoKey, type StoreName } from "./art";
import { Marquee, Reveal, Scaled } from "./fx";

/* ---------- Bento: one studio, six capabilities, each card with its own live visual ---------- */

const HUES = {
  magenta: "radial-gradient(90% 70% at 30% 100%, rgba(214, 51, 132, .38), transparent 70%)",
  blue: "radial-gradient(90% 70% at 50% 100%, rgba(35, 80, 255, .45), transparent 70%)",
  amber: "radial-gradient(90% 70% at 70% 100%, rgba(255, 166, 0, .28), transparent 70%)",
  emerald: "radial-gradient(90% 70% at 30% 100%, rgba(16, 185, 129, .3), transparent 70%)",
  violet: "radial-gradient(90% 70% at 60% 100%, rgba(124, 58, 237, .38), transparent 70%)",
  cyan: "radial-gradient(90% 70% at 50% 100%, rgba(6, 182, 212, .3), transparent 70%)",
} as const;

function Card({ title, body, hue, className = "", children, delay = 0 }: { title: string; body: string; hue: keyof typeof HUES; className?: string; children: ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay} className={`on-deep spot group relative flex min-h-[30rem] flex-col overflow-hidden rounded-[1.75rem] bg-[#0b0d14] text-white shadow-[0_30px_60px_-34px_rgba(10,12,20,.6)] ring-1 ring-black/10 transition-[box-shadow] duration-500 hover:shadow-[0_40px_80px_-34px_rgba(35,80,255,.55)] ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-80 transition-opacity duration-700 group-hover:opacity-100" style={{ background: HUES[hue] }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="relative z-[2] p-7 md:p-8">
        <h3 className="text-[clamp(1.25rem,1.8vw,1.6rem)] font-bold tracking-tight text-white">{title}</h3>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/55">{body}</p>
      </div>
      <div className="relative z-[2] mt-auto flex-1">{children}</div>
    </Reveal>
  );
}

/* 1. Formats: a tilted, endless shelf of real campaign formats on real stores */
const FORMATS: { label: string; store: StoreName; ui: ReactNode }[] = [
  { label: "Popup", store: "Lumen Skin", ui: <PopupMock title="First access" body="Join the list for launches." cta="Subscribe" email compact /> },
  { label: "Slide-in", store: "Signal Audio", ui: <SlideInMock title="Compare our top 3" cta="Compare" product="p-headphones-pink" compact /> },
  { label: "Announcement bar", store: "Hearth Home", ui: <BarMock text="Free shipping over $75" compact /> },
  { label: "Upsell", store: "Field & Thread", ui: <UpsellMock items={["p-sneaker", "p-watch"]} compact /> },
  { label: "Toast", store: "Good Boy Co.", ui: <ToastMock text="New: chew-proof toys" sub="Out now" compact /> },
  { label: "Notification feed", store: "Northpeak", ui: <FeedMock compact /> },
];
function FormatShelf() {
  const tile = (f: (typeof FORMATS)[number], k: string) => (
    <figure key={k} className="w-56 shrink-0 rounded-2xl bg-white/[0.04] p-2 ring-1 ring-white/10 backdrop-blur transition-transform duration-500 [transition-timing-function:var(--ease-out)] hover:-translate-y-2 hover:rotate-[-1deg]">
      <div className="overflow-hidden rounded-xl"><Scaled width={420} height={260}><StoreMock name={f.store} {...STORES[f.store]} compact>{f.ui}</StoreMock></Scaled></div>
      <figcaption className="px-1 pb-0.5 pt-2 text-center text-[13px] font-semibold text-white/85">{f.label}</figcaption>
    </figure>
  );
  return (
    <div className="relative h-full min-h-64 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div className="absolute inset-x-[-10%] top-2 rotate-[-4deg] space-y-4">
        {[0, 1].map((r) => (
          <div key={r} className="marquee-pause overflow-hidden">
            <div className={`marquee ${r ? "marquee-rev" : ""}`} style={{ "--marquee-dur": "34s" } as CSSProperties}>
              {[0, 1].map((k) => <div key={k} className="flex shrink-0 gap-4 pr-4" aria-hidden={k === 1 || undefined}>{(r ? [...FORMATS].reverse() : FORMATS).map((f) => tile(f, `${r}-${k}-${f.label}`))}</div>)}
            </div>
          </div>
        ))}
      </div>
      <MousePointer2 aria-hidden className="bento-hand absolute left-[38%] top-[34%] size-7 fill-white text-black drop-shadow-lg" />
    </div>
  );
}

/* 2. Rules: a pipeline of conditions with a signal travelling through it */
function RulePipeline() {
  const nodes: [typeof Users, string][] = [[Users, "New visitor"], [Timer, "After 8 s"], [ShieldCheck, "Policy checks"], [Sparkles, "Popup"]];
  return (
    <div className="px-7 pb-8 md:px-8">
      <div className="relative">
        <div aria-hidden className="absolute bottom-6 left-[1.35rem] top-6 w-px bg-gradient-to-b from-brand/60 via-brand/30 to-transparent" />
        <span aria-hidden className="bento-signal absolute left-[1.1rem] top-6 size-2.5 rounded-full bg-brand-glow shadow-[0_0_14px_4px_rgba(143,176,255,.8)]" />
        <ol className="space-y-3">
          {nodes.map(([Icon, t], i) => (
            <li key={t} className="relative flex items-center gap-3 rounded-2xl bg-white/[0.04] p-2.5 pr-4 ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/[0.07]" style={{ marginLeft: `${i * 6}%` }}>
              <span className="grid size-9 place-items-center rounded-xl bg-brand-solid text-white shadow-[0_8px_20px_-8px_rgba(35,80,255,1)]"><Icon className="size-4" aria-hidden /></span>
              <span className="text-[14px] font-semibold text-white">{t}</span>
              <span className="num ml-auto text-[11px] text-white/35">{["page_type = collection", "trigger: delay", "4 / 4 passed", "1 per session"][i]}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-5 flex items-center gap-2 text-[13px] text-white/45"><Lock className="size-3.5" aria-hidden />Unknown data never counts as a match.</p>
    </div>
  );
}

/* 3. Catalog: product cards from your store with verified stock and in-place add to cart */
const PRODUCTS: [PhotoKey, string, string, boolean][] = [["p-chair-blue", "Harbor armchair", "$489", true], ["p-headphones", "Studio wireless", "$199", true], ["p-sneaker", "Canvas low", "$79", false], ["p-watch-brown", "Field watch", "$249", true]];
function CatalogCards() {
  return (
    <div className="relative h-full min-h-72 overflow-hidden">
      <div className="absolute right-6 top-0 z-10 grid size-14 place-items-center rounded-2xl bg-[#12141c] shadow-2xl ring-1 ring-white/15"><Store className="size-6 text-amber-300" aria-hidden /></div>
      <div className="absolute inset-x-0 bottom-0 top-8 [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
        <Marquee duration={26}>
          {PRODUCTS.map(([k, n, p, stock]) => (
            <div key={k} className="mr-4 w-48 shrink-0 overflow-hidden rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
              <div className="relative aspect-[4/3]"><Photo k={k} w={500} className="size-full" />
                <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${stock ? "bg-emerald-400/90 text-black" : "bg-white/85 text-black/60"}`}>{stock ? "In stock" : "Stock unknown"}</span>
              </div>
              <div className="p-3">
                <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[14px] font-semibold text-white">{n}</span><span className="text-[13px] font-semibold text-amber-300">{p}</span></div>
                <span className={`mt-3 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] font-semibold ${stock ? "bg-amber-400 text-black" : "bg-white/10 text-white/40"}`}><ShoppingCart className="size-3.5" />{stock ? "Add to cart" : "Not recommended"}</span>
              </div>
            </div>
          ))}
        </Marquee>
      </div>
    </div>
  );
}

/* 4. Approve: a cursor presses Publish, a ripple, then the live toast */
function PublishDemo() {
  return (
    <div className="relative grid h-full min-h-64 place-items-center px-7 pb-8">
      <div className="w-full max-w-xs rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between text-[12px] text-white/50"><span className="num">v3 · Trail launch</span><span className="flex items-center gap-1 text-emerald-300"><BadgeCheck className="size-3.5" />Validated</span></div>
        <div className="relative mt-4">
          <span className="bento-press relative block overflow-hidden rounded-xl bg-brand-solid py-3.5 text-center text-[16px] font-bold text-white shadow-[0_14px_34px_-12px_rgba(35,80,255,1)]">
            Approve &amp; publish
            <span aria-hidden className="bento-ripple absolute left-[70%] top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />
          </span>
          <MousePointer2 aria-hidden className="bento-cursor absolute left-[70%] top-[55%] size-6 fill-white text-black drop-shadow-lg" />
        </div>
      </div>
      <div className="bento-live absolute bottom-6 left-1/2 flex items-center gap-2 whitespace-nowrap rounded-full bg-emerald-400 px-4 py-2 text-[13px] font-semibold text-black shadow-2xl"><Check className="size-4" strokeWidth={3} />v3 is live on your store</div>
    </div>
  );
}

/* 5. Automate: the actions that follow a campaign, as two drifting rows of chips */
const ACTIONS: [typeof Mail, string, string][] = [
  [Inbox, "Copy subscriber to Klaviyo", "text-orange-300"], [Mail, "Add to a Mailchimp audience", "text-yellow-300"], [Download, "Export confirmed subscribers", "text-sky-300"],
  [Bell, "Send one restock alert", "text-amber-300"], [ShoppingCart, "Add product to cart in place", "text-emerald-300"], [Database, "Record a consented event", "text-violet-300"],
  [PauseCircle, "Pause the whole store", "text-rose-300"], [RotateCcw, "Roll back to v2", "text-cyan-300"], [ShoppingBag, "Attribute a purchase (7-day click)", "text-lime-300"],
];
function ActionRows() {
  const chip = ([Icon, t, c]: (typeof ACTIONS)[number]) => (
    <span key={t} className="mr-3 flex shrink-0 items-center gap-2.5 rounded-2xl bg-white/[0.05] px-4 py-3 text-[14px] font-semibold text-white/90 ring-1 ring-white/10 backdrop-blur"><Icon className={`size-4 ${c}`} aria-hidden />{t}</span>
  );
  return (
    <div className="grid h-full gap-6 px-7 pb-8 md:grid-cols-[1fr_1.4fr] md:px-8">
      <div className="self-end rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-white/40">Email signup</p>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/40 px-3 py-2.5 text-[13px] text-white/40 ring-1 ring-white/10"><Mail className="size-4" />you@email.com</div>
        <label className="mt-2.5 flex items-start gap-2 text-[12px] text-white/55"><span className="mt-0.5 size-3.5 shrink-0 rounded border border-white/40" />I agree to receive marketing emails. Unsubscribe any time.</label>
        <span className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-orange-500 py-2.5 text-[13px] font-semibold text-white">Subscribe <ArrowRight className="size-3.5" /></span>
      </div>
      <div className="relative -mr-8 space-y-3 self-center overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_85%,transparent)]">
        <Marquee duration={30}>{ACTIONS.slice(0, 5).map(chip)}</Marquee>
        <Marquee duration={36} reverse>{ACTIONS.slice(4).map(chip)}</Marquee>
        <Marquee duration={32}>{[...ACTIONS.slice(2, 7)].map(chip)}</Marquee>
      </div>
    </div>
  );
}

/* 6. Holdouts: control vs exposed, with a verdict that waits for enough data */
function HoldoutDemo() {
  return (
    <div className="grid gap-4 px-7 pb-8 sm:grid-cols-[1.4fr_1fr] md:px-8">
      <div className="space-y-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
        {[["Saw the campaign", 90, "bg-violet-400"], ["Held out (control)", 10, "bg-white/40"]].map(([t, w, c]) => (
          <div key={t as string}>
            <div className="flex justify-between text-[13px]"><span className="text-white/80">{t}</span><span className="num text-white/45">{w}% of visitors</span></div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10"><div className={`bento-fill h-full rounded-full ${c}`} style={{ "--w": `${w}%` } as CSSProperties} /></div>
          </div>
        ))}
        <p className="text-[12px] text-white/40">Illustrative split. You choose the share held out.</p>
      </div>
      <div className="grid place-items-center rounded-2xl bg-white/[0.04] p-5 text-center ring-1 ring-white/10">
        <div className="relative size-24">
          <svg viewBox="0 0 36 36" className="size-full -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="3" /><circle className="bento-ring" cx="18" cy="18" r="15.5" fill="none" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round" pathLength="100" /></svg>
          <FlaskConical className="absolute inset-0 m-auto size-7 text-violet-300" aria-hidden />
        </div>
        <p className="mt-3 text-[13px] font-semibold text-white">Collecting data</p>
        <p className="text-[12px] text-white/45">No verdict until the sample is large enough</p>
      </div>
    </div>
  );
}

/* 7. Speed: a gauge that settles under the budget */
function SpeedGauge() {
  return (
    <div className="grid place-items-center px-7 pb-8">
      <div className="relative w-full max-w-[15rem]">
        <svg viewBox="0 0 120 70" className="w-full" aria-hidden>
          <path d="M10 62a50 50 0 0 1 100 0" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="10" strokeLinecap="round" />
          <path className="bento-gauge" d="M10 62a50 50 0 0 1 100 0" fill="none" stroke="url(#g-speed)" strokeWidth="10" strokeLinecap="round" pathLength="100" />
          <defs><linearGradient id="g-speed" x1="0" x2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor="#2350ff" /></linearGradient></defs>
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center"><span className="font-display text-4xl font-bold text-white">&lt; 15</span><span className="ml-1 text-[14px] text-white/50">KB</span></div>
      </div>
      <ul className="mt-5 grid w-full gap-2 text-[13px] text-white/60">
        {[[Zap, "Core script, gzipped"], [Code2, "+ about 3 KB per tool, only where used"], [Gauge, "Build fails above the budget"]].map(([Icon, t]) => {
          const I = Icon as typeof Zap;
          return <li key={t as string} className="flex items-center gap-2"><I className="size-4 text-cyan-300" aria-hidden />{t as string}</li>;
        })}
      </ul>
    </div>
  );
}

export function Bento() {
  return (
    <section id="studio" aria-label="The studio" className="relative bg-canvas pb-24 pt-20">
      <div aria-hidden className="dots-dark pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_50%_at_50%_0%,#000,transparent)]" />
      <div className="wrap relative">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-4 py-1.5 text-[13px] font-semibold text-brand ring-1 ring-brand-tint"><LogoMark className="size-4" />The studio</span>
          <h2 className="mt-6 text-[clamp(2.25rem,5vw,4.25rem)] font-extrabold leading-[1.02] tracking-[-0.03em]"><span className="text-ink/40">Everything you need,</span> in one place</h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] text-ink-2">Formats, rules, catalog, approvals, automation and measurement, built to work together instead of fighting over the page.</p>
        </Reveal>
        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          <Card hue="magenta" title="Six campaign formats" body="Popups, slide-ins, bars, toasts, upsells and a notification feed, all from one engine."><FormatShelf /></Card>
          <Card hue="blue" delay={100} title="Rules that read like English" body="Page, device, cart and visitor rules, plus triggers and caps, summarised in plain words."><RulePipeline /></Card>
          <Card hue="amber" delay={200} title="Catalog aware" body="Products, prices and stock come from your store. Unknown stock is never recommended."><CatalogCards /></Card>
          <Card hue="emerald" title="Approve, then publish" body="Every publish is an immutable version you approved. Roll back in one click."><PublishDemo /></Card>
          <Card hue="amber" delay={100} className="lg:col-span-2" title="Automate the follow-up" body="Subscribers flow to your email tool, alerts go out once, purchases are attributed, and the kill switch is always one tap away."><ActionRows /></Card>
          <Card hue="violet" className="lg:col-span-2" title="Measure what a campaign caused" body="Holdout experiments keep a share of visitors from seeing a campaign, so lift is estimated, not assumed."><HoldoutDemo /></Card>
          <Card hue="cyan" delay={100} title="Light on your storefront" body="A tiny script that runs locally, with no AI call on a shopper's page view."><SpeedGauge /></Card>
        </div>
      </div>
    </section>
  );
}
