import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { API, STORE } from "./playwright.config";
import { alertOf, apiPost, newMerchant, shopper, type Merchant } from "./support";

const HEADLINE = "E2E free shipping nudge";
let m: Merchant;

async function totals(page: Page) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await page.request.get(`${API}/api/v1/stores/${m.storeId}/analytics?from=${day}&to=${day}`);
  return (await r.json() as { data: { totals: Record<string, number> } }).data.totals;
}

/** Waits for the SDK to boot, then tells it what is in the cart (the public API any store can use). */
async function setCart(page: Page, subtotal: number) {
  await page.waitForFunction(() => typeof (window as unknown as { ConvertFlow?: { setCart?: unknown } }).ConvertFlow?.setCart === "function");
  await page.evaluate((s) => (window as unknown as { ConvertFlow: { setCart(c: { subtotal: number }): void } }).ConvertFlow.setCart({ subtotal: s }), subtotal);
}

const toastOf = (p: Page) => p.locator("[data-convertflow][data-tool=toast]");

test.describe.serial("toast tool, end to end", () => {
  test.beforeAll(async ({ browser }) => { m = await newMerchant(browser); });

  test("tool navigation: the shipped tool is usable, the others are honestly marked not available", async () => {
    await m.page.goto("/app/tools/toast");
    const nav = m.page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: /Toasts/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: /SMS signup/ })).toContainText("Soon");
    await expect(nav.getByRole("link", { name: /Email signup/ })).not.toContainText("Soon"); // shipped (see email.spec.ts)
    await expect(nav.getByRole("link", { name: /Upsells/ })).not.toContainText("Soon"); // shipped (see upsell.spec.ts)
    await expect(m.page.getByRole("heading", { name: "Toasts", level: 1 })).toBeVisible();
    await expect(m.page.getByRole("link", { name: /Create your first campaign/ })).toBeVisible();

    await m.page.goto("/app/tools/sms");
    await expect(m.page.getByText("Not available yet").first()).toBeVisible();
    await expect(m.page.getByRole("link", { name: /New campaign/ })).toHaveCount(0);
    await m.page.goto("/app/tools/not-a-tool");
    await expect(m.page.getByText(/could not be found|404/i).first()).toBeVisible();
  });

  test("the server refuses to publish a tool that has not shipped, even via the API", async () => {
    const cfg = {
      schemaVersion: 1, name: "SMS", tool: "sms", format: "popup", creative: { headline: "Texts", ctaLabel: "Go", ctaUrl: "/" }, style: {},
      trigger: { type: "delay", seconds: 5 }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "subscribe" },
      form: { collect: { phone: true }, consentText: "I agree to receive marketing texts. Msg & data rates may apply. Reply STOP to opt out.", privacyUrl: "/privacy" },
    };
    const created = await (await apiPost(m.page, `/api/v1/stores/${m.storeId}/campaigns`, cfg)).json() as { data: { id: string; updatedAt: string } };
    const r = await apiPost(m.page, `/api/v1/stores/${m.storeId}/campaigns/${created.data.id}/publish`, { approve: true, approvedUpdatedAt: created.data.updatedAt });
    expect(r.status()).toBe(409);
    expect((await r.json() as { error: { code: string } }).error.code).toBe("tool_unavailable");
  });

  test("merchant builds a free-shipping toast with a live preview, approves and publishes it", async () => {
    await m.page.goto("/app/tools/toast");
    await m.page.getByRole("link", { name: /Create your first campaign/ }).click();
    await expect(m.page).toHaveURL(/\/app\/campaigns\/new\?tool=toast/);
    await expect(m.page.getByLabel("Format")).toHaveCount(0);

    await m.page.getByLabel("Campaign name").fill("E2E shipping toast");
    await m.page.getByLabel("Headline").fill(HEADLINE);
    await m.page.getByLabel("Type").selectOption("shipping_incentive");
    await expect(m.page.getByLabel("Free-shipping threshold (USD)")).toHaveValue("75");
    await m.page.getByLabel("Trigger").selectOption("immediate");
    await m.page.getByLabel("Add rule").selectOption("page_type");
    await m.page.getByLabel("Page type").selectOption("product");

    // The preview is the real renderer with a clearly labelled sample cart (80% of the threshold = 60).
    const preview = m.page.getByLabel("Campaign preview");
    await expect(preview.getByText(HEADLINE)).toBeVisible();
    await expect(preview.getByText("$15.00 away from free shipping")).toBeVisible();
    await expect(m.page.getByText(/Preview uses a sample cart/)).toBeVisible();
    await m.page.getByRole("button", { name: "Mobile" }).click();
    await expect(preview.getByText(HEADLINE)).toBeVisible();

    const publish = m.page.getByRole("button", { name: "Publish", exact: true });
    await expect(publish).toBeDisabled(); // never without explicit approval
    await m.page.getByRole("checkbox", { name: /approve it to go live/ }).check();
    await publish.click();
    await expect(m.page).toHaveURL(/\/app\/campaigns\/cmp_/);
    await expect(m.page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(alertOf(m.page)).toHaveCount(0);

    await m.page.goto("/app/campaigns");
    await expect(m.page.getByRole("row", { name: /E2E shipping toast/ })).toContainText("Toasts");
    await m.page.goto("/app/tools/toast");
    await expect(m.page.getByRole("link", { name: "E2E shipping toast" })).toBeVisible();
  });

  test("an eligible visitor sees the real remaining amount; the toast never takes focus or blocks the page", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await setCart(page, 60);
    const toast = toastOf(page);
    await expect(toast.getByText("$15.00 away from free shipping")).toBeVisible({ timeout: 15_000 });
    await expect(toast.getByText(HEADLINE)).toBeVisible();
    // Non-blocking: the page underneath is still interactive and focus was not stolen.
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.tagName === "BODY")).toBe(true);
    await page.locator("#buy").focus();
    await expect(page.locator("#buy")).toBeFocused();
    await ctx.close();
  });

  test("ineligible visitors see nothing: wrong page, unknown cart, and a cart that already qualifies", async ({ browser }) => {
    const wrongPage = await shopper(browser, "/", m.siteKey, { consent: "1" });
    await setCart(wrongPage.page, 60);
    await wrongPage.page.waitForTimeout(2500);
    await expect(toastOf(wrongPage.page)).toHaveCount(0);
    await wrongPage.ctx.close();

    const unknownCart = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await unknownCart.page.waitForTimeout(2500); // the SDK has loaded and evaluated: no cart was ever reported
    await expect(toastOf(unknownCart.page)).toHaveCount(0);
    await unknownCart.ctx.close();

    const qualifies = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await setCart(qualifies.page, 120);
    await qualifies.page.waitForTimeout(2500);
    await expect(toastOf(qualifies.page)).toHaveCount(0);
    await qualifies.ctx.close();
  });

  test("the toast updates when the cart changes and is accessible (axe) with a polite live region", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await setCart(page, 60);
    const toast = toastOf(page);
    await expect(toast.getByText("$15.00 away")).toBeVisible({ timeout: 15_000 });
    await expect(toast.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await expect(toast.getByRole("button", { name: "Dismiss notification" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const ours = results.violations.filter((v) => v.nodes.some((n) => JSON.stringify(n.target).includes("data-convertflow")));
    expect(ours.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await ctx.close();
  });

  test("on a phone it spans the bottom of the screen and stays inside the viewport", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const page = await ctx.newPage();
    await page.goto(`${STORE}/products/running-shoe?${new URLSearchParams({ site: m.siteKey, consent: "1" })}`);
    await setCart(page, 60);
    const panel = toastOf(page).getByRole("status");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(11);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 11);
    expect(box.y + box.height).toBeLessThanOrEqual(780);
    expect(box.y + box.height).toBeGreaterThan(780 - 60); // hugging the bottom
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await ctx.close();
  });

  test("reduced-motion shoppers get no animation", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`${STORE}/products/running-shoe?${new URLSearchParams({ site: m.siteKey, consent: "1" })}`);
    await setCart(page, 60);
    await expect(toastOf(page).getByRole("status")).toBeVisible({ timeout: 15_000 });
    const animations = await page.evaluate(() => document.querySelector("[data-convertflow]")!.shadowRoot!.querySelector("[role=status]")!.getAnimations().length);
    expect(animations).toBe(0);
    await ctx.close();
  });

  test("a click is recorded once, and a later purchase is attributed to this campaign exactly once", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await setCart(page, 60);
    await toastOf(page).getByRole("link", { name: "Shop now" }).click();
    await page.waitForURL(/\/collections\/all/);
    await expect.poll(async () => (await totals(m.page)).clicks, { timeout: 30_000, intervals: [1000] }).toBe(1);
    expect((await totals(m.page)).impressions).toBeGreaterThanOrEqual(2); // the two visitors who saw it

    await page.goto(`${STORE}/cart?${new URLSearchParams({ site: m.siteKey, consent: "1" })}`);
    await page.getByRole("button", { name: "Simulate order confirmation" }).click();
    await expect.poll(async () => (await totals(m.page)).attributedOrders, { timeout: 30_000, intervals: [1000] }).toBe(1);
    const t = await totals(m.page);
    expect(t.observedOrders).toBe(1);
    expect(t.attributedRevenue).toBeCloseTo(59.9);
    await ctx.close();
  });

  test("dismissing is remembered: the visitor is not shown it again, and a dismissal is recorded", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await setCart(page, 60);
    const toast = toastOf(page);
    await expect(toast.getByText(HEADLINE)).toBeVisible({ timeout: 15_000 });
    await toast.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(toast).toHaveCount(0);
    await expect.poll(async () => (await totals(m.page)).dismissals, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual(1);

    await page.goto(`${STORE}/products/running-shoe?${new URLSearchParams({ site: m.siteKey, consent: "1" })}`);
    await setCart(page, 60);
    await page.waitForTimeout(2500);
    await expect(toastOf(page)).toHaveCount(0);
    await ctx.close();
  });

  test("without consent the toast still shows, and nothing is recorded or stored", async ({ browser }) => {
    const before = await totals(m.page);
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await setCart(page, 60);
    await expect(toastOf(page).getByText(HEADLINE)).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => localStorage.getItem("cf:v1"))).toBeNull();
    await page.waitForTimeout(3000);
    const after = await totals(m.page);
    expect(after.impressions).toBe(before.impressions);
    await ctx.close();
  });

  test("pausing takes it off the storefront", async ({ browser }) => {
    await m.page.goto("/app/campaigns");
    await m.page.getByRole("button", { name: "Pause" }).click();
    await expect(m.page.locator("span", { hasText: /^paused$/ })).toBeVisible();
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await setCart(page, 60);
    await page.waitForTimeout(3000);
    await expect(toastOf(page)).toHaveCount(0);
    await ctx.close();
  });
});
