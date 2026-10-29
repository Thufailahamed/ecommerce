/**
 * Opt-in live probe; skipped by the normal suite. Run with:
 *   LIVE_AI=1 CF_AI_TOKEN=... CF_ACCOUNT_ID=... CF_AI_MODEL=... pnpm --filter @convertflow/api exec vitest run test/live-ai.test.ts
 * It makes a real, billable Workers AI request through AI Gateway "default".
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { WorkersAIProvider, DEFAULT_AI_MODEL } from "@convertflow/ai";
import { schema } from "@convertflow/database";
import { makeEnv, setupStore } from "./helpers.js";
import { generateCampaignDraft } from "../src/services/ai.js";

const token = process.env["CF_AI_TOKEN"];
const account = process.env["CF_ACCOUNT_ID"];
const enabled = process.env["LIVE_AI"] === "1" && Boolean(token) && Boolean(account);

/** Calls the Workers AI REST API with the Gateway header. Only used by this opt-in live probe. */
const binding = {
  async run(model: string, input: unknown, options?: { gateway?: { id: string } }) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(options?.gateway?.id ? { "cf-aig-gateway-id": options.gateway.id } : {}),
      },
      body: JSON.stringify(input),
    });
    const json = await res.json() as { success?: boolean; errors?: unknown; result?: unknown };
    if (!res.ok || !json.success) throw new Error(JSON.stringify(json.errors ?? json));
    return json.result;
  },
};

describe.skipIf(!enabled)("live AI generation", () => {
  it("runs the real prompt, policy gate and campaign creation through AI Gateway", { timeout: 60_000 }, async () => {
    let lastRaw: unknown;
    const base = new WorkersAIProvider(binding, { model: process.env["CF_AI_MODEL"] ?? DEFAULT_AI_MODEL, gatewayId: "default" });
    const provider = {
      async generateCampaign(input: Parameters<typeof base.generateCampaign>[0], signal?: AbortSignal) {
        const r = await base.generateCampaign(input, signal);
        lastRaw = r.raw;
        return r;
      },
    };
    const env = await makeEnv(provider);
    env.deps.aiGatewayId = "default";
    const s = await setupStore(env, `live-ai-${Date.now()}@example.com`);
    const [store] = await env.deps.db.select().from(schema.stores).where(eq(schema.stores.id, s.storeId));
    try {
      const result = await generateCampaignDraft(env.deps, store!, s.userId, {
        objective: "Announce our new summer collection to returning shoppers on the home page.",
        tool: "toast",
        constraints: "Friendly and concise. No discounts, urgency or stock claims.",
      });
      expect(result.campaign.status).toBe("draft");
      expect(result.campaign.publishedVersionId).toBeNull();
      expect(result.campaign.draftConfig).toBeTruthy();
      console.log(JSON.stringify({ model: result.model, gateway: result.gateway, usage: result.usage, campaign: result.campaign.draftConfig, explanation: result.explanation, warnings: result.warnings }, null, 2));
    } catch (e) {
      console.log("RAW MODEL OUTPUT:", JSON.stringify(lastRaw, null, 2));
      throw e;
    }
  });
});
