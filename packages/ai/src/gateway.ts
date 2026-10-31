import type { AiBinding, UsageInfo } from "./index.js";

/**
 * Chat and image models for the AI store builder, reached through Cloudflare AI Gateway.
 *
 * Two transports, same behaviour:
 * - REST: the Gateway's OpenAI-compatible endpoint (`/compat/chat/completions`). Works anywhere, including local
 *   development, with an account id and an API token. The model is written provider-first
 *   ("workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast"), so the Gateway can also route to other providers it holds
 *   keys for ("anthropic/…", "openai/…") without code changes.
 * - Binding: the Worker's `AI` binding with `{ gateway: { id } }`. Workers AI models only.
 *
 * UNVERIFIED against the live service from this repository's test suite (fakes only); see apps/api/test/live-builder.test.ts.
 */

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatRequest { messages: ChatMessage[]; maxTokens: number; temperature?: number; json?: boolean }
export interface ChatResult { text: string; usage: UsageInfo }

export interface ChatModel {
  readonly model: string;
  complete(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
  /** Streams text; `onDelta` gets each new piece. Resolves with the whole text. */
  stream(req: ChatRequest, onDelta: (text: string) => void, signal?: AbortSignal): Promise<ChatResult>;
}

export interface ImageModel {
  readonly model: string;
  generate(prompt: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string }>;
}

export class AIRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const DEFAULT_BUILDER_MODEL = "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/** "workers-ai/@cf/x" -> "@cf/x"; other providers have no binding form. */
export const workersAiModel = (model: string): string | null => (model.startsWith("workers-ai/") ? model.slice("workers-ai/".length) : model.startsWith("@cf/") ? model : null);

interface OpenAIUsage { prompt_tokens?: number; completion_tokens?: number }
const usageOf = (model: string, u?: OpenAIUsage): UsageInfo => ({
  model,
  ...(u?.prompt_tokens !== undefined ? { inputTokens: u.prompt_tokens } : {}),
  ...(u?.completion_tokens !== undefined ? { outputTokens: u.completion_tokens } : {}),
});

/** Reads an SSE body and calls `onData` with each `data:` payload. */
async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw new Error("timeout");
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith("data:")) onData(line.slice(5).trim());
      }
    }
    if (buf.trim().startsWith("data:")) onData(buf.trim().slice(5).trim());
    if (signal?.aborted) throw new Error("timeout");
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export interface GatewayRestOptions {
  accountId: string;
  gatewayId: string;
  /** Provider key for the Gateway request. For Workers AI: a Cloudflare API token with Workers AI read access. */
  apiToken: string;
  /** Set when the gateway has Authenticated Gateway turned on. */
  gatewayToken?: string;
  model?: string;
  fetchFn?: typeof fetch;
  /** Replaces https://gateway.ai.cloudflare.com (tests). */
  baseUrl?: string;
}

export class GatewayChatModel implements ChatModel {
  readonly model: string;
  constructor(private o: GatewayRestOptions) { this.model = o.model ?? DEFAULT_BUILDER_MODEL; }

