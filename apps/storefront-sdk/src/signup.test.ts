// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignConfig, type StorefrontConfig } from "@convertflow/contracts";
import { boot } from "./index";
import { renderCampaign } from "./render";

const CONSENT = "I agree to receive marketing emails from this store. Unsubscribe any time.";
const form = (collect: Record<string, boolean> = { email: true }) => ({ collect, consentText: CONSENT, privacyUrl: "/policies/privacy-policy" });
const mk = (id: string, format: string, over: Record<string, unknown> = {}) => ({
  campaignId: id, versionId: `${id}_v1`,
  config: CampaignConfig.parse({
    schemaVersion: 1, name: id, tool: "email", format, form: form(),
    creative: { headline: `Join ${id}`, body: "Get the news.", ctaLabel: "Sign up", ctaUrl: "/x" },
    style: format === "announcement_bar" ? { placement: "top" } : {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "subscribe" }, ...over,
  }),
});
const PROMO = { code: "WELCOME15", percentOff: 15, label: "Welcome" };
const cfgOf = (...campaigns: ReturnType<typeof mk>[]): StorefrontConfig => ({ schemaVersion: 1, siteId: "cf_x", generatedAt: "2026-10-27T00:00:00.000Z", deliveryEnabled: true, campaigns });

const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const hosts = () => Array.from(document.querySelectorAll<HTMLElement>("[data-convertflow]"));
const rootOf = (n = 0) => hosts()[n]!.shadowRoot!;
let bodies: { url: string; body: Record<string, unknown> }[];

async function start(cfg: StorefrontConfig) {
  localStorage.clear(); sessionStorage.clear(); document.head.innerHTML = "";
  window.ConvertFlow = { consent: true };
  bodies = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/sdk/v1/config/")) return new Response(JSON.stringify(cfg));
    bodies.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(null, { status: 202 });
  }));
  const s = document.createElement("script");
  s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
  boot(s);
  await wait(30);
}
const submit = (root: ShadowRoot, email = "a@example.com", name?: string) => {
  root.querySelector<HTMLInputElement>("input[type=email]")!.value = email;
  const first = root.querySelector<HTMLInputElement>("input[name=firstName]");
  if (first && name !== undefined) first.value = name;
  root.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked = true;
  root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
};
const signups = () => bodies.filter((b) => b.url.endsWith("/api/v1/notifications/subscribe"));

