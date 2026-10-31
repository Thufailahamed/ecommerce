# Permissions

The catalog is `packages/contracts/src/permissions.ts`. It is enforced in `apps/api/src/services/authz.ts`.

## Model

- **Tenancy:** `organization (workspace) → stores`. A user belongs to workspaces through `memberships`, each with one role.
- **Roles:** a strict ladder, `viewer < editor < admin < owner`. Every permission names the lowest role that holds it.
- **Checks:** callers ask about a **permission**, never a role:
  - `authorizeStore(d, actor, storeId, "campaigns.publish")` returns the store, the workspace id and the role, or throws.
  - `authorizeOrganization(d, actor, orgId, "billing.manage")` does the same for a workspace.
  - `can(...)` is the non-throwing form.

  Replacing the ladder with per-resource grants or custom roles later would change only `roleCan`. No caller changes.
- **Answers:** a store or workspace outside the caller's memberships, missing, or disconnected returns **404**, so ids
  cannot be probed. A member without the permission gets **403**.
- **Ids from the browser are never trusted:** the store or workspace id in a URL or body is only used to look up the
  caller's own membership.
- **Exceptions:** member-versus-member rules in `team.ts` compare roles directly. Examples: only the owner invites
  admins; admins remove members below them; anyone may leave. These are relationships between two people, not
  capabilities.
- **The dashboard:** `GET /api/v1/stores/:storeId` returns `role` and `permissions`, so navigation can hide what the
  user cannot do. Hiding a control is never the check itself.

## Catalog

| Permission | Scope | Lowest role |
|---|---|---|
| store.read | store | viewer |
| catalog.read | store | viewer |
| campaigns.read | store | viewer |
| analytics.read | store | viewer |
| catalog.write | store | editor |
| campaigns.write (drafts, groups, templates, **pause**) | store | editor |
| ai.generate | store | editor |
| contacts.read (incl. list-provider status) | store | editor |
| integrations.read (integration registry and connection status) | store | editor |
| workflows.read (workflows, runs, the approval queue) | store | editor |
| workflows.manage (create, activate, pause, archive workflows) | store | admin |
| store.settings.update | store | admin |
| integrations.manage | store | admin |
| campaigns.publish (publish, resume, archive, rollback) | store | admin |
| contacts.manage (export, erase) | store | admin |
| providers.manage | store | admin |
| audit.read | store | admin |
| operations.read / operations.manage (platform event status, retry) | store | admin |
| store.disconnect | store | owner |
| organization.read | workspace | viewer |
| billing.read | workspace | viewer |
| stores.create | workspace | admin |
| team.invite | workspace | admin |
| organization.audit.read | workspace | admin |
| team.manage_roles | workspace | owner |
| billing.manage | workspace | owner |

Pausing is an editor action on purpose: anyone who can edit should be able to stop something going wrong. Turning it
back on is a publish.

## Actors

Only signed-in members are authorised through this service. Verified webhooks and scheduled jobs act through services
directly, and they are recorded in the audit log as `actorType: platform` or `system`.

Automation never has authority of its own. Every automated change goes through a registered action
(`packages/contracts/src/actions.ts`), and `runAction` checks the action's permission against a **member** at the
moment it runs:

- **Workflows** run on the authority of the member who activated the version. Activation requires that member to hold
  every action's permission. Each run checks again, so demoting or removing that member stops the workflow's actions
  (the run fails with "no longer has permission").
- **AI Commerce Manager** proposals are only ever queued. One runs when a member who holds that action's permission
  approves it, on their authority at that moment. The manager can therefore never do more than the approving member
  could do by hand.
- Approving needs `workflows.read` to reach the queue, **plus** the action's own permission. A viewer can see the
  queue but cannot approve a `campaigns.write` action.

No session is ever borrowed. Changes caused by an action carry the correlation id `wfrun:<run>` or `aireq:<request>` in
the audit log and on platform events.

## Capabilities (what the plan allows) are separate

A permission says what a **member** may do. A capability (`packages/contracts/src/entitlements.ts`) says what the
**workspace's plan** allows, plus preview flags (`organization_features`). Both are enforced: `402 plan_limit` when the
plan lacks a GA capability, `403 feature_unavailable` for a preview the workspace is not in or a `planned` capability.
Previews: `workflows.create` (Automations) and `ai.commerce_manager` (AI manager). Locally, switch one on with
`pnpm dev:feature <email> <capability>`.

## Tests

- `packages/contracts/src/platform.test.ts`: the ladder holds, and every threshold equals what the routes enforced
  before the catalog existed.
- `apps/api/test/platform.test.ts`: outsider 404s, member 403s, cross-workspace `can()`, and a permission asked about
  the wrong kind of resource throws.
- The existing suites (security, team, contacts, providers…) cover the role behaviour route by route and still pass.
