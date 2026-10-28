import type { CSSProperties } from "react";
import { Code2, FileSpreadsheet, Inbox, Mail, RefreshCw, ShieldCheck, ShoppingBag, ShoppingCart, Store, Boxes, type LucideIcon } from "lucide-react";
import { LogoMark } from "../logo";
import { Reveal } from "./fx";

/**
 * Integrations hub. Only integrations the product actually has are shown, by name with our own icons
 * (no third-party logos). Left: where catalog and context come from. Right: where subscribers and events go.
 */
type Node = { name: string; note: string; icon: LucideIcon; x: number; y: number; tint: string };
const W = 1000, H = 620, C = { x: 500, y: 330 }, T = 116;

const IN: Node[] = [
  { name: "Shopify", note: "Products, orders, privacy webhooks", icon: ShoppingBag, x: 110, y: 130, tint: "#5fd99a" },
  { name: "WooCommerce", note: "Live catalog sync", icon: Store, x: 290, y: 90, tint: "#a78bfa" },
  { name: "BigCommerce", note: "Live catalog sync", icon: Boxes, x: 110, y: 330, tint: "#8fb0ff" },
  { name: "Magento", note: "Product import", icon: Store, x: 290, y: 520, tint: "#fb923c" },
  { name: "Any website", note: "JavaScript API", icon: Code2, x: 110, y: 530, tint: "#22d3ee" },
];
const OUT: Node[] = [
  { name: "Klaviyo", note: "Confirmed subscribers", icon: Inbox, x: 710, y: 90, tint: "#f472b6" },
  { name: "Mailchimp", note: "Confirmed subscribers", icon: Mail, x: 890, y: 130, tint: "#facc15" },
  { name: "CSV & JSON", note: "Import and export", icon: FileSpreadsheet, x: 890, y: 330, tint: "#5fd99a" },
  { name: "Consent signal", note: "Nothing recorded without it", icon: ShieldCheck, x: 710, y: 520, tint: "#8fb0ff" },
  { name: "Purchases", note: "7-day click attribution", icon: ShoppingCart, x: 890, y: 530, tint: "#fb923c" },
];

const path = (n: Node) => {
  const sx = n.x + (n.x < C.x ? T / 2 : -T / 2), ex = C.x + (n.x < C.x ? -70 : 70), mx = (sx + ex) / 2;
  return `M${sx} ${n.y} C${mx} ${n.y}, ${mx} ${C.y}, ${ex} ${C.y}`;
};
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function Tile({ n, i }: { n: Node; i: number }) {
  const Icon = n.icon;
  return (
    <div className="hub-tile group absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pct(n.x, W), top: pct(n.y, H), width: pct(T, W), "--d": `${i * 70}ms` } as CSSProperties}>
      <div className="aspect-square rounded-[22%] bg-white/[0.03] p-[7%] ring-1 ring-white/10 backdrop-blur transition-transform duration-500 [transition-timing-function:var(--ease-out)] group-hover:-translate-y-1.5 group-hover:scale-105">
        <div className="relative grid size-full place-items-center overflow-hidden rounded-[18%] bg-[#12141c] ring-1 ring-white/10" style={{ boxShadow: `inset 0 0 40px -10px ${n.tint}55, 0 20px 40px -20px ${n.tint}80` }}>
          <Icon className="size-[38%]" style={{ color: n.tint }} aria-hidden />
        </div>
      </div>
      <p className="mt-2 whitespace-nowrap text-center text-[clamp(10px,1.1vw,13px)] font-semibold text-white">{n.name}</p>
      <p className="whitespace-nowrap text-center text-[clamp(9px,0.9vw,11px)] text-white/40 opacity-0 transition-opacity group-hover:opacity-100">{n.note}</p>
    </div>
  );
}

