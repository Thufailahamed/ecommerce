import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { API, PROVIDERS } from "./playwright.config";
import { launch, newMerchant, openTab, shopper, type Merchant } from "./support";

/**
 * SMS signup against the real Worker and a real browser. Twilio Verify is played by mock-providers.mjs, which keeps the
 * last code texted to each number (GET /__sms) the way the shopper's phone would. Nothing here texts a real phone.
 */
let m: Merchant;
const HEADLINE = "E2E texts from us";
const PHONE = "+14155550123";
const formOf = (p: Page) => p.locator("[data-convertflow]").getByRole("dialog", { name: HEADLINE });
const texted = async (phone: string) => (await (await fetch(`${PROVIDERS}/__sms?phone=${encodeURIComponent(phone)}`)).json()) as { code: string | null; sent: number };

async function enterNumber(page: Page, national: string, tick = true) {
  const f = formOf(page);
  await f.getByLabel("Mobile number").fill(national);
  if (tick) await f.getByRole("checkbox").check();
  await f.getByRole("button", { name: "Text me" }).click();
}

test.describe.serial("SMS signup, end to end", () => {
  test.beforeAll(async ({ browser }) => { m = await newMerchant(browser, { plan: "growth" }); });

  test("merchant builds an SMS form; consent wording without an opt-out instruction cannot be launched", async () => {
    await m.page.goto("/app/tools/sms");
    await expect(m.page.getByRole("heading", { name: "SMS signup", level: 1 })).toBeVisible();
    await m.page.getByRole("link", { name: /Create your first campaign/ }).click();
    await expect(m.page).toHaveURL(/\/app\/campaigns\/new\?tool=sms/);
    await expect(m.page.getByRole("heading", { name: "SMS signup" })).toBeVisible();
    await m.page.getByLabel("Campaign name").fill("E2E SMS form");
    await m.page.getByLabel("Headline").fill(HEADLINE);
    await openTab(m.page, "Display");
    await m.page.getByLabel("Trigger").selectOption("immediate");
    await openTab(m.page, "Content");

    const consent = m.page.getByLabel("Consent text");
    await expect(consent).toHaveValue(/Reply STOP to opt out/);
    const original = await consent.inputValue();
    await consent.fill("I agree to receive marketing texts from this shop, thanks very much.");
    await expect(m.page.getByRole("button", { name: "Launch" })).toBeDisabled();
    await consent.fill(original);
    const preview = m.page.getByLabel("Campaign preview");
    await expect(preview.getByRole("checkbox")).not.toBeChecked();
    await expect(preview.getByLabel("Mobile number")).toBeVisible();

    await launch(m.page);
    await expect(m.page).toHaveURL(/\/app\/campaigns\/cmp_/);
    await expect(m.page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("a shopper is subscribed only after typing back the code texted to their number", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await expect(formOf(page)).toBeVisible({ timeout: 15_000 });
    await enterNumber(page, "(415) 555-0123", false);
    await expect(formOf(page).getByText(/Tick the box/)).toBeVisible();
    expect((await texted(PHONE)).sent).toBe(0);

    await enterNumber(page, "(415) 555-0123");
    await expect(formOf(page).getByText(/We texted a code to \+1 •••• 0123/)).toBeVisible();
    const { code, sent } = await texted(PHONE);
    expect(sent).toBe(1);

    await formOf(page).getByLabel("Verification code").fill("000000");
    await formOf(page).getByRole("button", { name: "Confirm" }).click();
    await expect(formOf(page).getByText("That code is not right or has expired.")).toBeVisible();
    await formOf(page).getByLabel("Verification code").fill(code!);
    await formOf(page).getByRole("button", { name: "Confirm" }).click();
    await expect(formOf(page).getByText("Thanks. You're signed up for texts.")).toBeVisible();

    const axe = await new AxeBuilder({ page }).include("[data-convertflow]").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await ctx.close();
  });

  test("a number Twilio will not text is explained, so the shopper can correct it", async ({ browser }) => {
    const { ctx, page } = await shopper(browser, "/", m.siteKey, { consent: "0" });
    await expect(formOf(page)).toBeVisible({ timeout: 15_000 });
    await enterNumber(page, "415 555 0000");
    await expect(formOf(page).getByText(/We can't text that number/)).toBeVisible();
    await ctx.close();
  });

  test("the merchant sees the verified number, exports it, and records an opt-out that keeps it from being texted again", async ({ browser }) => {
    await m.page.goto("/app/subscribers");
    await m.page.getByRole("button", { name: "SMS", exact: true }).click();
    const row = m.page.getByRole("row", { name: /\+14155550123/ });
    await expect(row).toContainText("Subscribed");
    const [dl] = await Promise.all([m.page.waitForEvent("download"), m.page.getByRole("button", { name: /Export SMS subscribers/ }).click()]);
    expect(dl.suggestedFilename()).toBe("sms-subscribers.csv");
    const csv = readFileSync((await dl.path())!, "utf8");
    expect(csv.split("\r\n")[0]).toBe("phone,first_name,subscribed_at,source");
    expect(csv).toContain(`${PHONE},`);

    await row.getByRole("button", { name: /Record opt-out/ }).click();
    await row.getByRole("button", { name: "Confirm opt-out" }).click();
    await expect(row).toContainText("Unsubscribed");

    const before = (await texted(PHONE)).sent;
    const { ctx, page } = await shopper(browser, "/cart", m.siteKey, { consent: "0" });
    await expect(formOf(page)).toBeVisible({ timeout: 15_000 });
    await enterNumber(page, "415 555 0123");
    await expect(formOf(page).getByText(/We texted a code/)).toBeVisible(); // the same answer as for anyone: nothing is revealed
    expect((await texted(PHONE)).sent).toBe(before); // but nothing was texted to the opted-out number
    await ctx.close();

    const contacts = await m.page.request.get(`${API}/api/v1/stores/${m.storeId}/contacts?channel=sms`);
    const rows = (await contacts.json() as { data: { phone: string; smsStatus: string }[] }).data;
    expect(rows.find((r) => r.phone === PHONE)?.smsStatus).toBe("unsubscribed");
  });
});
