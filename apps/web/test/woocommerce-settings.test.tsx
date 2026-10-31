import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Store } from "@/lib/api";
import type { WooConnection } from "@/components/settings/woocommerce";

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

const store: Store = { id: "sto_w", name: "Woo", platform: "woocommerce", domain: "woo.example.com", siteKey: "cf_wookey", currency: "USD", deliveryEnabled: true, organizationId: "o1" };
const conn = (over: Partial<WooConnection> = {}): WooConnection => ({
  configured: true, connected: false, method: null, keyPermissions: null, verifiedAt: null, connectedAt: null,
  webhooks: { state: "pending", error: null, count: 0, topics: [], lastReceivedAt: null }, ...over,
});
const live = conn({ connected: true, method: "authorize", keyPermissions: "read_write", verifiedAt: "2026-10-29T10:00:00Z", webhooks: { state: "active", error: null, count: 6, topics: [], lastReceivedAt: null } });

beforeEach(() => { apiMock.mockReset(); });
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("WooCommerce settings", () => {
  it("is not shown for other platforms", async () => {
    const { WooCommerceSection } = await import("@/components/settings/woocommerce");
    const { container } = render(<WooCommerceSection store={{ ...store, platform: "shopify" }} canManage />);
    expect(container.textContent).toBe("");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("starts the WooCommerce approval for admins only, with keys as the fallback", async () => {
    apiMock.mockImplementation(async (path: string) => (path.endsWith("/woocommerce") ? conn() : { authorizeUrl: "https://woo.example.com/wc-auth/v1/authorize?x=1" }));
    const { WooCommerceSection } = await import("@/components/settings/woocommerce");
    const { unmount } = render(<WooCommerceSection store={store} canManage={false} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Connect WooCommerce" }) as HTMLButtonElement).disabled).toBe(true));
    unmount();
    render(<WooCommerceSection store={store} canManage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Connect WooCommerce" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_w/woocommerce/authorize", { method: "POST" }));
    expect(screen.getByText("Use API keys instead")).toBeTruthy();
  });

  it("saves pasted keys through the connect route", async () => {
    apiMock.mockImplementation(async (path: string) => (path.endsWith("/woocommerce") ? conn({ configured: false }) : { connected: true }));
    const { WooCommerceSection } = await import("@/components/settings/woocommerce");
    render(<WooCommerceSection store={store} canManage />);
    expect(await screen.findByText(/One-click connection is not configured/)).toBeTruthy();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Consumer key"), "ck_abcdefgh");
    await u.type(screen.getByLabelText("Consumer secret"), "cs_abcdefgh");
    await u.click(screen.getByRole("button", { name: "Check and save keys" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_w/integration/connect", { method: "POST", body: { kind: "woocommerce", consumerKey: "ck_abcdefgh", consumerSecret: "cs_abcdefgh" } }));
  });

  it("finishes the connection when WooCommerce sends the merchant back approved, and says so when declined", async () => {
    window.history.replaceState(null, "", "/app/settings?woocommerce=returned&store=sto_w&success=1&user_id=abc");
    apiMock.mockResolvedValue(live);
    const { WooCommerceSection } = await import("@/components/settings/woocommerce");
    const { unmount } = render(<WooCommerceSection store={store} canManage />);
    expect(await screen.findByText(/WooCommerce is connected/)).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_w/woocommerce/setup", { method: "POST" });
    unmount();
    apiMock.mockReset();
    apiMock.mockResolvedValue(conn());
    window.history.replaceState(null, "", "/app/settings?woocommerce=returned&store=sto_w&success=0");
    render(<WooCommerceSection store={store} canManage />);
    expect(await screen.findByText(/not approved in WooCommerce/)).toBeTruthy();
    expect(apiMock.mock.calls.some((c) => String(c[0]).endsWith("/setup"))).toBe(false);
  });

  it("once connected: webhook state, repair, page-by-page sync and the plugin step with the site key", async () => {
    const pages = [{ imported: 25, nextPage: 2 }, { imported: 4, nextPage: null }];
    apiMock.mockImplementation(async (path: string) => (path.endsWith("/integration/sync") ? pages.shift() : live));
    const { WooCommerceSection } = await import("@/components/settings/woocommerce");
    render(<WooCommerceSection store={store} canManage />);
    expect(await screen.findByText("6 webhooks active")).toBeTruthy();
    expect(screen.getByText("cf_wookey")).toBeTruthy();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Sync catalog now" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Done: 29 products synced from WooCommerce."));
    expect(apiMock.mock.calls.filter((c) => String(c[0]).endsWith("/integration/sync")).map((c) => c[1].body)).toEqual([{ page: 1 }, { page: 2 }]);
    await u.click(screen.getByRole("button", { name: "Repair" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_w/woocommerce/setup", { method: "POST" }));
  });

  it("explains read-only keys and offers to reconnect with write access", async () => {
    apiMock.mockResolvedValue(conn({ connected: true, method: "manual", verifiedAt: "2026-10-29T10:00:00Z", webhooks: { state: "read_only", error: null, count: 0, topics: [], lastReceivedAt: null } }));
    const { WooCommerceSection } = await import("@/components/settings/woocommerce");
    render(<WooCommerceSection store={store} canManage />);
    expect(await screen.findByText(/Read-only keys: products sync/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect with Read/Write" })).toBeTruthy();
  });
});
