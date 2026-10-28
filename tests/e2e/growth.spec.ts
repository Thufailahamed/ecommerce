import { expect, test, type Page } from "@playwright/test";
import { API, MAIL, STORE, WEB } from "./playwright.config";
import { PASSWORD, alertOf, apiPost, firstUrl, newMerchant, shopper, totp, unique, waitForMail, outbox, type Merchant } from "./support";

const errors: string[] = [];
const watch = (p: Page) => { p.on("pageerror", (e) => errors.push(e.message)); };

async function publishFromEditor(page: Page, opts: { name: string; trigger?: string }) {
  await page.getByLabel("Campaign name").fill(opts.name);
  if (opts.trigger) await page.getByLabel("Trigger").selectOption(opts.trigger);
  await page.getByRole("checkbox", { name: /approve it to go live/ }).check();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
}

test.describe("password reset", () => {
  test("forgot, emailed link, new password, old password rejected, sessions cleared", async ({ browser }) => {
    const m = await newMerchant(browser);
    watch(m.page);
    const other = await browser.newContext(); const op = await other.newPage();
    await op.goto("/login"); await op.getByLabel("Email").fill(m.email); await op.getByLabel("Password").fill(PASSWORD);
    await op.getByRole("button", { name: "Sign in" }).click(); await expect(op).toHaveURL(/\/app$/);

    const ctx = await browser.newContext(); const page = await ctx.newPage(); watch(page);
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await page.getByLabel("Email").fill(m.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/we've sent a link/)).toBeVisible();

    const mail = await waitForMail(m.email, /Reset your password/);
    const link = firstUrl(mail);
    expect(link).toContain("/reset-password?token=");
    await page.goto(link);
    await page.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
    await page.getByLabel("Confirm new password").fill("a-different-one-123");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(alertOf(page)).toContainText("don't match");
    await page.getByLabel("Confirm new password").fill("a-brand-new-password");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();

    await page.goto(link); // single-use
    await page.getByLabel("New password", { exact: true }).fill("yet-another-password-1");
    await page.getByLabel("Confirm new password").fill("yet-another-password-1");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(alertOf(page)).toContainText(/invalid or has expired/);

    await op.goto("/app"); await expect(op).toHaveURL(/\/login/); // the other device was signed out

    await page.goto("/login");
    await page.getByLabel("Email").fill(m.email); await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(alertOf(page)).toContainText("Invalid email or password");
    await page.getByLabel("Password").fill("a-brand-new-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await Promise.all([ctx.close(), other.close(), m.ctx.close()]);
  });
});

test.describe("two-step verification", () => {
  test("enrol with an authenticator, sign in with a code and with a recovery code, then turn it off", async ({ browser }) => {
    const m = await newMerchant(browser);
    const { page } = m; watch(page);
    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Set up two-step verification" }).click();
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    await page.getByLabel("6-digit code from the app").fill("000000");
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(alertOf(page).first()).toContainText("not correct");
    await page.getByLabel("6-digit code from the app").fill(totp(secret));
    await page.getByRole("button", { name: "Turn on" }).click();
    const codes = (await page.getByTestId("recovery-codes").innerText()).trim().split(/\s+/);
    expect(codes).toHaveLength(8);
    await page.getByRole("button", { name: /I've saved them/ }).click();
    await expect(page.getByText("On", { exact: true }).first()).toBeVisible();

    // fresh context = another device: needs the second factor
    const signIn = async (code?: string) => {
      const c = await browser.newContext(); const p = await c.newPage(); watch(p);
      await p.goto("/login"); await p.getByLabel("Email").fill(m.email); await p.getByLabel("Password").fill(PASSWORD);
      await p.getByRole("button", { name: "Sign in" }).click();
      await expect(p.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
      if (code) { await p.getByLabel("Authentication code").fill(code); await p.getByRole("button", { name: "Verify and sign in" }).click(); }
      return { c, p };
    };
    const bad = await signIn("111111");
    await expect(alertOf(bad.p)).toContainText("not correct");
    await bad.c.close();
    const good = await signIn(totp(secret));
    await expect(good.p).toHaveURL(/\/app$/);
    await good.c.close();
    const rec = await signIn(codes[0]!);
    await expect(rec.p).toHaveURL(/\/app$/);
    await rec.c.close();
    const reuse = await signIn(codes[0]!);
    await expect(alertOf(reuse.p)).toContainText("not correct"); // recovery codes work once
    await reuse.c.close();

    await page.goto("/app/settings");
    await page.getByLabel("Password", { exact: true }).last().fill(PASSWORD);
    await page.getByLabel("Code or recovery code").fill(totp(secret));
    await page.getByRole("button", { name: "Turn off two-step verification" }).click();
    await expect(page.getByRole("button", { name: "Set up two-step verification" })).toBeVisible();
    await m.ctx.close();
  });
});

test.describe("team", () => {
  test("invite by link, accept as the invited address only, role applies, removal revokes access", async ({ browser }) => {
    const owner = await newMerchant(browser);
    watch(owner.page);
    const mate = unique("mate");
    await owner.page.goto("/app/settings");
    await owner.page.getByLabel("Invite by email").fill(mate);
    await owner.page.getByLabel("Role", { exact: true }).selectOption("viewer");
    await owner.page.getByRole("button", { name: "Send invite" }).click();
    await expect(owner.page.getByText(`We emailed ${mate}`)).toBeVisible();
    const url = (await owner.page.getByTestId("invite-url").innerText()).trim();
    expect(firstUrl(await waitForMail(mate, /invited/))).toBe(url);
    await expect(owner.page.getByText(mate).first()).toBeVisible();

    // someone else cannot use the link
    const stranger = await browser.newContext(); const sp = await stranger.newPage(); watch(sp);
    const strangerEmail = unique("stranger");
    await sp.goto("/signup"); await sp.getByLabel("Email").fill(strangerEmail); await sp.getByLabel("Password").fill(PASSWORD);
    await sp.getByRole("button", { name: "Create account" }).click(); await expect(sp).toHaveURL(/\/app$/);
    await sp.goto(url); await sp.getByRole("button", { name: "Join workspace" }).click();
    await expect(alertOf(sp)).toContainText(`sent to ${mate}`);
    await stranger.close();

    // the invited person: signed out -> create account -> back to the invite -> join
    const mc = await browser.newContext(); const mp = await mc.newPage(); watch(mp);
    await mp.goto(url);
    await mp.getByRole("link", { name: "Create account" }).click();
    await mp.getByLabel("Email").fill(mate); await mp.getByLabel("Password").fill(PASSWORD);
    await mp.getByRole("button", { name: "Create account" }).click();
    await expect(mp).toHaveURL(/\/invite\?token=/); // returned to the invite, not dumped on the dashboard
    await mp.getByRole("button", { name: "Join workspace" }).click();
    await expect(mp.getByRole("heading", { name: /You've joined/ })).toBeVisible();
    await mp.goto("/app/campaigns");
    await expect(mp.getByRole("heading", { name: "Campaigns", exact: true })).toBeVisible();
    const sid = owner.storeId;
    expect((await apiPost(mp, `/api/v1/stores/${sid}/campaigns`, {})).status()).toBe(403); // viewer cannot create

    // promote, then remove
    await owner.page.reload();
    await owner.page.getByLabel(`Role for ${mate}`).selectOption("editor");
    await owner.page.reload();
    await expect(owner.page.getByLabel(`Role for ${mate}`)).toHaveValue("editor"); // persisted server-side
    owner.page.once("dialog", (d) => void d.accept());
    await owner.page.getByRole("row", { name: new RegExp(mate) }).getByRole("button", { name: "Remove" }).click();
    await expect(owner.page.getByRole("row", { name: new RegExp(mate) })).toHaveCount(0);
    expect((await mp.request.get(`${API}/api/v1/stores/${sid}`)).status()).toBe(404); // access gone immediately
    await Promise.all([mc.close(), owner.ctx.close()]);
  });
});

test.describe("back-in-stock alerts", () => {
  test("shopper opts in by email, confirms, gets one alert when stock returns, and can unsubscribe", async ({ browser }) => {
    const m = await newMerchant(browser, { plan: "growth" });
    watch(m.page);
    const product = (available: boolean) => ({ products: [{ externalId: "boot-1", title: "Trail Boot", url: "/products/trail-boot", variants: [{ externalId: "boot-1-9", available }] }] });
    expect((await apiPost(m.page, `/api/v1/stores/${m.storeId}/products/import`, product(false))).ok()).toBe(true);

    await m.page.goto("/app/campaigns/new");
    await m.page.getByLabel("Format").selectOption("restock");
    await expect(m.page.getByText("Product is out of stock")).toBeVisible(); // sensible rules were added for them
    await expect(m.page.getByLabel("Campaign preview").getByLabel("Email address")).toBeVisible(); // live preview shows the real form
    await publishFromEditor(m.page, { name: "Restock form", trigger: "immediate" });
    await expect(m.page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });

    const ctx = JSON.stringify({ productId: "boot-1", productAvailable: false });
    const s = await shopper(browser, "/products/trail-boot", m.siteKey, { consent: "0", ctx });
    watch(s.page);
    const form = s.page.locator("[data-convertflow]").locator("form");
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.getByLabel("Email address").fill("nope");
    await form.getByRole("button", { name: "Notify me" }).click();
    await expect(form).toContainText("valid email");
    const fan = unique("fan");
    await form.getByLabel("Email address").fill(fan);
    await form.getByRole("button", { name: "Notify me" }).click();
    await expect(s.page.locator("[data-convertflow]")).toContainText("Check your inbox");

    // 1) only a confirmation goes out, and nothing else even when stock returns before confirming
    const confirm = await waitForMail(fan, /Confirm your alert/);
    await apiPost(m.page, `/api/v1/stores/${m.storeId}/products/import`, product(true));
    await apiPost(m.page, `/api/v1/stores/${m.storeId}/products/import`, product(false));
    expect((await outbox(fan)).filter((x) => /available again/.test(x.subject))).toHaveLength(0);

    // 2) confirm via the emailed link
    const cp = await (await browser.newContext()).newPage();
    await cp.goto(firstUrl(confirm));
    await expect(cp.getByRole("heading", { name: "You're confirmed" })).toBeVisible();

    // 3) stock returns: exactly one alert, with a working unsubscribe
    const r = await apiPost(m.page, `/api/v1/stores/${m.storeId}/products/import`, product(true));
    expect((await r.json()).data).toMatchObject({ restocked: 1, alertsSent: 1 });
    const alert = await waitForMail(fan, /available again/);
    expect(alert.text).toContain("https://shop.example.com/products/trail-boot");
    expect(alert.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    await apiPost(m.page, `/api/v1/stores/${m.storeId}/products/import`, product(false));
    await apiPost(m.page, `/api/v1/stores/${m.storeId}/products/import`, product(true));
    expect((await outbox(fan)).filter((x) => /available again/.test(x.subject))).toHaveLength(1);

    await cp.goto(alert.headers["List-Unsubscribe"]!.replace(/[<>]/g, ""));
    await expect(cp.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
    await s.ctx.close(); await m.ctx.close();
  });
});

test.describe("promotions guardrail", () => {
  test("off until opted in; over-limit is rejected with a clear message; within limit shows the code", async ({ browser }) => {
    const m = await newMerchant(browser, { plan: "growth" });
    const { page } = m; watch(page);

    await page.goto("/app/campaigns/new");
    await expect(page.getByText(/Promotions are off for this store/)).toBeVisible();
    await page.getByLabel("Show a discount code in this campaign").check();
    await publishFromEditor(page, { name: "Spring offer", trigger: "immediate" });
    await expect(alertOf(page).first()).toContainText("Promotions are off for this store");

    await page.goto("/app/settings");
    await page.getByLabel("Maximum discount (%)").fill("20");
    await page.getByRole("button", { name: "Allow promotions" }).click();
    await expect(page.getByText("On, up to 20% off")).toBeVisible();

    await page.goto("/app/campaigns");
    await page.getByRole("link", { name: "Spring offer" }).click();
    await expect(page.getByLabel("Percent off")).toBeVisible();
    await page.getByLabel("Percent off").fill("25");
    await page.getByRole("checkbox", { name: /approve it to go live/ }).check();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(alertOf(page).first()).toContainText("caps promotions at 20%");

    await page.getByLabel("Percent off").fill("15");
    await page.getByRole("checkbox", { name: /approve it to go live/ }).check();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });

    const s = await shopper(browser, "/", m.siteKey);
    const root = s.page.locator("[data-convertflow]");
    await expect(root).toContainText("15% off", { timeout: 15_000 });
    await expect(root.locator("code")).toHaveText("SAVE10");
    await expect(root.getByRole("button", { name: "Copy code SAVE10" })).toBeVisible();
    await s.ctx.close(); await m.ctx.close();
  });
});

test.describe("holdout experiment", () => {
  test("randomises consenting visitors, hides the campaign from the control group, and reports honestly", async ({ browser }) => {
    const m = await newMerchant(browser, { plan: "growth" });
    const { page } = m; watch(page);
    await page.goto("/app/campaigns/new");
    await page.getByLabel("Measure real impact", { exact: false }).first().isVisible().catch(() => undefined);
    await page.getByLabel("Hold some visitors out as a control group (Growth)").check();
    await page.getByLabel(/Holdout \(% of consenting visitors\)/).fill("50");
    await expect(page.getByText(/Visitors who have not consented always see the campaign/)).toBeVisible();
    await publishFromEditor(page, { name: "Experiment", trigger: "immediate" });
    await expect(page.locator("span", { hasText: /^active$/ }).first()).toBeVisible({ timeout: 20_000 });

    // Without consent nobody is held out.
    for (let i = 0; i < 3; i++) {
      const s = await shopper(browser, "/", m.siteKey, { consent: "0" });
      await expect(s.page.getByText("Welcome in")).toBeVisible({ timeout: 15_000 });
      await s.ctx.close();
    }
    // With consent roughly half are held out. Keep going until both arms were seen (fails with p < 1e-4 in 14 tries).
    let shown = 0, held = 0;
    for (let i = 0; i < 14 && (shown === 0 || held === 0); i++) {
      const s = await shopper(browser, "/", m.siteKey, { consent: "1" });
      await s.page.waitForTimeout(1500);
      (await s.page.getByText("Welcome in").count()) > 0 ? shown++ : held++;
      await s.ctx.close();
    }
    expect(shown, "someone saw it").toBeGreaterThan(0);
    expect(held, "someone was held out").toBeGreaterThan(0);

    const day = new Date().toISOString().slice(0, 10);
    await expect.poll(async () => {
      const r = (await (await page.request.get(`${API}/api/v1/stores/${m.storeId}/analytics?from=${day}&to=${day}`)).json()).data.experiments as { treatment: { sessions: number }; holdout: { sessions: number } }[];
      return r[0] ? [r[0].treatment.sessions, r[0].holdout.sessions] : [0, 0];
    }, { timeout: 30_000, intervals: [1000] }).toEqual([shown, held]);

    await page.goto("/app/analytics");
    await expect(page.getByRole("heading", { name: /Holdout experiments/ })).toBeVisible();
    await expect(page.getByTestId("verdict")).toContainText("Not enough data for a reliable answer yet");
    await m.ctx.close();
  });
});

test.describe("dark mode", () => {
  test("every screen stays accessible in the dark theme", async ({ browser }) => {
    const AxeBuilder = (await import("@axe-core/playwright")).default;
    const m = await newMerchant(browser);
    const ctx = await browser.newContext({ colorScheme: "dark", viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); watch(page);
    await page.goto("/login"); await page.getByLabel("Email").fill(m.email); await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click(); await expect(page).toHaveURL(/\/app$/);
    const check = async (path: string) => {
      await page.goto(path); await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${path} [dark]: ${v.id} :: ${v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} ${(n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined)?.fgColor}/${(n.any[0]?.data as { bgColor?: string } | undefined)?.bgColor} ${(n.any[0]?.data as { contrastRatio?: number } | undefined)?.contrastRatio}`).join(" | ")}`), path).toEqual([]);
    };
    for (const p of ["/app", "/app/campaigns", "/app/campaigns/new", "/app/studio", "/app/analytics", "/app/settings"]) await check(p);
    await page.context().clearCookies();
    for (const p of ["/", "/login", "/signup", "/forgot-password", "/privacy"]) await check(p);
    await page.goto("/"); await page.waitForTimeout(1500); await page.screenshot({ path: "test-results/shots/dark-marketing.png" });
    await page.goto("/login"); await page.getByLabel("Email").fill(m.email); await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click(); await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/settings"); await page.waitForLoadState("networkidle"); await page.screenshot({ path: "test-results/shots/dark-settings.png" });
    await Promise.all([ctx.close(), m.ctx.close()]);
  });
});

test.describe("security headers and CSP", () => {
  test("the web app sends a CSP and nothing violates it across the main flows", async ({ browser }) => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const violations: string[] = [];
    page.on("console", (msg) => { if (/Content Security Policy|Refused to/.test(msg.text())) violations.push(msg.text()); });
    const res = await page.goto("/");
    const csp = res!.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain(`connect-src 'self' ${API}`);
    expect(res!.headers()["x-frame-options"]).toBe("DENY");
    expect(res!.headers()["strict-transport-security"]).toContain("max-age=");
    const m = await newMerchant(browser, { plan: "growth" }); m.page.on("console", (msg) => { if (/Content Security Policy|Refused to/.test(msg.text())) violations.push(msg.text()); });
    for (const p of ["/app", "/app/campaigns/new", "/app/studio", "/app/analytics", "/app/settings"]) { await m.page.goto(p); await m.page.waitForLoadState("networkidle"); }
    await page.goto("/"); await page.getByRole("tab", { name: "Slide-in" }).click();
    expect(violations, violations.join("\n")).toEqual([]);
    await Promise.all([ctx.close(), m.ctx.close()]);
  });
  test("API responses carry hardening headers; public pages are not framable or cacheable", async () => {
    const r = await fetch(`${API}/api/v1/notifications/confirm?token=x`);
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await fetch(`${API}/api/v1/openapi.json`)).headers.get("x-request-id")).toBeTruthy();
  });
});

test("no uncaught page errors in any feature flow", () => { expect(errors).toEqual([]); void STORE; void MAIL; void WEB; });
