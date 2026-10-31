/**
 * The one list of what a member may do. The API enforces it (`apps/api/src/services/authz.ts`) and the dashboard may
 * read it to hide controls, but hiding a control is never the check. Zod-free so any bundle can import it.
 *
 * Roles stay a strict ladder (viewer < editor < admin < owner): every permission names the lowest role that holds it.
 * That is all the current product needs. Per-resource grants or custom roles would replace `minRole` with a policy
 * lookup without changing any caller, because callers only ever ask about a permission.
 */

export const ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** Which kind of resource a permission is checked against. */
export type PermissionScope = "store" | "organization";

interface PermissionDef { scope: PermissionScope; minRole: Role; description: string }

export const PERMISSIONS = {
  /* ---------- store ---------- */
  "store.read": { scope: "store", minRole: "viewer", description: "See the store, its snippet and integration status" },
  "store.settings.update": { scope: "store", minRole: "admin", description: "Change delivery, the discount ceiling and other store settings" },
  "store.disconnect": { scope: "store", minRole: "owner", description: "Disconnect the store and stop serving campaigns" },
  "integrations.read": { scope: "store", minRole: "editor", description: "See every integration's capabilities and connection status" },
  "integrations.manage": { scope: "store", minRole: "admin", description: "Connect a commerce platform's catalog, and run integration health checks" },
  "catalog.read": { scope: "store", minRole: "viewer", description: "Read products and product links" },
  "catalog.write": { scope: "store", minRole: "editor", description: "Import or sync products and edit product links" },
  "campaigns.read": { scope: "store", minRole: "viewer", description: "Read campaigns, versions, groups and templates" },
  "campaigns.write": { scope: "store", minRole: "editor", description: "Create and edit drafts, groups and templates; pause a live campaign" },
  "campaigns.publish": { scope: "store", minRole: "admin", description: "Publish, resume, archive or roll back a campaign" },
  "ai.generate": { scope: "store", minRole: "editor", description: "Generate or refine a campaign draft with AI" },
  "analytics.read": { scope: "store", minRole: "viewer", description: "Read campaign and tool analytics" },
  "contacts.read": { scope: "store", minRole: "editor", description: "Read subscribers, their consent history and list-provider status" },
  "contacts.manage": { scope: "store", minRole: "admin", description: "Export or erase subscribers" },
  "providers.manage": { scope: "store", minRole: "admin", description: "Connect, check and disconnect list providers" },
  "workflows.read": { scope: "store", minRole: "editor", description: "See automation workflows and their runs" },
  "workflows.manage": { scope: "store", minRole: "admin", description: "Create, activate, pause and archive automation workflows" },
  "audit.read": { scope: "store", minRole: "admin", description: "Read the store's audit log" },
  "operations.read": { scope: "store", minRole: "admin", description: "See platform event delivery status" },
  "operations.manage": { scope: "store", minRole: "admin", description: "Retry failed platform event deliveries" },

  /* ---------- organization (workspace) ---------- */
  "organization.read": { scope: "organization", minRole: "viewer", description: "See the workspace and its team" },
  "stores.create": { scope: "organization", minRole: "admin", description: "Connect a new store to the workspace" },
  "team.invite": { scope: "organization", minRole: "admin", description: "Invite and revoke invitations (inviting an admin needs the owner)" },
  "team.manage_roles": { scope: "organization", minRole: "owner", description: "Change a member's role" },
  "billing.read": { scope: "organization", minRole: "viewer", description: "See the plan and usage" },
  "billing.manage": { scope: "organization", minRole: "owner", description: "Change the plan or open the billing portal" },
  "organization.audit.read": { scope: "organization", minRole: "admin", description: "Read the workspace audit log" },
  "sites.read": { scope: "organization", minRole: "viewer", description: "See AI-built stores, their drafts and history" },
  "sites.write": { scope: "organization", minRole: "editor", description: "Create stores, edit drafts and chat with the AI builder" },
  "sites.publish": { scope: "organization", minRole: "admin", description: "Publish, unpublish or archive a store, and set its payment keys" },
  "sites.orders": { scope: "organization", minRole: "editor", description: "See and update a store's orders and form submissions" },
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;
export type StorePermission = { [K in Permission]: (typeof PERMISSIONS)[K]["scope"] extends "store" ? K : never }[Permission];
export type OrganizationPermission = Exclude<Permission, StorePermission>;

export function isPermission(x: string): x is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, x);
}

/** Pure role check. Membership (does this person belong to this store's workspace at all) is the server's job. */
export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[PERMISSIONS[permission].minRole];
}

/** Everything a role holds, for the dashboard's permission-aware navigation. */
export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => roleCan(role, p));
}
