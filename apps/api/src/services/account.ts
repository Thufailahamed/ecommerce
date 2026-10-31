import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { decrypt, encrypt } from "../lib/aes.js";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "../lib/crypto.js";
import { generateSecret, otpauthUrl, verifyTotp } from "../lib/totp.js";
import { HttpError, type Deps } from "../deps.js";
import { emailEnabled, requireEmail, templates } from "./email.js";
import { recordAudit } from "./audit.js";

const { users, authTokens, sessions } = schema;
const HOUR = 3_600_000;

function link(d: Deps, path: string, token: string): string {
  const origin = d.secrets?.webOrigin;
  if (!origin) throw new HttpError(503, "not_configured", "Web origin is not configured");
  return `${origin}${path}?token=${encodeURIComponent(token)}`;
}

async function issueToken(d: Deps, userId: string, type: "password_reset" | "email_verify", ttlMs: number) {
  const token = randomToken(32);
  const now = d.now();
  await d.db.insert(authTokens).values({ id: await sha256Hex(token), userId, type, expiresAt: new Date(now.getTime() + ttlMs).toISOString(), createdAt: now.toISOString() });
  return token;
}

/** Atomically marks a token used. Two concurrent requests with the same token cannot both succeed. */
async function consumeToken(d: Deps, token: string, type: "password_reset" | "email_verify"): Promise<string> {
  const id = await sha256Hex(token);
  const nowIso = d.now().toISOString();
  const won = await d.db.update(authTokens).set({ usedAt: nowIso })
    .where(and(eq(authTokens.id, id), eq(authTokens.type, type), isNull(authTokens.usedAt), gt(authTokens.expiresAt, nowIso)))
    .returning({ userId: authTokens.userId });
  if (!won[0]) throw new HttpError(400, "invalid_token", "This link is invalid or has expired");
  return won[0].userId;
}

/* ---------- password reset ---------- */

/** Always resolves the same way whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(d: Deps, emailIn: string): Promise<void> {
  const mail = requireEmail(d);
  const email = emailIn.trim().toLowerCase();
  const [u] = await d.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) return;
  const [recent] = await d.db.select().from(authTokens)
    .where(and(eq(authTokens.userId, u.id), eq(authTokens.type, "password_reset"), gt(authTokens.createdAt, new Date(d.now().getTime() - 60_000).toISOString()))).limit(1);
  if (recent) return; // 60 s cooldown per account
  await d.db.delete(authTokens).where(and(eq(authTokens.userId, u.id), eq(authTokens.type, "password_reset")));
  const token = await issueToken(d, u.id, "password_reset", HOUR);
  try { await mail.send(templates.passwordReset(u.email, link(d, "/reset-password", token))); }
  catch (e) { console.error(JSON.stringify({ level: "error", where: "password_reset_email", message: e instanceof Error ? e.message : "send failed" })); }
}

export async function resetPassword(d: Deps, token: string, newPassword: string): Promise<void> {
  const userId = await consumeToken(d, token, "password_reset");
  await d.db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, userId));
  await d.db.delete(sessions).where(eq(sessions.userId, userId)); // every device signs out
  await d.db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.type, "password_reset")));
  await recordAudit(d, { action: "account.password_reset", actorId: userId, targetType: "user", targetId: userId });
}

/* ---------- email verification ---------- */

export async function sendVerification(d: Deps, userId: string): Promise<void> {
  const mail = requireEmail(d);
  const [u] = await d.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.emailVerifiedAt) return;
  await d.db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.type, "email_verify"), isNull(authTokens.usedAt)));
  const token = await issueToken(d, userId, "email_verify", 24 * HOUR);
  await mail.send(templates.verifyEmail(u.email, link(d, "/verify-email", token)));
}

export async function verifyEmail(d: Deps, token: string): Promise<void> {
  const userId = await consumeToken(d, token, "email_verify");
  await d.db.update(users).set({ emailVerifiedAt: d.now().toISOString() }).where(eq(users.id, userId));
}

/** Only enforced when email delivery exists; a deployment without email cannot verify anyone. */
export async function requireVerifiedEmail(d: Deps, userId: string): Promise<void> {
  if (!emailEnabled(d)) return;
  const [u] = await d.db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.v) throw new HttpError(403, "email_unverified", "Confirm your email address first. Check your inbox for the link.");
}

