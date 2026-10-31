import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { validateWorkflowDefinition } from "@convertflow/contracts";
import { newId } from "../src/lib/crypto.js";
import { dispatchDomainEvent, publishDomainEvent } from "../src/services/domain-events.js";
import { enableFeature, recordUsage } from "../src/services/entitlements.js";
import { sweepWorkflowRuns } from "../src/services/workflows.js";
import { makeEnv, setPlan, setupStore, signup, validConfig, type Env } from "./helpers.js";

const def = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, trigger: { type: "event", event: "order.created" }, conditions: [], actions: [{ action: "note.record", input: { text: "Big order" } }], ...over,
});
let orderNo = 0;
const order = (env: Env, storeId: string, total: number) => publishDomainEvent(env.deps, {
  type: "order.created", payload: { platform: "shopify", externalOrderId: String(++orderNo), total, currency: "USD", placedAt: "2026-10-27T10:00:00.000Z" },
  idempotencyKey: `o:${orderNo}`, storeId, source: "shopify_webhook",
});
const join = async (env: Env, orgId: string, email: string, role: "admin" | "editor" | "viewer") => {
  const u = await signup(env, email);
  await env.deps.db.insert(schema.memberships).values({ id: newId("mem"), organizationId: orgId, userId: u.userId, role, createdAt: new Date(env.clock.t).toISOString() });
  return u;
};
/** A growth workspace in the workflows preview, with one live campaign. */
async function setup() {
  const env = await makeEnv();
  const t = await setupStore(env);
  await setPlan(env, t.orgId, "growth");
  await enableFeature(env.deps, t.orgId, "workflows.create", null);
  const made = await t.c.post(`/api/v1/stores/${t.storeId}/campaigns`, validConfig());
  await t.c.post(`/api/v1/stores/${t.storeId}/campaigns/${made.json.data.id}/publish`, { approve: true, approvedUpdatedAt: made.json.data.updatedAt });
  const base = `/api/v1/stores/${t.storeId}/workflows`;
  const activate = async (definition: Record<string, unknown>, c = t.c) => {
    const w = await c.post(base, { name: "W", definition });
    expect(w.status).toBe(201);
    const a = await c.post(`${base}/${w.json.data.id}/activate`, { approve: true, approvedUpdatedAt: w.json.data.updatedAt });
    expect(a.status).toBe(200);
    return w.json.data.id as string;
  };
  const runs = (workflowId: string) => env.deps.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.workflowId, workflowId));
  return { env, t, campaignId: made.json.data.id as string, base, activate, runs };
}

describe("workflow definitions", () => {
  it("accept only registered, workflow-usable actions with valid input, and conditions that fit the trigger", () => {
    expect(validateWorkflowDefinition(def()).ok).toBe(true);
    const bad = (over: Record<string, unknown>) => { const r = validateWorkflowDefinition(def(over)); return r.ok ? [] : r.issues.join(" | "); };
    expect(bad({ actions: [{ action: "sql.run", input: {} }] })).toMatch(/unknown action/);
    expect(bad({ actions: [{ action: "campaign.create_draft", input: { config: {} } }] })).toMatch(/cannot be used by a workflow/);
    expect(bad({ actions: [{ action: "note.record", input: { text: "<script>" } }] })).toMatch(/no markup/);
    expect(bad({ actions: [{ action: "note.record", input: { text: "x", extra: 1 } }] })).toMatch(/Unrecognized key/);
    expect(bad({ trigger: { type: "event", event: "campaign.published" }, conditions: [{ type: "order_total_at_least", amount: 5 }] })).toMatch(/needs the order.created trigger/);
    expect(bad({ delaySeconds: 13 * 3600 })).toMatch(/delaySeconds/);
    expect(bad({ actions: [] })).toMatch(/actions/);
  });
});

