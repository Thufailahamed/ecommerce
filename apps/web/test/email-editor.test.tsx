import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignConfig } from "@convertflow/contracts";
import type { Store } from "@/lib/api";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));
// The preview renders through the real SDK; it is covered by the SDK and e2e suites.
vi.mock("@/components/campaign-preview", () => ({ CampaignPreview: () => <div data-testid="preview" /> }));

const store: Store = { id: "sto_1", name: "Shop", platform: "custom", domain: "shop.example.com", siteKey: "cf_key", currency: "USD", deliveryEnabled: true, organizationId: "o1" };

beforeEach(() => {
  apiMock.mockReset(); replace.mockReset();
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path.endsWith("/products")) return [];
    if (path.endsWith("/integration")) return { maxDiscountPercent: null };
    if (init?.method === "POST" && path.endsWith("/campaigns")) return { id: "cmp_1", name: "x", tool: "email", status: "draft", draftConfig: init.body, publishedVersionId: null, updatedAt: "2026-10-27T00:00:00Z" };
    return undefined;
  });
});

const open = async () => {
  const { CampaignEditor } = await import("@/components/campaign-editor");
  render(<CampaignEditor store={store} tool="email" />);
  return userEvent.setup();
};
const savedBody = () => apiMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/campaigns"))?.[1].body;
const createDraft = () => screen.getByRole("button", { name: "Create draft" }) as HTMLButtonElement;

describe("email signup editor", () => {
  it("starts from a form the real contract accepts, with consent defaults that cannot be loosened", async () => {
    const u = await open();
    expect(screen.getByRole("heading", { name: "Email signup" })).toBeTruthy();
    await u.click(createDraft());
    await waitFor(() => expect(savedBody()).toBeTruthy());
    const body = savedBody();
    expect(CampaignConfig.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ tool: "email", format: "popup", goal: { type: "subscribe" }, form: { collect: { email: true, phone: false }, consentCheckbox: true, doubleOptIn: true } });
    expect(body.promotion).toBeUndefined();
  });

  it("hides what a form cannot use (the classic format picker, a button link) and offers every layout that can draw a form", async () => {
    await open();
    expect(screen.queryByLabelText("Button link")).toBeNull();
    expect(screen.queryByText("Discount code (optional)")).toBeNull(); // it is a sign-up incentive here, revealed only after confirming
    expect(screen.queryByText(/Back-in-stock form/)).toBeNull();
    const style = screen.getByLabelText("Style") as HTMLSelectElement;
    expect(Array.from(style.options).map((o) => o.value)).toEqual(["popup", "slide_in", "announcement_bar", "inline"]);
  });

  it("an inline form is part of the page: no trigger or per-visit limits, and the merchant is told where it goes", async () => {
    const u = await open();
    expect(screen.getByLabelText("Trigger")).toBeTruthy();
    await u.selectOptions(screen.getByLabelText("Style"), "inline");
    expect(screen.queryByLabelText("Trigger")).toBeNull();
    expect(screen.queryByLabelText("Max per session")).toBeNull();
    expect(screen.getByText(/data-convertflow-form/)).toBeTruthy();
    await u.click(createDraft());
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody()).toMatchObject({ format: "inline" });
    expect(CampaignConfig.safeParse(savedBody()).success).toBe(true);
  });

  it("can ask for a first name, saved as an optional field of the form", async () => {
    const u = await open();
    await u.click(screen.getByLabelText(/Also ask for a first name/));
    await u.click(createDraft());
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody().form.collect).toEqual({ email: true, phone: false, firstName: true });
    expect(CampaignConfig.safeParse(savedBody()).success).toBe(true);
  });

  it("offers a sign-up incentive that the form itself never shows, and saves it with the store-limit guardrail in view", async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path.endsWith("/products")) return [];
      if (path.endsWith("/integration")) return { maxDiscountPercent: 20 };
      if (init?.method === "POST" && path.endsWith("/campaigns")) return { id: "cmp_1", name: "x", tool: "email", status: "draft", draftConfig: init.body, publishedVersionId: null, updatedAt: "2026-10-27T00:00:00Z" };
      return undefined;
    });
    const u = await open();
    expect(screen.getByText("Sign-up incentive (optional)")).toBeTruthy();
    await u.click(screen.getByLabelText(/Give subscribers a discount code once they confirm/));
    expect(screen.getByText(/never shown on the form/)).toBeTruthy();
    expect(screen.getByText(/Store limit: 20%/)).toBeTruthy();
    await u.click(createDraft());
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody().promotion).toMatchObject({ code: "SAVE10", percentOff: 10 });
    expect(CampaignConfig.safeParse(savedBody()).success).toBe(true);
  });

  it("saves the merchant's consent words, privacy link and confirmation message exactly", async () => {
    const u = await open();
    const consent = screen.getByLabelText("Consent text");
    fireEvent.change(consent, { target: { value: "Yes, send me the Shop newsletter. I can unsubscribe whenever I like." } });
    fireEvent.change(screen.getByLabelText("Privacy policy link"), { target: { value: "https://shop.example.com/privacy" } });
    fireEvent.change(screen.getByLabelText("Message after signing up"), { target: { value: "Almost there: confirm in your inbox." } });
    await u.selectOptions(screen.getByLabelText("Style"), "slide_in");
    await u.click(createDraft());
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody()).toMatchObject({ format: "slide_in", form: { consentText: "Yes, send me the Shop newsletter. I can unsubscribe whenever I like.", privacyUrl: "https://shop.example.com/privacy", pendingMessage: "Almost there: confirm in your inbox." } });
    expect(CampaignConfig.safeParse(savedBody()).success).toBe(true);
  });

  it("blocks saving consent text that is too short or a privacy link that is unsafe, instead of sending an invalid config", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Consent text"), { target: { value: "ok" } });
    expect(createDraft().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Consent text"), { target: { value: "Yes, send me the Shop newsletter. I can unsubscribe whenever I like." } });
    expect(createDraft().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Privacy policy link"), { target: { value: "javascript:alert(1)" } });
    expect(createDraft().disabled).toBe(true);
  });

  it("warns, without blocking, when the consent words never mention unsubscribing, and says plainly that this app does not send marketing email", async () => {
    await open();
    expect(screen.queryByText(/does not mention that shoppers can unsubscribe/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Consent text"), { target: { value: "Yes, I would like to get news and offers from this shop." } });
    expect(screen.getByText(/does not mention that shoppers can unsubscribe/)).toBeTruthy();
    expect(createDraft().disabled).toBe(false);
    expect(screen.getByText(/does not send marketing email itself/)).toBeTruthy();
  });
});
