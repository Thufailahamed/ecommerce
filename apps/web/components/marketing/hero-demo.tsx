"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { CampaignConfig } from "@convertflow/contracts";
import { describeRuleGroup } from "@convertflow/campaign-engine";
import { renderCampaign } from "@convertflow/storefront-sdk";

const base = {
  schemaVersion: 1, trigger: { type: "delay", seconds: 5 }, frequency: {}, goal: { type: "clicks" },
  style: { background: "#FFFFFF", text: "#000000", accent: "#2350FF", accentText: "#FFFFFF", radius: 16 },
} as const;

/** Parsed at module load: the demo can only ever show configs the real schema accepts. */
const PRESETS = {
  popup: {
    label: "Popup", trigger: "After 8 seconds",
    cfg: CampaignConfig.parse({ ...base, name: "Trail launch", format: "popup", trigger: { type: "delay", seconds: 8 },
      creative: { headline: "Find your stride", body: "Trail runners built for wet, technical ground.", ctaLabel: "Shop trail running", ctaUrl: "/collections/trail" },
      targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["collection"] }, { field: "visitor_type", op: "equals", value: "new" }] } }),
  },
  slide_in: {
    label: "Slide-in", trigger: "At 50% scroll",
    cfg: CampaignConfig.parse({ ...base, name: "Compare", format: "slide_in", trigger: { type: "scroll_depth", percent: 50 },
      style: { ...base.style, placement: "bottom_right" },
      creative: { headline: "Still deciding?", body: "Compare our three most-viewed trail shoes side by side.", ctaLabel: "Compare shoes", ctaUrl: "/pages/compare" },
      targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["product"] }, { field: "pages_viewed", op: "gte", value: 3 }] } }),
  },
  announcement_bar: {
    label: "Announcement bar", trigger: "Immediately",
    cfg: CampaignConfig.parse({ ...base, name: "Shipping bar", format: "announcement_bar", trigger: { type: "immediate" },
      style: { ...base.style, background: "#2350FF", text: "#FFFFFF", accent: "#FFFFFF", accentText: "#2350FF", placement: "top", radius: 6 },
      creative: { headline: "Free shipping on orders over $75", body: "", ctaLabel: "Shop now", ctaUrl: "/collections/all" },
      targeting: { match: "all", conditions: [{ field: "cart_subtotal", op: "gte", value: 40 }] } }),
  },
} as const;
type Key = keyof typeof PRESETS;

export function HeroDemo() {
  const [key, setKey] = useState<Key>("popup");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const frame = useRef<HTMLDivElement>(null);
  const p = PRESETS[key];
  const audience = useMemo(() => describeRuleGroup(p.cfg.targeting), [p]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const h = renderCampaign(document, p.cfg, {}, el);
    return () => h.destroy();
  }, [p, device]);

  return (
    <div className="overflow-hidden rounded-[1.25rem] bg-black text-white" aria-label="Interactive campaign demo">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div role="tablist" aria-label="Campaign format" className="flex gap-1 rounded-full bg-surface p-1">
          {(Object.keys(PRESETS) as Key[]).map((k) => (
            <button key={k} role="tab" aria-selected={key === k} onClick={() => setKey(k)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${key === k ? "bg-brand-solid text-white" : "text-ink-2 hover:text-ink"}`}>
              {PRESETS[k].label}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Device preview">
          <button aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={`rounded-md p-2 ${device === "desktop" ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink"}`}><Monitor className="size-4" /></button>
          <button aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={`rounded-md p-2 ${device === "mobile" ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink"}`}><Smartphone className="size-4" /></button>
        </div>
      </div>

      <div className="bg-[#111] p-4 md:p-6">
        <div className={`mx-auto transition-[max-width] duration-300 ${device === "mobile" ? "max-w-[340px]" : "max-w-full"}`}>
          <div className="flex items-center gap-1.5 rounded-t-xl bg-[#e9e9e9] px-3 py-2">
            <span className="size-2 rounded-full bg-black/20" /><span className="size-2 rounded-full bg-black/20" /><span className="size-2 rounded-full bg-black/20" />
            <span className="num ml-2 truncate text-[11px] text-black/50">yourstore.com/collections/trail</span>
          </div>
          <div ref={frame} style={{ transform: "translateZ(0)", height: device === "mobile" ? 440 : 360 }} className="relative overflow-hidden rounded-b-xl bg-[#f6f6f6]" role="group" aria-label={`Preview of a ${p.label.toLowerCase()} on a store`}>
            <div className="px-5 pb-5 pt-14" aria-hidden>
              <div className="mb-4 flex items-center justify-between"><div className="h-3 w-24 rounded bg-black/80" /><div className="flex gap-3"><div className="h-2.5 w-10 rounded bg-black/15" /><div className="h-2.5 w-10 rounded bg-black/15" /><div className="h-2.5 w-10 rounded bg-black/15" /></div></div>
              <div className="mb-4 h-24 rounded-lg bg-black/10" />
              <div className={`grid gap-3 ${device === "mobile" ? "grid-cols-2" : "grid-cols-3"}`}>
                {[0, 1, 2].slice(0, device === "mobile" ? 2 : 3).map((i) => (
                  <div key={i}><div className="aspect-[4/3] rounded-lg bg-black/10" /><div className="mt-2 h-2.5 w-3/4 rounded bg-black/15" /><div className="mt-1.5 h-2 w-1/3 rounded bg-black/10" /></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line px-4 py-4 text-sm md:grid-cols-[1fr_1fr_2fr]">
        <div><dt className="text-[12px] font-semibold text-white/40">Trigger</dt><dd className="mt-1">{p.trigger}</dd></div>
        <div><dt className="text-[12px] font-semibold text-white/40">Frequency</dt><dd className="mt-1">1 per session</dd></div>
        <div className="col-span-2 md:col-span-1"><dt className="text-[12px] font-semibold text-white/40">Audience</dt><dd className="mt-1">{audience}</dd></div>
      </dl>
    </div>
  );
}