  private url() { return `${this.o.baseUrl ?? "https://gateway.ai.cloudflare.com"}/v1/${this.o.accountId}/${this.o.gatewayId}/compat/chat/completions`; }
  private headers() {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.o.apiToken}`,
      ...(this.o.gatewayToken ? { "cf-aig-authorization": `Bearer ${this.o.gatewayToken}` } : {}),
    };
  }
  private async post(req: ChatRequest, stream: boolean, signal?: AbortSignal) {
    const res = await (this.o.fetchFn ?? fetch)(this.url(), {
      method: "POST", headers: this.headers(), ...(signal ? { signal } : {}),
      body: JSON.stringify({
        model: this.model, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature ?? 0.6, stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AIRequestError(res.status, `AI Gateway returned ${res.status}: ${text.slice(0, 300)}`);
    }
    return res;
  }

  async complete(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const res = await this.post(req, false, signal);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: OpenAIUsage };
    return { text: j.choices?.[0]?.message?.content ?? "", usage: usageOf(this.model, j.usage) };
  }

  async stream(req: ChatRequest, onDelta: (t: string) => void, signal?: AbortSignal): Promise<ChatResult> {
    const res = await this.post(req, true, signal);
    if (!res.body) return this.complete(req, signal);
    let text = "";
    let usage: OpenAIUsage | undefined;
    await readSse(res.body, (data) => {
      if (data === "[DONE]") return;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: OpenAIUsage; response?: string };
        const piece = j.choices?.[0]?.delta?.content ?? j.response ?? "";
        if (piece) { text += piece; onDelta(piece); }
        if (j.usage) usage = j.usage;
      } catch { /* keep-alive or a partial frame */ }
    }, signal);
    return { text, usage: usageOf(this.model, usage) };
  }
}

export class GatewayImageModel implements ImageModel {
  readonly model: string;
  constructor(private o: GatewayRestOptions & { imageModel?: string }) { this.model = o.imageModel ?? DEFAULT_IMAGE_MODEL; }

  async generate(prompt: string, signal?: AbortSignal) {
    const res = await (this.o.fetchFn ?? fetch)(`${this.o.baseUrl ?? "https://gateway.ai.cloudflare.com"}/v1/${this.o.accountId}/${this.o.gatewayId}/workers-ai/${this.model}`, {
      method: "POST", ...(signal ? { signal } : {}),
      headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiToken}`, ...(this.o.gatewayToken ? { "cf-aig-authorization": `Bearer ${this.o.gatewayToken}` } : {}) },
      body: JSON.stringify({ prompt, steps: 6 }),
    });
    if (!res.ok) throw new AIRequestError(res.status, `Image generation returned ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: type };
    const j = (await res.json()) as { result?: { image?: string }; image?: string };
    const b64 = j.result?.image ?? j.image;
    if (!b64) throw new AIRequestError(502, "Image generation returned no image");
    return { bytes: base64ToBytes(b64), contentType: "image/jpeg" };
  }
}

/* ---------- Workers AI binding (deployed Worker) ---------- */

export class BindingChatModel implements ChatModel {
  readonly model: string;
  private readonly runModel: string;
  constructor(private ai: AiBinding, opts: { model?: string; gatewayId?: string }, private gatewayId = opts.gatewayId) {
    this.model = opts.model ?? DEFAULT_BUILDER_MODEL;
    const m = workersAiModel(this.model);
    if (!m) throw new Error(`${this.model} is not a Workers AI model; configure AI Gateway REST access to use other providers`);
    this.runModel = m;
  }
  private run(req: ChatRequest, stream: boolean) {
    return this.ai.run(this.runModel, {
      messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature ?? 0.6, stream,
      ...(req.json && !stream ? { response_format: { type: "json_object" } } : {}),
    }, this.gatewayId ? { gateway: { id: this.gatewayId } } : undefined);
  }

  async complete(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const o = (await withAbort(this.run(req, false), signal)) as { response?: unknown; usage?: OpenAIUsage };
    return { text: typeof o.response === "string" ? o.response : JSON.stringify(o.response ?? ""), usage: usageOf(this.model, o.usage) };
  }

  async stream(req: ChatRequest, onDelta: (t: string) => void, signal?: AbortSignal): Promise<ChatResult> {
    const out = await withAbort(this.run(req, true), signal);
    if (!(out instanceof ReadableStream)) {
      const o = out as { response?: unknown; usage?: OpenAIUsage };
      const text = typeof o.response === "string" ? o.response : "";
      if (text) onDelta(text);
      return { text, usage: usageOf(this.model, o.usage) };
    }
    let text = "";
    let usage: OpenAIUsage | undefined;
    await readSse(out as ReadableStream<Uint8Array>, (data) => {
      if (data === "[DONE]") return;
      try {
        const j = JSON.parse(data) as { response?: string; usage?: OpenAIUsage };
        if (j.response) { text += j.response; onDelta(j.response); }
        if (j.usage) usage = j.usage;
      } catch { /* partial frame */ }
    }, signal);
    return { text, usage: usageOf(this.model, usage) };
  }
}

export class BindingImageModel implements ImageModel {
  constructor(private ai: AiBinding, readonly model: string = DEFAULT_IMAGE_MODEL, private gatewayId?: string) {}
  async generate(prompt: string, signal?: AbortSignal) {
    const o = (await withAbort(this.ai.run(this.model, { prompt, steps: 6 }, this.gatewayId ? { gateway: { id: this.gatewayId } } : undefined), signal)) as { image?: string } | ReadableStream;
    if (o instanceof ReadableStream) return { bytes: new Uint8Array(await new Response(o).arrayBuffer()), contentType: "image/png" };
    if (!o.image) throw new AIRequestError(502, "Image generation returned no image");
    return { bytes: base64ToBytes(o.image), contentType: "image/jpeg" };
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

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]+,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- test doubles (never wired into production code paths) ---------- */

/** Replies from a function of the request; streams the reply in small pieces like a real model. */
export class FakeChatModel implements ChatModel {
  readonly model = "fake-chat";
  readonly requests: ChatRequest[] = [];
  constructor(private respond: (req: ChatRequest, n: number) => string | Promise<string>) {}
  async complete(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    return { text: await this.respond(req, this.requests.length), usage: { model: this.model, inputTokens: 100, outputTokens: 50 } };
  }
  async stream(req: ChatRequest, onDelta: (t: string) => void): Promise<ChatResult> {
    const r = await this.complete(req);
    for (let i = 0; i < r.text.length; i += 12) onDelta(r.text.slice(i, i + 12));
    return r;
  }
}

export class FakeImageModel implements ImageModel {
  readonly model = "fake-image";
  readonly prompts: string[] = [];
  fail = false;
  async generate(prompt: string) {
    this.prompts.push(prompt);
    if (this.fail) throw new AIRequestError(500, "image model down");
    return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: "image/jpeg" };
  }
}
