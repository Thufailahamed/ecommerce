import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Store } from "@/lib/api";

const store: Store = { id: "sto_1", name: "Synapstore", platform: "custom", domain: "shop.example.com", siteKey: "site_key", currency: "USD", deliveryEnabled: true, organizationId: "org_1" };
const session = {
  me: { userId: "u1", email: "owner@example.com", organizations: [{ id: "org_1", name: "Synapstore", role: "owner" }] },
  stores: [store], store, security: null, selectStore: vi.fn(), reload: vi.fn(async () => undefined),
};

vi.mock("next/navigation", () => ({ usePathname: () => "/app/studio", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/lib/session", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSession: () => session,
}));
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null, useCommandShortcut: () => undefined }));
vi.mock("@/components/verify-banner", () => ({ VerifyBanner: () => null }));
vi.mock("@/components/marketing/fx", () => ({ Spotlight: () => null }));

const renderLayout = async () => {
  const { default: AppLayout } = await import("@/app/app/layout");
  return render(<AppLayout><div>Page</div></AppLayout>);
};

describe("app sidebar", () => {
  it("groups the main navigation and reveals folders and tools only on demand", async () => {
    await renderLayout();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Overview" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "AI studio" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Subscribers" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Analytics" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Popups" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Email signup" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show campaign folders" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Tools" }).getAttribute("aria-expanded")).toBe("false");

    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Show campaign folders" }));
    expect(screen.getByRole("link", { name: "Popups" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide campaign folders" }).getAttribute("aria-expanded")).toBe("true");

    await u.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByRole("link", { name: "Email signup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tools" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the store switcher, settings and the signed-in account", async () => {
    await renderLayout();
    const storeSwitch = screen.getByLabelText("Store");
    expect(storeSwitch).toBeTruthy();
    expect(within(storeSwitch).getByRole("option", { name: "Synapstore" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.getByText("owner@example.com")).toBeTruthy();
    expect(screen.getByText(/Owner/)).toBeTruthy();
  });
});
