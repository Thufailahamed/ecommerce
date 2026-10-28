// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CampaignConfig } from "@convertflow/contracts";
import { renderCampaign } from "./render";
import { pageTypeFromPath, deviceFromWidth } from "./detect";

const cfg = (creative: Record<string, unknown> = {}, format = "popup") =>
  CampaignConfig.parse({
    schemaVersion: 1, name: "t", format,
    creative: { headline: "Hello", ctaLabel: "Go", ctaUrl: "/collections/all", ...creative },
    style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] },
    frequency: {}, goal: { type: "clicks" },
  });

describe("renderCampaign", () => {
  it("renders copy as text, never as HTML", () => {
    const h = renderCampaign(document, cfg({ headline: "<img src=x onerror=alert(1)>" }));
    const root = h.host.shadowRoot!;
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    h.destroy();
    expect(document.querySelector("[data-convertflow]")).toBeNull();
  });
  it("fires callbacks and supports all formats", () => {
    for (const f of ["popup", "slide_in", "announcement_bar"]) {
      const onDismiss = vi.fn(), onClick = vi.fn();
      const h = renderCampaign(document, cfg({}, f), { onDismiss, onClick });
      h.host.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
      h.host.shadowRoot!.querySelector<HTMLAnchorElement>("a")!.click();
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onClick).toHaveBeenCalledOnce();
      h.destroy();
    }
  });
  it("neutralises an unsafe href at render time", () => {
    for (const ctaUrl of ["javascript:alert(1)", "/\\evil.com", "//evil.com", "/a\nb", "data:text/html,x"]) {
      const bad = { ...cfg(), creative: { ...cfg().creative, ctaUrl } };
      const h = renderCampaign(document, bad);
      expect(h.host.shadowRoot!.querySelector("a")!.getAttribute("href"), ctaUrl).toBe("#");
      h.destroy();
    }
  });
});

describe("product picks and promotions", () => {
  it("renders hand-picked products as safe links and ignores unsafe image URLs", () => {
    // Built directly (not parsed): the schema would reject the unsafe URLs, and this tests the renderer's own last line of defence.
    const base = cfg();
    const c = { ...base, creative: { ...base.creative, products: [
      { title: "Trail Runner", url: "/products/trail", imageUrl: "https://cdn.example.com/a.png" },
      { title: "<b>Bold</b>", url: "javascript:alert(1)", imageUrl: "javascript:alert(2)" },
    ] } };
    const h = renderCampaign(document, c);
    const links = Array.from(h.host.shadowRoot!.querySelectorAll("a")).filter((a) => a.textContent !== "Go");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/products/trail", "#"]);
    const imgs = h.host.shadowRoot!.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute("src")).toBe("https://cdn.example.com/a.png");
    expect(h.host.shadowRoot!.querySelector("b")).toBeNull(); // title is text, never HTML
    h.destroy();
  });
  it("renders a promotion from numbers and text only, with a copy button", () => {
    const c = { ...cfg(), promotion: { code: "SPRING20", percentOff: 20, label: "Spring" } };
    const h = renderCampaign(document, c);
    const root = h.host.shadowRoot!;
    expect(root.textContent).toContain("Spring · 20% off");
    expect(root.querySelector("code")!.textContent).toBe("SPRING20");
    expect(root.querySelector("button[aria-label='Copy code SPRING20']")).not.toBeNull();
    h.destroy();
  });
  it("restock format renders an email form with an accessible label instead of a link", () => {
    const h = renderCampaign(document, cfg({}, "restock"));
    const root = h.host.shadowRoot!;
    expect(root.querySelector("input[type=email]")!.getAttribute("aria-label")).toBe("Email address");
    expect(root.querySelector("form button[type=submit]")!.textContent).toBe("Go");
    expect(root.querySelector("[role=status]")).not.toBeNull();
    h.destroy();
  });
});

