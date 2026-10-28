import { remainingForFreeShipping } from "@convertflow/campaign-engine";
import type { CampaignConfig } from "@convertflow/contracts";
import type { RenderCallbacks, RenderContext, RenderHandle } from "./render";

const isSafeUrl = (u: string): boolean => (/^\/(?![\/\\])/.test(u) || /^https:\/\//i.test(u)) && !/[\u0000-\u001f\u007f\\]/.test(u);

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const n = doc.createElement(tag);
  n.style.cssText = css;
  if (text !== undefined) n.textContent = text; // textContent only: copy is never parsed as HTML
  return n;
}

const CORNER: Record<string, string> = {
  bottom_left: "bottom:16px;left:16px;", bottom_right: "bottom:16px;right:16px;",
  top_left: "top:16px;left:16px;", top_right: "top:16px;right:16px;",
};

/** Narrow screens span the width along the bottom; wider screens get a fixed-width card in the chosen corner. */
export function placementCss(corner: string, narrow: boolean): string {
  return narrow ? "left:12px;right:12px;bottom:12px;" : `${CORNER[corner] ?? CORNER["bottom_left"]!}width:340px;`;
}

/** The "N away from free shipping" sentence, from the real cart. Undefined when the gap is unknown or already closed. */
export function shippingMessage(threshold: number, ctx: RenderContext | undefined, lang?: string): string | undefined {
  const left = remainingForFreeShipping(threshold, ctx?.cartSubtotal);
  if (left === undefined) return undefined;
  let amount: string;
  try { amount = new Intl.NumberFormat(lang, { style: "currency", currency: ctx?.currency ?? "USD" }).format(left); } catch { amount = left.toFixed(2); }
  return `You're ${amount} away from free shipping.`;
}

/**
 * A small, non-blocking notification. It never covers the page, never takes focus, never traps the keyboard,
 * and announces itself politely to screen readers. Auto-dismiss pauses while the shopper hovers or focuses it.
 */
