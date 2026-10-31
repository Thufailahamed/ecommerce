import { createHmac } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { API, SHOPIFY_MOCK, SHOPIFY_SECRET, WEB } from "./playwright.config";
import { apiPost, newMerchant, setPlanFor, type Merchant } from "./support";

/**
 * Workflow A (installation and onboarding) plus Shopify Billing, with the real Worker and a real browser. The browser
 * visits https://<shop>.myshopify.com for authorization and billing approval; page.route plays the merchant at Shopify and
 * sends the browser back exactly as Shopify documents. The Worker's own calls (token exchange, Admin GraphQL) go to
 * mock-shopify.mjs. Nothing here touches a real Shopify store.
 */
let m: Merchant;
let storeId = "";
let siteKey = "";
const SHOP = `e2e-${Date.now().toString(36)}.myshopify.com`;

const hmacHex = (msg: string) => createHmac("sha256", SHOPIFY_SECRET).update(msg).digest("hex");
const signedQuery = (q: Record<string, string>) => {
  const p = new URLSearchParams();
  const all = { ...q, timestamp: String(Math.floor(Date.now() / 1000)) };
  for (const k of Object.keys(all).sort()) p.append(k, all[k as keyof typeof all]!);
  return `${p.toString()}&hmac=${hmacHex(p.toString())}`;
};

