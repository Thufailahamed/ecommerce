import { describe, expect, it } from "vitest";
import { AIRequestError, BindingChatModel, GatewayChatModel, GatewayImageModel, workersAiModel } from "./gateway.js";

const sse = (frames: string[]) => new ReadableStream<Uint8Array>({
  start(c) { const e = new TextEncoder(); for (const f of frames) c.enqueue(e.encode(f)); c.close(); },
});

function recorder(respond: (body: Record<string, unknown>) => Response) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    return respond(body);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const opts = { accountId: "acc", gatewayId: "gw", apiToken: "tok", gatewayToken: "gtok" };

describe("AI Gateway REST transport", () => {
  it("calls the OpenAI-compatible endpoint with both tokens and the provider-first model", async () => {
    const { calls, fetchFn } = recorder(() => Response.json({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
    const m = new GatewayChatModel({ ...opts, fetchFn });
    const r = await m.complete({ messages: [{ role: "user", content: "hi" }], maxTokens: 50 });
    expect(calls[0]!.url).toBe("https://gateway.ai.cloudflare.com/v1/acc/gw/compat/chat/completions");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok");
    expect(calls[0]!.headers["cf-aig-authorization"]).toBe("Bearer gtok");
    expect(calls[0]!.body).toMatchObject({ model: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast", max_tokens: 50, stream: false });
    expect(r).toEqual({ text: "{}", usage: { model: m.model, inputTokens: 12, outputTokens: 3 } });
  });

  it("streams deltas from server-sent events split across chunks", async () => {
    const frames = ['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\nda', 'ta: {"choices":[{"delta":{"content":"lo"}}]}\n\n', 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n'];
    const { fetchFn } = recorder(() => new Response(sse(frames)));
    const seen: string[] = [];
    const r = await new GatewayChatModel({ ...opts, fetchFn }).stream({ messages: [], maxTokens: 10 }, (t) => seen.push(t));
    expect(seen).toEqual(["Hel", "lo"]);
    expect(r.text).toBe("Hello");
    expect(r.usage.outputTokens).toBe(2);
  });

  it("surfaces gateway errors with their status", async () => {
    const { fetchFn } = recorder(() => new Response("rate limited", { status: 429 }));
    await expect(new GatewayChatModel({ ...opts, fetchFn }).complete({ messages: [], maxTokens: 1 })).rejects.toBeInstanceOf(AIRequestError);
  });

  it("decodes base64 images from the Workers AI provider route", async () => {
    const { calls, fetchFn } = recorder(() => Response.json({ result: { image: btoa("\xff\xd8abc") }, success: true }));
    const img = await new GatewayImageModel({ ...opts, fetchFn }).generate("a mug");
    expect(calls[0]!.url).toBe("https://gateway.ai.cloudflare.com/v1/acc/gw/workers-ai/@cf/black-forest-labs/flux-1-schnell");
    expect(Array.from(img.bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
  });
});

describe("Workers AI binding transport", () => {
  it("routes through the gateway id and streams the binding's frames", async () => {
    const runs: unknown[][] = [];
    const ai = { async run(...a: unknown[]) { runs.push(a); return sse(['data: {"response":"ok"}\n\n', "data: [DONE]\n\n"]); } };
    const r = await new BindingChatModel(ai, { gatewayId: "default" }).stream({ messages: [], maxTokens: 5 }, () => undefined);
    expect(r.text).toBe("ok");
    expect(runs[0]![0]).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(runs[0]![2]).toEqual({ gateway: { id: "default" } });
  });

  it("refuses non-Workers-AI models on the binding", () => {
    expect(workersAiModel("anthropic/claude")).toBeNull();
    expect(() => new BindingChatModel({ run: async () => ({}) }, { model: "openai/gpt" })).toThrow();
  });
});
