import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { SHIPPED_TOOLS, type Tool } from "@convertflow/contracts";
import { schema } from "@convertflow/database";
import { FakeProvider } from "@convertflow/integrations";
import { Client, KEY, MailBox, makeEnv, setPlan, signup, validConfig, type Env } from "./helpers.js";
import { MAX_ATTEMPTS, backoffMs, processSyncMessage, runSyncJob, sweepSyncJobs, type SyncMessage } from "../src/services/providers.js";
import { normalizeFirstName, revokeConsent } from "../src/services/contacts.js";

const shipped = SHIPPED_TOOLS as Set<Tool>;
const defaults = [...shipped];
beforeEach(() => shipped.add("email"));
afterEach(() => { shipped.clear(); for (const t of defaults) shipped.add(t); });

const secrets = { credentialKey: KEY, webOrigin: "https://app.example.com", apiOrigin: "https://api.example.com" };
const path = (url: string) => { const u = new URL(url); return u.pathname + u.search; };
const CONSENT = "I agree to receive marketing emails from Shop. I can unsubscribe at any time.";
const form = { collect: { email: true }, consentText: CONSENT, privacyUrl: "https://shop.example.com/privacy" };
const SECRET_KEY = "pk_live_supersecretvalue123";
const MIN = 60_000;

async function shop(over: Record<string, unknown> = {}) {
  const mail = new MailBox();
  const env = await makeEnv(undefined, { email: mail, secrets });
  const fake = new FakeProvider("klaviyo");
  env.deps.providers = { klaviyo: fake, mailchimp: new FakeProvider("mailchimp") };
  const u = await signup(env, "owner@example.com");
  await new Client(env).post("/api/v1/auth/verify-email", { token: mail.token("owner@example.com") });
  await setPlan(env, u.orgId, "growth");
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Shop", domain: "shop.example.com", currency: "USD" });
  const storeId = s.json.data.id as string;
  await u.c.patch(`/api/v1/stores/${storeId}/settings`, { maxDiscountPercent: 30 });
  const created = await u.c.post(`/api/v1/stores/${storeId}/campaigns`, validConfig({ tool: "email", format: "popup", form, ...over }));
  const formId = created.json.data.id as string;
  const pub = await u.c.post(`/api/v1/stores/${storeId}/campaigns/${formId}/publish`, { approve: true, approvedUpdatedAt: created.json.data.updatedAt });
  expect(pub.status, JSON.stringify(pub.json)).toBe(200);
  mail.sent.length = 0;
  return { env, mail, fake, ...u, storeId, formId, siteKey: s.json.data.siteKey as string };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const subscribe = (t: Shop, email: string, extra: Record<string, unknown> = {}) =>
  t.env.app.request("/api/v1/notifications/subscribe", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ siteId: t.siteKey, campaignId: t.formId, email, consent: true, ...extra }) });
