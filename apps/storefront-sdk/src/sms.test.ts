// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignConfig, type StorefrontConfig } from "@convertflow/contracts";
import { boot } from "./index";
import { renderCampaign } from "./render";
import { toE164 } from "./sms";

const CONSENT = "I agree to receive recurring marketing texts from this store. Msg & data rates may apply. Reply STOP to opt out.";
const form = (over: Record<string, unknown> = {}) => ({ collect: { phone: true }, consentText: CONSENT, privacyUrl: "/policies/privacy-policy", defaultCountry: "GB", ...over });
const mk = (id: string, format: string, over: Record<string, unknown> = {}) => ({
  campaignId: id, versionId: `${id}_v1`,
  config: CampaignConfig.parse({
    schemaVersion: 1, name: id, tool: "sms", format, form: form(),
    creative: { headline: `Texts from ${id}`, body: "Offers by text.", ctaLabel: "Text me", ctaUrl: "/x" },
    style: format === "announcement_bar" ? { placement: "top" } : {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "subscribe" }, ...over,
  }),
});
const cfgOf = (...campaigns: ReturnType<typeof mk>[]): StorefrontConfig => ({ schemaVersion: 1, siteId: "cf_x", generatedAt: "2026-10-27T00:00:00.000Z", deliveryEnabled: true, campaigns });

const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const hosts = () => Array.from(document.querySelectorAll<HTMLElement>("[data-convertflow]"));
const rootOf = (n = 0) => hosts()[n]!.shadowRoot!;
type Reply = { status: number; json?: unknown };
let bodies: { url: string; body: Record<string, unknown> }[];

async function start(cfg: StorefrontConfig, replies: { subscribe?: Reply[]; confirm?: Reply[] } = {}, consent = true) {
  localStorage.clear(); sessionStorage.clear(); document.head.innerHTML = "";
  window.ConvertFlow = { consent };
  bodies = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/sdk/v1/config/")) return new Response(JSON.stringify(cfg));
    bodies.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
    const r = u.endsWith("/sms/subscribe") ? replies.subscribe?.shift() ?? { status: 202, json: { ok: true } }
      : u.endsWith("/sms/confirm") ? replies.confirm?.shift() ?? { status: 200, json: { ok: true } }
      : { status: 202 };
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status });
  }));
  const s = document.createElement("script");
  s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
  boot(s);
  await wait(30);
}
const enterPhone = (root: ShadowRoot, national: string, country?: string, tick = true) => {
  if (country) root.querySelector<HTMLSelectElement>("select")!.value = country;
  root.querySelector<HTMLInputElement>("input[type=tel]")!.value = national;
  root.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked = tick;
  root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
};
const enterCode = (root: ShadowRoot, code: string) => {
  root.querySelector<HTMLInputElement>("input[name=code]")!.value = code;
  root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
};
const calls = (suffix: string) => bodies.filter((b) => b.url.endsWith(suffix));
const eventTypes = () => bodies.flatMap((b) => (b.body["events"] as { type: string }[] | undefined) ?? []).map((e) => e.type);

