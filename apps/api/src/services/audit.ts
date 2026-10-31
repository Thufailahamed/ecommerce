import { and, desc, eq, lt, or } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { newId } from "../lib/crypto.js";
import { correlationOf } from "../lib/request-context.js";
import type { Deps } from "../deps.js";

const { auditLogs, stores } = schema;

export type AuditSummary = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  action: string;
  /** A user id, or null with `actorType` platform/system. */
  actorId: string | null;
  actorType?: "user" | "platform" | "system";
  storeId?: string | null;
  /** Looked up from the store when omitted, so every store-level row is also visible at workspace level. */
  organizationId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  summary?: AuditSummary;
  /** Defaults to the current request's id. */
  correlationId?: string | null;
}

/** Keys that could carry personal data or secrets are dropped, and values are kept short. Audit rows outlive most data. */
const SENSITIVE_KEY = /email|phone|name|address|token|secret|password|key|credential/i;
export function sanitizeSummary(s: AuditSummary | undefined): AuditSummary | null {
  if (!s) return null;
  const out: AuditSummary = {};
  for (const [k, v] of Object.entries(s).slice(0, 12)) {
    if (SENSITIVE_KEY.test(k)) continue;
    out[k.slice(0, 40)] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return Object.keys(out).length ? out : null;
}

export async function recordAudit(d: Deps, e: AuditEntry): Promise<void> {
  let organizationId = e.organizationId ?? null;
  if (!organizationId && e.storeId) {
    const [s] = await d.db.select({ org: stores.organizationId }).from(stores).where(eq(stores.id, e.storeId)).limit(1);
    organizationId = s?.org ?? null;
  }
  await d.db.insert(auditLogs).values({
    id: newId("aud"), storeId: e.storeId ?? null, organizationId, actorId: e.actorId,
    actorType: e.actorType ?? (e.actorId ? "user" : "system"), action: e.action,
    targetType: e.targetType ?? null, targetId: e.targetId ?? null,
    correlationId: e.correlationId === undefined ? correlationOf(d) : e.correlationId,
    summary: sanitizeSummary(e.summary), createdAt: d.now().toISOString(),
  });
}

export interface AuditPage {
  data: { id: string; storeId: string | null; actorId: string | null; actorType: string; action: string; targetType: string | null; targetId: string | null; correlationId: string | null; summary: AuditSummary | null; createdAt: string }[];
  nextCursor: string | null;
}

/** Newest first. The cursor is "<createdAt>|<id>" of the last row returned. */
export async function listAudit(d: Deps, scope: { storeId: string } | { organizationId: string }, opts: { limit?: number; cursor?: string } = {}): Promise<AuditPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const where = "storeId" in scope ? eq(auditLogs.storeId, scope.storeId) : eq(auditLogs.organizationId, scope.organizationId);
  const [at, id] = (opts.cursor ?? "").split("|");
  const after = at && id ? or(lt(auditLogs.createdAt, at), and(eq(auditLogs.createdAt, at), lt(auditLogs.id, id))) : undefined;
  const rows = await d.db.select({
    id: auditLogs.id, storeId: auditLogs.storeId, actorId: auditLogs.actorId, actorType: auditLogs.actorType, action: auditLogs.action,
    targetType: auditLogs.targetType, targetId: auditLogs.targetId, correlationId: auditLogs.correlationId, summary: auditLogs.summary, createdAt: auditLogs.createdAt,
  }).from(auditLogs).where(after ? and(where, after) : where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { data: page, nextCursor: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null };
}
