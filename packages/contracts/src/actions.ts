import { z } from "zod";
import type { Permission } from "./permissions";

/**
 * The closed list of things automation may do. Workflows and the AI Commerce Manager can only ever act through these;
 * there is no free-form execution, SQL or code. Each action declares:
 * - `permission`: what the person on whose authority it runs must hold, checked again at execution time;
 * - `sideEffects`: `none` (records something), `draft` (creates something that is not live), `live` (changes what
 *   shoppers see);
 * - `origins`: who may use it, and whether that origin needs a merchant's approval before it runs.
 *
 * The input schemas are strict and bounded. The executors live in the API (`services/actions.ts`).
 */

export const ACTION_ORIGINS = ["workflow", "ai"] as const;
export type ActionOrigin = (typeof ACTION_ORIGINS)[number];

const Id = z.string().min(1).max(100);
const ShortText = z.string().trim().min(1).max(300).refine((s) => !/[<>]/.test(s), "no markup");

interface ActionDef<I extends z.ZodType> {
  description: string;
  input: I;
  permission: Permission;
  sideEffects: "none" | "draft" | "live";
  /** Absent origin: not allowed. `true`: allowed only through an approved request. */
  origins: Partial<Record<ActionOrigin, { approval: boolean }>>;
}
const def = <I extends z.ZodType>(d: ActionDef<I>) => d;

export const ACTIONS = {
  "note.record": def({
    description: "Record a note in the store's audit log",
    input: z.object({ text: ShortText }).strict(),
    permission: "workflows.read", sideEffects: "none",
    origins: { workflow: { approval: false } },
  }),
  "campaign.pause": def({
    description: "Pause a live campaign",
    input: z.object({ campaignId: Id }).strict(),
    permission: "campaigns.write", sideEffects: "live",
    // A merchant who builds a workflow that pauses a campaign has decided that already; the AI always asks.
    origins: { workflow: { approval: false }, ai: { approval: true } },
  }),
  "campaign.create_draft": def({
    description: "Create a campaign draft (never published)",
    // Validated against CampaignConfig by the executor, so the full campaign rules apply.
    input: z.object({ config: z.record(z.string(), z.unknown()) }).strict(),
    permission: "campaigns.write", sideEffects: "draft",
    origins: { ai: { approval: true } },
  }),
  "workflow.create_draft": def({
    description: "Create an automation workflow draft (never activated)",
    input: z.object({ name: z.string().trim().min(1).max(80), definition: z.record(z.string(), z.unknown()) }).strict(),
    permission: "workflows.manage", sideEffects: "draft",
    origins: { ai: { approval: true } },
  }),
  "report.recommend": def({
    description: "Recommend a view of the analytics for the merchant to look at",
    input: z.object({ title: ShortText, metrics: z.array(z.string().max(60)).min(1).max(6) }).strict(),
    permission: "analytics.read", sideEffects: "none",
    origins: { ai: { approval: true } },
  }),
  "approval.request": def({
    description: "Ask a merchant to look at something (creates a pending request; does nothing else)",
    input: z.object({ summary: ShortText }).strict(),
    permission: "workflows.read", sideEffects: "none",
    origins: { workflow: { approval: true } },
  }),
} as const;

export type ActionKey = keyof typeof ACTIONS;
export type ActionInput<K extends ActionKey> = z.infer<(typeof ACTIONS)[K]["input"]>;

export const isActionKey = (x: string): x is ActionKey => Object.prototype.hasOwnProperty.call(ACTIONS, x);

/** Null when allowed; otherwise why not. */
export function actionNotAllowedFor(key: ActionKey, origin: ActionOrigin): string | null {
  return ACTIONS[key].origins[origin] ? null : `${key} cannot be used by ${origin === "ai" ? "the AI" : "a workflow"}`;
}
export const needsApproval = (key: ActionKey, origin: ActionOrigin): boolean => ACTIONS[key].origins[origin]?.approval ?? true;

export function parseActionInput<K extends ActionKey>(key: K, input: unknown): { ok: true; input: ActionInput<K> } | { ok: false; issues: string[] } {
  const r = ACTIONS[key].input.safeParse(input);
  return r.success ? { ok: true, input: r.data as ActionInput<K> } : { ok: false, issues: r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
}
