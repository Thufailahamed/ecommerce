import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Store } from "@/lib/api";
import { MODULES, visibleModules } from "@/lib/modules";

const keys = (role: string | undefined, caps: string[] = []) => visibleModules(role, new Set(caps)).map((m) => m.key);

describe("module registry", () => {
  it("shows each member only the modules their role may use", () => {
    expect(keys("viewer")).toEqual(["overview", "sites", "campaigns", "templates", "submissions", "experiments", "analytics"]);
    expect(keys("editor")).toEqual(expect.arrayContaining(["studio", "subscribers"]));
    expect(keys("editor")).not.toContain("operations");
    expect(keys("admin")).toContain("operations");
    expect(keys(undefined)).toEqual(keys("viewer")); // unknown role: least privilege
  });

  it("shows a preview module only when the workspace holds its capability", () => {
    expect(keys("owner")).not.toContain("automations");
    expect(keys("owner", ["workflows.create"])).toContain("automations");
    expect(keys("viewer", ["workflows.create"])).not.toContain("automations"); // still needs the permission
    expect(MODULES.filter((m) => m.preview).every((m) => m.capability)).toBe(true);
  });
});

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));
const store: Store = { id: "sto_1", name: "Shop", platform: "shopify", domain: "s.myshopify.com", siteKey: "cf_key", currency: "USD", deliveryEnabled: true, organizationId: "o1" };
vi.mock("@/lib/session", () => ({ useSession: () => ({ store }) }));

describe("operations page", () => {
  let failed = true;
  beforeEach(() => {
    failed = true;
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/integrations")) return [{ key: "shopify", name: "Shopify", kind: "commerce_platform", verification: "unverified", capabilities: ["storefront.sdk"], planned: ["oauth.install"], status: { state: "error", verified: false, lastSuccessAt: null, lastError: "A orders/create webhook failed to process" } }];
      if (path.includes("/platform-events") && init?.method === "POST") { failed = false; return { retried: true }; }
      if (path.includes("/platform-events")) return failed && path.includes("status=failed") ? [{ id: "evt_1", type: "order.created", status: "failed", attempts: 1, lastError: "fixture: down", recordedAt: "2026-10-27T10:00:00Z", deliveries: [{ subscriber: "analytics.record_platform_order", status: "failed", attempts: 1, lastError: "down" }] }] : [];
      if (path.includes("/audit")) return [{ id: "a1", action: "campaign.published", actorType: "user", targetType: "campaign", createdAt: "2026-10-27T10:00:00Z", correlationId: "r1" }];
      return undefined;
    });
  });

  it("shows unverified integrations honestly, failed event deliveries with a retry, and the audit log", async () => {
    const { default: Page } = await import("@/app/app/operations/page");
    render(<Page />);
    expect(await screen.findByText("Not verified against the live service")).toBeTruthy();
    expect(screen.getByText("A orders/create webhook failed to process")).toBeTruthy();
    const events = within(await screen.findByRole("table", { name: "Platform events" }));
    expect(events.getByText("order.created")).toBeTruthy();
    expect(await screen.findByText("campaign.published")).toBeTruthy();

    await userEvent.setup().click(events.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/platform-events/evt_1/retry", { method: "POST", body: {} }));
    expect(await screen.findByText("Nothing has failed")).toBeTruthy();
  });
});
