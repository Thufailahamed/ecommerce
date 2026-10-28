import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { SHIPPED_TOOLS, type Tool } from "@convertflow/contracts";
import { schema } from "@convertflow/database";
import { Client, KEY, MailBox, makeEnv, setPlan, signup, validConfig, type Env } from "./helpers.js";
import { OPT_IN_COOLDOWN_MS, normalizeEmail, normalizePhone, purgeContacts, requestOptIn, revokeConsent } from "../src/services/contacts.js";
import { purgeStoreData } from "../src/services/privacy.js";

const shipped = SHIPPED_TOOLS as Set<Tool>; // production code treats it as read-only; tests flip it to exercise the gate
const defaults = [...shipped];
beforeEach(() => shipped.add("email"));
afterEach(() => { shipped.clear(); for (const t of defaults) shipped.add(t); });

const secrets = { credentialKey: KEY, webOrigin: "https://app.example.com", apiOrigin: "https://api.example.com" };
const path = (url: string) => { const u = new URL(url); return u.pathname + u.search; };
const CONSENT = "I agree to receive marketing emails from Shop. I can unsubscribe at any time.";
const PRIVACY = "https://shop.example.com/privacy";
const MIN = 60_000, DAY = 86_400_000;
const form = { collect: { email: true }, consentText: CONSENT, privacyUrl: PRIVACY };
const formCampaign = (over: Record<string, unknown> = {}) => validConfig({ tool: "email", format: "popup", form, ...over });

/** A store with a published email form. The plan is applied after publishing so a test can model a downgrade. */
async function shop(plan: "free" | "starter" | "growth" | "scale" = "starter") {
  const mail = new MailBox();
  const env = await makeEnv(undefined, { email: mail, secrets });
  const u = await signup(env, "owner@example.com");
  await new Client(env).post("/api/v1/auth/verify-email", { token: mail.token("owner@example.com") });
  await setPlan(env, u.orgId, "growth");
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Shop", domain: "shop.example.com", currency: "USD" });
  const storeId = s.json.data.id as string;
  const created = await u.c.post(`/api/v1/stores/${storeId}/campaigns`, formCampaign());
  const formId = created.json.data.id as string;
  const pub = await u.c.post(`/api/v1/stores/${storeId}/campaigns/${formId}/publish`, { approve: true, approvedUpdatedAt: created.json.data.updatedAt });
  expect(pub.status, JSON.stringify(pub.json)).toBe(200);
  await setPlan(env, u.orgId, plan);
  mail.sent.length = 0; // drop the account's own verification email: tests below count only what sign-up sends
  return { env, mail, ...u, storeId, formId, siteKey: s.json.data.siteKey as string };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const post = (env: Env, body: Record<string, unknown>) =>
  env.app.request("/api/v1/notifications/subscribe", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) });
const subscribe = (t: Shop, email: string, extra: Record<string, unknown> = {}) =>
  post(t.env, { siteId: t.siteKey, campaignId: t.formId, email, consent: true, ...extra });
const rows = (env: Env) => env.deps.db.select().from(schema.contacts);
const events = (env: Env) => env.deps.db.select().from(schema.consentEvents);
const unsubUrl = (mail: MailBox, to: string) => mail.last(to)!.headers!["List-Unsubscribe"]!.replace(/[<>]/g, "");

/** Subscribes and confirms an address through the public flow. */
async function confirmed(t: Shop, email: string) {
  await subscribe(t, email);
  await t.env.app.request(path(t.mail.link(email)));
}

