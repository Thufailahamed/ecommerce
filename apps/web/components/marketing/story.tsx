"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BarChart3, Check, Eye, MousePointerClick, ShieldCheck, Sparkles, Target, Timer, Users } from "lucide-react";
import { LogoMark } from "../logo";
import { BarMock, PopupMock, SlideInMock, StoreMock, type Product } from "./art";
import { Scaled } from "./fx";

const CHAPTERS = [
  { id: "describe", word: "Describe", label: "Goal", copy: "Tell the AI what you want in plain English. It reads your real catalog." },
  { id: "validate", word: "Validate", label: "Checks", copy: "Every draft is schema- and policy-checked on our servers before you see it." },
  { id: "preview", word: "Preview", label: "Preview", copy: "See the exact campaign on your store, rendered by the storefront code." },
  { id: "approve", word: "Approve", label: "Approval", copy: "Nothing goes live until you approve the exact version. Roll back any time." },
  { id: "measure", word: "Measure", label: "Analytics", copy: "Observed, attributed and incremental results, kept clearly apart." },
] as const;

/** Callout cards that float beside the laptop for each chapter (desktop only). */
const CALLOUTS: [typeof Sparkles, string, string][][] = [
  [[Sparkles, "Goal", "Sell more trail shoes"], [Target, "Constraint", "No discount"]],
  [[ShieldCheck, "Checks", "4 of 4 passed"], [Check, "Links", "All on your store"]],
  [[Timer, "Trigger", "After 8 seconds"], [Users, "Audience", "New visitors"]],
  [[Eye, "Version", "v3 ready"], [Check, "Approval", "Required"]],
  [[MousePointerClick, "Clicks", "Tracked with consent"], [BarChart3, "Lift", "Holdout experiments"]],
];

const STORE: { hero: Product; products: Product[] } = { hero: "p-hikers", products: ["p-sneaker", "p-backpack", "p-watch", "p-sneaker-white", "p-headphones", "p-watch-brown", "p-fashion-blue", "p-dog-beach"] };

const INTRO = 0.16;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/**
 * Scroll-scrubbed intro: a sticky stage with a laptop whose lid opens as you scroll, then steps through five
 * chapters on a storefront, from describing a goal to measuring the result. A stepper at the bottom tracks progress.
 */
