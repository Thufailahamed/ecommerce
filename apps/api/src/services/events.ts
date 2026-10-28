import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { isCounterEvent, type TrackedEvent } from "@convertflow/contracts";
import { newId } from "../lib/crypto.js";
import type { Deps } from "../deps.js";
import { publishConfig } from "./campaigns.js";
import { getPlan } from "./stores.js";

const ATTRIBUTION_WINDOW_MS = 7 * 86_400_000;
const COLUMN = {
  campaign_eligible: "eligible", campaign_impression: "impressions", campaign_click: "clicks",
  campaign_dismiss: "dismissals", notification_subscribed: "subscriptions",
  // Feed: an item shown in an opened panel counts as an impression, a click on its button as a click.
  feed_open: "impressions", feed_item_click: "clicks",
  // Upsell: a block shown with products is an impression, a product click a click, and adding one to the cart is its own count.
  recommendation_impression: "impressions", recommendation_click: "clicks", recommendation_add_to_cart: "addToCarts",
} as const;

export interface EventMessage { storeId: string; events: TrackedEvent[] }

/**
 * Idempotent: safe under queue retries and duplicate beacons. Raw events are not stored; each is reduced to a
 * dedup row (short retention) and a daily aggregate increment.
 *
 * D1 is single-threaded, so the number of queries per message matters more than their size. A 50-event batch costs
 * a handful of statements: ids are claimed with multi-row inserts, versions are validated in one query, and
 * increments are grouped per campaign-day and applied once.
 */
export async function processEvents(d: Deps, msg: EventMessage) {
  const { storeId } = msg;
  const nowIso = d.now().toISOString();

  // 1) Claim event ids. Multi-row insert, 3 bound params per row, chunked under D1's 100-parameter limit.
  const dd = schema.eventDedup;
  const fresh = new Set<string>();
  const ids = [...new Set(msg.events.map((e) => e.eventId))];
  for (let i = 0; i < ids.length; i += 30) {
    const rows = await d.db.insert(dd).values(ids.slice(i, i + 30).map((eventId) => ({ storeId, eventId, seenAt: nowIso }))).onConflictDoNothing().returning({ id: dd.eventId });
    for (const r of rows) fresh.add(r.id);
  }

  // 2) Validate every referenced version in one query (a forged campaign/version id must never create aggregates).
  const wanted = [...new Set(msg.events.filter((e) => fresh.has(e.eventId) && e.versionId).map((e) => e.versionId!))];
  const owner = new Map<string, string>(); // versionId -> campaignId, for this store only
  for (let i = 0; i < wanted.length; i += 80) {
    const cv = schema.campaignVersions;
    for (const r of await d.db.select({ id: cv.id, campaignId: cv.campaignId }).from(cv).where(and(eq(cv.storeId, storeId), inArray(cv.id, wanted.slice(i, i + 80))))) owner.set(r.id, r.campaignId);
  }
  const lazy = new Map<string, boolean>(); // purchases reference versions inside the order payload
  const versionOk = async (campaignId?: string, versionId?: string) => {
    if (!campaignId || !versionId) return false;
    if (owner.has(versionId)) return owner.get(versionId) === campaignId;
    const k = `${campaignId}:${versionId}`;
    if (!lazy.has(k)) {
      const [r] = await d.db.select({ id: schema.campaignVersions.id }).from(schema.campaignVersions)
        .where(and(eq(schema.campaignVersions.id, versionId), eq(schema.campaignVersions.campaignId, campaignId), eq(schema.campaignVersions.storeId, storeId))).limit(1);
      lazy.set(k, !!r);
    }
    return lazy.get(k) === true;
  };

  // 3) Walk events in order, grouping increments.
  type Col = "eligible" | "impressions" | "clicks" | "dismissals" | "subscriptions" | "addToCarts";
  const agg = new Map<string, { campaignId: string; versionId: string; day: string; inc: Record<Col, number> }>();
  const exp = new Map<string, { campaignId: string; versionId: string; group: "treatment" | "holdout"; day: string; n: number }>();
  const counters = new Map<string, { campaignId: string; versionId: string; day: string; metric: string; n: number }>();
  const claimed = new Set<string>();
  let accepted = 0, duplicates = 0, rejected = 0, pageviews = 0;
  for (const e of msg.events) {
    if (!fresh.has(e.eventId) || claimed.has(e.eventId)) { duplicates++; continue; } // already seen, or repeated within this batch
    claimed.add(e.eventId);

    if (e.type === "purchase_observed") {
      if (await recordPurchase(d, storeId, e, versionOk)) accepted++; else rejected++;
      continue;
    }
    if (e.type === "experiment_assigned") {
      if (!e.group || !(await versionOk(e.campaignId, e.versionId))) { rejected++; continue; }
      const day = e.occurredAt.slice(0, 10), k = `${e.campaignId}|${e.versionId}|${e.group}|${day}`;
      const cur = exp.get(k) ?? { campaignId: e.campaignId!, versionId: e.versionId!, group: e.group, day, n: 0 };
      cur.n++; exp.set(k, cur); accepted++;
      continue;
    }
    if (isCounterEvent(e.type)) { // tool-specific counts with no aggregate column (form submissions)
      if (!(await versionOk(e.campaignId, e.versionId))) { rejected++; continue; }
      const day = e.occurredAt.slice(0, 10), k = `${e.campaignId}|${e.versionId}|${day}|${e.type}`;
      const cur = counters.get(k) ?? { campaignId: e.campaignId!, versionId: e.versionId!, day, metric: e.type, n: 0 };
      cur.n++; counters.set(k, cur); accepted++;
      continue;
    }
    const col = COLUMN[e.type as keyof typeof COLUMN] as Col | undefined;
    if (!col || !(await versionOk(e.campaignId, e.versionId))) { rejected++; continue; }
    const day = e.occurredAt.slice(0, 10), k = `${e.campaignId}|${e.versionId}|${day}`;
    const cur = agg.get(k) ?? { campaignId: e.campaignId!, versionId: e.versionId!, day, inc: { eligible: 0, impressions: 0, clicks: 0, dismissals: 0, subscriptions: 0, addToCarts: 0 } };
    cur.inc[col]++; agg.set(k, cur); accepted++;
    if (e.type === "campaign_eligible") pageviews++;
  }

  // 4) Apply grouped increments: one upsert per campaign-day (and per experiment arm-day).
  const a = schema.analyticsAggregates;
  for (const g of agg.values()) {
    await d.db.insert(a).values({ storeId, campaignId: g.campaignId, versionId: g.versionId, day: g.day, ...g.inc })
      .onConflictDoUpdate({
        target: [a.storeId, a.campaignId, a.versionId, a.day],
        set: { eligible: sql`${a.eligible} + ${g.inc.eligible}`, impressions: sql`${a.impressions} + ${g.inc.impressions}`, clicks: sql`${a.clicks} + ${g.inc.clicks}`, dismissals: sql`${a.dismissals} + ${g.inc.dismissals}`, subscriptions: sql`${a.subscriptions} + ${g.inc.subscriptions}`, addToCarts: sql`${a.addToCarts} + ${g.inc.addToCarts}` },
      });
  }
  const xs = schema.experimentStats;
  for (const g of exp.values()) {
    await d.db.insert(xs).values({ storeId, campaignId: g.campaignId, versionId: g.versionId, group: g.group, day: g.day, sessions: g.n })
      .onConflictDoUpdate({ target: [xs.storeId, xs.campaignId, xs.versionId, xs.group, xs.day], set: { sessions: sql`${xs.sessions} + ${g.n}` } });
  }
  // Multi-row upserts, 6 bound params per row, chunked under D1's 100-parameter limit.
  const mc = schema.metricCounters, rows = [...counters.values()];
  for (let i = 0; i < rows.length; i += 15) {
    await d.db.insert(mc).values(rows.slice(i, i + 15).map((g) => ({ storeId, campaignId: g.campaignId, versionId: g.versionId, day: g.day, metric: g.metric, value: g.n })))
      .onConflictDoUpdate({ target: [mc.storeId, mc.campaignId, mc.versionId, mc.day, mc.metric], set: { value: sql`${mc.value} + excluded.value` } });
  }
  if (pageviews > 0) await meterPageviews(d, storeId, pageviews);
  return { accepted, duplicates, rejected };
}