export function renderToast(doc: Document, cfg: CampaignConfig, cb: RenderCallbacks, mount: HTMLElement, ctx?: RenderContext): RenderHandle {
  const win = doc.defaultView;
  const t = cfg.toast ?? { kind: "announcement" as const, corner: "bottom_left" as const, animation: "slide" as const };
  const { style: s, creative: c } = cfg;
  const narrow = (ctx?.viewportWidth ?? win?.innerWidth ?? 1024) < 520;
  const reduceMotion = win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  const host = doc.createElement("div");
  host.setAttribute("data-convertflow", "");
  host.setAttribute("data-tool", "toast");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147482999;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });

  // Narrow screens: span the width along the bottom. Wider screens: a fixed-width card in the chosen corner.
  // Modern CSS (calc/max/env) is applied as separate assignments after a plain fallback, so a browser that does not
  // understand it still gets a sensible position instead of losing the whole declaration block.
  const place = placementCss(t.corner, narrow);
  const panel = el(doc, "div",
    `position:fixed;pointer-events:auto;box-sizing:border-box;${place}` +
    `font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:${s.background};color:${s.text};` +
    `border-radius:${s.radius}px;padding:14px 40px 14px 14px;box-shadow:0 8px 28px rgba(0,0,0,.18);border:1px solid ${s.text}1f;`);
  if (narrow) panel.style.bottom = "max(12px,env(safe-area-inset-bottom))";
  else panel.style.maxWidth = "calc(100vw - 32px)";
  panel.setAttribute("role", "status"); // polite live region: announced without interrupting, no focus change
  panel.setAttribute("aria-live", "polite");
  panel.setAttribute("aria-label", c.headline);

  const close = el(doc, "button",
    `position:absolute;top:4px;right:4px;width:36px;height:36px;border:0;background:transparent;color:${s.text};font-size:20px;line-height:1;cursor:pointer;border-radius:${Math.min(s.radius, 18)}px;`, "×");
  close.setAttribute("type", "button");
  close.setAttribute("aria-label", "Dismiss notification");
  close.addEventListener("click", () => cb.onDismiss?.());
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") cb.onDismiss?.(); };
  panel.addEventListener("keydown", onKey);

  const row = el(doc, "div", "display:flex;gap:12px;align-items:flex-start;");
  const products = c.products ?? [];
  const first = products[0];
  if (t.kind === "product_offer" && first) {
    const img = first.imageUrl && isSafeUrl(first.imageUrl)
      ? (() => { const i = el(doc, "img", `flex:none;width:56px;height:56px;object-fit:cover;border-radius:${Math.max(s.radius - 2, 0)}px;background:#0001;`); i.setAttribute("src", first.imageUrl!); i.setAttribute("alt", ""); i.setAttribute("loading", "lazy"); return i; })()
      : undefined;
    if (img) row.appendChild(img);
  }
  const col = el(doc, "div", "min-width:0;flex:1;");
  col.appendChild(el(doc, "div", "font-weight:650;margin-bottom:2px;", c.headline));
  const body = t.kind === "shipping_incentive" && t.freeShippingThreshold !== undefined
    ? shippingMessage(t.freeShippingThreshold, ctx, win?.navigator?.language) ?? c.body
    : c.body;
  if (body) col.appendChild(el(doc, "div", "opacity:.85;", body));
  if (t.kind === "product_offer" && first) col.appendChild(el(doc, "div", "opacity:.85;font-weight:600;margin-top:2px;", first.title));

  const btn = `display:inline-block;margin-top:8px;text-decoration:none;font:inherit;font-weight:600;border:0;cursor:pointer;background:${s.accent};color:${s.accentText};padding:6px 12px;border-radius:${Math.min(s.radius, 999)}px;`;

  // Coupon reveal: the code stays hidden until the shopper asks for it. The percentage comes from the guardrailed promotion.
  if (t.kind === "coupon" && cfg.promotion) {
    const promo = cfg.promotion;
    const reveal = el(doc, "button", btn, "Reveal code");
    reveal.setAttribute("type", "button");
    reveal.addEventListener("click", () => {
      const line = el(doc, "div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;");
      line.setAttribute("role", "group");
      line.appendChild(el(doc, "span", "font-weight:700;", `${promo.label ?? "Use code"} · ${promo.percentOff}% off`));
      line.appendChild(el(doc, "code", `font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px dashed ${s.text};border-radius:6px;padding:3px 8px;`, promo.code));
      const copy = el(doc, "button", `font:inherit;font-size:12px;border:1px solid ${s.text};background:transparent;color:inherit;border-radius:6px;padding:3px 8px;cursor:pointer;`, "Copy");
      copy.setAttribute("type", "button");
      copy.setAttribute("aria-label", `Copy code ${promo.code}`);
      copy.addEventListener("click", () => { void (win?.navigator.clipboard?.writeText(promo.code) ?? Promise.reject()).then(() => { copy.textContent = "Copied"; }, () => { copy.textContent = "Select and copy"; }); });
      line.appendChild(copy);
      reveal.replaceWith(line);
      cb.onClick?.(); // revealing a coupon is real engagement
    });
    col.appendChild(reveal);
  } else {
    const cta = el(doc, "a", btn, c.ctaLabel);
    cta.setAttribute("href", isSafeUrl(c.ctaUrl) ? c.ctaUrl : "#"); // defence in depth: never trust a config at render time
    cta.setAttribute("rel", "noopener noreferrer");
    cta.addEventListener("click", () => cb.onClick?.());
    col.appendChild(cta);
  }

  row.appendChild(col);
  panel.append(row, close);
  root.appendChild(panel);
  mount.appendChild(host);

  if (!reduceMotion && t.animation !== "none" && typeof panel.animate === "function") {
    const from = t.animation === "slide" ? { opacity: 0, transform: `translateY(${t.corner.startsWith("top") ? "-" : ""}12px)` } : { opacity: 0 };
    try { panel.animate([from, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" }); } catch { /* animation is decoration */ }
  }

  // Auto-dismiss, paused while the shopper is hovering or focused inside (WCAG 2.2.1: they need time to read and act).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = (t.durationSeconds ?? 0) * 1000;
  let startedAt = 0;
  const start = (): void => {
    if (!t.durationSeconds || remaining <= 0) return;
    startedAt = Date.now();
    timer = setTimeout(() => cb.onAutoDismiss?.(), remaining);
  };
  const pause = (): void => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; remaining -= Date.now() - startedAt; } };
  panel.addEventListener("mouseenter", pause);
  panel.addEventListener("mouseleave", start);
  panel.addEventListener("focusin", pause);
  panel.addEventListener("focusout", start);
  start();

  return {
    host,
    destroy: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined; remaining = 0;
      panel.removeEventListener("keydown", onKey);
      panel.removeEventListener("mouseenter", pause); panel.removeEventListener("mouseleave", start);
      panel.removeEventListener("focusin", pause); panel.removeEventListener("focusout", start);
      host.remove();
    },
  };
}
