import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { Tool, isCounterEvent, type CounterEvent } from "@convertflow/contracts";
import type { Deps } from "../deps.js";
import { compareArms } from "../lib/stats.js";

const { analyticsAggregates: a, attributionRecords: ar, conversions: cv } = schema;

/**
 * Holdout experiment results: orders per randomised session in each arm (intent-to-treat), compared with a
 * pooled two-proportion z-test. A verdict is withheld until both arms have enough data.
 */
async function experimentResults(d: Deps, storeId: string, from: string, to: string) {
  const x = schema.experimentStats;
  const sessions = await d.db.select({ campaignId: x.campaignId, group: x.group, n: sql<number>`coalesce(sum(${x.sessions}),0)` })
    .from(x).where(and(eq(x.storeId, storeId), gte(x.day, from), lte(x.day, to))).groupBy(x.campaignId, x.group);
  if (sessions.length === 0) return [];
  const orders = await d.db.select({ campaignId: cv.expCampaignId, group: cv.expGroup, n: sql<number>`count(*)`, revenue: sql<number>`coalesce(sum(${cv.total}),0)` })
    .from(cv).where(and(eq(cv.storeId, storeId), gte(cv.occurredAt, `${from}T00:00:00.000Z`), lte(cv.occurredAt, `${to}T23:59:59.999Z`), sql`${cv.expGroup} is not null`))
    .groupBy(cv.expCampaignId, cv.expGroup);
  const ids = [...new Set(sessions.map((s) => s.campaignId))];
  return ids.map((campaignId) => {
    const arm = (g: "treatment" | "holdout") => {
      const s = sessions.find((r) => r.campaignId === campaignId && r.group === g);
      const o = orders.find((r) => r.campaignId === campaignId && r.group === g);
      return { sessions: s?.n ?? 0, orders: o?.n ?? 0, revenue: o?.revenue ?? 0 };
    };
    const treatment = arm("treatment"), holdout = arm("holdout");
    return { campaignId, treatment, holdout, ...compareArms({ n: treatment.sessions, x: treatment.orders }, { n: holdout.sessions, x: holdout.orders }) };
  });
}

/**
 * Email signup forms: how many sign-up requests each received and how many were confirmed from the inbox, counted on the
 * server (so they include shoppers who declined analytics). Impressions come from consenting browsers only, so the
 * request rate is a lower-bound-style estimate and is labelled as such; the confirmation rate uses server counts on both sides.
 */
async function formResults(d: Deps, storeId: string, from: string, to: string, impressions: Map<string, number>) {
  const ce = schema.consentEvents;
  const campaignId = sql<string>`substr(${ce.source}, 6)`;
  const rows = await d.db.select({ campaignId, event: ce.event, n: sql<number>`count(*)`, lastDay: sql<string>`max(substr(${ce.createdAt}, 1, 10))` }).from(ce)
    .where(and(eq(ce.storeId, storeId), inArray(ce.event, ["requested", "confirmed", "delivery_failed"]), sql`${ce.source} like 'form:%'`, gte(ce.createdAt, `${from}T00:00:00.000Z`), lte(ce.createdAt, `${to}T23:59:59.999Z`)))
    .groupBy(campaignId, ce.event);
  const ids = [...new Set(rows.map((r) => r.campaignId))];
  const forms = ids.map((id) => {
    const count = (event: string) => Number(rows.find((r) => r.campaignId === id && r.event === event)?.n ?? 0);
    const requested = count("requested"), confirmed = count("confirmed");
    const imp = impressions.get(id) ?? 0;
    return { campaignId: id, impressions: imp, requested, confirmed, deliveryFailed: count("delivery_failed"), requestRate: imp > 0 ? requested / imp : null, confirmRate: requested > 0 ? confirmed / requested : null };
  }).sort((x, y) => y.requested - x.requested || x.campaignId.localeCompare(y.campaignId));
  // Server-side signup events are not in analytics_aggregates, so the caller needs their latest day for freshness.
  const latestDay = rows.map((r) => r.lastDay).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return { forms, latestDay };
}

