// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignGroup } from "@convertflow/campaign-engine";
import { CampaignConfig, type StorefrontConfig } from "@convertflow/contracts";
import { resolveAdder, shopifyVariantId } from "./addtocart";
import { boot } from "./index";
import { recommendationMount, renderRecommendations, type RecProduct } from "./recommend";

const rec = (over: Record<string, unknown> = {}, recommend: Record<string, unknown> = {}) => CampaignConfig.parse({
  schemaVersion: 1, name: "r", tool: "upsell", format: "recommendation", recommend: { source: "same_collection", ...recommend },
  creative: { headline: "You might also like", ctaLabel: "Add to cart", ctaUrl: "/" },
  style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "add_to_cart" }, ...over,
});
const P = (id: string, over: Partial<RecProduct> = {}): RecProduct => ({ id, title: `Product ${id}`, url: `/products/${id}`, price: 10, addable: true, variantId: `v${id}`, ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));

const rootOf = (h: { host: HTMLElement }) => h.host.shadowRoot!;
const items = (h: { host: HTMLElement }) => Array.from(rootOf(h).querySelectorAll("li"));
const addBtn = (h: { host: HTMLElement }, i = 0) => items(h)[i]!.querySelector("button") as HTMLButtonElement;
const status = (h: { host: HTMLElement }) => rootOf(h).querySelector("[role=status]")!.textContent;

beforeEach(() => { document.body.innerHTML = ""; sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.ConvertFlow?.destroy?.(); });

