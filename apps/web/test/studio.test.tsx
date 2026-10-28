import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignConfig, SHIPPED_TOOLS, type Tool } from "@convertflow/contracts";
import { ApiError, type Store } from "@/lib/api";
import { buildGenerateBody, emptyStudioForm, fieldsFor, studioToolOptions, summarise, type StudioForm } from "@/lib/studio";
import { TOOL_ORDER } from "@/lib/tools";

// This repo does not load jest-dom, so the four matchers this file needs are defined here.
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> { toBeInTheDocument(): R; toHaveTextContent(expected: string | RegExp): R; toHaveAttribute(name: string, value: string): R; toBeDisabled(): R }
}
expect.extend({
  toBeInTheDocument: (el: Element | null) => ({ pass: !!el && el.isConnected, message: () => "expected the element to be in the document" }),
  toHaveTextContent: (el: Element, want: string | RegExp) => {
    const got = el.textContent ?? "";
    return { pass: typeof want === "string" ? got.includes(want) : want.test(got), message: () => `expected text ${JSON.stringify(got)} to match ${String(want)}` };
  },
  toHaveAttribute: (el: Element, name: string, value: string) => ({ pass: el.getAttribute(name) === value, message: () => `expected ${name}=${JSON.stringify(value)}, got ${JSON.stringify(el.getAttribute(name))}` }),
  toBeDisabled: (el: HTMLButtonElement | HTMLOptionElement) => ({ pass: el.disabled === true, message: () => "expected the element to be disabled" }),
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));
// The preview renders through the real SDK renderer; that is covered by the SDK and e2e suites.
vi.mock("@/components/campaign-preview", () => ({ CampaignPreview: () => <div data-testid="preview" /> }));

const store: Store = { id: "sto_1", name: "Shop", platform: "custom", domain: "shop.example.com", siteKey: "cf_key", currency: "USD", deliveryEnabled: true, organizationId: "o1" };
vi.mock("@/components/need-store", () => ({ NeedStore: ({ children }: { children: (s: Store) => React.ReactNode }) => <>{children(store)}</> }));

const form = (o: Partial<StudioForm> = {}): StudioForm => ({ ...emptyStudioForm, objective: "Grow my email list this season", ...o });
const base = {
  schemaVersion: 1, name: "Draft", style: {}, trigger: { type: "delay", seconds: 8 }, targeting: { match: "all", conditions: [] },
  frequency: {}, goal: { type: "clicks" }, creative: { headline: "Hello", body: "", ctaLabel: "Go", ctaUrl: "/" },
};
const configs: Record<Exclude<Tool, "sms">, Record<string, unknown>> = {
  toast: { ...base, tool: "toast", format: "toast", toast: { kind: "shipping_incentive", corner: "bottom_left", freeShippingThreshold: 75 } },
  feed: { ...base, tool: "feed", format: "feed_item", trigger: { type: "immediate" }, feed: { category: "Offers", order: 100, audience: "public", position: "bottom_right" } },
  upsell: { ...base, tool: "upsell", format: "recommendation", recommend: { source: "manual", productIds: ["p1", "p2"], placement: "cart", layout: "grid", maxProducts: 3 } },
  email: { ...base, tool: "email", format: "popup", goal: { type: "subscribe" }, form: { collect: { email: true, phone: false, firstName: false }, consentText: "I agree to receive marketing emails from shop.example.com. Unsubscribe any time.", privacyUrl: "/privacy-policy", doubleOptIn: true } },
};
const parse = (c: Record<string, unknown>) => CampaignConfig.parse(c);
const row = (draftConfig: unknown, tool = "toast") => ({ id: "cmp_9", name: "Draft", tool, status: "draft", draftConfig, publishedVersionId: null, updatedAt: "2026-10-27T00:00:00Z" });

