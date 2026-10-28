import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { createAdapter, ProviderError, type ProviderAdapter, type ProviderChannel, type ProviderContact, type ProviderKey, type ProviderList } from "@convertflow/integrations";
import { decrypt, encrypt } from "../lib/aes.js";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { isSuppressed } from "./suppression.js";

const { providerConnections: pc, providerSyncJobs: pj, contacts, consentEvents, auditLogs } = schema;

export type SyncStatus = (typeof schema.SYNC_STATUSES)[number];
export const PROVIDERS: readonly ProviderKey[] = schema.PROVIDERS;
/** What each provider can take today. The adapters themselves say the same; this is readable without building one (which needs a key). */
const PROVIDER_CHANNELS: Record<ProviderKey, readonly ProviderChannel[]> = { klaviyo: ["email"], mailchimp: ["email"] };
export const providerLabel = (p: ProviderKey): string => (p === "klaviyo" ? "Klaviyo" : "Mailchimp");

/** A transient failure is retried this many times, with growing waits, before the job is marked failed for the merchant to see. */
export const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 6 * 3_600_000;
/** 30 s, 1 min, 2 min, 4 min ... capped at 6 h. */
export const backoffMs = (attempts: number): number => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_MAX_MS);

export interface SyncMessage { kind: "provider_sync"; jobId: string }
export const isSyncMessage = (m: unknown): m is SyncMessage => !!m && typeof m === "object" && (m as SyncMessage).kind === "provider_sync" && typeof (m as SyncMessage).jobId === "string";

const log = (where: string, e: unknown): void => { console.error(JSON.stringify({ level: "error", where, message: e instanceof Error ? e.message : String(e) })); };

function credentialKey(d: Deps): string {
  const k = d.secrets?.credentialKey;
  if (!k) throw new HttpError(503, "not_configured", "Credential encryption key is not configured");
  return k;
}
const seal = (d: Deps, apiKey: string) => encrypt(JSON.stringify({ apiKey }), credentialKey(d));
async function openKey(d: Deps, row: { encryptedCredentials: string }): Promise<string> {
  const j = JSON.parse(await decrypt(row.encryptedCredentials, credentialKey(d))) as { apiKey?: unknown };
  if (typeof j.apiKey !== "string") throw new Error("stored provider credentials are unreadable");
  return j.apiKey;
}

function adapterFor(d: Deps, provider: ProviderKey, apiKey: string): ProviderAdapter {
  const injected = d.providers?.[provider];
  if (injected) return injected;
  const baseUrl = d.secrets?.providerBaseUrls?.[provider];
  return createAdapter(provider, { apiKey }, { ...(d.fetchFn ? { fetchFn: d.fetchFn } : {}), ...(baseUrl ? { baseUrl } : {}) });
}

/** A provider failure turned into what the merchant should be told. The provider's own words are never passed on. */
function toHttp(e: unknown): HttpError {
  if (!(e instanceof ProviderError)) return new HttpError(502, "provider_unavailable", "Could not reach the provider. Try again in a moment.");
  if (e.kind === "auth") return new HttpError(422, "provider_auth_failed", "The provider rejected this key. Check that it is correct and has permission to read lists and manage subscriptions.");
  if (e.kind === "rate_limited") return new HttpError(429, "provider_rate_limited", "The provider is limiting requests right now. Try again in a minute.");
  if (e.kind === "transient") return new HttpError(502, "provider_unavailable", "Could not reach the provider. Try again in a moment.");
  return new HttpError(422, "provider_rejected", "The provider refused the request.");
}

async function connectionOf(d: Deps, storeId: string, provider: ProviderKey) {
  const [row] = await d.db.select().from(pc).where(and(eq(pc.storeId, storeId), eq(pc.provider, provider))).limit(1);
  return row;
}

/* ---------- connections (merchant-facing) ---------- */

export interface ProviderView {
  provider: ProviderKey;
  label: string;
  connected: boolean;
  status: "connected" | "error" | null;
  listId: string | null;
  listName: string | null;
  /** True only when a check has passed against the provider's real API. Until then the dashboard says it is not verified against the live provider. */
  verified: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  counts: Record<SyncStatus, number>;
}

const emptyCounts = (): Record<SyncStatus, number> => ({ pending: 0, synced: 0, failed: 0, skipped_no_consent: 0, skipped_suppressed: 0 });

