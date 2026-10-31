"use client";
import { useState } from "react";
import { Workflow as WorkflowIcon } from "lucide-react";
import type { Role } from "@convertflow/contracts";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { roleHolds } from "@/lib/modules";
import { useStoreRole } from "@/lib/session";
import { WORKFLOW_PRESETS, describeWorkflow, type WorkflowRow } from "@/lib/workflows";
import { NeedStore } from "@/components/need-store";
import { ActionRequestQueue } from "@/components/action-requests";
import { Badge, Button, Empty, ErrorNote, Field, Input, Notice, PageHeader, SectionTitle, Select, Skeleton, Textarea, statusTone } from "@/components/ui";

interface RunRow { id: string; status: string; createdAt: string; error: string | null; steps: { kind: string; name: string; outcome: string; detail?: string }[] }

function NewWorkflow({ store, onCreated }: { store: Store; onCreated: () => void }) {
  const first = WORKFLOW_PRESETS[0]!;
  const [name, setName] = useState(first.name);
  const [json, setJson] = useState(JSON.stringify(first.definition, null, 2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const pick = (key: string) => {
    const p = WORKFLOW_PRESETS.find((x) => x.key === key);
    if (p) { setName(p.name); setJson(JSON.stringify(p.definition, null, 2)); }
  };
  const create = async () => {
    setErr(null); setIssues([]);
    let definition: unknown;
    try { definition = JSON.parse(json); } catch { setErr("The definition is not valid JSON"); return; }
    setBusy(true);
    try { await api(`/api/v1/stores/${store.id}/workflows`, { method: "POST", body: { name, definition } }); onCreated(); }
    catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create the workflow");
      if (e instanceof ApiError && Array.isArray(e.details)) setIssues(e.details.map(String));
    } finally { setBusy(false); }
  };
  return (
    <div className="card mb-8 space-y-4 p-5">
      <Field label="Start from"><Select onChange={(e) => pick(e.target.value)}>{WORKFLOW_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
      <Field label="Name"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Definition" hint="Triggers, conditions and actions come from a fixed list; the server rejects anything else. Drafts never run.">
        <Textarea rows={10} className="num text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
      </Field>
      <ErrorNote error={err} />
      {issues.length > 0 && <ul className="list-disc pl-5 text-[12px] text-danger">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      <Button variant="primary" busy={busy} onClick={() => void create()}>Save draft</Button>
    </div>
  );
}

function Runs({ store, id }: { store: Store; id: string }) {
  const r = useApi<RunRow[]>(`/api/v1/stores/${store.id}/workflows/${id}/runs`);
  if (r.loading) return <Skeleton className="h-12" />;
  if (r.error) return <ErrorNote error={r.error} />;
  if (!r.data?.length) return <p className="text-[12px] text-ink-3">No runs yet.</p>;
  return (
    <ul className="space-y-1.5 text-[12px]">
      {r.data.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center gap-2">
          <Badge tone={x.status === "succeeded" ? "ok" : x.status === "failed" ? "danger" : "neutral"}>{x.status}</Badge>
          <span className="text-ink-3">{new Date(x.createdAt).toLocaleString()}</span>
          <span className="text-ink-2">{x.steps.map((s) => `${s.name}: ${s.outcome}`).join(" → ") || x.error || ""}</span>
        </li>
      ))}
    </ul>
  );
}

function WorkflowItem({ store, w, canManage, onChange }: { store: Store; w: WorkflowRow; canManage: boolean; onChange: () => void }) {
  const [reviewing, setReviewing] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (verb: "activate" | "pause" | "archive", body: unknown = {}) => {
    setBusy(true); setErr(null);
    try { await api(`/api/v1/stores/${store.id}/workflows/${w.id}/${verb}`, { method: "POST", body }); setReviewing(false); onChange(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "That didn't work"); }
    finally { setBusy(false); }
  };
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><span className="font-medium">{w.name}</span><Badge tone={statusTone(w.status)} dot>{w.status}</Badge></div>
        <div className="flex flex-wrap gap-2">
          <Button aria-expanded={showRuns} onClick={() => setShowRuns((x) => !x)}>Runs</Button>
          {canManage && (w.status === "draft" || w.status === "paused") && <Button variant="primary" onClick={() => setReviewing(true)}>Review and activate</Button>}
          {canManage && w.status === "active" && <Button busy={busy} onClick={() => void act("pause")}>Pause</Button>}
          {canManage && w.status !== "archived" && <Button busy={busy} onClick={() => void act("archive")}>Archive</Button>}
        </div>
      </div>
      <ErrorNote error={err} />
      {reviewing && (
        <div className="mt-3 rounded-lg border border-line p-4">
          <p className="mb-2 text-[13px] text-ink-2">This workflow will run on your authority. It will:</p>
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px]">{describeWorkflow(w.draftDefinition).map((s, i) => <li key={i}>{s}</li>)}</ol>
          <div className="flex gap-2">
            <Button onClick={() => setReviewing(false)}>Cancel</Button>
            <Button variant="primary" busy={busy} onClick={() => void act("activate", { approve: true, approvedUpdatedAt: w.updatedAt })}>Activate</Button>
          </div>
        </div>
      )}
      {showRuns && <div className="mt-3"><Runs store={store} id={w.id} /></div>}
    </li>
  );
}

function Automations({ store, role }: { store: Store; role: Role }) {
  const list = useApi<WorkflowRow[]>(`/api/v1/stores/${store.id}/workflows`);
  const [creating, setCreating] = useState(false);
  const canManage = roleHolds(role, "workflows.manage");
  return (
    <>
      <PageHeader eyebrow="Operate · Preview" title="Automations"
        sub="When something happens in your store, check conditions and take a registered action. Workflows never run code, and act only within the permissions of the member who activated them."
        actions={canManage ? <Button variant="primary" onClick={() => setCreating((x) => !x)}>{creating ? "Close" : "New workflow"}</Button> : undefined} />
      <div className="mb-6"><Notice tone="brand">Preview: only for workspaces it has been switched on for. Runs are capped per hour and per month.</Notice></div>
      {creating && <NewWorkflow store={store} onCreated={() => { setCreating(false); void list.reload(); }} />}
      <section aria-labelledby="wf-h" className="mb-10">
        <SectionTitle id="wf-h">Workflows</SectionTitle>
        <ErrorNote error={list.error} />
        {list.loading && <Skeleton className="h-24" />}
        {list.data && list.data.length === 0 && <Empty icon={WorkflowIcon} title="No workflows yet" body={canManage ? "Start from a preset with New workflow." : "An admin can create one."} />}
        {list.data && list.data.length > 0 && (
          <ul className="space-y-3">{list.data.map((w) => <WorkflowItem key={w.id} store={store} w={w} canManage={canManage} onChange={() => void list.reload()} />)}</ul>
        )}
      </section>
      <section aria-labelledby="ap-h">
        <SectionTitle id="ap-h" sub="Workflow steps that wait for a merchant's decision.">Waiting for approval</SectionTitle>
        <ActionRequestQueue store={store} role={role} origin="workflow" />
      </section>
    </>
  );
}

function WithRole({ store }: { store: Store }) {
  return <Automations store={store} role={useStoreRole(store)} />;
}

export default function Page() {
  return <NeedStore>{(s) => <WithRole store={s} />}</NeedStore>;
}
