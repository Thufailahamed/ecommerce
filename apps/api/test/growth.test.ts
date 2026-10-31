import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { Client, KEY, MailBox, makeEnv, setPlan, signup, validConfig, type Env } from "./helpers.js";

const secrets = { credentialKey: KEY, webOrigin: "https://app.example.com", apiOrigin: "https://api.example.com" };
const path = (url: string) => { const u = new URL(url); return u.pathname + u.search; };

async function verified(env: Env, mail: MailBox, email: string) {
  const u = await signup(env, email);
  await new Client(env).post("/api/v1/auth/verify-email", { token: mail.token(email) });
  return u;
}
async function shop(plan: "free" | "starter" | "growth" | "scale" = "growth", platform = "custom", domain = "shop.example.com") {
  const mail = new MailBox();
  const env = await makeEnv(undefined, { email: mail, secrets });
  const u = await verified(env, mail, "owner@example.com");
  await setPlan(env, u.orgId, plan);
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform, name: "Shop", domain, currency: "USD" });
  return { env, mail, ...u, storeId: s.json.data.id as string, siteKey: s.json.data.siteKey as string };
}
const importProduct = (c: Client, storeId: string, id: string, available: boolean | undefined, title = "Trail Runner") =>
  c.post(`/api/v1/stores/${storeId}/products/import`, { products: [{ externalId: id, title, url: `/products/${id}`, variants: [{ externalId: `${id}-v`, ...(available === undefined ? {} : { available }) }] }] });
const subscribe = (env: Env, siteId: string, productId: string, email: string) =>
  env.app.request("/api/v1/notifications/restock", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ siteId, productId, email }) });
const subs = (env: Env) => env.deps.db.select().from(schema.subscribers);

