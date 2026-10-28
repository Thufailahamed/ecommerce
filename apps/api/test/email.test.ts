import { describe, expect, it } from "vitest";
import { ResendEmail, templates } from "../src/services/email.js";

/** Behaves like the Workers runtime: calling fetch with any `this` other than undefined/global throws. */
function strictFetch(record: { url?: string; init?: RequestInit }) {
  return function (this: unknown, url: string, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
    record.url = url; record.init = init;
    return Promise.resolve(new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
  } as unknown as typeof fetch;
}

describe("ResendEmail", () => {
  it("calls fetch as a plain function (Workers throws 'Illegal invocation' otherwise)", async () => {
    const rec: { url?: string; init?: RequestInit } = {};
    await new ResendEmail("key_1", "noreply@example.com", strictFetch(rec)).send({ to: "a@example.com", subject: "S", text: "T" });
    expect(rec.url).toBe("https://api.resend.com/emails");
    expect((rec.init?.headers as Record<string, string>)["authorization"]).toBe("Bearer key_1");
    expect(JSON.parse(String(rec.init?.body))).toMatchObject({ from: "noreply@example.com", to: ["a@example.com"], subject: "S" });
  });
  it("honours a base URL override and forwards headers and html", async () => {
    const rec: { url?: string; init?: RequestInit } = {};
    await new ResendEmail("k", "f@example.com", strictFetch(rec), "http://localhost:4100").send({ to: "a@example.com", subject: "S", text: "T", html: "<p>T</p>", headers: { "List-Unsubscribe": "<x>" } });
    expect(rec.url).toBe("http://localhost:4100/emails");
    expect(JSON.parse(String(rec.init?.body))).toMatchObject({ html: "<p>T</p>", headers: { "List-Unsubscribe": "<x>" } });
  });
  it("throws without leaking the message body when the provider rejects", async () => {
    const f = (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch;
    await expect(new ResendEmail("k", "f@example.com", f).send({ to: "a@example.com", subject: "S", text: "secret-token-link" })).rejects.toThrow("email provider responded 422");
    await expect(new ResendEmail("k", "f@example.com", f).send({ to: "a@example.com", subject: "S", text: "secret-token-link" })).rejects.not.toThrow(/secret-token-link/);
  });
});

describe("email templates", () => {
  it("escape untrusted names in HTML and always carry plain text with the link", () => {
    const m = templates.invite("a@example.com", "https://app.example.com/invite?token=T", "<script>alert(1)</script>Org", "bob@example.com", "editor");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.text).toContain("https://app.example.com/invite?token=T");
  });
  it("shopper emails include one-click unsubscribe headers", () => {
    const m = templates.restockAvailable("a@example.com", "Shop", "Boot", "https://shop.example.com/p", "https://api.example.com/u?token=x");
    expect(m.headers?.["List-Unsubscribe"]).toBe("<https://api.example.com/u?token=x>");
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
