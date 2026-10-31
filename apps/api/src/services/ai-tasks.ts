import { desc, eq } from "drizzle-orm";
import { AI_TASKS, TaskOutputError, fenceData, parseTaskOutput, type AITask, type TaskOutput, type UsageInfo } from "@convertflow/ai";
import { ACTIONS, actionNotAllowedFor, type ActionKey } from "@convertflow/contracts";
import { schema } from "@convertflow/database";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { catalogForAI } from "./catalog.js";
import { recordUsage, requireCapability, requireQuota } from "./entitlements.js";
import { evidenceNumbers, metricSnapshot, type Evidence } from "./metrics.js";

type Store = typeof schema.stores.$inferSelect;
type GenericTask = Exclude<AITask, "campaign.generate">;
const TIMEOUT_MS = 25_000;

/** USD per million tokens, from the AI_COST_RATES setting. Unknown model: no estimate (never a guess). */
export function estimateCostUsd(d: Deps, u: UsageInfo): number | null {
  const r = d.aiCostRates?.[u.model];
  if (!r || u.inputTokens === undefined || u.outputTokens === undefined) return null;
  return Math.round(((u.inputTokens * r.inputPerMTok + u.outputTokens * r.outputPerMTok) / 1_000_000) * 1e6) / 1e6;
}

/* ---------- authorised context ---------- */

export type ContextScope = "store" | "catalog" | "campaigns" | "metrics" | "actions";

/**
 * What a task may show the model about a store, assembled from domain services, and only the scopes the task asks for.
 * There is no scope for contacts or orders: no personal data ever reaches a model. Catalog text is sanitised by
 * `catalogForAI`, and everything is passed as fenced data, never as instructions.
 */
export async function aiContext(d: Deps, store: Store, scopes: readonly ContextScope[]) {
  const ctx: { store?: unknown; catalog?: unknown; campaigns?: unknown; metrics?: Evidence; actions?: unknown } = {};
  if (scopes.includes("store")) ctx.store = { name: store.name, platform: store.platform, currency: store.currency, promotionsAllowed: store.maxDiscountPercent !== null, maxDiscountPercent: store.maxDiscountPercent };
  if (scopes.includes("catalog")) ctx.catalog = (await catalogForAI(d, store.id, store.domain)).slice(0, 40);
  if (scopes.includes("campaigns")) ctx.campaigns = (await d.db.select({ id: schema.campaigns.id, name: schema.campaigns.name, tool: schema.campaigns.tool, status: schema.campaigns.status })
    .from(schema.campaigns).where(eq(schema.campaigns.storeId, store.id)).orderBy(desc(schema.campaigns.updatedAt)).limit(30));
  if (scopes.includes("metrics")) ctx.metrics = await metricSnapshot(d, store.id);
  if (scopes.includes("actions")) ctx.actions = (Object.keys(ACTIONS) as ActionKey[]).filter((k) => !actionNotAllowedFor(k, "ai"))
    .map((k) => ({ action: k, description: ACTIONS[k].description, sideEffects: ACTIONS[k].sideEffects }));
  return ctx;
}

/* ---------- one way to run a task ---------- */

export interface TaskRun<T extends GenericTask> { output: TaskOutput<T>; model: string; durationMs: number; usage: { inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null } }

/**
 * The governed path for every generic AI task: capability and monthly allowance, a bounded call, schema validation,
 * then the caller's business rules (`check` returns problems). Every attempt is metered and logged (task, provider,
 * model, tokens, estimated cost, duration, outcome); the stored "prompt" is a short descriptor, never the data.
 */
