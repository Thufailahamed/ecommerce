"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type SavedTemplate, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { TemplateGallery } from "@/components/template-gallery";
import { Button, ErrorNote, PageHeader, SectionTitle } from "@/components/ui";

/** Drafts the merchant saved from their own campaigns. Using one starts a new draft; nothing goes live. */
function Saved({ store }: { store: Store }) {
  const base = `/api/v1/stores/${store.id}/campaign-templates`;
  const list = useApi<SavedTemplate[]>(base);
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const use = async (id: string) => {
    setErr(null);
    setBusy(id);
    try {
      const c = await api<{ id: string }>(`${base}/${id}/campaigns`, { method: "POST", body: {} });
      router.push(`/app/campaigns/${c.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not start a campaign from this template");
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this saved template? Campaigns already made from it are not affected.")) return;
    setErr(null);
    try { await api(`${base}/${id}`, { method: "DELETE" }); await list.reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Could not delete the template"); }
  };

  return (
    <section aria-labelledby="saved-h" className="mb-12">
      <SectionTitle id="saved-h" sub="Drafts you saved from your own campaigns. Using one starts a new draft; nothing goes live.">Your templates</SectionTitle>
      <ErrorNote error={err ?? list.error} />
      {list.data && list.data.length === 0 && (
        <p className="mt-4 text-sm text-ink-3">No saved templates yet. Open a campaign&apos;s ⋯ menu and choose Save as template.</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((t) => (
            <li key={t.id} className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.name}</div>
                <div className="text-xs text-ink-3">Saved {new Date(t.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="primary" busy={busy === t.id} onClick={() => void use(t.id)}>Use</Button>
                <Button variant="ghost" onClick={() => void remove(t.id)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Page() {
  return (
    <NeedStore>
      {(s) => (
        <>
          <PageHeader eyebrow="Library" title="Templates" sub="Start from a campaign you saved, or from a ready-made one. Nothing goes live until you review and approve it." />
          <Saved store={s} />
          <SectionTitle sub="Ready-made starting points.">Starter templates</SectionTitle>
          <div className="mt-4">
            <TemplateGallery store={s} />
          </div>
        </>
      )}
    </NeedStore>
  );
}