export async function listProviders(d: Deps, storeId: string): Promise<ProviderView[]> {
  const rows = await d.db.select().from(pc).where(eq(pc.storeId, storeId));
  const counts = await d.db.select({ provider: pj.provider, status: pj.status, n: sql<number>`count(*)` }).from(pj).where(eq(pj.storeId, storeId)).groupBy(pj.provider, pj.status);
  return PROVIDERS.map((provider) => {
    const r = rows.find((x) => x.provider === provider);
    const c = emptyCounts();
    for (const x of counts) if (x.provider === provider) c[x.status] = Number(x.n);
    return {
      provider, label: providerLabel(provider), connected: !!r, status: r?.status ?? null, listId: r?.listId ?? null, listName: r?.listName ?? null,
      verified: !!r?.verifiedAt, verifiedAt: r?.verifiedAt ?? null, lastCheckedAt: r?.lastCheckedAt ?? null, lastError: r?.lastError ?? null, counts: c,
    };
  });
}

/** Checks the key against the provider and stores it (encrypted). The key is never returned. Returns the lists it can see so the merchant can pick one. */
export async function connectProvider(d: Deps, storeId: string, provider: ProviderKey, rawKey: string): Promise<ProviderList[]> {
  const apiKey = rawKey.trim();
  if (apiKey.length < 8 || apiKey.length > 200 || /\s/.test(apiKey)) throw new HttpError(422, "validation_failed", "That does not look like an API key");
  const encrypted = await seal(d, apiKey); // fail on a missing encryption key before talking to the provider
  const adapter = adapterFor(d, provider, apiKey);
  let lists: ProviderList[];
  try { lists = await adapter.checkConnection(); } catch (e) { throw toHttp(e); }
  const now = d.now().toISOString();
  const existing = await connectionOf(d, storeId, provider);
  // A key change keeps the chosen list only when the new key can still see it.
  const keep = existing?.listId ? lists.find((l) => l.id === existing.listId) : undefined;
  const row = { encryptedCredentials: encrypted, listId: keep?.id ?? null, listName: keep?.name ?? null, status: "connected" as const, verifiedAt: adapter.live ? now : null, lastCheckedAt: now, lastError: null, updatedAt: now };
  await d.db.insert(pc).values({ id: newId("pcn"), storeId, provider, createdAt: now, ...row }).onConflictDoUpdate({ target: [pc.storeId, pc.provider], set: row });
  return lists;
}

async function liveAdapter(d: Deps, storeId: string, provider: ProviderKey) {
  const row = await connectionOf(d, storeId, provider);
  if (!row) throw new HttpError(404, "not_found", `${providerLabel(provider)} is not connected`);
  return { row, adapter: adapterFor(d, provider, await openKey(d, row)) };
}

/** Re-runs the connection check with the stored key and records the outcome. */
export async function checkProvider(d: Deps, storeId: string, provider: ProviderKey): Promise<ProviderList[]> {
  const { row, adapter } = await liveAdapter(d, storeId, provider);
  const now = d.now().toISOString();
  try {
    const lists = await adapter.checkConnection();
    await d.db.update(pc).set({ status: "connected", lastCheckedAt: now, lastError: null, updatedAt: now, ...(adapter.live ? { verifiedAt: now } : {}) }).where(eq(pc.id, row.id));
    return lists;
  } catch (e) {
    const http = toHttp(e);
    await d.db.update(pc).set({ status: "error", lastCheckedAt: now, lastError: http.message, updatedAt: now }).where(eq(pc.id, row.id));
    throw http;
  }
}

/**
 * Chooses the list new subscribers are added to. `syncExisting` also queues everyone already subscribed; that is the
 * merchant's decision, never automatic. Returns how many contacts were queued.
 */
export async function chooseList(d: Deps, storeId: string, provider: ProviderKey, listId: string, syncExisting: boolean): Promise<number> {
  const lists = await checkProvider(d, storeId, provider);
  const list = lists.find((l) => l.id === listId);
  if (!list) throw new HttpError(422, "list_not_found", "That list is not available to this key");
  await d.db.update(pc).set({ listId: list.id, listName: list.name, updatedAt: d.now().toISOString() }).where(and(eq(pc.storeId, storeId), eq(pc.provider, provider)));
  if (!syncExisting) return 0;
  return backfill(d, storeId, provider);
}

const BACKFILL_MAX = 5_000;
async function backfill(d: Deps, storeId: string, provider: ProviderKey): Promise<number> {
  const rows = await d.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.storeId, storeId), eq(contacts.emailStatus, "subscribed"))).orderBy(contacts.createdAt, sql`rowid`).limit(BACKFILL_MAX);
  let n = 0;
  for (const r of rows) { await upsertJob(d, storeId, r.id, provider, "email", "subscribe"); n++; }
  await sweepSyncJobs(d, { storeId, limit: 200 }); // the rest drain on the daily sweep
  return n;
}

