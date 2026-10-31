"use client";
import { useState } from "react";
import { Activity, ScrollText } from "lucide-react";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { Badge, Button, Empty, ErrorNote, PageHeader, SectionTitle, Select, Skeleton, tableClass } from "@/components/ui";

export interface IntegrationView {
  key: string; name: string; kind: string; verification: "none_needed" | "unverified" | "verified";
  capabilities: string[]; planned: string[];
  status: { state: "not_connected" | "connected" | "error" | "not_applicable"; verified: boolean; lastSuccessAt: string | null; lastError: string | null };
}
export interface PlatformEventRow {
  id: string; type: string; status: "pending" | "delivered" | "failed"; attempts: number; lastError: string | null; recordedAt: string;
  deliveries: { subscriber: string; status: "succeeded" | "failed"; attempts: number; lastError: string | null }[];
}
interface AuditRow { id: string; action: string; actorType: string; targetType: string | null; createdAt: string; correlationId: string | null }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "–");
const STATE: Record<IntegrationView["status"]["state"], { tone: "ok" | "danger" | "neutral" | "warn"; label: string }> = {
  connected: { tone: "ok", label: "Connected" }, error: { tone: "danger", label: "Error" },
  not_connected: { tone: "neutral", label: "Not connected" }, not_applicable: { tone: "neutral", label: "Manual import" },
};

function Integrations({ store }: { store: Store }) {
  const r = useApi<IntegrationView[]>(`/api/v1/stores/${store.id}/integrations`);
  return (
    <section aria-labelledby="int-h" className="mb-10">
      <SectionTitle id="int-h" sub="What each connection can do today, and whether it has been checked against the real service.">Integrations</SectionTitle>
      <ErrorNote error={r.error} />
      {r.loading && <Skeleton className="h-24" />}
      {r.data && (
        <div className="card overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Integrations</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Integration</th><th className="font-medium">Status</th><th className="font-medium">Built</th><th className="font-medium">Last success</th></tr></thead>
            <tbody>
              {r.data.map((i) => (
                <tr key={i.key}>
                  <td className="font-medium">{i.name}{i.verification === "unverified" && <div className="text-[11px] font-normal text-ink-3">Not verified against the live service</div>}</td>
                  <td><Badge tone={STATE[i.status.state].tone} dot>{STATE[i.status.state].label}</Badge>{i.status.lastError && <div className="mt-1 text-[11px] text-danger">{i.status.lastError}</div>}</td>
                  <td className="text-[12px] text-ink-2">{i.capabilities.length} capabilities{i.planned.length > 0 && <span className="text-ink-3"> · {i.planned.length} planned</span>}</td>
                  <td className="text-[12px] text-ink-2">{when(i.status.lastSuccessAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PlatformEvents({ store }: { store: Store }) {
  const [status, setStatus] = useState<"" | "failed" | "pending" | "delivered">("failed");
  const r = useApi<PlatformEventRow[]>(`/api/v1/stores/${store.id}/platform-events${status ? `?status=${status}` : ""}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const retry = async (id: string) => {
    setBusy(id); setErr(null);
    try { await api(`/api/v1/stores/${store.id}/platform-events/${id}/retry`, { method: "POST", body: {} }); await r.reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Retry failed"); }
    finally { setBusy(null); }
  };
  return (
    <section aria-labelledby="ev-h" className="mb-10">
      <SectionTitle id="ev-h" sub="Internal events (orders, publishes, consent changes) and whether every module that listens to them has processed them.">Event delivery</SectionTitle>
      <div className="mb-3"><Select aria-label="Event status" className="w-44" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
        <option value="failed">Failed</option><option value="pending">Pending</option><option value="delivered">Delivered</option><option value="">All</option>
      </Select></div>
      <ErrorNote error={r.error ?? err} />
      {r.loading && <Skeleton className="h-24" />}
      {r.data && r.data.length === 0 && <Empty icon={Activity} title={status === "failed" ? "Nothing has failed" : "No events"} body="Events from the last 30 days appear here." />}
      {r.data && r.data.length > 0 && (
        <div className="card overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Platform events</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Event</th><th className="font-medium">Status</th><th className="font-medium">Listeners</th><th className="font-medium">Recorded</th><th /></tr></thead>
            <tbody>
              {r.data.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-[12px]">{e.type}</td>
                  <td><Badge tone={e.status === "delivered" ? "ok" : e.status === "failed" ? "danger" : "warn"} dot>{e.status}</Badge>{e.lastError && <div className="mt-1 max-w-xs text-[11px] text-danger">{e.lastError}</div>}</td>
                  <td className="text-[12px] text-ink-2">{e.deliveries.map((x) => `${x.subscriber} ${x.status === "succeeded" ? "✓" : "✗"}`).join(", ") || "none"}</td>
                  <td className="text-[12px] text-ink-2">{when(e.recordedAt)}</td>
                  <td className="text-right">{e.status !== "delivered" && <Button busy={busy === e.id} onClick={() => void retry(e.id)}>Retry</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AuditLog({ store }: { store: Store }) {
  const r = useApi<AuditRow[]>(`/api/v1/stores/${store.id}/audit?limit=50`);
  return (
    <section aria-labelledby="au-h">
      <SectionTitle id="au-h" sub="The 50 most recent changes to this store.">Audit log</SectionTitle>
      <ErrorNote error={r.error} />
      {r.loading && <Skeleton className="h-24" />}
      {r.data && r.data.length === 0 && <Empty icon={ScrollText} title="No entries" body="Changes to campaigns, settings and connections are recorded here." />}
      {r.data && r.data.length > 0 && (
        <div className="card overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Audit log</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Action</th><th className="font-medium">By</th><th className="font-medium">Target</th><th className="font-medium">When</th></tr></thead>
            <tbody>
              {r.data.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-[12px]">{a.action}</td>
                  <td className="text-[12px] text-ink-2">{a.actorType === "user" ? "A team member" : a.actorType === "platform" ? "Store platform" : "System"}</td>
                  <td className="text-[12px] text-ink-2">{a.targetType ?? "–"}</td>
                  <td className="text-[12px] text-ink-2">{when(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Operations({ store }: { store: Store }) {
  return (
    <>
      <PageHeader eyebrow="Operate" title="Operations" sub="Connection health, internal event delivery and the audit trail for this store." />
      <Integrations store={store} />
      <PlatformEvents store={store} />
      <AuditLog store={store} />
    </>
  );
}

export default function Page() {
  return <NeedStore>{(s) => <Operations store={s} />}</NeedStore>;
}