export function ScrollStory() {
  const track = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [chapter, setChapter] = useState(-1);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = track.current, st = stage.current;
      if (!el || !st) return;
      const r = el.getBoundingClientRect();
      const p = clamp(-r.top / (r.height - innerHeight));
      const intro = clamp(p / INTRO);
      const c = ((p - INTRO) / (1 - INTRO)) * CHAPTERS.length;
      const idx = p < INTRO ? -1 : Math.min(CHAPTERS.length - 1, Math.floor(c));
      st.style.setProperty("--intro", intro.toFixed(4));
      st.style.setProperty("--p", p.toFixed(4));
      setChapter((prev) => (prev === idx ? prev : idx));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => { removeEventListener("scroll", onScroll); removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, []);

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const span = el.offsetHeight - innerHeight;
    const p = i >= CHAPTERS.length ? 1 : INTRO + ((i + 0.5) / CHAPTERS.length) * (1 - INTRO);
    scrollTo({ top: el.offsetTop + span * p + (i >= CHAPTERS.length ? 2 : 0), behavior: "smooth" });
  };

  return (
    <section ref={track} aria-label="How a campaign gets made" className="relative h-[600vh] bg-canvas">
      <div ref={stage} className="sticky top-0 h-dvh overflow-hidden" style={{ "--intro": 0, "--p": 0 } as CSSProperties}>
        <div aria-hidden className="dots absolute inset-0 [mask-image:radial-gradient(70%_60%_at_50%_40%,#000,transparent)]" />
        <div aria-hidden className="glow-orb left-1/2 top-[30%] size-[70vmin] -translate-x-1/2" style={{ opacity: "calc(0.5 + var(--intro) * 0.5)" }} />

        {/* Section intro, shown while the lid opens */}
        <div className="absolute inset-x-0 top-[6.5rem] z-20 px-4 text-center md:top-28" style={{ opacity: "calc(1 - var(--intro) * 1.8)", transform: "translateY(calc(var(--intro) * -140px))" }}>
          <p className="eyebrow justify-center">How it works</p>
          <h2 className="display mx-auto mt-4 max-w-5xl text-[clamp(2rem,5.4vw,5rem)] leading-[1.02]">From one sentence to a <span className="text-grad">live campaign</span></h2>
          <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-ink-2">Keep scrolling to watch a goal become a validated, approved campaign on a real storefront.</p>
        </div>

        {/* Chapter heading */}
        <div className="absolute inset-x-0 top-[5.5rem] z-20 px-4 text-center md:top-24" aria-live="polite">
          {CHAPTERS.map((c, i) => (
            <div key={c.id} className="absolute inset-x-0 transition-all duration-700 [transition-timing-function:var(--ease-out)]" style={{ opacity: chapter === i ? 1 : 0, transform: `translateY(${chapter === i ? 0 : chapter > i ? -30 : 30}px)` }} aria-hidden={chapter !== i}>
              <p className="num text-[12px] text-brand">{String(i + 1).padStart(2, "0")} / {String(CHAPTERS.length).padStart(2, "0")}</p>
              <h2 className="display mt-2 text-[clamp(2.25rem,6vw,5.5rem)] text-grad">{c.word}</h2>
              <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-2 md:text-[15px]">{c.copy}</p>
            </div>
          ))}
        </div>

        {/* Laptop */}
        <div className="absolute inset-x-0 bottom-20 top-[15rem] grid place-items-center px-3 [perspective:1800px] md:top-[16.5rem]">
          <div className="relative w-[min(94vw,1000px,calc((100dvh-22rem)*1.5))]" style={{ transform: "translateY(calc((1 - var(--intro)) * 22dvh)) scale(calc(0.86 + var(--intro) * 0.14))" }}>
            {/* lid */}
            <div className="relative origin-bottom rounded-t-[1.1rem] bg-[linear-gradient(180deg,#2a2e3b,#15171f)] p-[1.4%] pb-[2.6%] shadow-[0_40px_120px_-30px_rgba(35,80,255,.6),inset_0_0_0_1px_rgba(255,255,255,.14)]"
              style={{ transform: "rotateX(calc((1 - var(--intro)) * -62deg))" }}>
              <div className="absolute left-1/2 top-[0.6%] size-1.5 -translate-x-1/2 rounded-full bg-black/80 ring-1 ring-white/10" />
              <div className="overflow-hidden rounded-[0.35rem] bg-white">
                <Browser>
                  <Scaled width={800} height={470}>
                    <StoreMock name="Northpeak" hero={STORE.hero} products={STORE.products} tagline="Trail collection">
                      <Screen i={chapter} />
                    </StoreMock>
                  </Scaled>
                </Browser>
              </div>
            </div>
            {/* base */}
            <div className="relative mx-[-4%] h-[clamp(10px,1.8vw,18px)] rounded-b-[1.2rem] bg-[linear-gradient(180deg,#3a3f4f,#1d2029)] shadow-[0_30px_60px_-20px_rgba(0,0,0,.9)]">
              <div className="absolute left-1/2 top-0 h-[45%] w-[14%] -translate-x-1/2 rounded-b-lg bg-black/30" />
            </div>

            {/* floating callouts */}
            {chapter >= 0 && CALLOUTS[chapter]!.map(([Icon, k, v], j) => (
              <div key={`${chapter}-${j}`} className={`pop-in absolute hidden items-center gap-3 rounded-2xl bg-surface/90 p-3 pr-5 shadow-[var(--shadow-lift)] ring-1 ring-white/10 backdrop-blur lg:flex ${j === 0 ? "-left-24 top-[18%]" : "-right-24 top-[58%]"}`} style={{ animationDelay: `${200 + j * 150}ms` }}>
                <span className="grid size-9 place-items-center rounded-xl bg-brand-solid text-white"><Icon className="size-4" aria-hidden /></span>
                <span><span className="block text-[11px] text-ink-3">{k}</span><span className="block text-[13px] font-semibold">{v}</span></span>
              </div>
            ))}
          </div>
        </div>

        {/* Stepper */}
        <nav aria-label="Intro chapters" className="absolute inset-x-0 bottom-5 z-30 flex justify-center gap-2 px-3">
          <ol className="relative flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-surface/90 p-1 ring-1 ring-white/10 backdrop-blur [scrollbar-width:none]">
            {CHAPTERS.map((c, i) => (
              <li key={c.id}>
                <button onClick={() => go(i)} aria-current={chapter === i ? "step" : undefined}
                  className={`rounded-full px-3 py-2 text-[13px] font-medium transition-colors md:px-4 ${chapter === i ? "bg-brand-solid text-white" : "text-white/55 hover:text-white"}`}>{c.label}</button>
              </li>
            ))}
          </ol>
          <button onClick={() => go(CHAPTERS.length)} className="hidden shrink-0 rounded-full bg-surface/90 px-5 text-[13px] font-semibold text-white ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white hover:text-black sm:block">Skip the intro</button>
        </nav>
        <div aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-brand-solid" style={{ width: "calc(var(--p) * 100%)" }} />
      </div>
    </section>
  );
}

