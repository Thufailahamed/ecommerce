import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignConfig, SHIPPED_TOOLS, toolOf } from "@convertflow/contracts";
import type { Store } from "@/lib/api";
import { TEMPLATES, templateById, editorToolOf } from "@/lib/templates";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));
vi.mock("@/components/campaign-preview", () => ({ CampaignPreview: () => <div data-testid="preview" />, SAMPLE_PRODUCTS: [] }));
vi.mock("@/components/template-thumb", () => ({ TemplateThumb: () => <div data-testid="thumb" /> }));

const store: Store = { id: "sto_1", name: "Shop", platform: "custom", domain: "shop.example.com", siteKey: "cf_key", currency: "EUR", deliveryEnabled: true, organizationId: "o1" };
const campaigns = [
  { id: "cmp_a", name: "Spring toast", tool: "toast", status: "active", draftConfig: {}, publishedVersionId: "v1", updatedAt: "2026-10-27T00:00:00Z" },
  { id: "cmp_b", name: "Old bar", tool: "email", status: "archived", draftConfig: {}, publishedVersionId: null, updatedAt: "2026-10-01T00:00:00Z" },
];

beforeEach(() => {
  apiMock.mockReset(); replace.mockReset();
  apiMock.mockImplementation(async (path: string) => (path.endsWith("/campaigns") ? campaigns : path.endsWith("/products") ? [] : path.endsWith("/integration") ? { maxDiscountPercent: null } : undefined));
});

describe("campaign templates", () => {
  it("every template is a config the real contract accepts, for a tool that is shipped", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(12);
    for (const t of TEMPLATES) {
      const r = CampaignConfig.safeParse(t.config());
      expect(r.success, `${t.id}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
      expect(SHIPPED_TOOLS.has(toolOf(t.config())), t.id).toBe(true);
    }
  });

  it("has unique ids, hands out fresh copies, and never mentions a discount it does not configure", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    const a = templateById("email-newsletter")!.config(); a.creative.headline = "changed";
    expect(templateById("email-newsletter")!.config().creative.headline).not.toBe("changed");
    for (const t of TEMPLATES) {
      const c = t.config();
      if (!c.promotion) expect(`${c.creative.headline} ${c.creative.body}`, t.id).not.toMatch(/\d+% off|discount|save \d+/i);
    }
  });

  it("maps a template to the editor that has the right controls", () => {
    expect(editorToolOf(templateById("toast-free-shipping")!.config())).toBe("toast");
    expect(editorToolOf(templateById("upsell-sold-out")!.config())).toBe("upsell");
    expect(editorToolOf(templateById("bar-sitewide")!.config())).toBeUndefined();
  });
});

describe("template gallery", () => {
  const open = async () => {
    const { TemplateGallery } = await import("@/components/template-gallery");
    render(<TemplateGallery store={store} />);
    return userEvent.setup();
  };

  it("offers a blank start, the AI studio, and every template grouped by purpose", async () => {
    await open();
    expect(screen.getByRole("link", { name: /From scratch/ }).getAttribute("href")).toBe("/app/campaigns/new?start=blank");
    expect(screen.getByRole("link", { name: /Chat with AI/ }).getAttribute("href")).toBe("/app/studio");
    expect(screen.getByRole("heading", { name: "Email signup templates" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Newsletter popup/ }).getAttribute("href")).toBe("/app/campaigns/new?template=email-newsletter");
    expect(screen.getAllByTestId("thumb")).toHaveLength(TEMPLATES.length);
  });

  it("filters by format, goal and search, and can be cleared", async () => {
    const u = await open();
    await u.click(screen.getByRole("radio", { name: /^Toasts/ }));
    const toasts = TEMPLATES.filter((t) => t.format === "toast").length;
    expect(screen.getByRole("heading", { name: `${toasts} templates` })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Newsletter popup/ })).toBeNull();

    await u.click(screen.getByRole("radio", { name: /^Coupons/ }));
    expect(screen.getByRole("heading", { name: "1 template" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Coupon reveal/ })).toBeTruthy();

    await u.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("heading", { name: "Email signup templates" })).toBeTruthy();

    await u.type(screen.getByLabelText("Search templates"), "zzzz");
    expect(screen.getByText(/No templates match/)).toBeTruthy();
  });

  it("lists existing campaigns (not archived) as starting points", async () => {
    const u = await open();
    await u.click(screen.getByRole("radio", { name: /^My campaigns/ }));
    const link = await screen.findByRole("link", { name: /Spring toast/ });
    expect(link.getAttribute("href")).toBe("/app/campaigns/new?from=cmp_a");
    expect(screen.queryByText("Old bar")).toBeNull();
  });
});

describe("builder layout", () => {
  const open = async (props: Record<string, unknown> = {}) => {
    const { CampaignEditor } = await import("@/components/campaign-editor");
    render(<CampaignEditor store={store} tool="toast" {...props} />);
    return userEvent.setup();
  };

  it("groups every control into section tabs and switches between them", async () => {
    const u = await open();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Content", "Design", "Targeting", "Display", "Offer", "Test"]); // no History until it is saved
    expect(screen.getByRole("tab", { name: "Content" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Headline")).toBeTruthy();
    await u.click(screen.getByRole("tab", { name: "Design" }));
    expect(screen.getByRole("tabpanel", { name: "Design" })).toBeTruthy();
    expect(screen.queryByRole("tabpanel", { name: "Content" })).toBeNull(); // hidden panels leave the accessibility tree
    await u.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "Targeting" }).getAttribute("aria-selected")).toBe("true");
  });

  it("upsells have no offer tab, and AI Chat links to the studio", async () => {
    await open({ tool: "upsell" });
    expect(screen.queryByRole("tab", { name: "Offer" })).toBeNull();
    expect(screen.getByRole("link", { name: "AI Chat" }).getAttribute("href")).toBe("/app/studio");
  });

  it("opens from a template with its copy filled in, and publishes only after review and approval", async () => {
    const t = templateById("toast-free-shipping")!;
    const u = await open({ initial: t.config(), tool: "toast" });
    expect((screen.getByLabelText("Campaign name") as HTMLInputElement).value).toBe("Free-shipping progress");
    expect((screen.getByLabelText("Headline") as HTMLInputElement).value).toBe("You're close to free shipping");
    expect(screen.queryByRole("dialog")).toBeNull();

    await u.click(screen.getByRole("button", { name: /Launch/ }));
    const dialog = screen.getByRole("dialog", { name: "Review and launch" });
    const publish = within(dialog).getByRole("button", { name: "Publish" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    await u.click(within(dialog).getByRole("checkbox", { name: /approve it to go live/ }));
    expect(publish.disabled).toBe(false);
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not let an invalid config be launched", async () => {
    const u = await open();
    await u.clear(screen.getByLabelText("Headline"));
    expect((screen.getByRole("button", { name: /Launch/ }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByText(/headline/)).toBeTruthy());
  });
});
