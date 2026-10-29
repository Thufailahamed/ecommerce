import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CampaignRow, Store } from "@/lib/api";
import type { Analytics } from "@/lib/analytics";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

import { Performance } from "@/app/app/campaigns/[id]/performance/page";

const store = { id: "sto_1", organizationId: "org_1", currency: "USD" } as Store;

const campaign = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: "cmp_1", name: "Newsletter popup", tool: "email", status: "active", draftConfig: { format: "popup" },
  publishedVersionId: "ver_1", updatedAt: "2026-10-28T00:00:00.000Z", ...over,
});

const analytics = (over: Partial<Analytics> = {}): Analytics => ({
  totals: { eligible: 100, impressions: 100, clicks: 0, dismissals: 0, ctr: null, observedOrders: 0, observedRevenue: 0, attributedOrders: 0, attributedRevenue: 0 },
  campaigns: [{ campaignId: "cmp_1", impressions: 100, clicks: 0, dismissals: 0, addToCarts: 0, ctr: null, attributedOrders: 0, attributedRevenue: 0 }],
  forms: [{ campaignId: "cmp_1", impressions: 100, requested: 12, confirmed: 8, deliveryFailed: 1, requestRate: 0.12, confirmRate: 8 / 12 }],
  experiments: [],
  freshness: { latestDay: "2026-10-28" },
  notes: ["Attributed revenue is not incremental."],
  ...over,
});

function respond(analyticsPayload: Analytics, campaignPayload: CampaignRow, plan: "free" | "growth" = "growth") {
  apiMock.mockImplementation(async (path: unknown) => {
    const p = String(path);
    if (p.includes("/analytics?")) return analyticsPayload;
    if (p.includes("/campaigns/")) return campaignPayload;
    if (p.includes("/billing/subscription")) return { plan };
    throw new Error(`unexpected request ${p}`);
  });
}

beforeEach(() => { apiMock.mockReset(); });

describe("a campaign's performance page", () => {
  it("shows email signup performance instead of clicks and orders for an email campaign", async () => {
    respond(analytics(), campaign());
    render(<Performance store={store} id="cmp_1" />);

    expect(await screen.findByRole("heading", { name: "Newsletter popup" })).toBeTruthy();

    // The headline cards show what an email form can actually do.
    expect(screen.getAllByText("Signup requests")).toHaveLength(2); // card + measure
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThanOrEqual(2); // card + funnel
    expect(screen.getAllByText("Confirmation rate").length).toBeGreaterThanOrEqual(2); // card + measure
    expect(screen.queryByText("Conversions")).toBeNull();
    expect(screen.queryByText("Completions")).toBeNull();

    const journey = screen.getByRole("region", { name: "Shopper journey" });
    const funnel = within(journey).getByRole("list", { name: "Funnel" });
    expect(within(funnel).getByText("Viewers")).toBeTruthy();
    expect(within(funnel).getByText("Requests")).toBeTruthy();
    expect(within(funnel).getByText("Confirmed")).toBeTruthy();
    expect(within(journey).getByText("Requests to confirmed")).toBeTruthy();
    expect(within(journey).getByText("66.7%")).toBeTruthy();

    const measures = screen.getByRole("region", { name: "Measures" });
    expect(within(measures).getByText("Signup requests")).toBeTruthy();
    expect(within(measures).getByText("Confirmed subscribers")).toBeTruthy();
    expect(within(measures).getByText("Delivery failures")).toBeTruthy();
    expect(within(measures).getByText("66.7%")).toBeTruthy();

    // A confirmation email that failed to send is never hidden.
    expect(screen.getByText(/1 confirmation email could not be sent/)).toBeTruthy();
    expect(screen.queryByText(/No activity in this period yet/)).toBeNull();
  });

  it("does not call a campaign quiet when a signup was requested but not yet confirmed", async () => {
    respond(analytics({
      forms: [{ campaignId: "cmp_1", impressions: 100, requested: 1, confirmed: 0, deliveryFailed: 0, requestRate: 0.01, confirmRate: 0 }],
    }), campaign(), "free");
    render(<Performance store={store} id="cmp_1" />);

    expect(await screen.findByRole("heading", { name: "Newsletter popup" })).toBeTruthy();
    expect(screen.queryByText(/No activity in this period yet/)).toBeNull();
    const measures = screen.getByRole("region", { name: "Measures" });
    expect(within(measures).getByText("0.0%")).toBeTruthy();

    // The page explains the real reason a free-plan email campaign collects nothing.
    expect(screen.getByText(/cannot collect sign-ups on your current plan/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change plan" }).getAttribute("href")).toBe("/app/settings#billing");
  });

  it("keeps the click and order journey for non-email campaigns", async () => {
    respond(analytics({
      campaigns: [{ campaignId: "cmp_1", impressions: 100, clicks: 5, dismissals: 0, addToCarts: 0, ctr: 0.05, attributedOrders: 1, attributedRevenue: 50 }],
      forms: [],
    }), campaign({ name: "Promo toast", tool: "toast", draftConfig: { format: "toast" } }));
    render(<Performance store={store} id="cmp_1" />);

    expect(await screen.findByRole("heading", { name: "Promo toast" })).toBeTruthy();
    expect(screen.getAllByText("Conversions").length).toBeGreaterThanOrEqual(2); // card + measures + funnel
    expect(screen.getByText("Conversion rate")).toBeTruthy();
    expect(screen.queryByText("Signup requests")).toBeNull();
    expect(screen.getByText("Completions")).toBeTruthy();
    expect(screen.getByText("Not tracked yet")).toBeTruthy();

    const journey = screen.getByRole("region", { name: "Shopper journey" });
    const funnel = within(journey).getByRole("list", { name: "Funnel" });
    expect(within(funnel).getByText("Conversions")).toBeTruthy();
    expect(within(funnel).getByText("Orders")).toBeTruthy();
    expect(screen.queryByText(/cannot collect sign-ups/)).toBeNull();
  });
});
