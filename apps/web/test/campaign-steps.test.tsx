import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignSteps } from "@/components/campaign-steps";

describe("CampaignSteps", () => {
  it("links all five steps to the same campaign and marks the current one", () => {
    render(<CampaignSteps id="cmp_1" current="launch" />);
    expect(screen.getByRole("link", { name: "Campaign" }).getAttribute("href")).toBe("/app/campaigns/cmp_1/performance");
    expect(screen.getByRole("link", { name: "Builder" }).getAttribute("href")).toBe("/app/campaigns/cmp_1");
    expect(screen.getByRole("link", { name: "Preview" }).getAttribute("href")).toBe("/app/campaigns/cmp_1/preview");
    expect(screen.getByRole("link", { name: "Submissions" }).getAttribute("href")).toBe("/app/campaigns/cmp_1/submissions");
    expect(screen.getByRole("link", { name: "Launch" }).getAttribute("aria-current")).toBe("step");
  });
});
