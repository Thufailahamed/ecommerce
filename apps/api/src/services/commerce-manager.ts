import { and, eq } from "drizzle-orm";
import { AIValidationError, fenceData, validateProposal } from "@convertflow/ai";
import {
  SHIPPED_TOOLS, STORE_METRICS, actionNotAllowedFor, isActionKey, needsApproval, parseActionInput, validateWorkflowDefinition,
  type ActionKey,
} from "@convertflow/contracts";
import { schema } from "@convertflow/database";
import { newId } from "../lib/crypto.js";
import type { Deps } from "../deps.js";
import { createActionRequest } from "./actions.js";
import { aiContext, runAITask, unsupportedNumbers } from "./ai-tasks.js";
import { recordAudit } from "./audit.js";
import { catalogForAI } from "./catalog.js";
import { requireCapability } from "./entitlements.js";
import { evidenceNumbers, type Evidence } from "./metrics.js";

type Store = typeof schema.stores.$inferSelect;
const METRIC_KEYS = new Set<string>(STORE_METRICS.map((m) => m.key));

export interface Discarded { action: string; reasons: string[] }

/**
 * The business rules a proposal must pass before it may even be queued, on top of the action's own schema. Returns the
 * input to store (a campaign draft is replaced by its policy-checked, repaired form) or the reasons it was discarded.
 */
async function checkProposal(d: Deps, store: Store, key: ActionKey, input: unknown, objective: string): Promise<{ ok: true; input: unknown } | { ok: false; reasons: string[] }> {
  const parsed = parseActionInput(key, input);
  if (!parsed.ok) return { ok: false, reasons: parsed.issues };
  switch (key) {
    case "campaign.pause": {
      const id = (parsed.input as { campaignId: string }).campaignId;
      const [c] = await d.db.select({ status: schema.campaigns.status }).from(schema.campaigns)
        .where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.storeId, store.id))).limit(1);
      if (!c) return { ok: false, reasons: ["names a campaign this store does not have"] };
      if (c.status !== "active") return { ok: false, reasons: [`the campaign is ${c.status}, not active`] };
      return { ok: true, input: parsed.input };
    }
    case "campaign.create_draft": {
      // The same policy gate as the AI studio, with no promotion authorised: the manager may never invent a discount.
      try {
        const p = validateProposal({ config: (parsed.input as { config: unknown }).config, explanation: "" }, {
          objective, catalog: await catalogForAI(d, store.id, store.domain), siteDomain: store.domain, currency: store.currency,
        }, { allowedTools: SHIPPED_TOOLS });
        return { ok: true, input: { config: p.config } };
      } catch (e) {
        return { ok: false, reasons: e instanceof AIValidationError ? e.issues : ["the campaign draft is invalid"] };
      }
    }
    case "workflow.create_draft": {
      const v = validateWorkflowDefinition((parsed.input as { definition: unknown }).definition);
      return v.ok ? { ok: true, input: { ...(parsed.input as object), definition: v.definition } } : { ok: false, reasons: v.issues };
    }
    case "report.recommend": {
      const unknown = (parsed.input as { metrics: string[] }).metrics.filter((m) => !METRIC_KEYS.has(m));
      return unknown.length ? { ok: false, reasons: [`unknown metrics: ${unknown.join(", ")}`] } : { ok: true, input: parsed.input };
    }
    default:
      return { ok: true, input: parsed.input };
  }
}

/** The cited figures, so a merchant reviewing a request sees exactly what it was based on. */
function citedEvidence(e: Evidence, keys: string[]) {
  return { range: e.range, latestDay: e.latestDay, metrics: e.metrics.filter((m) => keys.includes(m.key)) };
}

