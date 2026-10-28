import { expect, test, type Browser, type Page } from "@playwright/test";
import { API, MAIL, STORE } from "./playwright.config";
import { openTab } from "./support";

const EMAIL = `e2e${Date.now()}@example.com`;
const PASSWORD = "correct-horse-battery";
const HEADLINE = "E2E Hello Runner";
let siteKey = "";

const errors: string[] = [];
const watch = (p: Page) => { p.on("pageerror", (e) => errors.push(e.message)); };

/** A fresh visitor: new browser context, so no cookies, storage or session carry over. */
async function visitor(browser: Browser, path: string, consent: "1" | "0" | null = "1") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page);
  const q = `site=${siteKey}${consent === null ? "" : `&consent=${consent}`}`;
  await page.goto(`${STORE}${path}${path.includes("?") ? "&" : "?"}${q}`);
  return { ctx, page };
}

async function analytics(page: Page) {
  const day = new Date().toISOString().slice(0, 10);
  const stores = await (await page.request.get(`${API}/api/v1/stores`)).json() as { data: { id: string }[] };
  const r = await page.request.get(`${API}/api/v1/stores/${stores.data[0]!.id}/analytics?from=${day}&to=${day}`);
  return (await r.json() as { data: { totals: Record<string, number> } }).data.totals;
}

