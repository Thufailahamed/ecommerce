import {
  BarChart3, Bot, FlaskConical, Inbox, LayoutDashboard, LayoutTemplate, Megaphone, Activity, Sparkles, Store, Users, Workflow, type LucideIcon,
} from "lucide-react";
import { permissionsFor, type Capability, type Permission, type Role } from "@convertflow/contracts";

/**
 * Every dashboard module, in one list, so a new module registers its navigation, the permission it needs and whether
 * it is generally available in one place. Hiding an entry is a convenience: the API enforces the same permission
 * and capability on every request.
 *
 * - `permission`: the member must hold it (see packages/contracts/src/permissions.ts).
 * - `capability`: the workspace must hold it (see packages/contracts/src/entitlements.ts). A preview module names its
 *   preview capability, so it only appears for workspaces the server has switched it on for. Unfinished modules are
 *   simply not registered.
 */
export type ModuleSection = "workspace" | "audience" | "measure" | "operate";

export interface ModuleDef {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  section: ModuleSection;
  permission: Permission;
  capability?: Capability;
  /** Shown with a "Preview" label. */
  preview?: boolean;
}

export const MODULES: readonly ModuleDef[] = [
  { key: "overview", href: "/app", label: "Overview", icon: LayoutDashboard, section: "workspace", permission: "store.read" },
  { key: "sites", href: "/app/sites", label: "Store builder", icon: Store, section: "workspace", permission: "sites.read" },
  { key: "campaigns", href: "/app/campaigns", label: "Campaigns", icon: Megaphone, section: "workspace", permission: "campaigns.read" },
  { key: "studio", href: "/app/studio", label: "AI studio", icon: Sparkles, section: "workspace", permission: "ai.generate" },
  { key: "templates", href: "/app/templates", label: "Templates", icon: LayoutTemplate, section: "workspace", permission: "campaigns.read" },
  { key: "subscribers", href: "/app/subscribers", label: "Subscribers", icon: Users, section: "audience", permission: "contacts.read" },
  { key: "submissions", href: "/app/submissions", label: "Submissions", icon: Inbox, section: "audience", permission: "campaigns.read" },
  { key: "experiments", href: "/app/experiments", label: "Experiments", icon: FlaskConical, section: "measure", permission: "analytics.read" },
  { key: "analytics", href: "/app/analytics", label: "Analytics", icon: BarChart3, section: "measure", permission: "analytics.read" },
  { key: "automations", href: "/app/automations", label: "Automations", icon: Workflow, section: "operate", permission: "workflows.read", capability: "workflows.create", preview: true },
  { key: "manager", href: "/app/manager", label: "AI manager", icon: Bot, section: "operate", permission: "ai.generate", capability: "ai.commerce_manager", preview: true },
  { key: "operations", href: "/app/operations", label: "Operations", icon: Activity, section: "operate", permission: "operations.read" },
];

export const SECTION_LABEL: Record<ModuleSection, string> = { workspace: "Workspace", audience: "Audience", measure: "Measure", operate: "Operate" };

const isRole = (r: string | undefined): r is Role => r === "viewer" || r === "editor" || r === "admin" || r === "owner";

/** Whether this member's role holds a permission, to hide controls they cannot use. The API checks again. */
export const roleHolds = (role: string | undefined, p: Permission): boolean => permissionsFor(isRole(role) ? role : "viewer").includes(p);

/** The modules this member may see in this workspace. Unknown role: only what a viewer may see. */
export function visibleModules(role: string | undefined, capabilities: ReadonlySet<string>): ModuleDef[] {
  const held = new Set<string>(permissionsFor(isRole(role) ? role : "viewer"));
  return MODULES.filter((m) => held.has(m.permission) && (!m.capability || capabilities.has(m.capability)));
}