export async function runAITask<T extends GenericTask>(d: Deps, a: {
  store: Store; actorId: string; task: T; system: string; user: string; descriptor: string; check?: (o: TaskOutput<T>) => string[];
}): Promise<TaskRun<T>> {
  if (!d.aiText) throw new HttpError(502, "ai_unavailable", "AI is not configured on this deployment");
  await requireCapability(d, a.store.organizationId, "ai.generate");
  await requireQuota(d, a.store.organizationId, "ai_generations", (q) => `You've used all ${q.limit} AI generations for this month`);

  const started = Date.now();
  const log = (status: "succeeded" | "rejected" | "failed", extra: { model?: string; usage?: UsageInfo; error?: string } = {}) =>
    d.db.insert(schema.aiGenerations).values({
      id: newId("gen"), storeId: a.store.id, organizationId: a.store.organizationId, requestedBy: a.actorId, task: a.task,
      prompt: a.descriptor.slice(0, 300), status, provider: d.aiProviderName ?? "workers_ai", model: extra.model ?? null,
      inputTokens: extra.usage?.inputTokens ?? null, outputTokens: extra.usage?.outputTokens ?? null,
      estimatedCostUsd: extra.usage ? estimateCostUsd(d, extra.usage) : null, durationMs: Date.now() - started,
      error: extra.error?.slice(0, 500) ?? null, createdAt: d.now().toISOString(),
    });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: { text: string; usage: UsageInfo };
  try {
    res = await d.aiText.complete({ system: a.system, user: a.user, maxTokens: AI_TASKS[a.task].maxOutputTokens, json: true }, ctl.signal);
  } catch (e) {
    const timedOut = e instanceof Error && e.message === "timeout";
    await log("failed", { error: e instanceof Error ? e.message : "unknown" });
    throw new HttpError(timedOut ? 504 : 502, timedOut ? "ai_timeout" : "ai_failed", "The AI request failed. Please try again.");
  } finally { clearTimeout(timer); }
  await recordUsage(d, a.store.organizationId, "ai_generations"); // the provider cost is incurred whatever the outcome

  let output: TaskOutput<T>;
  try { output = parseTaskOutput(a.task, res.text); }
  catch (e) {
    const issues = e instanceof TaskOutputError ? e.issues : ["unreadable"];
    await log("rejected", { model: res.usage.model, usage: res.usage, error: issues.join("; ") });
    throw new HttpError(422, "ai_output_rejected", "The AI's answer didn't pass validation. Try again.", issues);
  }
  const problems = a.check?.(output) ?? [];
  if (problems.length) {
    await log("rejected", { model: res.usage.model, usage: res.usage, error: problems.join("; ") });
    throw new HttpError(422, "ai_output_rejected", "The AI's answer didn't pass the platform's checks. Try again.", problems);
  }
  await log("succeeded", { model: res.usage.model, usage: res.usage });
  return {
    output, model: res.usage.model, durationMs: Date.now() - started,
    usage: { inputTokens: res.usage.inputTokens ?? null, outputTokens: res.usage.outputTokens ?? null, estimatedCostUsd: estimateCostUsd(d, res.usage) },
  };
}

/* ---------- insights.summarize ---------- */

/** Numbers in model text that are not in the evidence (beyond tiny counts and the window itself) are invented. */
export function unsupportedNumbers(text: string, allowed: Set<string>): string[] {
  return [...new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => t.replace(/,/g, "")))]
    .filter((n) => !allowed.has(n) && !(Number.isInteger(Number(n)) && Number(n) <= 10));
}

/**
 * Plain-language summary of the last `days`. With no data at all the answer is deterministic and no model is called.
 * The model sees only the aggregate evidence, and any figure it quotes must be one of those numbers.
 */
export async function summarizeInsights(d: Deps, store: Store, actorId: string, days: number) {
  const evidence = await metricSnapshot(d, store.id, days);
  const latest = evidence.latestDay;
  const stale = latest === null || Date.parse(`${latest}T00:00:00Z`) < d.now().getTime() - 3 * 86_400_000;
  if (latest === null) {
    return { generatedBy: "rule" as const, summary: "There is no campaign or order data for this period yet, so there is nothing to summarise.", highlights: [], evidence, stale };
  }
  const allowed = evidenceNumbers(evidence);
  allowed.add(String(days));
  const run = await runAITask(d, {
    store, actorId, task: "insights.summarize", descriptor: `insights ${days}d`,
    system: [
      "You explain an online store's campaign performance to its owner in plain language.",
      "Use only the figures inside <evidence>. Do not compute new figures, do not estimate, and do not invent numbers.",
      "Attributed orders are credit by last click, not proof that a campaign caused a sale; say so if you mention them.",
      "Never mention individual shoppers. Answer as JSON: {\"summary\": string, \"highlights\": string[] (at most 5)}.",
    ].join("\n"),
    user: fenceData("evidence", { windowDays: days, ...evidence }),
    check: (o) => {
      const bad = unsupportedNumbers([o.summary, ...o.highlights].join(" "), allowed);
      return bad.length ? [`figures not in the evidence: ${bad.join(", ")}`] : [];
    },
  });
  return { generatedBy: "ai" as const, summary: run.output.summary, highlights: run.output.highlights, evidence, stale, model: run.model, usage: run.usage };
}
