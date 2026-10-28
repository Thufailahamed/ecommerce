// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignConfig } from "@convertflow/contracts";
import { renderCampaign } from "./render";
import { placementCss, shippingMessage } from "./toast";

const make = (over: Record<string, unknown> = {}, toast: Record<string, unknown> = {}) => CampaignConfig.parse({
  schemaVersion: 1, name: "t", tool: "toast", format: "toast",
  creative: { headline: "Free shipping over $75", body: "On every order.", ctaLabel: "Shop now", ctaUrl: "/collections/all" },
  style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" },
  toast, ...over,
});
const root = () => document.querySelector("[data-convertflow]")!.shadowRoot!;
const panel = () => root().querySelector("[role=status]") as HTMLElement;

beforeEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true }); });

describe("toast accessibility and behaviour", () => {
  it("is a polite live region that never takes focus or blocks the page", () => {
    const button = document.createElement("button"); document.body.appendChild(button); button.focus();
    renderCampaign(document, make(), {});
    expect(document.activeElement).toBe(button); // focus untouched
    expect(panel().getAttribute("aria-live")).toBe("polite");
    expect(panel().getAttribute("aria-modal")).toBeNull();
    expect(root().querySelector("[role=dialog]")).toBeNull();
    const host = document.querySelector("[data-convertflow]") as HTMLElement;
    expect(host.style.pointerEvents).toBe("none"); // the page underneath stays usable
  });

  it("has an accessible dismiss button, and Escape dismisses too", () => {
    const onDismiss = vi.fn();
    renderCampaign(document, make(), { onDismiss });
    const close = root().querySelector("button[aria-label='Dismiss notification']") as HTMLButtonElement;
    expect(close).toBeTruthy();
    expect(close.type).toBe("button");
    close.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("renders merchant copy as text only and re-checks URLs at render time", () => {
    const cfg = make({ creative: { headline: "<img src=x onerror=alert(1)>", body: "<b>hi</b>", ctaLabel: "Go", ctaUrl: "/ok" } });
    renderCampaign(document, cfg, {});
    expect(root().querySelector("img")).toBeNull();
    expect(root().querySelector("b")).toBeNull();
    expect(panel().textContent).toContain("<img src=x onerror=alert(1)>");
    // A config that slipped past validation still cannot produce a javascript: link.
    const evil = { ...cfg, creative: { ...cfg.creative, ctaUrl: "javascript:alert(1)" } };
    document.body.innerHTML = "";
    renderCampaign(document, evil, {});
    expect(root().querySelector("a")!.getAttribute("href")).toBe("#");
  });

  it("CTA click reports engagement and never mutates the link", () => {
    const onClick = vi.fn();
    renderCampaign(document, make(), { onClick });
    const a = root().querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/collections/all");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    a.addEventListener("click", (e) => e.preventDefault());
    a.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("positions in the chosen corner on wide screens and spans the bottom on narrow ones", () => {
    expect(placementCss("top_right", false)).toBe("top:16px;right:16px;width:340px;");
    expect(placementCss("bottom_left", false)).toBe("bottom:16px;left:16px;width:340px;");
    expect(placementCss("top_left", false)).toContain("top:16px;left:16px;");
    expect(placementCss("bottom_right", false)).toContain("bottom:16px;right:16px;");
    expect(placementCss("top_right", true)).toBe("left:12px;right:12px;bottom:12px;");
    expect(placementCss("nonsense", false)).toContain("bottom:16px;left:16px;"); // an unknown corner falls back safely
    // Real layout is asserted in the browser e2e: jsdom cannot parse modern CSS reliably.
  });

  it("skips animation when the shopper prefers reduced motion, and animates otherwise", () => {
    const animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    renderCampaign(document, make(), {});
    expect(animate).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    renderCampaign(document, make(), {});
    expect(animate).toHaveBeenCalledTimes(1);
    document.body.innerHTML = "";
    animate.mockClear();
    renderCampaign(document, make({}, { animation: "none" }), {});
    expect(animate).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });
});

describe("auto-dismiss", () => {
  it("fires once after the duration, as an auto-dismiss and not a dismissal", () => {
    vi.useFakeTimers();
    const onAutoDismiss = vi.fn(), onDismiss = vi.fn();
    renderCampaign(document, make({}, { durationSeconds: 8 }), { onAutoDismiss, onDismiss });
    vi.advanceTimersByTime(7_999);
    expect(onAutoDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAutoDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
  it("stays until dismissed when no duration is set", () => {
    vi.useFakeTimers();
    const onAutoDismiss = vi.fn();
    renderCampaign(document, make(), { onAutoDismiss });
    vi.advanceTimersByTime(10 * 60_000);
    expect(onAutoDismiss).not.toHaveBeenCalled();
  });
  it("pauses while hovered or focused so the shopper has time to act, then resumes with the time left", () => {
    vi.useFakeTimers();
    const onAutoDismiss = vi.fn();
    renderCampaign(document, make({}, { durationSeconds: 10 }), { onAutoDismiss });
    vi.advanceTimersByTime(6_000);
    panel().dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(60_000); // hovering for a minute: still here
    expect(onAutoDismiss).not.toHaveBeenCalled();
    panel().dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(3_999);
    expect(onAutoDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAutoDismiss).toHaveBeenCalledTimes(1);
  });
  it("destroy cancels the timer: nothing fires after removal", () => {
    vi.useFakeTimers();
    const onAutoDismiss = vi.fn();
    const h = renderCampaign(document, make({}, { durationSeconds: 5 }), { onAutoDismiss });
    h.destroy();
    expect(document.querySelector("[data-convertflow]")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(onAutoDismiss).not.toHaveBeenCalled();
  });
});

describe("toast kinds", () => {
  it("product offer shows the picked product's image and title, and skips unsafe images", () => {
    const products = [{ title: "Trail Runner", url: "/products/trail", imageUrl: "https://cdn.example.com/a.jpg" }];
    renderCampaign(document, make({ creative: { headline: "Just for you", ctaLabel: "View", ctaUrl: "/products/trail", products } }, { kind: "product_offer" }), {});
    expect(panel().textContent).toContain("Trail Runner");
    expect(root().querySelector("img")!.getAttribute("src")).toBe("https://cdn.example.com/a.jpg");
    document.body.innerHTML = "";
    const bad = [{ title: "X", url: "/p", imageUrl: "/ok.jpg" }];
    renderCampaign(document, { ...make({}, { kind: "product_offer" }), creative: { headline: "H", body: "", ctaLabel: "Go", ctaUrl: "/p", products: [{ ...bad[0]!, imageUrl: "javascript:alert(1)" }] } }, {});
    expect(root().querySelector("img")).toBeNull();
  });

  it("coupon hides the code until revealed, counts the reveal as engagement, then offers copy", () => {
    const onClick = vi.fn();
    renderCampaign(document, make({ promotion: { code: "SAVE10", percentOff: 10 } }, { kind: "coupon" }), { onClick });
    expect(panel().textContent).not.toContain("SAVE10");
    (root().querySelector("button:not([aria-label])") as HTMLButtonElement).click();
    expect(panel().textContent).toContain("SAVE10");
    expect(panel().textContent).toContain("10% off");
    expect(root().querySelector("button[aria-label='Copy code SAVE10']")).toBeTruthy();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("coupon without a configured promotion degrades to a plain announcement and never invents a code", () => {
    renderCampaign(document, make({}, { kind: "coupon" }), {});
    expect(root().querySelector("a")!.textContent).toBe("Shop now");
    expect(panel().textContent).not.toMatch(/off/i);
  });

  it("shipping incentive states the real remaining amount in the store currency", () => {
    renderCampaign(document, make({}, { kind: "shipping_incentive", freeShippingThreshold: 75 }), {}, document.body, { cartSubtotal: 60, currency: "USD" });
    expect(panel().textContent).toContain("$15.00 away from free shipping");
    expect(panel().textContent).not.toContain("On every order."); // computed text replaces the generic copy
  });

  it("shipping incentive with no known cart falls back to the merchant's own copy rather than inventing a gap", () => {
    renderCampaign(document, make({}, { kind: "shipping_incentive", freeShippingThreshold: 75 }), {});
    expect(panel().textContent).toContain("On every order.");
    expect(panel().textContent).not.toContain("away");
  });
});

describe("shippingMessage", () => {
  it("formats in the given currency and rounds the gap up to the next cent", () => {
    expect(shippingMessage(75, { cartSubtotal: 60, currency: "USD" }, "en-US")).toBe("You're $15.00 away from free shipping.");
    expect(shippingMessage(75, { cartSubtotal: 74.991, currency: "USD" }, "en-US")).toBe("You're $0.01 away from free shipping.");
    expect(shippingMessage(75, { cartSubtotal: 60, currency: "EUR" }, "en-US")).toBe("You're €15.00 away from free shipping.");
  });
  it("returns nothing when the cart is unknown or already qualifies", () => {
    expect(shippingMessage(75, undefined)).toBeUndefined();
    expect(shippingMessage(75, {})).toBeUndefined();
    expect(shippingMessage(75, { cartSubtotal: 75 })).toBeUndefined();
  });
  it("survives an invalid currency code", () => {
    expect(shippingMessage(75, { cartSubtotal: 60, currency: "ZZZZ" })).toContain("15.00");
  });
});
