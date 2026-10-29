import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CampaignMenu } from "@/components/campaign-menu";
import { campaignsHref, typeOf } from "@/lib/campaign-types";

const campaign = { id: "cmp_1", name: "Summer", status: "active" as const };
const groups = [
  { id: "grp_a", name: "Black Friday", campaignIds: ["cmp_1"], createdAt: "", updatedAt: "" },
  { id: "grp_b", name: "Winter", campaignIds: [], createdAt: "", updatedAt: "" },
];

/** The panel only exists once the ⋯ button is pressed, so open it the way a merchant would. */
const renderOpen = (ui: React.ReactElement) => {
  const r = render(ui);
  fireEvent.click(screen.getByRole("button", { name: "More actions for Summer" }));
  return r;
};

describe("CampaignMenu", () => {
  it("stays closed until the ⋯ button is pressed, and closes on Escape", () => {
    render(<CampaignMenu campaign={campaign} groups={[]} onAction={vi.fn()} onToggleGroup={vi.fn()} onSaveTemplate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Save as template" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Summer" }));
    expect(screen.getByRole("button", { name: "Save as template" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Submissions" }).getAttribute("href")).toBe("/app/campaigns/cmp_1/submissions");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Save as template" })).toBeNull();
  });

  it("moves focus into the portalled panel and through it with the arrow keys", () => {
    renderOpen(<CampaignMenu campaign={campaign} groups={[]} onAction={vi.fn()} onToggleGroup={vi.fn()} onSaveTemplate={vi.fn()} />);
    const first = screen.getByRole("link", { name: "Campaign" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Builder" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });

  it("shows each group with whether this campaign is in it, and reports the toggle", () => {
    const onToggleGroup = vi.fn();
    renderOpen(<CampaignMenu campaign={campaign} groups={groups} onAction={vi.fn()} onToggleGroup={onToggleGroup} onSaveTemplate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Black Friday/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Winter" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Winter" }));
    expect(onToggleGroup).toHaveBeenCalledWith("grp_b", false);
  });

  it("saves as a template and no longer marks the feature as coming soon", () => {
    const onSaveTemplate = vi.fn();
    renderOpen(<CampaignMenu campaign={campaign} groups={[]} onAction={vi.fn()} onToggleGroup={vi.fn()} onSaveTemplate={onSaveTemplate} />);
    expect(screen.getByText(/No groups yet/)).toBeTruthy();
    expect(screen.queryByText("Soon")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
    expect(onSaveTemplate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Save as template" })).toBeNull(); // closes after a choice
  });

  it("hides duplicate and archive for archived campaigns", () => {
    renderOpen(<CampaignMenu campaign={{ ...campaign, status: "archived" }} groups={[]} onAction={vi.fn()} onToggleGroup={vi.fn()} onSaveTemplate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
  });
});

describe("typeOf", () => {
  it("sorts a campaign into its folder from its saved format", () => {
    expect(typeOf({ draftConfig: { format: "popup" } })).toBe("popups");
    expect(typeOf({ draftConfig: { format: "announcement_bar" } })).toBe("sticky-bars");
    expect(typeOf({ draftConfig: { format: "inline" } })).toBe("embeds");
    expect(typeOf({ draftConfig: { format: "toast" } })).toBe("on-site-tools");
    expect(typeOf({ draftConfig: null })).toBe("on-site-tools");
  });

  it("builds list URLs that keep the folder in sync with the sidebar", () => {
    expect(campaignsHref("all")).toBe("/app/campaigns");
    expect(campaignsHref("popups")).toBe("/app/campaigns?type=popups");
    expect(campaignsHref("sticky-bars")).toBe("/app/campaigns?type=sticky-bars");
  });
});
