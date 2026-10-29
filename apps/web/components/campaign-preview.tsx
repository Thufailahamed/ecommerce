"use client";
import { useEffect, useRef } from "react";
import { CampaignConfig } from "@convertflow/contracts";
import { renderCampaign, type RecProduct } from "@convertflow/storefront-sdk";

export type Device = "desktop" | "mobile";
/** The parts of a draft a merchant can select directly in the studio canvas. */
export type PreviewField = "headline" | "body" | "cta" | "form";

/** Clearly labelled stand-ins: the preview has no catalog and no shopper. They never reach the storefront. */
export const SAMPLE_PRODUCTS: RecProduct[] = [
  { id: "sample-1", title: "Sample product one", url: "/", price: 24, addable: true, variantId: "1" },
  { id: "sample-2", title: "Sample product two", url: "/", price: 36.5, addable: true, variantId: "2" },
  { id: "sample-3", title: "Sample product three", url: "/", price: 18, addable: true, variantId: "3" },
  { id: "sample-4", title: "Sample product four", url: "/", price: 52, addable: true, variantId: "4" },
  { id: "sample-5", title: "Sample product five", url: "/", price: 29, addable: true, variantId: "5" },
  { id: "sample-6", title: "Sample product six", url: "/", price: 41, addable: true, variantId: "6" },
];

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
/** The SDK mounts its own host inside the frame and attaches an open shadow root to it. */
const shadowRootOf = (el: HTMLElement): ShadowRoot | null => el.querySelector<HTMLElement>("[data-convertflow]")?.shadowRoot ?? el.shadowRoot;

/**
 * Renders with the exact function the storefront SDK uses. The wrapper has a CSS transform,
 * which makes it the containing block for the SDK's position:fixed elements, so the campaign
 * stays inside the frame instead of covering the editor.
 */
/** `fill` stretches the frame to its container (the builder canvas) instead of using the fixed heights of the compact preview. */
export function CampaignPreview({ config, device, domain, currency, fill = false, onSelectField, selectedField }: { config: unknown; device: Device; domain: string; currency?: string; fill?: boolean; onSelectField?: (field: PreviewField) => void; selectedField?: PreviewField | null }) {
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

  // The preview is the real renderer inside a shadow root. In the studio, selecting text or a form maps it back to
  // the corresponding field instead of activating the campaign's link or submit behaviour.
  useEffect(() => {
    const el = frame.current;
    if (!el || !parsed.success || !onSelectField) return;
    const cfg = parsed.data;
    const headline = normalise(cfg.creative.headline);
    const body = normalise(cfg.creative.body);
    const cta = normalise(cfg.creative.ctaLabel);
    const handler = (event: MouseEvent) => {
      for (const node of event.composedPath()) {
        if (!(node instanceof HTMLElement) || node === el) continue;
        const label = node.getAttribute("aria-label");
        if (node.tagName === "BUTTON" && (label === "Close" || label === "Dismiss notification")) {
          // Keep the preview open while the merchant is inspecting it.
          event.preventDefault(); event.stopPropagation(); return;
        }
        if (node.tagName === "FORM") { event.preventDefault(); event.stopPropagation(); onSelectField("form"); return; }
        const text = normalise(node.textContent ?? "");
        if (!text) continue;
        const field = text === headline ? "headline" : text === body ? "body" : text === cta ? "cta" : undefined;
        if (field) { event.preventDefault(); event.stopPropagation(); onSelectField(field); return; }
      }
      // Selection mode: never let a preview link navigate the dashboard or a form submit.
      event.preventDefault(); event.stopPropagation();
    };
    el.addEventListener("click", handler, true);
    return () => el.removeEventListener("click", handler, true);
  }, [parsed.success, parsed.success ? JSON.stringify(parsed.data) : null, onSelectField]);

  // Mark the four selectable parts so the studio can show a pointer and a hover outline.
  useEffect(() => {
    const el = frame.current;
    const root = el ? shadowRootOf(el) : null;
    if (!el || !root || !parsed.success || !onSelectField) return;
    const cfg = parsed.data;
    const textFor = (field: PreviewField) => field === "headline" ? cfg.creative.headline : field === "body" ? cfg.creative.body : field === "cta" ? cfg.creative.ctaLabel : "";
    const findText = (value: string) => {
      const text = normalise(value);
      if (!text) return undefined;
      const candidates = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((node) => normalise(node.textContent ?? "") === text);
      return candidates.find((node) => !Array.from(node.children).some((child) => normalise(child.textContent ?? "") === text)) ?? candidates[0];
    };
    const nodes = new Set<HTMLElement>();
    for (const field of ["headline", "body", "cta"] as const) {
      const node = findText(textFor(field));
      if (node) nodes.add(node);
    }
    const form = root.querySelector("form");
    if (form instanceof HTMLElement) nodes.add(form);
    const style = document.createElement("style");
    style.textContent = "[data-cf-selectable]{cursor:pointer!important;border-radius:6px;transition:outline-color .15s ease,box-shadow .15s ease} [data-cf-selectable]:hover{outline:1px dashed rgba(111,143,255,.8);outline-offset:4px}";
    root.appendChild(style);
    nodes.forEach((node) => node.setAttribute("data-cf-selectable", "true"));
    return () => { style.remove(); nodes.forEach((node) => node.removeAttribute("data-cf-selectable")); };
  }, [parsed.success, parsed.success ? JSON.stringify(parsed.data) : null, onSelectField, device]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw a clear outline around the field the merchant selected in the studio rail.
  useEffect(() => {
    const el = frame.current;
    const root = el ? shadowRootOf(el) : null;
    if (!el || !root || !parsed.success || !selectedField) return;
    const cfg = parsed.data;
    const value = selectedField === "headline" ? cfg.creative.headline : selectedField === "body" ? cfg.creative.body : selectedField === "cta" ? cfg.creative.ctaLabel : "";
    let target: HTMLElement | undefined;
    if (selectedField === "form") {
      const form = root.querySelector("form");
      if (form instanceof HTMLElement) target = form;
    } else {
      const text = normalise(value);
      if (text) {
        const candidates = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((node) => normalise(node.textContent ?? "") === text);
        target = candidates.find((node) => !Array.from(node.children).some((child) => normalise(child.textContent ?? "") === text)) ?? candidates[0];
      }
    }
    if (!target) return;
    const previous = { outline: target.style.outline, outlineOffset: target.style.outlineOffset, borderRadius: target.style.borderRadius, boxShadow: target.style.boxShadow };
    target.style.outline = "2px solid #6f8fff";
    target.style.outlineOffset = "4px";
    target.style.borderRadius = "6px";
    target.style.boxShadow = "0 0 0 4px rgba(35,80,255,0.18)";
    return () => {
      target.style.outline = previous.outline;
      target.style.outlineOffset = previous.outlineOffset;
      target.style.borderRadius = previous.borderRadius;
      target.style.boxShadow = previous.boxShadow;
    };
  }, [parsed.success, parsed.success ? JSON.stringify(parsed.data) : null, selectedField, device]); // eslint-disable-line react-hooks/exhaustive-deps

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
