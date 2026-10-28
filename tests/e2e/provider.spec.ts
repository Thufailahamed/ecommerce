import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { API, PROVIDERS, WEB } from "./playwright.config";
import { alertOf, firstUrl, launch, newMerchant, openTab, shopper, unique, waitForMail, type Merchant } from "./support";

/**
 * Email list sync, end to end: real Worker + queue + D1, the real SDK in a real browser, a mock standing in for Klaviyo and
 * Mailchimp (mock-providers.mjs). It proves our side (what is sent, when, and never before confirmation or after an opt-out).
 * It does NOT prove either real service accepts those requests: that has never been run (no accounts).
 */
let m: Merchant;

const HEADLINE = "E2E inline signup";
const CONSENT = "I agree to receive the E2E newsletter from Shop. I can unsubscribe at any time.";
const CODE = "WELCOME15";
const KLAVIYO_KEY = "pk_e2e_good";
const MAILCHIMP_KEY = "e2e000-us21";

type Call = { provider: string; method: string; path: string; body?: any; authorised: boolean };
const calls = async (provider: string): Promise<Call[]> => (await fetch(`${PROVIDERS}/__calls?provider=${provider}`)).json() as Promise<Call[]>;
const subscribeCalls = async (provider: string) => (await calls(provider)).filter((c) => (provider === "klaviyo" ? c.path.endsWith("bulk-create-jobs/") : c.method === "PUT"));
const removeCalls = async (provider: string) => (await calls(provider)).filter((c) => (provider === "klaviyo" ? c.path.endsWith("bulk-delete-jobs/") : c.method === "PATCH"));
const md5 = (s: string) => createHash("md5").update(s.toLowerCase()).digest("hex");
const card = (p: Page, name: string) => p.getByRole("article", { name: `${name} connection` });
const rowOf = (p: Page, email: string) => p.getByRole("row", { name: new RegExp(email.replace(/[.+]/g, "\\$&")) });
const form = (p: Page) => p.locator("main [data-convertflow]");

async function signUp(page: Page, email: string, name?: string) {
  await expect(form(page).getByText(HEADLINE)).toBeVisible({ timeout: 15_000 });
  await form(page).getByLabel("Email address").fill(email);
  if (name !== undefined) await form(page).getByLabel("First name (optional)").fill(name);
  await form(page).getByRole("checkbox").check();
  await form(page).getByRole("button", { name: "Sign up" }).click();
  await expect(form(page).getByText("Check your inbox to confirm your subscription.")).toBeVisible();
}
async function confirm(browser: import("@playwright/test").Browser, email: string) {
  const link = firstUrl(await waitForMail(email, /Confirm your subscription/));
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "You're subscribed" })).toBeVisible();
  return { page, ctx };
}

