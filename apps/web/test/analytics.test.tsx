import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CampaignRow, Store } from "@/lib/api";
import type { Analytics } from "@/lib/analytics";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

import { View } from "@/app/app/analytics/page";

const store = { id: "sto_1", organizationId: "org_1", currency: "USD" } as Store;
const campaign = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: "cmp_1", name: "Newsletter popup", tool: "email", status: "active", draftConfig: { format: "popup" },
  publishedVersionId: "ver_1", updatedAt: "2026-10-28T00:00:00.000Z", ...over,
});
const analytics = (over: Partial<Analytics> = {}): Analytics => ({
  totals: { eligible: 4, impressions: 4, clicks: 0, dismissals: 0, ctr: 0, observedOrders: 0, observedRevenue: 0, attributedOrders: 0, attributedRevenue: 0 },
  campaigns: [{ campaignId: "cmp_1", impressions: 4, clicks: 0, dismissals: 0, addToCarts: 0, ctr: 0, attributedOrders: 0, attributedRevenue: 0 }],
  forms: [{ campaignId: "cmp_1", impressions: 4, requested: 3, confirmed: 2, deliveryFailed: 1, requestRate: 0.75, confirmRate: 2 / 3 }],
  experiments: [],
  freshness: { latestDay: "2026-10-28" },
  notes: ["Attributed revenue is not incremental."],
  ...over,
});

function respond(analyticsPayload: Analytics, campaigns: CampaignRow[] = [campaign()], plan: "free" | "growth" = "growth") {
  apiMock.mockImplementation(async (path: unknown) => {
    const p = String(path);
    if (p.includes("/analytics?")) return analyticsPayload;
    if (p.includes("/campaigns")) return campaigns;
    if (p.includes("/billing/subscription")) return { plan };
    throw new Error(`unexpected request ${p}`);
  });
}

beforeEach(() => { apiMock.mockReset(); });

describe("the analytics overview", () => {
  it("surfaces email signups instead of hiding them behind clicks and orders", async () => {
    respond(analytics());
    render(<View store={store} />);

    expect(await screen.findByRole("heading", { name: "Analytics" })).toBeTruthy();

    const signups = screen.getByRole("group", { name: "Email signups" });
    expect(within(signups).getByText("Sign-up requests")).toBeTruthy();
    expect(within(signups).getByText("Confirmed opt-ins")).toBeTruthy();
    expect(within(signups).getByText("Confirmation rate")).toBeTruthy();
    expect(within(signups).getByText("Delivery failures")).toBeTruthy();
    expect(within(signups).getByText("3")).toBeTruthy();
    expect(within(signups).getByText("2")).toBeTruthy();
    expect(within(signups).getByText("66.7%")).toBeTruthy();

    // The funnel tells the email story, not just the click story.
    const signupJourney = screen.getByRole("region", { name: "Signup journey" });
    const funnel = within(signupJourney).getByRole("list", { name: "Funnel" });
    expect(within(funnel).getByText("Form views")).toBeTruthy();
    expect(within(funnel).getByText("Sign-up requests")).toBeTruthy();
    expect(within(funnel).getByText("Confirmed")).toBeTruthy();

    // A confirmation email that failed to send is never hidden.
    expect(screen.getByText(/1 confirmation email could not be sent/)).toBeTruthy();
  });

  it("links each campaign to its performance page", async () => {
    respond(analytics());
    render(<View store={store} />);

    const table = await screen.findByRole("table", { name: "Campaign activity" });
    expect(within(table).getByRole("link", { name: "Newsletter popup" }).getAttribute("href")).toBe("/app/campaigns/cmp_1/performance");
  });

  it("does not call a store quiet when only server-side signups exist", async () => {
    respond(analytics({
      totals: { eligible: 0, impressions: 0, clicks: 0, dismissals: 0, ctr: null, observedOrders: 0, observedRevenue: 0, attributedOrders: 0, attributedRevenue: 0 },
      campaigns: [],
      forms: [{ campaignId: "cmp_1", impressions: 0, requested: 2, confirmed: 1, deliveryFailed: 0, requestRate: null, confirmRate: 0.5 }],
    }));
    render(<View store={store} />);

    expect(await screen.findByRole("heading", { name: "Analytics" })).toBeTruthy();
    expect(screen.queryByText(/No activity in this period/)).toBeNull();
    expect(within(screen.getByRole("group", { name: "Email signups" })).getByText("50.0%")).toBeTruthy();
    // There are no browser-reported impressions, so an empty "By campaign" table would be noise.
    expect(screen.queryByRole("table", { name: "Campaign activity" })).toBeNull();
  });

  it("does not call a store quiet when clicks exist without an impression total", async () => {
    respond(analytics({
      totals: { eligible: 1, impressions: 0, clicks: 1, dismissals: 0, ctr: null, observedOrders: 0, observedRevenue: 0, attributedOrders: 0, attributedRevenue: 0 },
      campaigns: [{ campaignId: "cmp_1", impressions: 0, clicks: 1, dismissals: 0, addToCarts: 0, ctr: null, attributedOrders: 0, attributedRevenue: 0 }],
      forms: [],
    }));
    render(<View store={store} />);

    expect(await screen.findByRole("heading", { name: "Analytics" })).toBeTruthy();
    expect(screen.queryByText(/No activity in this period/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Email signups" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Signup journey" })).toBeNull();
  });

  it("explains what will appear and how to check the snippet when there is genuinely no activity", async () => {
    respond(analytics({
      totals: { eligible: 0, impressions: 0, clicks: 0, dismissals: 0, ctr: null, observedOrders: 0, observedRevenue: 0, attributedOrders: 0, attributedRevenue: 0 },
      campaigns: [],
      forms: [],
    }));
    render(<View store={store} />);

    expect(await screen.findByText("No activity in this period")).toBeTruthy();
    expect(screen.getByText(/impressions, clicks and sign-ups/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View campaigns" }).getAttribute("href")).toBe("/app/campaigns");
  });

  it("explains that an active email campaign cannot collect sign-ups on a plan without email", async () => {
    respond(analytics({
      totals: { eligible: 0, impressions: 0, clicks: 0, dismissals: 0, ctr: null, observedOrders: 0, observedRevenue: 0, attributedOrders: 0, attributedRevenue: 0 },
      campaigns: [],
      forms: [],
    }), [campaign()], "free");
    render(<View store={store} />);

    expect(await screen.findByText(/cannot collect sign-ups on your current plan/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change plan" }).getAttribute("href")).toBe("/app/settings#billing");
  });
});
