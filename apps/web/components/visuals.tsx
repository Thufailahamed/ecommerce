"use client";
import type { ReactNode } from "react";
import { FeedMock, Photo, PopupMock, STORES, StoreMock, ToastMock, UpsellMock, type StoreName } from "@/components/marketing/art";
import { Scaled } from "@/components/marketing/fx";
import { int } from "@/lib/use-api";
import type { Tool } from "@convertflow/contracts";

/*
 * Visuals for the dashboard. Tool mock-ups show what a format looks like on a storefront; they are not the
 * merchant's content. Product photos are stock illustrations and are only used where they are labelled as examples.
 */

/** Which sample storefront each tool's preview is shown on, so the tiles look varied but stay consistent per tool. */
const STORE_FOR: Record<Tool, StoreName> = {
  toast: "Good Boy Co.",
  feed: "Northpeak",
  upsell: "Field & Thread",
  email: "Lumen Skin",
  sms: "Signal Audio",
};

function mockFor(tool: Tool): ReactNode {
  switch (tool) {
    case "toast": return <ToastMock text="Free shipping over $75" sub="Add a little more to qualify" compact />;
    case "feed": return <FeedMock compact />;
    case "upsell": return <UpsellMock items={["p-sneaker", "p-watch"]} compact />;
    case "email": return <PopupMock title="Join the list" body="Be first to hear about new drops." cta="Subscribe" email compact />;
    case "sms": return <PopupMock title="Text me the drop" body="Opt in for early access." cta="Subscribe" compact />;
  }
}

/** A storefront preview of one tool's format. Scales to whatever width its container gives it. */
export function ToolVisual({ tool, className = "" }: { tool: Tool; className?: string }) {
  const store = STORE_FOR[tool];
  return (
    <div className={`overflow-hidden rounded-2xl ring-1 ring-line ${className}`}>
      <Scaled width={420} height={260}>
        <StoreMock name={store} {...STORES[store]} compact>{mockFor(tool)}</StoreMock>
      </Scaled>
    </div>
  );
}

/** Row of tool previews, used where a page is empty and should still show what the tools look like. */
export function ToolGallery({ tools }: { tools: Tool[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {tools.map((t, i) => (
        <div key={t} className="card-hover w-40 rounded-2xl bg-surface p-1.5 ring-1 ring-line sm:w-44" style={{ animation: `rise .7s var(--ease-out) ${i * 90}ms both` }}>
          <ToolVisual tool={t} />
        </div>
      ))}
    </div>
  );
}

/** Square-ish photo tile for empty states. Labelled as an example, never as the merchant's catalog. */
export function PhotoTile({ k, alt, className = "" }: { k: Parameters<typeof Photo>[0]["k"]; alt: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl ring-1 ring-line ${className}`}>
      <Photo k={k} w={800} alt={alt} className="size-full" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-canvas/80 via-transparent to-transparent" />
    </div>
  );
}

/** Horizontal funnel from real totals. Bars grow in sequence on first paint. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="grid gap-3.5" aria-label="Funnel">
      {steps.map((s, i) => {
        const width = s.value > 0 ? Math.max(3, (s.value / max) * 100) : 0;
        return (
          <li key={s.label} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-3 text-sm sm:grid-cols-[8rem_1fr_6rem]">
            <span className="truncate text-ink-2">{s.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-ink/[0.05]">
              <div className="h-full origin-left rounded-full bg-gradient-to-r from-brand-solid to-brand-glow shadow-[0_0_14px_rgba(35,80,255,0.7)]" style={{ width: `${width}%`, animation: `grow-x .9s var(--ease-out) ${i * 120}ms both` }} />
            </div>
            <span className="num text-right font-medium">{int(s.value)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Circular progress with the count in the middle. The arc draws in on first paint. */
export function ProgressRing({ value, max, size = 76 }: { value: number; max: number; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? value / max : 0;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${value} of ${max} setup steps complete`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8fb0ff" /><stop offset="1" stopColor="#2350ff" /></linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ring-grad)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 1s var(--ease-out)", filter: "drop-shadow(0 0 6px rgba(35,80,255,0.8))" }} />
      </svg>
      <span className="num absolute text-sm font-semibold">{value}<span className="text-ink-3">/{max}</span></span>
    </div>
  );
}

const HUES = ["#2350ff", "#5b3bff", "#19b6ff", "#d63384", "#10b981", "#f59e0b"];

/** Deterministic colored initials for a person, so the same address always gets the same avatar. */
export function Avatar({ seed }: { seed: string }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length];
  return (
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold uppercase text-white ring-1 ring-line" style={{ background: `linear-gradient(135deg, ${hue}, #0a0c14)` }}>
      {seed.slice(0, 2)}
    </span>
  );
}
