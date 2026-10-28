import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { hashPassword, newId, randomToken, sha256Hex, verifyPassword } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { sendVerification, verifyLoginMfa } from "./account.js";
import { emailEnabled } from "./email.js";

const SESSION_DAYS = 14;
const MAX_OWNED_WORKSPACES = 5;
const { users, organizations, memberships, sessions, subscriptions } = schema;

export interface SessionUser { userId: string; email: string }

export async function register(d: Deps, input: { email: string; password: string; name?: string; organizationName?: string }) {
  const email = input.email.trim().toLowerCase();
  const existing = await d.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  // Same response shape for existing accounts would need email verification; surfaced as 409 for now.
  if (existing.length) throw new HttpError(409, "email_taken", "An account with this email already exists");

  const now = d.now().toISOString();
  const userId = newId("usr"), orgId = newId("org");
  await d.db.insert(users).values({ id: userId, email, passwordHash: await hashPassword(input.password), name: input.name ?? null, createdAt: now });
  await d.db.insert(organizations).values({ id: orgId, name: input.organizationName ?? `${email.split("@")[0]}'s workspace`, createdAt: now });
  await d.db.insert(memberships).values({ id: newId("mem"), organizationId: orgId, userId, role: "owner", createdAt: now });
  await d.db.insert(subscriptions).values({ id: newId("sub"), organizationId: orgId, plan: "free", status: "active", updatedAt: now });
  if (emailEnabled(d)) {
    // Registration must not fail because a mail provider is down; the user can resend from the app.
    try { await sendVerification(d, userId); } catch (e) { console.error(JSON.stringify({ level: "error", where: "verify_email", message: e instanceof Error ? e.message : "send failed" })); }
  }
  return { userId, organizationId: orgId, token: await createSession(d, userId) };
}

export async function login(d: Deps, emailIn: string, password: string, mfaCode?: string) {
  const email = emailIn.trim().toLowerCase();
  const [u] = await d.db.select().from(users).where(eq(users.email, email)).limit(1);
  // Run a hash either way to keep timing similar for unknown emails.
  const ok = u?.passwordHash ? await verifyPassword(password, u.passwordHash) : (await hashPassword(password), false);
  if (!u || !ok) throw new HttpError(401, "invalid_credentials", "Invalid email or password");
  // Only after the password is proven do we reveal that a second factor is needed.
  if (u.mfaEnabled) await verifyLoginMfa(d, u, mfaCode);
  return { userId: u.id, token: await createSession(d, u.id) };
}

/** An extra workspace (e.g. one per client for an agency). Capped per user so free workspaces cannot be farmed. */
export async function createOrganization(d: Deps, userId: string, name: string) {
  const owned = await d.db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  if (owned.length >= MAX_OWNED_WORKSPACES) throw new HttpError(402, "plan_limit", `You can own up to ${MAX_OWNED_WORKSPACES} workspaces`);
  const now = d.now().toISOString();
  const orgId = newId("org");
  await d.db.insert(organizations).values({ id: orgId, name, createdAt: now });
  await d.db.insert(memberships).values({ id: newId("mem"), organizationId: orgId, userId, role: "owner", createdAt: now });
  await d.db.insert(subscriptions).values({ id: newId("sub"), organizationId: orgId, plan: "free", status: "active", updatedAt: now });
  return { id: orgId, name };
}

async function createSession(d: Deps, userId: string): Promise<string> {
  const token = randomToken(32);
  const now = d.now();
  await d.db.insert(sessions).values({
    id: await sha256Hex(token), userId,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(), createdAt: now.toISOString(),
  });
  return token;
}

export async function getSessionUser(d: Deps, token: string): Promise<SessionUser | null> {
  const id = await sha256Hex(token);
  const [row] = await d.db
    .select({ userId: users.id, email: users.email, expiresAt: sessions.expiresAt })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id)).limit(1);
  if (!row) return null;
  if (row.expiresAt <= d.now().toISOString()) {
    await d.db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return { userId: row.userId, email: row.email };
}

export async function logout(d: Deps, token: string): Promise<void> {
  await d.db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
}

export async function organizationsFor(d: Deps, userId: string) {
  return d.db
    .select({ id: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships).innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, userId));
}

export type Role = "owner" | "admin" | "editor" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/**
 * Tenant gate. Returns the store only if the user belongs to its organization with at least `min` role.
 * Missing and forbidden both return 404 so store ids cannot be probed across tenants.
 */
export async function requireStore(d: Deps, user: SessionUser, storeId: string, min: Role) {
  const [row] = await d.db
    .select({ store: schema.stores, role: memberships.role })
    .from(schema.stores)
    .innerJoin(memberships, and(eq(memberships.organizationId, schema.stores.organizationId), eq(memberships.userId, user.userId)))
    .where(eq(schema.stores.id, storeId)).limit(1);
  if (!row || row.store.status !== "active") throw new HttpError(404, "not_found", "Store not found");
  if (RANK[row.role] < RANK[min]) throw new HttpError(403, "forbidden", "You do not have permission to do that");
  return { store: row.store, role: row.role };
}
