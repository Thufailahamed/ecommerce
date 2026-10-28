import { describe, expect, it } from "vitest";
import { TOOL_METRICS, Tool } from "@convertflow/contracts";
import { schema } from "@convertflow/database";
import { Client, KEY, MailBox, makeEnv, setPlan, signup, validConfig, type Env } from "./helpers.js";
import { purgeStoreData } from "../src/services/privacy.js";

const secrets = { credentialKey: KEY, webOrigin: "https://app.example.com", apiOrigin: "https://api.example.com" };
const RANGE = "from=2026-10-01&to=2026-10-31";
const ev = (siteId: string, o: Record<string, unknown>) => ({ eventId: `e_${Math.random().toString(36).slice(2, 14)}`, siteId, sessionId: "sess_12345678", occurredAt: "2026-10-27T12:00:00.000Z", schemaVersion: 1, ...o });
const send = (env: Env, events: unknown[]) => env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ consent: true, events }) });

const toast = () => validConfig({ name: "Toast" });
const feed = () => validConfig({ name: "Feed", tool: "feed", format: "feed_item", feed: { category: "Offers" }, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] } });
const upsell = () => validConfig({
  name: "Upsell", tool: "upsell", format: "recommendation", recommend: { source: "manual", productIds: ["p1"] }, goal: { type: "add_to_cart" },
  trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] },
});
const email = () => validConfig({
  name: "Signup", tool: "email", format: "popup",
  form: { collect: { email: true }, consentText: "I agree to receive marketing emails from Shop. I can unsubscribe at any time.", privacyUrl: "https://shop.example.com/privacy" },
});

type Kind = "toast" | "feed" | "upsell" | "email";
const CONFIGS: Record<Kind, () => Record<string, unknown>> = { toast, feed, upsell, email };