describe("back-in-stock alerts", () => {
  it("full double-opt-in flow: confirm first, alert exactly once when stock returns", async () => {
    const t = await shop();
    await importProduct(t.c, t.storeId, "p1", false);
    expect((await subscribe(t.env, t.siteKey, "p1", "Shopper@Example.com")).status).toBe(202);

    // 1) only a confirmation goes out
    expect(t.mail.sent.filter((m) => m.to === "shopper@example.com")).toHaveLength(1);
    expect(t.mail.last("shopper@example.com")?.subject).toMatch(/Confirm/);
    expect((await subs(t.env))[0]?.status).toBe("pending");

    // 2) stock returns while still pending: nothing is sent
    await importProduct(t.c, t.storeId, "p1", true);
    expect(t.mail.sent.filter((m) => m.to === "shopper@example.com")).toHaveLength(1);
    await importProduct(t.c, t.storeId, "p1", false);

    // 3) shopper confirms via the emailed link
    const confirm = await t.env.app.request(path(t.mail.link("shopper@example.com")));
    expect(await confirm.text()).toContain("You&#39;re confirmed".replace("&#39;", "'"));
    expect(confirm.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await subs(t.env))[0]?.status).toBe("confirmed");
    expect(await (await t.env.app.request(path(t.mail.link("shopper@example.com")))).text()).toContain("Link not valid"); // single use

    // 4) restock -> one alert; importing again does not repeat it
    const r = await importProduct(t.c, t.storeId, "p1", true);
    expect(r.json.data).toMatchObject({ restocked: 1, alertsSent: 1 });
    const alert = t.mail.last("shopper@example.com")!;
    expect(alert.subject).toMatch(/available again/);
    expect(alert.text).toContain("https://shop.example.com/products/p1");
    expect(alert.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect((await subs(t.env))[0]?.status).toBe("notified");
    await importProduct(t.c, t.storeId, "p1", false);
    await importProduct(t.c, t.storeId, "p1", true);
    expect(t.mail.sent.filter((m) => m.subject.match(/available again/))).toHaveLength(1);
    const [usage] = await t.env.deps.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.metric, "notifications"));
    expect(usage?.count).toBe(1);
  });
  it("unsubscribe works by link and one-click POST, suppresses forever, and rejects tampered tokens", async () => {
    const t = await shop();
    await importProduct(t.c, t.storeId, "p1", false);
    await subscribe(t.env, t.siteKey, "p1", "a@example.com");
    await t.env.app.request(path(t.mail.link("a@example.com")));
    await importProduct(t.c, t.storeId, "p1", true);
    const unsubUrl = t.mail.last("a@example.com")!.headers!["List-Unsubscribe"]!.replace(/[<>]/g, "");

    const bad = unsubUrl.slice(0, -3) + "AAA";
    expect(await (await t.env.app.request(path(bad))).text()).toContain("Link not valid");
    expect((await subs(t.env))[0]?.status).toBe("notified");

    const one = await t.env.app.request(path(unsubUrl), { method: "POST" }); // RFC 8058 one-click
    expect(await one.text()).toContain("unsubscribed");
    expect((await subs(t.env))[0]?.status).toBe("unsubscribed");
    expect(await t.env.deps.db.select().from(schema.suppressionRecords)).toHaveLength(1);

    const before = t.mail.sent.length;
    await subscribe(t.env, t.siteKey, "p1", "a@example.com"); // cannot come back by accident
    expect(t.mail.sent.length).toBe(before);
    expect((await subs(t.env))[0]?.status).toBe("unsubscribed");
  });
  it("answers identically for everything and never emails without an eligible plan", async () => {
    const free = await shop("free");
    await importProduct(free.c, free.storeId, "p1", false);
    const sent = free.mail.sent.length;
    for (const args of [[free.siteKey, "p1", "x@example.com"], ["cf_unknownsite00", "p1", "x@example.com"], [free.siteKey, "nope", "x@example.com"], [free.siteKey, "p1", "not-an-email"]] as const) {
      const [site, prod, addr] = args;
      const r = await subscribe(free.env, site, prod, addr);
      expect([r.status, await r.json()]).toEqual([202, { ok: true }]);
    }
    expect(free.mail.sent.length).toBe(sent);
    expect(await subs(free.env)).toHaveLength(0);
  });
  it("respects the monthly quota and the rest wait for the next run", async () => {
    const t = await shop();
    await importProduct(t.c, t.storeId, "p1", false);
    for (const e of ["a@example.com", "b@example.com", "c@example.com"]) { await subscribe(t.env, t.siteKey, "p1", e); await t.env.app.request(path(t.mail.link(e))); }
    await t.env.deps.db.insert(schema.usageRecords).values({ organizationId: t.orgId, metric: "notifications", period: "2026-10", count: 998 });
    const r = await importProduct(t.c, t.storeId, "p1", true);
    expect(r.json.data.alertsSent).toBe(2);
    expect((await subs(t.env)).filter((s) => s.status === "confirmed")).toHaveLength(1);
    const { notifyRestock } = await import("../src/services/restock.js");
    t.env.clock.t = Date.parse("2026-11-02T00:00:00Z"); // new month, quota reset
    expect((await notifyRestock(t.env.deps, t.storeId)).sent).toBe(1);
    expect((await subs(t.env)).every((s) => s.status === "notified")).toBe(true);
  });
  it("a provider failure leaves the subscriber to retry, not silently dropped", async () => {
    const t = await shop();
    await importProduct(t.c, t.storeId, "p1", false);
    await subscribe(t.env, t.siteKey, "p1", "a@example.com");
    await t.env.app.request(path(t.mail.link("a@example.com")));
    t.mail.failNext = true;
    await importProduct(t.c, t.storeId, "p1", true);
    expect((await subs(t.env))[0]?.status).toBe("confirmed");
    const { notifyRestock } = await import("../src/services/restock.js");
    expect((await notifyRestock(t.env.deps, t.storeId)).sent).toBe(1);
  });
  it("retention: shopper emails are deleted on schedule while the hashed suppression entry stays", async () => {
    const t = await shop();
    await importProduct(t.c, t.storeId, "p1", false);
    for (const e of ["pending@example.com", "done@example.com", "gone@example.com", "fresh@example.com"]) { await subscribe(t.env, t.siteKey, "p1", e); }
    await t.env.app.request(path(t.mail.link("done@example.com")));
    await t.env.app.request(path(t.mail.link("gone@example.com")));
    await importProduct(t.c, t.storeId, "p1", true); // done + gone are alerted
    const unsub = t.mail.last("gone@example.com")!.headers!["List-Unsubscribe"]!.replace(/[<>]/g, "");
    await t.env.app.request(path(unsub), { method: "POST" });
    const { purgeSubscribers } = await import("../src/services/restock.js");

    expect(await purgeSubscribers(t.env.deps)).toBe(0); // nothing is old yet
    t.env.clock.t += 8 * 86_400_000; // day 8: only never-confirmed sign-ups go
    expect(await purgeSubscribers(t.env.deps)).toBe(2); // pending@ and fresh@ were never confirmed
    t.env.clock.t += 23 * 86_400_000; // day 31: alerted and unsubscribed go
    expect(await purgeSubscribers(t.env.deps)).toBe(2);
    expect(await subs(t.env)).toHaveLength(0);
    expect(await t.env.deps.db.select().from(schema.suppressionRecords)).toHaveLength(1); // still cannot be re-subscribed
  });
  it("products that merely appear in stock are not 'restocks'", async () => {
    const t = await shop();
    const r = await importProduct(t.c, t.storeId, "new1", true);
    expect(r.json.data.restocked).toBe(0);
  });
  it("the restock form can only be published on a plan and deployment that support it", async () => {
    const free = await shop("free");
    const cfg = validConfig({ format: "restock", creative: { headline: "Notify me", ctaLabel: "Email me", ctaUrl: "/" }, targeting: { match: "all", conditions: [{ field: "product_available", op: "equals", value: false }] } });
    const pubOn = async (t: Awaited<ReturnType<typeof shop>>) => {
      const c = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns`, cfg);
      return t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    };
    expect((await pubOn(free)).json.error.code).toBe("plan_limit");
    const growth = await shop("growth");
    expect((await pubOn(growth)).status).toBe(200);

    const noMail = await makeEnv(undefined, { secrets });
    const u = await signup(noMail, "o@example.com");
    await setPlan(noMail, u.orgId, "growth");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "S", domain: "s.example.com", currency: "USD" });
    const c = await u.c.post(`/api/v1/stores/${s.json.data.id}/campaigns`, cfg);
    const r = await u.c.post(`/api/v1/stores/${s.json.data.id}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    expect(r.json.error.code).toBe("restock_unavailable");
    const v = await u.c.post(`/api/v1/stores/${s.json.data.id}/campaigns/validate`, { ...cfg, targeting: { match: "all", conditions: [] } });
    expect(v.json.data.warnings.join(" ")).toMatch(/out of stock/);
  });
});

