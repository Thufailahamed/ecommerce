import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { HttpError, type Deps } from "../deps.js";
import type { PlanId } from "../plans.js";

const enc = new TextEncoder();
const PAID: PlanId[] = ["starter", "growth", "scale"];

/** Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">. Rejects stale timestamps (replay). */
export async function verifyStripeSignature(raw: string, header: string | undefined, secret: string, nowMs: number, toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts["t"]);
  const v1 = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(t) || v1.length === 0 || Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return v1.some((s) => s.length === hex.length && [...s].reduce((acc, c, i) => acc | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

function form(o: Record<string, string>): string {
  return new URLSearchParams(o).toString();
}

export async function createCheckout(d: Deps, organizationId: string, plan: PlanId, email: string) {
  const s = d.secrets;
  const price = plan !== "free" ? s?.stripePrices?.[plan as "starter" | "growth" | "scale"] : undefined;
  if (!s?.stripeSecretKey || !price || !s.webOrigin) throw new HttpError(503, "billing_unavailable", "Billing is not configured yet");
  if (!PAID.includes(plan)) throw new HttpError(400, "invalid_plan", "Choose a paid plan");
  const res = await (d.fetchFn ?? fetch)("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${s.stripeSecretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: form({
      mode: "subscription", "line_items[0][price]": price, "line_items[0][quantity]": "1",
      client_reference_id: organizationId, customer_email: email,
      "metadata[plan]": plan, "subscription_data[metadata][plan]": plan, "subscription_data[metadata][organizationId]": organizationId,
      success_url: `${s.webOrigin}/app/settings?billing=success`, cancel_url: `${s.webOrigin}/app/settings?billing=cancelled`,
    }),
  });
  if (!res.ok) throw new HttpError(502, "billing_provider_error", "Could not start checkout");
  const j = (await res.json()) as { url?: string };
  if (!j.url) throw new HttpError(502, "billing_provider_error", "Could not start checkout");
  return j.url;
}

/** Stripe-hosted page where the owner updates the card, downloads invoices or cancels. */
export async function createPortal(d: Deps, organizationId: string) {
  const s = d.secrets;
  if (!s?.stripeSecretKey || !s.webOrigin) throw new HttpError(503, "billing_unavailable", "Billing is not configured yet");
  const [sub] = await d.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, organizationId)).limit(1);
  if (!sub?.customerRef) throw new HttpError(409, "no_subscription", "There is no paid subscription to manage yet");
  const res = await (d.fetchFn ?? fetch)("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${s.stripeSecretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: form({ customer: sub.customerRef, return_url: `${s.webOrigin}/app/settings` }),
  });
  if (!res.ok) throw new HttpError(502, "billing_provider_error", "Could not open the billing portal");
  const j = (await res.json()) as { url?: string };
  if (!j.url) throw new HttpError(502, "billing_provider_error", "Could not open the billing portal");
  return j.url;
}

const STATUS: Record<string, "active" | "trialing" | "past_due" | "cancelled"> = {
  active: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due", incomplete: "past_due",
  canceled: "cancelled", incomplete_expired: "cancelled", paused: "cancelled",
};

interface StripeEvent { id: string; type: string; data: { object: Record<string, unknown> } }

/** Subscription state is derived from Stripe events only. A client can never set its own plan. */
export async function handleStripeEvent(d: Deps, ev: StripeEvent): Promise<"processed" | "ignored"> {
  const o = ev.data.object;
  const meta = (o["metadata"] ?? {}) as Record<string, string>;
  const set = (orgId: string, v: Partial<typeof schema.subscriptions.$inferInsert>) =>
    d.db.update(schema.subscriptions).set({ ...v, updatedAt: d.now().toISOString() }).where(eq(schema.subscriptions.organizationId, orgId));

  if (ev.type === "checkout.session.completed") {
    const orgId = typeof o["client_reference_id"] === "string" ? o["client_reference_id"] : undefined;
    const plan = meta["plan"] as PlanId | undefined;
    if (!orgId || !plan || !PAID.includes(plan)) return "ignored";
    await set(orgId, { plan, status: "active", providerRef: typeof o["subscription"] === "string" ? o["subscription"] : null, ...(typeof o["customer"] === "string" ? { customerRef: o["customer"] } : {}) });
    return "processed";
  }
  if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
    const ref = typeof o["id"] === "string" ? o["id"] : undefined;
    if (!ref) return "ignored";
    const [row] = await d.db.select().from(schema.subscriptions).where(and(eq(schema.subscriptions.providerRef, ref))).limit(1);
    if (!row) return "ignored";
    const status = ev.type === "customer.subscription.deleted" ? "cancelled" : STATUS[String(o["status"])] ?? "past_due";
    const plan = meta["plan"] as PlanId | undefined;
    const end = typeof o["current_period_end"] === "number" ? new Date(o["current_period_end"] * 1000).toISOString() : null;
    await set(row.organizationId, { status, ...(plan && PAID.includes(plan) ? { plan } : {}), currentPeriodEnd: end, ...(typeof o["customer"] === "string" ? { customerRef: o["customer"] } : {}) });
    return "processed";
  }
  return "ignored";
}
