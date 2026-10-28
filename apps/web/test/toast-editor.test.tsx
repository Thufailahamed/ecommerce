import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignConfig, SHIPPED_TOOLS } from "@convertflow/contracts";
import type { Store } from "@/lib/api";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));
// The preview renders through the real SDK; it is covered by the SDK and e2e suites.
vi.mock("@/components/campaign-preview", () => ({ CampaignPreview: () => <div data-testid="preview" /> }));

const store: Store = { id: "sto_1", name: "Shop", platform: "custom", domain: "shop.example.com", siteKey: "cf_key", currency: "EUR", deliveryEnabled: true, organizationId: "o1" };

beforeEach(() => {
  apiMock.mockReset(); replace.mockReset();
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path.endsWith("/products")) return [];
    if (path.endsWith("/integration")) return { maxDiscountPercent: null };
    if (init?.method === "POST" && path.endsWith("/campaigns")) return { id: "cmp_1", name: "x", tool: "toast", status: "draft", draftConfig: init.body, publishedVersionId: null, updatedAt: "2026-10-27T00:00:00Z" };
    return undefined;
  });
});

const open = async () => {
  const { CampaignEditor } = await import("@/components/campaign-editor");
  render(<CampaignEditor store={store} tool="toast" />);
  return userEvent.setup();
};
const savedBody = () => apiMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/campaigns"))?.[1].body;

describe("toast editor", () => {
  it("starts from a valid toast and hides the controls that do not apply to toasts", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Toast" })).toBeTruthy();
    expect(screen.queryByLabelText("Format")).toBeNull(); // the format is fixed by the tool
    expect(screen.queryByLabelText("Placement")).toBeNull(); // toasts use corners
    expect(screen.getByLabelText("Corner")).toBeTruthy();
  });

  it("saves a config the real contract accepts, tagged as the toast tool", async () => {
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(savedBody()).toBeTruthy());
    const body = savedBody();
    expect(body).toMatchObject({ tool: "toast", format: "toast", toast: { kind: "announcement", corner: "bottom_left" } });
    expect(CampaignConfig.safeParse(body).success).toBe(true);
  });

  it("a shipping incentive needs its threshold, shows it in the store currency, and saves it", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Type"), "shipping_incentive");
    const threshold = screen.getByLabelText("Free-shipping threshold (EUR)") as HTMLInputElement;
    expect(threshold.value).toBe("75");
    await u.clear(threshold); await u.type(threshold, "120");
    await u.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody().toast).toMatchObject({ kind: "shipping_incentive", freeShippingThreshold: 120 });
    expect(CampaignConfig.safeParse(savedBody()).success).toBe(true);
  });

  it("blocks saving a shipping incentive with no threshold instead of sending an invalid config", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Type"), "shipping_incentive");
    await u.clear(screen.getByLabelText("Free-shipping threshold (EUR)"));
    expect((screen.getByRole("button", { name: "Create draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Set the free-shipping threshold/)).toBeTruthy();
  });

  it("auto-hide is opt-in and bounded to the contract's range", async () => {
    const u = await open();
    expect(screen.queryByLabelText("Hide after (seconds)")).toBeNull();
    await u.click(screen.getByLabelText("Hide automatically"));
    const secs = screen.getByLabelText("Hide after (seconds)") as HTMLInputElement;
    expect(secs.value).toBe("10");
    await u.clear(secs); await u.type(secs, "1");
    await waitFor(() => expect(Number(secs.value)).toBeGreaterThanOrEqual(3));
  });

  it("cart triggers are offered with their inputs", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Trigger"), "cart_threshold");
    expect(screen.getByLabelText("Cart subtotal reaches (EUR)")).toBeTruthy();
    await u.selectOptions(screen.getByLabelText("Trigger"), "add_to_cart");
    expect(screen.getByLabelText("Wait (seconds)")).toBeTruthy();
  });

  it("warns when a coupon toast has no discount to reveal", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Type"), "coupon");
    expect(screen.getByText(/nothing to reveal/)).toBeTruthy();
  });

  it("the product picker only appears for product offers", async () => {
    const u = await open();
    expect(screen.queryByText("Featured products (optional)")).toBeNull();
    await u.selectOptions(screen.getByLabelText("Type"), "product_offer");
    expect(screen.getByText("Featured products (optional)")).toBeTruthy();
  });
});

describe("tool metadata", () => {
  it("only marks a tool shipped when the contracts say so", async () => {
    const { TOOLS, TOOL_ORDER } = await import("@/lib/tools");
    for (const k of TOOL_ORDER) expect(TOOLS[k].shipped, k).toBe(SHIPPED_TOOLS.has(k));
    expect(TOOLS.toast.shipped).toBe(true);
  });
  it("uses neutral default names that never reuse another company's product names", async () => {
    const { TOOLS, TOOL_ORDER } = await import("@/lib/tools");
    for (const k of TOOL_ORDER) expect(TOOLS[k].name).not.toMatch(/^Noti(Feed|Pop|Sell|SMS|Email)$/i);
  });
  it("recognises only real tools", async () => {
    const { isTool } = await import("@/lib/tools");
    expect(isTool("toast")).toBe(true);
    expect(isTool("popup")).toBe(false);
    expect(isTool("__proto__")).toBe(false);
  });
});

describe("feed editor", () => {
  const openFeed = async () => {
    const { CampaignEditor } = await import("@/components/campaign-editor");
    render(<CampaignEditor store={store} tool="feed" />);
    return userEvent.setup();
  };

  it("starts as a valid feed card and hides everything that does not apply to a persistent surface", async () => {
    await openFeed();
    expect(screen.getByRole("heading", { name: "Notification feed" })).toBeTruthy();
    for (const label of ["Format", "Placement", "Trigger", "Max per session", "Hide after dismiss (days)", "Goal"]) expect(screen.queryByLabelText(label), label).toBeNull();
    for (const label of ["Category", "Order", "Audience", "Bell position", "Image URL (optional)", "Headline", "Starts", "Ends"]) expect(screen.getByLabelText(label), label).toBeTruthy();
  });

  it("saves a config the real contract accepts, tagged as the feed tool", async () => {
    const u = await openFeed();
    const category = screen.getByLabelText("Category");
    await u.clear(category); await u.type(category, "Offers");
    await u.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody()).toMatchObject({ tool: "feed", format: "feed_item", feed: { category: "Offers", position: "bottom_right" } });
    expect(CampaignConfig.safeParse(savedBody()).success).toBe(true);
  });

  it("refuses an unsafe image URL instead of saving it", async () => {
    const u = await openFeed();
    await u.type(screen.getByLabelText("Image URL (optional)"), "javascript:alert(1)");
    expect((screen.getByRole("button", { name: "Create draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/imageUrl/)).toBeTruthy();
  });

  it("an https image is accepted and saved", async () => {
    const u = await openFeed();
    await u.type(screen.getByLabelText("Image URL (optional)"), "https://cdn.example.com/summer.jpg");
    await u.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody().creative.imageUrl).toBe("https://cdn.example.com/summer.jpg");
  });

  it("the bell position can be switched to the left", async () => {
    const u = await openFeed();
    await u.selectOptions(screen.getByLabelText("Bell position"), "bottom_left");
    await u.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody().feed.position).toBe("bottom_left");
  });
});
