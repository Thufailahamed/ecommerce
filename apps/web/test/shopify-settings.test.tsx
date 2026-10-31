import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Store } from "@/lib/api";

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

const store: Store = { id: "sto_1", name: "Ember", platform: "shopify", domain: "ember.myshopify.com", siteKey: "cf_key", currency: "USD", deliveryEnabled: true, organizationId: "o1" };
const install = (over: Record<string, unknown> = {}) => ({ configured: true, shop: null, status: "not_installed", connected: false, scopes: [], missingScopes: [], installedAt: null, uninstalledAt: null, ...over });

beforeEach(() => { apiMock.mockReset(); });

describe("Shopify settings", () => {
  it("is not shown for other platforms", async () => {
    const { ShopifySection } = await import("@/components/settings/shopify");
    const { container } = render(<ShopifySection store={{ ...store, platform: "custom" }} canManage />);
    expect(container.textContent).toBe("");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("says plainly when the deployment cannot install the app", async () => {
    apiMock.mockResolvedValue(install({ configured: false }));
    const { ShopifySection } = await import("@/components/settings/shopify");
    render(<ShopifySection store={store} canManage />);
    await waitFor(() => expect(screen.getByText(/not configured on this deployment/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Install on Shopify" })).toBeNull();
  });

  it("starts the install for the store's myshopify address, and only admins can", async () => {
    apiMock.mockImplementation(async (path: string) => (path.endsWith("/shopify") ? install() : { authorizeUrl: "https://ember.myshopify.com/admin/oauth/authorize?x=1" }));
    const { ShopifySection } = await import("@/components/settings/shopify");
    const { unmount } = render(<ShopifySection store={store} canManage={false} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Install on Shopify" }) as HTMLButtonElement).disabled).toBe(true));
    unmount();
    render(<ShopifySection store={store} canManage />);
    const u = userEvent.setup();
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("ember.myshopify.com"));
    await u.click(screen.getByRole("button", { name: "Install on Shopify" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/shopify/connect", { method: "POST", body: { shop: "ember.myshopify.com" } }));
  });

  it("syncs every page by cursor once installed, and reports products with too many variants", async () => {
    const pages = [{ imported: 10, nextCursor: "10", truncatedVariants: 1 }, { imported: 3, nextCursor: null, truncatedVariants: 0 }];
    apiMock.mockImplementation(async (path: string) => (path.endsWith("/shopify") ? install({ shop: "ember.myshopify.com", status: "installed", connected: true, scopes: ["read_products", "read_inventory"] })
      : path.endsWith("/theme-embed") ? { state: "unknown", theme: null, themeEditorUrl: "https://ember.myshopify.com/admin/themes/current/editor" } : pages.shift()));
    const { ShopifySection } = await import("@/components/settings/shopify");
    render(<ShopifySection store={store} canManage />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Sync catalog from Shopify" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Done: 13 products synced from Shopify\. 1 product\(s\) have more than 50 variants/));
    const bodies = apiMock.mock.calls.filter((c) => String(c[0]).endsWith("/integration/sync")).map((c) => c[1].body);
    expect(bodies).toEqual([{ cursor: null }, { cursor: "10" }]);
    expect(screen.getByText("cf_key")).toBeTruthy(); // the setup steps carry the site key
  });

  it("shows the storefront checklist: pixel set up by the app, embed state from the live theme, one-click theme editor link", async () => {
    const setup = { pixelActive: true, embedSettingsSavedAt: "2026-10-29T10:00:00Z", error: null, themeEditorUrl: "https://ember.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=k%2Fconvertflow-embed" };
    let embed = "disabled";
    apiMock.mockImplementation(async (path: string) => (path.endsWith("/shopify") ? install({ shop: "ember.myshopify.com", status: "installed", connected: true, scopes: ["read_products"], setup })
      : { state: embed, theme: "Dawn", themeEditorUrl: setup.themeEditorUrl }));
    const { ShopifySection } = await import("@/components/settings/shopify");
    render(<ShopifySection store={store} canManage />);
    expect(await screen.findByText("Purchase pixel active")).toBeTruthy();
    expect(await screen.findByText("Switch on the app embed")).toBeTruthy();
    expect(screen.getByText(/site key is already filled in/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open theme editor/ }).getAttribute("href")).toBe(setup.themeEditorUrl);
    embed = "enabled";
    await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("App embed is on")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry setup" })).toBeNull();
  });

  it("offers a retry when the pixel could not be created", async () => {
    let active = false;
    apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path.endsWith("/shopify/setup") && opts?.method === "POST") { active = true; return { pixelActive: true, embedSettingsSavedAt: null, error: null }; }
      if (path.endsWith("/shopify")) return install({ shop: "ember.myshopify.com", status: "installed", connected: true, scopes: ["read_products"], setup: { pixelActive: active, embedSettingsSavedAt: null, error: active ? null : "pixel_auth", themeEditorUrl: null } });
      throw new Error("no theme access");
    });
    const { ShopifySection } = await import("@/components/settings/shopify");
    render(<ShopifySection store={store} canManage />);
    expect(await screen.findByText(/Last setup attempt: pixel auth/)).toBeTruthy();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Retry setup" }));
    expect(await screen.findByText("Purchase pixel active")).toBeTruthy();
  });
});

describe("billing through Shopify", () => {
  it("routes plan changes through Shopify Billing when a store has the app installed, and offers cancellation", async () => {
    const sub = { plan: "growth", status: "active", provider: "shopify", currentPeriodEnd: null, usage: { pageviews: 0, aiGenerations: 0 }, billingConfigured: false, shopifyBilling: { available: true, storeIds: ["sto_1"] } };
    apiMock.mockImplementation(async (path: string) => (path.startsWith("/api/v1/billing/subscription") ? sub : { confirmationUrl: "https://ember.myshopify.com/admin/charges/1/2/confirm" }));
    const { BillingSection } = await import("@/components/settings/billing");
    render(<BillingSection store={store} isOwner />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByText("billed through Shopify")).toBeTruthy());
    const choose = screen.getAllByRole("button", { name: "Choose" });
    expect(choose).toHaveLength(2); // starter and scale; growth is the live plan
    await u.click(choose[1]!);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/billing/shopify/subscribe", { method: "POST", body: { organizationId: "o1", plan: "scale", storeId: "sto_1" } }));
    expect(screen.getByRole("button", { name: "Cancel subscription" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Manage billing/ })).toBeNull();
  });
});
