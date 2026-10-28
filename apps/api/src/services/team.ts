import { and, eq, gt, isNull } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { newId, randomToken, sha256Hex } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { emailEnabled, templates } from "./email.js";
import type { Role, SessionUser } from "./auth.js";

const { memberships, users, invitations, organizations } = schema;
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
const INVITE_DAYS = 7;

/** 404 for non-members (no existence leak), 403 for members who lack the role. */
export async function requireOrgRole(d: Deps, user: SessionUser, orgId: string, min: Role) {
  const [m] = await d.db.select().from(memberships).where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, user.userId))).limit(1);
  if (!m) throw new HttpError(404, "not_found", "Workspace not found");
  if (RANK[m.role] < RANK[min]) throw new HttpError(403, "forbidden", "You do not have permission to do that");
  return m;
}

const audit = (d: Deps, orgId: string, actorId: string, action: string, targetId: string) =>
  d.db.insert(schema.auditLogs).values({ id: newId("aud"), organizationId: orgId, actorId, action, targetType: "member", targetId, createdAt: d.now().toISOString() });

export async function listTeam(d: Deps, user: SessionUser, orgId: string) {
  await requireOrgRole(d, user, orgId, "viewer");
  const members = await d.db.select({ userId: users.id, email: users.email, role: memberships.role, joinedAt: memberships.createdAt })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.organizationId, orgId));
  const nowIso = d.now().toISOString();
  const invites = await d.db.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
    .from(invitations).where(and(eq(invitations.organizationId, orgId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, nowIso)));
  return { members, invites };
}

export async function invite(d: Deps, user: SessionUser, orgId: string, emailIn: string, role: "admin" | "editor" | "viewer") {
  const actor = await requireOrgRole(d, user, orgId, "admin");
  if (role === "admin" && actor.role !== "owner") throw new HttpError(403, "forbidden", "Only the owner can invite admins");
  const email = emailIn.trim().toLowerCase();
  const [existing] = await d.db.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, orgId), eq(users.email, email))).limit(1);
  if (existing) throw new HttpError(409, "already_member", "That person is already on the team");

  await d.db.delete(invitations).where(and(eq(invitations.organizationId, orgId), eq(invitations.email, email), isNull(invitations.acceptedAt)));
  const token = randomToken(32);
  const now = d.now();
  await d.db.insert(invitations).values({
    id: newId("inv"), organizationId: orgId, email, role, tokenHash: await sha256Hex(token), invitedBy: user.userId,
    expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(), createdAt: now.toISOString(),
  });
  const origin = d.secrets?.webOrigin;
  const inviteUrl = origin ? `${origin}/invite?token=${encodeURIComponent(token)}` : null;
  let emailed = false;
  if (inviteUrl && emailEnabled(d)) {
    const [org] = await d.db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    try { await d.email!.send(templates.invite(email, inviteUrl, org?.name ?? "a workspace", user.email, role)); emailed = true; }
    catch (e) { console.error(JSON.stringify({ level: "error", where: "invite_email", message: e instanceof Error ? e.message : "send failed" })); }
  }
  await audit(d, orgId, user.userId, "team.invited", email);
  // The inviter always gets the link, so invites still work on deployments without email (they share it themselves).
  return { email, role, emailed, inviteUrl };
}

export async function revokeInvite(d: Deps, user: SessionUser, orgId: string, inviteId: string) {
  await requireOrgRole(d, user, orgId, "admin");
  await d.db.delete(invitations).where(and(eq(invitations.id, inviteId), eq(invitations.organizationId, orgId)));
  await audit(d, orgId, user.userId, "team.invite_revoked", inviteId);
}

/** The signed-in account's email must match the invited address, so a forwarded link cannot be used by someone else. */
export async function acceptInvite(d: Deps, user: SessionUser, token: string) {
  const nowIso = d.now().toISOString();
  const [inv] = await d.db.select().from(invitations).where(and(eq(invitations.tokenHash, await sha256Hex(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, nowIso))).limit(1);
  if (!inv) throw new HttpError(400, "invalid_token", "This invitation is invalid or has expired");
  if (inv.email !== user.email.toLowerCase()) throw new HttpError(403, "wrong_account", `This invitation was sent to ${inv.email}. Sign in with that address to accept it.`);
  const claimed = await d.db.update(invitations).set({ acceptedAt: nowIso }).where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt))).returning({ id: invitations.id });
  if (!claimed[0]) throw new HttpError(400, "invalid_token", "This invitation has already been used");
  await d.db.insert(memberships).values({ id: newId("mem"), organizationId: inv.organizationId, userId: user.userId, role: inv.role, createdAt: nowIso }).onConflictDoNothing();
  await audit(d, inv.organizationId, user.userId, "team.joined", user.userId);
  const [org] = await d.db.select().from(organizations).where(eq(organizations.id, inv.organizationId)).limit(1);
  return { organizationId: inv.organizationId, name: org?.name ?? "", role: inv.role };
}

export async function changeRole(d: Deps, user: SessionUser, orgId: string, targetUserId: string, role: "admin" | "editor" | "viewer") {
  await requireOrgRole(d, user, orgId, "owner");
  const [t] = await d.db.select().from(memberships).where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, targetUserId))).limit(1);
  if (!t) throw new HttpError(404, "not_found", "Member not found");
  if (t.role === "owner") throw new HttpError(409, "owner_locked", "The owner's role cannot be changed here");
  await d.db.update(memberships).set({ role }).where(eq(memberships.id, t.id));
  await audit(d, orgId, user.userId, `team.role_${role}`, targetUserId);
}

/** Admins can remove editors/viewers; the owner can remove anyone but themselves; anyone can leave. Owners cannot be removed. */
export async function removeMember(d: Deps, user: SessionUser, orgId: string, targetUserId: string) {
  const actor = await requireOrgRole(d, user, orgId, "viewer");
  const [t] = await d.db.select().from(memberships).where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, targetUserId))).limit(1);
  if (!t) throw new HttpError(404, "not_found", "Member not found");
  if (t.role === "owner") throw new HttpError(409, "owner_locked", "The owner cannot be removed. Delete the workspace's account or transfer ownership first.");
  const self = targetUserId === user.userId;
  if (!self && (RANK[actor.role] < RANK.admin || RANK[actor.role] <= RANK[t.role])) throw new HttpError(403, "forbidden", "You do not have permission to remove that member");
  await d.db.delete(memberships).where(eq(memberships.id, t.id));
  await audit(d, orgId, user.userId, self ? "team.left" : "team.removed", targetUserId);
}