async function confirmed(t: Shop, email: string, extra: Record<string, unknown> = {}) {
  await subscribe(t, email, extra);
  const res = await t.env.app.request(path(t.mail.link(email)));
  return res.text();
}
const base = (t: Shop, p = "klaviyo") => `/api/v1/stores/${t.storeId}/providers/${p}`;
const connect = (t: Shop, p = "klaviyo") => t.c.put(base(t, p), { apiKey: SECRET_KEY });
const jobs = (env: Env) => env.deps.db.select().from(schema.providerSyncJobs);
const unsubUrl = (mail: MailBox, to: string) => mail.sent.filter((m) => m.to === to).pop()!.headers!["List-Unsubscribe"]!.replace(/[<>]/g, "");
/** Connect, choose the first list. */
async function ready(t: Shop, syncExisting = false) {
  expect((await connect(t)).status).toBe(200);
  const r = await t.c.put(base(t), { listId: "list_1", syncExisting });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

describe("connecting a provider", () => {
  it("checks the key, stores it encrypted, never returns it, and shows the lists to choose from", async () => {
    const t = await shop();
    const r = await connect(t);
    expect(r.status).toBe(200);
    expect(r.json.data.lists).toEqual([{ id: "list_1", name: "Newsletter" }, { id: "list_2", name: "VIPs" }]);
    expect(r.json.data.provider).toMatchObject({ provider: "klaviyo", connected: true, status: "connected", listId: null });
    expect(JSON.stringify(r.json)).not.toContain(SECRET_KEY);

    const [row] = await t.env.deps.db.select().from(schema.providerConnections);
    expect(row!.encryptedCredentials).toMatch(/^v1\./);
    expect(row!.encryptedCredentials).not.toContain(SECRET_KEY);
    for (const p of [`/api/v1/stores/${t.storeId}/providers`, base(t) + "/lists"]) expect(JSON.stringify((await t.c.get(p)).json)).not.toContain(SECRET_KEY);
    expect(t.fake.calls.map((c) => c.op)).toEqual(["check", "check"]);
  });

  it("a key the provider rejects stores nothing and says so in plain words", async () => {
    const t = await shop();
    t.fake.failNext("auth");
    const r = await connect(t);
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("provider_auth_failed");
    expect(await t.env.deps.db.select().from(schema.providerConnections)).toHaveLength(0);
  });

  it("provider outages and rate limits map to retryable answers, without leaking the provider's words", async () => {
    const t = await shop();
    t.fake.failNext("transient", "HTTP 503: ada@example.com");
    const a = await connect(t);
    expect([a.status, a.json.error.code]).toEqual([502, "provider_unavailable"]);
    expect(JSON.stringify(a.json)).not.toContain("ada@example.com");
    t.fake.failNext("rate_limited");
    expect((await connect(t)).status).toBe(429);
  });

  it("is not verified against the live provider unless the check ran against the real API", async () => {
    const t = await shop();
    await connect(t);
    expect((await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data.find((p: { provider: string }) => p.provider === "klaviyo")).toMatchObject({ connected: true, verified: false, verifiedAt: null });

    t.fake.live = true; // a check against the real API
    await connect(t);
    const v = (await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data.find((p: { provider: string }) => p.provider === "klaviyo");
    expect(v).toMatchObject({ verified: true });
    expect(v.verifiedAt).toBe(new Date(t.env.clock.t).toISOString());
  });

  it("lists both providers whether or not they are connected, and rejects an unknown one", async () => {
    const t = await shop();
    const data = (await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data;
    expect(data.map((p: { provider: string; connected: boolean }) => [p.provider, p.connected])).toEqual([["klaviyo", false], ["mailchimp", false]]);
    expect((await t.c.put(base(t, "hubspot"), { apiKey: SECRET_KEY })).status).toBe(404);
  });

  it("only admins can connect, choose a list, check, retry or disconnect; editors can read status; other stores see nothing", async () => {
    const t = await shop();
    await ready(t);
    const editor = await signup(t.env, "editor@example.com");
    await t.env.deps.db.insert(schema.memberships).values({ id: "m_ed", organizationId: t.orgId, userId: editor.userId, role: "editor", createdAt: "t" });
    expect((await editor.c.get(`/api/v1/stores/${t.storeId}/providers`)).status).toBe(200);
    for (const [m, p, b] of [["put", base(t), { apiKey: SECRET_KEY }], ["get", base(t) + "/lists"], ["post", base(t) + "/check"], ["post", base(t) + "/retry"], ["del", base(t)]] as const) {
      const r = await (editor.c as unknown as Record<string, (p: string, b?: unknown) => Promise<{ status: number }>>)[m]!(p, b);
      expect(r.status, `${m} ${p}`).toBe(403);
    }
    const stranger = await signup(t.env, "stranger@example.com");
    expect((await stranger.c.get(`/api/v1/stores/${t.storeId}/providers`)).status).toBe(404);
    expect((await stranger.c.put(base(t), { apiKey: SECRET_KEY })).status).toBe(404);
    expect((await new Client(t.env).get(`/api/v1/stores/${t.storeId}/providers`)).status).toBe(401);
    expect((await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data[0].connected).toBe(true); // nothing above changed it
  });

  it("choosing a list needs one the key can see; a missing encryption key fails safe", async () => {
    const t = await shop();
    await connect(t);
    expect((await t.c.put(base(t), { listId: "nope" })).json.error.code).toBe("list_not_found");
    expect((await t.c.put(base(t), {})).status).toBe(422); // neither a key nor a list
    const bare = await makeEnv(undefined, { email: new MailBox(), secrets: { ...secrets, credentialKey: undefined as never } });
    bare.deps.secrets = { webOrigin: "x" };
    const u = await signup(bare, "o@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "S", domain: "s.example.com", currency: "USD" });
    expect((await u.c.put(`/api/v1/stores/${s.json.data.id}/providers/klaviyo`, { apiKey: SECRET_KEY })).status).toBe(503);
  });

  it("a key change keeps the chosen list only if the new key can still see it", async () => {
    const t = await shop();
    await ready(t);
    await connect(t);
    expect((await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data[0]).toMatchObject({ listId: "list_1", listName: "Newsletter" });
    t.fake.lists = [{ id: "other", name: "Other" }];
    await connect(t);
    expect((await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data[0]).toMatchObject({ listId: null });
  });
});

describe("syncing confirmed subscribers", () => {
  it("copies a subscriber once they confirm, with the consent time, source and first name: never before", async () => {
    const t = await shop({ form: { ...form, collect: { email: true, firstName: true } } });
    await ready(t);
    await subscribe(t, "Ada@Example.com", { firstName: "  Ada " });
    expect(t.fake.calls.filter((c) => c.op === "subscribe")).toHaveLength(0); // pending: nothing is sent anywhere
    expect(await jobs(t.env)).toHaveLength(0);

    await t.env.app.request(path(t.mail.link()));
    const subs = t.fake.calls.filter((c) => c.op === "subscribe");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ listId: "list_1", contact: { channel: "email", email: "ada@example.com", firstName: "Ada", source: `form:${t.formId}`, consentedAt: new Date(t.env.clock.t).toISOString() } });
    expect(await jobs(t.env)).toMatchObject([{ provider: "klaviyo", channel: "email", action: "subscribe", status: "synced", attempts: 1, providerRef: "fake_ada@example.com" }]);
  });

  it("creates no job without a connected provider and a chosen list", async () => {
    const t = await shop();
    await confirmed(t, "a@example.com");
    expect(await jobs(t.env)).toHaveLength(0);
    await connect(t); // connected but no list chosen yet
    await confirmed(t, "b@example.com");
    expect(await jobs(t.env)).toHaveLength(0);
    expect(t.fake.calls.filter((c) => c.op === "subscribe")).toHaveLength(0);
  });

  it("syncs to every connected provider, one job each", async () => {
    const t = await shop();
    await ready(t);
    expect((await connect(t, "mailchimp")).status).toBe(200);
    expect((await t.c.put(base(t, "mailchimp"), { listId: "list_2" })).status).toBe(200);
    await confirmed(t, "a@example.com");
    expect((await jobs(t.env)).map((j) => [j.provider, j.status]).sort()).toEqual([["klaviyo", "synced"], ["mailchimp", "synced"]]);
  });

  it("is idempotent: a second confirmation attempt, a duplicate run or a retry never makes a second job or a second call", async () => {
    const t = await shop();
    await ready(t);
    await confirmed(t, "a@example.com");
    const [j] = await jobs(t.env);
    expect(await runSyncJob(t.env.deps, j!.id)).toEqual({}); // already synced: nothing to do
    t.env.clock.t += 20 * MIN;
    await subscribe(t, "a@example.com"); // already subscribed: no new request at all
    expect(await jobs(t.env)).toHaveLength(1);
    expect(t.fake.calls.filter((c) => c.op === "subscribe")).toHaveLength(1);
  });

  it("an opt-out takes them off the provider's list", async () => {
    const t = await shop();
    await ready(t);
    await confirmed(t, "a@example.com");
    const res = await t.env.app.request(path(unsubUrl(t.mail, "a@example.com")), { method: "POST" });
    expect(res.status).toBe(200);
    expect(t.fake.calls.filter((c) => c.op === "unsubscribe")).toHaveLength(1);
    expect(await jobs(t.env)).toMatchObject([{ action: "unsubscribe", status: "synced" }]);
    // asking again is harmless
    await revokeConsent(t.env.deps, t.storeId, "email", "a@example.com", "again");
    expect(t.fake.calls.filter((c) => c.op === "unsubscribe")).toHaveLength(1);
  });

  it("never sends someone who opted out before their job ran: consent is re-checked at the moment of sending", async () => {
    const t = await shop();
    const queued: unknown[] = [];
    t.env.deps.enqueueEvents = async (m) => { queued.push(m); }; // production-style: jobs wait in a queue
    await ready(t);
    await confirmed(t, "a@example.com");
    expect(queued).toHaveLength(1);
    expect(await jobs(t.env)).toMatchObject([{ status: "pending", action: "subscribe" }]);

    await t.env.app.request(path(unsubUrl(t.mail, "a@example.com")), { method: "POST" }); // opts out while the job waits
    expect(await jobs(t.env)).toMatchObject([{ status: "skipped_no_consent" }]); // cancelled: nothing had been sent, so nothing to take back
    await processSyncMessage(t.env.deps, queued[0] as SyncMessage); // the queued message arrives anyway
    expect(t.fake.calls.filter((c) => c.op === "subscribe" || c.op === "unsubscribe")).toHaveLength(0);
  });

  it("a suppression that appears after the job was made still wins", async () => {
    const t = await shop();
    const queued: SyncMessage[] = [];
    t.env.deps.enqueueEvents = async (m) => { queued.push(m as SyncMessage); };
    await ready(t);
    await confirmed(t, "a@example.com");
    const { identifierHash } = await import("../src/services/suppression.js");
    await t.env.deps.db.insert(schema.suppressionRecords).values({ id: "sup_x", storeId: t.storeId, emailHash: await identifierHash(t.storeId, "a@example.com"), channel: "email", reason: "bounced", createdAt: "t" });
    await processSyncMessage(t.env.deps, queued[0]!);
    expect(await jobs(t.env)).toMatchObject([{ status: "skipped_suppressed" }]);
    expect(t.fake.calls.filter((c) => c.op === "subscribe")).toHaveLength(0);
  });

  it("an opt-out that arrives mid-sync is not overwritten by the subscribe finishing", async () => {
    const t = await shop();
    const queued: SyncMessage[] = [];
    t.env.deps.enqueueEvents = async (m) => { queued.push(m as SyncMessage); };
    await ready(t);
    await confirmed(t, "a@example.com");
    // the provider call is slow; the shopper opts out while it is in flight
    const real = t.fake.subscribe.bind(t.fake);
    t.fake.subscribe = async (l, c) => { const r = await real(l, c); await revokeConsent(t.env.deps, t.storeId, "email", "a@example.com", "link"); return r; };
    await processSyncMessage(t.env.deps, queued[0]!);
    const [j] = await jobs(t.env);
    expect(j).toMatchObject({ action: "unsubscribe", status: "pending" }); // the subscribe result was not recorded over the opt-out
    t.fake.subscribe = real;
    await runSyncJob(t.env.deps, j!.id);
    expect(t.fake.calls.map((c) => c.op).filter((o) => o !== "check")).toEqual(["subscribe", "unsubscribe"]); // the list ends without them
  });

  it("someone who never confirmed is never synced, and a pending request is not exported to a provider by a later backfill", async () => {
    const t = await shop();
    await subscribe(t, "pending@example.com");
    await confirmed(t, "done@example.com");
    await ready(t, true);
    expect(t.fake.calls.filter((c) => c.op === "subscribe").map((c) => c.contact?.email)).toEqual(["done@example.com"]);
  });

  it("choosing 'also add existing subscribers' queues exactly those already subscribed; otherwise it does not", async () => {
    const a = await shop();
    await confirmed(a, "a@example.com"); await confirmed(a, "b@example.com");
    await ready(a, false);
    expect(await jobs(a.env)).toHaveLength(0);
    const r = await a.c.put(base(a), { listId: "list_1", syncExisting: true });
    expect(r.json.data.queued).toBe(2);
    expect((await jobs(a.env)).map((j) => j.status)).toEqual(["synced", "synced"]);
  });
});

describe("retries, rate limits and failures", () => {
  it("a rate limit waits at least as long as the provider asked, and no call is made early", async () => {
    const t = await shop();
    const queued: SyncMessage[] = [];
    t.env.deps.enqueueEvents = async (m) => { queued.push(m as SyncMessage); };
    await ready(t);
    t.fake.failNext("rate_limited", "HTTP 429", 5 * MIN);
    await confirmed(t, "a@example.com");
    expect(await runSyncJob(t.env.deps, queued[0]!.jobId)).toEqual({ retryAfterMs: 5 * MIN });
    const [j] = await jobs(t.env);
    expect(j).toMatchObject({ status: "pending", attempts: 1, nextAttemptAt: new Date(t.env.clock.t + 5 * MIN).toISOString() });

    const calls = t.fake.calls.length;
    t.env.clock.t += MIN; // too early (a redelivered message)
    expect(await runSyncJob(t.env.deps, j!.id)).toEqual({ retryAfterMs: 4 * MIN });
    expect(t.fake.calls.length).toBe(calls);

    t.env.clock.t += 4 * MIN;
    expect(await runSyncJob(t.env.deps, j!.id)).toEqual({});
    expect((await jobs(t.env))[0]).toMatchObject({ status: "synced", attempts: 2, lastError: null, nextAttemptAt: null });
  });

  it("outages back off 30 s, 1 min, 2 min... and give up visibly after the limit", async () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 12].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_840_000, 6 * 3_600_000]);
    const t = await shop();
    const queued: SyncMessage[] = [];
    t.env.deps.enqueueEvents = async (m, o) => { queued.push({ ...(m as SyncMessage), delay: o?.delaySeconds } as SyncMessage); };
    await ready(t);
    for (let i = 0; i < MAX_ATTEMPTS; i++) t.fake.failNext("transient", "HTTP 503");
    await confirmed(t, "a@example.com");
    const id = queued[0]!.jobId;
    for (let n = 1; n < MAX_ATTEMPTS; n++) {
      const r = await runSyncJob(t.env.deps, id);
      expect(r.retryAfterMs, `attempt ${n}`).toBe(backoffMs(n));
      t.env.clock.t += r.retryAfterMs!;
    }
    expect(await runSyncJob(t.env.deps, id)).toEqual({});
    const [j] = await jobs(t.env);
    expect(j).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(j!.lastError).toContain("Gave up after 8 attempts");
    expect(await runSyncJob(t.env.deps, id)).toEqual({}); // failed jobs stay put until the merchant retries them
  });

  it("the queue consumer puts a waiting job back on the queue with a delay, and does so only when it must wait", async () => {
    const t = await shop();
    const sent: { m: unknown; delay?: number | undefined }[] = [];
    t.env.deps.enqueueEvents = async (m, o) => { sent.push({ m, delay: o?.delaySeconds }); };
    await ready(t);
    t.fake.failNext("transient");
    await confirmed(t, "a@example.com");
    const first = sent[0]!.m as SyncMessage;
    await processSyncMessage(t.env.deps, first);
    expect(sent[1]).toEqual({ m: first, delay: 30 });
    t.env.clock.t += 30_000;
    await processSyncMessage(t.env.deps, first);
    expect(sent).toHaveLength(2); // it worked this time: nothing more to schedule
    expect((await jobs(t.env))[0]!.status).toBe("synced");
  });

  it("a rejected request is a permanent failure, shown to the merchant without the provider's words, and not retried", async () => {
    const t = await shop();
    await ready(t);
    t.fake.failNext("rejected", "HTTP 400: Invalid Resource");
    await confirmed(t, "a@example.com");
    expect(await jobs(t.env)).toMatchObject([{ status: "failed", attempts: 1, lastError: "HTTP 400: Invalid Resource" }]);
    expect(t.fake.calls.filter((c) => c.op === "subscribe")).toHaveLength(1);
  });

  it("a revoked key fails the job, flags the connection, and works again after reconnecting and retrying", async () => {
    const t = await shop();
    await ready(t);
    t.fake.failNext("auth");
    await confirmed(t, "a@example.com");
    expect(await jobs(t.env)).toMatchObject([{ status: "failed", lastError: "The provider rejected the key" }]);
    const view = (await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data[0];
    expect(view).toMatchObject({ status: "error", counts: { failed: 1 } });
    expect(view.lastError).toContain("Reconnect");

    await connect(t); // a good key again: the connection is healthy
    expect((await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data[0]).toMatchObject({ status: "connected", lastError: null });
    expect((await t.c.post(base(t) + "/retry")).json.data.retried).toBe(1);
    expect(await jobs(t.env)).toMatchObject([{ status: "synced", attempts: 1 }]);
  });

  it("the daily sweep hands due pending jobs back to the queue and leaves those still waiting", async () => {
    const t = await shop();
    const queued: SyncMessage[] = [];
    t.env.deps.enqueueEvents = async (m) => { queued.push(m as SyncMessage); };
    await ready(t);
    await confirmed(t, "a@example.com"); await confirmed(t, "b@example.com");
    queued.length = 0; // pretend both enqueues were lost
    const [first] = await jobs(t.env);
    await t.env.deps.db.update(schema.providerSyncJobs).set({ nextAttemptAt: new Date(t.env.clock.t + 10 * MIN).toISOString() }).where(eq(schema.providerSyncJobs.id, first!.id));
    expect(await sweepSyncJobs(t.env.deps)).toBe(1);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.jobId).not.toBe(first!.id);
    t.env.clock.t += 11 * MIN;
    expect(await sweepSyncJobs(t.env.deps)).toBe(2);
  });

  it("a lost enqueue never breaks the confirmation", async () => {
    const t = await shop();
    t.env.deps.enqueueEvents = async () => { throw new Error("queue down"); };
    await ready(t);
    expect(await confirmed(t, "a@example.com")).toContain("You're subscribed");
    expect(await jobs(t.env)).toMatchObject([{ status: "pending" }]); // the sweep will pick it up
  });
});

describe("what the merchant sees and can do", () => {
  it("shows each contact's sync status on the list and the detail", async () => {
    const t = await shop();
    await ready(t);
    await confirmed(t, "a@example.com");
    const list = (await t.c.get(`/api/v1/stores/${t.storeId}/contacts`)).json.data;
    expect(list[0].sync).toEqual([{ provider: "klaviyo", status: "synced", action: "subscribe", error: null }]);
    const detail = (await t.c.get(`/api/v1/stores/${t.storeId}/contacts/${list[0].id}`)).json.data;
    expect(detail.sync).toEqual(list[0].sync);
    expect((await t.c.get(`/api/v1/stores/${t.storeId}/providers`)).json.data[0].counts).toMatchObject({ synced: 1, pending: 0, failed: 0 });
  });

  it("disconnecting removes the connection and its jobs and stops later syncs", async () => {
    const t = await shop();
    await ready(t);
    await confirmed(t, "a@example.com");
    expect((await t.c.del(base(t))).status).toBe(204);
    expect(await jobs(t.env)).toHaveLength(0);
    expect(await t.env.deps.db.select().from(schema.providerConnections)).toHaveLength(0);
    await confirmed(t, "b@example.com");
    expect(t.fake.calls.filter((c) => c.op === "subscribe")).toHaveLength(1); // only the one from before
    expect((await t.c.del(base(t))).status).toBe(404);
  });

  it("connection changes are audited by provider name and never contain the key", async () => {
    const t = await shop();
    await ready(t);
    await t.c.del(base(t));
    const log = await t.env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.storeId, t.storeId));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["provider.connected", "provider.list_chosen", "provider.disconnected"]));
    expect(JSON.stringify(log)).not.toContain(SECRET_KEY);
  });

  it("each store's connection is its own", async () => {
    const t = await shop();
    await ready(t);
    const other = await signup(t.env, "other@example.com");
    const s2 = await other.c.post("/api/v1/stores", { organizationId: other.orgId, platform: "custom", name: "Other", domain: "o.example.com", currency: "USD" });
    expect((await other.c.get(`/api/v1/stores/${s2.json.data.id}/providers`)).json.data.every((p: { connected: boolean }) => !p.connected)).toBe(true);
    await confirmed(t, "a@example.com");
    expect(await jobs(t.env)).toHaveLength(1);
    expect((await jobs(t.env))[0]!.storeId).toBe(t.storeId);
  });
});