function Browser({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 bg-[#eceef3] px-3 py-[0.6%]">
        <span className="size-2 rounded-full bg-[#ff5f57]" /><span className="size-2 rounded-full bg-[#febc2e]" /><span className="size-2 rounded-full bg-[#28c840]" />
        <span className="num mx-auto truncate rounded-md bg-white px-3 py-0.5 text-[10px] text-black/60">northpeak.store/collections/trail</span>
      </div>
      {children}
    </div>
  );
}

/** Overlay for each chapter on top of the storefront. Keyed so its entrance animation replays. */
function Screen({ i }: { i: number }) {
  if (i < 0) return null;
  const body = [<Studio key="s" mode="goal" />, <Studio key="v" mode="checks" />,
    <PopupMock key="p" title="Find your stride" body="Trail runners built for wet, technical ground. New this week." cta="Shop trail running" product="p-sneaker" />,
    <Approve key="a" />, <Measure key="m" />][i];
  return <div key={i} className="absolute inset-0">{body}</div>;
}

export function Studio({ mode }: { mode: "goal" | "checks" }) {
  const checks = ["Matches the campaign schema", "Links stay on your site", "No promotion you did not authorise", "No stock claim we cannot verify"];
  return (
    <>
      <div className="absolute inset-0 bg-[#0a0c14]/30" />
      <div className="slide-in-r absolute inset-y-0 right-0 flex w-[42%] flex-col bg-[#0b0d14] p-5 text-white">
        <div className="flex items-center gap-2"><LogoMark className="size-5" /><span className="text-[12px] font-semibold">AI studio</span><span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[9px] text-white/60">Draft</span></div>
        {mode === "goal" ? (
          <>
            <div className="ml-auto mt-5 max-w-[88%] rounded-2xl rounded-br-md bg-[#2350ff] p-3 text-[11.5px] leading-snug">Increase sales of trail shoes without discounting every visitor.</div>
            <div className="mt-2 flex flex-wrap justify-end gap-1.5 text-[9.5px]"><span className="rounded-full bg-white/10 px-2 py-0.5">Format: any</span><span className="rounded-full bg-white/10 px-2 py-0.5">No promotion</span></div>
            <div className="mt-4 max-w-[88%] rounded-2xl rounded-bl-md bg-white/5 p-3 text-[11px] leading-snug text-white/80"><span className="blink">Reading 214 products from your catalog</span></div>
            <div className="mt-auto flex items-center gap-2 rounded-full bg-white/5 p-1.5 pl-3 text-[10px] text-white/40">Describe a goal…<span className="ml-auto grid size-6 place-items-center rounded-full bg-[#2350ff]"><Sparkles className="size-3" /></span></div>
          </>
        ) : (
          <>
            <div className="mx-auto mt-6 grid size-16 place-items-center rounded-2xl bg-[#2350ff]/20"><ShieldCheck className="size-8 text-[#8fb0ff]" /></div>
            <p className="mt-3 text-center text-[12.5px] font-semibold">4 of 4 checks passed</p>
            <ul className="mt-4 space-y-2">
              {checks.map((c, k) => (
                <li key={c} className="pop-in flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-[10.5px] text-white/85" style={{ animationDelay: `${150 + k * 130}ms` }}>
                  <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[#2350ff]"><Check className="size-2.5" strokeWidth={4} /></span>{c}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

export function Approve() {
  return (
    <>
      <BarMock text="Free shipping on orders over $75" cta="Shop now" />
      <SlideInMock title="Still deciding? Compare our top 3 trail shoes" cta="Compare" product="p-sneaker-white" />
      <div className="pop-in absolute bottom-3 left-3 flex items-center gap-3 rounded-2xl bg-[#0b0d14] py-2 pl-3 pr-2 text-white shadow-2xl" style={{ animationDelay: "250ms" }}>
        <span className="text-[10.5px]"><span className="num font-semibold">v3</span> <span className="text-white/50">· 3 campaigns · validated</span></span>
        <span className="shine rounded-full bg-[#2350ff] px-3 py-1.5 text-[10.5px] font-semibold">Approve &amp; publish</span>
      </div>
    </>
  );
}

export function Measure() {
  const bars = [30, 46, 38, 58, 52, 70, 64, 82, 76, 92, 86, 96];
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#0a0c14]/50 p-6">
      <div className="pop-in w-full max-w-[78%] rounded-2xl bg-[#0b0d14] p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[12px] font-semibold"><BarChart3 className="size-4 text-[#8fb0ff]" />Trail launch · last 14 days</span><span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] text-white/60">Illustrative</span></div>
        <div className="mt-4 flex h-28 items-end gap-1.5">
          {bars.map((h, k) => <div key={k} className="grow-up flex-1 rounded-t-[3px] bg-[linear-gradient(180deg,#8fb0ff,#2350ff)]" style={{ height: `${h}%`, animationDelay: `${k * 50}ms` }} />)}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[["Observed", "every store order"], ["Attributed", "7-day last click"], ["Incremental", "holdout only"]].map(([t, d]) => (
            <div key={t} className="rounded-xl bg-white/5 p-2.5"><div className="text-[11px] font-semibold">{t}</div><div className="text-[9.5px] text-white/50">{d}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}