/* ---------- MFA (TOTP) ---------- */

function keyOrThrow(d: Deps): string {
  const k = d.secrets?.credentialKey;
  if (!k) throw new HttpError(503, "not_configured", "MFA is unavailable: encryption key is not configured");
  return k;
}

const normRecovery = (c: string) => c.replace(/[\s-]/g, "").toUpperCase();

export async function startMfa(d: Deps, userId: string, email: string) {
  const key = keyOrThrow(d);
  const [u] = await d.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new HttpError(404, "not_found", "User not found");
  if (u.mfaEnabled) throw new HttpError(409, "mfa_enabled", "Two-factor authentication is already on");
  const secret = generateSecret();
  await d.db.update(users).set({ mfaSecretEnc: await encrypt(secret, key) }).where(eq(users.id, userId));
  return { secret, otpauthUrl: otpauthUrl(secret, email, "ConvertFlow AI") };
}

/** Signs out every device except the one making this change. */
async function revokeOtherSessions(d: Deps, userId: string, keepToken: string) {
  await d.db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, await sha256Hex(keepToken))));
}

export async function confirmMfa(d: Deps, userId: string, code: string, keepToken: string): Promise<string[]> {
  const key = keyOrThrow(d);
  const [u] = await d.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.mfaSecretEnc || u.mfaEnabled) throw new HttpError(409, "mfa_not_started", "Start setup first");
  if (!(await verifyTotp(await decrypt(u.mfaSecretEnc, key), code, d.now().getTime()))) throw new HttpError(400, "invalid_code", "That code is not correct. Check your authenticator app and try again.");
  const codes = Array.from({ length: 8 }, () => { const r = randomToken(8).replace(/[^A-Za-z0-9]/g, "").toUpperCase().padEnd(10, "A").slice(0, 10); return `${r.slice(0, 5)}-${r.slice(5)}`; });
  await d.db.update(users).set({ mfaEnabled: true, recoveryHashes: await Promise.all(codes.map((c) => sha256Hex(normRecovery(c)))) }).where(eq(users.id, userId));
  await revokeOtherSessions(d, userId, keepToken); // other devices must sign in again, now with the code
  return codes;
}

/** Accepts a current TOTP code or a single-use recovery code. */
export async function verifyLoginMfa(d: Deps, u: typeof users.$inferSelect, code: string | undefined): Promise<void> {
  if (!code) throw new HttpError(401, "mfa_required", "Enter the 6-digit code from your authenticator app");
  const key = keyOrThrow(d);
  if (/^\d{6}$/.test(code.trim())) {
    if (u.mfaSecretEnc && (await verifyTotp(await decrypt(u.mfaSecretEnc, key), code.trim(), d.now().getTime()))) return;
  } else {
    const h = await sha256Hex(normRecovery(code));
    if (u.recoveryHashes.includes(h)) {
      // Consume atomically-ish: only succeed if the hash was still present when we rewrote the list.
      const [fresh] = await d.db.select({ r: users.recoveryHashes }).from(users).where(eq(users.id, u.id)).limit(1);
      if (fresh?.r.includes(h)) { await d.db.update(users).set({ recoveryHashes: fresh.r.filter((x) => x !== h) }).where(eq(users.id, u.id)); return; }
    }
  }
  throw new HttpError(401, "invalid_code", "That code is not correct");
}

export async function disableMfa(d: Deps, userId: string, password: string, code: string, keepToken: string): Promise<void> {
  const [u] = await d.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.passwordHash || !(await verifyPassword(password, u.passwordHash))) throw new HttpError(403, "forbidden", "Password is incorrect");
  if (!u.mfaEnabled) return;
  await verifyLoginMfa(d, u, code);
  await d.db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, recoveryHashes: [] }).where(eq(users.id, userId));
  await revokeOtherSessions(d, userId, keepToken);
}

export async function mfaStatus(d: Deps, userId: string) {
  const [u] = await d.db.select({ e: users.mfaEnabled, r: users.recoveryHashes, v: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
  return { mfaEnabled: u?.e ?? false, recoveryCodesLeft: u?.r.length ?? 0, emailVerified: Boolean(u?.v), emailConfigured: emailEnabled(d) };
}
