import { expect, test } from "@playwright/test";
import { AI_GATEWAY } from "./playwright.config";
import { newMerchant } from "./support";

/**
 * The whole AI store builder journey on the real stack: the Worker runs the real build pipeline against a mock AI
 * Gateway (mock-ai-gateway.mjs), streams it to the real editor, and the published store takes a real order.
 */
test("AI store builder: prompt → AI build → select and edit → chat edit → publish checklist → live store → order", async ({ browser }) => {
  const m = await newMerchant(browser);
  const page = m.page;
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Describe the store on the dashboard.
  await page.goto("/app/sites");
  await page.getByLabel("What store do you want to build?").fill("A candle shop called Ember & Oak with cosy autumn vibes");
  await page.getByRole("button", { name: /Build my store/ }).click();
  await expect(page).toHaveURL(/\/builder\/site_/);

  // 2. The build streams in: steps in the chat, the store in the preview.
  await expect(page.getByText(/Ember & Oak is ready to review/)).toBeVisible({ timeout: 60_000 });
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await expect(preview.getByRole("heading", { name: "Light the slow evening" })).toBeVisible();
  await expect(preview.getByText("Cedar Smoke").first()).toBeVisible();
  await expect(page.getByText("Edited hero").or(page.getByText(/Added product "Cedar Smoke"/)).first()).toBeVisible();

  // The Worker called the gateway's OpenAI-compatible endpoint with the configured model and token.
  const calls = await (await fetch(`${AI_GATEWAY}/requests`)).json() as { path: string; auth: string; model: string | null }[];
  expect(calls.some((c) => c.path.endsWith("/compat/chat/completions") && c.model === "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast" && c.auth === "Bearer e2e-token")).toBe(true);
  expect(calls.some((c) => c.path.includes("/workers-ai/@cf/black-forest-labs/flux-1-schnell"))).toBe(true);

  // 3. Click the hero in the preview: the inspector opens on it; editing a field updates the preview.
  await preview.getByRole("heading", { name: "Light the slow evening" }).click();
  const inspector = page.getByRole("complementary", { name: "Section settings" });
  await expect(inspector.getByRole("heading", { name: "Hero" })).toBeVisible();
  await expect(page.getByText(/Editing: Hero/)).toBeVisible();
  const subheading = inspector.getByLabel(/^Subheading/);
  await subheading.fill("Poured by hand in small batches.");
  await expect(preview.getByText("Poured by hand in small batches.")).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

  // 4. Ask the AI to change the selected section; the reply streams and the preview updates.
  await page.getByLabel("Message the AI designer").fill("Make this headline punchier");
  await page.getByLabel("Message the AI designer").press("Enter");
  await expect(page.getByText("Done: the hero headline is shorter and punchier now.")).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByRole("heading", { name: "Evenings, slowed down" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a gift guide page" })).toBeVisible();

  // 5. Publishing is blocked by the AI's sample testimonials until the merchant deals with them.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish your store" });
  await expect(dialog.getByText(/testimonials are samples/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: /testimonials are samples/ }).click();
  await page.getByRole("complementary", { name: "Section settings" }).getByRole("button", { name: "Hide section" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog", { name: "Publish your store" }).getByRole("button", { name: "Publish", exact: true }).click();
  const live = page.getByRole("dialog", { name: "Your store is live" });
  await expect(live).toBeVisible();
  const storeHref = await live.getByRole("link", { name: "View store" }).getAttribute("href");
  expect(storeHref).toMatch(/^\/s\/[a-z0-9-]+$/);
  const siteId = /\/builder\/(site_[a-z0-9_]+)/.exec(page.url())![1];

  // 6. A shopper buys from the live store.
  const shopperCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const shop = await shopperCtx.newPage();
  await shop.goto(storeHref!);
  await expect(shop.getByRole("heading", { name: "Evenings, slowed down" })).toBeVisible();
  await expect(shop.getByText("Kind words")).toHaveCount(0); // hidden section is not published
  await shop.getByRole("link", { name: /Cedar Smoke/ }).first().click();
  await expect(shop).toHaveURL(/\/products\/cedar-smoke$/);
  await shop.getByRole("button", { name: "Add to cart" }).click();
  await shop.getByRole("link", { name: "Checkout" }).click();
  await expect(shop).toHaveURL(/\/checkout$/);
  await shop.getByLabel("Email").fill("shopper@example.com");
  await shop.getByLabel("Full name").fill("Alex Shopper");
  await shop.getByLabel("Address", { exact: true }).fill("1 Main St");
  await shop.getByLabel("City").fill("Springfield");
  await shop.getByLabel("Postal code").fill("12345");
  await shop.getByLabel("Country").fill("United States");
  await shop.getByRole("button", { name: /Place order/ }).click();
  await expect(shop.getByText("Thank you! We've received your order.")).toBeVisible({ timeout: 15_000 });
  await expect(shop.getByText("Order #1001")).toBeVisible();
  await shopperCtx.close();

  // 7. The merchant sees it.
  await page.goto(`/app/sites/${siteId}/orders`);
  await expect(page.getByRole("cell", { name: "#1001" })).toBeVisible();
  await expect(page.getByText("Alex Shopper")).toBeVisible();

  await m.ctx.close();
});
