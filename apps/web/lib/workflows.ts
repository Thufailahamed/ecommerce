import { ACTIONS, isActionKey, needsApproval, type WorkflowCondition, type WorkflowDefinition } from "@convertflow/contracts";

export interface WorkflowRow { id: string; name: string; status: "draft" | "active" | "paused" | "archived"; draftDefinition: WorkflowDefinition; activeVersionId: string | null; updatedAt: string }

/** Starting points that use only registered actions. Anything else goes through the JSON editor and the server's validator. */
export const WORKFLOW_PRESETS: { key: string; name: string; definition: Record<string, unknown> }[] = [
  { key: "large-order", name: "Note large orders", definition: { schemaVersion: 1, trigger: { type: "event", event: "order.created" }, conditions: [{ type: "order_total_at_least", amount: 200 }], actions: [{ action: "note.record", input: { text: "Large order received" } }] } },
  { key: "paused-review", name: "Ask for a review when a campaign is paused", definition: { schemaVersion: 1, trigger: { type: "event", event: "campaign.paused" }, conditions: [], actions: [{ action: "approval.request", input: { summary: "A campaign was paused. Check whether it should be resumed or archived." } }] } },
  { key: "catalog-sync", name: "Note catalog syncs", definition: { schemaVersion: 1, trigger: { type: "event", event: "catalog.products_changed" }, conditions: [{ type: "event_field_equals", field: "origin", value: "sync" }], actions: [{ action: "note.record", input: { text: "Catalog synced from the store" } }] } },
];

function condition(c: WorkflowCondition): string {
  switch (c.type) {
    case "order_total_at_least": return `the order total is at least ${c.amount}`;
    case "contact_can_be_contacted": return `the contact can currently be contacted by ${c.channel}`;
    case "campaign_status_is": return `campaign ${c.campaignId} is ${c.status}`;
    case "store_delivery_enabled": return "the storefront is serving campaigns";
    case "event_field_equals": return `${c.field} is “${c.value}”`;
  }
}

/** The definition in words, for review before activation. Built from the registries, never from free text. */
export function describeWorkflow(w: WorkflowDefinition): string[] {
  const out = [w.trigger.type === "event" ? `When ${w.trigger.event} happens` : "Once a day"];
  for (const c of w.conditions ?? []) out.push(`If ${condition(c)}`);
  if (w.delaySeconds) out.push(`Wait ${Math.round(w.delaySeconds / 60)} minutes`);
  for (const a of w.actions) {
    if (!isActionKey(a.action)) { out.push(`Then: ${a.action}`); continue; }
    out.push(`Then: ${ACTIONS[a.action].description}${needsApproval(a.action, "workflow") ? " (waits for a merchant)" : ""}`);
  }
  return out;
}