afterEach(() => { window.ConvertFlow?.destroy?.(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("phone numbers", () => {
  it("adds the country's dial code, drops a national leading 0, and takes + or 00 as already international", () => {
    expect(toE164("GB", "07700 900123")).toBe("+447700900123");
    expect(toE164("US", "(415) 555-0123")).toBe("+14155550123");
    expect(toE164("US", "1 415 555 0123")).toBe("+14155550123");
    expect(toE164("IT", "333 123 4567")).toBe("+393331234567"); // no trunk prefix in Italy
    expect(toE164("US", "+44 7700 900123")).toBe("+447700900123");
    expect(toE164("US", "0044 7700 900123")).toBe("+447700900123");
  });
  it("never guesses: too short, unknown country or letters give nothing", () => {
    expect(toE164("US", "555")).toBeUndefined();
    expect(toE164("ZZ", "07700900123")).toBeUndefined();
    expect(toE164("US", "call me")).toBeUndefined();
  });
});

describe("sms signup form", () => {
  it("renders in every layout with the store's country preselected and an unticked box carrying the exact words", () => {
    for (const format of ["popup", "slide_in", "announcement_bar", "inline"]) {
      document.body.innerHTML = "";
      const h = renderCampaign(document, mk("f", format).config);
      const root = h.host.shadowRoot!;
      expect(root.querySelector<HTMLSelectElement>("select")!.value, format).toBe("GB");
      expect(root.querySelector<HTMLInputElement>("input[type=tel]")!.getAttribute("autocomplete"), format).toBe("tel-national");
      expect(root.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked, format).toBe(false);
      expect(root.textContent, format).toContain(CONSENT);
      expect(root.querySelector("input[type=email]"), format).toBeNull();
      h.destroy();
    }
  });

  it("asks for the code, then subscribes; the number is sent in E.164 and nothing is sent without the box ticked", async () => {
    await start(cfgOf(mk("p", "popup")));
    enterPhone(rootOf(), "07700 900123", undefined, false);
    await wait();
    expect(calls("/sms/subscribe")).toHaveLength(0);
    expect(rootOf().textContent).toContain("Tick the box");

    enterPhone(rootOf(), "07700 900123");
    await wait();
    expect(calls("/sms/subscribe")[0]!.body).toEqual({ siteId: "cf_x", campaignId: "p", phone: "+447700900123", consent: true });
    const code = rootOf().querySelector<HTMLInputElement>("input[name=code]")!;
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");
    expect(code.getAttribute("inputmode")).toBe("numeric");
    expect(rootOf().textContent).toContain("We texted a code to +44 •••• 0123");
    expect(rootOf().textContent).not.toContain("7700900123"); // the full number is not printed back

    enterCode(rootOf(), "123 456");
    await wait();
    expect(calls("/sms/confirm")[0]!.body).toEqual({ siteId: "cf_x", campaignId: "p", phone: "+447700900123", code: "123456" });
    expect(rootOf().textContent).toContain("Thanks. You're signed up.");
  });

  it("shows the incentive only once the server confirms and returns it", async () => {
    await start(cfgOf(mk("p", "popup", { promotion: { code: "TEXT10", percentOff: 10 } })), { confirm: [{ status: 200, json: { ok: true, incentive: { code: "TEXT10", percentOff: 10, label: "Welcome" } } }] });
    expect(rootOf().textContent).not.toMatch(/TEXT10|10%/);
    enterPhone(rootOf(), "07700 900123"); await wait();
    expect(rootOf().textContent).not.toMatch(/TEXT10|10%/);
    enterCode(rootOf(), "123456"); await wait();
    expect(rootOf().textContent).toContain("Welcome · 10% off: TEXT10");
  });

  it("explains a number the provider will not text, and a wrong code, and lets the shopper retry", async () => {
    await start(cfgOf(mk("p", "popup")), {
      subscribe: [{ status: 422, json: { error: { code: "phone_undeliverable" } } }],
      confirm: [{ status: 422, json: { error: { code: "invalid_code" } } }],
    });
    enterPhone(rootOf(), "01632 960001"); await wait();
    expect(rootOf().textContent).toContain("We can't text that number");
    enterPhone(rootOf(), "07700 900123"); await wait();
    enterCode(rootOf(), "000000"); await wait();
    expect(rootOf().textContent).toContain("That code is not right or has expired.");
    enterCode(rootOf(), "123456"); await wait();
    expect(rootOf().textContent).toContain("Thanks. You're signed up.");
  });

  it("lets the shopper go back and use a different number", async () => {
    await start(cfgOf(mk("p", "popup")));
    enterPhone(rootOf(), "07700 900123"); await wait();
    Array.from(rootOf().querySelectorAll("button")).find((b) => b.textContent === "Use a different number")!.click();
    expect(rootOf().querySelector("input[type=tel]")).toBeTruthy();
    enterPhone(rootOf(), "07700 900456"); await wait();
    expect(calls("/sms/subscribe").map((c) => c.body["phone"])).toEqual(["+447700900123", "+447700900456"]);
  });

  it("counts the submission (attempt, then success or failure) but never what was typed, and only with consent", async () => {
    await start(cfgOf(mk("p", "popup")), { subscribe: [{ status: 500 }] });
    enterPhone(rootOf(), "07700 900123"); await wait();
    enterPhone(rootOf(), "07700 900123"); await wait();
    window.dispatchEvent(new Event("pagehide")); await wait();
    const types = eventTypes();
    expect(types.filter((t) => t === "form_submit_attempt")).toHaveLength(2);
    expect(types.filter((t) => t === "form_submit_failure")).toHaveLength(1);
    expect(types.filter((t) => t === "form_submit_success")).toHaveLength(1);
    expect(JSON.stringify(bodies.filter((b) => b.url.endsWith("/events/batch")))).not.toContain("7700");

    window.ConvertFlow!.destroy!(); document.body.innerHTML = "";
    await start(cfgOf(mk("p", "popup")), {}, false);
    enterPhone(rootOf(), "07700 900123"); await wait();
    expect(calls("/sms/subscribe")).toHaveLength(1); // the form works without analytics consent
    expect(eventTypes()).toEqual([]); // but nothing is counted
  });

  it("an SMS subscriber is not shown SMS forms again, but still sees email forms", async () => {
    document.body.innerHTML = `<main></main>`;
    const email = { campaignId: "e", versionId: "e_v1", config: CampaignConfig.parse({ ...mk("e", "inline").config, tool: "email", form: { collect: { email: true }, consentText: "I agree to receive marketing emails from this store.", privacyUrl: "/p" } }) };
    sessionStorage.setItem("cf:s:v1", JSON.stringify({ id: "s", impressions: {}, pages: 0, subscribed: { sms: true } }));
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/sdk/v1/config/") ? new Response(JSON.stringify(cfgOf(mk("s", "inline"), email))) : new Response(null, { status: 202 }))));
    window.ConvertFlow = { consent: true };
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait(30);
    expect(hosts()).toHaveLength(1);
    expect(rootOf().querySelector("input[type=email]")).toBeTruthy();
  });

  it("an inline SMS form goes where the merchant marked and stays after confirming", async () => {
    document.body.innerHTML = `<main><div id="slot" data-convertflow-form></div></main>`;
    await start(cfgOf(mk("f", "inline")));
    expect(document.querySelector("#slot [data-convertflow]")).toBeTruthy();
    enterPhone(rootOf(), "07700 900123"); await wait();
    enterCode(rootOf(), "123456"); await wait();
    expect(rootOf().textContent).toContain("Thanks. You're signed up.");
    window.dispatchEvent(new Event("pagehide")); await wait();
    expect(hosts()).toHaveLength(1);
  });
});
