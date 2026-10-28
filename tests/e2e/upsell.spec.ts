import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { API, STORE } from "./playwright.config";
import { alertOf, apiPost, launch, newMerchant, shopper, type Merchant } from "./support";

let m: Merchant;

async function totals(page: Page) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await page.request.get(`${API}/api/v1/stores/${m.storeId}/analytics?from=${day}&to=${day}`);
  return (await r.json() as { data: { totals: Record<string, number> } }).data.totals;
}

interface P { externalId: string; title: string; handle: string; status?: string; collectionIds: string[]; variants: { externalId: string; price: number; available: boolean }[] }
const prod = (externalId: string, title: string, o: Partial<P> & { price?: number; available?: boolean } = {}): P => ({
  externalId, title, handle: externalId, collectionIds: o.collectionIds ?? ["run"], variants: o.variants ?? [{ externalId: `${externalId}-v`, price: o.price ?? 20, available: o.available ?? true }], ...(o.status ? { status: o.status } : {}),
});
const CATALOG: P[] = [
  prod("shoe", "Running shoe", { price: 80 }),
  prod("socks", "Trail socks", { price: 12 }),
  prod("band", "Fleece band", { price: 9.5 }),
  prod("multi", "Pack of three", { variants: [{ externalId: "multi-a", price: 30, available: true }, { externalId: "multi-b", price: 35, available: true }] }),
  prod("gone", "Sold out gloves", { available: false }),
  prod("draft", "Draft hat", { status: "draft" }),
  prod("elsewhere", "Different collection", { collectionIds: ["trail"] }),
];
const importProducts = (products: P[]) => apiPost(m.page, `/api/v1/stores/${m.storeId}/products/import`, { products });

/** Approves and publishes whatever is in the editor now, and waits until the server has accepted it. */
async function approveAndPublish(page: Page, button: "Publish" | "Publish changes" = "Publish") {
  await launch(page, button);
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 }); // the review drawer closes only once the publish succeeded
  await expect(page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(alertOf(page)).toHaveCount(0);
}

const blockOf = (p: Page) => p.locator("[data-convertflow][data-tool=upsell]");
const cardsOf = (p: Page) => blockOf(p).getByRole("listitem");
/** The block's visible text. (innerText on the shadow host is always empty, so asserting on it would pass vacuously.) */
const textOf = (p: Page) => blockOf(p).first().evaluate((el) => el.shadowRoot?.textContent ?? "");
const productPage = (browser: Parameters<typeof shopper>[0], q: Record<string, string> = {}) =>
  shopper(browser, "/products/running-shoe", m.siteKey, { consent: "1", ctx: JSON.stringify({ productId: "shoe" }), ...q });
const addedOf = (p: Page) => p.evaluate(() => (window as unknown as { __added?: string[] }).__added ?? []);
const callsOf = (p: Page) => p.evaluate(() => (window as unknown as { __calls?: number }).__calls ?? 0);