describe("studio helpers", () => {
  it("lists every tool but only lets shipped ones be picked", () => {
    const opts = studioToolOptions();
    expect(opts[0]).toEqual({ value: "auto", label: "Let AI choose", disabled: false });
    expect(opts.slice(1).map((o) => o.value)).toEqual([...TOOL_ORDER]);
    for (const o of opts.slice(1)) expect(o.disabled, o.value).toBe(!SHIPPED_TOOLS.has(o.value as Tool));
    expect(opts.find((o) => o.value === "sms")?.label).toMatch(/not available yet/);
  });

  it("offers each tool only the inputs that apply to it, and everything in auto mode", () => {
    expect(fieldsFor("toast")).toEqual({ threshold: true, consent: false, format: false });
    expect(fieldsFor("upsell")).toEqual({ threshold: true, consent: false, format: false });
    expect(fieldsFor("feed")).toEqual({ threshold: false, consent: false, format: false });
    expect(fieldsFor("email")).toEqual({ threshold: false, consent: true, format: true });
    expect(fieldsFor("auto")).toEqual({ threshold: true, consent: true, format: false });
  });

  it("builds the request from only the filled-in fields that apply", () => {
    expect(buildGenerateBody(form())).toEqual({ ok: true, body: { objective: "Grow my email list this season" } });
    expect(buildGenerateBody(form({ tool: "feed", threshold: "50", consentText: "x".repeat(30), constraints: " friendly ", promo: "10% off" })))
      .toEqual({ ok: true, body: { objective: "Grow my email list this season", tool: "feed", constraints: "friendly", allowedPromotion: "10% off" } });
    expect(buildGenerateBody(form({ tool: "toast", threshold: " 75.5 " }))).toMatchObject({ ok: true, body: { tool: "toast", freeShippingThreshold: 75.5 } });
    expect(buildGenerateBody(form({ tool: "email", format: "slide_in", consentText: " I agree to hear from Shop about arrivals. ", privacyUrl: "https://shop.example.com/privacy" })))
      .toMatchObject({ ok: true, body: { tool: "email", format: "slide_in", consentText: "I agree to hear from Shop about arrivals.", privacyUrl: "https://shop.example.com/privacy" } });
  });

  it("sends feedback only when regenerating", () => {
    expect(buildGenerateBody(form({ feedback: "shorter" }), false)).toEqual({ ok: true, body: { objective: "Grow my email list this season" } });
    expect(buildGenerateBody(form({ feedback: "shorter" }), true)).toMatchObject({ ok: true, body: { feedback: "shorter" } });
  });

  it("checks the merchant's facts before a generation is spent", () => {
    expect(buildGenerateBody(form({ objective: "short" }))).toMatchObject({ ok: false, error: expect.stringMatching(/10 characters/) });
    for (const threshold of ["abc", "0", "-3", "2000000"]) expect(buildGenerateBody(form({ tool: "toast", threshold }))).toMatchObject({ ok: false, error: expect.stringMatching(/threshold/) });
    expect(buildGenerateBody(form({ tool: "email", consentText: "too short" }))).toMatchObject({ ok: false, error: expect.stringMatching(/20 and 600/) });
    for (const privacyUrl of ["javascript:alert(1)", "http://shop.example.com/p", "//evil.example/p"]) expect(buildGenerateBody(form({ tool: "email", privacyUrl }))).toMatchObject({ ok: false, error: expect.stringMatching(/privacy/i) });
  });

  it("summarises what to check for each tool", () => {
    expect(summarise(parse(configs.toast))).toEqual(expect.arrayContaining([["Kind", "shipping incentive"], ["Free-shipping threshold", "75"]]));
    expect(summarise(parse(configs.feed))).toEqual(expect.arrayContaining([["Category", "Offers"], ["Audience", "public"]]));
    expect(summarise(parse(configs.upsell))).toEqual(expect.arrayContaining([["Where", "cart"], ["Picked products", "p1, p2"]]));
    const e = summarise(parse(configs.email));
    expect(e).toEqual(expect.arrayContaining([["Collects", "Email address"], ["Privacy link", "/privacy-policy"], ["Double opt-in", "On"]]));
    expect(e.find(([k]) => k === "Consent wording")?.[1]).toContain("Unsubscribe any time");
    expect(summarise(parse({ ...base, format: "popup" }))).toEqual([]); // legacy campaigns have no tool block
  });
});