describe("erasure and the provider", () => {
  it("unsubscribes them at the provider first, then erases locally and removes their jobs", async () => {
    const t = await shop();
    await ready(t);
    await confirmed(t, "a@example.com");
    const [c] = await t.env.deps.db.select().from(schema.contacts);
    const r = await t.c.del(`/api/v1/stores/${t.storeId}/contacts/${c!.id}`);
    expect(r.status).toBe(204);
    expect(t.fake.calls.map((x) => x.op).filter((o) => o !== "check")).toEqual(["subscribe", "unsubscribe"]);
    expect(await t.env.deps.db.select().from(schema.contacts)).toHaveLength(0);
    expect(await jobs(t.env)).toHaveLength(0);
  });

  it("erases locally even when the provider cannot be reached, says which one, and audits it without personal data", async () => {
    const t = await shop();
    await ready(t);
    await confirmed(t, "a@example.com");
    const [c] = await t.env.deps.db.select().from(schema.contacts);
    t.fake.failNext("transient");
    const res = await t.env.app.request(`/api/v1/stores/${t.storeId}/contacts/${c!.id}`, { method: "DELETE", headers: { origin: "http://localhost:3000", cookie: t.c.cookie } });
    expect(res.status).toBe(204);
    expect(res.headers.get("x-provider-cleanup-failed")).toBe("klaviyo");
    expect(await t.env.deps.db.select().from(schema.contacts)).toHaveLength(0);
    const audit = await t.env.deps.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.storeId, t.storeId), eq(schema.auditLogs.action, "contact.provider_cleanup_failed")));
    expect(audit).toMatchObject([{ targetType: "provider", targetId: "klaviyo" }]);
    expect(JSON.stringify(audit)).not.toContain("a@example.com");
  });

  it("does not contact a provider about someone who was never copied there", async () => {
    const t = await shop();
    await confirmed(t, "early@example.com"); // before any provider was connected
    await ready(t);
    const [c] = await t.env.deps.db.select().from(schema.contacts);
    await t.c.del(`/api/v1/stores/${t.storeId}/contacts/${c!.id}`);
    expect(t.fake.calls.filter((x) => x.op !== "check")).toHaveLength(0);
  });
});