/** A store with one published campaign per shipped tool. */
async function shop() {
  const mail = new MailBox();
  const env = await makeEnv(undefined, { email: mail, secrets });
  const u = await signup(env, "owner@example.com");
  await new Client(env).post("/api/v1/auth/verify-email", { token: mail.token("owner@example.com") });
  await setPlan(env, u.orgId, "growth");
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Shop", domain: "shop.example.com", currency: "USD" });
  const storeId = s.json.data.id as string, siteKey = s.json.data.siteKey as string;
  const base = `/api/v1/stores/${storeId}`;
  const camp = {} as Record<Kind, { id: string; versionId: string }>;
  for (const k of Object.keys(CONFIGS) as Kind[]) {
    const c = await u.c.post(`${base}/campaigns`, CONFIGS[k]());
    expect(c.status, `${k}: ${JSON.stringify(c.json)}`).toBe(201);
    const pub = await u.c.post(`${base}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    expect(pub.status, `${k}: ${JSON.stringify(pub.json)}`).toBe(200);
    camp[k] = { id: c.json.data.id as string, versionId: pub.json.data.versionId as string };
  }
  const tools = async (q = RANGE, client: Client = u.c) => client.get(`${base}/analytics/tools?${q}`);
  const roll = async (q = RANGE) => {
    const r = await tools(q);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return Object.fromEntries((r.json.data.tools as { tool: string }[]).map((t) => [t.tool, t])) as Record<string, ToolRollup>;
  };
  const overall = async () => (await u.c.get(`${base}/analytics?${RANGE}`)).json.data;
  const fire = (kind: Kind, type: string, n = 1, extra: Record<string, unknown> = {}) =>
    send(env, Array.from({ length: n }, () => ev(siteKey, { type, campaignId: camp[kind].id, versionId: camp[kind].versionId, ...extra })));
  return { env, mail, ...u, storeId, siteKey, base, camp, tools, roll, fire, overall };
}
type Shop = Awaited<ReturnType<typeof shop>>;

interface Rates { ctr: number | null; dismissRate: number | null; addToCartRate: number | null; requestRate: number | null; confirmRate: number | null }
interface Counts {
  eligible: number; impressions: number; clicks: number; dismissals: number; addToCarts: number;
  formSubmitAttempts: number; formSubmitSuccesses: number; formSubmitFailures: number;
  requested: number; confirmed: number; deliveryFailed: number; attributedOrders: number; attributedRevenue: number;
}
interface ToolRollup { tool: string; campaigns: number; live: number; metrics: Counts & Rates; byCampaign: ({ campaignId: string; name: string; status: string } & Counts & Rates)[] }

describe("per-tool analytics: the metrics each tool is measured by", () => {
  it("lists all five tools even when nothing has happened, with null rates rather than 0%", async () => {
    const t = await shop();
    const r = await t.roll();
    expect(Object.keys(r).sort()).toEqual([...Tool.options].sort());
    expect(r["sms"]).toMatchObject({ campaigns: 0, live: 0, byCampaign: [] });
    for (const tool of Tool.options) {
      expect(r[tool]!.metrics, tool).toMatchObject({ impressions: 0, clicks: 0, ctr: null, dismissRate: null, addToCartRate: null, requestRate: null, confirmRate: null });
    }
    // live campaigns are listed even before they have any activity
    expect(r["toast"]).toMatchObject({ campaigns: 1, live: 1 });
    expect(r["toast"]!.byCampaign.map((c) => c.name)).toEqual(["Toast"]);
  });

  it("toast: shown, clicks, dismissals and the rates that follow", async () => {
    const t = await shop();
    await t.fire("toast", "campaign_impression", 4);
    await t.fire("toast", "campaign_click");
    await t.fire("toast", "campaign_dismiss");
    const m = (await t.roll())["toast"]!.metrics;
    expect(m).toMatchObject({ impressions: 4, clicks: 1, dismissals: 1, ctr: 0.25, dismissRate: 0.25 });
  });

  it("feed: item views and item clicks, not mixed into other tools", async () => {
    const t = await shop();
    await t.fire("feed", "feed_open", 3);
    await t.fire("feed", "feed_item_click");
    const r = await t.roll();
    expect(r["feed"]!.metrics).toMatchObject({ impressions: 3, clicks: 1 });
    expect(r["feed"]!.metrics.ctr).toBeCloseTo(1 / 3);
    expect(r["toast"]!.metrics).toMatchObject({ impressions: 0, clicks: 0 });
    expect(r["upsell"]!.metrics).toMatchObject({ impressions: 0 });
  });

  it("upsell: blocks shown, product clicks, add-to-carts and the add-to-cart rate", async () => {
    const t = await shop();
    await t.fire("upsell", "recommendation_impression", 2);
    await t.fire("upsell", "recommendation_click");
    await t.fire("upsell", "recommendation_add_to_cart");
    const m = (await t.roll())["upsell"]!.metrics;
    expect(m).toMatchObject({ impressions: 2, clicks: 1, addToCarts: 1, ctr: 0.5, addToCartRate: 0.5 });
  });

  it("form submissions are counted per form from the browser's events, and kept apart from the aggregates", async () => {
    const t = await shop();
    await t.fire("email", "campaign_impression", 10);
    await t.fire("email", "form_submit_attempt", 4);
    await t.fire("email", "form_submit_success", 3);
    await t.fire("email", "form_submit_failure", 1);
    const m = (await t.roll())["email"]!.metrics;
    expect(m).toMatchObject({ impressions: 10, formSubmitAttempts: 4, formSubmitSuccesses: 3, formSubmitFailures: 1 });
    const stored = await t.env.deps.db.select().from(schema.metricCounters);
    expect(stored.map((r) => [r.metric, r.value]).sort()).toEqual([["form_submit_attempt", 4], ["form_submit_failure", 1], ["form_submit_success", 3]]);
    // form events never touch the shared aggregate columns
    const agg = await t.env.deps.db.select().from(schema.analyticsAggregates);
    expect(agg.reduce((n, r) => n + r.clicks + r.dismissals + r.subscriptions, 0)).toBe(0);
  });

  it("sign-up requests and confirmations are counted on the server per form, with the request and confirmation rates", async () => {
    const t = await shop();
    await t.fire("email", "campaign_impression", 10);
    const subscribe = (addr: string) => t.env.app.request("/api/v1/notifications/subscribe", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ siteId: t.siteKey, campaignId: t.camp.email.id, email: addr, consent: true }) });
    for (const a of ["a@example.com", "b@example.com", "c@example.com"]) expect((await subscribe(a)).status).toBe(202);
    const link = (to: string) => { const u = new URL(t.mail.link(to)); return u.pathname + u.search; };
    await t.env.app.request(link("a@example.com"));
    await t.env.app.request(link("b@example.com"));
    t.mail.failNext = true; // the confirmation email for the next request cannot be sent
    await subscribe("d@example.com");
    const m = (await t.roll())["email"]!.metrics;
    expect(m).toMatchObject({ requested: 4, confirmed: 2, deliveryFailed: 1, requestRate: 0.4, confirmRate: 0.5 });
    // the same numbers back the per-form list on the overall analytics view
    const forms = (await t.overall()).forms as { campaignId: string; requested: number; confirmed: number; deliveryFailed: number }[];
    expect(forms).toEqual([expect.objectContaining({ campaignId: t.camp.email.id, requested: 4, confirmed: 2, deliveryFailed: 1 })]);
  });

  it("attributed orders and revenue are shown under the tool whose campaign was clicked", async () => {
    const t = await shop();
    await t.fire("upsell", "recommendation_click");
    await send(t.env, [ev(t.siteKey, { type: "purchase_observed", order: { orderId: "o1", total: 80, currency: "USD", lastClick: { campaignId: t.camp.upsell.id, versionId: t.camp.upsell.versionId, clickedAt: "2026-10-27T11:00:00.000Z" } } })]);
    const r = await t.roll();
    expect(r["upsell"]!.metrics).toMatchObject({ attributedOrders: 1, attributedRevenue: 80 });
    expect(r["toast"]!.metrics).toMatchObject({ attributedOrders: 0, attributedRevenue: 0 });
  });
});

describe("per-tool analytics: integrity", () => {
  it("counts a repeated event id once, for counters as well as aggregates", async () => {
    const t = await shop();
    const e = ev(t.siteKey, { type: "form_submit_success", campaignId: t.camp.email.id, versionId: t.camp.email.versionId });
    await send(t.env, [e, e]);
    await send(t.env, [e]);
    expect((await t.roll())["email"]!.metrics.formSubmitSuccesses).toBe(1);
  });

  it("ignores a forged version, a version from another campaign and another store's campaign", async () => {
    const t = await shop();
    const other = await shop2(t.env, t.mail);
    await send(t.env, [
      ev(t.siteKey, { type: "form_submit_success", campaignId: t.camp.email.id, versionId: "ver_forged" }),
      ev(t.siteKey, { type: "form_submit_success", campaignId: t.camp.email.id, versionId: t.camp.toast.versionId }),
      ev(t.siteKey, { type: "form_submit_success", campaignId: other.campaignId, versionId: other.versionId }),
      ev(t.siteKey, { type: "form_submit_success" }),
    ]);
    expect(await t.env.deps.db.select().from(schema.metricCounters)).toEqual([]);
  });

  it("only counts days inside the requested range", async () => {
    const t = await shop();
    await t.fire("email", "form_submit_success", 2, { occurredAt: "2026-09-15T12:00:00.000Z" });
    await t.fire("email", "form_submit_success", 3);
    expect((await t.roll("from=2026-10-01&to=2026-10-31"))["email"]!.metrics.formSubmitSuccesses).toBe(3);
    expect((await t.roll("from=2026-09-01&to=2026-10-31"))["email"]!.metrics.formSubmitSuccesses).toBe(5);
    expect((await t.roll("from=2026-10-28&to=2026-10-31"))["email"]!.metrics.formSubmitSuccesses).toBe(0);
  });

  it("agrees with the overall analytics view and leaves it unchanged", async () => {
    const t = await shop();
    await t.fire("toast", "campaign_impression", 5);
    await t.fire("toast", "campaign_click", 2);
    await t.fire("feed", "feed_open", 3);
    await t.fire("upsell", "recommendation_impression", 4);
    await t.fire("upsell", "recommendation_add_to_cart", 1);
    await t.fire("email", "form_submit_success", 7); // must not leak into the overall totals
    const overall = await t.overall();
    const r = await t.roll();
    const sum = (k: "impressions" | "clicks" | "addToCarts") => Object.values(r).reduce((n, x) => n + x.metrics[k], 0);
    expect(overall.totals).toMatchObject({ impressions: 12, clicks: 2, addToCarts: 1 });
    expect(sum("impressions")).toBe(overall.totals.impressions);
    expect(sum("clicks")).toBe(overall.totals.clicks);
    expect(sum("addToCarts")).toBe(overall.totals.addToCarts);
    expect(Object.keys(overall.campaigns[0])).toEqual(expect.arrayContaining(["campaignId", "impressions", "clicks", "ctr", "attributedOrders"]));
  });

  it("drill-down lists a campaign with activity, sorted by what was shown, and hides idle archived ones", async () => {
    const t = await shop();
    const c2 = await t.c.post(`${t.base}/campaigns`, validConfig({ name: "Second toast" }));
    await t.c.post(`${t.base}/campaigns/${c2.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c2.json.data.updatedAt });
    const v2 = (await t.c.get(`${t.base}/campaigns/${c2.json.data.id}/versions`)).json.data[0].id as string;
    await send(t.env, [ev(t.siteKey, { type: "campaign_impression", campaignId: c2.json.data.id, versionId: v2 })]);
    await t.fire("toast", "campaign_impression", 3);
    const idle = await t.c.post(`${t.base}/campaigns`, validConfig({ name: "Old draft" })); // never published: no activity, not live
    expect(idle.status).toBe(201);
    const toastRows = (await t.roll())["toast"]!;
    expect(toastRows.campaigns).toBe(3);
    expect(toastRows.byCampaign.map((c) => [c.name, c.impressions])).toEqual([["Toast", 3], ["Second toast", 1]]);
    expect(toastRows.metrics.impressions).toBe(4);
  });

  it("purging a store removes its counters and experiment stats", async () => {
    const t = await shop();
    await t.fire("email", "form_submit_success", 2);
    expect(await t.env.deps.db.select().from(schema.metricCounters)).toHaveLength(1);
    await purgeStoreData(t.env.deps, t.storeId);
    expect(await t.env.deps.db.select().from(schema.metricCounters)).toEqual([]);
  });
});

