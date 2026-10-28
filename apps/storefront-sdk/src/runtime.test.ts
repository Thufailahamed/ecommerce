// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignConfig, type StorefrontConfig } from "@convertflow/contracts";
import { boot } from "./index";

const camp = (id: string, over: Record<string, unknown> = {}) => ({
  campaignId: id, versionId: `${id}_v1`,
  config: CampaignConfig.parse({
    schemaVersion: 1, name: id, tool: "toast", format: "toast", toast: {},
    creative: { headline: `Headline ${id}`, body: "Body", ctaLabel: "Go", ctaUrl: "/x" },
    style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" }, ...over,
  }),
});
const popup = (id: string, over: Record<string, unknown> = {}) => camp(id, { tool: undefined, format: "popup", toast: undefined, ...over });
const cfgOf = (...campaigns: ReturnType<typeof camp>[]): StorefrontConfig => ({
  schemaVersion: 1, siteId: "cf_x", generatedAt: "2026-10-27T00:00:00.000Z", deliveryEnabled: true, currency: "USD", campaigns,
});

type Posted = { url: string; body: { events?: { type: string; campaignId?: string }[] } };
let posts: Posted[];
const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const hosts = () => Array.from(document.querySelectorAll("[data-convertflow]"));
const text = () => hosts().map((h) => h.shadowRoot?.textContent ?? "").join("|");
const types = () => posts.flatMap((p) => p.body.events?.map((e) => e.type) ?? []);
const cf = () => window.ConvertFlow!;

async function start(cfg: StorefrontConfig, o: { consent?: boolean; shopify?: boolean; fetchImpl?: (url: string, init?: RequestInit) => Promise<Response | undefined> } = {}) {
  localStorage.clear(); sessionStorage.clear(); document.body.innerHTML = "";
  window.ConvertFlow = { consent: o.consent ?? true };
  (window as unknown as { Shopify?: unknown }).Shopify = o.shopify ? {} : undefined;
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (o.fetchImpl) { const r = await o.fetchImpl(url, init).catch(() => undefined); if (r) return r; }
    if (String(url).includes("/sdk/v1/config/")) return new Response(JSON.stringify(cfg));
    posts.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(null, { status: 202 });
  }));
  const s = document.createElement("script");
  s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
  boot(s);
  await wait(30);
}

beforeEach(() => vi.useRealTimers());
afterEach(() => { cf()?.destroy?.(); vi.unstubAllGlobals(); delete (window as unknown as { Shopify?: unknown }).Shopify; });

describe("email signup on the storefront", () => {
  const CONSENT = "I agree to receive marketing emails from this store. Unsubscribe any time.";
  const signupForm = (id = "f", over: Record<string, unknown> = {}) =>
    popup(id, { tool: "email", form: { collect: { email: true }, consentText: CONSENT, privacyUrl: "/policies/privacy-policy" }, ...over });
  const fill = (email = "a@example.com", tick = true) => {
    const root = hosts()[0]!.shadowRoot!;
    root.querySelector<HTMLInputElement>("input[type=email]")!.value = email;
    root.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked = tick;
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  };
  const signupPosts = () => posts.filter((p) => p.url === "https://api.test/api/v1/notifications/subscribe");
  const reboot = async () => {
    cf().destroy?.(); document.body.innerHTML = "";
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait(30);
  };

  it("sends only the address, the form's campaign and the ticked box: never the consent words", async () => {
    await start(cfgOf(signupForm()));
    expect(text()).toContain("Headline f");
    fill(); await wait();
    expect(signupPosts()).toHaveLength(1);
    expect(signupPosts()[0]!.body).toEqual({ siteId: "cf_x", campaignId: "f", email: "a@example.com", consent: true });
    expect(text()).toContain("Check your inbox");
    expect(types()).toContain("notification_subscribed");
  });

  it("does not send when the box is not ticked", async () => {
    await start(cfgOf(signupForm()));
    fill("a@example.com", false); await wait();
    expect(signupPosts()).toHaveLength(0);
    expect(text()).toMatch(/tick the box/i);
  });

  it("a failed request shows an error and records no signup", async () => {
    await start(cfgOf(signupForm()), { fetchImpl: async (url) => (url.endsWith("/notifications/subscribe") ? new Response(null, { status: 500 }) : undefined) });
    fill(); await wait();
    expect(text()).toMatch(/went wrong/i);
    expect(types()).not.toContain("notification_subscribed");
  });

  it("does not show the form again after signing up, with or without analytics consent", async () => {
    for (const consent of [true, false]) {
      await start(cfgOf(signupForm()), { consent });
      fill(); await wait();
      await reboot();
      expect(text(), `consent=${consent}`).toBe("");
    }
  });

  it("without analytics consent it still works but records nothing", async () => {
    await start(cfgOf(signupForm()), { consent: false });
    fill(); await wait();
    expect(signupPosts()).toHaveLength(1); // the signup itself is the shopper's own request, not analytics
    expect(types()).toEqual([]);
  });
});

