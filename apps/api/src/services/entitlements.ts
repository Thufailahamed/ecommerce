import { and, eq, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import {
  CAPABILITIES, USAGE_METRICS, capabilityGranted, monthlyLimit,
  type Capability, type Plan, type UsageMetric,
} from "@convertflow/contracts";
import { effectivePlan } from "../plans.js";
import { HttpError, type Deps } from "../deps.js";

const { subscriptions, usageRecords: u, organizationFeatures: of } = schema;

/**
 * The one place that answers "may this workspace do X" and "how much of Y has it used". Plans live in
 * `@convertflow/contracts` (PLANS); the subscription row says which one applies and whether it is paid up.
 */

export async function getPlan(d: Deps, organizationId: string): Promise<Plan> {
  const [s] = await d.db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  return effectivePlan(s?.plan ?? "free", s?.status ?? "active");
}

export async function featureFlags(d: Deps, organizationId: string): Promise<Set<string>> {
  return new Set((await d.db.select({ f: of.feature }).from(of).where(eq(of.organizationId, organizationId))).map((r) => r.f));
}

export interface Entitlements {
  plan: Plan;
  has(c: Capability): boolean;
  /** Every capability with whether this workspace holds it, for the dashboard. */
  list(): { capability: Capability; availability: string; granted: boolean }[];
}

export async function entitlementsFor(d: Deps, organizationId: string): Promise<Entitlements> {
  const [plan, flags] = await Promise.all([getPlan(d, organizationId), featureFlags(d, organizationId)]);
  const has = (c: Capability) => capabilityGranted(c, plan, flags);
  return {
    plan, has,
    list: () => (Object.keys(CAPABILITIES) as Capability[]).map((capability) => ({ capability, availability: CAPABILITIES[capability].availability, granted: has(capability) })),
  };
}

/** 402 when the plan does not include it; 403 when it is a preview this workspace is not in, or not available at all. */
export async function requireCapability(d: Deps, organizationId: string, c: Capability, message?: string): Promise<void> {
  const e = await entitlementsFor(d, organizationId);
  if (e.has(c)) return;
  const def = CAPABILITIES[c];
  if (def.availability !== "ga") throw new HttpError(403, "feature_unavailable", `${def.description} is not available for this workspace`);
  throw new HttpError(402, "plan_limit", message ?? `${def.description} is not included in your plan`);
}

/** Staff action: switch a preview capability on for one workspace. Planned capabilities are refused. */
export async function enableFeature(d: Deps, organizationId: string, c: Capability, enabledBy: string | null): Promise<void> {
  if (CAPABILITIES[c].availability !== "preview") throw new Error(`${c} is not a preview capability`);
  await d.db.insert(of).values({ organizationId, feature: c, enabledBy, createdAt: d.now().toISOString() }).onConflictDoNothing();
}

/* ---------- usage ---------- */

export const currentPeriod = (d: Deps) => d.now().toISOString().slice(0, 7);

export async function getUsage(d: Deps, organizationId: string, metric: UsageMetric, period = currentPeriod(d)): Promise<number> {
  const [r] = await d.db.select({ count: u.count }).from(u).where(and(eq(u.organizationId, organizationId), eq(u.metric, metric), eq(u.period, period))).limit(1);
  return r?.count ?? 0;
}

export async function usageSummary(d: Deps, organizationId: string, plan?: Plan) {
  const p = plan ?? await getPlan(d, organizationId);
  const period = currentPeriod(d);
  const rows = await d.db.select().from(u).where(and(eq(u.organizationId, organizationId), eq(u.period, period)));
  return Object.fromEntries(USAGE_METRICS.map((m) => [m, { used: rows.find((r) => r.metric === m)?.count ?? 0, limit: monthlyLimit(p, m) }])) as Record<UsageMetric, { used: number; limit: number }>;
}

/** Adds `n` and returns the count before and after, so callers can act on a threshold being crossed. */
export async function recordUsage(d: Deps, organizationId: string, metric: UsageMetric, n = 1): Promise<{ before: number; after: number }> {
  const period = currentPeriod(d);
  const [row] = await d.db.insert(u).values({ organizationId, metric, period, count: n })
    .onConflictDoUpdate({ target: [u.organizationId, u.metric, u.period], set: { count: sql`${u.count} + ${n}` } })
    .returning({ count: u.count });
  const after = row?.count ?? n;
  return { before: after - n, after };
}

export interface Quota { used: number; limit: number; remaining: number }

export async function quota(d: Deps, organizationId: string, metric: UsageMetric, plan?: Plan): Promise<Quota> {
  const p = plan ?? await getPlan(d, organizationId);
  const used = await getUsage(d, organizationId, metric);
  const limit = monthlyLimit(p, metric);
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/** Throws 402 with `message` when the month's allowance is used up. Does not record anything. */
export async function requireQuota(d: Deps, organizationId: string, metric: UsageMetric, message: (q: Quota) => string): Promise<Quota> {
  const q = await quota(d, organizationId, metric);
  if (q.remaining <= 0) throw new HttpError(402, "plan_limit", message(q));
  return q;
}
