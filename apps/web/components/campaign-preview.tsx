"use client";
import { useEffect, useRef } from "react";
import { CampaignConfig } from "@convertflow/contracts";
import { renderCampaign, type RecProduct } from "@convertflow/storefront-sdk";

export type Device = "desktop" | "mobile";

/** Clearly labelled stand-ins: the preview has no catalog and no shopper. They never reach the storefront. */
export const SAMPLE_PRODUCTS: RecProduct[] = [
  { id: "sample-1", title: "Sample product one", url: "/", price: 24, addable: true, variantId: "1" },
  { id: "sample-2", title: "Sample product two", url: "/", price: 36.5, addable: true, variantId: "2" },
  { id: "sample-3", title: "Sample product three", url: "/", price: 18, addable: true, variantId: "3" },
  { id: "sample-4", title: "Sample product four", url: "/", price: 52, addable: true, variantId: "4" },
  { id: "sample-5", title: "Sample product five", url: "/", price: 29, addable: true, variantId: "5" },
  { id: "sample-6", title: "Sample product six", url: "/", price: 41, addable: true, variantId: "6" },
];

/**
 * Renders with the exact function the storefront SDK uses. The wrapper has a CSS transform,
 * which makes it the containing block for the SDK's position:fixed elements, so the campaign
 * stays inside the frame instead of covering the editor.
 */
/** `fill` stretches the frame to its container (the builder canvas) instead of using the fixed heights of the compact preview. */
export function CampaignPreview({ config, device, domain, currency, fill = false }: { config: unknown; device: Device; domain: string; currency?: string; fill?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const parsed = CampaignConfig.safeParse(config);

  // A free-shipping toast states a fact about a real cart. The preview has no shopper, so it uses a clearly labelled
  // sample cart at 80% of the threshold. This never reaches the storefront.
  const threshold = parsed.success ? parsed.data.toast?.freeShippingThreshold : undefined;
  const sampleCart = parsed.success && parsed.data.toast?.kind === "shipping_incentive" && threshold ? Math.round(threshold * 80) / 100 : undefined;

  const isRec = parsed.success && parsed.data.format === "recommendation";
  const isInline = parsed.success && parsed.data.format === "inline"; // part of the page, so it sits after the sample content and the frame scrolls
  const recMax = parsed.success ? (parsed.data.recommend?.maxProducts ?? 3) : 3;

  useEffect(() => {
    const el = frame.current;
    if (!el || !parsed.success) return;
    const h = renderCampaign(document, parsed.data, isRec ? { onAdd: () => new Promise<void>((ok) => setTimeout(ok, 400)) } : {}, el, {
      viewportWidth: device === "mobile" ? 390 : 1024, ...(sampleCart !== undefined ? { cartSubtotal: sampleCart } : {}), ...(currency ? { currency } : {}),
      ...(isRec ? { products: SAMPLE_PRODUCTS.slice(0, recMax) } : {}),
    });
    return () => h.destroy();
  }, [parsed.success, parsed.success ? JSON.stringify(parsed.data) : null, device, sampleCart, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`flex justify-center ${fill ? "h-full" : ""}`}>
      <div className={`${device === "mobile" ? "w-[390px] max-w-full" : "w-full"} ${fill ? "flex h-full flex-col" : ""}`}>
        <div className="flex items-center gap-1.5 rounded-t-lg border border-b-0 border-line bg-surface px-3 py-2">
          <span className="size-2 rounded-full bg-line" /><span className="size-2 rounded-full bg-line" /><span className="size-2 rounded-full bg-line" />
          <span className="num ml-2 truncate text-xs text-ink-3">{domain}</span>
        </div>
        <div ref={frame} style={{ transform: "translateZ(0)", ...(fill ? {} : { height: device === "mobile" ? 560 : 420 }) }}
          className={`relative ${fill ? "min-h-[420px] flex-1" : ""} rounded-b-lg border border-line bg-surface ${isRec || isInline ? "overflow-auto" : "overflow-hidden"}`} aria-label="Campaign preview">
          <div className="space-y-3 p-6 opacity-60" aria-hidden>
            <div className="h-5 w-1/3 rounded bg-line" />
            <div className="h-3 w-full rounded bg-line/70" /><div className="h-3 w-5/6 rounded bg-line/70" />
            <div className="mt-6 grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded bg-line/60" />)}</div>
          </div>
          {!parsed.success && (
            <div className="absolute inset-0 grid place-items-center bg-surface/90 p-6 text-center text-sm text-ink-2">
              Complete the required fields to see the preview.
            </div>
          )}
        </div>
        {sampleCart !== undefined && <p className="mt-2 text-xs text-ink-3">Preview uses a sample cart of {sampleCart} {currency}. Shoppers see their real cart.</p>}
        {isRec && <p className="mt-2 text-xs text-ink-3">Preview uses sample products. Shoppers see products from your catalog with their real prices and stock.</p>}
      </div>
    </div>
  );
}
