import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { API, STORE } from "./playwright.config";
import { alertOf, firstUrl, launch, newMerchant, openTab, outbox, shopper, unique, waitForMail, type Merchant } from "./support";

let m: Merchant;

const CONSENT = "I agree to receive the E2E newsletter from Shop. I can unsubscribe at any time.";
const HEADLINE = "E2E join the list";
const formOf = (p: Page) => p.locator("[data-convertflow]").getByRole("dialog", { name: HEADLINE });
const rowOf = (p: Page, email: string) => p.getByRole("row", { name: new RegExp(email.replace(/[.+]/g, "\\$&")) });

/** Fills and submits the storefront form. `tick: false` leaves the consent box alone. */
async function signUp(page: Page, email: string, tick = true) {
  const f = formOf(page);
  await f.getByLabel("Email address").fill(email);
  if (tick) await f.getByRole("checkbox").check();
  await f.getByRole("button", { name: "Sign up" }).click();
}

test.describe.serial("email signup, end to end", () => {
  test.beforeAll(async ({ browser }) => { m = await newMerchant(browser, { plan: "growth" }); });

  test("email signup is a shipped tool with its own page and an honest description", async () => {
    await m.page.goto("/app/tools/email");
    await expect(m.page.getByRole("heading", { name: "Email signup", level: 1 })).toBeVisible();
    await expect(m.page.getByText("Not available yet", { exact: true })).toHaveCount(0);
    await expect(m.page.getByText(/does not send marketing email itself/).first()).toBeVisible(); // never implies sending exists
    await expect(m.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Email signup/ })).not.toContainText("Soon");
    await expect(m.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Subscribers" })).toBeVisible();
  });

  test("merchant builds the form with a live preview, is warned about weak consent wording, then approves and publishes", async () => {
    await m.page.goto("/app/tools/email");
    await m.page.getByRole("link", { name: /Create your first campaign/ }).click();
    await expect(m.page).toHaveURL(/\/app\/campaigns\/new\?tool=email/);
    await expect(m.page.getByLabel("Button link")).toHaveCount(0); // a form has no destination
    await expect(m.page.getByText("Discount code (optional)")).toHaveCount(0); // not allowed until it can be revealed after confirmation

    await m.page.getByLabel("Campaign name").fill("E2E email form");
    await m.page.getByLabel("Headline").fill(HEADLINE);
    await openTab(m.page, "Display");
    await m.page.getByLabel("Trigger").selectOption("immediate");
    await openTab(m.page, "Content");

    await m.page.getByLabel("Consent text").fill("I agree to get the E2E newsletter from this shop, thanks very much.");
    await expect(m.page.getByText("does not mention that shoppers can unsubscribe")).toBeVisible();
    await m.page.getByLabel("Consent text").fill(CONSENT);
    await expect(m.page.getByText("does not mention that shoppers can unsubscribe")).toHaveCount(0);

    const preview = m.page.getByLabel("Campaign preview");
    await expect(preview.getByRole("checkbox")).not.toBeChecked(); // the real renderer, never pre-ticked
    await expect(preview.getByText(CONSENT)).toBeVisible();

    await launch(m.page);
    await expect(m.page).toHaveURL(/\/app\/campaigns\/cmp_/);
    await expect(m.page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(alertOf(m.page)).toHaveCount(0);
  });

  const shopperEmail = unique("subscriber");
  let shopperCtx: Awaited<ReturnType<typeof shopper>>;

  test("a shopper must tick the box, then gets a confirmation email carrying the exact consent words and an unsubscribe link", async ({ browser }) => {
    shopperCtx = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    const { page } = shopperCtx;
    await expect(formOf(page)).toBeVisible({ timeout: 15_000 });
    await expect(formOf(page).getByRole("checkbox")).not.toBeChecked();

    await signUp(page, shopperEmail, false);
    await expect(formOf(page).getByText(/Tick the box/)).toBeVisible();
    expect(await outbox(shopperEmail)).toHaveLength(0); // nothing was sent

    await formOf(page).getByRole("checkbox").check();
    await formOf(page).getByRole("button", { name: "Sign up" }).click();
    await expect(formOf(page).getByText("Check your inbox to confirm your subscription.")).toBeVisible();

    const mail = await waitForMail(shopperEmail, /Confirm your subscription/);
    expect(mail.text).toContain(CONSENT);
    expect(mail.headers["List-Unsubscribe-Post"] ?? mail.headers["list-unsubscribe-post"]).toBe("List-Unsubscribe=One-Click");
  });

  test("until they confirm, the merchant sees them as waiting and they are not in the export", async () => {
    await m.page.goto("/app/subscribers");
    await expect(m.page.getByRole("heading", { name: "Subscribers", level: 1 })).toBeVisible();
    await expect(rowOf(m.page, shopperEmail)).toContainText("Waiting to confirm");
    await expect(rowOf(m.page, shopperEmail)).toContainText("Signup form");

    const [dl] = await Promise.all([m.page.waitForEvent("download"), m.page.getByRole("button", { name: /Export subscribed/ }).click()]);
    expect(dl.suggestedFilename()).toBe("subscribers.csv");
    expect(readFileSync((await dl.path())!, "utf8")).not.toContain(shopperEmail);
  });

  test("the form is not offered again after signing up, even on a reload", async () => {
    await shopperCtx.page.reload();
    await shopperCtx.page.waitForTimeout(2500); // long enough for an immediate popup to have appeared
    await expect(formOf(shopperCtx.page)).toHaveCount(0);
  });

  test("confirming from the inbox makes them subscribed, once; the merchant can see their consent proof and export them", async ({ browser }) => {
    const link = firstUrl(await waitForMail(shopperEmail, /Confirm your subscription/));
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "You're subscribed" })).toBeVisible();
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Link not valid" })).toBeVisible(); // single use
    await ctx.close();

    await m.page.goto("/app/subscribers");
    await expect(rowOf(m.page, shopperEmail)).toContainText("Subscribed");
    const [dl] = await Promise.all([m.page.waitForEvent("download"), m.page.getByRole("button", { name: /Export subscribed/ }).click()]);
    expect(readFileSync((await dl.path())!, "utf8")).toContain(shopperEmail);

    // the proof of consent is the words the shopper saw, kept with the signup
    const list = await (await m.page.request.get(`${API}/api/v1/stores/${m.storeId}/contacts?email=${encodeURIComponent(shopperEmail)}`)).json() as { data: { id: string }[] };
    const detail = await (await m.page.request.get(`${API}/api/v1/stores/${m.storeId}/contacts/${list.data[0]!.id}`)).json() as { data: { consentEvents: { event: string; consentText: string | null }[] } };
    expect(detail.data.consentEvents.map((e) => e.event)).toEqual(["requested", "confirmed"]);
    expect(detail.data.consentEvents[0]!.consentText).toBe(CONSENT);
  });

  test("the form is accessible (axe) and fits a phone", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await expect(formOf(page)).toBeVisible({ timeout: 15_000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const ours = results.violations.filter((v) => v.nodes.some((n) => JSON.stringify(n.target).includes("data-convertflow")));
    expect(ours.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await ctx.close();

    const phone = await browser.newContext({ viewport: { width: 390, height: 700 } });
    const p = await phone.newPage();
    await p.goto(`${STORE}/products/running-shoe?${new URLSearchParams({ site: m.siteKey, consent: "0" })}`);
    await expect(formOf(p)).toBeVisible({ timeout: 15_000 });
    const box = (await formOf(p).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await phone.close();
  });

  test("unsubscribing from the email works with one click, shows as opted out, and erasing removes them", async ({ browser }) => {
    const mail = await waitForMail(shopperEmail, /Confirm your subscription/);
    const unsubscribe = (mail.headers["List-Unsubscribe"] ?? mail.headers["list-unsubscribe"])!.replace(/[<>]/g, "");
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(unsubscribe);
    await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
    await ctx.close();

    await m.page.goto("/app/subscribers");
    await expect(rowOf(m.page, shopperEmail)).toContainText("Unsubscribed");
    const [dl] = await Promise.all([m.page.waitForEvent("download"), m.page.getByRole("button", { name: /Export subscribed/ }).click()]);
    expect(readFileSync((await dl.path())!, "utf8")).not.toContain(shopperEmail); // opted out: never exported

    await m.page.getByRole("button", { name: `Erase ${shopperEmail}` }).click();
    await m.page.getByRole("button", { name: "Erase for good" }).click();
    await expect(rowOf(m.page, shopperEmail)).toHaveCount(0);
    await expect(m.page.getByText(/Their consent history was deleted/)).toBeVisible();

    // erased but previously opted out: the hashed suppression keeps them from being re-added
    const { ctx: again, page: p2 } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await expect(formOf(p2)).toBeVisible({ timeout: 15_000 });
    const before = (await outbox(shopperEmail)).length;
    await signUp(p2, shopperEmail);
    await expect(formOf(p2).getByText("Check your inbox to confirm your subscription.")).toBeVisible(); // the shopper is never told
    await p2.waitForTimeout(2000);
    expect((await outbox(shopperEmail)).length).toBe(before);
    await again.close();
  });
});
