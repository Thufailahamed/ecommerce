"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Check, Mail, ShieldCheck, Sparkles, Truck } from "lucide-react";
import { Photo, type PhotoKey } from "./art";

const WORDS = ["popup", "upsell", "email signup", "slide-in", "restock alert", "toast"];
const GOALS = [
  "Grow my email list without discounting",
  "Sell more trail shoes to new visitors",
  "Nudge carts over $75 to free shipping",
  "Tell regulars about the spring launch",
];
const INDUSTRIES: [string, PhotoKey][] = [["Beauty", "p-serum-apply"], ["Fashion", "p-fashion"], ["Home", "p-chair-blue"], ["Health", "p-capsules"], ["Pets", "p-dog"], ["Tech", "p-headphones"], ["Outdoor", "p-hikers"], ["Accessories", "p-watch"]];

/** Cycles through `items` with a typewriter effect: types, holds, deletes, moves on. Stops once `paused`. */
function useTypewriter(items: string[], paused: boolean) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (paused) return;
    let i = 0, n = 0, dir = 1, t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = items[i]!;
      n += dir;
      setText(s.slice(0, n));
      if (dir > 0 && n === s.length) { dir = -1; t = setTimeout(tick, 1800); return; }
      if (dir < 0 && n === 0) { dir = 1; i = (i + 1) % items.length; }
      t = setTimeout(tick, dir > 0 ? 45 : 22);
    };
    t = setTimeout(tick, 1900);
    return () => clearTimeout(t);
  }, [items, paused]);
  return text;
}

