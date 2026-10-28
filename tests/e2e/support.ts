import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { API, MAIL, STORE, WEB } from "./playwright.config";

export const PASSWORD = "correct-horse-battery";
export const unique = (p: string) => `${p}${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

export interface Mail { to: string; subject: string; text: string; headers: Record<string, string> }
export const outbox = async (to: string): Promise<Mail[]> => (await fetch(`${MAIL}/outbox?to=${encodeURIComponent(to)}`)).json() as Promise<Mail[]>;
export const firstUrl = (m: Mail) => m.text.match(/https?:\/\/\S+/)![0];

/** Polls the mock mailbox until a message whose subject matches arrives (emails are sent asynchronously). */
export async function waitForMail(to: string, subject: RegExp): Promise<Mail> {
  let found: Mail | undefined;
  await expect.poll(async () => (found = [...(await outbox(to))].reverse().find((m) => subject.test(m.subject)), found), { timeout: 20_000, intervals: [300] }).toBeTruthy();
  return found!;
}

/** RFC 6238, same algorithm as the server, so the test can act as the user's authenticator app. */
export function totp(secretB32: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretB32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

/** Changes a workspace's plan directly in the local database: what a verified Stripe webhook does in production. */
export function setPlanFor(email: string, plan: "free" | "starter" | "growth" | "scale") {
  const sql = `update subscriptions set plan='${plan}' where organization_id in (select organization_id from memberships m join users u on u.id=m.user_id where u.email='${email.replace(/'/g, "")}')`;
  execSync(`pnpm exec wrangler d1 execute convertflow --local --persist-to ../../tests/e2e/.state --command "${sql}"`, { cwd: new URL("../../apps/api", import.meta.url), stdio: "pipe" });
}

/** A signed-up merchant with a confirmed email and a connected store, in a fresh browser context. */
export async function newMerchant(browser: Browser, opts: { plan?: "growth"; platform?: string } = {}) {
  const email = unique("m");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(firstUrl(await waitForMail(email, /Confirm your email/)));
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.goto("/app");
  await page.getByLabel("Store name").fill("Shop");
  await page.getByLabel("Store domain").fill("shop.example.com");
  await page.getByRole("button", { name: "Connect store" }).click();
  await expect(page.getByRole("heading", { name: "Shop" })).toBeVisible();
  if (opts.plan) setPlanFor(email, opts.plan);
  const stores = await (await page.request.get(`${API}/api/v1/stores`)).json() as { data: { id: string; siteKey: string }[] };
  return { email, ctx, page, storeId: stores.data[0]!.id, siteKey: stores.data[0]!.siteKey };
}

export type Merchant = Awaited<ReturnType<typeof newMerchant>>;

export const apiPost = (page: Page, path: string, data: unknown) => page.request.post(`${API}${path}`, { data, headers: { origin: WEB } });

/** A shopper in a clean browser context on the demo storefront. */
export async function shopper(browser: Browser, path: string, siteKey: string, q: Record<string, string> = { consent: "0" }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${STORE}${path}?${new URLSearchParams({ site: siteKey, ...q })}`);
  return { ctx, page };
}

/** App alerts only: Next.js injects its own role="alert" route announcer, which getByRole("alert") would also match. */
export const alertOf = (p: Page) => p.locator('[role="alert"]:not(#__next-route-announcer__)');

/** The editor groups its controls into section tabs. */
export const openTab = (p: Page, name: "Content" | "Design" | "Targeting" | "Display" | "Offer" | "Test" | "History") => p.getByRole("tab", { name, exact: true }).click();
/** Opens the review drawer, approves, and presses the publish button. Does not wait for the result. */
export async function launch(p: Page, button: "Publish" | "Publish changes" = "Publish") {
  await p.getByRole("button", { name: /^(Launch|Update)$/ }).click();
  await p.getByRole("checkbox", { name: /approve it to go live/ }).check();
  await p.getByRole("button", { name: button, exact: true }).click();
}