describe("StudioReview", () => {
  const open = async (result: Record<string, unknown>) => {
    const { StudioReview } = await import("@/components/studio-review");
    return render(<StudioReview result={result as never} domain="shop.example.com" currency="USD" />);
  };

  it("shows the draft, what the server changed, and the editor's advice without repeating itself", async () => {
    await open({
      campaign: row(configs.email, "email"), explanation: "Because email grows your list.",
      repairs: ["Consent wording was set to the standard template text. The AI never writes consent text."],
      warnings: ["Consent wording was set to the standard template text. The AI never writes consent text.", "A signup form that opens immediately converts poorly."],
    });
    expect(screen.getByTestId("preview")).toBeInTheDocument();
    expect(screen.getByText("Because email grows your list.")).toBeInTheDocument();
    const changed = screen.getByRole("region", { name: "Changed by the server before saving" });
    expect(within(changed).getAllByRole("listitem")).toHaveLength(1);
    const advice = screen.getByRole("region", { name: "Check before you publish" });
    expect(within(advice).getAllByRole("listitem")).toHaveLength(1);
    expect(within(advice).getByText(/opens immediately/)).toBeInTheDocument();
    expect(screen.getByText(/Draft: not live/)).toBeInTheDocument();
    expect(screen.getByText("Email address")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review in the editor and approve/ })).toHaveAttribute("href", "/app/campaigns/cmp_9");
  });

  it("renders every tool's draft and says nothing is published", async () => {
    for (const tool of ["toast", "feed", "upsell", "email"] as const) {
      const { unmount } = await open({ campaign: row(configs[tool], tool), explanation: "why" });
      expect(screen.getByTestId("studio-review")).toBeInTheDocument();
      expect(screen.getByText(/nothing is published until you do/i)).toBeInTheDocument();
      expect(screen.queryByRole("region")).toBeNull(); // no repairs, no advice
      unmount();
    }
  });

  it("renders model text as text, never as markup", async () => {
    const { container } = await open({ campaign: row(configs.feed, "feed"), explanation: "<img src=x onerror=alert(1)> <b>bold</b>", repairs: ["<script>alert(1)</script>"] });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it("explains an unreadable draft instead of crashing", async () => {
    await open({ campaign: row({ nope: true }), explanation: "x" });
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be read/);
  });
});

