import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { API, STORE } from "./playwright.config";
import { alertOf, launch, newMerchant, openTab, shopper, type Merchant } from "./support";

let m: Merchant;

async function totals(page: Page) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await page.request.get(`${API}/api/v1/stores/${m.storeId}/analytics?from=${day}&to=${day}`);
  return (await r.json() as { data: { totals: Record<string, number> } }).data.totals;
}

/** Builds and publishes one feed card through the real editor. */
async function createCard(page: Page, o: { name: string; headline: string; category?: string; order?: number; ends?: string; cartOnly?: boolean }) {
  await page.goto("/app/campaigns/new?tool=feed");
  await page.getByLabel("Campaign name").fill(o.name);
  await page.getByLabel("Headline").fill(o.headline);
  if (o.category) await page.getByLabel("Category").fill(o.category);
  if (o.order !== undefined) await page.getByLabel("Order", { exact: true }).fill(String(o.order));
  if (o.ends) { await openTab(page, "Display"); await page.getByLabel("Ends").fill(o.ends); }
  if (o.cartOnly) {
    await openTab(page, "Targeting");
    await page.getByLabel("Add rule").selectOption("page_type");
    const pages = page.getByRole("group", { name: "Page type" });
    await pages.getByRole("button", { name: "Product" }).click(); // start from the rule's default
    await pages.getByRole("button", { name: "Cart" }).click();
  }
  await launch(page);
  await expect(page).toHaveURL(/\/app\/campaigns\/cmp_/);
  await expect(page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(alertOf(page)).toHaveCount(0);
}

const feedOf = (p: Page) => p.locator("[data-convertflow][data-tool=feed]");
const bellOf = (p: Page) => feedOf(p).getByRole("button", { name: /^Notifications/ });
const panelOf = (p: Page) => feedOf(p).getByRole("dialog", { name: "Notifications" });

test.describe.serial("notification feed, end to end", () => {
  test.beforeAll(async ({ browser }) => { m = await newMerchant(browser, { plan: "growth" }); });

  test("the feed is a shipped tool with its own page and an honest empty state", async () => {
    await m.page.goto("/app/tools/feed");
    await expect(m.page.getByRole("heading", { name: "Notification feed", level: 1 })).toBeVisible();
    await expect(m.page.getByText("Not available yet")).toHaveCount(0);
    await expect(m.page.getByRole("link", { name: /Create your first campaign/ })).toBeVisible();
    const nav = m.page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: /Notification feed/ })).not.toContainText("Soon");
  });

  test("merchant builds cards with a live preview of the real feed, then approves and publishes", async () => {
    await m.page.goto("/app/tools/feed");
    await m.page.getByRole("link", { name: /Create your first campaign/ }).click();
    await expect(m.page).toHaveURL(/\/app\/campaigns\/new\?tool=feed/);
    await expect(m.page.getByLabel("Trigger")).toHaveCount(0); // a feed card has no trigger
    await m.page.getByLabel("Headline").fill("E2E preview card");
    const preview = m.page.getByLabel("Campaign preview");
    await expect(preview.getByRole("dialog", { name: "Notifications" })).toBeVisible(); // the real renderer, opened
    await expect(preview.getByText("E2E preview card")).toBeVisible();

    await createCard(m.page, { name: "Card: summer", headline: "E2E summer sale card", category: "Offers", ends: "2099-01-01T00:00" });
    await createCard(m.page, { name: "Card: first", headline: "E2E pinned first card", category: "News", order: 5, ends: "2099-01-01T00:00" });
    await createCard(m.page, { name: "Card: cart only", headline: "E2E cart-only card", cartOnly: true, ends: "2099-01-01T00:00" });
    await createCard(m.page, { name: "Card: expired", headline: "E2E expired card", ends: "2020-01-01T00:00" });

    await m.page.goto("/app/tools/feed");
    await expect(m.page.getByRole("link", { name: "Card: summer" })).toBeVisible();
    await expect(m.page.getByRole("link", { name: "Card: first" })).toBeVisible();
  });

  test("a shopper sees an unread count for eligible cards only, and opening shows them in the merchant's order", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await expect(bellOf(page)).toBeVisible({ timeout: 15_000 });
    // 2 eligible: summer + pinned. Cart-only is for the cart page, expired is past its end date.
    await expect(bellOf(page)).toHaveAttribute("aria-label", "Notifications, 2 unread");
    await expect(panelOf(page)).toBeHidden();
    await bellOf(page).click();
    await expect(panelOf(page)).toBeVisible();
    const cards = await panelOf(page).getByRole("listitem").allTextContents();
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("E2E pinned first card"); // order 5 sorts before the default 100
    expect(cards[1]).toContain("E2E summer sale card");
    expect(cards.join("")).not.toContain("cart-only");
    expect(cards.join("")).not.toContain("expired");
    expect(cards[0]).toContain("News");
    expect(cards.every((c) => /New/.test(c))).toBe(true);
    await expect(bellOf(page)).toHaveAttribute("aria-label", "Notifications"); // opening cleared the badge
    await ctx.close();
  });

  test("read state survives a reload with consent, and a different page adds its own unread card", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await bellOf(page).click();
    await expect(bellOf(page)).toHaveAttribute("aria-label", "Notifications");
    await page.reload();
    await expect(bellOf(page)).toBeVisible({ timeout: 15_000 });
    await expect(bellOf(page)).toHaveAttribute("aria-label", "Notifications"); // still read

    await page.goto(`${STORE}/cart?${new URLSearchParams({ site: m.siteKey, consent: "1" })}`);
    await expect(bellOf(page)).toHaveAttribute("aria-label", "Notifications, 1 unread", { timeout: 15_000 }); // the cart-only card
    await bellOf(page).click();
    await expect(panelOf(page).getByRole("listitem")).toHaveCount(3);
    await ctx.close();
  });

  test("keyboard: Escape closes and returns focus to the bell; the panel is accessible (axe)", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await bellOf(page).focus();
    await page.keyboard.press("Enter");
    await expect(panelOf(page)).toBeVisible();
    await expect(bellOf(page)).toHaveAttribute("aria-expanded", "true");

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const ours = results.violations.filter((v) => v.nodes.some((n) => JSON.stringify(n.target).includes("data-convertflow")));
    expect(ours.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(panelOf(page)).toBeHidden();
    await expect(bellOf(page)).toHaveAttribute("aria-expanded", "false");
    await expect(bellOf(page)).toBeFocused();
    await ctx.close();
  });

  test("clicking outside closes the panel, and the page underneath stays usable", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await bellOf(page).click();
    await expect(panelOf(page)).toBeVisible();
    await page.locator("h1").click();
    await expect(panelOf(page)).toBeHidden();
    await page.locator("#buy").focus();
    await expect(page.locator("#buy")).toBeFocused();
    await ctx.close();
  });

  test("on a phone the panel fits inside the viewport", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const page = await ctx.newPage();
    await page.goto(`${STORE}/products/running-shoe?${new URLSearchParams({ site: m.siteKey, consent: "1" })}`);
    await bellOf(page).click();
    const box = (await panelOf(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(780);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await ctx.close();
  });

  test("opening and clicking are counted; a purchase after a feed click is attributed once", async ({ browser }) => {
    const before = await totals(m.page);
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await bellOf(page).click();
    await expect.poll(async () => (await totals(m.page)).impressions, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual(before.impressions + 2);
    await panelOf(page).getByRole("link", { name: "Shop now" }).first().click();
    await page.waitForURL(/\/collections\/all/);
    await expect.poll(async () => (await totals(m.page)).clicks, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual(before.clicks + 1);

    await page.goto(`${STORE}/cart?${new URLSearchParams({ site: m.siteKey, consent: "1" })}`);
    await page.getByRole("button", { name: "Simulate order confirmation" }).click();
    await expect.poll(async () => (await totals(m.page)).attributedOrders, { timeout: 30_000, intervals: [1000] }).toBe(1);
    expect((await totals(m.page)).observedOrders).toBe(1);
    await ctx.close();
  });

  test("without consent the feed works, nothing is sent, and nothing outlives the tab session", async ({ browser }) => {
    const before = await totals(m.page);
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await expect(bellOf(page)).toHaveAttribute("aria-label", "Notifications, 2 unread", { timeout: 15_000 });
    await bellOf(page).click();
    await expect(panelOf(page)).toBeVisible();
    expect(await page.evaluate(() => ({ local: localStorage.getItem("cf:feed:v1"), cf: localStorage.getItem("cf:v1"), session: sessionStorage.getItem("cf:feed:v1") }))).toMatchObject({ local: null, cf: null });
    await page.waitForTimeout(3000);
    expect((await totals(m.page)).impressions).toBe(before.impressions);
    await ctx.close();
  });

  test("pausing every card removes the bell for new visitors", async ({ browser }) => {
    await m.page.goto("/app/campaigns");
    // Wait for the list itself: counting buttons while it is still loading would pass vacuously.
    await expect(m.page.getByRole("row", { name: /Card: summer/ })).toBeVisible();
    await expect(m.page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(4);
    for (let left = 4; left > 0; left--) {
      await m.page.getByRole("button", { name: "Pause", exact: true }).first().click();
      await expect(m.page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(left - 1);
    }
    await expect(m.page.locator("span", { hasText: /^paused$/ })).toHaveCount(4);
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1" });
    await page.waitForTimeout(3000);
    await expect(feedOf(page)).toHaveCount(0);
    await ctx.close();
  });
});
