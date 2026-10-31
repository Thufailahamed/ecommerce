import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import {
  DOMAIN_EVENTS, parseDomainEventPayload,
  type DomainEvent, type DomainEventPayload, type DomainEventSource, type DomainEventType,
} from "@convertflow/contracts";
import { newId } from "../lib/crypto.js";
import { correlationOf } from "../lib/request-context.js";
import type { Deps } from "../deps.js";

const { domainEvents: de, domainEventDeliveries: dd, stores } = schema;

/**
 * A module's reaction to platform events. Handlers MUST be idempotent: delivery is at least once (a queue retry, a
 * sweep, a manual replay), and only a handler that already succeeded for an event is skipped.
 */
export interface Subscriber<T extends DomainEventType = DomainEventType> {
  /** Stable, unique: "<module>.<what it does>". Renaming it makes old events look undelivered to it. */
  name: string;
  events: readonly T[];
  handle(d: Deps, event: DomainEvent<T>): Promise<void>;
}

/** Keeps the event type and payload type tied together for the handler. */
export const defineSubscriber = <T extends DomainEventType>(s: Subscriber<T>): Subscriber => s as unknown as Subscriber;

export interface PublishInput<T extends DomainEventType> {
  type: T;
  payload: DomainEventPayload<T>;
  /** Unique per workspace for this outcome, e.g. `campaign.published:<versionId>`. */
  idempotencyKey: string;
  storeId?: string | null;
  /** Looked up from the store when omitted. */
  organizationId?: string;
  source: DomainEventSource;
  occurredAt?: string;
  correlationId?: string | null;
}

export interface DomainEventMessage { kind: "domain_event"; eventId: string }
export const isDomainEventMessage = (m: unknown): m is DomainEventMessage =>
  typeof m === "object" && m !== null && (m as { kind?: unknown }).kind === "domain_event";

/** After this many failed dispatches an event stays `failed` until someone retries it. */
export const MAX_DISPATCH_ATTEMPTS = 5;

/**
 * Records the event, then hands it to the queue (or, where there is no queue, delivers it now). Never throws for
 * delivery problems: the outcome the event describes has already happened, and the caller must not fail because a
 * subscriber did. An invalid payload or an unknown workspace is a programming error and does throw.
 */
export async function publishDomainEvent<T extends DomainEventType>(d: Deps, input: PublishInput<T>): Promise<{ id: string; duplicate: boolean }> {
  const parsed = parseDomainEventPayload(input.type, input.payload);
  if (!parsed.ok) throw new Error(`invalid ${input.type} payload: ${parsed.issues.join("; ")}`);
  let organizationId = input.organizationId;
  if (!organizationId && input.storeId) {
    const [s] = await d.db.select({ org: stores.organizationId }).from(stores).where(eq(stores.id, input.storeId)).limit(1);
    organizationId = s?.org;
  }
  if (!organizationId) throw new Error(`${input.type}: no workspace for the event`);

  const now = d.now().toISOString();
  const id = newId("evt");
  const inserted = await d.db.insert(de).values({
    id, organizationId, storeId: input.storeId ?? null, type: input.type, schemaVersion: DOMAIN_EVENTS[input.type].version,
    source: input.source, correlationId: input.correlationId === undefined ? correlationOf(d) : input.correlationId,
    idempotencyKey: input.idempotencyKey.slice(0, 200), privacy: DOMAIN_EVENTS[input.type].privacy, payload: parsed.payload,
    occurredAt: input.occurredAt ?? now, recordedAt: now,
  }).onConflictDoNothing().returning({ id: de.id });
  if (!inserted[0]) {
    const [existing] = await d.db.select({ id: de.id }).from(de).where(and(eq(de.organizationId, organizationId), eq(de.idempotencyKey, input.idempotencyKey.slice(0, 200)))).limit(1);
    return { id: existing?.id ?? "", duplicate: true };
  }
  await handOff(d, id);
  return { id, duplicate: false };
}

async function handOff(d: Deps, eventId: string) {
  try {
    if (d.enqueueDomainEvent) await d.enqueueDomainEvent({ kind: "domain_event", eventId });
    else await dispatchDomainEvent(d, eventId);
  } catch (e) {
    // Stays pending or failed in the table; the daily sweep or a retry delivers it.
    console.error(JSON.stringify({ level: "error", where: "domain_event_handoff", eventId, message: e instanceof Error ? e.message : String(e) }));
  }
}

const toEvent = (r: typeof de.$inferSelect): DomainEvent => ({
  id: r.id, type: r.type as DomainEventType, schemaVersion: r.schemaVersion, organizationId: r.organizationId, storeId: r.storeId,
  occurredAt: r.occurredAt, recordedAt: r.recordedAt, source: r.source, correlationId: r.correlationId,
  idempotencyKey: r.idempotencyKey, privacy: r.privacy, payload: r.payload as DomainEvent["payload"],
});

/**
 * Runs every subscriber for the event that has not already succeeded for it. Throws if any failed, so a queue
 * consumer retries the message; subscribers that succeeded are not run again.
 */