export function Hero() {
  const [word, setWord] = useState(0);
  const [typed, setTyped] = useState<string | null>(null);
  const auto = useTypewriter(GOALS, typed !== null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setWord((w) => (w + 1) % WORDS.length), 2200);
    return () => clearInterval(t);
  }, []);

  // Pointer parallax: each layer moves by its own depth, the whole collage tilts a little.
  useEffect(() => {
    const el = stage.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--mx", (e.clientX / innerWidth - 0.5).toFixed(3));
        el.style.setProperty("--my", (e.clientY / innerHeight - 0.5).toFixed(3));
      });
    };
    addEventListener("pointermove", onMove);
    return () => { removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <section aria-label="Introduction" className="relative isolate overflow-hidden bg-canvas pt-28 md:pt-32">
      {/* aurora + grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="aurora aurora-1" /><div className="aurora aurora-2" /><div className="aurora aurora-3" />
        <div className="grid-lines absolute inset-0 [mask-image:radial-gradient(80%_70%_at_50%_20%,#000_20%,transparent_75%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-canvas to-transparent" />
      </div>

      <div className="wrap grid items-center gap-14 pb-16 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-24">
        <div className="relative z-10 text-center lg:text-left">
          <p className="hero-in pill mx-auto !bg-white/[0.06] ring-1 ring-white/10 backdrop-blur lg:mx-0" style={{ "--d": "1.3s" } as CSSProperties}>
            <span className="rounded-full bg-brand-solid px-2 py-0.5 text-[11px] font-bold text-white">New</span>AI campaign studio for any online store
          </p>
          <h1 className="display mt-6 text-[clamp(2.5rem,6.4vw,5.75rem)] leading-[0.98]">
            <Line d={1.4}>Say the goal.</Line>
            <Line d={1.5}>
              Get the{" "}
              <span className="relative inline-grid justify-items-center overflow-hidden align-bottom lg:justify-items-start">
                {WORDS.map((w, i) => {
                  const prev = (word - 1 + WORDS.length) % WORDS.length;
                  const pos = i === word ? 0 : i === prev ? -110 : 110;
                  return (
                    <span key={w} aria-hidden={i !== word} className="text-grad col-start-1 row-start-1 whitespace-nowrap"
                      style={{ transform: `translateY(${pos}%)`, opacity: i === word ? 1 : 0, transition: i === word || i === prev ? "transform .8s var(--ease-out), opacity .5s ease" : "none" }}>{w}</span>
                  );
                })}
              </span>
            </Line>
            <Line d={1.6}>Approve it.</Line>
          </h1>
          <p className="hero-in mx-auto mt-7 max-w-xl text-[16px] leading-relaxed text-ink-2 md:text-[17px] lg:mx-0" style={{ "--d": "1.75s" } as CSSProperties}>
            Describe what you want in plain English. We draft on-site campaigns from your real catalog, check them, preview them on your store, and put them live only when you approve.
          </p>

          {/* Goal prompt */}
          <form action="/signup" method="get" className="hero-in group relative mx-auto mt-8 max-w-xl lg:mx-0" style={{ "--d": "1.9s" } as CSSProperties}>
            <div aria-hidden className="absolute -inset-px rounded-[1.4rem] bg-[conic-gradient(from_var(--ang),#2350ff,#8fb0ff,#1636b8,#2350ff)] opacity-70 blur-[2px] [animation:spin-ang_6s_linear_infinite]" />
            <div className="relative flex items-center gap-2 rounded-[1.35rem] bg-[#0b0d14] p-2 pl-4">
              <Sparkles className="size-5 shrink-0 text-brand" aria-hidden />
              <label htmlFor="hero-goal" className="sr-only">Describe a goal</label>
              <input id="hero-goal" name="goal" autoComplete="off" value={typed ?? auto} onChange={(e) => setTyped(e.target.value)} onFocus={() => setTyped((t) => t ?? "")}
                placeholder="Describe a goal…" className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-white outline-none placeholder:text-white/35" />
              <button type="submit" className="btn btn-primary !h-11 shrink-0 !px-5 text-[14px]">Draft it <ArrowRight className="size-4" aria-hidden /></button>
            </div>
          </form>

          <ul className="hero-in mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-ink-2 lg:justify-start" style={{ "--d": "2s" } as CSSProperties}>
            {["Free plan available", "Shopify, WooCommerce & more", "Nothing goes live without you"].map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="size-3.5 text-brand" strokeWidth={3} aria-hidden />{t}</li>)}
          </ul>
        </div>

        {/* Collage */}
        <div ref={stage} aria-hidden className="relative mx-auto aspect-[1/1.02] w-full max-w-[620px] [perspective:1400px]" style={{ "--mx": 0, "--my": 0 } as CSSProperties}>
          <div className="absolute inset-0 transition-transform duration-500 ease-out [transform-style:preserve-3d]" style={{ transform: "rotateY(calc(var(--mx) * 8deg)) rotateX(calc(var(--my) * -8deg))" }}>
            <Layer depth={14} d={1.45} className="left-[16%] top-[6%] h-[64%] w-[52%]"><PhotoCard k="p-shopper" /></Layer>
            <Layer depth={26} d={1.6} className="right-0 top-0 h-[36%] w-[30%]"><PhotoCard k="p-chair-blue" /></Layer>
            <Layer depth={22} d={1.7} className="right-[1%] top-[40%] h-[42%] w-[34%]"><PhotoCard k="p-serum-apply" /></Layer>
            <Layer depth={32} d={1.8} className="bottom-[3%] left-0 h-[30%] w-[38%]"><PhotoCard k="p-sneaker" /></Layer>

            {/* campaign UI on top of the photos */}
            <Layer depth={40} d={2.0} className="left-[28%] top-[50%] w-[44%]">
              <div className="rounded-2xl bg-white p-4 text-[#0a0c14] shadow-[0_30px_60px_-20px_rgba(0,0,0,.7)]">
                <p className="font-display text-[clamp(11px,1.5vw,15px)] font-bold uppercase leading-tight">First access to new drops</p>
                <p className="mt-1 text-[clamp(9px,1vw,11px)] text-black/55">Join the list. Unsubscribe any time.</p>
                <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-black/15 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] text-black/40"><Mail className="size-3" />you@email.com</div>
                <span className="mt-2 block rounded-full bg-[#2350ff] py-1.5 text-center text-[clamp(9px,1vw,11px)] font-semibold text-white">Subscribe</span>
              </div>
            </Layer>
            <Layer depth={48} d={2.15} className="-left-[2%] top-[18%]"><Chip icon={<ShieldCheck className="size-4" />} k="Policy checks" v="4 of 4 passed" /></Layer>
            <Layer depth={52} d={2.3} className="right-[6%] top-[33%]"><Chip icon={<Check className="size-4" strokeWidth={3} />} k="Approved" v="v3 is live" /></Layer>
            <Layer depth={44} d={2.45} className="bottom-[0%] right-[4%] w-[52%]">
              <div className="flex items-center gap-3 rounded-2xl bg-[#0b0d14]/95 p-3 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#2350ff]"><Truck className="size-4" /></span>
                <span className="min-w-0"><span className="block truncate text-[12px] font-semibold">You are $12 from free shipping</span><span className="block text-[11px] text-white/50">Announcement bar · cart over $40</span></span>
              </div>
            </Layer>
          </div>
        </div>
      </div>

      {/* industry photo strip */}
      <div className="relative border-t border-white/10 bg-canvas/60 py-5 backdrop-blur">
        <div className="marquee-pause overflow-hidden">
          <div className="marquee" style={{ "--marquee-dur": "38s" } as CSSProperties}>
            {[0, 1].map((k) => (
              <div key={k} className="flex shrink-0 gap-3 pr-3" aria-hidden={k === 1}>
                {INDUSTRIES.map(([label, img]) => (
                  <a key={label} href="#use-cases" tabIndex={k ? -1 : 0} className="group flex items-center gap-3 rounded-full bg-surface py-1.5 pl-1.5 pr-5 ring-1 ring-white/10 transition-colors hover:bg-brand-solid">
                    <span className="size-9 overflow-hidden rounded-full"><Photo k={img} w={120} className="size-full transition-transform duration-500 group-hover:scale-110" /></span>
                    <span className="text-[14px] font-semibold">{label}</span>
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Line({ children, d }: { children: ReactNode; d: number }) {
  return <span className="block overflow-hidden pb-[0.06em]"><span className="hero-line block" style={{ "--d": `${d}s` } as CSSProperties}>{children}</span></span>;
}

function Layer({ children, depth, d, className }: { children: ReactNode; depth: number; d: number; className: string }) {
  return (
    <div className={`absolute ${className}`} style={{ transform: `translate3d(calc(var(--mx) * ${-depth}px), calc(var(--my) * ${-depth}px), ${depth}px)` }}>
      <div className="hero-pop size-full" style={{ "--d": `${d}s` } as CSSProperties}>{children}</div>
    </div>
  );
}

function PhotoCard({ k }: { k: PhotoKey }) {
  return <div className="size-full overflow-hidden rounded-[1.5rem] shadow-[0_30px_60px_-24px_rgba(0,0,0,.8)] ring-1 ring-white/10"><Photo k={k} w={700} eager className="size-full" /></div>;
}

function Chip({ icon, k, v }: { icon: ReactNode; k: string; v: string }) {
  return (
    <div className="float flex items-center gap-2.5 rounded-2xl bg-[#0b0d14]/90 py-2 pl-2 pr-4 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
      <span className="grid size-8 place-items-center rounded-xl bg-[#2350ff]">{icon}</span>
      <span><span className="block text-[10.5px] text-white/50">{k}</span><span className="block text-[12.5px] font-semibold">{v}</span></span>
    </div>
  );
}
