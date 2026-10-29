import { expect, test } from "@playwright/test";
import { newMerchant } from "./support";

const config = {
  schemaVersion: 1, name: "Newsletter popup", tool: "email", format: "popup",
  creative: { headline: "Join our email list", body: "News and offers, straight to your inbox.", ctaLabel: "Sign up", ctaUrl: "/" },
  style: {}, trigger: { type: "delay", seconds: 8 }, targeting: { match: "all", conditions: [] },
  frequency: {}, priority: 50, goal: { type: "subscribe" },
  form: {
    collect: { email: true, phone: false, firstName: false },
    consentText: "I agree to receive marketing emails from this store. I can unsubscribe at any time.",
    privacyUrl: "/privacy-policy", doubleOptIn: true,
  },
};
const campaign = {
  id: "cmp_studio", name: "Newsletter popup", tool: "email", status: "draft", draftConfig: config,
  publishedVersionId: null, updatedAt: "2026-10-28T00:00:00.000Z",
};

test("AI studio: generate, select a field, refine the same draft, and switch the preview device", async ({ browser }) => {
  const m = await newMerchant(browser);
  const bodies: Record<string, unknown>[] = [];
  await m.page.route("**/api/v1/stores/*/campaigns/ai-generate", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { campaign, explanation: "A welcome email popup built from your store data.", repairs: [], warnings: [], model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", gateway: true } }),
    });
  });

  await m.page.goto("/app/studio");
  await m.page.getByLabel("What should it build?").selectOption("email");
  await m.page.getByLabel("What do you want to achieve?").fill("Grow my email list with a welcome popup");
  await m.page.getByRole("button", { name: "Generate draft" }).click();
  await expect(m.page.getByTestId("studio-review")).toBeVisible();
  await expect(m.page.getByText("AI Gateway")).toBeVisible();
  await expect(m.page.getByLabel("Campaign preview").getByText("Join our email list").first()).toBeVisible();

  await m.page.getByLabel("Campaign preview").getByText("Join our email list").first().click();
  await expect(m.page.getByText("Editing: Headline")).toBeVisible();
  await m.page.getByLabel("Instruction for headline").fill("make it shorter and friendlier");
  await m.page.getByRole("button", { name: "Regenerate" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({
    objective: "Grow my email list with a welcome popup",
    tool: "email",
    campaignId: "cmp_studio",
    feedback: "Change the headline in the current draft. make it shorter and friendlier",
  });
  await expect(m.page.getByText(/Change the headline in the current draft/)).toBeVisible();

  await m.page.getByRole("group", { name: "Preview device" }).getByRole("button", { name: "Mobile" }).click();
  await expect(m.page.getByRole("group", { name: "Preview device" }).getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");

  await m.ctx.close();
});