describe("first name", () => {
  it("keeps only name-like characters and a sane length", () => {
    expect(normalizeFirstName("  Ada  ")).toBe("Ada");
    expect(normalizeFirstName("Jean-Luc O'Brien")).toBe("Jean-Luc O'Brien");
    expect(normalizeFirstName("Zoë Łukasz")).toBe("Zoë Łukasz");
    expect(normalizeFirstName("<script>alert(1)</script>")).toBe("scriptalertscript"); // no markup characters survive
    expect(normalizeFirstName("=HYPERLINK(\"x\")")).toBe("HYPERLINKx"); // nor a spreadsheet formula
    expect(normalizeFirstName("a\u0000b\nc")).toBe("abc"); // nor control characters
    expect(normalizeFirstName("   ")).toBeNull();
    expect(normalizeFirstName("12345")).toBeNull();
    expect(normalizeFirstName(42)).toBeNull();
    expect(normalizeFirstName("x".repeat(200))!.length).toBe(60);
  });

  it("is stored only when the published form asks for it", async () => {
    const without = await shop();
    await confirmed(without, "a@example.com", { firstName: "Ada" });
    expect((await without.env.deps.db.select().from(schema.contacts))[0]!.firstName).toBeNull();

    const withName = await shop({ form: { ...form, collect: { email: true, firstName: true } } });
    await confirmed(withName, "a@example.com", { firstName: "Ada" });
    expect((await withName.env.deps.db.select().from(schema.contacts))[0]!.firstName).toBe("Ada");
    const csv = await (await withName.env.app.request(`/api/v1/stores/${withName.storeId}/contacts/export`, { headers: { origin: "http://localhost:3000", cookie: withName.c.cookie } })).text();
    expect(csv.split("\r\n")[1]).toMatch(/^a@example\.com,Ada,/);
  });
});