/** Per-campaign activity and last-click attribution for a date range: the one query pair every analytics view is built from. */
async function campaignActivity(d: Deps, storeId: string, from: string, to: string) {
  const perCampaign = await d.db.select({
    campaignId: a.campaignId,
    eligible: sql<number>`coalesce(sum(${a.eligible}),0)`,
    impressions: sql<number>`coalesce(sum(${a.impressions}),0)`,
    clicks: sql<number>`coalesce(sum(${a.clicks}),0)`,
    dismissals: sql<number>`coalesce(sum(${a.dismissals}),0)`,
    addToCarts: sql<number>`coalesce(sum(${a.addToCarts}),0)`,
    lastDay: sql<string>`max(${a.day})`,
  }).from(a).where(and(eq(a.storeId, storeId), gte(a.day, from), lte(a.day, to))).groupBy(a.campaignId);

  const attributed = await d.db.select({
    campaignId: ar.campaignId,
    orders: sql<number>`count(*)`,
    revenue: sql<number>`coalesce(sum(${cv.total}),0)`,
    currency: sql<string>`min(${cv.currency})`,
  }).from(ar).innerJoin(cv, eq(cv.id, ar.conversionId))
    .where(and(eq(ar.storeId, storeId), gte(cv.occurredAt, `${from}T00:00:00.000Z`), lte(cv.occurredAt, `${to}T23:59:59.999Z`)))
    .groupBy(ar.campaignId);

  const byId = new Map(attributed.map((r) => [r.campaignId, r]));
  const campaigns = perCampaign.map((c) => ({
    ...c,
    ctr: c.impressions > 0 ? c.clicks / c.impressions : null,
    attributedOrders: byId.get(c.campaignId)?.orders ?? 0,
    attributedRevenue: byId.get(c.campaignId)?.revenue ?? 0,
  }));
  return { campaigns, attributed };
}

export async function getAnalytics(d: Deps, storeId: string, from: string, to: string) {
  const { campaigns, attributed } = await campaignActivity(d, storeId, from, to);

  const [obs] = await d.db.select({ orders: sql<number>`count(*)`, revenue: sql<number>`coalesce(sum(${cv.total}),0)`, lastDay: sql<string>`max(substr(${cv.occurredAt}, 1, 10))` }).from(cv)
    .where(and(eq(cv.storeId, storeId), gte(cv.occurredAt, `${from}T00:00:00.000Z`), lte(cv.occurredAt, `${to}T23:59:59.999Z`)));

  const experiments = await experimentResults(d, storeId, from, to);
  const sum = (k: "eligible" | "impressions" | "clicks" | "dismissals" | "addToCarts") => campaigns.reduce((n, c) => n + c[k], 0);
  const imp = sum("impressions"), clk = sum("clicks");
  const { forms, latestDay: formDay } = await formResults(d, storeId, from, to, new Map(campaigns.map((c) => [c.campaignId, Number(c.impressions)])));
  return {
    range: { from, to },
    totals: {
      eligible: sum("eligible"), impressions: imp, clicks: clk, dismissals: sum("dismissals"), addToCarts: sum("addToCarts"), ctr: imp > 0 ? clk / imp : null,
      observedOrders: obs?.orders ?? 0, observedRevenue: obs?.revenue ?? 0,
      attributedOrders: attributed.reduce((n, r) => n + r.orders, 0), attributedRevenue: attributed.reduce((n, r) => n + r.revenue, 0),
    },
    campaigns,
    forms,
    experiments,
    freshness: { latestDay: [...campaigns.map((c) => c.lastDay), formDay, obs?.lastDay].filter((x): x is string => !!x).sort().at(-1) ?? null },
    /** Plain-language reminder surfaced in the UI so attributed revenue is never read as lift. */
    notes: ["Attributed revenue counts orders placed within 7 days after a shopper clicked a campaign (last click). It is not incremental revenue: those shoppers may have bought anyway."],
  };
}

/* ---------- per-tool rollups ---------- */

type Raw = {
  eligible: number; impressions: number; clicks: number; dismissals: number; addToCarts: number;
  formSubmitAttempts: number; formSubmitSuccesses: number; formSubmitFailures: number;
  requested: number; confirmed: number; deliveryFailed: number;
  attributedOrders: number; attributedRevenue: number;
};
const emptyRaw = (): Raw => ({ eligible: 0, impressions: 0, clicks: 0, dismissals: 0, addToCarts: 0, formSubmitAttempts: 0, formSubmitSuccesses: 0, formSubmitFailures: 0, requested: 0, confirmed: 0, deliveryFailed: 0, attributedOrders: 0, attributedRevenue: 0 });
const ratio = (n: number, of: number) => (of > 0 ? n / of : null);
/** Counts plus the rates that follow from them. A rate is null (not 0) when nothing was shown, so "no data" is never read as "0%". */
const withRates = (r: Raw) => ({
  ...r,
  ctr: ratio(r.clicks, r.impressions), dismissRate: ratio(r.dismissals, r.impressions), addToCartRate: ratio(r.addToCarts, r.impressions),
  requestRate: ratio(r.requested, r.impressions), confirmRate: ratio(r.confirmed, r.requested),
});
const COUNTER_FIELD: Record<CounterEvent, "formSubmitAttempts" | "formSubmitSuccesses" | "formSubmitFailures"> = {
  form_submit_attempt: "formSubmitAttempts", form_submit_success: "formSubmitSuccesses", form_submit_failure: "formSubmitFailures",
};