describe("AI studio page", () => {
  beforeEach(() => { apiMock.mockReset(); });
  const page = async () => {
    const { default: Page } = await import("@/app/app/studio/page");
    render(<Page />);
    return userEvent.setup();
  };
  const objective = () => screen.getByLabelText("What do you want to achieve?");
  const generate = () => screen.getByRole("button", { name: /Generate draft/ });
  const lastBody = () => apiMock.mock.calls.at(-1)?.[1]?.body as Record<string, unknown>;

  it("offers a tool choice with unavailable tools disabled", async () => {
    await page();
    const select = screen.getByLabelText("What should it build?");
    const labels = within(select).getAllByRole("option");
    expect(labels[0]).toHaveTextContent("Let AI choose");
    const sms = labels.find((o) => /SMS signup/.test(o.textContent ?? ""));
    expect(sms).toBeDisabled();
    expect(labels.filter((o) => (o as HTMLOptionElement).disabled).length).toBe(TOOL_ORDER.filter((t) => !SHIPPED_TOOLS.has(t)).length);
  });

  it("shows only the inputs that apply to the chosen tool", async () => {
    const u = await page();
    const select = screen.getByLabelText("What should it build?");
    const threshold = () => screen.queryByLabelText("Free-shipping threshold (optional)");
    const consent = () => screen.queryByLabelText("Consent wording (optional)");
    expect(threshold()).toBeInTheDocument(); expect(consent()).toBeInTheDocument(); // auto: any tool may be picked
    await u.selectOptions(select, "email");
    expect(threshold()).toBeNull(); expect(consent()).toBeInTheDocument();
    expect(screen.getByLabelText("Privacy policy link (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Format (optional)")).toBeInTheDocument();
    await u.selectOptions(select, "toast");
    expect(threshold()).toBeInTheDocument(); expect(consent()).toBeNull();
    await u.selectOptions(select, "feed");
    expect(threshold()).toBeNull(); expect(consent()).toBeNull();
  });

  it("sends the chosen tool and the merchant's facts, then shows the review", async () => {
    apiMock.mockResolvedValue({ campaign: row(configs.toast), explanation: "Because shoppers are close to free shipping.", repairs: [], warnings: [] });
    const u = await page();
    await u.selectOptions(screen.getByLabelText("What should it build?"), "toast");
    await u.type(objective(), "Nudge shoppers toward free shipping");
    await u.type(screen.getByLabelText("Free-shipping threshold (optional)"), "75");
    await u.click(generate());
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0]?.[0]).toBe("/api/v1/stores/sto_1/campaigns/ai-generate");
    expect(lastBody()).toEqual({ objective: "Nudge shoppers toward free shipping", tool: "toast", freeShippingThreshold: 75 });
    expect(await screen.findByTestId("studio-review")).toBeInTheDocument();
    expect(screen.getByText("Because shoppers are close to free shipping.")).toBeInTheDocument();
  });

  it("lets the model choose when no tool is picked (no tool in the request)", async () => {
    apiMock.mockResolvedValue({ campaign: row(configs.feed, "feed"), explanation: "why" });
    const u = await page();
    await u.type(objective(), "Tell shoppers about our new range");
    await u.click(generate());
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(lastBody()).toEqual({ objective: "Tell shoppers about our new range" });
  });

  it("does not call the server when a merchant-supplied fact is invalid", async () => {
    const u = await page();
    await u.selectOptions(screen.getByLabelText("What should it build?"), "email");
    await u.type(objective(), "Grow my email list this season");
    await u.type(screen.getByLabelText("Privacy policy link (optional)"), "javascript:alert(1)");
    await u.click(generate());
    expect(await screen.findByRole("alert")).toHaveTextContent(/privacy policy link/i);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("lists the policy issues when the AI's draft is rejected", async () => {
    apiMock.mockRejectedValue(new ApiError(422, "ai_proposal_rejected", "The AI proposal didn't pass validation. Try rephrasing your goal.", ["Copy uses urgency or a countdown the merchant did not set up", "Recommended product ghost is not in the catalog"]));
    const u = await page();
    await u.type(objective(), "Sell more running shoes");
    await u.click(generate());
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't pass validation/);
    expect(screen.getByText(/invented deadlines|urgency or a countdown/)).toBeInTheDocument();
    expect(screen.getByText(/ghost is not in the catalog/)).toBeInTheDocument();
    expect(screen.queryByTestId("studio-review")).toBeNull();
  });

  it("shows a clear message when the server cannot be reached", async () => {
    apiMock.mockRejectedValue(new Error("network"));
    const u = await page();
    await u.type(objective(), "Sell more running shoes");
    await u.click(generate());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
  });

  it("regenerates with the merchant's feedback and keeps the same tool and facts", async () => {
    apiMock.mockResolvedValue({ campaign: row(configs.toast), explanation: "why" });
    const u = await page();
    await u.selectOptions(screen.getByLabelText("What should it build?"), "toast");
    await u.type(objective(), "Nudge shoppers toward free shipping");
    await u.type(screen.getByLabelText("Free-shipping threshold (optional)"), "75");
    await u.click(generate());
    await screen.findByTestId("studio-review");
    const regen = screen.getByRole("button", { name: "Regenerate" });
    expect(regen).toBeDisabled();
    await u.type(screen.getByLabelText("Feedback for regeneration"), "friendlier tone");
    await u.click(regen);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(lastBody()).toEqual({ objective: "Nudge shoppers toward free shipping", tool: "toast", freeShippingThreshold: 75, feedback: "friendlier tone" });
  });
});
