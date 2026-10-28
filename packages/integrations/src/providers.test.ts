import { describe, expect, it } from "vitest";
import { createAdapter, FakeProvider, KLAVIYO_REVISION, mailchimpDataCentre, md5Hex, ProviderError, type ProviderContact } from "./providers";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
/** A fetch that records requests and answers from a script, in order. */
function mock(...replies: Array<{ status?: number; json?: unknown; headers?: Record<string, string> } | "network">) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = replies.shift() ?? { status: 200, json: {} };
    if (r === "network") throw new TypeError("fetch failed");
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: r.headers ?? {} });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
const person: ProviderContact = { channel: "email", email: "Ada@Example.com", firstName: "Ada", consentedAt: "2026-10-27T10:00:00.000Z", source: "form:cmp_1" };
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as ProviderError; } throw new Error("expected a failure"); };

describe("md5", () => {
  it("matches the standard test vectors", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
    expect(md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890")).toBe("57edf4a22be3c955ac49da2e2107b67a"); // spans two blocks
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("é")).toMatch(/^[0-9a-f]{32}$/); // multi-byte input is hashed as UTF-8 without throwing
  });
});

describe("klaviyo adapter (request shapes only: never run against the real service)", () => {
  const key = { apiKey: "pk_test" };

  it("lists the account's lists, following pages that stay on the same origin", async () => {
    const m = mock(
      { json: { data: [{ id: "L1", attributes: { name: "Newsletter" } }], links: { next: "https://a.klaviyo.com/api/lists?page%5Bcursor%5D=x" } } },
      { json: { data: [{ id: "L2", attributes: { name: "VIPs" } }], links: { next: "https://evil.example/steal" } } },
    );
    const lists = await createAdapter("klaviyo", key, { fetchFn: m.fetchFn }).checkConnection();
    expect(lists).toEqual([{ id: "L1", name: "Newsletter" }, { id: "L2", name: "VIPs" }]);
    expect(m.calls).toHaveLength(2); // never followed the foreign link, so the key never left
    expect(m.calls[0]).toMatchObject({ method: "GET", headers: { authorization: "Klaviyo-API-Key pk_test", revision: KLAVIYO_REVISION } });
  });

  it("subscribes with the consent time and source, after a profile upsert that carries the first name", async () => {
    const m = mock({ status: 201, json: { data: { id: "PROFILE1" } } }, { status: 202 });
    const r = await createAdapter("klaviyo", key, { fetchFn: m.fetchFn }).subscribe("L1", person);
    expect(r).toEqual({ ref: "PROFILE1" });
    expect(m.calls[0]).toMatchObject({ url: "https://a.klaviyo.com/api/profile-import/", method: "POST", body: { data: { type: "profile", attributes: { email: "Ada@Example.com", first_name: "Ada" } } } });
    expect(m.calls[1]!.url).toBe("https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/");
    expect(m.calls[1]!.body).toEqual({
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: { custom_source: "form:cmp_1", profiles: { data: [{ type: "profile", attributes: { email: "Ada@Example.com", subscriptions: { email: { marketing: { consent: "SUBSCRIBED", consented_at: "2026-10-27T10:00:00.000Z" } } } } }] } },
        relationships: { list: { data: { type: "list", id: "L1" } } },
      },
    });
  });

  it("skips the profile upsert when there is no first name", async () => {
    const m = mock({ status: 202 });
    await createAdapter("klaviyo", key, { fetchFn: m.fetchFn }).subscribe("L1", { ...person, firstName: undefined });
    expect(m.calls.map((c) => c.url)).toEqual(["https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/"]);
  });

  it("unsubscribes through the bulk delete job", async () => {
    const m = mock({ status: 202 });
    await createAdapter("klaviyo", key, { fetchFn: m.fetchFn }).unsubscribe("L1", person);
    expect(m.calls[0]).toMatchObject({ url: "https://a.klaviyo.com/api/profile-subscription-bulk-delete-jobs/", method: "POST" });
    expect(m.calls[0]!.body).toMatchObject({ data: { type: "profile-subscription-bulk-delete-job", relationships: { list: { data: { id: "L1" } } } } });
  });

  it("is live only against the real origin", () => {
    expect(createAdapter("klaviyo", key).live).toBe(true);
    expect(createAdapter("klaviyo", key, { baseUrl: "http://localhost:9999" }).live).toBe(false);
  });

  it("refuses to sync an SMS contact", async () => {
    expect((await failure(createAdapter("klaviyo", key, { fetchFn: mock().fetchFn }).subscribe("L1", { channel: "sms", phone: "+14155550123", consentedAt: "t", source: "s" }))).kind).toBe("rejected");
  });
});

