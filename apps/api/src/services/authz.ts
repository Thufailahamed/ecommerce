import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { PERMISSIONS, roleCan, type OrganizationPermission, type Permission, type Role, type StorePermission } from "@convertflow/contracts";
import { HttpError, type Deps } from "../deps.js";

const { memberships, stores } = schema;

/**
 * Who is acting. Only signed-in members can be authorised today; webhooks and scheduled work are trusted by their
 * own verification (signature, cron) and act through services directly, and are recorded as `platform`/`system` in
 * the audit log. A service identity would be a new variant here with its own grant list, not a fake user.
 */
export interface ActorContext { type: "user"; userId: string; email?: string }

export type ResourceContext = { storeId: string } | { organizationId: string };

export interface StoreAccess { store: typeof stores.$inferSelect; organizationId: string; role: Role }
export interface OrganizationAccess { organizationId: string; role: Role }

const forbidden = () => new HttpError(403, "forbidden", "You do not have permission to do that");

/**
 * Store gate. The store id usually comes from the URL, so it is never trusted: the store is returned only if the
 * actor belongs to the workspace that owns it. Missing, disconnected and foreign stores are all 404, so ids cannot be
 * probed across tenants; a member without the permission gets 403.
 */
export async function authorizeStore(d: Deps, actor: ActorContext, storeId: string, permission: StorePermission): Promise<StoreAccess> {
  const [row] = storeId ? await d.db
    .select({ store: stores, role: memberships.role })
    .from(stores)
    .innerJoin(memberships, and(eq(memberships.organizationId, stores.organizationId), eq(memberships.userId, actor.userId)))
    .where(eq(stores.id, storeId)).limit(1) : [];
  if (!row || row.store.status !== "active") throw new HttpError(404, "not_found", "Store not found");
  if (!roleCan(row.role, permission)) throw forbidden();
  return { store: row.store, organizationId: row.store.organizationId, role: row.role };
}

/** Workspace gate: 404 for non-members (no existence leak), 403 for members without the permission. */
export async function authorizeOrganization(d: Deps, actor: ActorContext, organizationId: string, permission: OrganizationPermission): Promise<OrganizationAccess> {
  const [m] = organizationId ? await d.db.select({ role: memberships.role }).from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, actor.userId))).limit(1) : [];
  if (!m) throw new HttpError(404, "not_found", "Workspace not found");
  if (!roleCan(m.role, permission)) throw forbidden();
  return { organizationId, role: m.role };
}

/** The non-throwing form, for services that branch on a permission instead of refusing. */
export async function can(d: Deps, actor: ActorContext, permission: Permission, resource: ResourceContext): Promise<boolean> {
  // A store permission asked about a workspace (or the reverse) is a programming error, never a "no".
  if (PERMISSIONS[permission].scope !== ("storeId" in resource ? "store" : "organization")) throw new Error(`${permission} is not checked against this kind of resource`);
  try {
    if ("storeId" in resource) await authorizeStore(d, actor, resource.storeId, permission as StorePermission);
    else await authorizeOrganization(d, actor, resource.organizationId, permission as OrganizationPermission);
    return true;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return false;
    throw e;
  }
}