describe("email sign-up with double opt-in", () => {
  it("full flow: pending until confirmed, the exact consent text is kept, the link works once", async () => {
    const t = await shop();
    // anything the browser claims about the consent text is ignored: the published form's words are what gets stored
    expect((await subscribe(t, "Shopper@Example.com", { consentText: "I agree to something else entirely, honest.", privacyUrl: "https://evil.example/x" })).status).toBe(202);

    // only a confirmation goes out, and the contact cannot be messaged yet
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.last()!.subject).toMatch(/Confirm your subscription/);
    expect(t.mail.last()!.text).toContain(CONSENT);
    expect(t.mail.last()!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const [pending] = await rows(t.env);
    expect(pending).toMatchObject({ email: "shopper@example.com", phone: null, emailStatus: "pending", smsStatus: "none" });

    const ok = await t.env.app.request(path(t.mail.link()));
    expect(await ok.text()).toContain("You're subscribed");
    expect(ok.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await rows(t.env))[0]?.emailStatus).toBe("subscribed");
    expect(await (await t.env.app.request(path(t.mail.link()))).text()).toContain("Link not valid"); // single use

    const log = (await events(t.env)).sort((a, b) => a.event.localeCompare(b.event));
    expect(log.map((e) => e.event)).toEqual(["confirmed", "requested"]);
    const requested = log.find((e) => e.event === "requested")!;
    expect(requested).toMatchObject({ channel: "email", consentText: CONSENT, privacyUrl: PRIVACY, source: `form:${t.formId}` });
    expect(requested.consentTextHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("collects nothing until the email tool ships", async () => {
    const t = await shop();
    shipped.delete("email");
    expect((await subscribe(t, "a@example.com")).status).toBe(202);
    expect(t.mail.sent).toHaveLength(0);
    expect(await rows(t.env)).toHaveLength(0);
  });

  it("answers identically for everything and never mails or stores without an eligible plan, site, form or address", async () => {
    const downgraded = await shop("free"); // published while on a plan with the tool, then downgraded
    const ok = await shop("starter");
    const paused = await shop("starter");
    await paused.c.post(`/api/v1/stores/${paused.storeId}/campaigns/${paused.formId}/pause`);
    const draft = await shop("starter");
    const other = await draft.c.post(`/api/v1/stores/${draft.storeId}/campaigns`, formCampaign({ name: "Never published" }));
    const cases: [Shop, Record<string, unknown>][] = [
      [downgraded, {}],                                     // plan without the email tool
      [ok, { siteId: "cf_unknownsite00" }],                 // unknown site
      [ok, { campaignId: "cmp_unknown" }],                  // unknown form
      [ok, { email: "not-an-email" }],                      // invalid address
      [paused, {}],                                         // paused form
      [draft, { campaignId: other.json.data.id }],          // a draft that was never published
      [ok, { campaignId: ok.formId, siteId: draft.siteKey }], // a real form, but another store's site key
    ];
    for (const [t, extra] of cases) {
      const r = await subscribe(t, "x@example.com", extra);
      expect([r.status, await r.json()]).toEqual([202, { ok: true }]);
    }
    for (const t of [downgraded, ok, paused, draft]) { expect(t.mail.sent).toHaveLength(0); expect(await rows(t.env)).toHaveLength(0); }

    // schema violations are the only distinguishable answer, including consent that was not ticked
    expect((await subscribe(ok, "x@example.com", { consent: false })).status).toBe(422);
    expect((await subscribe(ok, "x@example.com", { consent: undefined })).status).toBe(422);
    expect((await subscribe(ok, "x@example.com", { campaignId: undefined })).status).toBe(422);
    expect(ok.mail.sent).toHaveLength(0);
  });

  it("uses the form that is live: republishing new words applies to later sign-ups and keeps earlier proof intact", async () => {
    const t = await shop();
    await subscribe(t, "old@example.com");
    const NEW = "I would like marketing emails and special offers from Shop. Unsubscribe whenever.";
    const put = await t.c.put(`/api/v1/stores/${t.storeId}/campaigns/${t.formId}`, formCampaign({ form: { ...form, consentText: NEW } }));
    await t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${t.formId}/publish`, { approve: true, approvedUpdatedAt: put.json.data.updatedAt });
    await subscribe(t, "new@example.com");
    const byAddr = Object.fromEntries(await Promise.all((await rows(t.env)).map(async (c) => [c.email!, (await events(t.env)).find((e) => e.contactId === c.id)!.consentText])));
    expect(byAddr).toEqual({ "old@example.com": CONSENT, "new@example.com": NEW });
  });

  it("does not mail an address twice within the cooldown, then allows a new request", async () => {
    const t = await shop();
    await subscribe(t, "a@example.com");
    await subscribe(t, "a@example.com");
    await subscribe(t, "A@example.com");
    expect(t.mail.sent).toHaveLength(1);
    t.env.clock.t += OPT_IN_COOLDOWN_MS + MIN;
    await subscribe(t, "a@example.com");
    expect(t.mail.sent).toHaveLength(2);
    expect(await rows(t.env)).toHaveLength(1); // still one person
    const link = path(t.mail.link()); // the newest link confirms
    expect(await (await t.env.app.request(link)).text()).toContain("You're subscribed");
  });

  it("an already subscribed address is not mailed again", async () => {
    const t = await shop();
    await confirmed(t, "a@example.com");
    const before = t.mail.sent.length;
    t.env.clock.t += DAY;
    await subscribe(t, "a@example.com");
    expect(t.mail.sent.length).toBe(before);
  });

  it("a confirmation link expires after 7 days and never confirms an address that has since opted out", async () => {
    const t = await shop();
    await subscribe(t, "late@example.com");
    const stale = path(t.mail.link("late@example.com"));
    t.env.clock.t += 8 * DAY;
    expect(await (await t.env.app.request(stale)).text()).toContain("Link not valid");
    expect((await rows(t.env))[0]?.emailStatus).toBe("pending");

    await subscribe(t, "out@example.com");
    const link = path(t.mail.link("out@example.com"));
    await t.env.app.request(path(unsubUrl(t.mail, "out@example.com")), { method: "POST" });
    expect(await (await t.env.app.request(link)).text()).toContain("Link not valid");
    expect((await rows(t.env)).find((c) => c.email === "out@example.com")?.emailStatus).toBe("unsubscribed");
  });

  it("a provider failure on the confirmation does not break the request, and the shopper can ask again later", async () => {
    const t = await shop();
    t.mail.failNext = true;
    expect((await subscribe(t, "a@example.com")).status).toBe(202);
    expect(t.mail.sent).toHaveLength(0);
    // nothing reached the shopper, so the failed request does not hold them in the cooldown: they can try again straight away
    await subscribe(t, "a@example.com");
    expect(t.mail.sent).toHaveLength(1);
    expect((await events(t.env)).map((e) => e.event).sort()).toEqual(["delivery_failed", "requested", "requested"]);
    // ...but once a message did go out, the cooldown applies again
    await subscribe(t, "a@example.com");
    expect(t.mail.sent).toHaveLength(1);
  });

  it("a delivery failure only ever frees its own request: a request that was mailed still holds the cooldown", async () => {
    const t = await shop();
    await subscribe(t, "a@example.com");              // mailed
    t.env.clock.t += OPT_IN_COOLDOWN_MS + MIN;
    t.mail.failNext = true;
    await subscribe(t, "a@example.com");              // this one failed to send
    expect(t.mail.sent).toHaveLength(1);
    await subscribe(t, "a@example.com");              // the failed one does not count, so this goes out
    expect(t.mail.sent).toHaveLength(2);
  });
});

describe("opting out", () => {
  it("works by link and by one-click POST, is logged, suppresses the address, and rejects tampered tokens", async () => {
    const t = await shop();
    await confirmed(t, "a@example.com");
    const url = unsubUrl(t.mail, "a@example.com");

    expect(await (await t.env.app.request(path(url.slice(0, -3) + "AAA"))).text()).toContain("Link not valid");
    expect(await (await t.env.app.request(path(url.replace(".email.", ".sms.")))).text()).toContain("Link not valid"); // channel is part of the signature
    expect((await rows(t.env))[0]?.emailStatus).toBe("subscribed");

    const one = await t.env.app.request(path(url), { method: "POST" }); // RFC 8058 one-click
    expect(await one.text()).toContain("unsubscribed");
    expect((await rows(t.env))[0]?.emailStatus).toBe("unsubscribed");
    expect((await events(t.env)).map((e) => e.event).sort()).toEqual(["confirmed", "requested", "revoked"]);
    const sup = await t.env.deps.db.select().from(schema.suppressionRecords);
    expect(sup).toHaveLength(1);
    expect(sup[0]).toMatchObject({ channel: "email", reason: "unsubscribed" });
    expect(sup[0]?.emailHash).not.toContain("a@example.com"); // hash only

    await t.env.app.request(path(url)); // idempotent: a second click adds nothing
    expect((await events(t.env)).filter((e) => e.event === "revoked")).toHaveLength(1);

    const before = t.mail.sent.length;
    t.env.clock.t += DAY;
    await subscribe(t, "a@example.com"); // cannot come back by accident
    expect(t.mail.sent.length).toBe(before);
    expect((await rows(t.env))[0]?.emailStatus).toBe("unsubscribed");
  });

  it("a back-in-stock opt-out also opts the address out of marketing", async () => {
    const t = await shop("growth");
    await confirmed(t, "a@example.com");
    await t.c.post(`/api/v1/stores/${t.storeId}/products/import`, { products: [{ externalId: "p1", title: "Trail Runner", url: "/products/p1", variants: [{ externalId: "p1-v", available: false }] }] });
    await t.env.app.request("/api/v1/notifications/restock", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ siteId: t.siteKey, productId: "p1", email: "a@example.com" }) });
    await t.env.app.request(path(t.mail.link("a@example.com"))); // confirm the alert
    await t.c.post(`/api/v1/stores/${t.storeId}/products/import`, { products: [{ externalId: "p1", title: "Trail Runner", url: "/products/p1", variants: [{ externalId: "p1-v", available: true }] }] });
    const alert = t.mail.last("a@example.com")!;
    expect(alert.subject).toMatch(/available again/);

    await t.env.app.request(path(alert.headers!["List-Unsubscribe"]!.replace(/[<>]/g, "")), { method: "POST" });
    expect((await rows(t.env))[0]?.emailStatus).toBe("unsubscribed");
    expect((await events(t.env)).some((e) => e.event === "revoked" && e.source === "restock_unsubscribe")).toBe(true);
  });

  it("SMS contacts follow the same rules: stored as E.164, suppressed per channel, never re-requested after opting out", async () => {
    const t = await shop();
    const ask = () => requestOptIn(t.env.deps, t.storeId, { channel: "sms", value: "+1 (415) 555-0123", source: "api", consentText: "I agree to receive recurring texts. Reply STOP to opt out." });
    expect(await ask()).not.toBeNull();
    expect((await rows(t.env))[0]).toMatchObject({ phone: "+14155550123", email: null, smsStatus: "pending", emailStatus: "none" });
    await revokeConsent(t.env.deps, t.storeId, "sms", "+14155550123", "test");
    expect((await rows(t.env))[0]).toMatchObject({ smsStatus: "unsubscribed", emailStatus: "none" });
    const sup = await t.env.deps.db.select().from(schema.suppressionRecords);
    expect(sup).toHaveLength(1);
    expect(sup[0]?.channel).toBe("sms");
    t.env.clock.t += DAY;
    expect(await ask()).toBeNull();
  });
});

describe("identifiers", () => {
  it("normalises addresses and accepts only unambiguous E.164 numbers", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
    expect(normalizePhone("+1 (415) 555-0123")).toBe("+14155550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    for (const bad of ["4155550123", "0014155550123", "+0155550123", "+1415", "+1415555012345678", "tel:+14155550123", "+1415555012x"]) expect(normalizePhone(bad), bad).toBeNull();
  });

  it("requires real consent text, keeps one contact per person per store, and never leaks a suppression across stores", async () => {
    const t = await shop("growth"); // starter allows only one store
    const other = await t.c.post("/api/v1/stores", { organizationId: t.orgId, platform: "custom", name: "Second", domain: "second.example.com", currency: "USD" });
    const second = other.json.data.id as string;
    expect(await requestOptIn(t.env.deps, t.storeId, { channel: "email", value: "a@example.com", source: "api", consentText: "yes" })).toBeNull();
    expect(await requestOptIn(t.env.deps, t.storeId, { channel: "email", value: "a@example.com", source: "api", consentText: "x".repeat(601) })).toBeNull();
    expect(await requestOptIn(t.env.deps, t.storeId, { channel: "email", value: "a@example.com", source: "api", consentText: CONSENT })).not.toBeNull();
    expect(await requestOptIn(t.env.deps, second, { channel: "email", value: "a@example.com", source: "api", consentText: CONSENT })).not.toBeNull();
    expect(await rows(t.env)).toHaveLength(2); // the same person is a separate contact per store
    await revokeConsent(t.env.deps, t.storeId, "email", "z@example.com", "test"); // opted out of the first store only
    expect(await requestOptIn(t.env.deps, t.storeId, { channel: "email", value: "z@example.com", source: "api", consentText: CONSENT })).toBeNull();
    expect(await requestOptIn(t.env.deps, second, { channel: "email", value: "z@example.com", source: "api", consentText: CONSENT })).not.toBeNull();
  });
});

describe("merchant contact API", () => {
  async function populated() {
    const t = await shop();
    for (const e of ["a@example.com", "b@example.com", "c@example.com"]) { await confirmed(t, e); t.env.clock.t += MIN; }
    await subscribe(t, "d@example.com"); // left pending
    return t;
  }
  const base = (t: Shop) => `/api/v1/stores/${t.storeId}/contacts`;

  it("lists newest first with a stable cursor, and filters by exact address or status", async () => {
    const t = await populated();
    const p1 = await t.c.get(`${base(t)}?limit=3`);
    expect(p1.status).toBe(200);
    expect(p1.json.data.map((c: { email: string }) => c.email)).toEqual(["d@example.com", "c@example.com", "b@example.com"]);
    expect(p1.json.data[0]).not.toHaveProperty("tokenHash");
    const p2 = await t.c.get(`${base(t)}?limit=3&cursor=${encodeURIComponent(p1.json.nextCursor)}`);
    expect(p2.json.data.map((c: { email: string }) => c.email)).toEqual(["a@example.com"]);
    expect(p2.json.nextCursor).toBeNull();

    expect((await t.c.get(`${base(t)}?email=B@Example.com`)).json.data).toHaveLength(1);
    expect((await t.c.get(`${base(t)}?status=pending`)).json.data.map((c: { email: string }) => c.email)).toEqual(["d@example.com"]);
    expect((await t.c.get(`${base(t)}?status=subscribed&channel=email`)).json.data).toHaveLength(3);
    expect((await t.c.get(`${base(t)}?status=bogus`)).status).toBe(422);
  });

  it("shows a contact's consent history: what they saw, and when they asked, confirmed or left", async () => {
    const t = await populated();
    const id = (await t.c.get(`${base(t)}?email=a@example.com`)).json.data[0].id as string;
    await t.env.app.request(path(unsubUrl(t.mail, "a@example.com")), { method: "POST" });
    const r = await t.c.get(`${base(t)}/${id}`);
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ email: "a@example.com", emailStatus: "unsubscribed" });
    expect(r.json.data.consentEvents.map((e: { event: string }) => e.event)).toEqual(["requested", "confirmed", "revoked"]);
    expect(r.json.data.consentEvents[0].consentText).toBe(CONSENT);
    expect(JSON.stringify(r.json)).not.toContain("tokenHash");
    expect((await t.c.get(`${base(t)}/ctc_missing`)).status).toBe(404);
  });

  it("is tenant-isolated and role-gated: strangers get 404, viewers cannot read or erase, editors read but cannot erase", async () => {
    const t = await populated();
    const id = (await t.c.get(`${base(t)}?email=a@example.com`)).json.data[0].id as string;

    const stranger = await signup(t.env, "stranger@example.com");
    expect((await stranger.c.get(base(t))).status).toBe(404);
    expect((await stranger.c.get(`${base(t)}/${id}`)).status).toBe(404);
    expect((await stranger.c.del(`${base(t)}/${id}`)).status).toBe(404);

    const member = async (email: string, role: "viewer" | "editor") => {
      const u = await signup(t.env, email);
      await t.env.deps.db.insert(schema.memberships).values({ id: `m_${role}`, organizationId: t.orgId, userId: u.userId, role, createdAt: "t" });
      return u;
    };
    const viewer = await member("viewer@example.com", "viewer");
    expect((await viewer.c.get(base(t))).status).toBe(403);
    expect((await viewer.c.del(`${base(t)}/${id}`)).status).toBe(403);
    const editor = await member("editor@example.com", "editor");
    expect((await editor.c.get(base(t))).status).toBe(200);
    expect((await editor.c.del(`${base(t)}/${id}`)).status).toBe(403);
    expect(await rows(t.env)).toHaveLength(4); // nothing was deleted by any of the above

    expect((await new Client(t.env).get(base(t))).status).toBe(401);
  });

  it("exports only current subscribers as safe CSV, for admins, audited, tenant-isolated", async () => {
    const t = await populated();
    for (const e of ["=1+1@example.com", "a,b@example.com"]) { await confirmed(t, e); t.env.clock.t += MIN; }
    await subscribe(t, "gone@example.com"); await t.env.app.request(path(t.mail.link("gone@example.com")));
    await t.env.app.request(path(unsubUrl(t.mail, "gone@example.com")), { method: "POST" });

    const get = (client: Client, id = t.storeId) => t.env.app.request(`/api/v1/stores/${id}/contacts/export`, { headers: { origin: "http://localhost:3000", cookie: client.cookie } });
    const res = await get(t.c);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("subscribers.csv");
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000"); // the web app downloads it with fetch
    const lines = (await res.text()).split("\r\n");
    expect(lines[0]).toBe("email,first_name,subscribed_at,source");
    const emails = lines.slice(1).filter(Boolean).map((l) => l.startsWith('"') ? l.slice(1, l.indexOf('",')) : l.split(",")[0]);
    expect(emails).toEqual(["a@example.com", "b@example.com", "c@example.com", "'=1+1@example.com", "a,b@example.com"]); // no pending d@, no opted-out gone@; the formula is defused
    expect(lines.some((l) => l.startsWith('"a,b@example.com",'))).toBe(true); // quoted, so the comma stays inside one cell
    expect(lines[1]).toMatch(/^a@example\.com,,2026-10-27T.*,form:/); // no first name was given

    const audit = await t.env.deps.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.storeId, t.storeId), eq(schema.auditLogs.action, "contacts.exported")));
    expect(audit).toHaveLength(1);

    const editor = await signup(t.env, "editor@example.com");
    await t.env.deps.db.insert(schema.memberships).values({ id: "m_ed", organizationId: t.orgId, userId: editor.userId, role: "editor", createdAt: "t" });
    expect((await get(editor.c)).status).toBe(403); // reading the list is an editor's job, taking a copy of it is an admin's
    expect((await get((await signup(t.env, "stranger@example.com")).c)).status).toBe(404);
    expect((await get(new Client(t.env))).status).toBe(401);
  });

  it("erasure removes the contact and its history, is audited without personal data, and keeps an opt-out's hashed suppression", async () => {
    const t = await populated();
    const id = (await t.c.get(`${base(t)}?email=a@example.com`)).json.data[0].id as string;
    await t.env.app.request(path(unsubUrl(t.mail, "a@example.com")), { method: "POST" });
    const eventsBefore = (await events(t.env)).length;

    expect((await t.c.del(`${base(t)}/${id}`)).status).toBe(204);
    expect((await t.c.get(`${base(t)}/${id}`)).status).toBe(404);
    expect((await t.c.del(`${base(t)}/${id}`)).status).toBe(404);
    expect((await rows(t.env)).map((c) => c.email)).not.toContain("a@example.com");
    expect((await events(t.env)).length).toBeLessThan(eventsBefore);
    expect((await events(t.env)).every((e) => e.contactId !== id)).toBe(true);

    expect(await t.env.deps.db.select().from(schema.suppressionRecords)).toHaveLength(1); // still cannot be re-subscribed
    t.env.clock.t += DAY;
    const sent = t.mail.sent.length;
    await subscribe(t, "a@example.com");
    expect(t.mail.sent.length).toBe(sent);

    const audit = await t.env.deps.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.storeId, t.storeId), eq(schema.auditLogs.action, "contact.erased")));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("a@example.com");
  });

  it("deleting a store's data removes its contacts and consent history", async () => {
    const t = await populated();
    expect((await events(t.env)).length).toBeGreaterThan(0);
    await purgeStoreData(t.env.deps, t.storeId);
    expect(await rows(t.env)).toHaveLength(0);
    expect(await events(t.env)).toHaveLength(0);
  });
});

describe("retention", () => {
  it("drops unconfirmed contacts after 7 days and opted-out ones after 30, keeps subscribers and the hashed suppression", async () => {
    const t = await shop();
    await confirmed(t, "keep@example.com");
    await subscribe(t, "pending@example.com");
    await confirmed(t, "gone@example.com");
    await t.env.app.request(path(unsubUrl(t.mail, "gone@example.com")), { method: "POST" });

    expect(await purgeContacts(t.env.deps)).toBe(0); // nothing is old yet
    t.env.clock.t += 8 * DAY; // day 8: only the never-confirmed sign-up goes
    expect(await purgeContacts(t.env.deps)).toBe(1);
    expect((await rows(t.env)).map((c) => c.email).sort()).toEqual(["gone@example.com", "keep@example.com"]);
    t.env.clock.t += 23 * DAY; // day 31: the opted-out contact goes, the subscriber stays
    expect(await purgeContacts(t.env.deps)).toBe(1);
    expect((await rows(t.env)).map((c) => c.email)).toEqual(["keep@example.com"]);
    t.env.clock.t += 365 * DAY;
    expect(await purgeContacts(t.env.deps)).toBe(0); // a subscriber is never purged for age
    expect(await t.env.deps.db.select().from(schema.suppressionRecords)).toHaveLength(1);
  });
});