describe("mailchimp adapter (request shapes only: never run against the real service)", () => {
  const key = { apiKey: "abcdef0123456789-us21" };

  it("finds the data centre in the key", () => {
    expect(mailchimpDataCentre("abcdef-us21")).toBe("us21");
    expect(mailchimpDataCentre("nodatacentre")).toBeUndefined();
  });

  it("an unusable key is an authentication failure before any request is made", async () => {
    const m = mock();
    const e = await failure(createAdapter("mailchimp", { apiKey: "nope" }, { fetchFn: m.fetchFn }).checkConnection());
    expect(e.kind).toBe("auth");
    expect(m.calls).toHaveLength(0);
  });

  it("lists audiences with basic auth on the key's data centre", async () => {
    const m = mock({ json: { lists: [{ id: "a1", name: "Main" }, { id: "a2", name: "Other" }] } });
    expect(await createAdapter("mailchimp", key, { fetchFn: m.fetchFn }).checkConnection()).toEqual([{ id: "a1", name: "Main" }, { id: "a2", name: "Other" }]);
    expect(m.calls[0]!.url).toBe("https://us21.api.mailchimp.com/3.0/lists?count=100&fields=lists.id,lists.name");
    expect(m.calls[0]!.headers["authorization"]).toBe(`Basic ${btoa("convertflow:abcdef0123456789-us21")}`);
  });

  it("upserts a member by the MD5 of the lower-cased address, subscribing only if new", async () => {
    const m = mock({ json: { id: "MEMBER1", status: "subscribed" } });
    expect(await createAdapter("mailchimp", key, { fetchFn: m.fetchFn }).subscribe("a1", person)).toEqual({ ref: "MEMBER1" });
    expect(m.calls[0]).toMatchObject({ method: "PUT", url: `https://us21.api.mailchimp.com/3.0/lists/a1/members/${md5Hex("ada@example.com")}` });
    expect(m.calls[0]!.body).toEqual({ email_address: "Ada@Example.com", status_if_new: "subscribed", merge_fields: { FNAME: "Ada" } });
    expect(m.calls[0]!.body).not.toHaveProperty("status"); // never overrides an existing member's own status
  });

  it("does not re-subscribe someone who unsubscribed inside Mailchimp, and says so", async () => {
    const m = mock({ json: { id: "M", status: "unsubscribed" } });
    const e = await failure(createAdapter("mailchimp", key, { fetchFn: m.fetchFn }).subscribe("a1", person));
    expect(e).toMatchObject({ kind: "rejected" });
    expect(e.message).toContain("unsubscribed");
  });

  it("unsubscribes by patching the member, and treats 'not on the list' as already done", async () => {
    const m = mock({ json: { status: "unsubscribed" } }, { status: 404, json: { title: "Resource Not Found" } });
    const a = createAdapter("mailchimp", key, { fetchFn: m.fetchFn });
    await a.unsubscribe("a1", person);
    expect(m.calls[0]).toMatchObject({ method: "PATCH", body: { status: "unsubscribed" } });
    await a.unsubscribe("a1", person); // 404: nothing to remove
  });
});

describe("failures are classified so the sync can decide what to do", () => {
  const key = { apiKey: "abc-us1" };
  const kinds = async (reply: Parameters<typeof mock>[0]) => failure(createAdapter("mailchimp", key, { fetchFn: mock(reply).fetchFn }).checkConnection());

  it("401 and 403 are authentication failures", async () => {
    expect((await kinds({ status: 401 })).kind).toBe("auth");
    expect((await kinds({ status: 403 })).kind).toBe("auth");
  });
  it("429 is a rate limit and honours Retry-After, capped", async () => {
    expect(await kinds({ status: 429, headers: { "retry-after": "30" } })).toMatchObject({ kind: "rate_limited", retryAfterMs: 30_000 });
    expect((await kinds({ status: 429, headers: { "retry-after": "999999999" } })).retryAfterMs).toBe(6 * 3_600_000);
    expect((await kinds({ status: 429 })).retryAfterMs).toBeUndefined();
  });
  it("5xx and network errors are transient", async () => {
    expect((await kinds({ status: 503 })).kind).toBe("transient");
    expect((await kinds("network")).kind).toBe("transient");
  });
  it("other 4xx are permanent rejections", async () => expect((await kinds({ status: 400, json: { title: "Invalid Resource" } })).kind).toBe("rejected"));

  it("never copies the provider's response body into the error: it can echo the shopper's address", async () => {
    const e = await kinds({ status: 400, json: { title: "Invalid Resource", detail: "ada@example.com looks fake" } });
    expect(e.message).toBe("HTTP 400: Invalid Resource");
    expect(e.message).not.toContain("ada@example.com");
    const odd = await kinds({ status: 400, json: { title: "ada@example.com<script>" } });
    expect(odd.message).toBe("HTTP 400");
  });
});

describe("fake provider", () => {
  it("records calls, never counts as live, and fails on request", async () => {
    const f = new FakeProvider("mailchimp").failNext("rate_limited", "slow", 5000);
    expect(f.live).toBe(false);
    expect(await failure(f.subscribe("list_1", person))).toMatchObject({ kind: "rate_limited", retryAfterMs: 5000 });
    expect(await f.subscribe("list_1", person)).toEqual({ ref: "fake_Ada@Example.com" });
    await f.unsubscribe("list_1", person);
    expect(f.calls.map((c) => c.op)).toEqual(["subscribe", "subscribe", "unsubscribe"]);
  });
});
