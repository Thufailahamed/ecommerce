import { and, desc, eq, lt } from "drizzle-orm";
import { schema } from "@convertflow/database";
import {
  ACTIONS, actionNotAllowedFor, isActionKey, parseActionInput, type ActionKey, type ActionOrigin, type StorePermission,
} from "@convertflow/contracts";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { recordAudit } from "./audit.js";
import { can } from "./authz.js";
import { createCampaign, pause } from "./campaigns.js";
import { publishDomainEvent } from "./domain-events.js";
import { requireCapability } from "./entitlements.js";
import { createWorkflow } from "./workflows.js";

const ar = schema.actionRequests;
const REQUEST_TTL_MS = 14 * 86_400_000;
/** AI proposals rest on a snapshot of the store's figures, so they go stale sooner. */
const AI_REQUEST_TTL_MS = 3 * 86_400_000;

export interface ActionContext {
  storeId: string;
  organizationId: string;
  /** The member whose authority the action runs on: the approver, or the member who activated the workflow. */
  actorUserId: string;
  origin: ActionOrigin;
  requestId?: string;
  workflowRunId?: string;
}

type Executor = (d: Deps, ctx: ActionContext, input: never) => Promise<Record<string, unknown>>;

/** Each executor calls a domain service; none touches tables another module owns. */
const EXECUTORS: { [K in ActionKey]: (d: Deps, ctx: ActionContext, input: import("@convertflow/contracts").ActionInput<K>) => Promise<Record<string, unknown>> } = {
  "note.record": async (d, ctx, i) => {
    await recordAudit(d, { action: "automation.note", actorId: null, actorType: "system", storeId: ctx.storeId, organizationId: ctx.organizationId, targetType: "workflow_run", targetId: ctx.workflowRunId ?? null, summary: { note: i.text } });
    return { recorded: true };
  },
  "campaign.pause": async (d, ctx, i) => { await pause(d, ctx.storeId, i.campaignId, ctx.actorUserId); return { campaignId: i.campaignId }; },
  "campaign.create_draft": async (d, ctx, i) => ({ campaignId: (await createCampaign(d, ctx.storeId, ctx.actorUserId, i.config)).id }),
  "workflow.create_draft": async (d, ctx, i) => ({ workflowId: (await createWorkflow(d, ctx.storeId, ctx.actorUserId, i.name, i.definition)).id }),
  "report.recommend": async () => ({ acknowledged: true }),
  "approval.request": async () => ({ acknowledged: true }),
};

/**
 * Runs one registered action. Refuses an action the origin may not use, input outside the action's schema, and an
 * actor who does not (any longer) hold the action's permission. Everything the action changes is correlated to the
 * request or workflow run, and the outcome is published as `action.executed`.
 */
export async function runAction(d: Deps, ctx: ActionContext, key: string, rawInput: unknown): Promise<Record<string, unknown>> {
  if (!isActionKey(key)) throw new HttpError(422, "unknown_action", `Unknown action ${key}`);
  const notAllowed = actionNotAllowedFor(key, ctx.origin);
  if (notAllowed) throw new HttpError(403, "action_not_allowed", notAllowed);
  const parsed = parseActionInput(key, rawInput);
  if (!parsed.ok) throw new HttpError(422, "invalid_action_input", "The action's input is invalid", parsed.issues);
  if (!(await can(d, { type: "user", userId: ctx.actorUserId }, ACTIONS[key].permission as StorePermission, { storeId: ctx.storeId }))) {
    throw new HttpError(403, "forbidden", "The member this action runs for no longer has permission for it");
  }
  const scoped: Deps = { ...d, correlationId: ctx.workflowRunId ? `wfrun:${ctx.workflowRunId}` : `aireq:${ctx.requestId ?? "direct"}` };
  const exec = EXECUTORS[key] as Executor;
  let outcome: "succeeded" | "failed" = "failed";
  try {
    const result = await exec(scoped, ctx, parsed.input as never);
    outcome = "succeeded";
    return result;
  } finally {
    await publishDomainEvent(scoped, {
      type: "action.executed", payload: { action: key, origin: ctx.origin, outcome, ...(ctx.requestId ? { requestId: ctx.requestId } : {}), ...(ctx.workflowRunId ? { workflowRunId: ctx.workflowRunId } : {}) },
      idempotencyKey: `action:${ctx.requestId ?? ctx.workflowRunId}:${key}:${d.now().toISOString()}`, storeId: ctx.storeId, organizationId: ctx.organizationId, source: "system",
    });
  }
}

/* ---------- the approval queue ---------- */

export interface NewActionRequest {
  storeId: string; organizationId: string; action: string; input: unknown; origin: ActionOrigin;
  rationale?: string; evidence?: unknown; requestedBy?: string | null; workflowRunId?: string; planId?: string;
}