describe("recommendation renderer", () => {
  it("shows the headline, each product as a real link, and formatted prices", () => {
    const h = renderRecommendations(document, rec(), [P("a", { price: 24 }), P("b", { price: 9.5 })], {}, document.body, { currency: "USD" });
    expect(rootOf(h).querySelector("h2")!.textContent).toBe("You might also like");
    expect(items(h)).toHaveLength(2);
    const link = items(h)[0]!.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/products/a");
    expect(link.textContent).toBe("Product a");
    expect(items(h)[0]!.textContent).toContain("$24.00");
    expect(items(h)[1]!.textContent).toContain("$9.50");
  });

  it("hides prices when the merchant turned them off, and never invents one the catalog lacks", () => {
    const h = renderRecommendations(document, rec({}, { showPrice: false }), [P("a")], {});
    expect(items(h)[0]!.textContent).not.toContain("$");
    const h2 = renderRecommendations(document, rec(), [{ id: "n", title: "No price", url: "/p/n", addable: false }], {});
    expect(items(h2)[0]!.textContent).not.toMatch(/\d/);
  });

  it("is part of the page for inline placements and a floating card only for the toast placement", () => {
    const inline = renderRecommendations(document, rec(), [P("a")], {});
    expect(inline.host.style.position).not.toBe("fixed");
    const toast = renderRecommendations(document, rec({}, { placement: "toast", layout: "grid" }), [P("a")], {});
    expect(toast.host.style.position).toBe("fixed");
    expect(rootOf(toast).querySelector("ul")!.getAttribute("data-layout")).toBe("list"); // a corner card is too small for a grid
    expect(rootOf(inline).querySelector("ul")!.getAttribute("data-layout")).toBe("row");
  });

  it("honours the merchant's layout and the maximum number of products", () => {
    for (const layout of ["row", "grid", "list"] as const) {
      const h = renderRecommendations(document, rec({}, { layout, maxProducts: 2 }), [P("a"), P("b"), P("c")], {});
      expect(rootOf(h).querySelector("ul")!.getAttribute("data-layout")).toBe(layout);
      expect(items(h)).toHaveLength(2);
    }
  });

  it("treats every string as text and every link as untrusted", () => {
    const h = renderRecommendations(document, rec(), [
      P("x", { title: "<img src=x onerror=alert(1)>", url: "javascript:alert(1)", imageUrl: "javascript:alert(2)" }),
    ], {});
    expect(rootOf(h).querySelector("img")).toBeNull();
    expect(items(h)[0]!.querySelector("a")!.textContent).toBe("<img src=x onerror=alert(1)>");
    for (const a of Array.from(rootOf(h).querySelectorAll("a"))) expect(a.getAttribute("href")).toBe("#");
  });

  it("an add button says what the merchant wrote, adds once, reports the result, and does not add the same product twice", async () => {
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const h = renderRecommendations(document, rec(), [P("a")], { onAdd });
    const b = addBtn(h);
    expect(b.textContent).toBe("Add to cart");
    b.click(); b.click(); b.click(); // impatient shopper while the request is in flight
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.disabled).toBe(false); // aria-disabled, not disabled: keyboard focus is not dropped
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(status(h)).toContain("Adding");
    resolve(); await flush();
    expect(b.textContent).toBe("Added");
    expect(status(h)).toBe("Product a was added to your cart.");
    b.click(); await flush();
    expect(onAdd).toHaveBeenCalledTimes(1); // already added
  });

  it("a failed add says so, keeps the button usable and lets the shopper retry", async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error("sold out")).mockResolvedValueOnce(undefined);
    const h = renderRecommendations(document, rec(), [P("a")], { onAdd });
    const b = addBtn(h);
    b.click(); await flush();
    expect(status(h)).toContain("Couldn't add Product a");
    expect(b.textContent).toBe("Add to cart");
    expect(b.hasAttribute("aria-disabled")).toBe(false);
    b.click(); await flush();
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(b.textContent).toBe("Added");
  });

  it("products that cannot be added here link to their page instead of pretending", () => {
    const h = renderRecommendations(document, rec(), [P("a", { addable: false }), P("b"), P("c")], { onAdd: async () => undefined, canAdd: (p) => p.id !== "c" });
    for (const i of [0, 2]) { expect(items(h)[i]!.querySelector("button")).toBeNull(); expect(items(h)[i]!.querySelectorAll("a")).toHaveLength(2); } // title + View
    expect(items(h)[1]!.querySelector("button")).not.toBeNull();
    const none = renderRecommendations(document, rec(), [P("a")], {}); // no adder at all
    expect(none.host.shadowRoot!.querySelector("button")).toBeNull();
    const off = renderRecommendations(document, rec({}, { addToCart: false }), [P("a")], { onAdd: async () => undefined });
    expect(off.host.shadowRoot!.querySelector("button")).toBeNull();
  });

  it("reports product link clicks", () => {
    const onClick = vi.fn();
    const h = renderRecommendations(document, rec(), [P("a")], { onClick });
    items(h)[0]!.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("update() replaces the products, keeps what was already added, and hides the block when empty", async () => {
    const h = renderRecommendations(document, rec(), [P("a"), P("b")], { onAdd: async () => undefined });
    addBtn(h, 0).click(); await flush();
    h.update([P("a"), P("c")]);
    expect(items(h).map((l) => l.querySelector("a")!.textContent)).toEqual(["Product a", "Product c"]);
    expect(addBtn(h, 0).textContent).toBe("Added");
    expect(addBtn(h, 1).textContent).toBe("Add to cart");
    h.update([]);
    expect(h.host.style.display).not.toBe("none"); // "a" was added by the shopper, so it stays
    const fresh = renderRecommendations(document, rec(), [P("a")], {});
    fresh.update([]);
    expect(fresh.host.style.display).toBe("none"); // nothing added, nothing offered: nothing shown
  });

  it("update() keeps a product the shopper just added even though the server now leaves it out, and keeps keyboard focus on the same button", async () => {
    const h = renderRecommendations(document, rec({}, { maxProducts: 3 }), [P("a"), P("b"), P("c")], { onAdd: async () => undefined });
    document.body.appendChild(document.createElement("button")); // something else on the page
    addBtn(h, 1).click(); await flush();
    addBtn(h, 1).focus();
    expect(rootOf(h).activeElement).toBe(addBtn(h, 1));
    h.update([P("a"), P("c"), P("d")]); // b is in the cart now, so the server no longer offers it
    expect(items(h).map((l) => l.getAttribute("data-pid"))).toEqual(["a", "b", "c"]); // b stays where it was; d is cut by the maximum
    expect(addBtn(h, 1).textContent).toBe("Added");
    expect(rootOf(h).activeElement).toBe(addBtn(h, 1)); // the repaint did not drop focus
    const other = renderRecommendations(document, rec(), [P("a"), P("b")], { onAdd: async () => undefined });
    addBtn(other, 0).focus();
    other.update([P("a"), P("b")]);
    expect(rootOf(other).activeElement).toBe(addBtn(other, 0)); // focus survives an ordinary refresh too
  });

  it("the toast placement dismisses from its button and Escape, and never takes focus", () => {
    const before = document.activeElement;
    const onDismiss = vi.fn();
    const h = renderRecommendations(document, rec({}, { placement: "toast" }), [P("a")], { onDismiss });
    expect(document.activeElement).toBe(before);
    (rootOf(h).querySelector("button[aria-label='Dismiss recommendations']") as HTMLButtonElement).click();
    rootOf(h).querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("destroy removes everything it added", () => {
    const h = renderRecommendations(document, rec(), [P("a")], {});
    h.destroy();
    expect(document.querySelector("[data-convertflow]")).toBeNull();
  });

  it("the preview path (renderCampaign) draws the same block", async () => {
    const { renderCampaign } = await import("./render");
    const h = renderCampaign(document, rec(), { onAdd: async () => undefined }, document.body, { products: [P("a")] });
    expect(h.host.shadowRoot!.querySelectorAll("li")).toHaveLength(1);
  });
});

describe("where an inline block goes", () => {
  it("prefers the merchant's marked spot (by placement), then any marked spot, then <main>, then the body", () => {
    document.body.innerHTML = `<main id="m"></main><div id="any" data-convertflow-recommendations></div><div id="cart" data-convertflow-recommendations="cart"></div>`;
    expect(recommendationMount(document, "cart").id).toBe("cart");
    expect(recommendationMount(document, "product_page").id).toBe("any");
    document.body.innerHTML = `<main id="m"></main>`;
    expect(recommendationMount(document, "cart").id).toBe("m");
    document.body.innerHTML = "";
    expect(recommendationMount(document, "cart")).toBe(document.body);
  });
});

describe("cart contents for recommendations", () => {
  it("remembers which products are in the cart from the public API and from Shopify's /cart.js, and ignores junk", async () => {
    const { createCartTracker } = await import("./cart");
    const api: Record<string, unknown> = {};
    const t = createCartTracker({ document } as unknown as Window, api);
    (api["setCart"] as (c: unknown) => void)({ subtotal: 5, productIds: ["a", "", 7, "b"] });
    expect(t.state.productIds).toEqual(["a", "b"]);
    t.destroy();

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ items_subtotal_price: 2500, item_count: 2, items: [{ product_id: 11 }, { product_id: "22" }, {}] })));
    const w = { Shopify: {}, fetch: fetchFn, location: { href: "https://shop.test/" }, document } as unknown as Window;
    const s = createCartTracker(w, {});
    await s.prime();
    expect(s.state).toEqual({ subtotal: 25, itemCount: 2, productIds: ["11", "22"] });
    s.destroy();
  });
});

