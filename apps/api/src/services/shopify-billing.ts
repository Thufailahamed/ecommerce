import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { PLANS, type PlanId } from "@convertflow/contracts";
import { HttpError, type Deps } from "../deps.js";
import { recordAudit } from "./audit.js";
import { republishOrganization } from "./campaigns.js";
import { adminGraphql, shopifyAccess, shopifyConfig, shopifyHttpError } from "./shopify-app.js";

/**
 * Shopify Billing for workspaces whose store came through the Shopify app (the App Store requires it for those). The
 * subscription's state comes only from Shopify: the return URL and the `app_subscriptions/update` webhook are both
 * checked against Shopify's own answer, never trusted from the request.
 *
 * VERIFICATION STATUS: written to Shopify's documented GraphQL Billing API (appSubscriptionCreate, appSubscriptionCancel,
 * AppSubscription status) and tested against a fake. Never run against a real Shopify store.
 */

type Store = typeof schema.stores.$inferSelect;
const { subscriptions: subs } = schema;
const PAID: PlanId[] = ["starter", "growth", "scale"];
/** The name shown to the merchant on Shopify's approval page. The plan is read back from it on webhooks, so it is fixed. */
export const planChargeName = (plan: PlanId) => `ConvertFlow ${plan[0]!.toUpperCase()}${plan.slice(1)}`;
const planFromName = (name: unknown): PlanId | undefined => {
  const m = typeof name === "string" ? /^ConvertFlow (Starter|Growth|Scale)$/.exec(name) : null;
  return m ? (m[1]!.toLowerCase() as PlanId) : undefined;
};
const gidOf = (chargeId: string) => (chargeId.startsWith("gid://shopify/AppSubscription/") ? chargeId : `gid://shopify/AppSubscription/${chargeId}`);

const CREATE = `mutation Subscribe($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $test: Boolean, $trialDays: Int) {
  appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, test: $test, trialDays: $trialDays) {
    userErrors { field message }
    confirmationUrl
    appSubscription { id status }
  }
}`;
const READ = `query Charge($id: ID!) { node(id: $id) { ... on AppSubscription { id name status test trialDays createdAt currentPeriodEnd } } }`;
const CANCEL = `mutation Cancel($id: ID!) { appSubscriptionCancel(id: $id) { userErrors { field message } appSubscription { id status } } }`;

interface Charge { id: string; name: string; status: string; test: boolean; trialDays: number; createdAt: string; currentPeriodEnd: string | null }

/** The workspace's Shopify-linked store that billing goes through (the one named, or the only one). */
async function billingStore(d: Deps, organizationId: string, storeId?: string): Promise<Store> {
  const rows = await d.db.select().from(schema.stores).where(and(eq(schema.stores.organizationId, organizationId), eq(schema.stores.platform, "shopify"), eq(schema.stores.status, "active")));
  const linked = [];
  for (const s of rows) if (!storeId || s.id === storeId) { try { await shopifyAccess(d, s); linked.push(s); } catch { /* not installed */ } }
  if (!linked[0]) throw new HttpError(409, "shopify_not_installed", "Billing through Shopify needs a store with the Shopify app installed");
  return linked[0];
}

/** Starts a subscription; the merchant approves it on Shopify's page at the returned URL. Nothing changes here until they do. */
export async function startShopifySubscription(d: Deps, actorId: string, organizationId: string, plan: PlanId, storeId?: string): Promise<string> {
  const cfg = shopifyConfig(d);
  if (!cfg) throw new HttpError(503, "billing_unavailable", "Shopify billing is not configured on this deployment");
  if (!PAID.includes(plan)) throw new HttpError(400, "invalid_plan", "Choose a paid plan");
  const [current] = await d.db.select().from(subs).where(eq(subs.organizationId, organizationId)).limit(1);
  if (current?.provider === "stripe" && (current.status === "active" || current.status === "trialing") && current.plan !== "free") {
    throw new HttpError(409, "billed_by_stripe", "This workspace already pays by card. Cancel that subscription first to switch to Shopify billing.");
  }
  const store = await billingStore(d, organizationId, storeId);
  const { shop, token } = await shopifyAccess(d, store);
  let r: { appSubscriptionCreate: { userErrors: { message: string }[]; confirmationUrl: string | null; appSubscription: { id: string } | null } };
  try {
    r = await adminGraphql(d, shop, token, CREATE, {
      name: planChargeName(plan), returnUrl: `${cfg.apiOrigin}/api/v1/billing/shopify/return?store=${encodeURIComponent(store.id)}`,
      lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: PLANS[plan].priceUsdMonthly, currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } }],
      test: d.secrets?.shopifyBillingTest === true, trialDays: d.secrets?.shopifyTrialDays ?? 0,
    });
  } catch (e) { throw shopifyHttpError(e); }
  const out = r.appSubscriptionCreate;
  if (out.userErrors.length || !out.confirmationUrl || !out.appSubscription) throw new HttpError(502, "shopify_billing_error", "Shopify could not start the subscription");
  // Shopify sends the merchant to this URL only; check it really is Shopify's before handing it to the browser.
  const host = (() => { try { return new URL(out.confirmationUrl).hostname; } catch { return ""; } })();
  if (host !== shop && host !== "admin.shopify.com" && !cfg.adminBaseUrl) throw new HttpError(502, "shopify_billing_error", "Shopify returned an unexpected approval address");
  await recordAudit(d, { action: "billing.shopify_requested", actorId, storeId: store.id, organizationId, targetType: "subscription", targetId: out.appSubscription.id, summary: { plan } });
  return out.confirmationUrl;
}

