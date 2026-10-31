# Workflow engine and action registry

Contracts: `packages/contracts/src/workflows.ts` and `packages/contracts/src/actions.ts`. Engine:
`apps/api/src/services/workflows.ts`. Executors and the approval queue: `apps/api/src/services/actions.ts`. Dashboard:
`/app/automations`. Availability: a **preview** behind the `workflows.create` capability (see `docs/permissions.md`).

## What a workflow is

*When* a trigger happens, *if* every condition holds, *do* up to five actions, optionally after a delay. A definition
is data validated by Zod. Every trigger, condition and action comes from a closed list, so a workflow can never run
code, query the database, or call a URL.

```json
{
  "schemaVersion": 1,
  "trigger": { "type": "event", "event": "order.created" },
  "conditions": [{ "type": "order_total_at_least", "amount": 200 }],
  "actions": [{ "action": "note.record", "input": { "text": "Large order received" } }],
  "delaySeconds": 0, "onError": "stop", "maxRunsPerHour": 100
}
```

| Part | Allowed values |
|---|---|
| Trigger | Any platform event type (`docs/event-catalog.md`), or `{ "type": "schedule", "every": "day" }` (daily cron) |
| Conditions (≤10) | `order_total_at_least` (order.created only), `contact_can_be_contacted` (customer.* only; uses the consent facade), `campaign_status_is`, `store_delivery_enabled`, `event_field_equals` on a non-personal enumerated field (`channel`, `origin`, `tool`, `platform`, `reason`, `currency`) |
| Actions (1-5) | Registered actions a workflow may use: `note.record`, `campaign.pause`, `approval.request` |
| `delaySeconds` | 0 to 43,200 (Cloudflare Queues' 12-hour delivery delay cap) |
| `onError` | `stop` (default) or `continue` |
| `maxRunsPerHour` | 1 to 1,000 (default 100) |

The validator also rejects conditions that cannot apply to the trigger, unknown actions, actions the workflow origin
may not use, and action input outside each action's strict schema.

## Action registry

| Action | Side effects | Permission | Workflow | AI manager |
|---|---|---|---|---|
| `note.record` | none (audit row) | workflows.read | runs directly | not allowed |
| `campaign.pause` | live | campaigns.write | runs directly | approval required |
| `campaign.create_draft` | draft | campaigns.write | not allowed | approval required |
| `workflow.create_draft` | draft | workflows.manage | not allowed | approval required |
| `report.recommend` | none | analytics.read | not allowed | approval required |
| `approval.request` | none (creates a pending request) | workflows.read | approval required | not allowed |

Every executor calls a domain service (`campaigns.pause`, `campaigns.createCampaign`, `workflows.createWorkflow`,
`audit.recordAudit`). None writes another module's tables. Each execution publishes `action.executed`.

Adding an action: add it to `ACTIONS` with a strict input schema, a permission, its side effects and the origins
allowed to use it, then add its executor to `EXECUTORS`. TypeScript fails until both exist.

## Lifecycle

1. **Draft**: `POST /workflows` validates and stores a draft. Drafts never run.
2. **Activate**: `POST /workflows/:id/activate` with `{approve: true, approvedUpdatedAt}`. Like campaign publishing, a
   draft that changed after it was reviewed is refused (409 `stale_approval`). The activating member must hold every
   action's permission. Activation writes an immutable `workflow_versions` row; the workflow runs on that member's
   authority.
3. **Pause / archive**: runs still waiting are cancelled.

## Execution

```
platform event ──> workflows.trigger subscriber
   skip if the event's correlationId starts with "wfrun:" (loop prevention)
   skip if the workspace lacks workflows.create
   for each active workflow whose trigger matches:
       insert workflow_runs (version_id, trigger_key = event id)  -- unique: redelivery is a no-op
       delay 0 -> execute now; else queue {kind:"workflow_run"} with delaySeconds (no queue: the daily sweep runs it)
daily cron ──> runScheduledWorkflows (trigger_key = "day:YYYY-MM-DD"), sweepWorkflowRuns (due runs a message missed)

executeRun:
   claim (scheduled -> running)  -- a second worker gets nothing
   guards: still active on the same version, activating member recorded, trigger event still on record,
           hourly cap, monthly allowance (usage metric workflow_executions)
   conditions in order; the first that fails ends the run as "skipped"
   record one workflow_execution
   actions in order: needs approval -> pending action request; else runAction on the activator's authority
   finish: succeeded | skipped | failed | cancelled, with every step recorded
```

Each run records its steps (guard, condition and action outcomes), which `GET /workflows/:id/runs` returns and the
dashboard shows. Changes made by a run are correlated `wfrun:<run id>` in the audit log and on platform events.

## Approval queue

`action_requests` holds actions waiting for a merchant: `approval.request` steps from workflows, and every AI manager
proposal. Approving (`POST /action-requests/:id/approve`) claims the request atomically, so a double click cannot run it
twice. It then runs the action on the approver's authority, which needs the action's own permission. A failure is
recorded on the request (`failed`, `error`) and never retried silently. Requests expire after 14 days (3 days for AI
proposals, because their evidence ages), and the daily cron closes expired ones.

## Limits and what is not built

- Per store: 50 workflows. Per run: 10 conditions, 5 actions. Per workspace per month: 1,000 executions (growth) or
  10,000 (scale); none on plans without the capability.
- Not built: a visual editor (the dashboard offers presets plus a JSON editor validated by the server), branching,
  loops, waits on later events, and actions that message shoppers. A sending action must call
  `consent.canContact` before it is added.
- Queue-delayed runs have only been exercised with the sweep in tests, not on real Cloudflare Queues.
