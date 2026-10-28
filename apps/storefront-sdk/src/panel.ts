import type { CampaignConfig } from "@convertflow/contracts";
import type { RenderCallbacks } from "./render";

/** Pieces shared by the core renderer (popup, slide-in, bar, restock) and the signup-form chunk, so the two look identical. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isSafeUrl = (u: string): boolean => (/^\/(?![\/\\])/.test(u) || /^https:\/\//i.test(u)) && !/[\u0000-\u001f\u007f\\]/.test(u);

const POSITION: Record<string, string> = {
  center: "top:50%;left:50%;transform:translate(-50%,-50%);",
  bottom_right: "bottom:16px;right:16px;",
  bottom_left: "bottom:16px;left:16px;",
  top: "top:0;left:0;right:0;",
  bottom: "bottom:0;left:0;right:0;",
};

export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const n = doc.createElement(tag);
  n.style.cssText = css;
  if (text !== undefined) n.textContent = text; // textContent only: copy is never parsed as HTML
  return n;
}

export interface Shell {
  host: HTMLElement;
  root: ShadowRoot;
  panel: HTMLElement;
  /** Absent on an inline block, which is part of the page and is not dismissed. */
  close: HTMLElement | undefined;
  btnCss: string;
  bar: boolean;
  inline: boolean;
}

/**
 * The frame every popup-style campaign shares: host, backdrop, panel, close button, headline and body copy, the
 * hand-picked product cards and (unless `promotion: false`) the discount row. The caller adds its own call to action
 * or form, then appends `panel` to `root` and the host to the page.
 */
export function shell(doc: Document, cfg: CampaignConfig, cb: RenderCallbacks, o: { promotion: boolean }): Shell {
  const host = doc.createElement("div");
  host.setAttribute("data-convertflow", "");
  const inline = cfg.format === "inline";
  host.style.cssText = inline ? "all:initial;display:block;" : "all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });
  const { style: s, creative: c, format } = cfg;

  const bar = format === "announcement_bar";
  const type = "font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";
  const panelCss = inline
    ? `box-sizing:border-box;${type}background:${s.background};color:${s.text};border-radius:${s.radius}px;padding:24px;width:100%;max-width:480px;margin:16px auto;border:1px solid ${s.text}22;`
    : `position:fixed;pointer-events:auto;box-sizing:border-box;${type}` +
      `background:${s.background};color:${s.text};border-radius:${bar ? 0 : s.radius}px;` +
      (bar ? `${s.placement === "bottom" ? "bottom:0" : "top:0"};left:0;right:0;padding:10px 44px 10px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;`
           : `${POSITION[(format === "slide_in" || format === "restock") && s.placement === "center" ? "bottom_right" : s.placement] ?? POSITION["center"]}width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:24px;box-shadow:0 12px 40px rgba(0,0,0,.22);`);

  const panel = el(doc, "div", panelCss);
  panel.setAttribute("role", format === "popup" || format === "restock" ? "dialog" : "region");
  panel.setAttribute("aria-label", c.headline);
  if (format === "popup") panel.setAttribute("aria-modal", "false");

  if (format === "popup") {
    const backdrop = el(doc, "div", "position:fixed;inset:0;background:rgba(0,0,0,.45);pointer-events:auto;");
    backdrop.addEventListener("click", () => cb.onDismiss?.());
    root.appendChild(backdrop);
  }

  let close: HTMLElement | undefined;
  if (!inline) {
    close = el(doc, "button", `position:absolute;top:${bar ? 6 : 8}px;right:8px;width:28px;height:28px;border:0;background:transparent;color:${s.text};font-size:18px;line-height:1;cursor:pointer;`, "×");
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => cb.onDismiss?.());
  }

  panel.appendChild(el(doc, "div", `font-weight:650;${bar ? "" : "font-size:20px;margin-bottom:8px;"}`, c.headline));
  if (c.body) panel.appendChild(el(doc, "div", bar ? "opacity:.85;" : "opacity:.85;margin-bottom:16px;", c.body));

  const btnCss = `display:inline-block;text-decoration:none;font:inherit;font-weight:600;border:0;cursor:pointer;background:${s.accent};color:${s.accentText};padding:${bar ? "6px 14px" : "10px 18px"};border-radius:${Math.min(s.radius, 999)}px;`;

  // Hand-picked products: title, link and image only. Never price or stock, which go stale in a published snapshot.
  if (!bar && c.products?.length) {
    const grid = el(doc, "div", `display:grid;grid-template-columns:repeat(${c.products.length},1fr);gap:8px;margin-bottom:16px;`);
    for (const p of c.products) {
      const card = el(doc, "a", `display:block;text-decoration:none;color:inherit;border:1px solid ${s.text}22;border-radius:${Math.max(s.radius - 2, 0)}px;overflow:hidden;`);
      card.setAttribute("href", isSafeUrl(p.url) ? p.url : "#");
      card.setAttribute("rel", "noopener noreferrer");
      if (p.imageUrl && isSafeUrl(p.imageUrl)) {
        const img = el(doc, "img", "display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#0001;");
        img.setAttribute("src", p.imageUrl); img.setAttribute("alt", ""); img.setAttribute("loading", "lazy");
        card.appendChild(img);
      }
      card.appendChild(el(doc, "div", "padding:6px 8px;font-size:12px;font-weight:600;line-height:1.3;", p.title));
      card.addEventListener("click", () => cb.onClick?.());
      grid.appendChild(card);
    }
    panel.appendChild(grid);
  }

  // A discount the merchant configured: shown as text with a copy button. Percent is rendered from a number.
  if (o.promotion && cfg.promotion) {
    const row = el(doc, "div", `display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:${bar ? 0 : 16}px;`);
    row.appendChild(el(doc, "span", "font-weight:700;", `${cfg.promotion.label ?? "Use code"} · ${cfg.promotion.percentOff}% off`));
    const code = el(doc, "code", `font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px dashed ${s.text};border-radius:6px;padding:3px 8px;`, cfg.promotion.code);
    const copy = el(doc, "button", `font:inherit;font-size:12px;border:1px solid ${s.text};background:transparent;color:inherit;border-radius:6px;padding:3px 8px;cursor:pointer;`, "Copy");
    copy.setAttribute("type", "button");
    copy.setAttribute("aria-label", `Copy code ${cfg.promotion.code}`);
    copy.addEventListener("click", () => {
      void (doc.defaultView?.navigator.clipboard?.writeText(cfg.promotion!.code) ?? Promise.reject()).then(() => { copy.textContent = "Copied"; }, () => { copy.textContent = "Select and copy"; });
    });
    row.append(code, copy);
    panel.appendChild(row);
  }

  return { host, root, panel, close, btnCss, bar, inline };
}