describe("email signup form", () => {
  const CONSENT = "I agree to receive marketing emails from this store. Unsubscribe any time.";
  const formCfg = (form: Record<string, unknown> = {}, format = "popup") => CampaignConfig.parse({
    schemaVersion: 1, name: "t", tool: "email", format,
    creative: { headline: "Join us", body: "Offers and news.", ctaLabel: "Sign up", ctaUrl: "/" },
    style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" },
    form: { collect: { email: true }, consentText: CONSENT, privacyUrl: "/policies/privacy-policy", ...form },
  });
  const parts = (cf: CampaignConfig, cb = {}) => {
    const h = renderCampaign(document, cf, cb);
    const root = h.host.shadowRoot!;
    const form = root.querySelector("form")!;
    return {
      h, root, form,
      input: root.querySelector<HTMLInputElement>("input[type=email]")!,
      box: root.querySelector<HTMLInputElement>("input[type=checkbox]")!,
      status: () => root.querySelector("[role=status]")?.textContent ?? "",
      submit: () => form.dispatchEvent(new Event("submit", { cancelable: true })),
    };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("renders an email field, an unticked consent box with the exact words, a privacy link and a submit button, in popup and slide-in", () => {
    for (const format of ["popup", "slide_in"]) {
      const p = parts(formCfg({}, format));
      expect(p.input.getAttribute("aria-label")).toBe("Email address");
      expect(p.box.checked).toBe(false); // never pre-ticked
      expect(p.root.querySelector("label")!.textContent).toBe(CONSENT);
      expect(p.root.querySelector<HTMLAnchorElement>("a[href='/policies/privacy-policy']")!.getAttribute("rel")).toContain("noopener");
      expect(p.root.querySelector("form button[type=submit]")!.textContent).toBe("Sign up");
      expect(p.root.querySelector("a[href='/']")).toBeNull(); // no plain CTA link: the form replaces it
      p.h.destroy();
    }
  });

  it("will not submit an invalid address or an unticked box, and tells the shopper why", () => {
    const onSignup = vi.fn();
    const p = parts(formCfg(), { onSignup });
    p.input.value = "nope"; p.submit();
    expect(p.status()).toMatch(/valid email/i);
    p.input.value = "a@example.com"; p.submit();
    expect(p.status()).toMatch(/tick the box/i);
    expect(onSignup).not.toHaveBeenCalled();
    p.h.destroy();
  });

  it("submits the trimmed address once the box is ticked and then shows the confirm-by-email message", async () => {
    const onSignup = vi.fn(async () => undefined);
    const p = parts(formCfg({ pendingMessage: "Check your inbox to confirm." }), { onSignup });
    p.input.value = "  a@example.com "; p.box.checked = true; p.submit();
    await tick();
    expect(onSignup).toHaveBeenCalledExactlyOnceWith("a@example.com");
    expect(p.root.querySelector("form")!.querySelector("input")).toBeNull();
    expect(p.status()).toBe("Check your inbox to confirm.");
    p.h.destroy();
  });

  it("a failed signup keeps the form, shows an error and allows another try", async () => {
    const onSignup = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(undefined);
    const p = parts(formCfg(), { onSignup });
    p.input.value = "a@example.com"; p.box.checked = true; p.submit();
    await tick();
    expect(p.status()).toMatch(/went wrong/i);
    expect(p.root.querySelector("button[type=submit]")!.hasAttribute("disabled")).toBe(false);
    p.submit(); await tick();
    expect(onSignup).toHaveBeenCalledTimes(2);
    p.h.destroy();
  });

  it("renders consent words as text and drops an unsafe privacy link at render time", () => {
    const evil = "I agree <img src=x onerror=alert(1)> to marketing emails from this store.";
    const cf = formCfg({ consentText: evil });
    const unsafe = { ...cf, form: { ...cf.form!, privacyUrl: "javascript:alert(1)" } } as CampaignConfig; // the contract rejects this; the renderer must not trust it anyway
    const p = parts(unsafe);
    expect(p.root.querySelector("img")).toBeNull();
    expect(p.root.querySelector("label")!.textContent).toBe(evil);
    expect(p.root.querySelector("a[href^='javascript']")).toBeNull();
    p.h.destroy();
  });
});

describe("detect", () => {
  it("classifies common platform URLs", () => {
    expect(pageTypeFromPath("/")).toBe("home");
    expect(pageTypeFromPath("/products/blue-shoe")).toBe("product");
    expect(pageTypeFromPath("/product/blue-shoe/")).toBe("product");
    expect(pageTypeFromPath("/collections/shoes")).toBe("collection");
    expect(pageTypeFromPath("/product-category/shoes")).toBe("collection");
    expect(pageTypeFromPath("/cart")).toBe("cart");
    expect(pageTypeFromPath("/checkouts/abc")).toBe("checkout");
    expect(deviceFromWidth(390)).toBe("mobile");
    expect(deviceFromWidth(1440)).toBe("desktop");
  });
});