/** Counts consented, de-duplicated pageviews against the plan; republishes configs the moment the limit is crossed. */
async function meterPageviews(d: Deps, storeId: string, n: number) {
  const [store] = await d.db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) return;
  const period = d.now().toISOString().slice(0, 7);
  const u = schema.usageRecords;
  const [before] = await d.db.select().from(u).where(and(eq(u.organizationId, store.organizationId), eq(u.metric, "pageviews"), eq(u.period, period))).limit(1);
  await d.db.insert(u).values({ organizationId: store.organizationId, metric: "pageviews", period, count: n })
    .onConflictDoUpdate({ target: [u.organizationId, u.metric, u.period], set: { count: sql`${u.count} + ${n}` } });
  const limit = (await getPlan(d, store.organizationId)).trackedPageviewsPerMonth;
  if ((before?.count ?? 0) < limit && (before?.count ?? 0) + n >= limit) {
    const stores = await d.db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.organizationId, store.organizationId));
    for (const s of stores) await publishConfig(d, s.id);
  }
}

async function recordPurchase(d: Deps, storeId: string, e: TrackedEvent, versionOk: (c?: string, v?: string) => Promise<boolean>) {
  if (!e.order) return false;
  const conv = await d.db.insert(schema.conversions)
    .values({ id: newId("cnv"), storeId, orderId: e.order.orderId, total: e.order.total, currency: e.order.currency.toUpperCase(), sessionId: e.sessionId, occurredAt: e.occurredAt })
    .onConflictDoNothing().returning({ id: schema.conversions.id });
  const [row] = conv.length ? conv : await d.db.select({ id: schema.conversions.id }).from(schema.conversions).where(and(eq(schema.conversions.storeId, storeId), eq(schema.conversions.orderId, e.order.orderId))).limit(1);
  if (!row) return false;

  const ex = e.order.experiment;
  if (ex && (await versionOk(ex.campaignId, ex.versionId))) {
    // First report wins: a later event cannot move an order between arms.
    await d.db.update(schema.conversions).set({ expCampaignId: ex.campaignId, expGroup: ex.group })
      .where(and(eq(schema.conversions.id, row.id), isNull(schema.conversions.expGroup)));
  }

  const lc = e.order.lastClick;
  if (lc && (await versionOk(lc.campaignId, lc.versionId))) {
    const age = Date.parse(e.occurredAt) - Date.parse(lc.clickedAt);
    if (age >= 0 && age <= ATTRIBUTION_WINDOW_MS) {
      await d.db.insert(schema.attributionRecords)
        .values({ id: newId("att"), storeId, conversionId: row.id, campaignId: lc.campaignId, versionId: lc.versionId, rule: "last_click_7d", createdAt: d.now().toISOString() })
        .onConflictDoNothing();
    }
  }
  return true;
}

/** Retention: dedup ledger is only needed long enough to absorb retries and duplicate beacons. */
export async function purgeDedup(d: Deps, olderThanDays = 3) {
  const cutoff = new Date(d.now().getTime() - olderThanDays * 86_400_000).toISOString();
  await d.db.delete(schema.eventDedup).where(lt(schema.eventDedup.seenAt, cutoff));
}
