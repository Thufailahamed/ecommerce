import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { totpAt } from "../src/lib/totp.js";
import { Client, KEY, MailBox, makeEnv, signup, validConfig } from "./helpers.js";

const WEB = "https://app.example.com";
const secrets = { credentialKey: KEY, webOrigin: WEB, apiOrigin: "https://api.example.com" };
const PW = "correct-horse-battery";
const mailEnv = async () => { const mail = new MailBox(); return { mail, env: await makeEnv(undefined, { email: mail, secrets }) }; };

describe("password reset", () => {
  it("fails closed when email is not configured", async () => {
    const env = await makeEnv();
    expect((await new Client(env).post("/api/v1/auth/forgot-password", { email: "a@example.com" })).status).toBe(503);
  });
  it("answers identically for unknown accounts and sends nothing", async () => {
    const { env, mail } = await mailEnv();
    await signup(env, "real@example.com");
    mail.sent.length = 0;
    const a = await new Client(env).post("/api/v1/auth/forgot-password", { email: "nobody@example.com" });
    const b = await new Client(env).post("/api/v1/auth/forgot-password", { email: "real@example.com" });
    expect([a.status, a.json]).toEqual([b.status, b.json]);
    expect(mail.sent.map((m) => m.to)).toEqual(["real@example.com"]);
  });
  it("resets once, signs out every device, and rejects reuse, expiry and weak passwords", async () => {
    const { env, mail } = await mailEnv();
    const u = await signup(env, "u@example.com");
    const other = new Client(env);
    await other.post("/api/v1/auth/login", { email: "u@example.com", password: PW });
    mail.sent.length = 0;
    await new Client(env).post("/api/v1/auth/forgot-password", { email: "u@example.com" });
    expect(mail.last("u@example.com")?.subject).toMatch(/Reset/);
    const token = mail.token("u@example.com");
    expect(mail.link()).toContain(`${WEB}/reset-password`);

    const c = new Client(env);
    expect((await c.post("/api/v1/auth/reset-password", { token, password: "short" })).status).toBe(422);
    expect((await c.post("/api/v1/auth/reset-password", { token: "x".repeat(30), password: "a-brand-new-password" })).status).toBe(400);
    expect((await c.post("/api/v1/auth/reset-password", { token, password: "a-brand-new-password" })).status).toBe(200);
    expect((await c.post("/api/v1/auth/reset-password", { token, password: "another-new-password" })).status).toBe(400); // single use
    expect((await u.c.get("/api/v1/auth/me")).status).toBe(401);
    expect((await other.get("/api/v1/auth/me")).status).toBe(401);
    expect((await new Client(env).post("/api/v1/auth/login", { email: "u@example.com", password: PW })).status).toBe(401);
    expect((await new Client(env).post("/api/v1/auth/login", { email: "u@example.com", password: "a-brand-new-password" })).status).toBe(200);
  });
  it("expires after an hour and enforces a cooldown between requests", async () => {
    const { env, mail } = await mailEnv();
    await signup(env, "u@example.com");
    mail.sent.length = 0;
    const c = new Client(env);
    await c.post("/api/v1/auth/forgot-password", { email: "u@example.com" });
    await c.post("/api/v1/auth/forgot-password", { email: "u@example.com" });
    expect(mail.sent).toHaveLength(1); // second request within 60 s is ignored
    const token = mail.token();
    env.clock.t += 61 * 60_000;
    expect((await c.post("/api/v1/auth/reset-password", { token, password: "a-brand-new-password" })).status).toBe(400);
  });
  it("a concurrent double-submit of one token only succeeds once", async () => {
    const { env, mail } = await mailEnv();
    await signup(env, "u@example.com");
    mail.sent.length = 0;
    await new Client(env).post("/api/v1/auth/forgot-password", { email: "u@example.com" });
    const token = mail.token();
    const rs = await Promise.all([1, 2, 3].map((i) => new Client(env).post("/api/v1/auth/reset-password", { token, password: `winner-password-${i}` })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
  });
  it("survives a mail provider outage without leaking whether the account exists", async () => {
    const { env, mail } = await mailEnv();
    await signup(env, "u@example.com");
    mail.failNext = true;
    expect((await new Client(env).post("/api/v1/auth/forgot-password", { email: "u@example.com" })).status).toBe(202);
  });
});

describe("email verification", () => {
  it("blocks publishing and AI until verified, once email delivery exists", async () => {
    const { env, mail } = await mailEnv();
    const u = await signup(env, "v@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "S", domain: "shop.example.com", currency: "USD" });
    const sid = s.json.data.id as string;
    const c = await u.c.post(`/api/v1/stores/${sid}/campaigns`, validConfig());
    const pub = () => u.c.post(`/api/v1/stores/${sid}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    const blocked = await pub();
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.code).toBe("email_unverified");
    expect((await u.c.get("/api/v1/auth/security")).json.data.emailVerified).toBe(false);

    expect((await new Client(env).post("/api/v1/auth/verify-email", { token: mail.token("v@example.com") })).status).toBe(200);
    expect((await pub()).status).toBe(200);
    expect((await u.c.get("/api/v1/auth/security")).json.data.emailVerified).toBe(true);
  });
  it("can be resent, and the old link stops working", async () => {
    const { env, mail } = await mailEnv();
    const u = await signup(env, "v@example.com");
    const first = mail.token("v@example.com");
    mail.sent.length = 0;
    expect((await u.c.post("/api/v1/auth/resend-verification")).status).toBe(202);
    expect(mail.token("v@example.com")).not.toBe(first);
    expect((await new Client(env).post("/api/v1/auth/verify-email", { token: first })).status).toBe(400);
  });
  it("is not enforced (and cannot be satisfied) on a deployment without email", async () => {
    const env = await makeEnv();
    const u = await signup(env, "v@example.com");
    expect((await u.c.get("/api/v1/auth/security")).json.data).toMatchObject({ emailConfigured: false });
  });
});

describe("two-factor authentication (TOTP)", () => {
  const enrol = async (env: Awaited<ReturnType<typeof makeEnv>>, c: Client) => {
    const start = await c.post("/api/v1/auth/mfa/start");
    const secret = start.json.data.secret as string;
    const confirm = await c.post("/api/v1/auth/mfa/confirm", { code: await totpAt(secret, env.clock.t) });
    return { secret, codes: confirm.json.data.recoveryCodes as string[], start, confirm };
  };

  it("needs the encryption key (fails closed)", async () => {
    const env = await makeEnv();
    const u = await signup(env, "m@example.com");
    expect((await u.c.post("/api/v1/auth/mfa/start")).status).toBe(503);
  });
  it("enrols, then login requires a valid second factor", async () => {
    const { env } = await mailEnv();
    const u = await signup(env, "m@example.com");
    const { secret, codes, start } = await enrol(env, u.c);
    expect(start.json.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(codes).toHaveLength(8);
    const [row] = await env.deps.db.select().from(schema.users).where(eq(schema.users.email, "m@example.com"));
    expect(row?.mfaSecretEnc).not.toContain(secret); // encrypted at rest
    expect(JSON.stringify(row?.recoveryHashes)).not.toContain(codes[0]!.replace("-", ""));

    const login = (code?: string) => new Client(env).post("/api/v1/auth/login", { email: "m@example.com", password: PW, ...(code ? { code } : {}) });
    expect((await login()).json.error.code).toBe("mfa_required");
    expect((await login("000000")).json.error.code).toBe("invalid_code");
    expect((await login(await totpAt(secret, env.clock.t))).status).toBe(200);
  });
  it("does not reveal that MFA is on until the password is right", async () => {
    const { env } = await mailEnv();
    const u = await signup(env, "m@example.com");
    await enrol(env, u.c);
    const r = await new Client(env).post("/api/v1/auth/login", { email: "m@example.com", password: "wrong-password-1" });
    expect(r.json.error.code).toBe("invalid_credentials");
  });
  it("rejects a wrong confirmation code and cannot be started twice", async () => {
    const { env } = await mailEnv();
    const u = await signup(env, "m@example.com");
    await u.c.post("/api/v1/auth/mfa/start");
    expect((await u.c.post("/api/v1/auth/mfa/confirm", { code: "123456" })).status).toBe(400);
    expect((await u.c.post("/api/v1/auth/mfa/confirm", { code: "12ab56" })).status).toBe(422);
    const { start } = await enrol(env, u.c);
    void start;
    expect((await u.c.post("/api/v1/auth/mfa/start")).status).toBe(409);
  });
  it("recovery codes work exactly once", async () => {
    const { env } = await mailEnv();
    const u = await signup(env, "m@example.com");
    const { codes } = await enrol(env, u.c);
    const login = (code: string) => new Client(env).post("/api/v1/auth/login", { email: "m@example.com", password: PW, code });
    expect((await login(codes[0]!)).status).toBe(200);
    expect((await login(codes[0]!)).status).toBe(401);
    expect((await login(codes[1]!.toLowerCase().replace("-", " "))).status).toBe(200); // forgiving format
    expect((await u.c.get("/api/v1/auth/security")).json.data.recoveryCodesLeft).toBe(6);
  });
  it("enabling keeps this session but signs out the others", async () => {
    const { env } = await mailEnv();
    const u = await signup(env, "m@example.com");
    const other = new Client(env);
    await other.post("/api/v1/auth/login", { email: "m@example.com", password: PW });
    await enrol(env, u.c);
    expect((await u.c.get("/api/v1/auth/me")).status).toBe(200);
    expect((await other.get("/api/v1/auth/me")).status).toBe(401);
  });
  it("disabling needs password and a current code", async () => {
    const { env } = await mailEnv();
    const u = await signup(env, "m@example.com");
    const { secret } = await enrol(env, u.c);
    const code = await totpAt(secret, env.clock.t);
    expect((await u.c.post("/api/v1/auth/mfa/disable", { password: "wrong-password-1", code })).status).toBe(403);
    expect((await u.c.post("/api/v1/auth/mfa/disable", { password: PW, code: "000000" })).status).toBe(401);
    expect((await u.c.post("/api/v1/auth/mfa/disable", { password: PW, code })).status).toBe(204);
    expect((await new Client(env).post("/api/v1/auth/login", { email: "m@example.com", password: PW })).status).toBe(200);
  });
});

describe("team", () => {
  const setup = async () => {
    const { env, mail } = await mailEnv();
    const owner = await signup(env, "owner@example.com");
    const verify = async (email: string) => new Client(env).post("/api/v1/auth/verify-email", { token: mail.token(email) });
    await verify("owner@example.com");
    return { env, mail, owner, verify };
  };

  it("invites by email, binds acceptance to the invited address, and grants the role", async () => {
    const { env, mail, owner } = await setup();
    const inv = await owner.c.post(`/api/v1/organizations/${owner.orgId}/invites`, { email: "Editor@Example.com", role: "editor" });
    expect(inv.status).toBe(201);
    expect(inv.json.data).toMatchObject({ email: "editor@example.com", role: "editor", emailed: true });
    expect(mail.last("editor@example.com")?.subject).toMatch(/invited/);
    const token = mail.tokenOf("editor@example.com", /invited|Join/);
    expect(inv.json.data.inviteUrl).toContain(token);

    const stranger = await signup(env, "stranger@example.com");
    const wrong = await stranger.c.post("/api/v1/invitations/accept", { token });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error.code).toBe("wrong_account");

    const ed = await signup(env, "editor@example.com");
    const ok = await ed.c.post("/api/v1/invitations/accept", { token });
    expect(ok.json.data).toMatchObject({ organizationId: owner.orgId, role: "editor" });
    expect((await ed.c.post("/api/v1/invitations/accept", { token })).status).toBe(400); // used
    const team = (await owner.c.get(`/api/v1/organizations/${owner.orgId}/team`)).json.data;
    expect(team.members.map((m: { email: string; role: string }) => `${m.email}:${m.role}`).sort()).toEqual(["editor@example.com:editor", "owner@example.com:owner"]);
    expect(team.invites).toHaveLength(0);
  });
  it("the new member can use the workspace within their role", async () => {
    const { env, mail, owner } = await setup();
    const s = await owner.c.post("/api/v1/stores", { organizationId: owner.orgId, platform: "custom", name: "S", domain: "shop.example.com", currency: "USD" });
    await owner.c.post(`/api/v1/organizations/${owner.orgId}/invites`, { email: "v@example.com", role: "viewer" });
    const v = await signup(env, "v@example.com");
    await v.c.post("/api/v1/invitations/accept", { token: mail.tokenOf("v@example.com", /invited|Join/) });
    expect((await v.c.get(`/api/v1/stores/${s.json.data.id}/campaigns`)).status).toBe(200);
    expect((await v.c.post(`/api/v1/stores/${s.json.data.id}/campaigns`, validConfig())).status).toBe(403);
  });
  it("enforces who may invite whom", async () => {
    const { env, mail, owner } = await setup();
    const url = `/api/v1/organizations/${owner.orgId}/invites`;
    await owner.c.post(url, { email: "admin@example.com", role: "admin" });
    const admin = await signup(env, "admin@example.com");
    await admin.c.post("/api/v1/invitations/accept", { token: mail.tokenOf("admin@example.com", /invited|Join/) });
    // admins may invite editors/viewers, but not admins
    const adminVerifyToken = (await env.deps.db.select().from(schema.users).where(eq(schema.users.email, "admin@example.com")))[0]!;
    await env.deps.db.update(schema.users).set({ emailVerifiedAt: "x" }).where(eq(schema.users.id, adminVerifyToken.id));
    expect((await admin.c.post(url, { email: "e2@example.com", role: "editor" })).status).toBe(201);
    expect((await admin.c.post(url, { email: "a2@example.com", role: "admin" })).status).toBe(403);
    expect((await admin.c.post(url, { email: "owner@example.com", role: "viewer" })).status).toBe(409); // already a member
    const outsider = await signup(env, "out@example.com");
    expect((await outsider.c.post(url, { email: "x@example.com", role: "viewer" })).status).toBe(404);
  });
  it("rejects expired and revoked invitations, and re-inviting replaces the old link", async () => {
    const { env, mail, owner } = await setup();
    const url = `/api/v1/organizations/${owner.orgId}/invites`;
    await owner.c.post(url, { email: "late@example.com", role: "viewer" });
    const old = mail.tokenOf("late@example.com", /invited|Join/);
    await owner.c.post(url, { email: "late@example.com", role: "editor" });
    const fresh = mail.tokenOf("late@example.com", /invited|Join/);
    expect(fresh).not.toBe(old);
    const late = await signup(env, "late@example.com");
    expect((await late.c.post("/api/v1/invitations/accept", { token: old })).status).toBe(400);
    env.clock.t += 8 * 86_400_000;
    expect((await late.c.post("/api/v1/invitations/accept", { token: fresh })).status).toBe(400);

    env.clock.t -= 8 * 86_400_000;
    await owner.c.post(url, { email: "gone@example.com", role: "viewer" });
    const list = (await owner.c.get(`/api/v1/organizations/${owner.orgId}/team`)).json.data.invites as { id: string; email: string }[];
    await owner.c.del(`${url}/${list.find((i) => i.email === "gone@example.com")!.id}`);
    const gone = await signup(env, "gone@example.com");
    expect((await gone.c.post("/api/v1/invitations/accept", { token: mail.tokenOf("gone@example.com", /invited|Join/) })).status).toBe(400);
  });
  it("only the owner changes roles; the owner cannot be demoted or removed; anyone can leave", async () => {
    const { env, mail, owner } = await setup();
    await owner.c.post(`/api/v1/organizations/${owner.orgId}/invites`, { email: "m@example.com", role: "viewer" });
    const m = await signup(env, "m@example.com");
    await m.c.post("/api/v1/invitations/accept", { token: mail.tokenOf("m@example.com", /invited|Join/) });
    const base = `/api/v1/organizations/${owner.orgId}/members`;
    expect((await m.c.patch(`${base}/${m.userId}`, { role: "admin" })).status).toBe(403); // cannot self-promote
    expect((await owner.c.patch(`${base}/${m.userId}`, { role: "editor" })).status).toBe(204);
    expect((await owner.c.patch(`${base}/${owner.userId}`, { role: "viewer" })).status).toBe(409);
    expect((await owner.c.del(`${base}/${owner.userId}`)).status).toBe(409);
    expect((await m.c.del(`${base}/${owner.userId}`)).status).toBe(409);
    expect((await m.c.del(`${base}/${m.userId}`)).status).toBe(204); // leave
    expect((await m.c.get(`/api/v1/organizations/${owner.orgId}/team`)).status).toBe(404); // access gone immediately
  });
  it("without email, the inviter still receives a shareable link", async () => {
    const env = await makeEnv(undefined, { secrets: { webOrigin: WEB } });
    const owner = await signup(env, "owner@example.com");
    const r = await owner.c.post(`/api/v1/organizations/${owner.orgId}/invites`, { email: "x@example.com", role: "viewer" });
    expect(r.json.data.emailed).toBe(false);
    expect(r.json.data.inviteUrl).toContain(`${WEB}/invite?token=`);
  });
});

describe("workspaces", () => {
  it("creates additional workspaces with their own plan, capped per user", async () => {
    const env = await makeEnv();
    const u = await signup(env, "agency@example.com");
    const made = await u.c.post("/api/v1/organizations", { name: "Client A" });
    expect(made.status).toBe(201);
    const me = (await u.c.get("/api/v1/auth/me")).json.data.organizations as { id: string; role: string }[];
    expect(me).toHaveLength(2);
    expect(me.every((o) => o.role === "owner")).toBe(true);
    const st = await u.c.post("/api/v1/stores", { organizationId: made.json.data.id, platform: "custom", name: "A", domain: "a.example.com", currency: "USD" });
    expect(st.status).toBe(201);
    for (let i = 0; i < 3; i++) expect((await u.c.post("/api/v1/organizations", { name: `W${i}` })).status).toBe(201);
    expect((await u.c.post("/api/v1/organizations", { name: "one too many" })).status).toBe(402);
    expect((await u.c.post("/api/v1/organizations", { name: "x" })).status).toBe(422);
  });
});

describe("billing portal", () => {
  const sec = { ...secrets, stripeSecretKey: "sk_test", stripeWebhookSecret: "whsec", stripePrices: { starter: "price_s" } };
  it("needs a Stripe customer, the owner role, and a configured provider", async () => {
    let seen = "";
    const fetchFn = (async (url: string, init: RequestInit) => { seen = `${url} ${String(init.body)}`; return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session_1" })); }) as unknown as typeof fetch;
    const env = await makeEnv(undefined, { secrets: sec, fetchFn });
    const u = await signup(env, "o@example.com");
    expect((await u.c.post("/api/v1/billing/portal", { organizationId: u.orgId })).status).toBe(409); // never subscribed
    await env.deps.db.update(schema.subscriptions).set({ customerRef: "cus_123", plan: "starter" }).where(eq(schema.subscriptions.organizationId, u.orgId));
    const r = await u.c.post("/api/v1/billing/portal", { organizationId: u.orgId });
    expect(r.json.data.url).toBe("https://billing.stripe.com/p/session_1");
    expect(seen).toContain("billing_portal/sessions");
    expect(seen).toContain("customer=cus_123");
    expect(seen).toContain(encodeURIComponent(`${WEB}/app/settings`));

    const other = await signup(env, "x@example.com");
    expect((await other.c.post("/api/v1/billing/portal", { organizationId: u.orgId })).status).toBe(404);
    const bare = await makeEnv();
    const b = await signup(bare, "b@example.com");
    expect((await b.c.post("/api/v1/billing/portal", { organizationId: b.orgId })).status).toBe(503);
  });
  it("captures the Stripe customer id from webhooks", async () => {
    const env = await makeEnv(undefined, { secrets: sec });
    const u = await signup(env, "o@example.com");
    const raw = JSON.stringify({ id: "e1", type: "checkout.session.completed", data: { object: { client_reference_id: u.orgId, subscription: "sub_1", customer: "cus_9", metadata: { plan: "starter" } } } });
    const t = Math.floor(env.clock.t / 1000);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`))), (b) => b.toString(16).padStart(2, "0")).join("");
    await env.app.request("/api/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: raw });
    const [s] = await env.deps.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, u.orgId));
    expect(s?.customerRef).toBe("cus_9");
  });
});
