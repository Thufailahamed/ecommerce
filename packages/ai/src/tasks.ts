import { z } from "zod";
import type { UsageInfo } from "./index.js";

/**
 * Generic model access for tasks other than campaign generation. Domain code asks for a task by name and gets
 * validated output back; it never talks to a model, and swapping the model or provider changes nothing above this.
 */
export interface CompletionRequest { system: string; user: string; maxTokens: number; json: boolean }
export interface TextAIProvider {
  complete(req: CompletionRequest, signal?: AbortSignal): Promise<{ text: string; usage: UsageInfo }>;
}

/** Plain text a merchant will read: no markup, no control characters, bounded. Model output is untrusted. */
const Plain = (max: number) => z.string().transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim().slice(0, max)).pipe(z.string().min(1));

/**
 * Every AI task. `campaign.generate` keeps its own richer validator (policy.ts); it is listed so usage is reported
 * per task. Tasks that a deterministic rule can answer should not be added here.
 */
export const AI_TASKS = {
  "campaign.generate": { description: "Draft or refine a campaign from a merchant objective", maxOutputTokens: 1500, output: null },
  "insights.summarize": {
    description: "Explain the store's aggregate performance in plain language, citing only the figures supplied",
    maxOutputTokens: 600,
    output: z.object({ summary: Plain(800), highlights: z.array(Plain(200)).max(5).default([]) }),
  },
  "objective.plan": {
    description: "Turn a merchant objective into at most five proposed actions from the action registry, each with its reason",
    maxOutputTokens: 1500,
    output: z.object({
      interpretation: Plain(500),
      proposals: z.array(z.object({
        action: z.string().max(60),
        input: z.unknown(),
        rationale: Plain(600),
        /** Metric keys from the evidence this proposal relies on. */
        evidence: z.array(z.string().max(60)).max(8).default([]),
      })).max(5),
    }),
  },
} as const;

export type AITask = keyof typeof AI_TASKS;
export type TaskOutput<T extends Exclude<AITask, "campaign.generate">> = z.infer<NonNullable<(typeof AI_TASKS)[T]["output"]>>;

export class TaskOutputError extends Error {
  constructor(message: string, readonly issues: string[]) { super(message); }
}

/** Step 1 of AI governance: the output must be JSON that matches the task's schema. */
export function parseTaskOutput<T extends Exclude<AITask, "campaign.generate">>(task: T, text: string): TaskOutput<T> {
  let json: unknown;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { json = JSON.parse(trimmed); } catch { throw new TaskOutputError("The model did not return JSON", ["not JSON"]); }
  const r = (AI_TASKS[task].output as z.ZodType).safeParse(json);
  if (!r.success) throw new TaskOutputError("The model's output did not match the task", r.error.issues.map((i) => `${i.path.join(".") || "output"}: ${i.message}`));
  return r.data as TaskOutput<T>;
}

/**
 * Data the model is shown goes inside a fenced JSON block with angle brackets escaped, so text from the catalog or a
 * merchant cannot close the fence or pose as instructions.
 */
export function fenceData(label: string, data: unknown): string {
  return `<${label}>\n${JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")}\n</${label}>`;
}

/** Test double. Never wired into production code paths. */
export class FakeTextProvider implements TextAIProvider {
  readonly requests: CompletionRequest[] = [];
  constructor(private respond: (req: CompletionRequest) => string | Promise<string>) {}
  async complete(req: CompletionRequest) {
    this.requests.push(req);
    return { text: await this.respond(req), usage: { model: "fake-text", inputTokens: 10, outputTokens: 5 } };
  }
}
