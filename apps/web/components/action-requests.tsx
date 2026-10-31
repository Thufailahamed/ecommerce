"use client";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ACTIONS, isActionKey, roleCan, type Role } from "@convertflow/contracts";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, Empty, ErrorNote, Skeleton } from "./ui";

export interface ActionRequest {
  id: string; action: string; input: unknown; origin: "workflow" | "ai"; status: "pending" | "rejected" | "executed" | "failed" | "expired";
  rationale: string | null; evidence: { range?: { from: string; to: string }; metrics?: { key: string; label: string; kind: string; value: number | null }[] } | null;
  sideEffects: "none" | "draft" | "live" | null; planId: string | null; error: string | null; expiresAt: string; createdAt: string;
}

const EFFECT: Record<"none" | "draft" | "live", { tone: "neutral" | "warn" | "danger"; label: string }> = {
  none: { tone: "neutral", label: "Changes nothing live" }, draft: { tone: "warn", label: "Creates a draft" }, live: { tone: "danger", label: "Changes the storefront" },
};
const fmt = (m: { kind: string; key: string; value: number | null }) => m.value === null ? "–" : m.key === "ctr" ? `${(m.value * 100).toFixed(1)}%` : new Intl.NumberFormat("en-US").format(m.value);

/** What the request would do, in words, from the registry (never from model text). */
function describe(r: ActionRequest): string {
  const base = isActionKey(r.action) ? ACTIONS[r.action].description : r.action;
  const i = (r.input ?? {}) as Record<string, unknown>;
  if (r.action === "campaign.pause") return `${base} (${String(i["campaignId"])})`;
  if (r.action === "campaign.create_draft") return `${base}: “${String((i["config"] as { name?: string } | undefined)?.name ?? "Untitled")}”`;
  if (r.action === "workflow.create_draft" || r.action === "report.recommend") return `${base}: “${String(i["name"] ?? i["title"])}”`;
  return base;
}

/**
 * Pending actions from workflows or the AI manager. Approving runs the action on the approver's authority, so a member
 * only sees Approve on actions their role could do by hand; the API enforces the same rule.
 */
export function ActionRequestQueue({ store, role, origin }: { store: Store; role: Role; origin: "workflow" | "ai" }) {
  const r = useApi<ActionRequest[]>(`/api/v1/stores/${store.id}/action-requests?status=pending&origin=${origin}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const decide = async (id: string, verb: "approve" | "reject") => {
    setBusy(id); setErr(null); setDone(null);
    try {
      await api(`/api/v1/stores/${store.id}/action-requests/${id}/${verb}`, { method: "POST", body: {} });
      setDone(verb === "approve" ? "Approved and done." : "Rejected.");
      await r.reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "That didn't work"); }
    finally { setBusy(null); }
  };
  return (
    <div>
      <ErrorNote error={r.error ?? err} />
      {done && <p role="status" className="mb-2 text-[12px] text-ok">{done}</p>}
      {r.loading && <Skeleton className="h-20" />}
      {r.data && r.data.length === 0 && <Empty icon={CheckCircle2} title="Nothing waiting" body={origin === "ai" ? "Proposals you ask for appear here for review." : "Workflow steps that need a decision appear here."} />}
      {r.data && r.data.length > 0 && (
        <ul className="space-y-3">
          {r.data.map((x) => {
            const effect = x.sideEffects ? EFFECT[x.sideEffects] : null;
            const allowed = isActionKey(x.action) && roleCan(role, ACTIONS[x.action].permission);
            return (
              <li key={x.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{describe(x)}</div>
                    {x.rationale && <p className="mt-1 text-[13px] text-ink-2">{x.rationale}</p>}
                    {x.evidence?.metrics && x.evidence.metrics.length > 0 && (
                      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
                        {x.evidence.metrics.map((m) => <div key={m.key}><dt className="inline">{m.label}: </dt><dd className="num inline text-ink-2">{fmt(m)}</dd>{m.kind === "attributed" && <span> (attributed)</span>}</div>)}
                        {x.evidence.range && <div>{x.evidence.range.from} to {x.evidence.range.to}</div>}
                      </dl>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {effect && <Badge tone={effect.tone}>{effect.label}</Badge>}
                      <span className="text-[11px] text-ink-3">Expires {new Date(x.expiresAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button busy={busy === x.id} onClick={() => void decide(x.id, "reject")}>Reject</Button>
                    {allowed
                      ? <Button variant="primary" busy={busy === x.id} onClick={() => void decide(x.id, "approve")}>Approve</Button>
                      : <span className="self-center text-[11px] text-ink-3">Needs {isActionKey(x.action) ? ACTIONS[x.action].permission : "a higher role"}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
