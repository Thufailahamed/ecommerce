import { buildPrompt } from "./prompt.js";
import { AIValidationError, type CampaignGenerationInput } from "./policy.js";

export * from "./policy.js";
export { buildPrompt, sanitizeCatalog, suggestTool } from "./prompt.js";

export interface UsageInfo { model: string; inputTokens?: number; outputTokens?: number }

export interface CampaignAIProvider {
  generateCampaign(input: CampaignGenerationInput, signal?: AbortSignal): Promise<{ raw: unknown; usage: UsageInfo }>;
}

/** Minimal structural type for the Workers AI binding so this package needs no Cloudflare types. */
export interface AiBinding {
  run(model: string, input: unknown, options?: { gateway?: { id: string } }): Promise<unknown>;
}

/** UNVERIFIED against the live service: no Cloudflare account has been available. Everything above this class is tested with fakes. */
export class WorkersAIProvider implements CampaignAIProvider {
  constructor(private ai: AiBinding, private opts: { model: string; gatewayId?: string }) {}

  async generateCampaign(input: CampaignGenerationInput, signal?: AbortSignal) {
    const { system, user } = buildPrompt(input);
    const run = this.ai.run(
      this.opts.model,
      { messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" }, max_tokens: 1500 },
      this.opts.gatewayId ? { gateway: { id: this.opts.gatewayId } } : undefined,
    );
    const out = await withAbort(run, signal);
    const o = out as { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    let raw: unknown = o.response;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { throw new AIValidationError("Model returned invalid JSON", ["not JSON"]); }
    }
    const usage: UsageInfo = { model: this.opts.model };
    if (o.usage?.prompt_tokens !== undefined) usage.inputTokens = o.usage.prompt_tokens;
    if (o.usage?.completion_tokens !== undefined) usage.outputTokens = o.usage.completion_tokens;
    return { raw, usage };
  }
}

function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("timeout"));
    signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    p.then(resolve, reject);
  });
}

/** Test double. Never wired into production code paths. Records every input it was given. */
export class FakeProvider implements CampaignAIProvider {
  readonly inputs: CampaignGenerationInput[] = [];
  constructor(private respond: (i: CampaignGenerationInput) => unknown) {}
  async generateCampaign(input: CampaignGenerationInput) {
    this.inputs.push(input);
    return { raw: this.respond(input), usage: { model: "fake", inputTokens: 1, outputTokens: 1 } };
  }
}

/**
 * Test double that replays recorded model responses in order (the last one repeats) and keeps the exact prompt each call
 * would have sent, so tests can assert on what the model is shown. Never wired into production code paths.
 */
export class RecordedProvider implements CampaignAIProvider {
  readonly calls: Array<{ input: CampaignGenerationInput; system: string; user: string }> = [];
  constructor(private responses: unknown[]) {}
  async generateCampaign(input: CampaignGenerationInput) {
    const { system, user } = buildPrompt(input);
    this.calls.push({ input, system, user });
    const raw = this.responses[Math.min(this.calls.length - 1, this.responses.length - 1)];
    return { raw, usage: { model: "recorded", inputTokens: 1, outputTokens: 1 } };
  }
}
