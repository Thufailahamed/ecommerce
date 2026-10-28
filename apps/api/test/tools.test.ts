import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHIPPED_TOOLS, type Tool } from "@convertflow/contracts";
import { makeEnv, setPlan, setupStore, signup, validConfig, type Env } from "./helpers.js";

const shipped = SHIPPED_TOOLS as Set<Tool>; // production code treats it as read-only; tests flip it to exercise the gates
const defaults = [...shipped];
// Each test starts with nothing shipped so it controls exactly which gates are open, and the real list is restored afterwards.
beforeEach(() => shipped.clear());
afterEach(() => { shipped.clear(); for (const t of defaults) shipped.add(t); });

const emailForm = { collect: { email: true }, consentText: "I agree to receive marketing emails from this store. Unsubscribe any time.", privacyUrl: "/policies/privacy-policy" };
const smsForm = { collect: { phone: true }, consentText: "I agree to receive recurring marketing texts. Msg & data rates may apply. Reply STOP to opt out.", privacyUrl: "/policies/privacy-policy" };
type Cfg = Record<string, unknown>;
const toast = (o: Cfg = {}): Cfg => validConfig({ tool: "toast", format: "toast", toast: {}, ...o });
const feed = (o: Cfg = {}): Cfg => validConfig({ tool: "feed", format: "feed_item", feed: {}, ...o });
const email = (o: Cfg = {}): Cfg => validConfig({ tool: "email", format: "popup", form: emailForm, ...o });
const sms = (o: Cfg = {}): Cfg => validConfig({ tool: "sms", format: "popup", form: smsForm, ...o });
const upsell = (o: Cfg = {}): Cfg => validConfig({ tool: "upsell", format: "recommendation", recommend: { source: "same_collection" }, ...o });

async function setup() {
  const env = await makeEnv();
  const s = await setupStore(env);
  const base = `/api/v1/stores/${s.storeId}/campaigns`;
  const create = async (cfg: unknown) => (await s.c.post(base, cfg)).json.data as { id: string; tool: string; updatedAt: string };
  const publish = async (id: string, updatedAt: string) => s.c.post(`${base}/${id}/publish`, { approve: true, approvedUpdatedAt: updatedAt });
  return { env, s, base, create, publish };
}

describe("tool tagging", () => {
  it("derives the tool from the config on create and on every update", async () => {
    const { s, base, create } = await setup();
    expect((await create(validConfig())).tool).toBe("toast"); // legacy popup
    expect((await create(validConfig({ format: "restock" }))).tool).toBe("email"); // legacy restock form
    const f = await create(feed());
    expect(f.tool).toBe("feed");
    const r = await s.c.put(`${base}/${f.id}`, toast());
    expect(r.status).toBe(200);
    expect(r.json.data.tool).toBe("toast");
    expect((await s.c.get(`${base}/${f.id}`)).json.data.tool).toBe("toast");
  });

  it("rejects an invalid tool/format combination with a clear 422", async () => {
    const { s, base } = await setup();
    const r = await s.c.post(base, validConfig({ tool: "feed", format: "popup", feed: {} }));
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json.error.details)).toContain("cannot use the popup format");
  });

  it("lists by tool, and rejects an unknown tool", async () => {
    const { s, base, create } = await setup();
    await create(toast()); await create(toast({ name: "T2" })); await create(feed()); await create(validConfig());
    const ids = async (q: string) => (await s.c.get(`${base}${q}`)).json.data.map((c: { tool: string }) => c.tool).sort();
    expect(await ids("")).toEqual(["feed", "toast", "toast", "toast"]);
    expect(await ids("?tool=toast")).toEqual(["toast", "toast", "toast"]);
    expect(await ids("?tool=feed")).toEqual(["feed"]);
    expect(await ids("?tool=sms")).toEqual([]);
    const bad = await s.c.get(`${base}?tool=popup`);
    expect(bad.status).toBe(422);
  });

  it("never leaks another store's campaigns through the tool filter", async () => {
    const env = await makeEnv();
    const a = await setupStore(env, "a@example.com");
    const b = await setupStore(env, "b@example.com");
    await a.c.post(`/api/v1/stores/${a.storeId}/campaigns`, feed());
    expect((await b.c.get(`/api/v1/stores/${b.storeId}/campaigns?tool=feed`)).json.data).toEqual([]);
    expect((await b.c.get(`/api/v1/stores/${a.storeId}/campaigns?tool=feed`)).status).toBe(404);
  });
});

