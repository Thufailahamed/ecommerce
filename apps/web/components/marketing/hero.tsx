"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Check, Lock, Sparkles } from "lucide-react";
import { LogoMark } from "../logo";
import { BarMock, Photo, PopupMock, SlideInMock, STORES, StoreMock, ToastMock, UpsellMock, type PhotoKey, type StoreName } from "./art";
import { BlockScene } from "./blocks";
import { Scaled } from "./fx";

/**
 * Each headline word has a matching storefront scene in the stage below: the rotating word and the live preview
 * always show the same campaign, with the goal that produced it in the studio card.
 */
const SCENES: { word: string; goal: string; store: StoreName; overlay: ReactNode }[] = [
  { word: "popup", goal: "Introduce the new cream to first-time visitors", store: "Lumen Skin", overlay: <PopupMock title="Meet the night cream" body="Gentle, fragrance-free, back in stock." cta="Shop the cream" product="p-cream" /> },
  { word: "slide-in", goal: "Help undecided shoppers compare trail shoes", store: "Northpeak", overlay: <SlideInMock title="Compare our top 3" cta="Compare" product="p-sneaker-white" /> },
  { word: "email signup", goal: "Grow my email list without discounting", store: "Lumen Skin", overlay: <PopupMock title="First access to new shades" body="Join for launches and restocks." cta="Sign me up" product="p-serum" email /> },
  { word: "free-ship bar", goal: "Nudge carts over $75 to free shipping", store: "Field & Thread", overlay: <BarMock text="You are $12 from free shipping" cta="Keep shopping" /> },
  { word: "upsell", goal: "Suggest a watch with every jacket", store: "Field & Thread", overlay: <UpsellMock items={["p-watch", "p-watch-brown"]} /> },
  { word: "toast", goal: "Tell regulars about the spring launch", store: "Northpeak", overlay: <ToastMock text="New: spring trail range" sub="Out now, in every size" /> },
];
const GOALS = SCENES.map((x) => x.goal);
const CHECKS = ["Matches the campaign schema", "Links stay on your site", "No promotion you did not authorise", "No stock claim we cannot verify"];
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
  const [scene, setScene] = useState(0);
  const [typed, setTyped] = useState<string | null>(null);
  const auto = useTypewriter(GOALS, typed !== null);
  const stage = useRef<HTMLDivElement>(null);
  const now = SCENES[scene]!;

  useEffect(() => {
    const t = setInterval(() => setScene((w) => (w + 1) % SCENES.length), 3600);
    return () => clearInterval(t);
  }, []);

  // The stage starts tilted back and lies flat as you scroll into it; the pointer adds a little parallax on top.
  useEffect(() => {
    const el = stage.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const set = (k: string, v: number) => el.style.setProperty(k, v.toFixed(3));
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => set("--flat", Math.min(1, scrollY / (innerHeight * 0.55)))); };
    const onMove = (e: PointerEvent) => { set("--mx", e.clientX / innerWidth - 0.5); set("--my", e.clientY / innerHeight - 0.5); };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("pointermove", onMove);
    onScroll();
    return () => { removeEventListener("scroll", onScroll); removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <section aria-label="Introduction" className="relative isolate overflow-hidden bg-canvas pt-28 md:pt-32">
      {/* aurora + grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="aurora aurora-1" /><div className="aurora aurora-2" /><div className="aurora aurora-3" />
        <div className="grid-lines absolute inset-0 [mask-image:radial-gradient(80%_60%_at_50%_10%,#000_20%,transparent_75%)]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-canvas to-transparent" />
      </div>

      <div className="wrap relative z-10 flex flex-col items-center text-center">
        <p className="hero-in pill !bg-white/[0.06] ring-1 ring-white/10 backdrop-blur" style={{ "--d": "1.3s" } as CSSProperties}>
          <span className="rounded-full bg-brand-solid px-2 py-0.5 text-[11px] font-bold text-white">New</span>AI campaign studio for any online store
        </p>
        <h1 className="display mt-6 text-[clamp(2.4rem,7.4vw,6.5rem)] leading-[0.95]">
          <Line d={1.4}>Say the goal.</Line>
          <Line d={1.5}>Approve the</Line>
          {/* All words share one grid cell, so the line is as wide as the longest and never reflows */}
          <Line d={1.6}>
            <span className="relative inline-grid justify-items-center overflow-hidden align-bottom">
              {SCENES.map(({ word }, i) => {
                const prev = (scene - 1 + SCENES.length) % SCENES.length;
                const pos = i === scene ? 0 : i === prev ? -110 : 110;
                return (
                  <span key={word} aria-hidden={i !== scene} className="text-grad col-start-1 row-start-1 whitespace-nowrap"
                    style={{ transform: `translateY(${pos}%)`, opacity: i === scene ? 1 : 0, transition: i === scene || i === prev ? "transform .8s var(--ease-out), opacity .5s ease" : "none" }}>{word}.</span>
                );
              })}
            </span>
          </Line>
        </h1>
        <p className="hero-in mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-2 md:text-[18px]" style={{ "--d": "1.75s" } as CSSProperties}>
          Describe what you want in plain English. We draft on-site campaigns from your real catalog, check them, preview them on your store, and put them live only when you approve.
        </p>

        {/* Goal prompt */}
        <form action="/signup" method="get" className="hero-in group relative mt-8 w-full max-w-2xl" style={{ "--d": "1.9s" } as CSSProperties}>
          <div aria-hidden className="absolute -inset-px rounded-[1.4rem] bg-[conic-gradient(from_var(--ang),#2350ff,#8fb0ff,#1636b8,#2350ff)] opacity-70 blur-[2px] [animation:spin-ang_6s_linear_infinite]" />
          <div className="relative flex items-center gap-2 rounded-[1.35rem] bg-[#0b0d14] p-2 pl-4">
            <Sparkles className="size-5 shrink-0 text-brand" aria-hidden />
            <label htmlFor="hero-goal" className="sr-only">Describe a goal</label>
            <input id="hero-goal" name="goal" autoComplete="off" value={typed ?? auto} onChange={(e) => setTyped(e.target.value)} onFocus={() => setTyped((t) => t ?? "")}
              placeholder="Describe a goal…" className="min-w-0 flex-1 bg-transparent py-3 text-left text-[15px] text-white outline-none placeholder:text-white/35" />
            <button type="submit" className="btn btn-primary !h-12 shrink-0 !px-6 text-[14px]">Draft it <ArrowRight className="size-4" aria-hidden /></button>
          </div>
        </form>
        <ul className="hero-in mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] text-ink-2" style={{ "--d": "2s" } as CSSProperties}>
          {["Free plan available", "Shopify, WooCommerce & more", "Nothing goes live without you"].map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="size-3.5 text-brand" strokeWidth={3} aria-hidden />{t}</li>)}
        </ul>
      </div>

      {/* Stage: the storefront preview of the campaign named in the headline, with the studio and approval around it */}
      <div aria-hidden className="wrap relative mt-14 md:mt-16 [perspective:1600px]">
        <div ref={stage} className="hero-pop relative mx-auto max-w-[1100px] [transform-style:preserve-3d]" style={{ "--d": "2.1s", "--flat": 0, "--mx": 0, "--my": 0 } as CSSProperties}>
          <div className="transition-transform duration-300 ease-out [transform-style:preserve-3d]" style={{ transform: "rotateX(calc((1 - var(--flat)) * 22deg + var(--my) * -4deg)) rotateY(calc(var(--mx) * 5deg)) scale(calc(0.92 + var(--flat) * 0.08))", transformOrigin: "50% 0%" }}>
            <div aria-hidden className="absolute -inset-x-10 -top-10 bottom-10 -z-10 rounded-[3rem] bg-[radial-gradient(60%_60%_at_50%_30%,rgba(35,80,255,.45),transparent_70%)] blur-2xl" />
            {/* browser window */}
            <div className="overflow-hidden rounded-[1.5rem] bg-[#0b0d14] p-1.5 shadow-[0_60px_120px_-40px_rgba(0,0,0,.9)] ring-1 ring-white/15 md:rounded-[1.75rem] md:p-2">
              <div className="flex items-center gap-3 px-3 pb-2 pt-1 md:px-4">
                <span className="flex gap-1.5">{["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />)}</span>
                <span className="mx-auto flex min-w-0 items-center gap-2 rounded-lg bg-white/5 px-3 py-1 text-[11px] text-white/50 md:text-[12px]"><Lock className="size-3" />{now.store.toLowerCase().replace(/[^a-z]+/g, "")}.store</span>
                <span className="hidden items-center gap-1.5 rounded-full bg-brand-solid px-2.5 py-1 text-[11px] font-semibold text-white sm:flex"><span className="size-1.5 animate-pulse rounded-full bg-white" />Live preview</span>
              </div>
              <div className="overflow-hidden rounded-[1.1rem] md:rounded-[1.25rem]">
                <Scaled width={1200} height={600}>
                  <StoreMock key={scene} name={now.store} {...STORES[now.store]}>{now.overlay}</StoreMock>
                </Scaled>
              </div>
            </div>

            {/* studio card: the goal that produced this campaign, and the checks it passed */}
            <div className="absolute -left-4 top-[18%] hidden w-[17.5rem] text-left md:block lg:-left-16 xl:-left-24" style={{ transform: "translateZ(60px)" }}>
              <div className="float-card rounded-2xl bg-[#0b0d14]/95 p-4 text-white shadow-[0_30px_60px_-20px_rgba(0,0,0,.9)] ring-1 ring-white/10 backdrop-blur">
                <p className="flex items-center gap-2 text-[12px] font-semibold"><LogoMark className="size-4" />AI studio<span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">Draft</span></p>
                <p key={`g${scene}`} className="hero-in mt-3 rounded-xl bg-brand-solid px-3 py-2 text-[12.5px] leading-snug" style={{ "--d": "0s" } as CSSProperties}>{now.goal}</p>
                <ul className="mt-3 space-y-1.5">
                  {CHECKS.map((c, i) => (
                    <li key={`${scene}-${c}`} className="hero-in flex items-center gap-2 text-[11.5px] text-white/70" style={{ "--d": `${0.4 + i * 0.25}s` } as CSSProperties}>
                      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-ok/20 text-ok"><Check className="size-2.5" strokeWidth={3.5} /></span>{c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* approval card with a 3D block, on the other side */}
            <div className="absolute -right-4 bottom-[14%] hidden w-[15rem] text-left md:block lg:-right-14 xl:-right-20" style={{ transform: "translateZ(90px)" }}>
              <div className="float-card-b flex items-center gap-3 rounded-2xl bg-white p-3 text-[#0a0c14] shadow-[0_30px_60px_-20px_rgba(0,0,0,.9)]">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-brand-solid"><BlockScene kind="stack" tone="white" size={16} className="absolute inset-0" /></span>
                <span className="min-w-0">
                  <span className="block text-[11px] text-black/50">You approved</span>
                  <span className="block truncate text-[14px] font-bold capitalize">{now.word}, v3</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-brand-solid"><span className="size-1.5 rounded-full bg-ok" />Live on {now.store}</span>
                </span>
              </div>
            </div>
            <div className="absolute -right-6 -top-10 hidden size-28 md:block lg:-right-16" style={{ transform: "translateZ(120px)" }}><BlockScene kind="orbit" tone="blue" size={40} className="size-full !overflow-visible" /></div>
            <div className="absolute -bottom-8 left-[12%] hidden size-24 md:block" style={{ transform: "translateZ(100px)" }}><BlockScene kind="spin" tone="white" size={34} className="size-full !overflow-visible" /></div>
          </div>
        </div>
      </div>

      {/* industry photo strip */}
      <div className="relative mt-16 border-t border-white/10 bg-canvas/60 py-5 backdrop-blur md:mt-24">
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