/**
 * Applies Shopify's word about one charge. Only the workspace's current charge can be cancelled or frozen by it, so a
 * merchant who declines an upgrade keeps the plan they already pay for. Returns the workspace's resulting status.
 */
async function applyCharge(d: Deps, organizationId: string, shop: string, c: Charge): Promise<string | null> {
  const [row] = await d.db.select().from(subs).where(eq(subs.organizationId, organizationId)).limit(1);
  const plan = planFromName(c.name);
  const now = d.now();
  const set = (v: Partial<typeof subs.$inferInsert>) => d.db.update(subs).set({ ...v, updatedAt: now.toISOString() }).where(eq(subs.organizationId, organizationId));
  const mine = row?.provider === "shopify" && row.providerRef === c.id;
  let status: "active" | "trialing" | "past_due" | "cancelled" | null = null;
  if (c.status === "ACTIVE" && plan) {
    const trialEnds = Date.parse(c.createdAt) + c.trialDays * 86_400_000;
    status = c.trialDays > 0 && now.getTime() < trialEnds ? "trialing" : "active";
    if (mine && row.plan === plan && row.status === status && row.customerRef === shop && row.currentPeriodEnd === c.currentPeriodEnd) return status; // already so: a redelivery or a daily re-check
    await set({ plan, status, provider: "shopify", providerRef: c.id, customerRef: shop, currentPeriodEnd: c.currentPeriodEnd });
  } else if ((c.status === "CANCELLED" || c.status === "EXPIRED" || c.status === "DECLINED") && mine) {
    status = "cancelled";
    if (row.status === status) return status;
    await set({ status });
  } else if (c.status === "FROZEN" && mine) {
    status = "past_due";
    if (row.status === status) return status;
    await set({ status });
  } else return null; // PENDING / ACCEPTED, or about a charge that is not the workspace's current one: nothing changes
  await recordAudit(d, { action: "billing.shopify_status", actorId: null, actorType: "platform", organizationId, targetType: "subscription", targetId: c.id, summary: { shopifyStatus: c.status, status, plan: plan ?? null, test: c.test } });
  await republishOrganization(d, organizationId); // entitlements changed: storefront configs follow at once
  return status;
}

async function readCharge(d: Deps, store: Store, id: string): Promise<Charge | null> {
  const { shop, token } = await shopifyAccess(d, store);
  const r = await adminGraphql<{ node: Charge | null }>(d, shop, token, READ, { id: gidOf(id) });
  return r.node && typeof r.node.status === "string" ? r.node : null;
}

/** Shopify's return URL after the merchant approved or declined. The charge id in the URL is only a hint: we ask Shopify. */
export async function confirmShopifyReturn(d: Deps, storeId: string, chargeId: string): Promise<string> {
  const cfg = shopifyConfig(d);
  const settings = (q: string) => `${cfg?.webOrigin ?? ""}/app/settings?billing=${q}&store=${encodeURIComponent(storeId)}`;
  if (!cfg || !/^(gid:\/\/shopify\/AppSubscription\/)?\d{1,20}$/.test(chargeId)) return settings("error");
  const [store] = await d.db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) return settings("error");
  try {
    const c = await readCharge(d, store, chargeId);
    if (!c) return settings("error");
    const status = await applyCharge(d, store.organizationId, (await shopifyAccess(d, store)).shop, c);
    return settings(status === "active" || status === "trialing" ? "success" : c.status === "DECLINED" ? "declined" : "pending");
  } catch { return settings("error"); }
}

