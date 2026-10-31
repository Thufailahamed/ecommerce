import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import {
  ACTIONS, DOMAIN_EVENT_TYPES, isActionKey, needsApproval, validateWorkflowDefinition,
  type DomainEvent, type StorePermission, type WorkflowCondition, type WorkflowDefinition,
} from "@convertflow/contracts";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { recordAudit } from "./audit.js";
import { can } from "./authz.js";
import { canContact } from "./consent.js";
import { defineSubscriber } from "./domain-events.js";
import { entitlementsFor, quota, recordUsage } from "./entitlements.js";

const { workflows: wf, workflowVersions: wv, workflowRuns: wr, campaigns, stores, domainEvents } = schema;
const MAX_WORKFLOWS_PER_STORE = 50;

/* ---------- definitions: drafts, activation, lifecycle ---------- */

const validate = (raw: unknown) => {
  const v = validateWorkflowDefinition(raw);
  if (!v.ok) throw new HttpError(422, "invalid_workflow", "Workflow is invalid", v.issues);
  return v.definition;
};

export async function createWorkflow(d: Deps, storeId: string, actorId: string, name: string, raw: unknown) {
  const definition = validate(raw);
  const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)` }).from(wf).where(and(eq(wf.storeId, storeId), inArray(wf.status, ["draft", "active", "paused"])));
  if (n >= MAX_WORKFLOWS_PER_STORE) throw new HttpError(409, "too_many_workflows", `A store can have at most ${MAX_WORKFLOWS_PER_STORE} workflows`);
  const now = d.now().toISOString();
  const row = { id: newId("wfl"), storeId, name: name.trim().slice(0, 80), status: "draft" as const, draftDefinition: definition, activeVersionId: null, activatedBy: null, createdBy: actorId, createdAt: now, updatedAt: now };
  await d.db.insert(wf).values(row);
  return row;
}

async function load(d: Deps, storeId: string, id: string) {
  const [w] = await d.db.select().from(wf).where(and(eq(wf.id, id), eq(wf.storeId, storeId))).limit(1);
  if (!w) throw new HttpError(404, "not_found", "Workflow not found");
  return w;
}
export const getWorkflow = load;

export async function listWorkflows(d: Deps, storeId: string) {
  return d.db.select().from(wf).where(eq(wf.storeId, storeId)).orderBy(desc(wf.updatedAt));
}

export async function updateWorkflowDraft(d: Deps, storeId: string, id: string, name: string, raw: unknown) {
  const w = await load(d, storeId, id);
  if (w.status === "archived") throw new HttpError(409, "archived", "Archived workflows cannot be edited");
  const definition = validate(raw);
  const now = d.now().toISOString();
  await d.db.update(wf).set({ name: name.trim().slice(0, 80), draftDefinition: definition, updatedAt: now }).where(eq(wf.id, id));
  return { ...w, name, draftDefinition: definition, updatedAt: now };
}

/**
 * Activation turns the reviewed draft into an immutable version that runs on the activating member's authority. Like
 * campaign publishing, the caller passes the `updatedAt` it reviewed, and the member must hold every action's
 * permission now (it is checked again on every run).
 */
export async function activateWorkflow(d: Deps, storeId: string, id: string, actorId: string, approvedUpdatedAt: string) {
  const w = await load(d, storeId, id);
  if (w.status === "archived") throw new HttpError(409, "archived", "Archived workflows cannot be activated");
  if (w.updatedAt !== approvedUpdatedAt) throw new HttpError(409, "stale_approval", "The workflow changed after it was reviewed. Review it again before activating.");
  const definition = validate(w.draftDefinition);
  for (const a of definition.actions) {
    if (isActionKey(a.action) && !(await can(d, { type: "user", userId: actorId }, ACTIONS[a.action].permission as StorePermission, { storeId }))) {
      throw new HttpError(403, "forbidden", `You need the ${ACTIONS[a.action].permission} permission to activate a workflow that uses ${a.action}`);
    }
  }
  const [{ m } = { m: 0 }] = await d.db.select({ m: sql<number>`coalesce(max(${wv.version}), 0)` }).from(wv).where(eq(wv.workflowId, id));
  const now = d.now().toISOString();
  const versionId = newId("wfv");
  await d.db.insert(wv).values({ id: versionId, workflowId: id, storeId, version: m + 1, definition, createdBy: actorId, createdAt: now });
  await d.db.update(wf).set({ status: "active", activeVersionId: versionId, activatedBy: actorId, updatedAt: now }).where(eq(wf.id, id));
  await recordAudit(d, { action: "workflow.activated", actorId, storeId, targetType: "workflow", targetId: id, summary: { version: m + 1, trigger: definition.trigger.type === "event" ? definition.trigger.event : "schedule:day" } });
  return { versionId, version: m + 1 };
}

export async function setWorkflowStatus(d: Deps, storeId: string, id: string, actorId: string, status: "paused" | "archived") {
  const w = await load(d, storeId, id);
  if (status === "paused" && w.status !== "active") throw new HttpError(409, "not_active", "Only an active workflow can be paused");
  await d.db.update(wf).set({ status, updatedAt: d.now().toISOString() }).where(eq(wf.id, id));
  // Anything still waiting to run is cancelled with it.
  await d.db.update(wr).set({ status: "cancelled", finishedAt: d.now().toISOString() }).where(and(eq(wr.workflowId, id), eq(wr.status, "scheduled")));
  await recordAudit(d, { action: `workflow.${status}`, actorId, storeId, targetType: "workflow", targetId: id });
}

export async function listRuns(d: Deps, storeId: string, workflowId: string) {
  await load(d, storeId, workflowId);
  return d.db.select().from(wr).where(eq(wr.workflowId, workflowId)).orderBy(desc(wr.createdAt)).limit(50);
}

/* ---------- triggering ---------- */

export interface WorkflowRunMessage { kind: "workflow_run"; runId: string }
export const isWorkflowRunMessage = (m: unknown): m is WorkflowRunMessage => typeof m === "object" && m !== null && (m as { kind?: unknown }).kind === "workflow_run";

async function activeFor(d: Deps, storeId: string) {
  return d.db.select({ id: wf.id, versionId: wv.id, definition: wv.definition })
    .from(wf).innerJoin(wv, eq(wv.id, wf.activeVersionId))
    .where(and(eq(wf.storeId, storeId), eq(wf.status, "active")));
}

/** Creates a run unless one exists for this version and trigger (that is the idempotency), then starts or schedules it. */
async function startRun(d: Deps, storeId: string, w: { id: string; versionId: string }, def: WorkflowDefinition, triggerKey: string) {
  const runAt = new Date(d.now().getTime() + def.delaySeconds * 1000).toISOString();
  const [run] = await d.db.insert(wr).values({ id: newId("wfr"), storeId, workflowId: w.id, versionId: w.versionId, triggerKey, runAt, createdAt: d.now().toISOString() })
    .onConflictDoNothing().returning({ id: wr.id });
  if (!run) return;
  if (def.delaySeconds === 0) await executeRun(d, run.id);
  else if (d.enqueueEvents) await d.enqueueEvents({ kind: "workflow_run", runId: run.id } satisfies WorkflowRunMessage, { delaySeconds: def.delaySeconds });
  // Without a queue the run waits for sweepWorkflowRuns.
}

/**
 * Subscribed to every platform event. Events caused by a workflow run are ignored, so a workflow can never trigger
 * itself or another workflow in a loop.
 */
export const workflowTrigger = defineSubscriber({
  name: "workflows.trigger",
  events: DOMAIN_EVENT_TYPES,
  async handle(d, e) {
    if (!e.storeId || e.correlationId?.startsWith("wfrun:")) return;
    const org = await d.db.select({ org: stores.organizationId }).from(stores).where(eq(stores.id, e.storeId)).limit(1);
    if (!org[0] || !(await entitlementsFor(d, org[0].org)).has("workflows.create")) return;
    for (const w of await activeFor(d, e.storeId)) {
      const def = validateWorkflowDefinition(w.definition);
      if (!def.ok || def.definition.trigger.type !== "event" || def.definition.trigger.event !== e.type) continue;
      await startRun(d, e.storeId, w, def.definition, e.id);
    }
  },
});

/** Daily cron: one run per active scheduled workflow per UTC day. */
export async function runScheduledWorkflows(d: Deps): Promise<void> {
  const day = d.now().toISOString().slice(0, 10);
  const rows = await d.db.select({ id: wf.id, storeId: wf.storeId, versionId: wv.id, definition: wv.definition, org: stores.organizationId })
    .from(wf).innerJoin(wv, eq(wv.id, wf.activeVersionId)).innerJoin(stores, eq(stores.id, wf.storeId)).where(eq(wf.status, "active"));
  for (const w of rows) {
    const def = validateWorkflowDefinition(w.definition);
    if (!def.ok || def.definition.trigger.type !== "schedule") continue;
    if (!(await entitlementsFor(d, w.org)).has("workflows.create")) continue;
    await startRun(d, w.storeId, w, def.definition, `day:${day}`);
  }
}

/** Runs whose delay has passed and that no queue message delivered (no queue, or a lost message). */
export async function sweepWorkflowRuns(d: Deps, limit = 200): Promise<number> {
  const due = await d.db.select({ id: wr.id }).from(wr).where(and(eq(wr.status, "scheduled"), lte(wr.runAt, d.now().toISOString()))).limit(limit);
  for (const r of due) await executeRun(d, r.id);
  return due.length;
}

/* ---------- execution ---------- */

type Step = { kind: "condition" | "action" | "guard"; name: string; outcome: string; detail?: string };

async function conditionHolds(d: Deps, storeId: string, c: WorkflowCondition, e: DomainEvent | null): Promise<{ ok: boolean; detail?: string }> {
  const p = (e?.payload ?? {}) as Record<string, unknown>;
  switch (c.type) {
    case "order_total_at_least": return { ok: typeof p["total"] === "number" && p["total"] >= c.amount };
    case "contact_can_be_contacted": {
      if (typeof p["contactId"] !== "string") return { ok: false, detail: "no contact" };
      const r = await canContact(d, storeId, p["contactId"], c.channel);
      return { ok: r.allowed, detail: r.reason };
    }
    case "campaign_status_is": {
      const [x] = await d.db.select({ status: campaigns.status }).from(campaigns).where(and(eq(campaigns.id, c.campaignId), eq(campaigns.storeId, storeId))).limit(1);
      return { ok: x?.status === c.status, detail: x?.status ?? "not found" };
    }
    case "store_delivery_enabled": {
      const [s] = await d.db.select({ on: stores.deliveryEnabled }).from(stores).where(eq(stores.id, storeId)).limit(1);
      return { ok: Boolean(s?.on) };
    }
    case "event_field_equals": return { ok: String(p[c.field] ?? "") === c.value };
  }
}

/**
 * Claims a scheduled run and executes it. Guards first (still active and the same version, the trigger still on
 * record, the hourly cap, the monthly allowance), then every condition, then each action through the action
 * registry on the activating member's authority. Actions that need approval become pending requests instead.
 */
export async function executeRun(d: Deps, runId: string): Promise<void> {
  const claimed = await d.db.update(wr).set({ status: "running", attempts: sql`${wr.attempts} + 1` })
    .where(and(eq(wr.id, runId), eq(wr.status, "scheduled"))).returning();
  const run = claimed[0];
  if (!run) return; // already taken, finished or cancelled
  const steps: Step[] = [];
  const finish = (status: "succeeded" | "skipped" | "failed" | "cancelled", error?: string) =>
    d.db.update(wr).set({ status, steps, error: error ?? null, finishedAt: d.now().toISOString() }).where(eq(wr.id, runId));
  try {
    const [w] = await d.db.select({ status: wf.status, activeVersionId: wf.activeVersionId, activatedBy: wf.activatedBy, org: stores.organizationId })
      .from(wf).innerJoin(stores, eq(stores.id, wf.storeId)).where(eq(wf.id, run.workflowId)).limit(1);
    if (!w || w.status !== "active" || w.activeVersionId !== run.versionId || !w.activatedBy) {
      steps.push({ kind: "guard", name: "still_active", outcome: "no" }); return void (await finish("cancelled"));
    }
    const [v] = await d.db.select({ definition: wv.definition }).from(wv).where(eq(wv.id, run.versionId)).limit(1);
    const parsed = validateWorkflowDefinition(v?.definition);
    if (!parsed.ok) return void (await finish("failed", "stored definition no longer validates"));
    const def = parsed.definition;

    let event: DomainEvent | null = null;
    if (!run.triggerKey.startsWith("day:")) {
      const [row] = await d.db.select().from(domainEvents).where(eq(domainEvents.id, run.triggerKey)).limit(1);
      if (!row) return void (await finish("failed", "the triggering event is no longer on record"));
      event = { ...row, type: row.type as DomainEvent["type"], payload: row.payload as DomainEvent["payload"] };
    }

    const hourAgo = new Date(d.now().getTime() - 3_600_000).toISOString();
    const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)` }).from(wr)
      .where(and(eq(wr.workflowId, run.workflowId), inArray(wr.status, ["running", "succeeded", "failed"]), gte(wr.createdAt, hourAgo)));
    if (n > def.maxRunsPerHour) { steps.push({ kind: "guard", name: "max_runs_per_hour", outcome: "exceeded" }); return void (await finish("skipped")); }
    if ((await quota(d, w.org, "workflow_executions")).remaining <= 0) { steps.push({ kind: "guard", name: "monthly_allowance", outcome: "used_up" }); return void (await finish("skipped")); }

    for (const c of def.conditions) {
      const r = await conditionHolds(d, run.storeId, c, event);
      steps.push({ kind: "condition", name: c.type, outcome: r.ok ? "met" : "not_met", ...(r.detail ? { detail: r.detail } : {}) });
      if (!r.ok) return void (await finish("skipped"));
    }

    await recordUsage(d, w.org, "workflow_executions");
    // Imported here, not at the top: actions.ts imports this module for workflow.create_draft.
    const { createActionRequest, runAction } = await import("./actions.js");
    let failed: string | undefined;
    for (const a of def.actions) {
      if (!isActionKey(a.action)) { steps.push({ kind: "action", name: a.action, outcome: "unknown" }); failed ??= `unknown action ${a.action}`; if (def.onError === "stop") break; continue; }
      try {
        if (needsApproval(a.action, "workflow")) {
          const requestId = await createActionRequest(d, { storeId: run.storeId, organizationId: w.org, action: a.action, input: a.input, origin: "workflow", workflowRunId: runId, rationale: a.action === "approval.request" ? (a.input as { summary: string }).summary : `Requested by a workflow` });
          steps.push({ kind: "action", name: a.action, outcome: "approval_requested", detail: requestId });
        } else {
          await runAction(d, { storeId: run.storeId, organizationId: w.org, actorUserId: w.activatedBy, origin: "workflow", workflowRunId: runId }, a.action, a.input);
          steps.push({ kind: "action", name: a.action, outcome: "succeeded" });
        }
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        steps.push({ kind: "action", name: a.action, outcome: "failed", detail: msg });
        failed ??= msg;
        if (def.onError === "stop") break;
      }
    }
    await finish(failed ? "failed" : "succeeded", failed);
  } catch (e) {
    await finish("failed", (e instanceof Error ? e.message : String(e)).slice(0, 200));
  }
}