/**
 * The AI Commerce Manager: a merchant states an objective, the model proposes at most five actions from the action
 * registry, and every surviving proposal becomes a pending request. Nothing runs here. A request executes only when a
 * member who holds that action's permission approves it, on their authority at that moment (services/actions.ts), so
 * the manager can never do more than the approving member could do by hand.
 *
 * Governance, in order: capability and allowance → bounded model call → output schema → per proposal: registry and
 * origin → input schema → store-scoped business rules and the campaign policy gate → evidence (cited metrics must
 * exist; numbers in the rationale must be in the evidence) → queued for approval → audited.
 */
export async function planObjective(d: Deps, store: Store, actorId: string, objective: string) {
  await requireCapability(d, store.organizationId, "ai.commerce_manager");
  const context = await aiContext(d, store, ["store", "campaigns", "metrics", "actions"]);
  const evidence = context.metrics!;
  const allowedNumbers = evidenceNumbers(evidence);

  const run = await runAITask(d, {
    store, actorId, task: "objective.plan", descriptor: `plan: ${objective}`,
    system: [
      "You are a careful assistant for an online store. Propose at most five actions that serve the merchant's objective.",
      "Use only actions listed in <context>.actions, with inputs matching each action exactly. Reference only campaign ids in <context>.campaigns.",
      "Never offer a discount or promotion. Never mention individual shoppers.",
      "Each rationale may quote only figures inside <context>.metrics, and must list the metric keys it relies on in `evidence`.",
      "Attributed orders are credit by last click, not proof a campaign caused a sale. If the data cannot support a proposal, propose nothing.",
      'Answer as JSON: {"interpretation": string, "proposals": [{"action": string, "input": object, "rationale": string, "evidence": string[]}]}.',
    ].join("\n"),
    user: `${fenceData("objective", objective)}\n${fenceData("context", context)}`,
  });

  const planId = newId("pln");
  const queued: string[] = [];
  const discarded: Discarded[] = [];
  for (const p of run.output.proposals) {
    const reasons: string[] = [];
    if (!isActionKey(p.action)) { discarded.push({ action: p.action.slice(0, 60), reasons: ["not a registered action"] }); continue; }
    const notAllowed = actionNotAllowedFor(p.action, "ai");
    if (notAllowed) { discarded.push({ action: p.action, reasons: [notAllowed] }); continue; }
    // Every AI action needs approval by contract; refuse to queue one that would not.
    if (!needsApproval(p.action, "ai")) { discarded.push({ action: p.action, reasons: ["AI actions must be approved"] }); continue; }
    const badEvidence = p.evidence.filter((k) => !METRIC_KEYS.has(k));
    if (badEvidence.length) reasons.push(`cites unknown metrics: ${badEvidence.join(", ")}`);
    const invented = unsupportedNumbers(p.rationale, allowedNumbers);
    if (invented.length) reasons.push(`figures not in the evidence: ${invented.join(", ")}`);
    const checked = await checkProposal(d, store, p.action, p.input, objective);
    if (!checked.ok) reasons.push(...checked.reasons);
    if (!checked.ok || reasons.length) { discarded.push({ action: p.action, reasons }); continue; }
    queued.push(await createActionRequest(d, {
      storeId: store.id, organizationId: store.organizationId, action: p.action, input: checked.input, origin: "ai",
      rationale: p.rationale, evidence: citedEvidence(evidence, p.evidence), requestedBy: actorId, planId,
    }));
  }

  await recordAudit(d, {
    action: "ai_plan.created", actorId, storeId: store.id, organizationId: store.organizationId, targetType: "ai_plan", targetId: planId,
    summary: { proposed: run.output.proposals.length, queued: queued.length, discarded: discarded.length },
  });
  const stale = evidence.latestDay === null || Date.parse(`${evidence.latestDay}T00:00:00Z`) < d.now().getTime() - 3 * 86_400_000;
  return {
    planId, interpretation: run.output.interpretation, requestIds: queued, discarded, stale,
    evidence: { range: evidence.range, latestDay: evidence.latestDay }, model: run.model, usage: run.usage,
  };
}