describe("publishing gates", () => {
  it("legacy campaigns (no tool) publish exactly as before, on the free plan", async () => {
    const { create, publish } = await setup();
    const c = await create(validConfig());
    expect((await publish(c.id, c.updatedAt)).status).toBe(200);
  });

  it("refuses a tool that has not shipped, however high the plan", async () => {
    const { env, s, create, publish } = await setup();
    await setPlan(env, s.orgId, "scale");
    for (const cfg of [toast(), feed(), email(), sms(), upsell()]) {
      const c = await create(cfg);
      const r = await publish(c.id, c.updatedAt);
      expect(r.status, JSON.stringify(cfg.tool)).toBe(409);
      expect(r.json.error.code).toBe("tool_unavailable");
    }
  });

  it("does not gate the legacy restock form on the shipped list", async () => {
    const { env, s, create, publish } = await setup();
    await setPlan(env, s.orgId, "growth");
    const c = await create(validConfig({ tool: "email", format: "restock" }));
    const r = await publish(c.id, c.updatedAt);
    expect(r.json?.error?.code).not.toBe("tool_unavailable");
  });

  it("enforces the plan once a tool has shipped", async () => {
    const { env, s, create, publish } = await setup();
    for (const t of ["toast", "feed", "email", "sms", "upsell"] as const) shipped.add(t);

    // free: toast and feed only
    expect((await publish(...(await create(toast()).then((c) => [c.id, c.updatedAt] as const)))).status).toBe(200);
    for (const cfg of [email(), sms(), upsell()]) {
      const c = await create(cfg);
      const r = await publish(c.id, c.updatedAt);
      expect(r.status, cfg.tool as string).toBe(402);
      expect(r.json.error.code).toBe("plan_limit");
    }

    // starter adds email, still not sms or upsell
    await setPlan(env, s.orgId, "starter");
    const e = await create(email({ name: "E" }));
    expect((await publish(e.id, e.updatedAt)).status).toBe(200);
    for (const cfg of [sms(), upsell()]) {
      const c = await create(cfg);
      expect((await publish(c.id, c.updatedAt)).status, cfg.tool as string).toBe(402);
    }

    // growth has everything
    await setPlan(env, s.orgId, "growth");
    for (const cfg of [sms({ name: "S" }), upsell({ name: "U" })]) {
      const c = await create(cfg);
      expect((await publish(c.id, c.updatedAt)).status, cfg.tool as string).toBe(200);
    }
  });

  it("a downgrade-to-free organisation cannot publish paid tools even if it once could", async () => {
    const { env, s, create, publish } = await setup();
    shipped.add("sms");
    await setPlan(env, s.orgId, "growth");
    await setPlan(env, s.orgId, "free");
    const c = await create(sms());
    expect((await publish(c.id, c.updatedAt)).status).toBe(402);
  });
});