export async function dispatchDomainEvent(d: Deps, eventId: string, subscribers: readonly Subscriber[] = d.subscribers ?? []): Promise<{ ran: string[]; failed: string[] }> {
  const [row] = await d.db.select().from(de).where(eq(de.id, eventId)).limit(1);
  if (!row) return { ran: [], failed: [] }; // purged (retention, erasure) since it was queued: nothing to do
  const event = toEvent(row);
  const wanted = subscribers.filter((s) => (s.events as readonly string[]).includes(event.type));
  const done = new Set((await d.db.select({ s: dd.subscriber }).from(dd).where(and(eq(dd.eventId, eventId), eq(dd.status, "succeeded")))).map((r) => r.s));

  const ran: string[] = [], failed: string[] = [];
  let lastError: string | null = null;
  for (const s of wanted) {
    if (done.has(s.name)) continue;
    let status: "succeeded" | "failed" = "succeeded", error: string | null = null;
    try { await s.handle(d, event); ran.push(s.name); }
    catch (e) {
      status = "failed"; failed.push(s.name);
      // Error text is ours (subscribers never put payload values in errors); still bounded.
      error = (e instanceof Error ? e.message : String(e)).slice(0, 300); lastError = `${s.name}: ${error}`;
    }
    const now = d.now().toISOString();
    await d.db.insert(dd).values({ eventId, subscriber: s.name, status, attempts: 1, lastError: error, updatedAt: now })
      .onConflictDoUpdate({ target: [dd.eventId, dd.subscriber], set: { status, attempts: sql`${dd.attempts} + 1`, lastError: error, updatedAt: now } });
  }
  const now = d.now().toISOString();
  await d.db.update(de).set(failed.length
    ? { status: "failed", attempts: sql`${de.attempts} + 1`, lastError }
    : { status: "delivered", attempts: sql`${de.attempts} + 1`, lastError: null, deliveredAt: now }).where(eq(de.id, eventId));
  if (failed.length) throw new Error(`domain event ${eventId}: ${failed.length} subscriber(s) failed`);
  return { ran, failed };
}

/**
 * Daily: hands back to the queue anything that was never delivered (a lost enqueue leaves it pending) and failed events
 * that still have attempts left. Older than five minutes, so in-flight work is not doubled.
 */
export async function sweepDomainEvents(d: Deps, limit = 500): Promise<number> {
  const cutoff = new Date(d.now().getTime() - 5 * 60_000).toISOString();
  const rows = await d.db.select({ id: de.id }).from(de)
    .where(and(lt(de.recordedAt, cutoff), or(eq(de.status, "pending"), and(eq(de.status, "failed"), lt(de.attempts, MAX_DISPATCH_ATTEMPTS)))))
    .orderBy(de.recordedAt).limit(limit);
  for (const r of rows) await handOff(d, r.id);
  return rows.length;
}

/** A merchant- or operator-initiated retry of one failed event. Store-scoped so it cannot touch another tenant's event. */
export async function retryDomainEvent(d: Deps, storeId: string, eventId: string): Promise<boolean> {
  const [r] = await d.db.select({ id: de.id, status: de.status }).from(de).where(and(eq(de.id, eventId), eq(de.storeId, storeId))).limit(1);
  if (!r || r.status === "delivered") return false;
  await handOff(d, r.id);
  return true;
}

export async function listDomainEvents(d: Deps, storeId: string, opts: { status?: "pending" | "delivered" | "failed"; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await d.db.select({
    id: de.id, type: de.type, schemaVersion: de.schemaVersion, source: de.source, status: de.status, attempts: de.attempts,
    lastError: de.lastError, occurredAt: de.occurredAt, recordedAt: de.recordedAt, deliveredAt: de.deliveredAt, correlationId: de.correlationId,
  }).from(de).where(opts.status ? and(eq(de.storeId, storeId), eq(de.status, opts.status)) : eq(de.storeId, storeId))
    .orderBy(desc(de.recordedAt), desc(de.id)).limit(limit);
  const deliveries = rows.length ? await d.db.select({ eventId: dd.eventId, subscriber: dd.subscriber, status: dd.status, attempts: dd.attempts, lastError: dd.lastError })
    .from(dd).where(inArray(dd.eventId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({ ...r, deliveries: deliveries.filter((x) => x.eventId === r.id).map(({ eventId: _e, ...rest }) => rest) }));
}

/** Erasure: pseudonymous events that point at this contact go with them. */
export async function forgetContactEvents(d: Deps, storeId: string, contactId: string): Promise<void> {
  await d.db.delete(de).where(and(eq(de.storeId, storeId), eq(de.privacy, "pseudonymous"), sql`json_extract(${de.payload}, '$.contactId') = ${contactId}`));
}

/**
 * Retention: delivered events are kept 30 days for troubleshooting, undelivered ones 90 so a failure stays visible.
 * Pseudonymous events never outlive 30 days, matching the longest a non-subscribed contact is kept.
 */
export async function purgeDomainEvents(d: Deps): Promise<void> {
  const day = 86_400_000, now = d.now().getTime(), d30 = new Date(now - 30 * day).toISOString();
  await d.db.delete(de).where(and(or(eq(de.status, "delivered"), eq(de.privacy, "pseudonymous")), lt(de.recordedAt, d30)));
  await d.db.delete(de).where(lt(de.recordedAt, new Date(now - 90 * day).toISOString()));
}