/** Validates like `runAction` would (minus the permission, which is the approver's), then queues it for a merchant. */
export async function createActionRequest(d: Deps, r: NewActionRequest): Promise<string> {
  if (!isActionKey(r.action)) throw new HttpError(422, "unknown_action", `Unknown action ${r.action}`);
  const notAllowed = actionNotAllowedFor(r.action, r.origin);
  if (notAllowed) throw new HttpError(422, "action_not_allowed", notAllowed);
  const parsed = parseActionInput(r.action, r.input);
  if (!parsed.ok) throw new HttpError(422, "invalid_action_input", "The action's input is invalid", parsed.issues);
  const id = newId("arq"), now = d.now();
  await d.db.insert(ar).values({
    id, storeId: r.storeId, organizationId: r.organizationId, action: r.action, input: parsed.input, origin: r.origin,
    rationale: r.rationale ? r.rationale.replace(/[<>]/g, "").slice(0, 1000) : null, evidence: r.evidence ?? null,
    requestedBy: r.requestedBy ?? null, workflowRunId: r.workflowRunId ?? null, planId: r.planId ?? null,
    expiresAt: new Date(now.getTime() + (r.origin === "ai" ? AI_REQUEST_TTL_MS : REQUEST_TTL_MS)).toISOString(), createdAt: now.toISOString(),
  });
  await recordAudit(d, { action: "action_request.created", actorId: r.requestedBy ?? null, actorType: r.requestedBy ? "user" : "system", storeId: r.storeId, organizationId: r.organizationId, targetType: "action_request", targetId: id, summary: { action: r.action, origin: r.origin } });
  return id;
}

export async function listActionRequests(d: Deps, storeId: string, f: { status?: "pending" | "rejected" | "executed" | "failed" | "expired"; origin?: ActionOrigin; planId?: string } = {}) {
  const where = [eq(ar.storeId, storeId), ...(f.status ? [eq(ar.status, f.status)] : []), ...(f.origin ? [eq(ar.origin, f.origin)] : []), ...(f.planId ? [eq(ar.planId, f.planId)] : [])];
  const rows = await d.db.select().from(ar).where(and(...where)).orderBy(desc(ar.createdAt), desc(ar.id)).limit(100);
  return rows.map((r) => ({ ...r, permission: isActionKey(r.action) ? ACTIONS[r.action].permission : null, sideEffects: isActionKey(r.action) ? ACTIONS[r.action].sideEffects : null }));
}

async function pending(d: Deps, storeId: string, id: string) {
  const [r] = await d.db.select().from(ar).where(and(eq(ar.id, id), eq(ar.storeId, storeId))).limit(1);
  if (!r) throw new HttpError(404, "not_found", "Request not found");
  if (r.status !== "pending") throw new HttpError(409, "not_pending", `This request is already ${r.status}`);
  if (r.expiresAt <= d.now().toISOString()) {
    await d.db.update(ar).set({ status: "expired" }).where(and(eq(ar.id, id), eq(ar.status, "pending")));
    throw new HttpError(409, "expired", "This request has expired");
  }
  return r;
}

/**
 * A member approves: they must hold the action's own permission, and the workspace must still have the capability
 * for the origin. The request is claimed before it runs so a double click cannot run it twice, then executed on the
 * approver's authority. Failures are recorded on the request, never retried silently.
 */
export async function approveActionRequest(d: Deps, approver: { userId: string }, storeId: string, id: string) {
  const r = await pending(d, storeId, id);
  if (!isActionKey(r.action)) throw new HttpError(422, "unknown_action", "This action no longer exists");
  if (!(await can(d, { type: "user", userId: approver.userId }, ACTIONS[r.action].permission as StorePermission, { storeId }))) {
    throw new HttpError(403, "forbidden", "You do not have permission to approve this action");
  }
  await requireCapability(d, r.organizationId, r.origin === "ai" ? "ai.commerce_manager" : "workflows.create");
  const now = d.now().toISOString();
  const claimed = await d.db.update(ar).set({ status: "executed", decidedBy: approver.userId, decidedAt: now })
    .where(and(eq(ar.id, id), eq(ar.status, "pending"))).returning({ id: ar.id });
  if (!claimed[0]) throw new HttpError(409, "not_pending", "This request was decided meanwhile");
  await recordAudit(d, { action: "action_request.approved", actorId: approver.userId, storeId, organizationId: r.organizationId, targetType: "action_request", targetId: id, summary: { action: r.action, origin: r.origin } });
  try {
    const result = await runAction(d, { storeId, organizationId: r.organizationId, actorUserId: approver.userId, origin: r.origin, requestId: id }, r.action, r.input);
    await d.db.update(ar).set({ result }).where(eq(ar.id, id));
    return { id, status: "executed" as const, result };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await d.db.update(ar).set({ status: "failed", error: msg }).where(eq(ar.id, id));
    await recordAudit(d, { action: "action_request.failed", actorId: approver.userId, storeId, organizationId: r.organizationId, targetType: "action_request", targetId: id, summary: { action: r.action } });
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "action_failed", "The action could not be completed");
  }
}

export async function rejectActionRequest(d: Deps, user: { userId: string }, storeId: string, id: string) {
  const r = await pending(d, storeId, id);
  await d.db.update(ar).set({ status: "rejected", decidedBy: user.userId, decidedAt: d.now().toISOString() }).where(and(eq(ar.id, id), eq(ar.status, "pending")));
  await recordAudit(d, { action: "action_request.rejected", actorId: user.userId, storeId, organizationId: r.organizationId, targetType: "action_request", targetId: id, summary: { action: r.action } });
}

/** Daily: pending requests past their expiry are closed so nothing stale can be approved later. */
export async function expireActionRequests(d: Deps): Promise<void> {
  await d.db.update(ar).set({ status: "expired" }).where(and(eq(ar.status, "pending"), lt(ar.expiresAt, d.now().toISOString())));
}