test.describe.serial("email list sync, end to end", () => {
  test.beforeAll(async ({ browser }) => {
    await fetch(`${PROVIDERS}/__calls`, { method: "DELETE" });
    m = await newMerchant(browser, { plan: "growth" });
    const r = await m.page.request.patch(`${API}/api/v1/stores/${m.storeId}/settings`, { data: { maxDiscountPercent: 20 }, headers: { origin: WEB } });
    expect(r.status()).toBe(204);
  });

  test("the merchant connects Klaviyo and Mailchimp; a wrong key is refused in words, and the connection says it is not verified against the live provider", async () => {
    await m.page.goto("/app/subscribers");
    await expect(m.page.getByRole("heading", { name: "Subscribers", level: 1 })).toBeVisible();
    const k = card(m.page, "Klaviyo");

    await k.getByLabel("Klaviyo API key").fill("pk_wrong_key_value");
    await k.getByRole("button", { name: "Connect" }).click();
    await expect(alertOf(m.page).first()).toContainText("The provider rejected this key");
    await expect(k.getByText("Connected", { exact: true })).toHaveCount(0);

    await k.getByLabel("Klaviyo API key").fill(KLAVIYO_KEY);
    await k.getByRole("button", { name: "Connect" }).click();
    await expect(k.getByLabel("Klaviyo list")).toBeVisible();
    await expect(k.getByText("Connected", { exact: true })).toBeVisible();
    await expect(k.getByText(/Not verified against the live provider/)).toBeVisible(); // the API points at a mock, so it can never be "verified"
    await expect(m.page.locator("body")).not.toContainText(KLAVIYO_KEY); // the key is never shown again
    await k.getByLabel("Klaviyo list").selectOption({ label: "E2E Newsletter" });
    await k.getByRole("button", { name: "Use this list" }).click();
    await expect(k.getByText("E2E Newsletter", { exact: true })).toBeVisible();

    const mc = card(m.page, "Mailchimp");
    await mc.getByLabel("Mailchimp API key").fill(MAILCHIMP_KEY);
    await mc.getByRole("button", { name: "Connect" }).click();
    await mc.getByRole("button", { name: "Use this list" }).click();
    await expect(mc.getByText("E2E Audience", { exact: true })).toBeVisible();
    expect((await calls("klaviyo")).filter((c) => c.method === "GET" && c.authorised).length).toBeGreaterThan(0);
    expect((await calls("klaviyo")).filter((c) => !c.authorised).length).toBe(1); // the wrong key was rejected by the provider, not by us
  });

  test("the merchant builds an inline form with a first name and a sign-up incentive, sees it in the live preview, and publishes", async () => {
    await m.page.goto("/app/campaigns/new?tool=email");
    await m.page.getByLabel("Campaign name").fill("E2E inline signup");
    await m.page.getByLabel("Headline").fill(HEADLINE);
    await m.page.getByLabel("Consent text").fill(CONSENT);
    await m.page.getByLabel("Style").selectOption("inline");
    await openTab(m.page, "Display");
    await expect(m.page.getByLabel("Trigger")).toHaveCount(0); // part of the page: no trigger
    await openTab(m.page, "Content");
    await m.page.getByLabel(/Also ask for a first name/).check();
    await openTab(m.page, "Offer");
    await m.page.getByLabel(/Give subscribers a discount code once they confirm/).check();
    await m.page.getByLabel("Code", { exact: true }).fill(CODE);
    await m.page.getByLabel("Percent off").fill("15");

    const preview = m.page.getByLabel("Campaign preview");
    await expect(preview.getByLabel("First name (optional)")).toBeVisible();
    await expect(preview.getByRole("checkbox")).not.toBeChecked();
    await expect(preview).not.toContainText(CODE); // the real renderer never draws the code on the form

    await launch(m.page);
    await expect(m.page).toHaveURL(/\/app\/campaigns\/cmp_/);
    await expect(m.page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(alertOf(m.page)).toHaveCount(0);
  });

  const first = unique("ada");
  test("a shopper sees the form inside the page (no popup), signs up with a first name, and is told a code comes after confirming, never shown it", async ({ browser }) => {
    const s = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await expect(form(s.page).getByText(HEADLINE)).toBeVisible({ timeout: 15_000 }); // it fell back to the end of <main>: the page has no marker
    await expect(s.page.locator("body > [data-convertflow]")).toHaveCount(0); // and nothing is overlaid on the page
    await signUp(s.page, first, "Ada");
    await expect(form(s.page).getByText("Your discount code is shown once you confirm.")).toBeVisible();
    await expect(s.page.locator("body")).not.toContainText(CODE);
    await expect(form(s.page)).toHaveCount(1); // the confirmation message stays put
    await s.ctx.close();
  });

  test("nothing reaches either provider until the shopper confirms, and the merchant sees them waiting", async () => {
    await new Promise((r) => setTimeout(r, 1500));
    expect(await subscribeCalls("klaviyo")).toHaveLength(0);
    expect(await subscribeCalls("mailchimp")).toHaveLength(0);
    await m.page.goto("/app/subscribers");
    await expect(rowOf(m.page, first)).toContainText("Waiting to confirm");
    await expect(rowOf(m.page, first)).not.toContainText("Klaviyo");
  });

  test("confirming reveals the code (and emails it), and each provider gets exactly one subscribe with the first name and consent time", async ({ browser }) => {
    const { page, ctx } = await confirm(browser, first);
    await expect(page.getByText(CODE)).toBeVisible();
    await expect(page.getByText(/15% off/)).toBeVisible();
    await ctx.close();
    const welcome = await waitForMail(first, /15% off code/);
    expect(welcome.text).toContain(CODE);

    await expect.poll(async () => (await subscribeCalls("klaviyo")).length, { timeout: 30_000, intervals: [500] }).toBe(1);
    await expect.poll(async () => (await subscribeCalls("mailchimp")).length, { timeout: 30_000, intervals: [500] }).toBe(1);
    const kc = await calls("klaviyo");
    expect(kc.find((c) => c.path === "/api/profile-import/")!.body.data.attributes).toMatchObject({ email: first, first_name: "Ada" });
    const sub = kc.find((c) => c.path.endsWith("bulk-create-jobs/"))!.body.data;
    expect(sub.relationships.list.data.id).toBe("KL1");
    expect(sub.attributes.profiles.data[0].attributes.subscriptions.email.marketing.consent).toBe("SUBSCRIBED");
    expect(new Date(sub.attributes.profiles.data[0].attributes.subscriptions.email.marketing.consented_at).getTime()).toBeGreaterThan(Date.now() - 120_000);
    const mc = (await subscribeCalls("mailchimp"))[0]!;
    expect(mc.path).toBe(`/3.0/lists/MC1/members/${md5(first)}`); // the real MD5 of the address, checked against Node's own
    expect(mc.body).toMatchObject({ email_address: first, status_if_new: "subscribed", merge_fields: { FNAME: "Ada" } });

    await m.page.goto("/app/subscribers");
    await expect(rowOf(m.page, first)).toContainText("In Klaviyo");
    await expect(rowOf(m.page, first)).toContainText("In Mailchimp");
    await expect(rowOf(m.page, first)).toContainText("Ada");
  });

  test("a provider that refuses a request shows as failed in words; fixing it and retrying sends it", async ({ browser }) => {
    const second = unique("bea");
    await fetch(`${PROVIDERS}/__fail?status=400&count=1&provider=klaviyo`, { method: "POST" }); // Klaviyo's next write (the profile import) is refused for good
    const s = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await signUp(s.page, second, "Bea");
    await s.ctx.close();
    const done = await confirm(browser, second);
    await done.ctx.close();

    await m.page.goto("/app/subscribers");
    await expect(rowOf(m.page, second)).toContainText("Klaviyo failed", { timeout: 30_000 });
    await expect(rowOf(m.page, second)).toContainText("In Mailchimp"); // one provider failing does not hold back the other
    const k = card(m.page, "Klaviyo");
    await expect(k.getByRole("button", { name: /Retry 1 failed/ })).toBeVisible();
    await k.getByRole("button", { name: /Retry 1 failed/ }).click();
    await expect(k.getByText(/1 failed contact was sent again/)).toBeVisible();
    await m.page.reload();
    await expect(rowOf(m.page, second)).toContainText("In Klaviyo", { timeout: 30_000 });
    expect((await subscribeCalls("klaviyo")).length).toBe(2); // the refused attempt never reached the subscribe step; this is the retry
  });

  test("opting out by the email's one-click link takes them off both lists", async ({ request }) => {
    const welcome = await waitForMail(first, /15% off code/);
    const unsub = (welcome.headers["List-Unsubscribe"] ?? welcome.headers["list-unsubscribe"]!).replace(/[<>]/g, "");
    expect((await request.post(unsub)).status()).toBe(200);
    await expect.poll(async () => (await removeCalls("klaviyo")).length, { timeout: 30_000, intervals: [500] }).toBe(1);
    await expect.poll(async () => (await removeCalls("mailchimp")).length, { timeout: 30_000, intervals: [500] }).toBe(1);
    expect((await removeCalls("mailchimp"))[0]!.path).toBe(`/3.0/lists/MC1/members/${md5(first)}`);
    await m.page.goto("/app/subscribers");
    await expect(rowOf(m.page, first)).toContainText("Unsubscribed");
    await expect(rowOf(m.page, first)).toContainText("Removed from Klaviyo");
  });

  test("an unsubscribed address cannot be re-added by signing up again, and is never sent to a provider", async ({ browser }) => {
    const before = (await subscribeCalls("klaviyo")).length;
    const s = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await signUp(s.page, first, "Ada");
    await s.ctx.close();
    await new Promise((r) => setTimeout(r, 2000));
    expect((await outboxCount(first, /Confirm your subscription/))).toBe(1); // only the original request ever got a confirmation
    expect((await subscribeCalls("klaviyo")).length).toBe(before);
  });

  test("erasing a subscriber takes them off the list first and says so; the page is accessible with the provider panel", async () => {
    await m.page.goto("/app/subscribers");
    const second = (await calls("mailchimp")).filter((c) => c.method === "PUT").length; // both addresses are on Mailchimp by now
    expect(second).toBe(2);
    const row = m.page.getByRole("row").filter({ hasText: "Bea" });
    await row.getByRole("button", { name: /^Erase/ }).click();
    await row.getByRole("button", { name: "Erase for good" }).click();
    await expect(m.page.getByRole("status").filter({ hasText: /taken off any connected list/ })).toBeVisible();
    await expect.poll(async () => (await removeCalls("mailchimp")).length, { timeout: 30_000 }).toBe(2);

    const results = await new AxeBuilder({ page: m.page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("disconnecting stops copying: a later signup is confirmed but sent nowhere", async ({ browser }) => {
    await m.page.goto("/app/subscribers");
    for (const name of ["Klaviyo", "Mailchimp"]) {
      await card(m.page, name).getByRole("button", { name: "Disconnect", exact: true }).click();
      await card(m.page, name).getByRole("button", { name: "Disconnect for good" }).click();
      await expect(card(m.page, name).getByLabel(`${name} API key`)).toBeVisible();
    }
    const before = (await subscribeCalls("klaviyo")).length + (await subscribeCalls("mailchimp")).length;
    const third = unique("cy");
    const s = await shopper(browser, "/products/running-shoe", m.siteKey, { consent: "0" });
    await signUp(s.page, third);
    await s.ctx.close();
    const done = await confirm(browser, third);
    await done.ctx.close();
    await new Promise((r) => setTimeout(r, 2000));
    expect((await subscribeCalls("klaviyo")).length + (await subscribeCalls("mailchimp")).length).toBe(before);
    await m.page.goto("/app/subscribers");
    await expect(rowOf(m.page, third)).toContainText("Subscribed");
  });

  test("the analytics page shows the form's requests and confirmations from the server", async () => {
    await m.page.goto("/app/analytics");
    const table = m.page.getByRole("table", { name: "Email signup forms" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row", { name: /E2E inline signup/ })).toBeVisible();
    await expect(table.getByText("Request rate (est.)")).toBeVisible(); // labelled as an estimate: impressions come only from consenting browsers
  });
});

async function outboxCount(to: string, subject: RegExp): Promise<number> {
  const { outbox } = await import("./support");
  return (await outbox(to)).filter((x) => subject.test(x.subject)).length;
}
