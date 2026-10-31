import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { FakePhoneVerifier, FakeProvider } from "@convertflow/integrations";
import { Client, KEY, MailBox, makeEnv, setPlan, signup, validConfig, type Env } from "./helpers.js";
import { OPT_IN_COOLDOWN_MS, SMS_CONFIRM_WINDOW_MS } from "../src/services/contacts.js";
import { recordUsage } from "../src/services/entitlements.js";

const secrets = { credentialKey: KEY, webOrigin: "https://app.example.com", apiOrigin: "https://api.example.com" };
const CONSENT = "I agree to receive recurring marketing texts from Shop at this number. Msg & data rates may apply. Reply STOP to opt out.";
const smsForm = { collect: { phone: true }, consentText: CONSENT, privacyUrl: "https://shop.example.com/privacy" };
const PHONE = "+14155550123";
const MIN = 60_000;

/** A store on Growth with a published SMS form, Klaviyo connected (a recording fake) and a fake Twilio Verify. */
async function shop(o: { plan?: "free" | "starter" | "growth" | "scale"; formOver?: Record<string, unknown>; email?: string } = {}) {
  const mail = new MailBox();
  const verifier = new FakePhoneVerifier();
  const env = await makeEnv(undefined, { email: mail, secrets, phoneVerifier: verifier });
  const klaviyo = new FakeProvider("klaviyo");
  env.deps.providers = { klaviyo, mailchimp: new FakeProvider("mailchimp") };
  const owner = o.email ?? "owner@example.com";
  const u = await signup(env, owner);
  await new Client(env).post("/api/v1/auth/verify-email", { token: mail.token(owner) });
  await setPlan(env, u.orgId, "growth");
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Ember & Oak", domain: "shop.example.com", currency: "USD" });
  const storeId = s.json.data.id as string;
  await u.c.patch(`/api/v1/stores/${storeId}/settings`, { maxDiscountPercent: 30 });
  const publish = async (cfg: Record<string, unknown>) => {
    const created = await u.c.post(`/api/v1/stores/${storeId}/campaigns`, cfg);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const pub = await u.c.post(`/api/v1/stores/${storeId}/campaigns/${created.json.data.id}/publish`, { approve: true, approvedUpdatedAt: created.json.data.updatedAt });
    expect(pub.status, JSON.stringify(pub.json)).toBe(200);
    return created.json.data.id as string;
  };
  const formId = await publish(validConfig({ tool: "sms", format: "popup", form: { ...smsForm, ...o.formOver }, goal: { type: "subscribe" } }));
  await setPlan(env, u.orgId, o.plan ?? "growth");
  return { env, mail, verifier, klaviyo, ...u, storeId, formId, publish, siteKey: s.json.data.siteKey as string };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const post = (env: Env, path: string, body: unknown, ip = "1.2.3.4") =>
  env.app.request(path, { method: "POST", headers: { "content-type": "text/plain", "cf-connecting-ip": ip }, body: JSON.stringify(body) });
const start = (t: Shop, phone = PHONE, extra: Record<string, unknown> = {}) =>
  post(t.env, "/api/v1/notifications/sms/subscribe", { siteId: t.siteKey, campaignId: t.formId, phone, consent: true, ...extra });
const confirm = (t: Shop, code: string, phone = PHONE, extra: Record<string, unknown> = {}, ip?: string) =>
  post(t.env, "/api/v1/notifications/sms/confirm", { siteId: t.siteKey, campaignId: t.formId, phone, code, ...extra }, ip);
const contact = async (env: Env, phone = PHONE) => (await env.deps.db.select().from(schema.contacts).where(eq(schema.contacts.phone, phone)))[0];
const events = (env: Env, contactId: string) => env.deps.db.select().from(schema.consentEvents).where(eq(schema.consentEvents.contactId, contactId));
const smsUsage = async (env: Env) => (await env.deps.db.select().from(schema.usageRecords)).find((r) => r.metric === "sms_verifications")?.count ?? 0;
async function klaviyoReady(t: Shop) {
  expect((await t.c.put(`/api/v1/stores/${t.storeId}/providers/klaviyo`, { apiKey: "pk_live_supersecretvalue123" })).status).toBe(200);
  expect((await t.c.put(`/api/v1/stores/${t.storeId}/providers/klaviyo`, { listId: "list_1" })).status).toBe(200);
}
async function subscribed(t: Shop, phone = PHONE) {
  expect((await start(t, phone)).status).toBe(202);
  const r = await confirm(t, t.verifier.codeFor(phone)!, phone);
  expect(r.status, await r.clone().text()).toBe(200);
  return r;
}

describe("SMS signup: request and verification", () => {
  it("texts a code in the store's name, records the live form's own wording as pending consent, and meters the verification", async () => {
    const t = await shop();
    const r = await start(t, "+1 (415) 555-0123", { firstName: "Ada" });
    expect(r.status).toBe(202);
    expect(t.verifier.sent).toEqual([{ phone: PHONE, friendlyName: "Ember & Oak" }]);
    const c = (await contact(t.env))!;
    expect(c).toMatchObject({ phone: PHONE, email: null, smsStatus: "pending", emailStatus: "none", firstName: null }); // the form does not ask for a name
    const [req] = await events(t.env, c.id);
    expect(req).toMatchObject({ channel: "sms", event: "requested", source: `form:${t.formId}`, consentText: CONSENT, privacyUrl: smsForm.privacyUrl });
    expect(req!.consentTextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await smsUsage(t.env)).toBe(1);
  });

  it("subscribes only with the right code, once, and copies the verified number to Klaviyo with SMS consent", async () => {
    const t = await shop();
    await klaviyoReady(t);
    await start(t);
    const wrong = await confirm(t, "000000");
    expect(wrong.status).toBe(422);
    expect((await wrong.json() as { error: { code: string } }).error.code).toBe("invalid_code");
    expect((await contact(t.env))!.smsStatus).toBe("pending");

    const code = t.verifier.codeFor(PHONE)!;
    const ok = await confirm(t, code);
    expect(ok.status).toBe(200);
    const c = (await contact(t.env))!;
    expect(c.smsStatus).toBe("subscribed");
    expect((await events(t.env, c.id)).map((e) => e.event)).toEqual(["requested", "confirmed"]);
    expect((await confirm(t, code)).status).toBe(422); // single use

    const subs = t.klaviyo.calls.filter((x) => x.op === "subscribe");
    expect(subs).toHaveLength(1);
    expect(subs[0]!.contact).toMatchObject({ channel: "sms", phone: PHONE, source: `form:${t.formId}` });
    expect(subs[0]!.contact!.email).toBeUndefined();
    const [job] = await t.env.deps.db.select().from(schema.providerSyncJobs);
    expect(job).toMatchObject({ channel: "sms", status: "synced", action: "subscribe" });
    const evt = await t.env.deps.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.type, "customer.subscribed"));
    expect(evt.map((e) => e.payload)).toEqual([{ contactId: c.id, channel: "sms" }]);
  });

  it("reveals the form's incentive only after the number is verified", async () => {
    const t = await shop();
    const promoForm = await t.publish(validConfig({ name: "Promo", tool: "sms", format: "slide_in", form: smsForm, goal: { type: "subscribe" }, promotion: { code: "TEXT10", percentOff: 10 } }));
    const req = await post(t.env, "/api/v1/notifications/sms/subscribe", { siteId: t.siteKey, campaignId: promoForm, phone: PHONE, consent: true });
    expect(await req.text()).not.toContain("TEXT10");
    const r = await confirm(t, t.verifier.codeFor(PHONE)!, PHONE, { campaignId: promoForm });
    expect(await r.json()).toEqual({ ok: true, incentive: { code: "TEXT10", percentOff: 10 } });
  });

  it("answers exactly the same, and texts nothing, whenever no code should go out", async () => {
    const t = await shop();
    await subscribed(t, "+14155550100");
    const otherTool = await t.publish(validConfig({ name: "Toast", tool: "toast", format: "toast", toast: {} }));
    const sent = () => t.verifier.sent.length;
    const before = sent();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["unknown site", { siteId: "cf_unknownsite00" }],
      ["unknown campaign", { campaignId: "cmp_nope" }],
      ["a campaign that is not an SMS form", { campaignId: otherTool }],
      ["already subscribed", { phone: "+14155550100" }],
    ];
    for (const [why, over] of cases) {
      const r = await post(t.env, "/api/v1/notifications/sms/subscribe", { siteId: t.siteKey, campaignId: t.formId, phone: PHONE, consent: true, ...over });
      expect(r.status, why).toBe(202);
      expect(await r.json(), why).toEqual({ ok: true });
    }
    expect(sent()).toBe(before);
    // Consent is a ticked box: without it the request is malformed, not quietly accepted.
    expect((await start(t, PHONE, { consent: false })).status).toBe(422);
  });

  it("collects nothing on a plan without SMS, or once the month's verifications are used up", async () => {
    const t = await shop({ plan: "starter" });
    expect((await start(t)).status).toBe(202);
    expect(t.verifier.sent).toHaveLength(0);
    expect(await contact(t.env)).toBeUndefined();

    await setPlan(t.env, t.orgId, "growth");
    await recordUsage(t.env.deps, t.orgId, "sms_verifications", 500);
    expect((await start(t)).status).toBe(202);
    expect(t.verifier.sent).toHaveLength(0);
    expect(await contact(t.env)).toBeUndefined();
  });

  it("reports a number the provider will not text, and lets the shopper retry at once", async () => {
    const t = await shop();
    expect((await start(t, "0415 555 0123")).status).toBe(422); // not E.164: never guessed into a country
    expect(t.verifier.sent).toHaveLength(0);
    t.verifier.failNext("rejected", "HTTP 400: Twilio error 60205");
    const r = await start(t);
    expect(r.status).toBe(422);
    expect((await r.json() as { error: { code: string } }).error.code).toBe("phone_undeliverable");
    const c = (await contact(t.env))!;
    expect((await events(t.env, c.id)).map((e) => e.event)).toEqual(["requested", "delivery_failed"]);
    expect(await smsUsage(t.env)).toBe(0); // nothing was delivered, so nothing is metered
    expect((await start(t)).status).toBe(202); // the failed send does not hold the shopper in the cooldown
    expect(t.verifier.codeFor(PHONE)).toBeDefined();
  });

  it("does not text the same number twice within the cooldown", async () => {
    const t = await shop();
    await start(t); await start(t);
    expect(t.verifier.sent).toHaveLength(1);
    t.env.clock.t += OPT_IN_COOLDOWN_MS + MIN;
    await start(t);
    expect(t.verifier.sent).toHaveLength(2);
  });

  it("only confirms a request made from the same live form, and only while it is recent", async () => {
    const t = await shop();
    const other = await t.publish(validConfig({ name: "Other", tool: "sms", format: "slide_in", form: smsForm, goal: { type: "subscribe" } }));
    await start(t);
    const code = t.verifier.codeFor(PHONE)!;
    expect((await confirm(t, code, PHONE, { campaignId: other })).status).toBe(422);
    t.env.clock.t += SMS_CONFIRM_WINDOW_MS + MIN;
    expect((await confirm(t, code)).status).toBe(422);
    expect((await contact(t.env))!.smsStatus).toBe("pending");
  });

  it("limits code guesses per number, and says so when the provider cannot check right now", async () => {
    const t = await shop();
    await start(t);
    t.verifier.failNext("transient");
    expect((await confirm(t, "111111")).status).toBe(503);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await confirm(t, "111111", PHONE, {}, `9.9.9.${i}`)).status; // a new address each time: the per-number limit still applies
    expect(last).toBe(429);
  });

  it("a paused form stops collecting immediately", async () => {
    const t = await shop();
    await start(t);
    const code = t.verifier.codeFor(PHONE)!;
    expect((await t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${t.formId}/pause`)).status).toBe(204);
    expect((await confirm(t, code)).status).toBe(422);
    expect((await start(t, "+14155550199")).status).toBe(202);
    expect(t.verifier.sent).toHaveLength(1);
  });
});

describe("SMS opt-out, erasure and export", () => {
  it("records a merchant-entered opt-out: unsubscribed, suppressed, removed from Klaviyo, never re-subscribed by the form", async () => {
    const t = await shop();
    await klaviyoReady(t);
    await subscribed(t);
    const c = (await contact(t.env))!;
    const r = await t.c.post(`/api/v1/stores/${t.storeId}/contacts/${c.id}/opt-out`, { channel: "sms" });
    expect(r.status).toBe(204);
    expect((await contact(t.env))!.smsStatus).toBe("unsubscribed");
    expect(t.klaviyo.calls.filter((x) => x.op === "unsubscribe").map((x) => x.contact?.phone)).toEqual([PHONE]);
    const sup = await t.env.deps.db.select().from(schema.suppressionRecords).where(and(eq(schema.suppressionRecords.storeId, t.storeId), eq(schema.suppressionRecords.channel, "sms")));
    expect(sup).toHaveLength(1);
    expect(JSON.stringify(sup)).not.toContain("4155550123"); // only a hash is kept
    const audit = await t.env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "contact.opted_out"));
    expect(audit).toHaveLength(1);

    t.env.clock.t += OPT_IN_COOLDOWN_MS + MIN;
    expect((await start(t)).status).toBe(202);
    expect(t.verifier.sent).toHaveLength(1); // the suppressed number is never texted again
  });

  it("only admins of the store's own workspace can opt someone out", async () => {
    const t = await shop();
    await subscribed(t);
    const c = (await contact(t.env))!;
    const outsider = await signup(t.env, "outsider@example.com");
    expect((await outsider.c.post(`/api/v1/stores/${t.storeId}/contacts/${c.id}/opt-out`, { channel: "sms" })).status).toBe(404);
    const other = await shop({ email: "other@example.com" });
    expect((await other.c.post(`/api/v1/stores/${other.storeId}/contacts/${c.id}/opt-out`, { channel: "sms" })).status).toBe(404); // another store's contact id
    expect((await contact(t.env))!.smsStatus).toBe("subscribed");
  });

  it("erasing an SMS subscriber removes their Klaviyo copy first", async () => {
    const t = await shop();
    await klaviyoReady(t);
    await subscribed(t);
    const c = (await contact(t.env))!;
    expect((await t.c.del(`/api/v1/stores/${t.storeId}/contacts/${c.id}`)).status).toBe(204);
    expect(await contact(t.env)).toBeUndefined();
    expect(t.klaviyo.calls.filter((x) => x.op === "unsubscribe").map((x) => x.contact)).toEqual([expect.objectContaining({ channel: "sms", phone: PHONE, source: "erasure" })]);
  });

  it("exports verified SMS subscribers only, by channel", async () => {
    const t = await shop();
    await subscribed(t);
    await start(t, "+14155550177"); // pending: never exported
    const res = await t.env.app.request(`/api/v1/stores/${t.storeId}/contacts/export?channel=sms`, { headers: { origin: "http://localhost:3000", cookie: t.c.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("sms-subscribers.csv");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("phone,first_name,subscribed_at,source");
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual([PHONE]);
    const email = await t.env.app.request(`/api/v1/stores/${t.storeId}/contacts/export`, { headers: { origin: "http://localhost:3000", cookie: t.c.cookie } });
    expect((await email.text()).trim().split("\r\n")).toEqual(["email,first_name,subscribed_at,source"]);
  });

  it("a backfill copies existing SMS subscribers when Klaviyo is connected later", async () => {
    const t = await shop();
    await subscribed(t);
    expect((await t.c.put(`/api/v1/stores/${t.storeId}/providers/klaviyo`, { apiKey: "pk_live_supersecretvalue123" })).status).toBe(200);
    const r = await t.c.put(`/api/v1/stores/${t.storeId}/providers/klaviyo`, { listId: "list_1", syncExisting: true });
    expect(r.json.data.queued).toBe(1);
    expect(t.klaviyo.calls.filter((x) => x.op === "subscribe").map((x) => x.contact?.channel)).toEqual(["sms"]);
  });
});

describe("SMS form analytics", () => {
  it("counts codes sent and verified numbers on the server, per form", async () => {
    const t = await shop();
    await subscribed(t);
    await start(t, "+14155550188");
    const r = await t.c.get(`/api/v1/stores/${t.storeId}/analytics/tools?from=2026-10-01&to=2026-10-31`);
    expect(r.status).toBe(200);
    const sms = (r.json.data.tools as { tool: string; metrics: Record<string, number | null>; byCampaign: ({ campaignId: string } & Record<string, unknown>)[] }[]).find((x) => x.tool === "sms")!;
    expect(sms.metrics).toMatchObject({ requested: 2, confirmed: 1, confirmRate: 0.5 });
    expect(sms.byCampaign.find((c) => c.campaignId === t.formId)).toMatchObject({ requested: 2, confirmed: 1 });
  });
});