describe("toast on the storefront", () => {
  it("shows an eligible toast and records the impression", async () => {
    await start(cfgOf(camp("t")));
    expect(text()).toContain("Headline t");
    expect(types()).toEqual(expect.arrayContaining(["campaign_eligible", "campaign_impression"]));
  });

  it("does not show an ineligible toast (targeting mismatch)", async () => {
    await start(cfgOf(camp("t", { targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["cart"] }] } })));
    expect(text()).toBe("");
  });

  it("shows nothing when the kill switch is off", async () => {
    await start({ ...cfgOf(camp("t")), deliveryEnabled: false });
    expect(text()).toBe("");
  });

  it("never renders two experiences at once and never duplicates on a second boot", async () => {
    await start(cfgOf(camp("a", { priority: 10 }), camp("b", { priority: 90 })));
    expect(hosts()).toHaveLength(1);
    expect(text()).toContain("Headline b");
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait();
    expect(hosts()).toHaveLength(1);
  });

  it("an interruptive popup wins the screen over a higher-priority toast", async () => {
    await start(cfgOf(camp("t", { priority: 95 }), popup("p", { priority: 5 })));
    expect(hosts()).toHaveLength(1);
    expect(text()).toContain("Headline p");
  });
});

describe("dismissal and the cross-tool quiet period", () => {
  const dismiss = () => (hosts()[0]!.shadowRoot!.querySelector("button[aria-label='Dismiss notification'], button[aria-label='Close']") as HTMLButtonElement).click();

  it("records a dismissal, then keeps every other toast and popup quiet", async () => {
    // The popup is only eligible once the cart reaches $50, so it can compete after the dismissal.
    const cartPopup = popup("p", { targeting: { match: "all", conditions: [{ field: "cart_subtotal", op: "gte", value: 50 }] } });
    await start(cfgOf(camp("t1", { priority: 90 }), camp("t2", { priority: 10 }), cartPopup));
    expect(text()).toContain("Headline t1");
    dismiss();
    await wait();
    expect(hosts()).toHaveLength(0);
    expect(types()).toContain("campaign_dismiss");
    expect(JSON.parse(sessionStorage.getItem("cf:s:v1")!).quietUntil).toBeGreaterThan(Date.now());
    // The cart change makes the popup eligible and re-evaluates; the quiet period must hold, for the popup and for t2.
    cf().setCart!({ subtotal: 60 }); await wait();
    expect(hosts()).toHaveLength(0);
  });

  it("a dismissed campaign stays dismissed on the next page view", async () => {
    await start(cfgOf(camp("t1")));
    dismiss(); await wait();
    const kept = { l: localStorage.getItem("cf:v1"), s: sessionStorage.getItem("cf:s:v1") };
    cf().destroy!();
    document.body.innerHTML = "";
    localStorage.setItem("cf:v1", kept.l!); sessionStorage.setItem("cf:s:v1", JSON.stringify({ ...JSON.parse(kept.s!), quietUntil: 0 }));
    window.ConvertFlow = { consent: true };
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait(40);
    expect(hosts()).toHaveLength(0);
  });

  it("an auto-dismissed toast is not a dismissal: no event, no quiet period, the next experience may follow", async () => {
    await start(cfgOf(camp("t1", { priority: 90, toast: { durationSeconds: 3 } }), camp("t2", { priority: 10 })));
    expect(text()).toContain("Headline t1");
    await wait(3200); // real time: the minimum auto-dismiss is 3 seconds
    expect(hosts()).toHaveLength(0);
    expect(types()).not.toContain("campaign_dismiss");
    expect(sessionStorage.getItem("cf:s:v1")).not.toContain("quietUntil");
    cf().setCart!({ subtotal: 1 }); await wait(); // any re-evaluation: t1 is capped for the session, t2 is free to show
    expect(text()).toContain("Headline t2");
  });
});