afterEach(() => { window.ConvertFlow?.destroy?.(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("email signup layouts", () => {
  it("renders the same form in every layout, with an unticked consent box carrying the exact words", () => {
    for (const format of ["popup", "slide_in", "announcement_bar", "inline"]) {
      document.body.innerHTML = "";
      const h = renderCampaign(document, mk("f", format).config);
      const root = h.host.shadowRoot!;
      expect(root.querySelector<HTMLInputElement>("input[type=email]"), format).toBeTruthy();
      expect(root.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked, format).toBe(false);
      expect(root.textContent, format).toContain(CONSENT);
      expect(root.querySelector("a[href='/policies/privacy-policy']"), format).toBeTruthy();
      h.destroy();
    }
  });

  it("an inline form is part of the page: not fixed, not dismissible, no backdrop", () => {
    const h = renderCampaign(document, mk("f", "inline").config);
    expect(h.host.style.position).not.toBe("fixed");
    expect(h.host.shadowRoot!.querySelector("button[aria-label=Close]")).toBeNull();
    expect(h.host.shadowRoot!.querySelectorAll("div[style*='rgba(0,0,0,.45)']")).toHaveLength(0);
  });

  it("an announcement bar form lays the fields out in a row along the edge", () => {
    const h = renderCampaign(document, mk("f", "announcement_bar").config);
    const root = h.host.shadowRoot!;
    expect(root.querySelector("form")!.style.flexDirection).not.toBe("column");
    expect(root.querySelector("button[aria-label=Close]")).toBeTruthy();
  });

  it("asks for a first name only when the form says so, and sends it only when it was filled in", async () => {
    await start(cfgOf(mk("p", "popup", { form: form({ email: true, firstName: true }) })));
    expect(rootOf().querySelector("input[name=firstName]")).toBeTruthy();
    submit(rootOf(), "a@example.com", "  Ada ");
    await wait();
    expect(signups()[0]!.body).toEqual({ siteId: "cf_x", campaignId: "p", email: "a@example.com", consent: true, firstName: "Ada" });
    window.ConvertFlow!.destroy!(); document.body.innerHTML = "";

    await start(cfgOf(mk("p", "popup", { form: form({ email: true, firstName: true }) })));
    submit(rootOf(), "b@example.com", "   ");
    await wait();
    expect(signups()[0]!.body).not.toHaveProperty("firstName");

    window.ConvertFlow!.destroy!(); document.body.innerHTML = "";
    await start(cfgOf(mk("p", "popup")));
    expect(rootOf().querySelector("input[name=firstName]")).toBeNull();
  });
});

describe("the incentive is revealed only after the shopper confirms", () => {
  it("never draws the code or the percentage before or right after submitting, in any layout", async () => {
    for (const format of ["popup", "slide_in", "announcement_bar", "inline"]) {
      window.ConvertFlow?.destroy?.(); document.body.innerHTML = "";
      await start(cfgOf(mk("f", format, { promotion: PROMO })));
      expect(rootOf().textContent, `${format} before`).not.toMatch(/WELCOME15|15%/);
      submit(rootOf());
      await wait();
      const after = rootOf().textContent ?? "";
      expect(after, `${format} after`).not.toMatch(/WELCOME15|15%/);
      expect(after, format).toContain("Check your inbox");
      expect(after, format).toContain("Your discount code is shown once you confirm");
    }
  });

  it("says nothing about an incentive when the form has none", async () => {
    await start(cfgOf(mk("f", "popup")));
    submit(rootOf());
    await wait();
    expect(rootOf().textContent).not.toContain("discount");
  });
});

describe("inline signup form on the page", () => {
  it("goes where the merchant marked, shows without a trigger and counts as one eligible page view and one impression", async () => {
    document.body.innerHTML = `<main><div id="slot" data-convertflow-form></div></main>`;
    await start(cfgOf(mk("f", "inline")));
    expect(document.querySelector("#slot [data-convertflow]")).toBeTruthy();
    const events = bodies.flatMap((b) => (b.body["events"] as { type: string }[] | undefined) ?? []).map((e) => e.type);
    expect(events.filter((t) => t === "campaign_eligible")).toHaveLength(1);
    expect(events.filter((t) => t === "campaign_impression")).toHaveLength(1);
  });

  it("falls back to the end of <main>", async () => {
    document.body.innerHTML = `<main><p>Page</p></main><footer></footer>`;
    await start(cfgOf(mk("f", "inline")));
    expect(document.querySelector("main > [data-convertflow]")).toBeTruthy();
  });

  it("stays on screen after signing up so the shopper sees the confirmation, and is not drawn twice", async () => {
    document.body.innerHTML = `<main></main>`;
    await start(cfgOf(mk("f", "inline")));
    submit(rootOf());
    await wait();
    expect(signups()).toHaveLength(1);
    expect(rootOf().textContent).toContain("Check your inbox");
    window.dispatchEvent(new Event("pagehide")); await wait();
    expect(hosts()).toHaveLength(1);
  });

  it("is not shown to someone who already signed up in this tab", async () => {
    document.body.innerHTML = `<main></main>`;
    sessionStorage.setItem("cf:s:v1", JSON.stringify({ id: "s", impressions: {}, pages: 0, subscribed: { email: true } }));
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/sdk/v1/config/") ? new Response(JSON.stringify(cfgOf(mk("f", "inline")))) : new Response(null, { status: 202 }))));
    window.ConvertFlow = { consent: true };
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait(30);
    expect(hosts()).toHaveLength(0);
  });

  it("a failed signup shows an error and lets the shopper retry", async () => {
    document.body.innerHTML = `<main></main>`;
    let fail = true;
    localStorage.clear(); sessionStorage.clear(); window.ConvertFlow = { consent: true }; bodies = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/sdk/v1/config/")) return new Response(JSON.stringify(cfgOf(mk("f", "inline"))));
      if (String(url).endsWith("/notifications/subscribe")) { bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response(null, { status: fail ? 500 : 202 }); }
      return new Response(null, { status: 202 });
    }));
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait(30);
    submit(rootOf()); await wait();
    expect(rootOf().textContent).toContain("Something went wrong");
    fail = false;
    submit(rootOf()); await wait();
    expect(rootOf().textContent).toContain("Check your inbox");
    expect(signups()).toHaveLength(2);
  });
});
