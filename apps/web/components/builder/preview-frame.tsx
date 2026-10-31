"use client";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { isPreviewMessage, type EditorToPreview } from "@convertflow/store-builder";
import { ASSET_BASE } from "@/lib/builder";
import { useBuilder } from "./state";

const WIDTH = { desktop: null, tablet: 834, mobile: 390 } as const;

/**
 * The store renders inside a same-origin iframe, so its CSS, media queries and scroll are the real thing at every
 * device width. The editor pushes the document in with postMessage on every change; the frame reports clicks back.
 */
export function PreviewFrame() {
  const { site, doc, path, setPath, selectedId, select, device, previewMode, streaming } = useBuilder();
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow || !isPreviewMessage(e.data)) return;
      const m = e.data;
      if (m.type === "ready") setReady(true);
      else if (m.type === "select") select(m.sectionId);
      else if (m.type === "navigate") setPath(m.path);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [select, setPath]);

  // Coalesce bursts (typing, AI streaming) into one render per animation frame.
  useEffect(() => {
    if (!ready) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const msg: EditorToPreview = { source: "sb-editor", type: "render", doc, path, mode: previewMode, selectedId: previewMode === "edit" ? selectedId : null, assetBase: ASSET_BASE, busy: Boolean(streaming) };
      ref.current?.contentWindow?.postMessage(msg, window.location.origin);
    });
  }, [ready, doc, path, previewMode, selectedId, streaming]);

  useEffect(() => {
    if (!ready || !selectedId) return;
    ref.current?.contentWindow?.postMessage({ source: "sb-editor", type: "scroll-to", sectionId: selectedId } satisfies EditorToPreview, window.location.origin);
  }, [ready, selectedId]);

  const width = WIDTH[device];
  const building = streaming?.mode === "build";
  const activeStep = streaming?.steps.find((s) => s.state === "active");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-2" style={{ backgroundImage: "radial-gradient(rgba(10,12,20,0.08) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 dots opacity-60" />
      <div className={clsx("relative mx-auto flex min-h-0 w-full flex-1 flex-col transition-[max-width,padding] duration-300", width ? "py-5" : "p-3")} style={width ? { maxWidth: width + 24 } : undefined}>
        <div className={clsx("relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] ring-1 ring-line",
          device === "mobile" ? "rounded-[2rem] border-[10px] border-[#0a0c14]" : device === "tablet" ? "rounded-[1.5rem] border-[10px] border-[#0a0c14]" : "rounded-xl")}>
          {device === "desktop" && (
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-black/10 bg-[#f3f3f5] px-3">
              <div className="flex gap-1.5" aria-hidden><span className="size-2.5 rounded-full bg-[#ff5f57]" /><span className="size-2.5 rounded-full bg-[#febc2e]" /><span className="size-2.5 rounded-full bg-[#28c840]" /></div>
              <div className="mx-auto flex h-6 w-full max-w-md items-center justify-center truncate rounded-md bg-white px-3 text-[11px] text-[#666]">
                {typeof window !== "undefined" ? window.location.host : ""}/s/{site.slug}{path === "/" ? "" : path}
              </div>
            </div>
          )}
          <iframe ref={ref} title="Store preview" src={`/preview/${site.id}?embed=1`} className="min-h-0 w-full flex-1 bg-white" />
          {!ready && (
            <div className="absolute inset-0 grid place-items-center bg-white" aria-busy="true">
              <span className="size-8 animate-spin rounded-full border-2 border-black/10 border-t-black/50" aria-label="Loading preview" />
            </div>
          )}
          {/* The store fills in live while the AI builds; this pill says what it is doing. */}
          {ready && building && (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center" aria-live="polite">
              <div className="slide-down flex items-center gap-3 rounded-full bg-[#0a0c14]/90 py-2 pl-2.5 pr-4 text-white shadow-2xl ring-1 ring-line backdrop-blur">
                <span className="relative grid size-6 place-items-center">
                  <span className="absolute inset-0 animate-ping rounded-full bg-brand-solid/50" />
                  <span className="relative size-3 rounded-full bg-gradient-to-br from-brand-solid to-brand-glow" />
                </span>
                <span className="text-[12px] font-medium">{activeStep ? `${activeStep.label}${activeStep.detail ? ` · ${activeStep.detail}` : ""}…` : "Building your store…"}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