describe("add-to-cart adapters", () => {
  it("shopifyVariantId accepts numeric ids and GraphQL ids, nothing else", () => {
    expect(shopifyVariantId("12345")).toBe(12345);
    expect(shopifyVariantId("gid://shopify/ProductVariant/987")).toBe(987);
    for (const bad of [undefined, "", "abc", "12a", "gid://shopify/Product/1", "1".repeat(30)]) expect(shopifyVariantId(bad)).toBeUndefined();
  });

  it("the store's own ConvertFlow.addToCart wins, receives the product and variant, and its cart state is passed on", async () => {
    const addToCart = vi.fn(async () => ({ subtotal: 30, itemCount: 2, productIds: ["a"] }));
    const w = { ConvertFlow: { addToCart }, Shopify: {}, fetch: vi.fn() } as unknown as Window;
    const a = resolveAdder(w, P("a"))!;
    expect(a.kind).toBe("custom");
    expect(a.tracked).toBe(false);
    expect(await a.add(P("a"))).toEqual({ subtotal: 30, itemCount: 2, productIds: ["a"] });
    expect(addToCart).toHaveBeenCalledWith({ productId: "a", variantId: "va", quantity: 1 });
  });

  it("Shopify: posts the variant id to the store's own cart endpoint, honours a locale root, and fails when Shopify refuses", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const w = { Shopify: { routes: { root: "/en-ca/" } }, fetch: fetchFn } as unknown as Window;
    const p = P("a", { variantId: "555" });
    const a = resolveAdder(w, p)!;
    expect(a.kind).toBe("shopify");
    expect(a.tracked).toBe(true); // the cart tracker watches this request itself
    await a.add(p);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/en-ca/cart/add.js");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ items: [{ id: 555, quantity: 1 }] });
    fetchFn.mockResolvedValueOnce(new Response("{}", { status: 422 }));
    await expect(a.add(p)).rejects.toThrow();
    expect(resolveAdder(w, P("a", { variantId: "not-numeric" }))).toBeUndefined(); // no id to add by: link to the page
    expect(resolveAdder(w, P("a", { variantId: undefined }))).toBeUndefined();
  });

  it("WooCommerce: uses the store's wc-ajax endpoint, tells the theme, and fails on Woo's error answer", async () => {
    const trigger = vi.fn();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ fragments: { x: 1 }, cart_hash: "h" }), { status: 200 }));
    const w = { wc_add_to_cart_params: { wc_ajax_url: "/?wc-ajax=%%endpoint%%" }, jQuery: () => ({ trigger }), document: { body: {} }, fetch: fetchFn } as unknown as Window;
    const a = resolveAdder(w, P("77"))!;
    expect(a.kind).toBe("woocommerce");
    await a.add(P("77"));
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/?wc-ajax=add_to_cart");
    expect(String(init.body)).toBe("product_id=77&quantity=1");
    expect(trigger).toHaveBeenCalledWith("added_to_cart", [{ x: 1 }, "h"]);
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ error: true, product_url: "/p" }), { status: 200 }));
    await expect(a.add(P("77"))).rejects.toThrow();
  });

  it("with no way to add, there is no adapter", () => {
    expect(resolveAdder({ fetch: vi.fn() } as unknown as Window, P("a"))).toBeUndefined();
  });
});