describe("the sign-up incentive", () => {
  const promo = { code: "WELCOME15", percentOff: 15, label: "Welcome offer" };

  it("is shown only after the shopper confirms, and is emailed to them too; the confirmation email itself never contains it", async () => {
    const t = await shop({ promotion: promo });
    await subscribe(t, "a@example.com");
    expect(t.mail.last()!.text).not.toContain("WELCOME15"); // the request email
    expect(JSON.stringify((await t.env.app.request(`/sdk/v1/config/${t.siteKey}.json`)).headers)).not.toContain("WELCOME15");

    const page = await (await t.env.app.request(path(t.mail.link("a@example.com")))).text();
    expect(page).toContain("WELCOME15");
    expect(page).toContain("15% off");
    expect(page).toContain("emailed it to you");
    const welcome = t.mail.last("a@example.com")!;
    expect(welcome.subject).toContain("15% off");
    expect(welcome.text).toContain("WELCOME15");
    expect(welcome.headers?.["List-Unsubscribe"]).toBeTruthy();

    // the link is single use, so a second visit does not show the code again
    expect(await (await t.env.app.request(path(t.mail.sent.find((m) => /Confirm your subscription/.test(m.subject))!.text.match(/https?:\/\/\S+/)![0]))).text()).not.toContain("WELCOME15");
  });

  it("is not given to someone who never confirms", async () => {
    const t = await shop({ promotion: promo });
    await subscribe(t, "a@example.com");
    expect(t.mail.sent.filter((m) => m.text.includes("WELCOME15"))).toHaveLength(0);
  });

  it("a form without an incentive confirms exactly as before", async () => {
    const t = await shop();
    const page = await confirmed(t, "a@example.com");
    expect(page).toContain("You're subscribed");
    expect(page).not.toMatch(/code|% off/i);
    expect(t.mail.sent.filter((m) => /off/.test(m.subject))).toHaveLength(0);
  });

  it("honours the version the shopper used, even if the form was republished with a different offer since", async () => {
    const t = await shop({ promotion: promo });
    await subscribe(t, "a@example.com");
    const put = await t.c.put(`/api/v1/stores/${t.storeId}/campaigns/${t.formId}`, validConfig({ tool: "email", format: "popup", form, promotion: { code: "NEWDEAL", percentOff: 25 } }));
    await t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${t.formId}/publish`, { approve: true, approvedUpdatedAt: put.json.data.updatedAt });
    const page = await (await t.env.app.request(path(t.mail.link("a@example.com")))).text();
    expect(page).toContain("WELCOME15");
    expect(page).not.toContain("NEWDEAL");
  });

  it("never hands out more than the store allows today: a lowered ceiling or turning promotions off hides the code", async () => {
    const a = await shop({ promotion: promo });
    await subscribe(a, "a@example.com");
    await a.c.patch(`/api/v1/stores/${a.storeId}/settings`, { maxDiscountPercent: 10 });
    expect(await (await a.env.app.request(path(a.mail.link("a@example.com")))).text()).not.toContain("WELCOME15");

    const b = await shop({ promotion: promo });
    await subscribe(b, "b@example.com");
    await b.c.patch(`/api/v1/stores/${b.storeId}/settings`, { maxDiscountPercent: null });
    expect(await (await b.env.app.request(path(b.mail.link("b@example.com")))).text()).not.toContain("WELCOME15");
  });

  it("cannot be published above the ceiling (the same guardrail as every other discount)", async () => {
    const t = await shop();
    const c = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns`, validConfig({ tool: "email", format: "popup", form, promotion: { code: "BIG", percentOff: 50 } }));
    const r = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    expect(r.json.error.code).toBe("promotion_exceeds_limit");
  });

  it("escapes anything merchant-written that reaches the page", async () => {
    const t = await shop({ promotion: { ...promo, label: "<img src=x onerror=alert(1)>" } });
    await subscribe(t, "a@example.com");
    const page = await (await t.env.app.request(path(t.mail.link("a@example.com")))).text();
    expect(page).not.toContain("<img src=x");
    expect(page).toContain("&lt;img");
  });
});