describe("per-tool analytics: access and input", () => {
  it("requires a session, and one member's store is not readable by another organisation", async () => {
    const t = await shop();
    expect((await t.tools(RANGE, new Client(t.env))).status).toBe(401);
    const intruder = await signup(t.env, "intruder@example.com");
    const res = await t.tools(RANGE, intruder.c);
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.json)).not.toContain("Toast");
  });

  it("rejects malformed, reversed and over-long ranges", async () => {
    const t = await shop();
    for (const q of ["", "from=2026-10-01", "from=yesterday&to=today", "from=2026-13-45&to=2026-13-46", "from=2026-10-31&to=2026-10-01", "from=2024-01-01&to=2026-10-31"]) {
      expect((await t.tools(q)).status, q).toBe(422);
    }
    expect((await t.tools("from=2026-10-27&to=2026-10-27")).status).toBe(200);
  });

  it("every shipped tool has a metric list that this endpoint can answer", async () => {
    const t = await shop();
    const m = (await t.roll())["toast"]!.metrics as unknown as Record<string, unknown>;
    for (const tool of Tool.options) for (const def of TOOL_METRICS[tool]) expect(m, `${tool}.${def.key}`).toHaveProperty(def.key);
  });
});

/** A second, separate store in the same database, for cross-tenant checks. */
async function shop2(env: Env, mail: MailBox) {
  const addr = `other${Math.random().toString(36).slice(2, 8)}@example.com`;
  const u = await signup(env, addr);
  await new Client(env).post("/api/v1/auth/verify-email", { token: mail.token(addr) });
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Other", domain: "other.example.com", currency: "USD" });
  const base = `/api/v1/stores/${s.json.data.id}`;
  const c = await u.c.post(`${base}/campaigns`, validConfig({ name: "Other toast" }));
  const pub = await u.c.post(`${base}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
  return { campaignId: c.json.data.id as string, versionId: pub.json.data.versionId as string, siteKey: s.json.data.siteKey as string };
}
