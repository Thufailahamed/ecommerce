import { createHmac } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { API, WOO_MOCK } from "./playwright.config";
import { apiPost, newMerchant, setPlanFor, type Merchant } from "./support";

/**
 * Connecting a WooCommerce store, end to end, with the real Worker and a real browser. The browser goes to the store's
 * https://<domain>/wc-auth/v1/authorize page; page.route plays the merchant approving there and WooCommerce posting the keys
 * to the API, then sends the browser back exactly as WooCommerce documents. The Worker's own REST calls go to
 * mock-woocommerce.mjs. Nothing here touches a real WordPress site.
 */
let m: Merchant;
let storeId = "";
const DOMAIN = `woo-e2e-${Date.now().toString(36)}.example`;
const CK = `ck_${"a".repeat(40)}`;
const CS = `cs_${"b".repeat(40)}`;

/** Plays the store's approval page: the merchant approves, WooCommerce posts the keys to callback_url, then redirects back. */
async function actAsWooCommerce(page: Page) {
  await page.route(`https://${DOMAIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/wc-auth/v1/authorize") return route.fulfill({ status: 404, body: "not part of this test" });
    expect(url.searchParams.get("scope")).toBe("read_write");
    expect(url.searchParams.get("callback_url")).toBe(`${API}/api/v1/woocommerce/callback`);
    const userId = url.searchParams.get("user_id")!;
    await fetch(`${WOO_MOCK}/__keys?domain=${DOMAIN}&ck=${CK}&cs=${CS}&permissions=read_write`, { method: "POST" });
    // Server to server, as WooCommerce does it: no cookie, no browser origin.
    const cb = await fetch(url.searchParams.get("callback_url")!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key_id: 1, user_id: userId, consumer_key: CK, consumer_secret: CS, key_permissions: "read_write" }) });
    expect(cb.status).toBe(200);
    const back = new URL(url.searchParams.get("return_url")!);
    back.searchParams.set("success", "1"); back.searchParams.set("user_id", userId);
    return route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
}

interface MockHook { id: number; topic: string; status: string; delivery_url: string; secret: string }
const hooks = async () => (await (await fetch(`${WOO_MOCK}/__hooks?domain=${DOMAIN}`)).json()) as MockHook[];
/** WooCommerce delivering one of the app's webhooks, signed with the secret the app gave it. */
async function deliver(page: Page, topic: string, payload: unknown) {
  const h = (await hooks()).find((x) => x.topic === topic)!;
  const raw = JSON.stringify(payload);
  return page.request.post(h.delivery_url, { data: raw, headers: {
    "content-type": "application/json", "x-wc-webhook-topic": topic, "x-wc-webhook-delivery-id": crypto.randomUUID().replace(/-/g, ""),
    "x-wc-webhook-signature": createHmac("sha256", h.secret).update(raw).digest("base64"),
  } });
}

test.describe.serial("WooCommerce, end to end", () => {
  test.beforeAll(async ({ browser }) => {
    m = await newMerchant(browser);
    setPlanFor(m.email, "growth"); // room for a second store
    const orgId = (await (await m.page.request.get(`${API}/api/v1/auth/me`)).json()).data.organizations[0].id;
    const r = await apiPost(m.page, "/api/v1/stores", { organizationId: orgId, platform: "woocommerce", name: "E2E Woo", domain: DOMAIN, currency: "USD" });
    expect(r.status()).toBe(201);
    storeId = (await r.json() as { data: { id: string } }).data.id;
  });

  test("the merchant connects with one click, approves at the store, and comes back with webhooks set up", async () => {
    await actAsWooCommerce(m.page);
    await m.page.goto(`/app/settings?store=${storeId}`);
    await m.page.getByRole("button", { name: "Connect WooCommerce", exact: true }).click();
    await expect(m.page).toHaveURL(new RegExp(`/app/settings\\?woocommerce=returned&store=${storeId}&success=1`));
    await expect(m.page.getByText(/WooCommerce is connected/)).toBeVisible();
    await expect(m.page.getByText("6 webhooks active")).toBeVisible();
    const created = await hooks();
    expect(created.map((h) => h.topic).sort()).toEqual(["order.created", "order.updated", "product.created", "product.deleted", "product.restored", "product.updated"]);
    expect(created.every((h) => h.delivery_url.startsWith(`${API}/api/v1/webhooks/woocommerce/${storeId}?c=`))).toBe(true);
    expect(new Set(created.map((h) => h.delivery_url)).size).toBe(1);
    const view = await (await m.page.request.get(`${API}/api/v1/stores/${storeId}/woocommerce`)).json();
    expect(view.data).toMatchObject({ connected: true, method: "authorize", keyPermissions: "read_write", verifiedAt: expect.any(String) });
    expect(JSON.stringify(view)).not.toContain(CS);
  });

  test("the catalog syncs page by page, variable products with their variations", async () => {
    await fetch(`${WOO_MOCK}/__products?domain=${DOMAIN}&count=30&variable=1`, { method: "POST" });
    await m.page.getByRole("button", { name: "Sync catalog now" }).click();
    await expect(m.page.getByText("Done: 31 products synced from WooCommerce.")).toBeVisible({ timeout: 20_000 });
    const products = (await (await m.page.request.get(`${API}/api/v1/stores/${storeId}/products`)).json() as { data: { externalId: string }[] }).data;
    expect(products).toHaveLength(31);
    const health = await apiPost(m.page, `/api/v1/stores/${storeId}/integrations/woocommerce/health`, {});
    expect((await health.json() as { data: { ok: boolean } }).data.ok).toBe(true);
  });

  test("signed webhooks update products and record orders once", async () => {
    expect((await deliver(m.page, "product.updated", { id: 1, name: "Renamed by webhook", type: "simple", status: "publish", stock_status: "instock", price: "12.00" })).status()).toBe(200);
    const products = (await (await m.page.request.get(`${API}/api/v1/stores/${storeId}/products`)).json() as { data: { externalId: string; title: string }[] }).data;
    expect(products.find((p) => p.externalId === "1")?.title).toBe("Renamed by webhook");
    const order = { id: 9001, status: "processing", total: "44.00", currency: "USD", date_created_gmt: "2026-10-29T09:00:00", billing: { email: "shopper@example.com" } };
    await deliver(m.page, "order.created", order);
    await deliver(m.page, "order.updated", { ...order, status: "completed" });
    const events = (await (await m.page.request.get(`${API}/api/v1/stores/${storeId}/platform-events`)).json() as { data: { type: string; source: string }[] }).data;
    expect(events.filter((e) => e.type === "order.created")).toEqual([expect.objectContaining({ source: "woocommerce_webhook" })]);
    // A forged delivery is refused.
    const h = (await hooks())[0]!;
    const forged = await m.page.request.post(h.delivery_url, { data: "{}", headers: { "x-wc-webhook-topic": "product.updated", "x-wc-webhook-signature": "AAAA" } });
    expect(forged.status()).toBe(401);
  });

  test("disconnecting WooCommerce removes the webhooks from the store and keeps the catalog", async () => {
    m.page.once("dialog", (d) => void d.accept());
    await m.page.getByRole("button", { name: "Disconnect WooCommerce" }).click();
    await expect(m.page.getByRole("button", { name: "Connect WooCommerce", exact: true })).toBeVisible();
    expect(await hooks()).toHaveLength(0);
    const products = (await (await m.page.request.get(`${API}/api/v1/stores/${storeId}/products`)).json() as { data: unknown[] }).data;
    expect(products).toHaveLength(31);
  });
});
