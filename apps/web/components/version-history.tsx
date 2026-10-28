"use client";
import { useState } from "react";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Button, ErrorNote } from "./ui";

interface Version { id: string; version: number; source: string; createdAt: string }

export function VersionHistory({ store, campaignId }: { store: Store; campaignId: string }) {
  const path = `/api/v1/stores/${store.id}/campaigns/${campaignId}/versions`;
  const { data, reload } = useApi<Version[]>(path);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || data.length === 0) return null;

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
    <section className="mt-12 border-t border-line pt-6">
      <h2 className="mb-3 text-sm font-semibold">Version history</h2>
      <ErrorNote error={error} />
      <ul className="divide-y divide-line text-sm">
        {data.map((v, i) => (
          <li key={v.id} className="flex items-center justify-between py-2.5">
            <span><span className="num font-medium">v{v.version}</span> <span className="text-ink-3">· {v.source} · {new Date(v.createdAt).toLocaleString()}</span>{i === 0 && <span className="ml-2 text-xs text-ok">live</span>}</span>
            {i > 0 && <Button variant="ghost" busy={busy === v.id} onClick={() => void rollback(v.id)}>Roll back to this</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
