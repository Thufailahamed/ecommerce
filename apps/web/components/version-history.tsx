"use client";
import { useState, type ReactNode } from "react";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, ErrorNote } from "./ui";

interface Version { id: string; version: number; source: string; createdAt: string }

/** `bare` drops the card and heading for use inside an editor panel; `empty` is shown there while nothing is published. */
export function VersionHistory({ store, campaignId, bare = false, empty = null }: { store: Store; campaignId: string; bare?: boolean; empty?: ReactNode }) {
  const path = `/api/v1/stores/${store.id}/campaigns/${campaignId}/versions`;
  const { data, reload } = useApi<Version[]>(path);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || data.length === 0) return bare ? <>{empty}</> : null;

  async function rollback(versionId: string) {
    if (!window.confirm("Roll back to this version? It will be published immediately as a new version.")) return;
    setBusy(versionId); setError(null);
    try {
      await api(`/api/v1/stores/${store.id}/campaigns/${campaignId}/rollback`, { method: "POST", body: { versionId } });
      await reload();
      window.location.reload();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Rollback failed"); } finally { setBusy(null); }
  }

  return (
    <section className={bare ? "" : "card mt-10 p-5 md:p-6"} aria-label="Version history">
      {!bare && <h2 className="mb-4 font-display text-xs font-bold uppercase tracking-[0.14em]">Version history</h2>}
      <ErrorNote error={error} />
      <ul className="divide-y divide-line text-sm">
        {data.map((v, i) => (
          <li key={v.id} className="flex items-center justify-between gap-3 py-3">
            <span className="flex flex-wrap items-center gap-2"><span className="num font-medium">v{v.version}</span> <span className="text-ink-3">· {v.source} · {new Date(v.createdAt).toLocaleString()}</span>{i === 0 && <Badge tone="ok" dot>Live</Badge>}</span>
            {i > 0 && <Button variant="ghost" busy={busy === v.id} onClick={() => void rollback(v.id)}>Roll back to this</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