export async function disconnectProvider(d: Deps, storeId: string, provider: ProviderKey): Promise<boolean> {
  await d.db.delete(pj).where(and(eq(pj.storeId, storeId), eq(pj.provider, provider)));
  const r = await d.db.delete(pc).where(and(eq(pc.storeId, storeId), eq(pc.provider, provider))).returning({ id: pc.id });
  return r.length > 0;
}

/** Puts failed jobs back in the queue (after the merchant fixed the key, say). Returns how many. */
export async function retryFailed(d: Deps, storeId: string, provider: ProviderKey): Promise<number> {
  const now = d.now().toISOString();
  const rows = await d.db.update(pj).set({ status: "pending", attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: now })
    .where(and(eq(pj.storeId, storeId), eq(pj.provider, provider), eq(pj.status, "failed"))).returning({ id: pj.id });
  await sweepSyncJobs(d, { storeId, limit: 200 });
  return rows.length;
}

/* ---------- what the subscribers page shows per contact ---------- */

export interface ContactSync { provider: ProviderKey; status: SyncStatus; action: "subscribe" | "unsubscribe"; error: string | null }

export async function syncStatusFor(d: Deps, storeId: string, contactIds: string[]): Promise<Map<string, ContactSync[]>> {
  const out = new Map<string, ContactSync[]>();
  for (let i = 0; i < contactIds.length; i += 50) {
    const rows = await d.db.select({ contactId: pj.contactId, provider: pj.provider, status: pj.status, action: pj.action, error: pj.lastError })
      .from(pj).where(and(eq(pj.storeId, storeId), inArray(pj.contactId, contactIds.slice(i, i + 50)))).orderBy(pj.provider);
    for (const r of rows) out.set(r.contactId, [...(out.get(r.contactId) ?? []), { provider: r.provider, status: r.status, action: r.action, error: r.error }]);
  }
  return out;
}

/* ---------- jobs ---------- */

async function upsertJob(d: Deps, storeId: string, contactId: string, provider: ProviderKey, channel: ProviderChannel, action: "subscribe" | "unsubscribe"): Promise<string> {
  const now = d.now().toISOString();
  const reset = { action, status: "pending" as const, attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: now };
  const [r] = await d.db.insert(pj).values({ id: newId("sjb"), storeId, contactId, provider, channel, createdAt: now, ...reset })
    .onConflictDoUpdate({ target: [pj.contactId, pj.provider, pj.channel], set: reset }).returning({ id: pj.id });
  return r!.id;
}

/** Hands a job to the queue (production) or runs it right here (tests and local runs without a queue). Never throws: the daily sweep picks up anything missed. */
async function enqueue(d: Deps, jobId: string): Promise<void> {
  try {
    if (d.enqueueEvents) await d.enqueueEvents({ kind: "provider_sync", jobId } satisfies SyncMessage);
    else await runSyncJob(d, jobId);
  } catch (e) { log("provider_sync_enqueue", e); }
}

/**
 * A shopper's subscription was just confirmed: queue a copy to every connected provider that has a list. Only a
 * confirmed subscription ever creates a subscribe job, and the job re-checks consent when it runs.
 */
export async function onConfirmed(d: Deps, storeId: string, contactId: string, channel: ProviderChannel): Promise<void> {
  try {
    const conns = await d.db.select({ provider: pc.provider }).from(pc).where(and(eq(pc.storeId, storeId), isNotNull(pc.listId)));
    for (const c of conns) {
      if (!PROVIDER_CHANNELS[c.provider].includes(channel)) continue;
      await enqueue(d, await upsertJob(d, storeId, contactId, c.provider, channel, "subscribe"));
    }
  } catch (e) { log("provider_sync_confirmed", e); }
}

/**
 * A shopper opted out. A copy that may exist at a provider is queued for removal. A subscribe job that never reached
 * the provider is simply cancelled: nothing was sent, so there is nothing to take back.
 */
