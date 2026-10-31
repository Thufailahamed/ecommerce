import { z } from "zod";
import { ACTIONS, actionNotAllowedFor, isActionKey, parseActionInput } from "./actions";
import { DOMAIN_EVENT_TYPES, type DomainEventType } from "./domain-events";

/**
 * A workflow: when <trigger>, if every <condition> holds, do <actions> (after an optional delay). Definitions are
 * data only: every condition and action comes from a closed list, so a workflow can never run code, query the database
 * or reach past the permissions of the person who activated it. See docs/workflow-engine.md.
 */

export const WORKFLOW_SCHEMA_VERSION = 1;

/** Delays ride on queue delivery delays, which Cloudflare caps at 12 hours. */
export const MAX_WORKFLOW_DELAY_SECONDS = 12 * 3600;

export const WorkflowTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), event: z.enum(DOMAIN_EVENT_TYPES as [DomainEventType, ...DomainEventType[]]) }).strict(),
  /** Once a day, from the daily cron. */
  z.object({ type: z.literal("schedule"), every: z.literal("day") }).strict(),
]);
export type WorkflowTrigger = z.infer<typeof WorkflowTrigger>;

/** Payload fields a condition may compare. Only non-personal, enumerated fields. */
export const COMPARABLE_FIELDS = ["channel", "origin", "tool", "platform", "reason", "currency"] as const;

export const WorkflowCondition = z.discriminatedUnion("type", [
  /** order.created only. */
  z.object({ type: z.literal("order_total_at_least"), amount: z.number().min(0).max(1_000_000) }).strict(),
  /** The event's contact currently has confirmed consent on the channel and is not suppressed. */
  z.object({ type: z.literal("contact_can_be_contacted"), channel: z.enum(["email", "sms"]) }).strict(),
  z.object({ type: z.literal("campaign_status_is"), campaignId: z.string().min(1).max(100), status: z.enum(["draft", "scheduled", "active", "paused", "archived"]) }).strict(),
  z.object({ type: z.literal("store_delivery_enabled") }).strict(),
  z.object({ type: z.literal("event_field_equals"), field: z.enum(COMPARABLE_FIELDS), value: z.string().min(1).max(40) }).strict(),
]);
export type WorkflowCondition = z.infer<typeof WorkflowCondition>;

export const WorkflowAction = z.object({ action: z.string().min(1).max(60), input: z.unknown() }).strict();

export const WorkflowDefinition = z.object({
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  trigger: WorkflowTrigger,
  conditions: z.array(WorkflowCondition).max(10).default([]),
  actions: z.array(WorkflowAction).min(1).max(5),
  delaySeconds: z.number().int().min(0).max(MAX_WORKFLOW_DELAY_SECONDS).default(0),
  /** `stop`: a failed action ends the run. `continue`: the remaining actions still run. */
  onError: z.enum(["stop", "continue"]).default("stop"),
  /** Runaway protection: runs beyond this in any hour are skipped. */
  maxRunsPerHour: z.number().int().min(1).max(1000).default(100),
}).strict().superRefine((w, ctx) => {
  w.actions.forEach((a, i) => {
    if (!isActionKey(a.action)) { ctx.addIssue({ code: "custom", path: ["actions", i, "action"], message: `unknown action ${a.action}` }); return; }
    const notAllowed = actionNotAllowedFor(a.action, "workflow");
    if (notAllowed) { ctx.addIssue({ code: "custom", path: ["actions", i, "action"], message: notAllowed }); return; }
    const p = parseActionInput(a.action, a.input);
    if (!p.ok) for (const m of p.issues) ctx.addIssue({ code: "custom", path: ["actions", i, "input"], message: m });
  });
  const ev = w.trigger.type === "event" ? w.trigger.event : null;
  w.conditions.forEach((c, i) => {
    if (c.type === "order_total_at_least" && ev !== "order.created") ctx.addIssue({ code: "custom", path: ["conditions", i], message: "order_total_at_least needs the order.created trigger" });
    if (c.type === "contact_can_be_contacted" && ev !== "customer.subscribed" && ev !== "customer.unsubscribed") ctx.addIssue({ code: "custom", path: ["conditions", i], message: "contact_can_be_contacted needs a customer.* trigger" });
    if (c.type === "event_field_equals" && !ev) ctx.addIssue({ code: "custom", path: ["conditions", i], message: "event_field_equals needs an event trigger" });
  });
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinition>;

export function validateWorkflowDefinition(raw: unknown): { ok: true; definition: WorkflowDefinition } | { ok: false; issues: string[] } {
  const r = WorkflowDefinition.safeParse(raw);
  return r.success ? { ok: true, definition: r.data } : { ok: false, issues: r.error.issues.map((i) => `${i.path.join(".") || "definition"}: ${i.message}`) };
}

/** Workflow-usable actions, for an editor's picker. */
export const WORKFLOW_ACTIONS = (Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).filter((k) => !actionNotAllowedFor(k, "workflow"));