describe("workflow engine", () => {
  it("is a preview: hidden without the workspace flag, and role-gated", async () => {
    const env = await makeEnv();
    const t = await setupStore(env);
    await setPlan(env, t.orgId, "growth");
    expect((await t.c.get(`/api/v1/stores/${t.storeId}/workflows`)).json.error.code).toBe("feature_unavailable");
    await enableFeature(env.deps, t.orgId, "workflows.create", null);
    expect((await t.c.get(`/api/v1/stores/${t.storeId}/workflows`)).status).toBe(200);
    const viewer = await join(env, t.orgId, "v@example.com", "viewer");
    expect((await viewer.c.get(`/api/v1/stores/${t.storeId}/workflows`)).status).toBe(403);
    const editor = await join(env, t.orgId, "e@example.com", "editor");
    expect((await editor.c.post(`/api/v1/stores/${t.storeId}/workflows`, { name: "W", definition: def() })).status).toBe(403);
  });

  it("runs once per triggering event, only when its conditions hold, and its own effects never trigger it again", async () => {
    const { env, t, campaignId, base, runs } = await setup();
    const w = await t.c.post(base, { name: "Pause on big order", definition: def({
      conditions: [{ type: "order_total_at_least", amount: 50 }],
      actions: [{ action: "note.record", input: { text: "Big order" } }, { action: "campaign.pause", input: { campaignId } }],
    }) });
    expect((await t.c.post(`${base}/${w.json.data.id}/activate`, { approve: true, approvedUpdatedAt: "stale" })).status).toBe(409);
    await t.c.post(`${base}/${w.json.data.id}/activate`, { approve: true, approvedUpdatedAt: w.json.data.updatedAt });

    await order(env, t.storeId, 30);
    expect((await runs(w.json.data.id)).map((r) => r.status)).toEqual(["skipped"]);

    const big = await order(env, t.storeId, 80);
    const all = await runs(w.json.data.id);
    const ran = all.find((r) => r.triggerKey === big.id)!;
    expect(ran.status).toBe("succeeded");
    expect(ran.steps).toEqual([
      { kind: "condition", name: "order_total_at_least", outcome: "met" },
      { kind: "action", name: "note.record", outcome: "succeeded" },
      { kind: "action", name: "campaign.pause", outcome: "succeeded" },
    ]);
    const [camp] = await env.deps.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
    expect(camp?.status).toBe("paused");
    // The pause it caused is a platform event correlated to the run, and it started no run of its own.
    const [paused] = await env.deps.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.type, "campaign.paused"));
    expect(paused?.correlationId).toBe(`wfrun:${ran.id}`);
    expect(await runs(w.json.data.id)).toHaveLength(2);
    // Redelivering the trigger is a no-op (one run per version and event).
    await env.deps.db.delete(schema.domainEventDeliveries).where(eq(schema.domainEventDeliveries.eventId, big.id));
    await dispatchDomainEvent(env.deps, big.id);
    expect(await runs(w.json.data.id)).toHaveLength(2);
    expect((await env.deps.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "automation.note")))[0]?.summary).toEqual({ note: "Big order" });
    expect((await env.deps.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.metric, "workflow_executions")))[0]?.count).toBe(1);
  });

  it("acts on the activating member's current authority: a demoted activator's workflow can no longer pause campaigns", async () => {
    const { env, t, campaignId, activate, runs } = await setup();
    const admin = await join(env, t.orgId, "a@example.com", "admin");
    const id = await activate(def({ actions: [{ action: "campaign.pause", input: { campaignId } }] }), admin.c);
    await env.deps.db.update(schema.memberships).set({ role: "viewer" }).where(eq(schema.memberships.userId, admin.userId));
    await order(env, t.storeId, 10);
    const [r] = await runs(id);
    expect(r).toMatchObject({ status: "failed" });
    expect(r?.error).toMatch(/no longer has permission/);
    expect((await env.deps.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)))[0]?.status).toBe("active");
  });

  it("an editor cannot activate a workflow whose actions need permissions they lack", async () => {
    const { env, t, base, campaignId } = await setup();
    const w = await t.c.post(base, { name: "W", definition: def({ actions: [{ action: "campaign.pause", input: { campaignId } }] }) });
    const editor = await join(env, t.orgId, "e@example.com", "editor");
    expect((await editor.c.post(`${base}/${w.json.data.id}/activate`, { approve: true, approvedUpdatedAt: w.json.data.updatedAt })).status).toBe(403);
  });

  it("an approval action waits for a merchant; approval runs once, and is store-scoped", async () => {
    const { env, t, activate } = await setup();
    await activate(def({ actions: [{ action: "approval.request", input: { summary: "Check this order" } }] }));
    await order(env, t.storeId, 10);
    const list = await t.c.get(`/api/v1/stores/${t.storeId}/action-requests?status=pending`);
    expect(list.json.data).toMatchObject([{ action: "approval.request", origin: "workflow", rationale: "Check this order", status: "pending" }]);
    const id = list.json.data[0].id as string;
    const other = await setupStore(env, "other@example.com");
    expect((await other.c.post(`/api/v1/stores/${other.storeId}/action-requests/${id}/approve`)).status).toBe(404);
    expect((await t.c.post(`/api/v1/stores/${t.storeId}/action-requests/${id}/approve`)).json.data.status).toBe("executed");
    expect((await t.c.post(`/api/v1/stores/${t.storeId}/action-requests/${id}/approve`)).status).toBe(409);
    const audit = (await env.deps.db.select().from(schema.auditLogs)).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["action_request.created", "action_request.approved"]));
  });

  it("delays run later from the sweep (or the queue), and pausing the workflow cancels what is waiting", async () => {
    const { env, t, base, activate, runs } = await setup();
    const id = await activate(def({ delaySeconds: 3600 }));
    await order(env, t.storeId, 10);
    expect((await runs(id))[0]?.status).toBe("scheduled");
    expect(await sweepWorkflowRuns(env.deps)).toBe(0);
    env.clock.t += 3601_000;
    expect(await sweepWorkflowRuns(env.deps)).toBe(1);
    expect((await runs(id))[0]?.status).toBe("succeeded");

    await order(env, t.storeId, 10);
    await t.c.post(`${base}/${id}/pause`);
    expect((await runs(id)).map((r) => r.status).sort()).toEqual(["cancelled", "succeeded"]);
  });

  it("skips runs over the hourly cap or the monthly allowance", async () => {
    const { env, t, activate, runs } = await setup();
    const id = await activate(def({ maxRunsPerHour: 1 }));
    await order(env, t.storeId, 10);
    await order(env, t.storeId, 10);
    expect((await runs(id)).map((r) => r.status).sort()).toEqual(["skipped", "succeeded"]);
    env.clock.t += 2 * 3_600_000;
    await recordUsage(env.deps, t.orgId, "workflow_executions", 1000);
    await order(env, t.storeId, 10);
    const last = (await runs(id)).find((r) => r.status === "skipped" && JSON.stringify(r.steps).includes("monthly_allowance"));
    expect(last).toBeTruthy();
  });

  it("a catalog change triggers a workflow, filtered on how the products changed", async () => {
    const { t, activate, runs } = await setup();
    const id = await activate(def({ trigger: { type: "event", event: "catalog.products_changed" }, conditions: [{ type: "event_field_equals", field: "origin", value: "sync" }] }));
    await t.c.post(`/api/v1/stores/${t.storeId}/products/import`, { products: [{ externalId: "1", title: "Hat" }] });
    const [r] = await runs(id);
    expect(r).toMatchObject({ status: "skipped", steps: [{ kind: "condition", name: "event_field_equals", outcome: "not_met" }] });
  });

  it("checks current consent and suppression on the channel, never another channel", async () => {
    const { env, t, activate, runs } = await setup();
    const id = await activate(def({ trigger: { type: "event", event: "customer.subscribed" }, conditions: [{ type: "contact_can_be_contacted", channel: "email" }] }));
    const now = new Date(env.clock.t).toISOString();
    await env.deps.db.insert(schema.contacts).values([
      { id: "con_ok", storeId: t.storeId, email: "ok@example.com", emailStatus: "subscribed", source: "import", createdAt: now, updatedAt: now },
      { id: "con_sms", storeId: t.storeId, phone: "+14155550123", smsStatus: "subscribed", source: "import", createdAt: now, updatedAt: now },
    ]);
    const sub = (contactId: string, channel: "email" | "sms") => publishDomainEvent(env.deps, { type: "customer.subscribed", payload: { contactId, channel }, idempotencyKey: `s:${contactId}`, storeId: t.storeId, source: "storefront" });
    await sub("con_ok", "email");
    await sub("con_sms", "sms");
    const rs = await runs(id);
    expect(rs.map((r) => [r.status, (r.steps as { detail?: string }[])[0]?.detail]).sort()).toEqual([["skipped", "no_identifier"], ["succeeded", "subscribed"]]);
  });
});
