import { schema } from "@convertflow/database";
import { newId } from "../lib/crypto.js";
import { defineSubscriber, type Subscriber } from "./domain-events.js";
import { workflowTrigger } from "./workflows.js";

/**
 * Platform-confirmed orders become conversions for analytics. Idempotent: one conversion per store and order id,
 * whichever of this, a redelivery or the storefront's own purchase beacon arrives first.
 */
const recordPlatformOrder = defineSubscriber({
  name: "analytics.record_platform_order",
  events: ["order.created"],
  async handle(d, e) {
    if (!e.storeId) return;
    await d.db.insert(schema.conversions).values({
      id: newId("cnv"), storeId: e.storeId, orderId: `${e.payload.platform}:${e.payload.externalOrderId}`,
      total: e.payload.total, currency: e.payload.currency, occurredAt: e.payload.placedAt,
    }).onConflictDoNothing();
  },
});

/**
 * Every module's subscriptions, in one list so the composition root (the Worker entry and the test harness) wires
 * the same set. A new module adds its subscribers here; it never imports another module's webhook handler.
 */
export const SUBSCRIBERS: readonly Subscriber[] = [recordPlatformOrder, workflowTrigger];
