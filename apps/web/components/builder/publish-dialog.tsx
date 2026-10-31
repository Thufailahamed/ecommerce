"use client";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Globe, Rocket, XCircle } from "lucide-react";
import { useState } from "react";
import { checkSite, type SiteIssue } from "@convertflow/store-builder";
import { ApiError } from "@/lib/api";
import { builder, storeUrl } from "@/lib/builder";
import { useBuilder } from "./state";
import { Btn, Modal } from "./controls";

export function PublishDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { site, doc, flush, updateSite, canPublish, select, setTab, toast, saveState } = useBuilder();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { errors, warnings } = checkSite(doc);
  const url = typeof window !== "undefined" ? `${window.location.origin}${storeUrl(site.slug)}` : storeUrl(site.slug);

  const go = (i: SiteIssue) => {
    const t = i.target;
    if (!t) return;
    if (t.kind === "section") select(t.sectionId);
    else if (t.kind === "product") setTab("products");
    else if (t.kind === "settings" || t.kind === "navigation") setTab("settings");
    else if (t.kind === "page") setTab("pages");
    onClose();
  };

  const publish = async () => {
    setBusy(true); setError(null);
    try {
      if (!(await flush())) throw new Error("Your latest changes could not be saved. Fix the save error first.");
      // Publish exactly what was reviewed here: if the saved draft differs (a teammate, another tab), stop.
      const fresh = await builder.get(site.id);
      if (JSON.stringify(fresh.draft) !== JSON.stringify(doc)) throw new Error("This store was changed elsewhere since you opened it. Reload the editor, review, and publish again.");
      const r = await builder.publish(site.id, fresh.revision);
      updateSite({ status: "published", publishedAt: r.publishedAt, publishedVersionId: r.versionId, revision: fresh.revision });
      setDone(r.publishedAt);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "not_ready" ? "The checklist found something that blocks publishing. Fix the items below." : e instanceof Error ? e.message : "Publishing failed");
    } finally { setBusy(false); }
  };

  const close = () => { setDone(null); setError(null); onClose(); };

  return (
    <Modal open={open} onClose={close} title={done ? "Your store is live" : site.status === "published" ? "Publish changes" : "Publish your store"}
      footer={done ? (
        <><Btn onClick={close}>Keep editing</Btn><a href={storeUrl(site.slug)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 text-[13px] font-semibold text-white hover:bg-brand-solid-hover"><ExternalLink className="size-3.5" aria-hidden />View store</a></>
      ) : (
        <><Btn variant="ghost" onClick={close}>Cancel</Btn>
          <Btn variant="primary" busy={busy} disabled={!canPublish || errors.length > 0 || saveState === "conflict"} onClick={() => void publish()} title={!canPublish ? "Only admins and owners can publish" : undefined}>
            <Rocket className="size-3.5" aria-hidden />{site.status === "published" ? "Publish changes" : "Publish"}
          </Btn></>
      )}>
      {done ? (
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-ok/15 text-ok"><CheckCircle2 className="size-7" aria-hidden /></div>
          <p className="text-[14px] text-ink">Shoppers can now visit</p>
          <div className="mx-auto mt-3 flex max-w-md items-center gap-2 rounded-lg border border-line bg-ink/[0.03] px-3 py-2">
            <Globe className="size-4 shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-ink">{url}</span>
            <button type="button" aria-label="Copy link" onClick={() => { void navigator.clipboard.writeText(url); toast("Link copied", "ok"); }} className="text-ink-3 hover:text-ink"><Copy className="size-3.5" /></button>
          </div>
          <p className="mt-4 text-[12px] text-ink-3">Later edits stay in your draft until you publish again.</p>
        </div>
      ) : (
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-relaxed text-ink-2">
            {site.status === "published" ? "Your live store will be replaced with the current draft." : "Your store will be available at "}
            {site.status !== "published" && <span className="font-mono text-ink">{url}</span>}
          </p>
          {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
          {!canPublish && <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-ink">Only workspace admins and owners can publish. Ask one of them to review and publish.</p>}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Launch checklist</h3>
            {errors.length === 0 && warnings.length === 0 && <p className="flex items-center gap-2 text-[13px] text-ok"><CheckCircle2 className="size-4" aria-hidden />Everything looks ready.</p>}
            <ul className="space-y-1.5">
              {[...errors, ...warnings].map((i, n) => (
                <li key={n}>
                  <button type="button" onClick={() => go(i)} disabled={!i.target}
                    className={clsx("flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[12px] leading-relaxed transition-colors", i.level === "error" ? "border-danger/30 bg-danger/[0.07] text-ink hover:bg-danger/15" : "border-line bg-ink/[0.02] text-ink-2 hover:bg-ink/[0.05]")}>
                    {i.level === "error" ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />}
                    <span className="flex-1">{i.message}</span>
                    {i.target && <span className="shrink-0 text-[11px] font-medium text-brand">Fix</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">AI drafted the copy, prices and policies. You are responsible for what your store says: check product claims, prices and shipping details before launch.</p>
        </div>
      )}
    </Modal>
  );
}