/** Plays Shopify's side of authorization and billing approval for SHOP in this page. */
async function actAsShopify(page: Page, opts: { approveCharge?: "ACTIVE" | "DECLINED" } = {}) {
  await page.route(`https://${SHOP}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/admin/oauth/authorize") {
      expect(url.searchParams.get("client_id")).toBe("e2e_client_id");
      expect(url.searchParams.get("scope")).toBe("read_products,read_inventory,read_orders,read_themes,write_pixels,read_customer_events");
      expect(url.searchParams.get("redirect_uri")).toBe(`${API}/api/v1/shopify/callback`);
      const { code } = await (await fetch(`${SHOPIFY_MOCK}/__approve?shop=${SHOP}`, { method: "POST" })).json() as { code: string };
      const back = `${API}/api/v1/shopify/callback?${signedQuery({ code, shop: SHOP, state: url.searchParams.get("state")!, host: Buffer.from(`admin.shopify.com/store/${SHOP}`).toString("base64") })}`;
      return route.fulfill({ status: 302, headers: { location: back } });
    }
    const charge = /\/admin\/charges\/e2e\/(\d+)\//.exec(url.pathname)?.[1];
    if (charge) {
      await fetch(`${SHOPIFY_MOCK}/__charge?id=${encodeURIComponent(`gid://shopify/AppSubscription/${charge}`)}&status=${opts.approveCharge ?? "ACTIVE"}`, { method: "POST" });
      return route.fulfill({ status: 302, headers: { location: `${API}/api/v1/billing/shopify/return?store=${storeId}&charge_id=${charge}` } });
    }
    return route.fulfill({ status: 404, body: "not part of this test" });
  });
}

const webhook = (page: Page, topic: string, body: unknown) => {
  const raw = JSON.stringify(body);
  return page.request.post(`${API}/api/v1/webhooks/shopify`, { data: raw, headers: {
    "content-type": "application/json", "x-shopify-topic": topic, "x-shopify-shop-domain": SHOP, "x-shopify-webhook-id": crypto.randomUUID(),
    "x-shopify-hmac-sha256": createHmac("sha256", SHOPIFY_SECRET).update(raw).digest("base64"),
  } });
};

test.describe.serial("Shopify app, end to end", () => {
  test.beforeAll(async ({ browser }) => {
    m = await newMerchant(browser);
    setPlanFor(m.email, "growth"); // room for a second store
    const r = await apiPost(m.page, "/api/v1/stores", { organizationId: (await (await m.page.request.get(`${API}/api/v1/auth/me`)).json()).data.organizations[0].id, platform: "shopify", name: "E2E Shopify", domain: SHOP, currency: "USD" });
    expect(r.status()).toBe(201);
    ({ id: storeId, siteKey } = (await r.json() as { data: { id: string; siteKey: string } }).data);
  });

  test("the merchant installs the app from Settings and comes back connected", async () => {
    await actAsShopify(m.page);
    await m.page.goto(`/app/settings?store=${storeId}`);
    await expect(m.page.getByText("Shopify app")).toBeVisible();
    await expect(m.page.getByLabel("Shopify store address")).toHaveValue(SHOP);
    await m.page.getByRole("button", { name: "Install on Shopify" }).click();
    await expect(m.page).toHaveURL(`${WEB}/app/settings?shopify=connected&store=${storeId}`);
    await expect(m.page.getByText(/Shopify is connected/)).toBeVisible();
    await expect(m.page.getByRole("combobox", { name: "Store" })).toHaveValue(storeId); // lands on the store just connected, not another one
    await expect(m.page.getByText("Installed", { exact: true })).toBeVisible();
    const status = await (await m.page.request.get(`${API}/api/v1/stores/${storeId}/shopify`)).json() as { data: Record<string, unknown> };
    expect(status.data).toMatchObject({ shop: SHOP, status: "installed", connected: true, missingScopes: [] });
    expect(JSON.stringify(status)).not.toContain("shpat_");
    // The app set up its own storefront pieces: the pixel exists at Shopify with the store's site key, and the embed is prefilled.
    const setup = await (await fetch(`${SHOPIFY_MOCK}/__setup?shop=${SHOP}`)).json() as { pixel: { settings: unknown } | null; metafields: Record<string, string> | null };
    expect(setup.pixel?.settings).toEqual({ site_key: siteKey, api_url: API });
    expect(setup.metafields).toMatchObject({ site_key: siteKey, api_url: API });
    const checklist = m.page.getByRole("list", { name: "Shopify setup" });
    await expect(checklist.getByText("Purchase pixel active")).toBeVisible();
    await expect(checklist.getByText("Switch on the app embed")).toBeVisible();
    await fetch(`${SHOPIFY_MOCK}/__embed?shop=${SHOP}&on=1`, { method: "POST" });
    await m.page.getByRole("button", { name: "Check again" }).click();
    await expect(checklist.getByText("App embed is on")).toBeVisible();
  });

  test("the catalog synchronises page by page with Shopify's availability, and the integration is healthy", async () => {
    await fetch(`${SHOPIFY_MOCK}/__products?shop=${SHOP}&count=12`, { method: "POST" });
    await m.page.getByRole("button", { name: "Sync catalog from Shopify" }).click();
    await expect(m.page.getByText("Done: 12 products synced from Shopify.")).toBeVisible({ timeout: 20_000 });
    const products = (await (await m.page.request.get(`${API}/api/v1/stores/${storeId}/products`)).json() as { data: { externalId: string; availability?: string }[] }).data;
    expect(products).toHaveLength(12);
    expect(products.map((p) => p.externalId).sort()).toContain("7001");

    const integrations = (await (await m.page.request.get(`${API}/api/v1/stores/${storeId}/integrations`)).json() as { data: { key: string; status: { state: string } }[] }).data;
    expect(integrations.find((i) => i.key === "shopify")?.status.state).toBe("connected");
    const health = await apiPost(m.page, `/api/v1/stores/${storeId}/integrations/shopify/health`, {});
    expect((await health.json() as { data: { ok: boolean } }).data.ok).toBe(true);
    await m.page.goto("/app");
    await expect(m.page.getByRole("heading", { name: "E2E Shopify" }).first()).toBeVisible();
  });

  test("plans are bought through Shopify Billing, and only change once Shopify says the charge is active", async () => {
    await m.page.goto(`/app/settings?store=${storeId}`);
    await expect(m.page.getByText(/charged through your Shopify bill/)).toBeVisible();
    const scale = m.page.getByRole("row", { name: /^scale/i });
    await scale.getByRole("button", { name: "Choose" }).click();
    await expect(m.page).toHaveURL(`${WEB}/app/settings?billing=success&store=${storeId}`);
    await expect(m.page.getByText("Your plan is active.")).toBeVisible();
    await expect(m.page.getByText("billed through Shopify")).toBeVisible();
    const sub = await (await m.page.request.get(`${API}/api/v1/billing/subscription?organizationId=${(await (await m.page.request.get(`${API}/api/v1/auth/me`)).json()).data.organizations[0].id}`)).json() as { data: { plan: string; provider: string; status: string } };
    expect(sub.data).toMatchObject({ plan: "scale", provider: "shopify", status: "active" });
  });

  test("uninstalling stops serving the store and ends the Shopify subscription; data stays until Shopify asks for it to be deleted", async () => {
    expect((await webhook(m.page, "app/uninstalled", { id: 1, domain: SHOP })).status()).toBe(200);
    const stores = (await (await m.page.request.get(`${API}/api/v1/stores`)).json() as { data: { id: string }[] }).data;
    expect(stores.map((s) => s.id)).not.toContain(storeId);
    const orgId = (await (await m.page.request.get(`${API}/api/v1/auth/me`)).json()).data.organizations[0].id;
    const sub = await (await m.page.request.get(`${API}/api/v1/billing/subscription?organizationId=${orgId}`)).json() as { data: { status: string } };
    expect(sub.data.status).toBe("cancelled");
    // A forged webhook is refused outright.
    const forged = await m.page.request.post(`${API}/api/v1/webhooks/shopify`, { data: "{}", headers: { "content-type": "application/json", "x-shopify-topic": "shop/redact", "x-shopify-shop-domain": SHOP, "x-shopify-hmac-sha256": "AAAA" } });
    expect(forged.status()).toBe(401);
  });

  test("an install that starts in the Shopify admin is claimed into a workspace after signing in", async () => {
    // Reinstall from the Shopify admin (App URL): Shopify signs the launch link, the app sends the merchant to authorize.
    await actAsShopify(m.page);
    // page.route does not see a request reached through a server redirect, so follow the App URL's redirect by hand.
    const launch = await m.page.request.get(`${API}/api/v1/shopify/install?${signedQuery({ shop: SHOP })}`, { maxRedirects: 0 });
    expect(launch.status()).toBe(302);
    const authorize = launch.headers()["location"]!;
    expect(new URL(authorize).origin).toBe(`https://${SHOP}`);
    await m.page.goto(authorize);
    await expect(m.page).toHaveURL(/\/connect\/shopify\?claim=/);
    await expect(m.page.getByText(SHOP)).toBeVisible();
    // Uninstalling ended the Shopify subscription, so the workspace is on Free (one store) and already has another one.
    await m.page.getByRole("button", { name: "Connect store" }).click();
    await expect(m.page.getByText(/Your plan allows 1 connected store/)).toBeVisible();
    setPlanFor(m.email, "growth");
    await m.page.getByRole("button", { name: "Connect store" }).click();
    await expect(m.page).toHaveURL(`${WEB}/app/settings?shopify=connected&store=${storeId}`);
    const stores = (await (await m.page.request.get(`${API}/api/v1/stores`)).json() as { data: { id: string }[] }).data;
    expect(stores.map((s) => s.id)).toContain(storeId); // the same store came back, with its campaigns and catalog
  });
});