describe("tool warnings from validate", () => {
  const warn = async (cfg: unknown) => {
    const env: Env = await makeEnv();
    const s = await setupStore(env);
    const r = await s.c.post(`/api/v1/stores/${s.storeId}/campaigns/validate`, cfg);
    expect(r.status).toBe(200);
    return r.json.data as { valid: boolean; issues: string[]; warnings: string[] };
  };

  it("flags SMS consent text without an opt-out or rates notice, and always asks for legal review", async () => {
    const weak = await warn(sms({ form: { ...smsForm, consentText: "Sign me up for texts from this store please." } }));
    expect(weak.valid).toBe(true);
    expect(weak.warnings.join("\n")).toMatch(/opt out/i);
    expect(weak.warnings.join("\n")).toMatch(/rates/i);
    expect(weak.warnings.join("\n")).toMatch(/reviewed/i);
    const good = await warn(sms());
    expect(good.warnings.join("\n")).not.toMatch(/opt out/i);
    expect(good.warnings.join("\n")).toMatch(/reviewed/i); // never claims compliance
  });
  it("flags immediate signup popups, and rejects single opt-in outright because it is not available", async () => {
    const r = await warn(email({ trigger: { type: "immediate" } }));
    expect(r.valid).toBe(true);
    expect(r.warnings.join("\n")).toMatch(/opens immediately/i);
    const single = await warn(email({ form: { ...emailForm, doubleOptIn: false } }));
    expect(single.valid).toBe(false);
    expect(single.issues.join("\n")).toMatch(/single opt-in is not available/i);
  });
  it("flags feed items that never expire and coupon toasts without a discount", async () => {
    expect((await warn(feed())).warnings.join("\n")).toMatch(/never expires/i);
    expect((await warn(feed({ schedule: { endsAt: "2099-01-01T00:00:00Z" } }))).warnings.join("\n")).not.toMatch(/never expires/i);
    expect((await warn(toast({ toast: { kind: "coupon" } }))).warnings.join("\n")).toMatch(/no discount is configured/i);
  });
  it("reports hard contract violations as issues, not warnings", async () => {
    const r = await warn(upsell({ recommend: { source: "manual" } }));
    expect(r.valid).toBe(false);
    expect(r.issues.join("\n")).toMatch(/at least one product/i);
  });
});

describe("authorization is unchanged by tools", () => {
  it("anonymous users cannot list or create tool campaigns", async () => {
    const env = await makeEnv();
    const s = await setupStore(env);
    const anon = await signup(env, "stranger@example.com");
    expect((await anon.c.get(`/api/v1/stores/${s.storeId}/campaigns?tool=feed`)).status).toBe(404);
    expect((await anon.c.post(`/api/v1/stores/${s.storeId}/campaigns`, feed())).status).toBe(404);
  });
});

describe("toast is live in production configuration", () => {
  it("publishes on the free plan and is served to storefronts with the store currency", async () => {
    for (const t of defaults) shipped.add(t); // the real shipped list, not a test override
    expect(shipped.has("toast")).toBe(true);
    const { env, s, create, publish } = await setup();
    const c = await create(toast({ toast: { kind: "shipping_incentive", freeShippingThreshold: 75, corner: "top_right" } }));
    expect((await publish(c.id, c.updatedAt)).status).toBe(200);

    const res = await env.app.request(`/sdk/v1/config/${s.siteKey}.json`);
    expect(res.status).toBe(200);
    const cfg = await res.json() as { currency?: string; campaigns: { campaignId: string; config: { tool?: string; format: string; toast?: { kind: string; freeShippingThreshold?: number } } }[] };
    expect(cfg.currency).toBe("USD");
    const served = cfg.campaigns.find((x) => x.campaignId === c.id);
    expect(served?.config).toMatchObject({ tool: "toast", format: "toast", toast: { kind: "shipping_incentive", freeShippingThreshold: 75 } });
  });

  it("pausing removes it from the served config straight away", async () => {
    for (const t of defaults) shipped.add(t);
    const { env, s, base, create, publish } = await setup();
    const c = await create(toast());
    await publish(c.id, c.updatedAt);
    expect((await s.c.post(`${base}/${c.id}/pause`)).status).toBe(204);
    const cfg = await (await env.app.request(`/sdk/v1/config/${s.siteKey}.json`)).json() as { campaigns: unknown[] };
    expect(cfg.campaigns).toEqual([]);
  });
});
