import { AIValidationError, validateProposal, type CampaignGenerationInput } from "@convertflow/ai";
import { CampaignConfig, SHIPPED_TOOLS, type Tool } from "@convertflow/contracts";
import { schema } from "@convertflow/database";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { recordUsage, requireQuota } from "./entitlements.js";
import { estimateCostUsd } from "./ai-tasks.js";
import { catalogForAI } from "./catalog.js";
import { createCampaign, getCampaign, updateDraft, validateDraft } from "./campaigns.js";

const TIMEOUT_MS = 25_000;

export interface GenerateRequest {
  objective: string;
  /** Refine this saved draft in place instead of creating another draft. Only drafts are accepted. */
  campaignId?: string;
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

  await requireQuota(d, store.organizationId, "ai_generations", (q) => `You've used all ${q.limit} AI generations for this month`);

  const previous = req.campaignId ? await getCampaign(d, store.id, req.campaignId) : undefined;
  if (previous && previous.status !== "draft") {
    throw new HttpError(409, "not_draft", "Only draft campaigns can be refined with AI. Open a draft, or duplicate this campaign first.");
  }
  const previousConfig = previous ? CampaignConfig.safeParse(previous.draftConfig) : undefined;
  if (previous && !previousConfig?.success) {
    throw new HttpError(422, "invalid_campaign", "This draft is not valid yet. Fix it in the editor before asking the AI to change it.");
  }
  const { campaignId: _campaignId, ...generationRequest } = req;
  const input: CampaignGenerationInput = {
    ...generationRequest,
    ...(previousConfig?.success ? { previousConfig: previousConfig.data } : {}),
    catalog: await catalogForAI(d, store.id, store.domain), siteDomain: store.domain, currency: store.currency,
  };
  const log = (status: "succeeded" | "rejected" | "failed", extra: Partial<typeof schema.aiGenerations.$inferInsert> = {}) =>
    d.db.insert(schema.aiGenerations).values({ id: newId("gen"), storeId: store.id, organizationId: store.organizationId, requestedBy: actorId, task: "campaign.generate", provider: d.aiProviderName ?? null, durationMs: Date.now() - started, prompt: `${req.tool ? `[${req.tool}] ` : ""}${req.objective}`.slice(0, 1000), status, createdAt: d.now().toISOString(), ...extra });

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const { raw, usage } = await d.ai.generateCampaign(input, ctl.signal);
    // Count the attempt: the provider cost is incurred even if policy rejects the output.
    await recordUsage(d, store.organizationId, "ai_generations");
    const meta = { model: usage.model, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, estimatedCostUsd: estimateCostUsd(d, usage) };
    try {
      // Read at call time, not import time: the shipped set is the single gate for what a merchant can publish.
      const proposal = validateProposal(raw, input, { allowedTools: SHIPPED_TOOLS });
      await log("succeeded", meta);
      // A refinement updates the same draft; a first generation creates one. Nothing is ever published here.
      const draft = previous ? await updateDraft(d, store.id, previous.id, proposal.config) : await createCampaign(d, store.id, actorId, proposal.config);
      const warnings = [...proposal.repairs, ...validateDraft(proposal.config).warnings];
      return {
        campaign: draft, explanation: proposal.explanation, tool: draft.tool, repairs: proposal.repairs, warnings,
        updated: Boolean(previous), model: meta.model, gateway: Boolean(d.aiGatewayId),
        usage: { inputTokens: meta.inputTokens, outputTokens: meta.outputTokens },
      };
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
