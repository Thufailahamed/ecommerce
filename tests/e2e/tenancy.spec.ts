import { expect, test } from "@playwright/test";
import { API, WEB } from "./playwright.config";
import { apiPost, newMerchant, type Merchant } from "./support";

/**
 * Workflow F: two isolated workspaces against the real Worker. Every way of reaching the other workspace's data by
 * changing an id in a URL or a body is refused with the same 404 an unknown id gets, and errors carry nothing about it.
 */
let a: Merchant, b: Merchant;
let campaignId = "";
const SECRET_NAME = "A's confidential campaign";

test.describe.serial("tenant isolation, end to end", () => {
  test.beforeAll(async ({ browser }) => {
    a = await newMerchant(browser, { plan: "growth" });
    b = await newMerchant(browser, { plan: "growth" });
    const r = await apiPost(a.page, `/api/v1/stores/${a.storeId}/campaigns`, {
      schemaVersion: 1, name: SECRET_NAME, format: "popup", creative: { headline: "Secret", ctaLabel: "Go", ctaUrl: "/" }, style: {},
      trigger: { type: "delay", seconds: 5 }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" },
    });
    expect(r.status()).toBe(201);
    campaignId = (await r.json() as { data: { id: string } }).data.id;
  });

  test("another workspace's store, campaigns, contacts, integrations and audit log are invisible", async () => {
    const reads = [
      `/api/v1/stores/${a.storeId}`, `/api/v1/stores/${a.storeId}/campaigns`, `/api/v1/stores/${a.storeId}/campaigns/${campaignId}`,
      `/api/v1/stores/${b.storeId}/campaigns/${campaignId}`, // A's campaign id under B's own store
      `/api/v1/stores/${a.storeId}/contacts`, `/api/v1/stores/${a.storeId}/integrations`, `/api/v1/stores/${a.storeId}/audit`,
      `/api/v1/stores/${a.storeId}/analytics/tools?from=2026-10-01&to=2026-10-31`, `/api/v1/stores/${a.storeId}/shopify`, `/api/v1/stores/${a.storeId}/providers`,
    ];
    for (const path of reads) {
      const r = await b.page.request.get(`${API}${path}`);
      expect(r.status(), path).toBe(404);
      const text = await r.text();
      expect(text, path).not.toContain(SECRET_NAME);
      expect(text, path).not.toContain(a.siteKey);
    }
  });

  test("writes through substituted ids are refused and change nothing", async () => {
    const writes: [string, string, unknown][] = [
      ["POST", `/api/v1/stores/${a.storeId}/campaigns/${campaignId}/publish`, { approve: true, approvedUpdatedAt: "x" }],
      ["POST", `/api/v1/stores/${b.storeId}/campaigns/${campaignId}/archive`, {}],
      ["PUT", `/api/v1/stores/${a.storeId}/providers/klaviyo`, { apiKey: "pk_e2e_good" }],
      ["POST", `/api/v1/stores/${a.storeId}/integrations/klaviyo/health`, {}],
      ["POST", `/api/v1/stores/${a.storeId}/shopify/connect`, { shop: "victim.myshopify.com" }],
      ["PATCH", `/api/v1/stores/${a.storeId}/delivery`, { enabled: false }],
      ["DELETE", `/api/v1/stores/${a.storeId}`, undefined],
    ];
    for (const [method, path, data] of writes) {
      const r = await b.page.request.fetch(`${API}${path}`, { method, headers: { origin: WEB }, ...(data !== undefined ? { data } : {}) });
      expect(r.status(), `${method} ${path}`).toBe(404);
    }
    const mine = await a.page.request.get(`${API}/api/v1/stores/${a.storeId}/campaigns/${campaignId}`);
    expect((await mine.json() as { data: { status: string; name: string } }).data).toMatchObject({ status: "draft", name: SECRET_NAME });
    const store = await a.page.request.get(`${API}/api/v1/stores/${a.storeId}`);
    expect((await store.json() as { data: { deliveryEnabled: boolean } }).data.deliveryEnabled).toBe(true);
  });

  test("a request from another site is refused before it reaches any workspace (CSRF)", async () => {
    const r = await a.page.request.post(`${API}/api/v1/stores/${a.storeId}/campaigns/${campaignId}/archive`, { headers: { origin: "https://evil.example" }, data: {} });
    expect(r.status()).toBe(403);
  });

  test("the dashboard shows nothing of the other workspace when an id is pasted into the URL", async () => {
    await b.page.goto(`/app/campaigns/${campaignId}`);
    await expect(b.page.getByText(SECRET_NAME)).toHaveCount(0);
    await expect(b.page.getByText(/not found/i).first()).toBeVisible();
  });
});