describe("cart triggers", () => {
  it("add_to_cart: waits for a real add-to-cart, then shows", async () => {
    await start(cfgOf(camp("t", { trigger: { type: "add_to_cart", delaySeconds: 0 } })));
    expect(text()).toBe("");
    cf().setCart!({ subtotal: 30 }); await wait(); // a cart update is not an add
    expect(text()).toBe("");
    cf().trackAddToCart!({ subtotal: 30, itemCount: 1 }); await wait();
    expect(text()).toContain("Headline t");
  });

  it("cart_threshold: shows only once the subtotal reaches the threshold", async () => {
    await start(cfgOf(camp("t", { trigger: { type: "cart_threshold", subtotal: 75 } })));
    expect(text()).toBe("");
    cf().setCart!({ subtotal: 74.99 }); await wait();
    expect(text()).toBe("");
    cf().setCart!({ subtotal: 80 }); await wait();
    expect(text()).toContain("Headline t");
  });

  it("free-shipping toast: needs a known, short cart; states the real gap; never invents one", async () => {
    await start(cfgOf(camp("s", { toast: { kind: "shipping_incentive", freeShippingThreshold: 75 } })));
    expect(text()).toBe(""); // cart unknown
    cf().setCart!({ subtotal: 60 }); await wait();
    expect(text()).toContain("$15.00 away from free shipping");
  });

  it("free-shipping toast stays hidden when the cart already qualifies", async () => {
    await start(cfgOf(camp("s", { toast: { kind: "shipping_incentive", freeShippingThreshold: 75 } })));
    cf().setCart!({ subtotal: 120 }); await wait();
    expect(text()).toBe("");
  });

  it("rejects garbage cart data instead of acting on it", async () => {
    await start(cfgOf(camp("t", { trigger: { type: "cart_threshold", subtotal: 10 } })));
    cf().setCart!({ subtotal: Number.NaN }); cf().setCart!({ subtotal: -5 }); cf().setCart!({ subtotal: "99" as unknown as number });
    await wait();
    expect(text()).toBe("");
  });
});

describe("Shopify cart detection (fake fetch; not verified on a live store)", () => {
  const shop = (subtotalCents: number, itemCount: number) => async (url: string): Promise<Response | undefined> => {
    if (url.startsWith("/cart.js")) return new Response(JSON.stringify({ items_subtotal_price: subtotalCents, item_count: itemCount }));
    if (/\/cart\/add\.js$/.test(url)) return new Response("{}", { status: 200 });
    return undefined;
  };

  it("reads /cart.js after an add and fires the add_to_cart trigger, converting cents to a subtotal", async () => {
    await start(cfgOf(camp("t", { trigger: { type: "add_to_cart", delaySeconds: 0 } })), { shopify: true, fetchImpl: shop(4500, 2) });
    expect(text()).toBe("");
    await window.fetch("/cart/add.js", { method: "POST", body: "{}" });
    await wait(40);
    expect(text()).toContain("Headline t");
  });

  it("reads the cart at load when a campaign depends on it", async () => {
    await start(cfgOf(camp("s", { toast: { kind: "shipping_incentive", freeShippingThreshold: 75 } })), { shopify: true, fetchImpl: shop(6000, 2) });
    await wait(40);
    expect(text()).toContain("$15.00 away from free shipping");
  });

  it("does not read the cart at all when no campaign needs it", async () => {
    const seen: string[] = [];
    await start(cfgOf(camp("t")), { shopify: true, fetchImpl: async (u) => { seen.push(u); return undefined; } });
    expect(seen.some((u) => u.startsWith("/cart.js"))).toBe(false);
  });

  it("passes the shop's own request through untouched and leaves its response readable", async () => {
    await start(cfgOf(camp("t")), { shopify: true, fetchImpl: shop(1000, 1) });
    const r = await window.fetch("/cart/add.js", { method: "POST", body: "{}" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("{}");
  });

  it("a failing add-to-cart does not count as an add", async () => {
    await start(cfgOf(camp("t", { trigger: { type: "add_to_cart", delaySeconds: 0 } })), { shopify: true, fetchImpl: async (u) => (/\/cart\/add\.js$/.test(u) ? new Response("{}", { status: 422 }) : undefined) });
    await window.fetch("/cart/add.js", { method: "POST", body: "{}" });
    await wait(40);
    expect(text()).toBe("");
  });

  it("restores the original fetch on destroy", async () => {
    await start(cfgOf(camp("t")), { shopify: true });
    const wrapped = window.fetch;
    cf().destroy!();
    expect(window.fetch).not.toBe(wrapped);
  });
});

describe("cleanup", () => {
  it("destroy removes the UI, the public cart API, and allows a fresh boot", async () => {
    await start(cfgOf(camp("t")));
    expect(hosts()).toHaveLength(1);
    expect(typeof cf().setCart).toBe("function");
    cf().destroy!();
    expect(hosts()).toHaveLength(0);
    expect(cf().setCart).toBeUndefined();
    expect(cf().__loaded).toBe(false);
  });

  it("a pending delayed toast never appears after destroy", async () => {
    await start(cfgOf(camp("t", { trigger: { type: "delay", seconds: 1 } })));
    expect(text()).toBe("");
    cf().destroy!();
    await wait(1100);
    expect(hosts()).toHaveLength(0);
  });

  it("listeners are removed: scrolling after destroy shows nothing", async () => {
    await start(cfgOf(camp("t", { trigger: { type: "scroll_depth", percent: 10 } })));
    cf().destroy!();
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 4000, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    await wait();
    expect(hosts()).toHaveLength(0);
  });
});

describe("consent", () => {
  it("shows the toast but records and stores nothing without analytics consent", async () => {
    await start(cfgOf(camp("t")), { consent: false });
    expect(text()).toContain("Headline t");
    expect(posts).toHaveLength(0);
    expect(localStorage.getItem("cf:v1")).toBeNull();
  });
});