test.describe.serial("merchant to shopper, end to end", () => {
  let merchant: Page;

  test.beforeAll(async ({ browser }) => {
    merchant = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    watch(merchant);
  });

  test("marketing site renders", async () => {
    await merchant.goto("/");
    await expect(merchant.getByRole("heading", { level: 1 })).toContainText("Say the goal");
    await expect(merchant.getByRole("link", { name: "Create a workspace" })).toBeVisible();
  });

  test("marketing: interactive demo renders each format with the real renderer", async () => {
    await merchant.goto("/");
    const demo = merchant.getByLabel("Interactive campaign demo");
    await expect(demo.getByText("Find your stride")).toBeVisible();
    await demo.getByRole("tab", { name: "Slide-in" }).click();
    await expect(demo.getByText("Still deciding?")).toBeVisible();
    await expect(demo.getByText("Find your stride")).toHaveCount(0);
    await demo.getByRole("tab", { name: "Announcement bar" }).click();
    await expect(demo.getByText("Free shipping on orders over $75")).toBeVisible();
    await demo.getByRole("button", { name: "Mobile preview" }).click();
    await expect(demo.getByRole("button", { name: "Mobile preview" })).toHaveAttribute("aria-pressed", "true");
  });

  test("marketing: pricing shows exactly the limits the API enforces", async () => {
    const plans = (await (await merchant.request.get(`${API}/api/v1/billing/plans`)).json() as { data: { id: string; priceUsdMonthly: number; maxActiveCampaigns: number; aiGenerationsPerMonth: number; trackedPageviewsPerMonth: number }[] }).data;
    await merchant.goto("/#pricing");
    const section = merchant.locator("#pricing");
    for (const p of plans) {
      await expect(section).toContainText(`$${p.priceUsdMonthly}`);
      await expect(section).toContainText(`${p.aiGenerationsPerMonth.toLocaleString("en-US")} AI drafts / month`);
      await expect(section).toContainText(`${p.trackedPageviewsPerMonth.toLocaleString("en-US")} tracked pageviews / month`);
      await expect(section).toContainText(`${p.maxActiveCampaigns} live campaign`);
    }
  });

  test("marketing: FAQ opens and the page has no horizontal overflow on a phone", async ({ browser }) => {
    await merchant.goto("/#faq");
    await merchant.getByText("Does it work outside Shopify?").click();
    await expect(merchant.getByText("One script tag works on Shopify")).toBeVisible();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("link", { name: "Start free" }).first()).toBeVisible();
    await ctx.close();
  });

  test("sign up and connect a store", async () => {
    await merchant.goto("/signup");
    await merchant.getByLabel("Email").fill(EMAIL);
    await merchant.getByLabel("Password").fill(PASSWORD);
    await merchant.getByRole("button", { name: "Create account" }).click();
    await expect(merchant).toHaveURL(/\/app$/);
    await expect(merchant.getByRole("heading", { name: "Connect your store" })).toBeVisible();
    await merchant.getByLabel("Store name").fill("Smoke Shop");
    await merchant.getByLabel("Store domain").fill("shop.example.com");
    await merchant.getByRole("button", { name: "Connect store" }).click();
    await expect(merchant.getByRole("heading", { name: "Smoke Shop" })).toBeVisible();
    await expect(merchant.getByText("Setup checklist")).toBeVisible();
  });

  test("email confirmation: publishing is blocked until the emailed link is used", async () => {
    await merchant.goto("/app");
    await expect(merchant.getByText(/to publish campaigns and use AI drafts/)).toBeVisible();
    const msgs = await (await fetch(`${MAIL}/outbox?to=${EMAIL}`)).json() as { subject: string; text: string }[];
    const verify = msgs.find((m) => /Confirm your email/.test(m.subject));
    expect(verify, "verification email was sent").toBeTruthy();
    const link = verify!.text.match(/https?:\/\/\S+/)![0];
    expect(link).toContain("/verify-email?token=");
    await merchant.goto(link);
    await expect(merchant.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
    await merchant.goto("/app");
    await expect(merchant.getByRole("heading", { name: "Smoke Shop" })).toBeVisible();
    await expect(merchant.getByText(/to publish campaigns and use AI drafts/)).toHaveCount(0);
  });

  test("build a campaign in the editor with a live preview, approve and publish", async () => {
    await merchant.goto("/app/campaigns/new?start=blank");
    await merchant.getByLabel("Campaign name").fill("E2E welcome");
    await merchant.getByLabel("Headline").fill(HEADLINE);
    // preview is driven by the same renderer the storefront uses
    await expect(merchant.getByLabel("Campaign preview").getByText(HEADLINE)).toBeVisible();
    await openTab(merchant, "Display");
    await merchant.getByLabel("Trigger").selectOption("immediate");
    await openTab(merchant, "Targeting");
    await merchant.getByLabel("Add rule").selectOption("page_type");
    await merchant.getByLabel("Page type").selectOption("home");
    await expect(merchant.getByText("Page type is home")).toBeVisible();

    await merchant.getByRole("button", { name: "Launch" }).click();
    const publish = merchant.getByRole("button", { name: "Publish", exact: true });
    await expect(publish).toBeDisabled(); // cannot publish without approval
    await merchant.getByRole("checkbox", { name: /approve it to go live/ }).check();
    await publish.click();
    await expect(merchant).toHaveURL(/\/app\/campaigns\/cmp_/);
    await expect(merchant.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });
    await openTab(merchant, "History");
    await expect(merchant.getByRole("region", { name: "Version history" })).toBeVisible();
  });

  test("rejects a javascript: link before it can be saved", async () => {
    await merchant.goto("/app/campaigns/new?start=blank");
    await merchant.getByLabel("Button link").fill("javascript:alert(1)");
    await expect(merchant.getByRole("button", { name: "Create draft" })).toBeDisabled();
    await expect(merchant.getByText(/ctaUrl/)).toBeVisible();
  });

  test("settings exposes the install snippet", async () => {
    await merchant.goto("/app/settings");
    await expect(merchant.locator("pre").first()).toContainText("data-site");
    const snippet = await merchant.locator("pre").first().innerText();
    const m = snippet.match(/data-site="(cf_[A-Za-z0-9_-]+)"/);
    expect(m, snippet).toBeTruthy();
    siteKey = m![1]!;
  });

  test("storefront: shown on an eligible page, hidden on an ineligible one", async ({ browser }) => {
    const home = await visitor(browser, "/");
    await expect(home.page.getByText(HEADLINE)).toBeVisible({ timeout: 15_000 });
    await home.ctx.close();

    const product = await visitor(browser, "/products/trail-shoe");
    await product.page.waitForTimeout(2500);
    await expect(product.page.getByText(HEADLINE)).toHaveCount(0);
    await product.ctx.close();
  });

  test("storefront: dismissal sticks, and clicking the CTA is tracked", async ({ browser }) => {
    const { ctx, page } = await visitor(browser, "/");
    await expect(page.getByText(HEADLINE)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText(HEADLINE)).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(2500);
    await expect(page.getByText(HEADLINE)).toHaveCount(0); // dismissed: suppressed on reload
    await ctx.close();

    const clicker = await visitor(browser, "/");
    await expect(clicker.page.getByText(HEADLINE)).toBeVisible({ timeout: 15_000 });
    await clicker.page.getByRole("link", { name: "Shop now" }).click();
    await clicker.page.waitForURL(/\/collections\/all/);
    await clicker.ctx.close();
  });

  test("analytics: consented activity is counted once, not-consented is not counted", async ({ browser }) => {
    await expect.poll(async () => (await analytics(merchant)).impressions, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual(3);
    const before = await analytics(merchant);
    expect(before.clicks).toBeGreaterThanOrEqual(1);
    expect(before.dismissals).toBeGreaterThanOrEqual(1);

    const noConsent = await visitor(browser, "/", "0");
    await expect(noConsent.page.getByText(HEADLINE)).toBeVisible({ timeout: 15_000 }); // still shown
    await noConsent.page.waitForTimeout(3000);
    await noConsent.ctx.close();
    const after = await analytics(merchant);
    expect(after.impressions).toBe(before.impressions); // but nothing was recorded

    await merchant.goto("/app/analytics");
    await expect(merchant.getByRole("columnheader", { name: "Impressions" })).toBeVisible();
    await expect(merchant.getByText(/not incremental/i).first()).toBeVisible();
  });

  test("purchase tracking is consented, attributed to the clicked campaign, and de-duplicated", async ({ browser }) => {
    const { ctx, page } = await visitor(browser, "/");
    await expect(page.getByText(HEADLINE)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "Shop now" }).click();
    await page.waitForURL(/\/collections\/all/);
    await page.goto(`${STORE}/cart?site=${siteKey}&consent=1`); // later page, same visitor
    await page.getByRole("button", { name: "Simulate order confirmation" }).click();
    await expect.poll(async () => (await analytics(merchant)).observedOrders, { timeout: 30_000, intervals: [1000] }).toBe(1);
    const t = await analytics(merchant);
    expect(t.attributedOrders).toBe(1);
    expect(t.attributedRevenue).toBeCloseTo(59.9);
    await ctx.close();
  });

  test("pause takes the campaign off the storefront", async ({ browser }) => {
    await merchant.goto("/app/campaigns");
    await merchant.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(merchant.locator("span", { hasText: /^paused$/ })).toBeVisible();
    const v = await visitor(browser, "/");
    await v.page.waitForTimeout(3000);
    await expect(v.page.getByText(HEADLINE)).toHaveCount(0);
    await v.ctx.close();
  });

  test("mobile: app shell has a menu and no horizontal overflow", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    watch(page);
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
    for (const path of ["/app", "/app/campaigns", "/app/settings", "/app/analytics"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
    }
    await ctx.close();
  });

  test("no uncaught page errors anywhere", async () => {
    expect(errors).toEqual([]);
  });
});