/* ---------- in the page: the SDK end to end with a fake API ---------- */

const CID = "cmp_r", VID = "ver_r";
type Ev = { type: string; campaignId?: string; group?: string };
let events: Ev[];
let recCalls: URL[];
let recAnswer: () => Response;

const storefront = (over: Record<string, unknown> = {}, recommend: Record<string, unknown> = {}, extra: Partial<StorefrontConfig> = {}): StorefrontConfig => ({
  schemaVersion: 1, siteId: "cf_x", generatedAt: "2026-10-27T00:00:00.000Z", deliveryEnabled: true, currency: "USD",
  campaigns: [{ campaignId: CID, versionId: VID, config: rec(over, recommend) }], ...extra,
});

async function start(o: { cfg: StorefrontConfig; consent?: boolean; context?: Record<string, unknown>; adder?: (i: unknown) => unknown; seedCache?: StorefrontConfig; visitorId?: string; html?: string }) {
  localStorage.clear(); sessionStorage.clear(); document.body.innerHTML = o.html ?? `<main><div data-convertflow-recommendations></div></main>`;
  window.ConvertFlow = { ...(o.consent === undefined ? {} : { consent: o.consent }), ...(o.adder ? { addToCart: o.adder as never } : {}) };
  (window as unknown as { ConvertFlowContext?: unknown }).ConvertFlowContext = o.context ?? { pageType: "product", productId: "p1" };
  if (o.seedCache) localStorage.setItem("cf:v1", JSON.stringify({ visitorImpressions: {}, dismissedAt: {}, clickedAt: {}, firstSeen: Date.now(), ...(o.visitorId ? { visitorId: o.visitorId } : {}), cfg: { at: Date.now(), v: o.seedCache } }));
  else if (o.visitorId) localStorage.setItem("cf:v1", JSON.stringify({ visitorId: o.visitorId, visitorImpressions: {}, dismissedAt: {}, clickedAt: {}, firstSeen: Date.now() }));
  events = []; recCalls = [];
  recAnswer = () => new Response(JSON.stringify({ products: [P("a"), P("b", { addable: false })], currency: "USD" }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/sdk/v1/config/")) return new Response(JSON.stringify(o.cfg));
    if (url.includes("/api/v1/recommendations")) { recCalls.push(new URL(url)); return recAnswer(); }
    events.push(...(JSON.parse(String(init?.body ?? "{}")).events ?? []));
    return new Response(null, { status: 202 });
  }));
  const s = document.createElement("script");
  s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
  boot(s);
  await new Promise((r) => setTimeout(r, 60));
}
const block = () => document.querySelector("[data-convertflow][data-tool=upsell]") as HTMLElement | null;
const blockItems = () => Array.from(block()?.shadowRoot?.querySelectorAll("li") ?? []);
const evTypes = () => events.map((e) => e.type);

