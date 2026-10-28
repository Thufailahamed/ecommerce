import type { CampaignConfig } from "@convertflow/contracts";
import type { RenderContext, RenderHandle } from "./render";
import { placementCss } from "./toast";

/** A product the server chose. The renderer shows it and reports what the shopper does; it never talks to the network. */
export interface RecProduct {
  id: string;
  title: string;
  url: string;
  imageUrl?: string | undefined;
  price?: number | undefined;
  variantId?: string | undefined;
  /** False when the shopper has to choose options first: the button then opens the product page instead. */
  addable: boolean;
}

export interface RecCallbacks {
  /** The shopper followed a product link. */
  onClick?: (p: RecProduct) => void;
  /** Add one of this product to the cart. Resolve when it is in the cart, reject when it is not. Absent: adding is not possible here, so products link to their page. */
  onAdd?: (p: RecProduct) => Promise<void>;
  /** Whether this particular product can be added here (a platform may need an id the product lacks). Default: yes whenever onAdd exists. */
  canAdd?: (p: RecProduct) => boolean;
  /** Floating (toast placement) only. */
  onDismiss?: () => void;
}

export interface RecHandle extends RenderHandle {
  update(products: RecProduct[]): void;
}

const isSafeUrl = (u: string): boolean => (/^\/(?![\/\\])/.test(u) || /^https:\/\//i.test(u)) && !/[\u0000-\u001f\u007f\\]/.test(u);

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const n = doc.createElement(tag);
  n.style.cssText = css;
  if (text !== undefined) n.textContent = text; // textContent only: copy is never parsed as HTML
  return n;
}

/**
 * Where an inline block goes: a spot the merchant marked with data-convertflow-recommendations (optionally the placement
 * name, "product_page" or "cart"), else the end of <main>, else the end of the page.
 */
export function recommendationMount(doc: Document, placement: string): HTMLElement {
  return (doc.querySelector(`[data-convertflow-recommendations="${placement}"]`) ?? doc.querySelector("[data-convertflow-recommendations]") ?? doc.querySelector("main") ?? doc.body) as HTMLElement;
}

/**
 * Product recommendations as a row, grid or list. Inline placements are part of the page; the toast placement is a small
 * floating card that never takes focus. Every product is a real link; the add button reports success or failure, ignores
 * repeated clicks while a request is in flight, and stays "Added" once it worked so the same product is not added twice by accident.
 */