/**
 * `app_subscriptions/update`. The payload names the charge; its status is re-read from Shopify when the shop is still
 * installed (so a replayed or out-of-order delivery cannot set a stale state). After an uninstall the token is gone, so
 * only a cancellation of the current charge is accepted from the signed payload.
 */
export async function handleSubscriptionWebhook(d: Deps, store: Store | null, shop: string, body: Record<string, unknown>): Promise<boolean> {
  const sub = (body["app_subscription"] ?? {}) as Record<string, unknown>;
  const id = typeof sub["admin_graphql_api_id"] === "string" ? sub["admin_graphql_api_id"] : undefined;
  if (!id || !store) return false;
  let charge: Charge | null = null;
  try { charge = await readCharge(d, store, id); } catch { /* uninstalled or unreachable: fall through to the payload */ }
  if (!charge) {
    const status = String(sub["status"] ?? "").toUpperCase();
    if (status !== "CANCELLED" && status !== "EXPIRED") return false;
    charge = { id, name: String(sub["name"] ?? ""), status, test: false, trialDays: 0, createdAt: d.now().toISOString(), currentPeriodEnd: null };
  }
  return (await applyCharge(d, store.organizationId, shop, charge)) !== null;
}

/**
 * Daily safety net: re-read the workspace's current charge from Shopify and apply it, so a lost or failed
 * app_subscriptions/update webhook cannot leave a plan active (or frozen) longer than a day. True when something changed.
 */
export async function reconcileShopifyCharge(d: Deps, organizationId: string): Promise<boolean> {
  const [row] = await d.db.select().from(subs).where(eq(subs.organizationId, organizationId)).limit(1);
  if (row?.provider !== "shopify" || !row.providerRef) return false;
  const store = await billingStore(d, organizationId);
  const c = await readCharge(d, store, row.providerRef);
  if (!c) return false;
  const before = `${row.plan}:${row.status}:${row.currentPeriodEnd}`;
  await applyCharge(d, organizationId, (await shopifyAccess(d, store)).shop, c);
  const [after] = await d.db.select().from(subs).where(eq(subs.organizationId, organizationId)).limit(1);
  return `${after?.plan}:${after?.status}:${after?.currentPeriodEnd}` !== before;
}

/** The workspace owner cancels from the dashboard. Shopify confirms; the plan falls back to Free; nothing is deleted. */
export async function cancelShopifySubscription(d: Deps, actorId: string, organizationId: string): Promise<void> {
  const [row] = await d.db.select().from(subs).where(eq(subs.organizationId, organizationId)).limit(1);
  if (row?.provider !== "shopify" || !row.providerRef || row.status === "cancelled") throw new HttpError(409, "no_subscription", "There is no Shopify subscription to cancel");
  const store = await billingStore(d, organizationId);
  const { shop, token } = await shopifyAccess(d, store);
  let r: { appSubscriptionCancel: { userErrors: { message: string }[]; appSubscription: { id: string; status: string } | null } };
  try { r = await adminGraphql(d, shop, token, CANCEL, { id: row.providerRef }); } catch (e) { throw shopifyHttpError(e); }
  if (r.appSubscriptionCancel.userErrors.length || !r.appSubscriptionCancel.appSubscription) throw new HttpError(502, "shopify_billing_error", "Shopify could not cancel the subscription");
  await recordAudit(d, { action: "billing.shopify_cancel_requested", actorId, organizationId, targetType: "subscription", targetId: row.providerRef });
  await applyCharge(d, organizationId, shop, { id: row.providerRef, name: "", status: r.appSubscriptionCancel.appSubscription.status, test: false, trialDays: 0, createdAt: d.now().toISOString(), currentPeriodEnd: null });
}

/** Uninstalling cancels the app's charges at Shopify; mirror that at once instead of waiting for the webhook. */
export async function cancelOnUninstall(d: Deps, organizationId: string, shop: string): Promise<void> {
  const [row] = await d.db.select().from(subs).where(eq(subs.organizationId, organizationId)).limit(1);
  if (row?.provider !== "shopify" || row.customerRef !== shop || row.status === "cancelled") return;
  await d.db.update(subs).set({ status: "cancelled", updatedAt: d.now().toISOString() }).where(eq(subs.organizationId, organizationId));
  await recordAudit(d, { action: "billing.shopify_status", actorId: null, actorType: "platform", organizationId, targetType: "subscription", targetId: row.providerRef ?? shop, summary: { shopifyStatus: "UNINSTALLED", status: "cancelled" } });
  await republishOrganization(d, organizationId);
}
