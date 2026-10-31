import { describe, expect, it } from "vitest";
import { applyLedger, pointsForOrder, type LoyaltyLedgerEntry } from "@convertflow/contracts";
import { linkShop, makeEnv, signup } from "./helpers.js";
import { defineSubscriber } from "../src/services/domain-events.js";
import { SUBSCRIBERS } from "../src/services/subscribers.js";
import { entitlementsFor } from "../src/services/entitlements.js";

/**
 * Extension points, proven with fixtures rather than products: a future module attaches to the platform event bus and the
 * entitlement service as they are. Nothing here ships to merchants (see packages/contracts/src/extensions.ts).
 */
const SECRET = "shpss_ext";
const enc = new TextEncoder();
async function webhook(env: Awaited<ReturnType<typeof makeEnv>>, shop: string, topic: string, body: unknown, id: string) {
  const raw = JSON.stringify(body);
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)))));
  return env.app.request("/api/v1/webhooks/shopify", { method: "POST", headers: { "x-shopify-hmac-sha256": sig, "x-shopify-topic": topic, "x-shopify-shop-domain": shop, "x-shopify-webhook-id": id, "content-type": "application/json" }, body: raw });
}

describe("extension points", () => {
  it("a loyalty module would get exactly-once points from the real order pipeline, using the contract's ledger rules", async () => {
    const env = await makeEnv(undefined, { secrets: { shopifyApiSecret: SECRET } });
    const u = await signup(env, "a@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "shopify", name: "S", domain: "a-shop.myshopify.com", currency: "USD" });
    await linkShop(env, s.json.data.id, "a-shop.myshopify.com");
    let ledger: LoyaltyLedgerEntry[] = [];
    const loyalty = defineSubscriber({
      name: "fixture.loyalty", events: ["order.created"],
      async handle(_d, e) {
        const points = pointsForOrder(e.payload.total, { pointsPerCurrencyUnit: 1, minimumOrder: 5 });
        if (points > 0) ledger = applyLedger(ledger, [{ contactId: "ctc_fixture", delta: points, reason: "order", orderRef: e.payload.externalOrderId, idempotencyKey: e.idempotencyKey, at: e.occurredAt }]).ledger;
      },
    });
    env.deps.subscribers = [...SUBSCRIBERS, loyalty];
    const order = { id: 42, total_price: "59.90", currency: "USD", created_at: "2026-10-27T10:00:00Z" };
    // Shopify can deliver the same order under two webhook ids; the event's idempotency key is the order, so points land once.
    expect((await webhook(env, "a-shop.myshopify.com", "orders/create", order, "w1")).status).toBe(200);
    expect((await webhook(env, "a-shop.myshopify.com", "orders/create", order, "w2")).status).toBe(200);
    await webhook(env, "a-shop.myshopify.com", "orders/create", { ...order, id: 43, total_price: "3.00" }, "w3"); // under the minimum
    expect(ledger.map((e) => [e.orderRef, e.delta])).toEqual([["42", 59]]);
  });

  it("the module stays switched off for every workspace until it is built: its capability is never granted", async () => {
    const env = await makeEnv();
    const u = await signup(env, "b@example.com");
    const ent = await entitlementsFor(env.deps, u.orgId);
    for (const c of ["loyalty.enabled", "reviews.enabled", "post_purchase.enabled"] as const) expect(ent.has(c)).toBe(false);
    const listed = ent.list().filter((x) => x.availability === "planned").map((x) => x.capability);
    expect(listed).toEqual(expect.arrayContaining(["loyalty.enabled", "reviews.enabled", "post_purchase.enabled"]));
  });
});