describe("per-form signup counts", () => {
  it("counts requests and confirmations for each form in the period, and the rate is confirmations per impression", async () => {
    const t = await shop();
    await confirmed(t, "a@example.com"); await confirmed(t, "b@example.com");
    await subscribe(t, "c@example.com"); // requested, not confirmed
    const day = new Date(t.env.clock.t).toISOString().slice(0, 10);
    const forms = async () => (await t.c.get(`/api/v1/stores/${t.storeId}/analytics?from=${day}&to=${day}`)).json.data.forms as { campaignId: string; impressions: number; requested: number; confirmed: number; requestRate: number | null; confirmRate: number | null }[];
    // no impressions reported yet: counts come from the server, the request rate is unknown rather than made up
    expect(await forms()).toMatchObject([{ campaignId: t.formId, impressions: 0, requested: 3, confirmed: 2, requestRate: null, confirmRate: 2 / 3 }]);

    const [v] = await t.env.deps.db.select({ id: schema.campaignVersions.id }).from(schema.campaignVersions).where(eq(schema.campaignVersions.campaignId, t.formId));
    const events = Array.from({ length: 10 }, (_, i) => ({ eventId: `evt_impr_${i}`, type: "campaign_impression", siteId: t.siteKey, campaignId: t.formId, versionId: v!.id, sessionId: "sess_12345678", occurredAt: new Date(t.env.clock.t).toISOString(), schemaVersion: 1 }));
    const res = await t.env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ consent: true, events }) });
    expect(res.status).toBe(202);
    const [f] = await forms();
    expect(f).toMatchObject({ impressions: 10, requested: 3, confirmed: 2, requestRate: 0.3 });
  });

  it("is per store and per period, and counts a form's confirmations on the day they happened", async () => {
    const t = await shop();
    await confirmed(t, "a@example.com");
    const other = await shop();
    const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const range = (s: Shop, from: string, to: string) => s.c.get(`/api/v1/stores/${s.storeId}/analytics?from=${from}&to=${to}`);
    expect((await range(other, dayOf(t.env.clock.t), dayOf(t.env.clock.t))).json.data.forms).toEqual([]); // another store's sign-ups are not mine
    expect((await range(t, "2026-01-01", "2026-01-31")).json.data.forms).toEqual([]);
    expect((await range(t, dayOf(t.env.clock.t), dayOf(t.env.clock.t))).json.data.forms).toHaveLength(1);
  });
});