export async function onRevoked(d: Deps, storeId: string, contactId: string, channel: ProviderChannel): Promise<void> {
  try {
    const jobs = await d.db.select().from(pj).where(and(eq(pj.storeId, storeId), eq(pj.contactId, contactId), eq(pj.channel, channel)));
    const now = d.now().toISOString();
    for (const j of jobs) {
      if (j.status === "skipped_no_consent" || j.status === "skipped_suppressed") continue;
      if (j.action === "unsubscribe" && (j.status === "synced" || j.status === "pending")) continue; // already removed, or already on its way
      if (j.action === "subscribe" && j.status === "pending" && j.attempts === 0) {
        await d.db.update(pj).set({ status: "skipped_no_consent", nextAttemptAt: null, updatedAt: now }).where(eq(pj.id, j.id));
        continue;
      }
      await enqueue(d, await upsertJob(d, storeId, contactId, j.provider, channel, "unsubscribe"));
    }
  } catch (e) { log("provider_sync_revoked", e); }
}

export interface RunResult { /** Set when the job should be tried again after this long. */ retryAfterMs?: number }

/**
 * Does one job. Safe to run twice (the providers' calls are idempotent) and safe against a race with an opt-out: the
 * result is only recorded while the job still wants what this run did.
 */
export async function runSyncJob(d: Deps, jobId: string): Promise<RunResult> {
  const [job] = await d.db.select().from(pj).where(eq(pj.id, jobId)).limit(1);
  if (!job || job.status !== "pending") return {};
  const nowMs = d.now().getTime();
  if (job.nextAttemptAt && Date.parse(job.nextAttemptAt) > nowMs) return { retryAfterMs: Date.parse(job.nextAttemptAt) - nowMs }; // delivered early
  const done = (set: Partial<typeof pj.$inferInsert>) =>
    d.db.update(pj).set({ updatedAt: d.now().toISOString(), ...set }).where(and(eq(pj.id, job.id), eq(pj.action, job.action), eq(pj.status, "pending")));

  const conn = await connectionOf(d, job.storeId, job.provider);
  if (!conn?.listId) { await done({ status: "failed", attempts: job.attempts + 1, lastError: "No list is chosen for this provider" }); return {}; }
  const [c] = await d.db.select().from(contacts).where(eq(contacts.id, job.contactId)).limit(1);
  const value = c && (job.channel === "email" ? c.email : c.phone);
  if (!c || !value) { await done({ status: "skipped_no_consent" }); return {}; }

  // The consent check happens now, not when the job was made: an opt-out in between must win.
  if (job.action === "subscribe") {
    if ((job.channel === "email" ? c.emailStatus : c.smsStatus) !== "subscribed") { await done({ status: "skipped_no_consent" }); return {}; }
    if (await isSuppressed(d, job.storeId, job.channel, value)) { await done({ status: "skipped_suppressed" }); return {}; }
  }

  const [proof] = await d.db.select({ at: consentEvents.createdAt, source: consentEvents.source }).from(consentEvents)
    .where(and(eq(consentEvents.contactId, c.id), eq(consentEvents.channel, job.channel), eq(consentEvents.event, "confirmed"))).orderBy(desc(consentEvents.createdAt), sql`rowid desc`).limit(1);
  const person: ProviderContact = {
    channel: job.channel, ...(job.channel === "email" ? { email: value } : { phone: value }), ...(c.firstName ? { firstName: c.firstName } : {}),
    consentedAt: proof?.at ?? c.createdAt, source: proof?.source ?? c.source,
  };

  // The attempt is recorded BEFORE the provider is called. An opt-out that lands while the call is in flight must see that
  // the subscribe may already have gone out (attempts > 0), and queue its removal instead of treating the job as never sent.
  const attempts = job.attempts + 1;
  const claimed = await d.db.update(pj).set({ attempts, updatedAt: d.now().toISOString() }).where(and(eq(pj.id, job.id), eq(pj.action, job.action), eq(pj.status, "pending"))).returning({ id: pj.id });
  if (claimed.length === 0) return {}; // changed under us (an opt-out, a disconnect): whoever changed it queued what is needed

  try {
    const adapter = adapterFor(d, job.provider, await openKey(d, conn));
    let ref: string | undefined;
    if (job.action === "subscribe") ref = (await adapter.subscribe(conn.listId, person)).ref; else await adapter.unsubscribe(conn.listId, person);
    const recorded = await d.db.update(pj).set({ status: "synced", nextAttemptAt: null, lastError: null, updatedAt: d.now().toISOString(), ...(ref ? { providerRef: ref } : {}) })
      .where(and(eq(pj.id, job.id), eq(pj.action, job.action), eq(pj.status, "pending"))).returning({ id: pj.id });
    if (recorded.length === 0 && job.action === "subscribe") {
      // The shopper opted out (or was erased) while the subscribe was in flight, so the provider now holds someone who must not be
      // there. Queue a fresh removal that is certain to run after this call, whatever order the earlier opt-out's job ran in.
      const [now] = await d.db.select({ status: job.channel === "email" ? contacts.emailStatus : contacts.smsStatus }).from(contacts).where(eq(contacts.id, job.contactId)).limit(1);
      if (now && now.status !== "subscribed") await enqueue(d, await upsertJob(d, job.storeId, job.contactId, job.provider, job.channel, "unsubscribe"));
    }
    return {};
  } catch (e) {
    if (!(e instanceof ProviderError)) { log("provider_sync_run", e); await done({ status: "failed", attempts, lastError: "Unexpected error while syncing" }); return {}; }
    if (e.kind === "auth") {
      await done({ status: "failed", attempts, lastError: "The provider rejected the key" });
      await d.db.update(pc).set({ status: "error", lastError: "The provider rejected the key. Reconnect it, then retry the failed contacts.", updatedAt: d.now().toISOString() }).where(eq(pc.id, conn.id));
      return {};
    }
    if (e.kind === "rejected") { await done({ status: "failed", attempts, lastError: e.message.slice(0, 200) }); return {}; }
    // rate_limited or transient: wait (at least as long as the provider asked) and try again, up to a limit.
    if (attempts >= MAX_ATTEMPTS) { await done({ status: "failed", attempts, nextAttemptAt: null, lastError: `Gave up after ${attempts} attempts: ${e.message.slice(0, 120)}` }); return {}; }
    const wait = Math.max(backoffMs(attempts), e.retryAfterMs ?? 0);
    await done({ attempts, nextAttemptAt: new Date(nowMs + wait).toISOString(), lastError: e.message.slice(0, 200) });
    return { retryAfterMs: wait };
  }
}