test.describe.serial("upsell tool, end to end", () => {
  test.beforeAll(async ({ browser }) => {
    m = await newMerchant(browser, { plan: "growth" });
    expect((await importProducts(CATALOG)).status()).toBe(200);
  });

  test("upsell is a shipped tool with its own page, the usual setup list and the product links section", async () => {
    await m.page.goto("/app/tools/upsell");
    await expect(m.page.getByRole("heading", { name: "Upsells", level: 1 })).toBeVisible();
    await expect(m.page.getByText("Not available yet")).toHaveCount(0);
    await expect(m.page.getByRole("link", { name: /Create your first campaign/ })).toBeVisible();
    await expect(m.page.getByRole("heading", { name: "Product links" })).toBeVisible();
    await expect(m.page.getByText(/ConvertFlow\.addToCart/)).toBeVisible(); // the custom-store setup step
    await expect(m.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Upsells/ })).not.toContainText("Soon");
  });

  test("merchant links two products from the dashboard, sees the link, and removes it", async () => {
    await m.page.goto("/app/tools/upsell");
    await m.page.getByLabel("Product", { exact: true }).selectOption("shoe");
    await m.page.getByLabel("Other product").selectOption("socks");
    await m.page.getByLabel("Weight").fill("5");
    await m.page.getByRole("button", { name: "Add link" }).click();
    const table = m.page.getByRole("table", { name: "Product links" });
    await expect(table.getByRole("row", { name: /Running shoe.*Goes well with.*Trail socks.*5/ })).toBeVisible();
    await table.getByRole("button", { name: /Remove link from Running shoe to Trail socks/ }).click();
    await expect(table).toHaveCount(0);
    await expect(alertOf(m.page)).toHaveCount(0);
  });

  test("merchant builds a recommendation block with a live preview of the real renderer, approves and publishes it", async () => {
    await m.page.goto("/app/tools/upsell");
    await m.page.getByRole("link", { name: /Create your first campaign/ }).click();
    await expect(m.page).toHaveURL(/\/app\/campaigns\/new\?tool=upsell/);
    await expect(m.page.getByLabel("Format")).toHaveCount(0);
    await expect(m.page.getByLabel("Trigger")).toHaveCount(0); // an inline block has no trigger
    await m.page.getByLabel("Campaign name").fill("E2E recommendations");
    await m.page.getByLabel("Headline").fill("E2E you may also like");
    const preview = m.page.getByLabel("Campaign preview");
    await expect(preview.getByRole("heading", { name: "E2E you may also like" })).toBeVisible();
    await expect(preview.getByText("Sample product one")).toBeVisible();
    await expect(m.page.getByText(/Preview uses sample products/)).toBeVisible(); // labelled, never passed off as real
    await m.page.getByLabel("Layout").selectOption("grid");
    await m.page.getByLabel("How many (1–6)").fill("2");
    await expect(preview.getByRole("listitem")).toHaveCount(2);

    await approveAndPublish(m.page);
    await expect(m.page).toHaveURL(/\/app\/campaigns\/cmp_/);
    await m.page.goto("/app/tools/upsell");
    await expect(m.page.getByRole("link", { name: "E2E recommendations" })).toBeVisible();
  });

  test("a shopper on a product page sees in-stock products from the same collection, in order, never the viewed, sold-out, draft or other-collection ones", async ({ browser }) => {
    const { ctx, page } = await productPage(browser, { adder: "ok" });
    await expect(blockOf(page)).toBeVisible({ timeout: 20_000 });
    await expect(blockOf(page).getByRole("heading", { name: "E2E you may also like" })).toBeVisible();
    // The editor preview was set to 2 products and a grid, so the published block honours both.
    await expect(cardsOf(page)).toHaveCount(2);
    expect(await cardsOf(page).locator("a").evaluateAll((as) => as.map((a) => a.textContent))).toEqual(expect.arrayContaining(["Fleece band"]));
    const text = await textOf(page);
    expect(text).toContain("Fleece band"); // the helper really reads the block, so the checks below are meaningful
    for (const never of ["Running shoe", "Sold out gloves", "Draft hat", "Different collection"]) expect(text).not.toContain(never);
    // It sits where the merchant marked the spot.
    await expect(page.locator("[data-convertflow-recommendations] [data-tool=upsell]")).toHaveCount(1);
    await ctx.close();
  });

  test("raising the count shows all three eligible products, with prices, and products with options link to their page", async ({ browser }) => {
    await m.page.goto("/app/campaigns");
    await m.page.getByRole("link", { name: "E2E recommendations" }).click();
    await m.page.getByLabel("How many (1–6)").fill("3");
    await approveAndPublish(m.page, "Publish changes");

    const { ctx, page } = await productPage(browser, { adder: "ok" });
    await expect(cardsOf(page)).toHaveCount(3, { timeout: 20_000 });
    expect(await cardsOf(page).locator("a").evaluateAll((as) => as.map((a) => a.textContent).filter((t) => t && t !== "View"))).toEqual(["Fleece band", "Pack of three", "Trail socks"]); // by title
    await expect(cardsOf(page).filter({ hasText: "Fleece band" })).toContainText("9.50");
    await expect(cardsOf(page).filter({ hasText: "Trail socks" })).toContainText("12.00");
    await expect(cardsOf(page).filter({ hasText: "Pack of three" })).toContainText("30.00"); // the lowest in-stock option
    await expect(cardsOf(page).filter({ hasText: "Pack of three" }).getByRole("button")).toHaveCount(0); // several options: the shopper chooses on its page
    await expect(cardsOf(page).filter({ hasText: "Pack of three" }).getByRole("link", { name: "View Pack of three" })).toBeVisible();
    await expect(blockOf(page).getByRole("button", { name: /^Add to cart/ })).toHaveCount(2);
    await ctx.close();
  });

  test("add to cart goes through the store's own function, shows Added, and a keyboard user keeps their focus", async ({ browser }) => {
    const { ctx, page } = await productPage(browser, { adder: "ok" });
    const btn = blockOf(page).getByRole("button", { name: "Add to cart: Trail socks" });
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(blockOf(page).getByRole("button", { name: "Added: Trail socks" })).toBeVisible();
    await expect(blockOf(page).getByRole("status")).toContainText("Trail socks was added to your cart.");
    expect(await addedOf(page)).toEqual(["socks"]);
    await expect(blockOf(page).getByRole("button", { name: "Added: Trail socks" })).toBeFocused(); // not thrown back to the top of the page
    await blockOf(page).getByRole("button", { name: "Added: Trail socks" }).click({ force: true }); // aria-disabled: Playwright would wait forever for it to be "enabled"
    expect(await callsOf(page)).toBe(1); // already added
    await ctx.close();
  });

  test("a double click while the store is still adding adds once", async ({ browser }) => {
    const { ctx, page } = await productPage(browser, { adder: "slow" });
    const btn = blockOf(page).getByRole("button", { name: "Add to cart: Fleece band" });
    await btn.dblclick();
    await expect(btn).toHaveAttribute("aria-busy", "true");
    await expect(blockOf(page).getByRole("button", { name: "Added: Fleece band" })).toBeVisible({ timeout: 10_000 });
    expect(await callsOf(page)).toBe(1);
    expect(await addedOf(page)).toEqual(["band"]);
    await ctx.close();
  });

  test("when the store refuses, the shopper is told and can try again", async ({ browser }) => {
    const { ctx, page } = await productPage(browser, { adder: "flaky" });
    const btn = blockOf(page).getByRole("button", { name: "Add to cart: Trail socks" });
    await btn.click();
    await expect(blockOf(page).getByRole("status")).toContainText("Couldn't add Trail socks");
    await expect(btn).toHaveText("Add to cart");
    await btn.click();
    await expect(blockOf(page).getByRole("button", { name: "Added: Trail socks" })).toBeVisible();
    expect(await callsOf(page)).toBe(2);
    await ctx.close();
  });

  test("with no way to add to the cart on this site, products link to their page instead of pretending", async ({ browser }) => {
    const { ctx, page } = await productPage(browser);
    await expect(cardsOf(page)).toHaveCount(3, { timeout: 20_000 });
    await expect(blockOf(page).getByRole("button")).toHaveCount(0);
    await expect(blockOf(page).getByRole("link", { name: "View Trail socks" })).toHaveAttribute("href", "/products/socks");
    await ctx.close();
  });

  test("a product-page block does not appear on other pages", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/cart", m.siteKey, { consent: "1", ctx: JSON.stringify({ productId: "shoe" }) });
    await page.waitForTimeout(3000);
    await expect(blockOf(page)).toHaveCount(0);
    await ctx.close();
  });

  test("impressions, product clicks and add-to-carts are counted, and a purchase afterwards is attributed to the block", async ({ browser }) => {
    const before = await totals(m.page);
    const { ctx, page } = await productPage(browser, { adder: "ok" });
    await expect(cardsOf(page)).toHaveCount(3, { timeout: 20_000 });
    await blockOf(page).getByRole("button", { name: "Add to cart: Trail socks" }).click();
    await expect(blockOf(page).getByRole("button", { name: "Added: Trail socks" })).toBeVisible();
    await expect.poll(async () => (await totals(m.page)).impressions, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual(before.impressions + 1);
    await expect.poll(async () => (await totals(m.page)).addToCarts, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual((before.addToCarts ?? 0) + 1);

    await page.getByRole("button", { name: "Simulate order confirmation" }).click(); // a purchase right after adding from the block
    await expect.poll(async () => (await totals(m.page)).attributedOrders, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual(before.attributedOrders + 1);

    await blockOf(page).getByRole("link", { name: "Fleece band" }).click();
    await page.waitForURL(/\/products\/band/);
    await expect.poll(async () => (await totals(m.page)).clicks, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual(before.clicks + 1);
    await ctx.close();
  });

  test("without consent the block still works, nothing is sent and nothing is stored", async ({ browser }) => {
    const before = await totals(m.page);
    const { ctx, page } = await productPage(browser, { adder: "ok", consent: "0" });
    await expect(cardsOf(page)).toHaveCount(3, { timeout: 20_000 });
    await blockOf(page).getByRole("button", { name: "Add to cart: Trail socks" }).click();
    await expect(blockOf(page).getByRole("button", { name: "Added: Trail socks" })).toBeVisible(); // adding is the shopper's own action, not tracking
    expect(await page.evaluate(() => ({ local: localStorage.getItem("cf:v1"), cookie: document.cookie }))).toEqual({ local: null, cookie: "" });
    await page.waitForTimeout(3000);
    const after = await totals(m.page);
    expect(after.impressions).toBe(before.impressions);
    expect(after.addToCarts ?? 0).toBe(before.addToCarts ?? 0);
    await ctx.close();
  });

  test("on a phone the block fits the screen, the page does not scroll sideways, and it is accessible (axe)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const page = await ctx.newPage();
    await page.goto(`${STORE}/products/running-shoe?${new URLSearchParams({ site: m.siteKey, consent: "1", ctx: JSON.stringify({ productId: "shoe" }), adder: "ok" })}`);
    await expect(cardsOf(page)).toHaveCount(3, { timeout: 20_000 });
    const box = (await blockOf(page).locator("section").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const ours = results.violations.filter((v) => v.nodes.some((n) => JSON.stringify(n.target).includes("data-convertflow")));
    expect(ours.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await ctx.close();
  });

  test("a product that sells out disappears from the block straight away, and returns when it is back in stock", async ({ browser }) => {
    expect((await importProducts([prod("socks", "Trail socks", { price: 12, available: false })])).status()).toBe(200);
    const a = await productPage(browser, { adder: "ok" });
    await expect(cardsOf(a.page)).toHaveCount(2, { timeout: 20_000 });
    const sold = await textOf(a.page);
    expect(sold).toContain("Fleece band");
    expect(sold).not.toContain("Trail socks");
    await a.ctx.close();

    expect((await importProducts([prod("socks", "Trail socks", { price: 12 })])).status()).toBe(200);
    const b = await productPage(browser, { adder: "ok" });
    await expect(cardsOf(b.page)).toHaveCount(3, { timeout: 20_000 });
    expect(await textOf(b.page)).toContain("Trail socks");
    await b.ctx.close();
  });

  test("a toast-placed recommendation floats in a corner, adds to cart, and can be dismissed", async ({ browser }) => {
    const cfg = {
      schemaVersion: 1, name: "E2E recommendation toast", tool: "upsell", format: "recommendation", goal: { type: "add_to_cart" },
      creative: { headline: "E2E toast picks", body: "", ctaLabel: "Add to cart", ctaUrl: "/" }, style: {}, trigger: { type: "immediate" },
      targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["home"] }] }, frequency: {},
      recommend: { source: "manual", productIds: ["band", "socks"], placement: "toast", maxProducts: 2, layout: "grid" },
    };
    const created = await (await apiPost(m.page, `/api/v1/stores/${m.storeId}/campaigns`, cfg)).json() as { data: { id: string; updatedAt: string } };
    const pub = await apiPost(m.page, `/api/v1/stores/${m.storeId}/campaigns/${created.data.id}/publish`, { approve: true, approvedUpdatedAt: created.data.updatedAt });
    expect(pub.status()).toBe(200);

    const { ctx, page } = await shopper(browser, "/", m.siteKey, { consent: "1", adder: "ok" });
    await expect(blockOf(page).filter({ hasText: "E2E toast picks" })).toBeVisible({ timeout: 20_000 });
    const floating = blockOf(page).filter({ hasText: "E2E toast picks" });
    expect(await floating.evaluate((el) => (el as HTMLElement).style.position)).toBe("fixed");
    await expect(floating.getByRole("listitem")).toHaveCount(2); // a corner card is always a list
    await floating.getByRole("button", { name: "Add to cart: Fleece band" }).click();
    await expect(floating.getByRole("button", { name: "Added: Fleece band" })).toBeVisible();
    expect(await addedOf(page)).toEqual(["band"]);
    await floating.getByRole("button", { name: "Dismiss recommendations" }).click();
    await expect(floating).toHaveCount(0);
    await ctx.close();
  });

  test("pausing the campaigns removes the blocks for new visitors", async ({ browser }) => {
    await m.page.goto("/app/campaigns");
    await expect(m.page.getByRole("row", { name: /E2E recommendations/ })).toBeVisible();
    await expect(m.page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(2);
    for (let left = 2; left > 0; left--) {
      await m.page.getByRole("button", { name: "Pause", exact: true }).first().click();
      await expect(m.page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(left - 1);
    }
    const a = await productPage(browser, { adder: "ok" });
    await a.page.waitForTimeout(3000);
    await expect(blockOf(a.page)).toHaveCount(0);
    await a.ctx.close();
    const b = await shopper(browser, "/", m.siteKey, { consent: "1", adder: "ok" });
    await b.page.waitForTimeout(3000);
    await expect(blockOf(b.page)).toHaveCount(0);
    await b.ctx.close();
  });
});
