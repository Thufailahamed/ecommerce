import { describe, expect, it } from "vitest";
import { createTwilioVerifier, FakePhoneVerifier, ProviderError } from "./index";

const parseForm = (b: string): Record<string, string> => Object.fromEntries(b.split("&").filter(Boolean).map((kv) => kv.split("=").map((x) => decodeURIComponent(x.replace(/\+/g, " "))) as [string, string]));
type Call = { url: string; method: string; headers: Record<string, string>; form: Record<string, string> };
function mock(...replies: Array<{ status?: number; json?: unknown } | "network">) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), form: parseForm(String(init?.body ?? "")) });
    const r = replies.shift() ?? { status: 201, json: { status: "pending" } };
    if (r === "network") throw new TypeError("fetch failed");
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
const opts = { accountSid: "AC00000000000000000000000000000000", authToken: "tok", serviceSid: "VA00000000000000000000000000000000" };
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as ProviderError; } throw new Error("expected a failure"); };

describe("twilio verify adapter (request shapes only: never run against the real service)", () => {
  it("starts an SMS verification on the service with basic auth and the store's name", async () => {
    const m = mock({ status: 201, json: { status: "pending" } });
    await createTwilioVerifier({ ...opts, fetchFn: m.fetchFn }).start("+14155550123", { friendlyName: "Ember & Oak <script>" });
    expect(m.calls[0]).toMatchObject({ url: "https://verify.twilio.com/v2/Services/VA00000000000000000000000000000000/Verifications", method: "POST" });
    expect(m.calls[0]!.headers["authorization"]).toBe(`Basic ${btoa(`${opts.accountSid}:tok`)}`);
    expect(m.calls[0]!.form).toEqual({ To: "+14155550123", Channel: "sms", CustomFriendlyName: "Ember & Oak script" });
  });

  it("approves only when Twilio says approved", async () => {
    const m = mock({ status: 200, json: { status: "approved", valid: true } }, { status: 200, json: { status: "pending", valid: false } });
    const v = createTwilioVerifier({ ...opts, fetchFn: m.fetchFn });
    expect(await v.check("+14155550123", "123456")).toBe(true);
    expect(await v.check("+14155550123", "000000")).toBe(false);
    expect(m.calls[0]).toMatchObject({ url: "https://verify.twilio.com/v2/Services/VA00000000000000000000000000000000/VerificationCheck", form: { To: "+14155550123", Code: "123456" } });
  });

  it("a code for a number with no pending verification is simply wrong; a malformed code never leaves the server", async () => {
    const m = mock({ status: 404, json: { code: 20404 } });
    const v = createTwilioVerifier({ ...opts, fetchFn: m.fetchFn });
    expect(await v.check("+14155550123", "123456")).toBe(false);
    expect(await v.check("+14155550123", "12ab")).toBe(false);
    expect(m.calls).toHaveLength(1);
  });

  it("maps failures to kinds without copying Twilio's message, which can echo the number", async () => {
    const v = (r: { status: number; json?: unknown } | "network") => createTwilioVerifier({ ...opts, fetchFn: mock(r).fetchFn });
    const bad = await failure(v({ status: 400, json: { code: 60200, message: "Invalid parameter To: +1415555" } }).start("+1415555"));
    expect(bad.kind).toBe("rejected");
    expect(bad.message).toBe("HTTP 400: Twilio error 60200");
    expect((await failure(v({ status: 429, json: { code: 60203 } }).start("+14155550123"))).kind).toBe("rate_limited");
    expect((await failure(v({ status: 401 }).start("+14155550123"))).kind).toBe("auth");
    expect((await failure(v({ status: 503 }).check("+14155550123", "123456"))).kind).toBe("transient");
    expect((await failure(v("network").start("+14155550123"))).kind).toBe("transient");
  });

  it("is live only against the real origin", () => {
    expect(createTwilioVerifier(opts).live).toBe(true);
    expect(createTwilioVerifier({ ...opts, baseUrl: "http://localhost:4400" }).live).toBe(false);
  });
});

describe("fake phone verifier", () => {
  it("issues a fresh code per start, accepts it once, and can be told to fail", async () => {
    const f = new FakePhoneVerifier();
    await f.start("+14155550123");
    const code = f.codeFor("+14155550123")!;
    expect(await f.check("+14155550123", "999999")).toBe(false);
    expect(await f.check("+14155550123", code)).toBe(true);
    expect(await f.check("+14155550123", code)).toBe(false);
    f.failNext("rate_limited");
    expect((await failure(f.start("+14155550123"))).kind).toBe("rate_limited");
  });
});
