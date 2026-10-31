"use client";
import { Suspense, use, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isEditorMessage, type EditorToPreview, type PreviewMode, type PreviewToEditor, type SiteDocument } from "@convertflow/store-builder";
import { Storefront } from "@/components/storefront/storefront";
import { ASSET_BASE, builder } from "@/lib/builder";
import { ApiError } from "@/lib/api";

interface Frame { doc: SiteDocument; path: string; mode: PreviewMode; selectedId: string | null; assetBase: string }

/**
 * Inside the editor (?embed=1) the document arrives by postMessage from the editor on this same origin, so every
 * keystroke and AI change shows instantly without a save. Opened directly, it loads the saved draft for a signed-in
 * member and lets them click around the unpublished store.
 */
function Embedded() {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const post = useCallback((m: PreviewToEditor) => { window.parent.postMessage(m, window.location.origin); }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only the editor that framed us, on our own origin, may drive the preview.
      if (e.origin !== window.location.origin || e.source !== window.parent || !isEditorMessage(e.data)) return;
      const m = e.data as EditorToPreview;
      if (m.type === "render") {
        setFrame((cur) => {
          if (cur && cur.path !== m.path) window.scrollTo({ top: 0 });
          return { doc: m.doc, path: m.path, mode: m.mode, selectedId: m.selectedId, assetBase: m.assetBase };
        });
      } else if (m.type === "scroll-to") {
        document.querySelector(`[data-section-id="${CSS.escape(m.sectionId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    window.addEventListener("message", onMessage);
    post({ source: "sb-preview", type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [post]);

  if (!frame) return <div style={{ minHeight: "100dvh", background: "#fff" }} aria-busy="true" />;
  return (
    <Storefront
      doc={frame.doc} path={frame.path} mode={frame.mode} basePath="" assetBase={frame.assetBase}
      selectedId={frame.selectedId} hoveredId={hovered}
      onNavigate={(path) => post({ source: "sb-preview", type: "navigate", path })}
      onSelectSection={(sectionId, pageId) => post({ source: "sb-preview", type: "select", sectionId, pageId })}
      onHoverSection={(id) => { setHovered(id); post({ source: "sb-preview", type: "hover", sectionId: id }); }}
    />
  );
}

function Standalone({ siteId }: { siteId: string }) {
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("/");
  useEffect(() => {
    builder.get(siteId).then((s) => setDoc(s.draft)).catch((e) => setError(e instanceof ApiError && e.status === 401 ? "Sign in to preview this store." : e instanceof Error ? e.message : "Could not load the preview"));
  }, [siteId]);
  if (error) return <p role="alert" style={{ padding: 40, fontFamily: "system-ui", background: "#fff", color: "#111", minHeight: "100dvh", margin: 0 }}>{error}</p>;
  if (!doc) return <div style={{ minHeight: "100dvh", background: "#fff" }} aria-busy="true" />;
  return (
    <>
      <div role="note" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100, background: "#111214", color: "#fff", padding: "8px 14px", borderRadius: 999, font: "600 12px system-ui", boxShadow: "0 8px 30px rgba(0,0,0,.25)" }}>
        Draft preview · not visible to shoppers
      </div>
      <Storefront doc={doc} path={path} mode="preview" basePath="" assetBase={ASSET_BASE} onNavigate={(p) => { setPath(p); window.scrollTo({ top: 0 }); }} />
    </>
  );
}

function Preview({ siteId }: { siteId: string }) {
  const embed = useSearchParams().get("embed") === "1";
  return embed ? <Embedded /> : <Standalone siteId={siteId} />;
}

export default function PreviewPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = use(params);
  return <Suspense fallback={null}><Preview siteId={siteId} /></Suspense>;
}