/** The queue consumer's entry point. A job that must wait is put back on the queue with a delay (the queue's own retry limit is smaller than ours). */
export async function processSyncMessage(d: Deps, msg: SyncMessage): Promise<void> {
  const r = await runSyncJob(d, msg.jobId);
  if (r.retryAfterMs !== undefined && d.enqueueEvents) await d.enqueueEvents(msg, { delaySeconds: Math.max(1, Math.ceil(r.retryAfterMs / 1000)) });
}

/** Safety net, run daily and after a backfill: hands every due pending job to the queue, so nothing is stranded if an enqueue was lost. */
export async function sweepSyncJobs(d: Deps, o: { storeId?: string; limit?: number } = {}): Promise<number> {
  const now = d.now().toISOString();
  const due = and(eq(pj.status, "pending"), or(isNull(pj.nextAttemptAt), lte(pj.nextAttemptAt, now)), ...(o.storeId ? [eq(pj.storeId, o.storeId)] : []));
  const rows = await d.db.select({ id: pj.id }).from(pj).where(due).orderBy(pj.createdAt, sql`rowid`).limit(o.limit ?? 1000);
  for (const r of rows) await enqueue(d, r.id);
  return rows.length;
}

/**
 * Erasure: before a contact is deleted, ask each provider that may hold them to unsubscribe them. This takes the person
 * off the list; it does not delete their profile in the provider (which can hold order history the merchant must keep),
 * so the dashboard tells the merchant to remove that themselves if they need to. Returns the providers that could not be reached.
 */
export async function removeFromProviders(d: Deps, storeId: string, contactId: string): Promise<ProviderKey[]> {
  const jobs = await d.db.select().from(pj).where(and(eq(pj.storeId, storeId), eq(pj.contactId, contactId)));
  const [c] = await d.db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  const failed: ProviderKey[] = [];
  for (const j of jobs) {
    const mayExist = j.status !== "skipped_no_consent" && j.status !== "skipped_suppressed" && !(j.action === "unsubscribe" && j.status === "synced") && !(j.action === "subscribe" && j.status === "pending" && j.attempts === 0);
    const value = c && (j.channel === "email" ? c.email : c.phone);
    if (!mayExist || !value) continue;
    const conn = await connectionOf(d, storeId, j.provider);
    if (!conn?.listId) continue; // disconnected since: nothing we can reach
    try {
      const adapter = adapterFor(d, j.provider, await openKey(d, conn));
      await adapter.unsubscribe(conn.listId, { channel: j.channel, ...(j.channel === "email" ? { email: value } : { phone: value }), consentedAt: j.updatedAt, source: "erasure" });
    } catch (e) {
      log("provider_erasure", e);
      failed.push(j.provider);
      await d.db.insert(auditLogs).values({ id: newId("aud"), storeId, action: "contact.provider_cleanup_failed", targetType: "provider", targetId: j.provider, createdAt: d.now().toISOString() });
    }
  }
  return failed;
}