/**
 * Every tool's primary metrics for a date range, plus a per-campaign drill-down. All five tools are always present (with
 * zeros), so the dashboard can say "no activity" honestly instead of hiding a tool. Built from the same per-campaign
 * activity as `getAnalytics`, so the two views can never disagree.
 */
export async function getToolAnalytics(d: Deps, storeId: string, from: string, to: string) {
  const { campaigns: activity } = await campaignActivity(d, storeId, from, to);
  const defs = await d.db.select({ id: schema.campaigns.id, name: schema.campaigns.name, tool: schema.campaigns.tool, status: schema.campaigns.status })
    .from(schema.campaigns).where(eq(schema.campaigns.storeId, storeId));

  const mc = schema.metricCounters;
  const counters = await d.db.select({ campaignId: mc.campaignId, metric: mc.metric, n: sql<number>`coalesce(sum(${mc.value}),0)`, lastDay: sql<string>`max(${mc.day})` }).from(mc)
    .where(and(eq(mc.storeId, storeId), gte(mc.day, from), lte(mc.day, to))).groupBy(mc.campaignId, mc.metric);
  const { forms, latestDay: formDay } = await formResults(d, storeId, from, to, new Map(activity.map((c) => [c.campaignId, Number(c.impressions)])));

  const raw = new Map<string, Raw>(defs.map((c) => [c.id, emptyRaw()]));
  for (const c of activity) {
    const r = raw.get(c.campaignId);
    if (!r) continue; // activity for a campaign this store does not have: ingestion validates versions, so this is only a purged store's leftovers
    r.eligible = Number(c.eligible); r.impressions = Number(c.impressions); r.clicks = Number(c.clicks);
    r.dismissals = Number(c.dismissals); r.addToCarts = Number(c.addToCarts);
    r.attributedOrders = Number(c.attributedOrders); r.attributedRevenue = Number(c.attributedRevenue);
  }
  for (const c of counters) {
    const r = raw.get(c.campaignId);
    if (r && isCounterEvent(c.metric)) r[COUNTER_FIELD[c.metric]] = Number(c.n);
  }
  for (const f of forms) {
    const r = raw.get(f.campaignId);
    if (r) { r.requested = f.requested; r.confirmed = f.confirmed; r.deliveryFailed = f.deliveryFailed; }
  }

  const tools = Tool.options.map((tool) => {
    const mine = defs.filter((c) => c.tool === tool);
    const total = emptyRaw();
    const rows = mine.map((c) => {
      const r = raw.get(c.id)!;
      for (const k of Object.keys(total) as (keyof Raw)[]) total[k] += r[k];
      return { campaignId: c.id, name: c.name, status: c.status, ...withRates(r) };
    });
    const hasActivity = (r: Raw) => Object.values(r).some((v) => v > 0);
    return {
      tool,
      campaigns: mine.length,
      live: mine.filter((c) => c.status === "active" || c.status === "scheduled").length,
      metrics: withRates(total),
      // A campaign with no activity is listed only while it is live or paused, so the drill-down is not buried in old drafts and archives.
      byCampaign: rows.filter((r) => hasActivity(r) || r.status === "active" || r.status === "scheduled" || r.status === "paused")
        .sort((x, y) => y.impressions - x.impressions || x.campaignId.localeCompare(y.campaignId)),
    };
  });

  return {
    range: { from, to },
    tools,
    freshness: { latestDay: [...activity.map((c) => c.lastDay), ...counters.map((c) => c.lastDay), formDay].filter((x): x is string => !!x).sort().at(-1) ?? null },
    notes: [
      "Attributed revenue counts orders placed within 7 days after a shopper clicked a campaign (last click). It is not incremental revenue: those shoppers may have bought anyway.",
      "Views, clicks and form submissions come from visitors who consented to analytics. Sign-up requests and confirmations are counted on the server, so they include everyone.",
    ],
  };
}
