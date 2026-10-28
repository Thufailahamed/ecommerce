"use client";
import { useEffect, useRef, useState } from "react";
import { CampaignConfig } from "@convertflow/contracts";
import { renderCampaign } from "@convertflow/storefront-sdk";
import { Scaled } from "@/components/marketing/fx";
import { SAMPLE_PRODUCTS } from "@/components/campaign-preview";

const W = 640;
const H = 400;

/**
 * A small live preview of a template, drawn by the same renderer the storefront uses. It sits on a plain stand-in
 * page, uses labelled sample products, and only renders once it scrolls into view so a long gallery stays light.
 */
export function TemplateThumb({ config, currency = "USD" }: { config: unknown; currency?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const parsed = CampaignConfig.safeParse(config);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (!seen || !el || !parsed.success) return;
    const c = parsed.data;
    const threshold = c.toast?.freeShippingThreshold;
    const h = renderCampaign(document, c, c.format === "recommendation" ? { onAdd: () => Promise.resolve() } : {}, el, {
      viewportWidth: W, currency,
      ...(c.toast?.kind === "shipping_incentive" && threshold ? { cartSubtotal: Math.round(threshold * 80) / 100 } : {}),
      ...(c.format === "recommendation" ? { products: SAMPLE_PRODUCTS.slice(0, c.recommend?.maxProducts ?? 3) } : {}),
    });
    return () => h.destroy();
  }, [seen, parsed.success, parsed.success ? JSON.stringify(parsed.data) : null, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div aria-hidden className="pointer-events-none select-none overflow-hidden rounded-xl bg-[#d9dde8]">
      <Scaled width={W} height={H}>
        <div ref={frame} style={{ width: W, height: H, transform: "translateZ(0)" }} className="relative overflow-hidden bg-white">
          <div className="space-y-3 p-8 opacity-70">
            <div className="h-5 w-1/3 rounded bg-slate-200" />
            <div className="h-3 w-full rounded bg-slate-100" /><div className="h-3 w-5/6 rounded bg-slate-100" />
            <div className="mt-6 grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-28 rounded bg-slate-200/80" />)}</div>
          </div>
        </div>
      </Scaled>
    </div>
  );
}