export function renderRecommendations(doc: Document, cfg: CampaignConfig, initial: RecProduct[], cb: RecCallbacks = {}, mount: HTMLElement = doc.body, ctx?: RenderContext): RecHandle {
  const win = doc.defaultView;
  const o = cfg.recommend;
  const { style: s, creative: c } = cfg;
  const floating = o?.placement === "toast";
  const layout = floating ? "list" : (o?.layout ?? "row"); // a corner card is too small for a row or a grid
  const max = o?.maxProducts ?? 3;
  const narrow = (ctx?.viewportWidth ?? win?.innerWidth ?? 1024) < 520;
  let items = initial.slice(0, max);
  const busy = new Set<string>();
  const added = new Set<string>();

  const host = doc.createElement("div");
  host.setAttribute("data-convertflow", "");
  host.setAttribute("data-tool", "upsell");
  host.style.cssText = floating ? "all:initial;position:fixed;inset:0;z-index:2147482997;pointer-events:none;" : "all:initial;display:block;";
  const root = host.attachShadow({ mode: "open" });

  const base = "font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-sizing:border-box;";
  const panel = el(doc, "section", floating
    ? `${base}position:fixed;pointer-events:auto;${placementCss("bottom_left", narrow)}background:${s.background};color:${s.text};border-radius:${s.radius}px;padding:14px 40px 14px 14px;box-shadow:0 8px 28px rgba(0,0,0,.18);border:1px solid ${s.text}1f;max-height:min(70vh,520px);overflow:auto;`
    : `${base}display:block;width:100%;background:${s.background};color:${s.text};border-radius:${s.radius}px;padding:16px;border:1px solid ${s.text}1f;margin:16px 0;`);
  if (floating) { if (narrow) panel.style.bottom = "max(12px,env(safe-area-inset-bottom))"; else panel.style.maxWidth = "calc(100vw - 32px)"; }
  panel.setAttribute("aria-label", c.headline);

  const heading = el(doc, "h2", "margin:0 0 4px;font-size:16px;font-weight:650;line-height:1.3;", c.headline);
  const body = c.body ? el(doc, "p", "margin:0 0 10px;opacity:.85;", c.body) : undefined;
  const list = el(doc, "ul", layout === "row"
    ? "list-style:none;margin:8px 0 0;padding:0 0 4px;display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x proximity;"
    : layout === "grid"
      ? "list-style:none;margin:8px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;"
      : "list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px;");
  list.setAttribute("data-layout", layout);
  const status = el(doc, "div", "font-size:12px;min-height:1em;margin-top:6px;");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(heading);
  if (body) panel.append(body);
  panel.append(list, status);

  let close: HTMLButtonElement | undefined;
  let onKey: ((e: KeyboardEvent) => void) | undefined;
  if (floating) {
    close = el(doc, "button", `position:absolute;top:4px;right:4px;width:36px;height:36px;border:0;background:transparent;color:${s.text};font-size:20px;line-height:1;cursor:pointer;`, "×");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Dismiss recommendations");
    close.addEventListener("click", () => cb.onDismiss?.());
    onKey = (e) => { if (e.key === "Escape") cb.onDismiss?.(); };
    panel.addEventListener("keydown", onKey);
    panel.append(close);
  }
  root.appendChild(panel);

  const money = (n: number): string => {
    try { return new Intl.NumberFormat(win?.navigator?.language, { style: "currency", currency: ctx?.currency ?? "USD" }).format(n); } catch { return n.toFixed(2); }
  };
  const say = (msg: string): void => { status.textContent = msg; };
  const btnCss = `display:inline-block;text-align:center;text-decoration:none;font:inherit;font-weight:600;border:0;cursor:pointer;background:${s.accent};color:${s.accentText};padding:7px 12px;border-radius:${Math.min(s.radius, 999)}px;`;
  const addEnabled = o?.addToCart !== false && typeof cb.onAdd === "function";

  const card = (p: RecProduct): HTMLElement => {
    const li = el(doc, "li", `${layout === "list" ? "display:flex;gap:10px;align-items:center;" : `display:flex;flex-direction:column;gap:6px;${layout === "row" ? "flex:0 0 160px;scroll-snap-align:start;" : ""}`}` +
      `border:1px solid ${s.text}22;border-radius:${Math.max(s.radius - 2, 0)}px;padding:8px;background:${s.background};`);
    li.setAttribute("data-pid", p.id);
    if (p.imageUrl && isSafeUrl(p.imageUrl)) {
      const img = el(doc, "img", layout === "list"
        ? `flex:none;width:56px;height:56px;object-fit:cover;border-radius:${Math.max(s.radius - 4, 0)}px;background:#0001;`
        : `display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:${Math.max(s.radius - 4, 0)}px;background:#0001;`);
      img.setAttribute("src", p.imageUrl); img.setAttribute("alt", ""); img.setAttribute("loading", "lazy");
      li.appendChild(img);
    }
    const info = el(doc, "div", "min-width:0;flex:1;display:flex;flex-direction:column;gap:4px;");
    const link = el(doc, "a", "color:inherit;font-weight:600;line-height:1.3;text-decoration:underline;text-underline-offset:2px;", p.title);
    link.setAttribute("href", isSafeUrl(p.url) ? p.url : "#"); // defence in depth: never trust a response at render time
    link.setAttribute("rel", "noopener noreferrer");
    link.addEventListener("click", () => cb.onClick?.(p));
    info.appendChild(link);
    if (o?.showPrice !== false && typeof p.price === "number") info.appendChild(el(doc, "div", "opacity:.85;", money(p.price)));

    if (addEnabled && p.addable && (cb.canAdd?.(p) ?? true)) {
      const btn = el(doc, "button", btnCss, added.has(p.id) ? "Added" : c.ctaLabel);
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-label", `${added.has(p.id) ? "Added" : c.ctaLabel}: ${p.title}`);
      if (added.has(p.id)) { btn.setAttribute("aria-disabled", "true"); btn.style.opacity = ".7"; btn.style.cursor = "default"; }
      // aria-disabled (not disabled) while busy: the button keeps keyboard focus, so a screen-reader user is not dropped to the page start.
      btn.addEventListener("click", () => {
        if (busy.has(p.id) || added.has(p.id)) return; // a second click while adding, or after it worked, does nothing
        busy.add(p.id);
        btn.setAttribute("aria-disabled", "true"); btn.setAttribute("aria-busy", "true"); btn.style.opacity = ".7"; btn.textContent = "Adding…";
        say(`Adding ${p.title}…`);
        let pending: Promise<void>;
        try { pending = Promise.resolve(cb.onAdd!(p)); } catch (e) { pending = Promise.reject(e); } // called within the click, so the browser still treats it as the shopper's gesture
        void pending.then(
          () => { busy.delete(p.id); added.add(p.id); btn.removeAttribute("aria-busy"); btn.textContent = "Added"; btn.setAttribute("aria-label", `Added: ${p.title}`); btn.style.cursor = "default"; say(`${p.title} was added to your cart.`); },
          () => { busy.delete(p.id); btn.removeAttribute("aria-disabled"); btn.removeAttribute("aria-busy"); btn.style.opacity = ""; btn.textContent = c.ctaLabel; say(`Couldn't add ${p.title}. Please try again.`); },
        );
      });
      info.appendChild(btn);
    } else {
      const view = el(doc, "a", btnCss, "View");
      view.setAttribute("href", isSafeUrl(p.url) ? p.url : "#"); view.setAttribute("rel", "noopener noreferrer");
      view.setAttribute("aria-label", `View ${p.title}`);
      view.addEventListener("click", () => cb.onClick?.(p));
      info.appendChild(view);
    }
    li.appendChild(info);
    return li;
  };

  const paint = (): void => {
    list.replaceChildren(...items.map(card));
    host.style.display = items.length ? (floating ? "" : "block") : "none";
  };
  paint();
  mount.appendChild(host);

  return {
    host,
    update(next) {
      // A fresh answer must not take away what the shopper just added (the cart now contains it, so the server drops it) or
      // the control they are using: keep added products where they were, and put keyboard focus back on the same button.
      const focused = (root.activeElement as HTMLElement | null)?.closest?.("[data-pid]")?.getAttribute("data-pid");
      const merged = [...next];
      items.forEach((p, i) => { if (added.has(p.id) && !merged.some((n) => n.id === p.id)) merged.splice(Math.min(i, merged.length), 0, p); });
      items = merged.slice(0, max);
      paint();
      if (focused) (Array.from(list.querySelectorAll("li")).find((li) => li.getAttribute("data-pid") === focused)?.querySelector("button") as HTMLElement | null)?.focus({ preventScroll: true });
    },
    destroy() {
      if (onKey) panel.removeEventListener("keydown", onKey);
      host.remove();
    },
  };
}
