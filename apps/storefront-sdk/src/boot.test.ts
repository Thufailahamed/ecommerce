// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignGroup } from "@convertflow/campaign-engine";
import { CampaignConfig, type StorefrontConfig } from "@convertflow/contracts";
import { boot } from "./index";

const CID = "cmp_a", VID = "ver_a";
const campaign = (over: Record<string, unknown> = {}) => CampaignConfig.parse({
  schemaVersion: 1, name: "t", format: "popup", creative: { headline: "Hello shopper", ctaLabel: "Go", ctaUrl: "/x" },
  style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" }, ...over,
});
const cfgOf = (over: Record<string, unknown> = {}): StorefrontConfig => ({
  schemaVersion: 1, siteId: "cf_x", generatedAt: "2026-10-27T00:00:00.000Z", deliveryEnabled: true,
  campaigns: [{ campaignId: CID, versionId: VID, config: campaign(over) }],
});
const idIn = (group: "treatment" | "holdout", pct: number) => { for (let i = 0; ; i++) if (assignGroup(`v${i}`, CID, pct) === group) return `v${i}`; };

type Posted = { url: string; body: { events?: { type: string; group?: string; order?: { experiment?: { group: string }; orderId: string } }[]; [k: string]: unknown } };
let posts: Posted[];

async function start(o: { cfg: StorefrontConfig; consent?: boolean; visitorId?: string; context?: Record<string, unknown> }) {
  localStorage.clear(); sessionStorage.clear(); document.body.innerHTML = "";
  window.ConvertFlow = o.consent === undefined ? {} : { consent: o.consent };
  (window as unknown as { ConvertFlowContext?: unknown }).ConvertFlowContext = o.context;
  if (o.visitorId) localStorage.setItem("cf:v1", JSON.stringify({ visitorId: o.visitorId, visitorImpressions: {}, dismissedAt: {}, clickedAt: {}, firstSeen: Date.now() }));
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/sdk/v1/config/")) return new Response(JSON.stringify(o.cfg));
    posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(null, { status: 202 });
  }));
  const s = document.createElement("script");
  s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
  boot(s);
  await new Promise((r) => setTimeout(r, 30));
}
const shown = () => document.querySelector("[data-convertflow]")?.shadowRoot?.textContent ?? "";
const types = () => posts.flatMap((p) => p.body.events?.map((e) => e.type) ?? []);

beforeEach(() => vi.useRealTimers());
afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as { ConvertFlowContext?: unknown }).ConvertFlowContext; });

describe("experiments in the browser", () => {
  it("treatment arm sees the campaign and reports its arm", async () => {
    await start({ cfg: cfgOf({ experiment: { holdoutPercent: 50 } }), consent: true, visitorId: idIn("treatment", 50) });
    expect(shown()).toContain("Hello shopper");
    const ev = posts.flatMap((p) => p.body.events ?? []);
    expect(ev.find((e) => e.type === "experiment_assigned")?.group).toBe("treatment");
    expect(types()).toEqual(expect.arrayContaining(["experiment_assigned", "campaign_eligible", "campaign_impression"]));
  });
  it("holdout arm sees nothing but is still counted as randomised", async () => {
    await start({ cfg: cfgOf({ experiment: { holdoutPercent: 50 } }), consent: true, visitorId: idIn("holdout", 50) });
    expect(shown()).toBe("");
    const ev = posts.flatMap((p) => p.body.events ?? []);
    expect(ev.find((e) => e.type === "experiment_assigned")?.group).toBe("holdout");
    expect(types()).not.toContain("campaign_impression");
    expect(types()).not.toContain("campaign_eligible");
  });
  it("without consent nobody is held out, nothing is stored, nothing is sent", async () => {
    await start({ cfg: cfgOf({ experiment: { holdoutPercent: 50 } }), consent: false });
    expect(shown()).toContain("Hello shopper");
    expect(posts).toHaveLength(0);
    expect(localStorage.getItem("cf:v1")).toBeNull();
  });
  it("purchases carry the visitor's arm", async () => {
    await start({ cfg: cfgOf({ experiment: { holdoutPercent: 50 } }), consent: true, visitorId: idIn("holdout", 50) });
    posts.length = 0;
    window.ConvertFlow!.trackPurchase!({ orderId: "ORD-9", total: 42, currency: "usd" });
    const ev = posts.flatMap((p) => p.body.events ?? []);
    expect(ev[0]?.type).toBe("purchase_observed");
    expect(ev[0]?.order?.experiment?.group).toBe("holdout");
  });
  it("the same visitor lands in the same arm on every visit", async () => {
    const id = idIn("holdout", 30);
    for (let i = 0; i < 3; i++) {
      await start({ cfg: cfgOf({ experiment: { holdoutPercent: 30 } }), consent: true, visitorId: id });
      expect(shown()).toBe("");
    }
  });
});

describe("restock form in the browser", () => {
  const cfg = () => cfgOf({ format: "restock", creative: { headline: "Notify me", ctaLabel: "Email me", ctaUrl: "/" } });
  const form = () => document.querySelector("[data-convertflow]")!.shadowRoot!.querySelector("form")!;
  const fill = (v: string) => { const i = form().querySelector("input")!; i.value = v; form().dispatchEvent(new Event("submit", { cancelable: true })); };

  it("only appears when the product is known, and subscribes via the public endpoint", async () => {
    await start({ cfg: cfg(), consent: false });
    expect(shown()).toBe(""); // no productId: useless, so not shown
    await start({ cfg: cfg(), consent: false, context: { productId: "p-42", pageType: "product" } });
    expect(shown()).toContain("Notify me");
    fill("not-an-email");
    expect(shown()).toContain("valid email");
    expect(posts).toHaveLength(0);
    fill("fan@example.com");
    await new Promise((r) => setTimeout(r, 20));
    const sub = posts.find((p) => p.url.endsWith("/api/v1/notifications/restock"));
    expect(sub?.body).toMatchObject({ siteId: "cf_x", productId: "p-42", email: "fan@example.com" });
    expect(shown()).toContain("Check your inbox");
  });
  it("shows an error and lets the shopper retry when the server fails", async () => {
    await start({ cfg: cfg(), consent: false, context: { productId: "p-1" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    fill("fan@example.com");
    await new Promise((r) => setTimeout(r, 20));
    expect(shown()).toContain("Something went wrong");
    expect(form().querySelector("button[type=submit]")!.hasAttribute("disabled")).toBe(false);
  });
});