test.describe.serial("accessibility and visuals", () => {
  const EMAIL2 = `a11y${Date.now()}@example.com`;

  test("axe finds no serious or critical violations on public and app screens", async ({ browser }) => {
    const AxeBuilder = (await import("@axe-core/playwright")).default;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const check = async (path: string) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.slice(0, 6).map((n) => `${n.target.join(" ")} [${(n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined)?.fgColor}/${(n.any[0]?.data as { bgColor?: string } | undefined)?.bgColor} ${(n.any[0]?.data as { contrastRatio?: number } | undefined)?.contrastRatio}]`).join(" | ")}`), path).toEqual([]);
    };
    for (const p of ["/", "/login", "/signup", "/privacy", "/terms"]) await check(p);

    await page.goto("/signup");
    await page.getByLabel("Email").fill(EMAIL2);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Connect your store" })).toBeVisible();
    await check("/app"); // connect-store form
    await page.getByLabel("Store name").fill("A11y Shop");
    await page.getByLabel("Store domain").fill("a11y.example.com");
    await page.getByRole("button", { name: "Connect store" }).click();
    await expect(page.getByRole("heading", { name: "A11y Shop" })).toBeVisible();
    for (const p of ["/app", "/app/campaigns", "/app/campaigns/new", "/app/studio", "/app/analytics", "/app/settings"]) await check(p);
    await ctx.close();
  });

  test("marketing section shots", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    for (const [name, sel] of [["how", "#how"], ["engine", "#engine"], ["features", "#features"], ["pricing", "#pricing"]] as const) {
      await page.locator(sel).screenshot({ path: `test-results/shots/sec-${name}.png` });
    }
    await page.getByLabel("Interactive campaign demo").screenshot({ path: "test-results/shots/sec-demo.png" });
    await ctx.close();
  });

  test("capture screenshots for design review", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "test-results/shots/marketing.png", fullPage: false });
    await page.screenshot({ path: "test-results/shots/marketing-full.png", fullPage: true });
    await page.goto("/signup");
    await page.screenshot({ path: "test-results/shots/signup.png" });
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "test-results/shots/overview.png" });
    await page.goto("/app/analytics");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "test-results/shots/analytics.png" });
    await page.goto("/app/campaigns");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "E2E welcome" }).click();
    await expect(page.getByLabel("Headline")).toBeVisible();
    await expect(page.getByLabel("Campaign preview").getByText(HEADLINE)).toBeVisible();
    await page.screenshot({ path: "test-results/shots/editor.png" });
    await ctx.close();
  });
});