describe("recommendations in the page", () => {
  it("asks the server about the live campaign and this page only, then draws the answer where the merchant marked a spot", async () => {
    await start({ cfg: storefront(), consent: true });
    expect(recCalls).toHaveLength(1);
    const q = recCalls[0]!.searchParams;
    expect(Object.fromEntries(q)).toEqual({ siteId: "cf_x", campaignId: CID, productId: "p1" }); // never the campaign's options
    expect(block()!.parentElement!.hasAttribute("data-convertflow-recommendations")).toBe(true);
    expect(blockItems()).toHaveLength(2);
    expect(evTypes()).toEqual(expect.arrayContaining(["campaign_eligible", "recommendation_impression"]));
    expect(evTypes().filter((t) => t === "recommendation_impression")).toHaveLength(1);
  });

  it("with consent a product click is recorded; without consent nothing is stored or sent but the block still works", async () => {
    await start({ cfg: storefront(), consent: true });
    blockItems()[0]!.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(evTypes()).toContain("recommendation_click");
    expect(JSON.parse(localStorage.getItem("cf:v1")!).lastClick.campaignId).toBe(CID); // a click is what purchases are attributed to

    await start({ cfg: storefront(), consent: false });
    expect(blockItems()).toHaveLength(2);
    blockItems()[0]!.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(events).toHaveLength(0);
    expect(localStorage.getItem("cf:v1")).toBeNull();
  });

  it("adds to the cart through the store's own function, tells the SDK the new cart, and records the add", async () => {
    const adder = vi.fn(async () => ({ subtotal: 55, itemCount: 3, productIds: ["a"] }));
    await start({ cfg: storefront(), consent: true, adder });
    const trackSpy = vi.spyOn(window.ConvertFlow!, "trackAddToCart");
    const btn = blockItems()[0]!.querySelector("button") as HTMLButtonElement;
    btn.click(); btn.click(); // a double click adds once
    await new Promise((r) => setTimeout(r, 30));
    expect(adder).toHaveBeenCalledTimes(1);
    expect(adder).toHaveBeenCalledWith({ productId: "a", variantId: "va", quantity: 1 });
    expect(btn.textContent).toBe("Added");
    expect(trackSpy).toHaveBeenCalledWith({ subtotal: 55, itemCount: 3, productIds: ["a"] });
    expect(evTypes()).toContain("recommendation_add_to_cart");
    expect(evTypes().filter((t) => t === "recommendation_add_to_cart")).toHaveLength(1);
  });

  it("a failed add records nothing and lets the shopper retry", async () => {
    const adder = vi.fn().mockRejectedValueOnce(new Error("no")).mockResolvedValueOnce({});
    await start({ cfg: storefront(), consent: true, adder });
    const btn = blockItems()[0]!.querySelector("button") as HTMLButtonElement;
    btn.click(); await new Promise((r) => setTimeout(r, 30));
    expect(evTypes()).not.toContain("recommendation_add_to_cart");
    expect(btn.textContent).toBe("Add to cart");
    btn.click(); await new Promise((r) => setTimeout(r, 30));
    expect(evTypes()).toContain("recommendation_add_to_cart");
  });

  it("without any way to add, products link to their page", async () => {
    await start({ cfg: storefront(), consent: true });
    expect(block()!.shadowRoot!.querySelector("button")).toBeNull();
    expect(blockItems()[0]!.textContent).toContain("View");
  });

  it("shows nothing, and counts nothing, when the server has no products or the request fails", async () => {
    await start({ cfg: storefront(), consent: true });
    document.body.innerHTML = ""; window.ConvertFlow?.destroy?.();
    events = [];
    recAnswer = () => new Response(JSON.stringify({ products: [] }));
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    document.body.innerHTML = `<main></main>`; boot(s); await new Promise((r) => setTimeout(r, 60));
    expect(block()).toBeNull();
    expect(evTypes()).not.toContain("recommendation_impression");

    window.ConvertFlow?.destroy?.(); document.body.innerHTML = `<main></main>`;
    recAnswer = () => new Response("nope", { status: 500 });
    boot(s); await new Promise((r) => setTimeout(r, 60));
    expect(block()).toBeNull();
    window.ConvertFlow?.destroy?.(); document.body.innerHTML = `<main></main>`;
    recAnswer = () => new Response(JSON.stringify({ products: [{ id: 1, title: {} }, "junk"] })); // malformed items are dropped
    boot(s); await new Promise((r) => setTimeout(r, 60));
    expect(block()).toBeNull();
  });

  it("a product-page block does nothing on other pages (and does not even ask the server)", async () => {
    await start({ cfg: storefront(), consent: true, context: { pageType: "cart" } });
    expect(recCalls).toHaveLength(0);
    expect(block()).toBeNull();
  });

  it("a cart block asks again when the cart changes, sending what it knows about the cart", async () => {
    await start({ cfg: storefront({ targeting: { match: "all", conditions: [] } }, { placement: "cart" }), consent: true, context: { pageType: "cart" } });
    expect(recCalls).toHaveLength(1);
    window.ConvertFlow!.setCart!({ subtotal: 42.5, itemCount: 2, productIds: ["a", "z"] });
    await new Promise((r) => setTimeout(r, 40));
    expect(recCalls).toHaveLength(2);
    const q = recCalls[1]!.searchParams;
    expect(q.get("subtotal")).toBe("42.5");
    expect(q.get("cart")).toBe("a,z");
    expect(document.querySelectorAll("[data-convertflow][data-tool=upsell]")).toHaveLength(1); // updated in place, not duplicated
  });

  it("a product-page block does not refetch on cart changes it does not depend on, including the shopper's own add", async () => {
    const adder = vi.fn(async () => ({ subtotal: 20, itemCount: 1, productIds: ["a"] }));
    await start({ cfg: storefront(), consent: true, adder });
    window.ConvertFlow!.setCart!({ subtotal: 10, itemCount: 1, productIds: ["z"] });
    await new Promise((r) => setTimeout(r, 40));
    expect(recCalls).toHaveLength(1);
    (blockItems()[0]!.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 60));
    expect(recCalls).toHaveLength(1); // adding did not redraw the block under the shopper
    expect(blockItems()[0]!.querySelector("button")!.textContent).toBe("Added");
  });

  it("a block disappears when a fresh config no longer includes it (paused, or the kill switch)", async () => {
    const live = storefront();
    await start({ cfg: { ...live, campaigns: [] }, consent: true, seedCache: live });
    expect(block()).toBeNull(); // the cached config drew it, then the fresh one removed it
    await start({ cfg: { ...live, deliveryEnabled: false }, consent: true, seedCache: live });
    expect(block()).toBeNull();
  });

  it("a holdout visitor is randomised and sees nothing; a treatment visitor sees it; unconsented visitors are never held out", async () => {
    const withExp = storefront({ experiment: { holdoutPercent: 50 } });
    const idIn = (g: "treatment" | "holdout") => { for (let i = 0; ; i++) if (assignGroup(`v${i}`, CID, 50) === g) return `v${i}`; };
    await start({ cfg: withExp, consent: true, visitorId: idIn("holdout") });
    expect(block()).toBeNull();
    expect(events.find((e) => e.type === "experiment_assigned")?.group).toBe("holdout");
    expect(recCalls).toHaveLength(0); // nothing is fetched for the control arm
    await start({ cfg: withExp, consent: true, visitorId: idIn("treatment") });
    expect(blockItems()).toHaveLength(2);
    await start({ cfg: withExp, consent: false });
    expect(blockItems()).toHaveLength(2);
  });

  it("the toast placement shows a floating card after its trigger, only when there are products, and records its own events", async () => {
    const toast = storefront({ trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] } }, { placement: "toast" });
    await start({ cfg: toast, consent: true, context: { pageType: "home" } });
    expect(block()!.style.position).toBe("fixed");
    expect(evTypes()).toEqual(expect.arrayContaining(["campaign_eligible", "recommendation_impression"]));
    expect(evTypes()).not.toContain("campaign_impression");
    (block()!.shadowRoot!.querySelector("button[aria-label='Dismiss recommendations']") as HTMLButtonElement).click();
    expect(block()).toBeNull();
    expect(evTypes()).toContain("campaign_dismiss");

    await start({ cfg: toast, consent: true, context: { pageType: "home" } });
    window.ConvertFlow?.destroy?.(); document.body.innerHTML = "";
    events = []; recAnswer = () => new Response(JSON.stringify({ products: [] }));
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    localStorage.clear(); sessionStorage.clear();
    boot(s); await new Promise((r) => setTimeout(r, 60));
    expect(block()).toBeNull();
    expect(evTypes()).not.toContain("recommendation_impression");
  });

  it("destroy() removes the block and stops asking", async () => {
    await start({ cfg: storefront(), consent: true });
    window.ConvertFlow!.destroy!();
    expect(block()).toBeNull();
  });
});
