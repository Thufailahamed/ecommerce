import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TOOL_METRICS } from "@convertflow/contracts";
import type { Store } from "@/lib/api";
import type { ToolAnalytics, ToolMetrics, ToolRollup } from "@/lib/analytics";
import { TOOLS, TOOL_ORDER } from "@/lib/tools";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

import { ToolAnalyticsView, ViewTabs, formatMetric, sectionState, type View } from "@/components/tool-analytics";

const store = { id: "sto_1", currency: "EUR" } as unknown as Store;
const zero = (): ToolMetrics => ({
  eligible: 0, impressions: 0, clicks: 0, dismissals: 0, addToCarts: 0, formSubmitAttempts: 0, formSubmitSuccesses: 0, formSubmitFailures: 0,
  requested: 0, confirmed: 0, deliveryFailed: 0, attributedOrders: 0, attributedRevenue: 0,
  ctr: null, dismissRate: null, addToCartRate: null, requestRate: null, confirmRate: null,
});
const rollup = (tool: ToolRollup["tool"], over: Partial<ToolRollup> = {}): ToolRollup => ({ tool, campaigns: 0, live: 0, metrics: zero(), byCampaign: [], ...over });
const payload = (tools: ToolRollup[]): ToolAnalytics => ({
  range: { from: "2026-10-01", to: "2026-10-31" }, tools, freshness: { latestDay: "2026-10-27" },
  notes: ["Attributed revenue is not incremental."],
});
const all = (over: Partial<Record<ToolRollup["tool"], ToolRollup>> = {}) => TOOL_ORDER.map((t) => over[t] ?? rollup(t));

beforeEach(() => apiMock.mockReset());

describe("what a tool's section says", () => {
  it("separates 'not available', 'nothing created', 'created but quiet' and 'has data'", () => {
    expect(sectionState(false, rollup("sms"))).toBe("unavailable");
    expect(sectionState(true, rollup("feed"))).toBe("no_campaigns");
    expect(sectionState(true, rollup("feed", { campaigns: 2, live: 1 }))).toBe("no_activity");
    expect(sectionState(true, rollup("feed", { campaigns: 1, metrics: { ...zero(), impressions: 1 } }))).toBe("data");
    // an unshipped tool that somehow has data still shows it rather than hiding it
    expect(sectionState(false, rollup("sms", { campaigns: 1, metrics: { ...zero(), requested: 1 } }))).toBe("data");
  });
});

describe("formatting", () => {
  it("shows no data as a dash, never as 0%", () => {
    const rate = TOOL_METRICS.toast.find((d) => d.key === "ctr")!;
    expect(formatMetric(rate, null, "EUR")).toBe("–");
    expect(formatMetric(rate, 0, "EUR")).toBe("0.0%");
    expect(formatMetric(rate, 0.25, "EUR")).toBe("25.0%");
    expect(formatMetric(TOOL_METRICS.toast.find((d) => d.key === "impressions")!, 12345, "EUR")).toBe("12,345");
    expect(formatMetric(TOOL_METRICS.toast.find((d) => d.key === "attributedRevenue")!, 80, "EUR")).toBe("€80.00");
  });
});

describe("analytics view tabs", () => {
  function Harness() { const [v, setV] = useState<View>("overview"); return <><ViewTabs value={v} onChange={setV} /><output data-testid="v">{v}</output></>; }
  it("is a tablist with one tab in the tab order, switched by click and arrow keys", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Overview", "By tool"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1]);
    tabs[0]!.focus();
    await u.keyboard("{ArrowRight}");
    expect(screen.getByTestId("v").textContent).toBe("tools");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "By tool" }));
    await u.keyboard("{ArrowRight}"); // wraps
    expect(screen.getByTestId("v").textContent).toBe("overview");
    await u.keyboard("{End}");
    expect(screen.getByTestId("v").textContent).toBe("tools");
    await u.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByTestId("v").textContent).toBe("overview");
  });
});

