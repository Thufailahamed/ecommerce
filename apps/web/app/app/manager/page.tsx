"use client";
import { useState } from "react";
import type { Role } from "@convertflow/contracts";
import { api, ApiError, type Store } from "@/lib/api";
import { useStoreRole } from "@/lib/session";
import { NeedStore } from "@/components/need-store";
import { ActionRequestQueue } from "@/components/action-requests";
import { Button, ErrorNote, Field, Notice, PageHeader, SectionTitle, Textarea } from "@/components/ui";

interface PlanResult {
  planId: string; interpretation: string; requestIds: string[]; stale: boolean;
  discarded: { action: string; reasons: string[] }[];
  evidence: { range: { from: string; to: string }; latestDay: string | null };
}

function Manager({ store, role }: { store: Store; role: Role }) {
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [queueKey, setQueueKey] = useState(0);
  const propose = async () => {
    setBusy(true); setErr(null);
    try {
      setPlan(await api<PlanResult>(`/api/v1/stores/${store.id}/ai/plans`, { method: "POST", body: { objective } }));
      setQueueKey((k) => k + 1);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "The AI request failed"); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow="Operate · Preview" title="AI manager"
        sub="Describe what you want for the store. The AI proposes up to five actions from a fixed list, citing your store's own figures. Nothing happens until someone who could do it by hand approves it." />
      <section aria-labelledby="obj-h" className="mb-10">
        <SectionTitle id="obj-h">Objective</SectionTitle>
        <div className="card space-y-4 p-5">
          <Field label="What would you like to improve?" hint="10 to 500 characters. The AI sees aggregate figures, your campaigns and catalog titles, never shoppers' details.">
            <Textarea rows={3} maxLength={500} value={objective} placeholder="Fewer interruptions for first-time visitors" onChange={(e) => setObjective(e.target.value)} />
          </Field>
          <ErrorNote error={err} />
          <Button variant="primary" busy={busy} disabled={objective.trim().length < 10} onClick={() => void propose()}>Propose actions</Button>
        </div>
        {plan && (
          <div className="mt-4 space-y-3" role="status">
            <p className="text-[13px] text-ink-2"><span className="font-medium text-ink">Understood as:</span> {plan.interpretation}</p>
            {plan.stale && <Notice>The figures behind this are more than three days old{plan.evidence.latestDay ? ` (latest: ${plan.evidence.latestDay})` : " (there is no data yet)"}. Weigh the proposals accordingly.</Notice>}
            <p className="text-[13px] text-ink-2">{plan.requestIds.length === 0 ? "No proposal passed the platform's checks." : `${plan.requestIds.length} proposal${plan.requestIds.length === 1 ? "" : "s"} queued for review below.`}</p>
            {plan.discarded.length > 0 && (
              <details className="text-[12px] text-ink-3">
                <summary className="cursor-pointer">{plan.discarded.length} discarded by the platform's checks</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">{plan.discarded.map((x, i) => <li key={i}><span className="font-mono">{x.action}</span>: {x.reasons.join("; ")}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </section>
      <section aria-labelledby="q-h">
        <SectionTitle id="q-h" sub="Approving runs the action on your authority. Proposals expire after three days, because the figures behind them age.">Proposals waiting for review</SectionTitle>
        <ActionRequestQueue key={queueKey} store={store} role={role} origin="ai" />
      </section>
    </>
  );
}

function WithRole({ store }: { store: Store }) {
  return <Manager store={store} role={useStoreRole(store)} />;
}

export default function Page() {
  return <NeedStore>{(s) => <WithRole store={s} />}</NeedStore>;
}
