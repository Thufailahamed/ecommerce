import { describe, expect, it } from "vitest";
import { schema } from "@convertflow/database";
import { INTEGRATION_CAPABILITIES, INTEGRATION_PROVIDERS } from "@convertflow/contracts";
import { newId } from "../src/lib/crypto.js";
import { FakeProvider } from "@convertflow/integrations";
import { KEY, makeEnv, setupStore, signup } from "./helpers.js";

type View = { key: string; kind: string; verification: string; capabilities: string[]; planned: string[]; status: { state: string; verified: boolean; lastSuccessAt: string | null; lastError: string | null }; healthCheckAvailable: boolean };

describe("integration registry", () => {
  it("never lists a capability as both built and planned, and only uses known capabilities", () => {
    for (const p of Object.values(INTEGRATION_PROVIDERS)) {
      for (const c of [...p.capabilities, ...p.planned]) expect(Object.keys(INTEGRATION_CAPABILITIES)).toContain(c);
      expect(p.capabilities.filter((c) => (p.planned as readonly string[]).includes(c))).toEqual([]);
      expect(p.verification).not.toBe("verified"); // nothing has run against a real service yet
    }
  });

  it("shows a custom store its own platform plus the list providers, honestly unverified and unconnected", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    const r = await t.c.get(`/api/v1/stores/${t.storeId}/integrations`);
    expect(r.status).toBe(200);
    const views = r.json.data as View[];
    expect(views.map((v) => v.key)).toEqual(["custom", "klaviyo", "mailchimp", "twilio"]);
    expect(views[0]!.status.state).toBe("not_applicable");
    expect(views.find((v) => v.key === "klaviyo")).toMatchObject({ verification: "unverified", status: { state: "not_connected", verified: false }, healthCheckAvailable: true });
    // The phone verifier is the operator's, not the merchant's: shown so SMS signup's availability is never a mystery.
    expect(views.find((v) => v.key === "twilio")).toMatchObject({ kind: "messaging_provider", status: { state: "not_connected", lastError: "SMS signup is not configured on this deployment" }, healthCheckAvailable: false });
  });

  it("a Shopify store registered by hand is not connected until the app is installed; its live check says so", async () => {
    const env = await makeEnv();
    const u = await signup(env, "s@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "shopify", name: "S", domain: "s.myshopify.com", currency: "USD" });
    const storeId = s.json.data.id as string;
    const at = (h: number) => new Date(Date.UTC(2026, 9, 27, h)).toISOString();
    await env.deps.db.insert(schema.webhookEvents).values([
      { id: newId("whk"), storeId, platform: "shopify", deliveryId: "a", topic: "products/update", status: "processed", receivedAt: at(1) },
      { id: newId("whk"), storeId, platform: "shopify", deliveryId: "b", topic: "orders/create", status: "failed", receivedAt: at(2) },
    ]);
    const shop = ((await u.c.get(`/api/v1/stores/${storeId}/integrations`)).json.data as View[])[0]!;
    expect(shop).toMatchObject({ key: "shopify", capabilities: expect.arrayContaining(["oauth.install", "catalog.sync", "billing.platform"]), status: { state: "not_connected", lastSuccessAt: at(1) }, healthCheckAvailable: true });
    const h = await u.c.post(`/api/v1/stores/${storeId}/integrations/shopify/health`);
    expect(h.status).toBe(200);
    expect(h.json.data).toMatchObject({ ok: false, detail: "Install the Shopify app for this store first" });
    expect((await u.c.post(`/api/v1/stores/${storeId}/integrations/woocommerce/health`)).status).toBe(404);
  });

  it("runs a list provider's real check through its adapter, and is tenant- and role-scoped", async () => {
    const fake = new FakeProvider("klaviyo");
    const env = await makeEnv(undefined, { secrets: { credentialKey: KEY } });
    env.deps.providers = { klaviyo: fake };
    const t = await setupStore(env);
    expect((await t.c.put(`/api/v1/stores/${t.storeId}/providers/klaviyo`, { apiKey: "pk_test_123456" })).status).toBe(200);
    const kl = ((await t.c.get(`/api/v1/stores/${t.storeId}/integrations`)).json.data as View[]).find((v) => v.key === "klaviyo")!;
    expect(kl.status).toMatchObject({ state: "connected", verified: false }); // a fake is never "live"
    const h = await t.c.post(`/api/v1/stores/${t.storeId}/integrations/klaviyo/health`);
    expect(h.json.data).toMatchObject({ ok: true });

    const other = await setupStore(env, "other@example.com");
    expect((await other.c.get(`/api/v1/stores/${t.storeId}/integrations`)).status).toBe(404);
    const viewer = await signup(env, "v@example.com");
    await env.deps.db.insert(schema.memberships).values({ id: newId("mem"), organizationId: t.orgId, userId: viewer.userId, role: "viewer", createdAt: new Date(env.clock.t).toISOString() });
    expect((await viewer.c.get(`/api/v1/stores/${t.storeId}/integrations`)).status).toBe(403);
  });
});