describe("per-tool analytics view", () => {
  const sectionOf = (tool: ToolRollup["tool"]) => screen.getByRole("region", { name: TOOLS[tool].name });

  it("asks for the tool rollups of the chosen range and shows a section for every tool", async () => {
    apiMock.mockResolvedValueOnce(payload(all()));
    render(<ToolAnalyticsView store={store} range="from=2026-10-01&to=2026-10-31" />);
    expect(await screen.findByRole("region", { name: TOOLS.toast.name })).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/analytics/tools?from=2026-10-01&to=2026-10-31");
    for (const t of TOOL_ORDER) expect(sectionOf(t)).toBeTruthy();
    expect(screen.getByText("Attributed revenue is not incremental.")).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });

  it("says plainly when a tool has no campaigns, and links to it", async () => {
    apiMock.mockResolvedValueOnce(payload(all()));
    render(<ToolAnalyticsView store={store} range="x" />);
    await screen.findByRole("region", { name: TOOLS.feed.name });
    const s = within(sectionOf("feed"));
    expect(s.getByText(new RegExp(`No ${TOOLS.feed.name.toLowerCase()} campaigns yet`, "i"))).toBeTruthy();
    expect(s.getByRole("link", { name: new RegExp(TOOLS.feed.name) }).getAttribute("href")).toBe("/app/tools/feed");
  });

  it("says a live campaign with no activity is quiet, rather than showing a table of zeros", async () => {
    apiMock.mockResolvedValueOnce(payload(all({ toast: rollup("toast", { campaigns: 1, live: 1, byCampaign: [{ campaignId: "c1", name: "Welcome", status: "active", ...zero() }] }) })));
    render(<ToolAnalyticsView store={store} range="x" />);
    await screen.findByRole("region", { name: TOOLS.toast.name });
    expect(screen.getByTestId("toast-quiet").textContent).toContain("No activity in this period");
    expect(within(sectionOf("toast")).queryByRole("table")).toBeNull();
  });

  it("shows each tool's own metrics, with correct values, dashes for undefined rates and a per-campaign drill-down", async () => {
    const m: ToolMetrics = { ...zero(), impressions: 200, clicks: 20, addToCarts: 8, ctr: 0.1, addToCartRate: 0.04, attributedOrders: 3, attributedRevenue: 240 };
    apiMock.mockResolvedValueOnce(payload(all({
      upsell: rollup("upsell", { campaigns: 2, live: 1, metrics: m, byCampaign: [
        { campaignId: "c1", name: "Cart add-ons", status: "active", ...m },
        { campaignId: "c2", name: "Paused block", status: "paused", ...zero() },
      ] }),
    })));
    render(<ToolAnalyticsView store={store} range="x" />);
    await screen.findByRole("region", { name: TOOLS.upsell.name });
    const s = within(sectionOf("upsell"));
    for (const d of TOOL_METRICS.upsell) expect(s.getAllByText(d.label).length, d.label).toBeGreaterThan(0);
    expect(s.getAllByText("10.0%").length).toBeGreaterThan(0); // click rate = 20 / 200
    expect(s.getAllByText("4.0%").length).toBeGreaterThan(0); // add-to-cart rate
    expect(s.getAllByText("€240.00").length).toBeGreaterThan(0);
    const table = s.getByRole("table", { name: `${TOOLS.upsell.name} by campaign` });
    const row = within(table).getByRole("row", { name: /Cart add-ons/ });
    expect(within(row).getByRole("link", { name: "Cart add-ons" }).getAttribute("href")).toBe("/app/campaigns/c1");
    const paused = within(table).getByRole("row", { name: /Paused block/ });
    expect(within(paused).getAllByText("–").length).toBeGreaterThan(0); // no impressions: rates are a dash, not 0%
    expect(s.getByText("1 live of 2 campaigns")).toBeTruthy();
  });

  it("warns when confirmation emails could not be sent", async () => {
    const m: ToolMetrics = { ...zero(), impressions: 50, requested: 5, confirmed: 2, deliveryFailed: 2, requestRate: 0.1, confirmRate: 0.4 };
    apiMock.mockResolvedValueOnce(payload(all({ email: rollup("email", { campaigns: 1, live: 1, metrics: m, byCampaign: [{ campaignId: "c9", name: "Footer signup", status: "active", ...m }] }) })));
    render(<ToolAnalyticsView store={store} range="x" />);
    await screen.findByRole("region", { name: TOOLS.email.name });
    const s = within(sectionOf("email"));
    expect(s.getByText(/2 confirmation emails could not be sent/)).toBeTruthy();
    expect(s.getAllByText("40.0%").length).toBeGreaterThan(0); // the tile and the campaign row
  });

  it("shows an error, not an empty page, when the request fails", async () => {
    const { ApiError } = await import("@/lib/api");
    apiMock.mockRejectedValueOnce(new ApiError(500, "server_error", "Could not load analytics"));
    render(<ToolAnalyticsView store={store} range="x" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load analytics");
    expect(screen.queryByRole("region")).toBeNull();
  });
});
