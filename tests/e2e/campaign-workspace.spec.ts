import { expect, test } from "@playwright/test";
import { newMerchant } from "./support";

/**
 * The campaign workspace as a merchant uses it: a draft appears in the right folder, the sidebar folder links
 * change the filter, groups can be filled and renamed, a template can be saved and reused, and every step page
 * opens for the same campaign.
 */
test("campaign workspace: folders, groups, templates and step pages", async ({ browser }) => {
  const m = await newMerchant(browser, { plan: "growth" });
  const page = m.page;

  await page.goto("/app/campaigns/new?start=blank");
  await page.getByLabel("Campaign name").fill("Workspace test");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\/cmp_/);
  const campaignUrl = page.url();

  // The five step pages render for this campaign.
  await page.goto(`${campaignUrl}/preview`);
  await expect(page.getByRole("heading", { name: "Preview: Workspace test" })).toBeVisible();
  await page.goto(`${campaignUrl}/launch`);
  await expect(page.getByRole("heading", { name: "Launch: Workspace test" })).toBeVisible();
  await page.goto(`${campaignUrl}/submissions`);
  await expect(page.getByRole("heading", { name: "Submissions", exact: true })).toBeVisible();
  await page.goto(`${campaignUrl}/performance`);
  await expect(page.getByRole("heading", { name: "Workspace test", exact: true })).toBeVisible();

  // The default draft is a popup, so it belongs to the Popups folder. The sidebar filter follows the URL both ways.
  await page.goto("/app/campaigns");
  await expect(page.getByRole("link", { name: "Workspace test", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Popups" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\?type=popups$/);
  await expect(page.getByRole("link", { name: "Workspace test", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Sticky bars" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\?type=sticky-bars$/);
  await expect(page.getByText("No campaigns match your filters.")).toBeVisible();
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(page).toHaveURL(/\/app\/campaigns$/);

  // Creating a group must not hide the campaign it is meant to contain.
  await page.getByLabel("New group name").fill("Launch group");
  await page.getByRole("button", { name: "Add group" }).click();
  await expect(page.getByText(/Group “Launch group” created/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Workspace test", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions for Workspace test" }).click();
  await page.getByRole("button", { name: "Launch group", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Launch group\s*1/ })).toBeVisible();
  await page.getByRole("button", { name: /Launch group\s*1/ }).click();
  await expect(page.getByRole("link", { name: "Workspace test", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rename group" }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Launch offers");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: /Launch offers\s*1/ })).toBeVisible();

  // Save the draft as a template, then start a fresh draft from it.
  await page.getByRole("button", { name: "More actions for Workspace test" }).click();
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByText(/Saved “Workspace test” as a template/)).toBeVisible();
  await page.goto("/app/templates");
  const saved = page.getByRole("region", { name: "Your templates" });
  await expect(saved.getByText("Workspace test")).toBeVisible();
  await saved.getByRole("button", { name: "Use" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\/cmp_/);
  await expect(page.getByLabel("Campaign name")).toHaveValue("Workspace test");

  await m.ctx.close();
});
