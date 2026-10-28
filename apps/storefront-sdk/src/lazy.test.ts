// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignConfig, type StorefrontConfig } from "@convertflow/contracts";
import * as emailMod from "./email";
import { boot } from "./index";
import { register } from "./registry";
import * as toastMod from "./toast";

const camp = (id: string, over: Record<string, unknown> = {}) => ({
  campaignId: id, versionId: `${id}_v1`,
  config: CampaignConfig.parse({
    schemaVersion: 1, name: id, tool: "toast", format: "toast", toast: {},
    creative: { headline: `Headline ${id}`, body: "Body", ctaLabel: "Go", ctaUrl: "/x" },
    style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" }, ...over,
  }),
});
const popup = (id: string) => camp(id, { tool: undefined, format: "popup", toast: undefined });
const cfgOf = (...campaigns: ReturnType<typeof camp>[]): StorefrontConfig => ({
  schemaVersion: 1, siteId: "cf_x", generatedAt: "2026-10-27T00:00:00.000Z", deliveryEnabled: true, currency: "USD", campaigns,
});

const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const text = () => Array.from(document.querySelectorAll("[data-convertflow]")).map((h) => h.shadowRoot?.textContent ?? "").join("|");
const toolScripts = () => Array.from(document.head.querySelectorAll<HTMLScriptElement>("script[src]")).map((s) => s.src);

async function start(cfg: StorefrontConfig) {
  localStorage.clear(); sessionStorage.clear(); document.body.innerHTML = ""; document.head.innerHTML = "";
  window.ConvertFlow = { consent: true };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/sdk/v1/config/") ? new Response(JSON.stringify(cfg)) : new Response(null, { status: 202 }))));
  const s = document.createElement("script");
  s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test"; s.src = "https://cdn.test/sdk/cf.js";
  boot(s);
  await wait(30);
}

beforeEach(() => {
  window.__cfTools = {}; // nothing registered: the page has only the core script
  vi.stubGlobal("__CF_CHUNKS__", { toast: "cf-toast.0123456789.js", email: "cf-email.abcdef0123.js", feed: "cf-feed.1111111111.js", upsell: "cf-upsell.2222222222.js" });
});
afterEach(() => { window.ConvertFlow?.destroy?.(); vi.unstubAllGlobals(); });

describe("per-tool scripts are loaded on demand", () => {
  it("a plain popup is drawn by the core alone and downloads nothing else", async () => {
    await start(cfgOf(popup("p")));
    expect(text()).toContain("Headline p");
    expect(toolScripts()).toEqual([]);
  });

  it("a toast fetches its script from next to the core, and appears once it arrives", async () => {
    await start(cfgOf(camp("t")));
    expect(toolScripts()).toEqual(["https://cdn.test/sdk/cf-toast.0123456789.js"]);
    expect(text()).toBe(""); // not there yet: the script has not loaded

    register("toast", toastMod);
    document.head.querySelector("script[src]")!.dispatchEvent(new Event("load"));
    await wait();
    expect(text()).toContain("Headline t");
  });

  it("asks for a tool's script once, however many campaigns use it", async () => {
    await start(cfgOf(camp("a"), camp("b"), camp("c")));
    expect(toolScripts()).toHaveLength(1);
  });

  it("a script that fails to load means that tool shows nothing, and is not retried in a loop", async () => {
    await start(cfgOf(camp("t")));
    document.head.querySelector("script[src]")!.dispatchEvent(new Event("error"));
    await wait();
    expect(text()).toBe("");
    window.dispatchEvent(new Event("pagehide"));
    await wait();
    expect(toolScripts()).toHaveLength(1);
  });

  it("a script that loads but does not register is treated as a failure, not a crash", async () => {
    await start(cfgOf(camp("t")));
    document.head.querySelector("script[src]")!.dispatchEvent(new Event("load")); // nothing registered
    await wait();
    expect(text()).toBe("");
  });

  it("other campaigns keep working while one tool's script is unavailable", async () => {
    await start(cfgOf(popup("p"), camp("t", { priority: 1 })));
    expect(text()).toContain("Headline p");
  });

  it("inline signup forms load the email script", async () => {
    const form = camp("f", { tool: "email", format: "inline", toast: undefined, form: { collect: { email: true }, consentText: "I agree to receive marketing emails. Unsubscribe any time.", privacyUrl: "/privacy" } });
    await start(cfgOf(form));
    expect(toolScripts()).toEqual(["https://cdn.test/sdk/cf-email.abcdef0123.js"]);
    register("email", emailMod);
    document.head.querySelector("script[src]")!.dispatchEvent(new Event("load"));
    await wait();
    expect(text()).toContain("Headline f");
  });

  it("destroy before the script arrives draws nothing afterwards", async () => {
    await start(cfgOf(camp("t")));
    window.ConvertFlow!.destroy!();
    register("toast", toastMod);
    document.head.querySelector("script[src]")!.dispatchEvent(new Event("load"));
    await wait();
    expect(text()).toBe("");
  });
});
