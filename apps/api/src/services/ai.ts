import { and, eq, sql } from "drizzle-orm";
import { AIValidationError, validateProposal, type CampaignGenerationInput } from "@convertflow/ai";
import { SHIPPED_TOOLS, type Tool } from "@convertflow/contracts";
import { schema } from "@convertflow/database";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { getPlan } from "./stores.js";
import { catalogForAI } from "./catalog.js";
import { createCampaign, validateDraft } from "./campaigns.js";

const TIMEOUT_MS = 25_000;

export interface GenerateRequest {
  objective: string;
  /** Omit to let the model choose among the available tools. */
  tool?: Tool;
  format?: CampaignGenerationInput["format"];
  constraints?: string;
  allowedPromotion?: string;
  freeShippingThreshold?: number;
  consentText?: string;
  privacyUrl?: string;
  feedback?: string;
}

export async function generateCampaignDraft(d: Deps, store: typeof schema.stores.$inferSelect, actorId: string, req: GenerateRequest) {
  if (!d.ai) throw new HttpError(502, "ai_unavailable", "AI generation is not configured");
  // Refuse a tool that cannot be published before spending a generation on it.
  if (req.tool && !SHIPPED_TOOLS.has(req.tool)) throw new HttpError(409, "tool_unavailable", `The ${req.tool} tool is not available yet`);

  const plan = await getPlan(d, store.organizationId);
  const period = d.now().toISOString().slice(0, 7);
  const [u] = await d.db.select().from(schema.usageRecords)
    .where(and(eq(schema.usageRecords.organizationId, store.organizationId), eq(schema.usageRecords.metric, "ai_generations"), eq(schema.usageRecords.period, period))).limit(1);
  if ((u?.count ?? 0) >= plan.aiGenerationsPerMonth) throw new HttpError(402, "plan_limit", `You've used all ${plan.aiGenerationsPerMonth} AI generations for this month`);

  const input: CampaignGenerationInput = {
    ...req, catalog: await catalogForAI(d, store.id, store.domain), siteDomain: store.domain, currency: store.currency,
  };
  const log = (status: "succeeded" | "rejected" | "failed", extra: Partial<typeof schema.aiGenerations.$inferInsert> = {}) =>
    d.db.insert(schema.aiGenerations).values({ id: newId("gen"), storeId: store.id, requestedBy: actorId, prompt: `${req.tool ? `[${req.tool}] ` : ""}${req.objective}`.slice(0, 1000), status, createdAt: d.now().toISOString(), ...extra });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const { raw, usage } = await d.ai.generateCampaign(input, ctl.signal);
    // Count the attempt: the provider cost is incurred even if policy rejects the output.
    await d.db.insert(schema.usageRecords).values({ organizationId: store.organizationId, metric: "ai_generations", period, count: 1 })
      .onConflictDoUpdate({ target: [schema.usageRecords.organizationId, schema.usageRecords.metric, schema.usageRecords.period], set: { count: sql`${schema.usageRecords.count} + 1` } });
    const meta = { model: usage.model, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null };
    try {
      // Read at call time, not import time: the shipped set is the single gate for what a merchant can publish.
      const proposal = validateProposal(raw, input, { allowedTools: SHIPPED_TOOLS });
      await log("succeeded", meta);
      const draft = await createCampaign(d, store.id, actorId, proposal.config);
      // Always a draft: publishing stays a separate, human-approved step with its own guards.
      const warnings = [...proposal.repairs, ...validateDraft(proposal.config).warnings];
      return { campaign: draft, explanation: proposal.explanation, tool: draft.tool, repairs: proposal.repairs, warnings };
    } catch (e) {
      if (e instanceof AIValidationError) {
        await log("rejected", { ...meta, error: e.issues.join("; ").slice(0, 500) });
        throw new HttpError(422, "ai_proposal_rejected", "The AI proposal didn't pass validation. Try rephrasing your goal.", e.issues);
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof AIValidationError) {
      await log("rejected", { error: e.issues.join("; ").slice(0, 500) });
      throw new HttpError(422, "ai_proposal_rejected", "The AI returned unusable output. Please try again.", e.issues);
    }
    const timedOut = e instanceof Error && e.message === "timeout";
    await log("failed", { error: (e instanceof Error ? e.message : "unknown").slice(0, 300) });
    throw new HttpError(timedOut ? 504 : 502, timedOut ? "ai_timeout" : "ai_failed", "AI generation failed. You can build the campaign manually or try again.");
  } finally {
    clearTimeout(timer);
  }
}