export function IntegrationsHub() {
  const all = [...IN, ...OUT];
  return (
    <section id="integrations" aria-label="Integrations" className="relative overflow-hidden bg-canvas pb-24 pt-20">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[40%] h-[60vw] w-[90vw] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(35,80,255,.28),transparent)]" />
      <div className="wrap relative">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="inline-flex rounded-full bg-brand-soft px-4 py-1.5 text-[13px] font-semibold text-brand ring-1 ring-brand-tint">Integrations</span>
          <h2 className="mt-6 text-[clamp(2.25rem,5vw,4.25rem)] font-extrabold leading-[1.02] tracking-[-0.03em]"><span className="text-white/45">Fits the stack</span> you already run</h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-2">Your catalog and page context flow in from your store. Confirmed subscribers, consented events and attributed purchases flow out to the tools you use. No developer queue, no second tag.</p>
        </Reveal>

        {/* Hub (tablet and up) */}
        <div className="relative mx-auto mt-14 hidden max-w-6xl md:block" style={{ aspectRatio: `${W} / ${H}` }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden>
            <defs>
              <linearGradient id="hub-in" x1="0" x2="1"><stop offset="0" stopColor="#2350ff" stopOpacity=".1" /><stop offset="1" stopColor="#6f8fff" stopOpacity=".9" /></linearGradient>
              <linearGradient id="hub-out" x1="0" x2="1"><stop offset="0" stopColor="#6f8fff" stopOpacity=".9" /><stop offset="1" stopColor="#2350ff" stopOpacity=".1" /></linearGradient>
              <filter id="hub-glow"><feGaussianBlur stdDeviation="3" /></filter>
            </defs>
            <rect x={C.x - 230} y={C.y - 200} width="460" height="400" rx="28" fill="none" stroke="rgba(255,255,255,.05)" />
            <rect x={C.x - 150} y={C.y - 130} width="300" height="260" rx="24" fill="none" stroke="rgba(255,255,255,.06)" />
            {all.map((n, i) => {
              const d = path(n), inbound = n.x < C.x;
              return (
                <g key={n.name}>
                  <path d={d} fill="none" stroke={`url(#${inbound ? "hub-in" : "hub-out"})`} strokeWidth="1.5" />
                  <path d={d} fill="none" stroke="#8fb0ff" strokeWidth="1.5" strokeDasharray="6 14" className="hub-flow" style={{ animationDirection: inbound ? "normal" : "reverse" }} opacity=".5" />
                  <circle r="4" fill="#cfdcff" filter="url(#hub-glow)">
                    <animateMotion dur={`${2.6 + (i % 3) * 0.5}s`} begin={`${i * 0.35}s`} repeatCount="indefinite" path={d} keyPoints={inbound ? "0;1" : "1;0"} keyTimes="0;1" calcMode="linear" />
                  </circle>
                </g>
              );
            })}
          </svg>
          {all.map((n, i) => <Tile key={n.name} n={n} i={i} />)}

          {/* centre */}
          <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pct(C.x, W), top: pct(C.y, H), width: pct(150, W) }}>
            <div className="hub-core relative aspect-square">
              <span aria-hidden className="hub-pulse absolute inset-0 rounded-[26%] ring-2 ring-brand/50" />
              <span aria-hidden className="hub-pulse absolute inset-0 rounded-[26%] ring-2 ring-brand/40 [animation-delay:1.2s]" />
              <div className="relative grid size-full place-items-center rounded-[26%] bg-[linear-gradient(160deg,#2f5bff,#1636b8)] shadow-[0_0_80px_-10px_rgba(35,80,255,.9),inset_0_1px_0_rgba(255,255,255,.3)]">
                <LogoMark className="size-[52%] [filter:brightness(1.6)_saturate(.6)]" />
              </div>
            </div>
          </div>
          {[C.x - 110, C.x + 110].map((x) => (
            <span key={x} aria-hidden className="absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#12141c] ring-1 ring-white/15" style={{ left: pct(x, W), top: pct(C.y, H), width: pct(44, W), aspectRatio: "1" }}>
              <RefreshCw className="size-[45%] animate-[spin_6s_linear_infinite] text-white/70" />
            </span>
          ))}
          <p className="absolute left-[4%] top-[-2%] text-[12px] font-semibold uppercase tracking-wider text-white/35">Catalog &amp; context in</p>
          <p className="absolute right-[4%] top-[-2%] text-[12px] font-semibold uppercase tracking-wider text-white/35">Subscribers &amp; events out</p>
        </div>

        {/* Phones: a plain list */}
        <ul className="mt-10 grid grid-cols-2 gap-3 md:hidden">
          {all.map((n) => { const Icon = n.icon; return (
            <li key={n.name} className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-white/10">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#12141c] ring-1 ring-white/10"><Icon className="size-5" style={{ color: n.tint }} aria-hidden /></span>
              <span className="min-w-0"><span className="block truncate text-[14px] font-semibold">{n.name}</span><span className="block truncate text-[11.5px] text-ink-3">{n.note}</span></span>
            </li>
          ); })}
        </ul>
        <p className="mx-auto mt-10 max-w-2xl text-center text-[12px] text-ink-3">Platform and tool names are trademarks of their owners and are shown only to describe compatibility. No affiliation or endorsement is implied. Shopify&apos;s native install flow is in development; today it connects with a script tag or theme app embed.</p>
      </div>
    </section>
  );
}
