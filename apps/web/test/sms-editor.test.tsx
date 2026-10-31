import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignConfig } from "@convertflow/contracts";
import type { Contact, Store } from "@/lib/api";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const apiMock = vi.fn();
const pageMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a), apiPage: (...a: unknown[]) => pageMock(...a) }));
vi.mock("@/components/campaign-preview", () => ({ CampaignPreview: () => <div data-testid="preview" /> }));
vi.mock("@/components/providers", () => ({ ProviderPanel: () => <div data-testid="providers" /> }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ store }) }));

const store: Store = { id: "sto_1", name: "Shop", platform: "custom", domain: "shop.example.com", siteKey: "cf_key", currency: "USD", deliveryEnabled: true, organizationId: "o1" };

beforeEach(() => {
  apiMock.mockReset(); pageMock.mockReset(); replace.mockReset();
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path.endsWith("/products")) return [];
    if (path.endsWith("/integration")) return { maxDiscountPercent: null };
    if (init?.method === "POST" && path.endsWith("/campaigns")) return { id: "cmp_1", name: "x", tool: "sms", status: "draft", draftConfig: init.body, publishedVersionId: null, updatedAt: "2026-10-27T00:00:00Z" };
    return undefined;
  });
});

const savedBody = () => apiMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/campaigns"))?.[1].body;

describe("SMS signup editor", () => {
  const open = async () => {
    const { CampaignEditor } = await import("@/components/campaign-editor");
    render(<CampaignEditor store={store} tool="sms" />);
    return userEvent.setup();
  };

  it("starts from a phone-only form the contract accepts, with opt-out wording and code verification always on", async () => {
    const u = await open();
    expect(screen.getByRole("heading", { name: "SMS signup" })).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(savedBody()).toBeTruthy());
    const body = savedBody();
    expect(CampaignConfig.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ tool: "sms", goal: { type: "subscribe" }, form: { collect: { email: false, phone: true }, consentCheckbox: true, doubleOptIn: true } });
    expect(body.form.consentText).toMatch(/\bSTOP\b/);
    expect(screen.queryByLabelText("Button link")).toBeNull();
  });

  it("chooses the default dial code and blocks saving consent text that does not say how to opt out", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Default country"), "GB");
    const consent = screen.getByLabelText("Consent text");
    fireEvent.change(consent, { target: { value: "I agree to receive marketing texts from this store." } });
    expect((screen.getByRole("button", { name: "Create draft" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(consent, { target: { value: "I agree to receive marketing texts from this store. Msg & data rates may apply. Reply STOP to opt out." } });
    await u.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(savedBody()).toBeTruthy());
    expect(savedBody().form.defaultCountry).toBe("GB");
  });
});

describe("subscribers page by channel", () => {
  const sms: Contact = { id: "c1", email: null, phone: "+14155550123", emailStatus: "none", smsStatus: "subscribed", source: "form:cmp_1", createdAt: "2026-10-27T00:00:00Z", sync: [] };

  it("switches to SMS, lists subscribers by number, and records an opt-out only after confirming", async () => {
    pageMock.mockImplementation(async (path: string) => ({ data: path.includes("channel=sms") ? [sms] : [], nextCursor: null }));
    apiMock.mockResolvedValue(undefined);
    const { default: Page } = await import("@/app/app/subscribers/page");
    render(<Page />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByText("No email subscribers yet")).toBeTruthy());
    await u.click(screen.getByRole("button", { name: "SMS" }));
    await waitFor(() => expect(screen.getByText("+14155550123")).toBeTruthy());
    expect(pageMock.mock.calls.at(-1)?.[0]).toContain("channel=sms");
    expect(screen.getByRole("button", { name: /Export SMS subscribers/ })).toBeTruthy();

    await u.click(screen.getByRole("button", { name: "Record opt-out for +14155550123" }));
    expect(apiMock).not.toHaveBeenCalledWith(expect.stringContaining("/opt-out"), expect.anything()); // asks first
    await u.click(screen.getByRole("button", { name: "Confirm opt-out" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/contacts/c1/opt-out", { method: "POST", body: { channel: "sms" } }));
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Unsubscribed")).toBeTruthy());
  });
});