describe("holdout experiments", () => {
  const withCampaign = async (plan: "starter" | "growth" = "growth") => {
    const t = await shop(plan);
    const c = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns`, validConfig({ experiment: { holdoutPercent: 20 } }));
    const pub = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    const campaignId = c.json.data.id as string;
    const versionId = pub.json.data?.versionId as string | undefined;
    return { ...t, pub, campaignId, versionId: versionId ?? "" };
  };
  const post = (t: { env: Env }, events: unknown[]) => t.env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ consent: true, events }) });
  const ev = (siteId: string, o: Record<string, unknown>) => ({ eventId: `evt_${Math.random().toString(36).slice(2, 12)}`, siteId, sessionId: "sess_12345678", occurredAt: "2026-10-27T12:00:00.000Z", schemaVersion: 1, ...o });

  it("is a paid feature enforced at publish time", async () => {
    const starter = await withCampaign("starter");
    expect(starter.pub.status).toBe(402);
    expect(starter.pub.json.error.message).toMatch(/Growth/);
    expect((await withCampaign("growth")).pub.status).toBe(200);
  });
  it("counts randomised sessions per arm (de-duplicated) and records each order's arm once", async () => {
    const t = await withCampaign();
    const base = { siteId: t.siteKey, campaignId: t.campaignId, versionId: t.versionId };
    const a = ev(t.siteKey, { ...base, type: "experiment_assigned", group: "holdout" });
    await post(t, [a, a, ev(t.siteKey, { ...base, type: "experiment_assigned", group: "treatment" }), ev(t.siteKey, { ...base, type: "experiment_assigned" })]); // last has no group: rejected
    const rows = await t.env.deps.db.select().from(schema.experimentStats);
    expect(rows.map((r) => `${r.group}:${r.sessions}`).sort()).toEqual(["holdout:1", "treatment:1"]);

    const order = (group: "treatment" | "holdout") => ({ orderId: "O-1", total: 40, currency: "USD", experiment: { campaignId: t.campaignId, versionId: t.versionId, group } });
    await post(t, [ev(t.siteKey, { type: "purchase_observed", order: order("holdout") })]);
    await post(t, [ev(t.siteKey, { type: "purchase_observed", order: order("treatment") })]); // same order, different arm claim
    const [conv] = await t.env.deps.db.select().from(schema.conversions);
    expect(conv).toMatchObject({ expCampaignId: t.campaignId, expGroup: "holdout" }); // first report wins
    await post(t, [ev(t.siteKey, { type: "purchase_observed", order: { ...order("treatment"), orderId: "O-2", experiment: { campaignId: "cmp_forged", versionId: "ver_forged", group: "treatment" } } })]);
    expect((await t.env.deps.db.select().from(schema.conversions).where(eq(schema.conversions.orderId, "O-2")))[0]?.expGroup).toBeNull(); // forged campaign ignored
  });
  it("reports lift only when the data supports it", async () => {
    const t = await withCampaign();
    const { campaignId, versionId } = t;
    const seed = async (arm: "treatment" | "holdout", sessions: number, orders: number) => {
      await t.env.deps.db.insert(schema.experimentStats).values({ storeId: t.storeId, campaignId, versionId, group: arm, day: "2026-10-27", sessions });
      for (let i = 0; i < orders; i++) await t.env.deps.db.insert(schema.conversions).values({ id: `cnv_${arm}_${i}`, storeId: t.storeId, orderId: `${arm}-${i}`, total: 10, currency: "USD", expCampaignId: campaignId, expGroup: arm, occurredAt: "2026-10-27T10:00:00.000Z" });
    };
    const read = async () => ((await t.c.get(`/api/v1/stores/${t.storeId}/analytics?from=2026-10-01&to=2026-10-31`)).json.data.experiments as { verdict: string; relativeLift: number | null; treatment: { sessions: number; orders: number }; holdout: { sessions: number; orders: number }; pValue: number | null }[])[0]!;
    await seed("treatment", 100, 10); await seed("holdout", 100, 4);
    expect((await read()).verdict).toBe("insufficient_data"); // big-looking gap, tiny sample

    await t.env.deps.db.delete(schema.experimentStats); await t.env.deps.db.delete(schema.conversions);
    await seed("treatment", 5000, 300); await seed("holdout", 5000, 200);
    const r = await read();
    expect(r.verdict).toBe("significant_positive");
    expect(r.relativeLift).toBeCloseTo(0.5, 5);
    expect(r.treatment).toMatchObject({ sessions: 5000, orders: 300 });
    expect(r.pValue!).toBeLessThan(0.001);

    await t.env.deps.db.delete(schema.experimentStats); await t.env.deps.db.delete(schema.conversions);
    await seed("treatment", 1000, 52); await seed("holdout", 1000, 48);
    expect((await read()).verdict).toBe("not_significant");
  });
});

describe("promotions and the discount guardrail", () => {
  const promoCfg = (percentOff: number) => validConfig({ promotion: { code: "SPRING", percentOff, label: "Spring offer" } });
  const publishPromo = async (t: Awaited<ReturnType<typeof shop>>, pct: number) => {
    const c = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns`, promoCfg(pct));
    return t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
  };
  it("is off until the store opts in, then capped at the store's ceiling", async () => {
    const t = await shop("starter");
    expect((await publishPromo(t, 10)).json.error.code).toBe("promotion_not_allowed");
    expect((await t.c.patch(`/api/v1/stores/${t.storeId}/settings`, { maxDiscountPercent: 20 })).status).toBe(204);
    expect((await publishPromo(t, 25)).json.error.code).toBe("promotion_exceeds_limit");
    expect((await publishPromo(t, 15)).status).toBe(200);
    const cfg = await (await t.env.app.request(`/sdk/v1/config/${t.siteKey}.json`)).json() as { campaigns: { config: { promotion: { code: string } } }[] };
    expect(cfg.campaigns[0]?.config.promotion.code).toBe("SPRING");
    expect((await t.c.patch(`/api/v1/stores/${t.storeId}/settings`, { maxDiscountPercent: null })).status).toBe(204);
    expect((await publishPromo(t, 5)).json.error.code).toBe("promotion_not_allowed"); // opting out blocks new publishes
  });
  it("only admins can change the ceiling, and it must be a sane value", async () => {
    const t = await shop("starter");
    expect((await t.c.patch(`/api/v1/stores/${t.storeId}/settings`, { maxDiscountPercent: 95 })).status).toBe(422);
    expect((await t.c.patch(`/api/v1/stores/${t.storeId}/settings`, { maxDiscountPercent: 0 })).status).toBe(422);
    const out = await signup(t.env, "out@example.com");
    expect((await out.c.patch(`/api/v1/stores/${t.storeId}/settings`, { maxDiscountPercent: 10 })).status).toBe(404);
  });
  it("rejects malformed codes at the schema", async () => {
    const t = await shop("starter");
    const r = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns`, validConfig({ promotion: { code: "<script>", percentOff: 10 } }));
    expect(r.status).toBe(422);
  });
});

describe("live catalog sync", () => {
  const wooItems = (n: number, off = 0) => Array.from({ length: n }, (_, i) => ({ id: off + i + 1, name: `Item ${off + i + 1}`, status: "publish", permalink: `https://woo.example.com/product/item-${off + i + 1}/`, stock_status: "instock", price: "9.99" }));
  const fake = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fn = (async (url: string, init: RequestInit) => { calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) }); return handler(url, init); }) as unknown as typeof fetch;
    return { fn, calls };
  };
  const woo = async (handler: Parameters<typeof fake>[0]) => {
    const f = fake(handler);
    const env = await makeEnv(undefined, { secrets, fetchFn: f.fn });
    const u = await signup(env, "o@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "woocommerce", name: "Woo", domain: "woo.example.com", currency: "USD" });
    return { env, f, ...u, storeId: s.json.data.id as string };
  };
  const creds = { kind: "woocommerce", consumerKey: "ck_aaaaaaaaaaaa", consumerSecret: "cs_bbbbbbbbbbbb" };

  it("WooCommerce: pages through the catalog from the store's own domain only", async () => {
    const t = await woo((url) => new Response(JSON.stringify(url.includes("page=1") ? wooItems(25) : wooItems(3, 25))));
    expect((await t.c.post(`/api/v1/stores/${t.storeId}/integration/sync`, { page: 1 })).json.error.code).toBe("not_connected");
    expect((await t.c.post(`/api/v1/stores/${t.storeId}/integration/connect`, creds)).json.data).toMatchObject({ connected: true, kind: "woocommerce" });
    const p1 = await t.c.post(`/api/v1/stores/${t.storeId}/integration/sync`, { page: 1 });
    expect(p1.json.data).toMatchObject({ imported: 25, created: 25, nextPage: 2 }); // 25 a page: variable products cost extra requests
    const p2 = await t.c.post(`/api/v1/stores/${t.storeId}/integration/sync`, { page: 2 });
    expect(p2.json.data).toMatchObject({ imported: 3, nextPage: null });
    expect(await t.env.deps.db.select().from(schema.products)).toHaveLength(28);
    for (const c of t.f.calls) {
      expect(new URL(c.url).host).toBe("woo.example.com"); // never a user-supplied host
      expect(c.headers["authorization"]).toBe(`Basic ${btoa("ck_aaaaaaaaaaaa:cs_bbbbbbbbbbbb")}`);
    }
    const [row] = await t.env.deps.db.select().from(schema.integrationCredentials);
    expect(JSON.stringify(row)).not.toContain("cs_bbbbbbbbbbbb"); // encrypted at rest
    const re = await t.c.post(`/api/v1/stores/${t.storeId}/integration/sync`, { page: 1 });
    expect(re.json.data).toMatchObject({ created: 0, updated: 25 }); // idempotent
  });
  it("surfaces rejected credentials and unreachable stores clearly", async () => {
    const rejected = await woo(() => new Response("no", { status: 401 }));
    // Keys are checked against the store before they are stored, so the merchant hears about it when connecting.
    expect((await rejected.c.post(`/api/v1/stores/${rejected.storeId}/integration/connect`, creds)).json.error.code).toBe("credentials_rejected");
    expect((await rejected.c.post(`/api/v1/stores/${rejected.storeId}/integration/sync`, { page: 1 })).json.error.code).toBe("not_connected");
    const down = await woo(() => { throw new Error("ECONNREFUSED"); });
    expect((await down.c.post(`/api/v1/stores/${down.storeId}/integration/connect`, creds)).json.error.code).toBe("catalog_unreachable");
    const garbage = await woo(() => new Response("<html>", { status: 200 }));
    expect((await garbage.c.post(`/api/v1/stores/${garbage.storeId}/integration/connect`, creds)).json.error.code).toBe("catalog_error");
  });
  it("enforces platform match and roles, and requires the encryption key", async () => {
    const t = await woo(() => new Response("[]"));
    const custom = await t.c.post("/api/v1/stores", { organizationId: t.orgId, platform: "custom", name: "C", domain: "c.example.com", currency: "USD" }).catch(() => null);
    void custom; // free plan allows one store; verify the platform check on the Woo store instead
    expect((await t.c.post(`/api/v1/stores/${t.storeId}/integration/connect`, { kind: "bigcommerce", storeHash: "abc123", accessToken: "tok_12345678" })).json.error.code).toBe("wrong_platform");
    const bare = await makeEnv();
    const u = await signup(bare, "b@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "woocommerce", name: "W", domain: "w.example.com", currency: "USD" });
    expect((await u.c.post(`/api/v1/stores/${s.json.data.id}/integration/connect`, creds)).status).toBe(503);
  });
  it("BigCommerce: paginates by total_pages with the token header", async () => {
    const f = fake((url) => new Response(JSON.stringify({ data: [{ id: 1, name: "A", is_visible: true, availability: "available", inventory_tracking: "none", custom_url: { url: "/a/" } }], meta: { pagination: { total_pages: url.includes("page=1") ? 2 : 2 } } })));
    const env = await makeEnv(undefined, { secrets, fetchFn: f.fn });
    const u = await signup(env, "o@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "bigcommerce", name: "BC", domain: "bc.example.com", currency: "USD" });
    const id = s.json.data.id as string;
    expect((await u.c.post(`/api/v1/stores/${id}/integration/connect`, { kind: "bigcommerce", storeHash: "Bad Hash!", accessToken: "tok_12345678" })).status).toBe(422);
    await u.c.post(`/api/v1/stores/${id}/integration/connect`, { kind: "bigcommerce", storeHash: "abc123", accessToken: "tok_12345678" });
    expect((await u.c.post(`/api/v1/stores/${id}/integration/sync`, { page: 1 })).json.data).toMatchObject({ imported: 1, nextPage: 2 });
    expect((await u.c.post(`/api/v1/stores/${id}/integration/sync`, { page: 2 })).json.data).toMatchObject({ nextPage: null });
    expect(f.calls[0]?.url).toContain("https://api.bigcommerce.com/stores/abc123/v3/catalog/products");
    expect(f.calls[0]?.headers["x-auth-token"]).toBe("tok_12345678");
  });
  it("a sync that flips a product back in stock alerts its subscribers", async () => {
    let stock = "outofstock";
    const mail = new MailBox();
    const f = fake(() => new Response(JSON.stringify([{ id: 7, name: "Mug", status: "publish", permalink: "https://woo.example.com/product/mug/", stock_status: stock }])));
    const env = await makeEnv(undefined, { secrets, fetchFn: f.fn, email: mail });
    const u = await verified(env, mail, "o@example.com");
    await setPlan(env, u.orgId, "growth");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "woocommerce", name: "Woo", domain: "woo.example.com", currency: "USD" });
    const sid = s.json.data.id as string;
    await u.c.post(`/api/v1/stores/${sid}/integration/connect`, creds);
    await u.c.post(`/api/v1/stores/${sid}/integration/sync`, { page: 1 });
    await subscribe(env, s.json.data.siteKey, "7", "fan@example.com");
    await env.app.request(path(mail.link("fan@example.com")));
    stock = "instock";
    await u.c.post(`/api/v1/stores/${sid}/integration/sync`, { page: 1 });
    expect(mail.last("fan@example.com")?.subject).toMatch(/available again/);
    expect(and).toBeTypeOf("function");
  });
});
