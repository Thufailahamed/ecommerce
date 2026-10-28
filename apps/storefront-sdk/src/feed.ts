import type { CampaignConfig } from "@convertflow/contracts";
import type { RenderHandle } from "./render";

export interface FeedItem { campaignId: string; versionId: string; config: CampaignConfig; publishedAt?: string | undefined }

export interface FeedCallbacks {
  /** Called when the panel opens with the items now on screen (for analytics). */
  onOpen?: (items: FeedItem[]) => void;
  /** A button inside an item was used. */
  onItemClick?: (item: FeedItem) => void;
  isRead?: (versionId: string) => boolean;
  markRead?: (versionIds: string[]) => void;
  /** Fresh, currently-eligible items, so an item that expired while the page was open is not shown. */
  getItems?: () => FeedItem[];
}

export interface FeedHandle extends RenderHandle {
  update(items: FeedItem[]): void;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

const isSafeUrl = (u: string): boolean => (/^\/(?![\/\\])/.test(u) || /^https:\/\//i.test(u)) && !/[\u0000-\u001f\u007f\\]/.test(u);

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const n = doc.createElement(tag);
  n.style.cssText = css;
  if (text !== undefined) n.textContent = text; // textContent only: copy is never parsed as HTML
  return n;
}

/** Newest-feeling order: the merchant's explicit order first, then most recently published, then id for stability. */
export function sortFeed(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) =>
    (a.config.feed?.order ?? 100) - (b.config.feed?.order ?? 100)
    || (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0)
    || a.campaignId.localeCompare(b.campaignId));
}

/**
 * A persistent notification centre: a bell with an unread count that opens a panel of cards. It is part of the page
 * (not an interruption), is hidden entirely when there is nothing to show, and never takes focus until the shopper opens it.
 */
export function renderFeed(doc: Document, initial: FeedItem[], cb: FeedCallbacks = {}, mount: HTMLElement = doc.body, opts: { open?: boolean } = {}): FeedHandle {
  const win = doc.defaultView;
  const host = doc.createElement("div");
  host.setAttribute("data-convertflow", "");
  host.setAttribute("data-tool", "feed");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147482998;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });

  let items = sortFeed(initial);
  let opened = false;
  let unreadAtOpen = new Set<string>();
  const disposers: Array<() => void> = [];
  const on = <T extends EventTarget>(t: T, type: string, fn: (e: never) => void): void => {
    t.addEventListener(type, fn as EventListener);
    disposers.push(() => t.removeEventListener(type, fn as EventListener));
  };

  const first = (): FeedItem | undefined => items[0];
  const style = (): CampaignConfig["style"] | undefined => first()?.config.style;
  const onLeft = (): boolean => first()?.config.feed?.position === "bottom_left";
  const unread = (): number => items.filter((i) => !(cb.isRead?.(i.versionId) ?? false)).length;

  const wrap = el(doc, "div", "pointer-events:none;");
  const bell = el(doc, "button", "position:fixed;bottom:16px;width:48px;height:48px;border-radius:24px;border:0;cursor:pointer;pointer-events:auto;box-shadow:0 6px 20px rgba(0,0,0,.22);font:600 20px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;");
  bell.setAttribute("type", "button");
  bell.setAttribute("aria-haspopup", "dialog");
  bell.setAttribute("aria-expanded", "false");
  const bellIcon = el(doc, "span", "font-size:22px;line-height:1;", "\u{1F514}");
  bellIcon.setAttribute("aria-hidden", "true");
  const badge = el(doc, "span", "position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:#C62828;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;");
  badge.setAttribute("aria-hidden", "true");
  bell.append(bellIcon, badge);

  const panel = el(doc, "div", "position:fixed;bottom:72px;pointer-events:auto;box-sizing:border-box;display:none;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Notifications");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("tabindex", "-1");
  const head = el(doc, "div", "display:flex;align-items:center;justify-content:space-between;padding:12px 14px;font-weight:650;border-bottom:1px solid rgba(0,0,0,.1);", "Notifications");
  const closeBtn = el(doc, "button", "border:0;background:transparent;color:inherit;font-size:20px;line-height:1;width:36px;height:36px;cursor:pointer;margin:-6px -8px -6px 0;", "×");
  closeBtn.setAttribute("type", "button");
  closeBtn.setAttribute("aria-label", "Close notifications");
  head.appendChild(closeBtn);
  const list = el(doc, "ul", "list-style:none;margin:0;padding:0;overflow:auto;max-height:min(60vh,480px);");
  list.setAttribute("aria-label", "Notification list");
  panel.append(head, list);
  wrap.append(bell, panel);
  root.appendChild(wrap);

  const fmtDate = (iso: string | undefined): string | undefined => {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(t)) return undefined;
    try { return new Intl.DateTimeFormat(win?.navigator?.language, { dateStyle: "medium" }).format(new Date(t)); } catch { return new Date(t).toDateString(); }
  };

  const card = (item: FeedItem): HTMLElement => {
    const { creative: c, style: s } = item.config;
    const isNew = unreadAtOpen.has(item.versionId);
    const li = el(doc, "li", `padding:12px 14px;border-bottom:1px solid ${s.text}1a;${isNew ? `background:${s.accent}0f;` : ""}`);
    const meta = el(doc, "div", "display:flex;gap:8px;align-items:center;font-size:12px;margin-bottom:2px;"); // no opacity here: it would also fade the "New" label
    meta.appendChild(el(doc, "span", "text-transform:uppercase;letter-spacing:.04em;opacity:.75;", item.config.feed?.category ?? "Updates"));
    const date = fmtDate(item.publishedAt ?? item.config.schedule.startsAt);
    if (date) meta.appendChild(el(doc, "span", "opacity:.75;", date));
    if (isNew) meta.appendChild(el(doc, "span", `margin-left:auto;font-weight:700;color:${s.accent};`, "New"));
    li.appendChild(meta);
    if (c.imageUrl && isSafeUrl(c.imageUrl)) {
      const img = el(doc, "img", `display:block;width:100%;max-height:140px;object-fit:cover;border-radius:${Math.max(s.radius - 2, 0)}px;margin:6px 0;background:#0001;`);
      img.setAttribute("src", c.imageUrl); img.setAttribute("alt", ""); img.setAttribute("loading", "lazy");
      li.appendChild(img);
    }
    li.appendChild(el(doc, "div", "font-weight:650;", c.headline));
    if (c.body) li.appendChild(el(doc, "div", "opacity:.85;margin-top:2px;", c.body));
    const product = c.products?.[0];
    if (product && isSafeUrl(product.url)) {
      const a = el(doc, "a", "display:block;margin-top:6px;color:inherit;font-weight:600;text-decoration:underline;", product.title);
      a.setAttribute("href", product.url); a.setAttribute("rel", "noopener noreferrer");
      a.addEventListener("click", () => cb.onItemClick?.(item));
      li.appendChild(a);
    }
    const promo = item.config.promotion;
    if (promo) {
      const row = el(doc, "div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;");
      row.appendChild(el(doc, "span", "font-weight:700;", `${promo.label ?? "Use code"} · ${promo.percentOff}% off`));
      row.appendChild(el(doc, "code", `font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px dashed ${s.text};border-radius:6px;padding:3px 8px;`, promo.code));
      const copy = el(doc, "button", `font:inherit;font-size:12px;border:1px solid ${s.text};background:transparent;color:inherit;border-radius:6px;padding:3px 8px;cursor:pointer;`, "Copy");
      copy.setAttribute("type", "button"); copy.setAttribute("aria-label", `Copy code ${promo.code}`);
      copy.addEventListener("click", () => { void (win?.navigator.clipboard?.writeText(promo.code) ?? Promise.reject()).then(() => { copy.textContent = "Copied"; }, () => { copy.textContent = "Select and copy"; }); });
      row.appendChild(copy);
      li.appendChild(row);
    }
    const cta = el(doc, "a", `display:inline-block;margin-top:8px;text-decoration:none;font-weight:600;background:${s.accent};color:${s.accentText};padding:6px 12px;border-radius:${Math.min(s.radius, 999)}px;`, c.ctaLabel);
    cta.setAttribute("href", isSafeUrl(c.ctaUrl) ? c.ctaUrl : "#"); // defence in depth: never trust a config at render time
    cta.setAttribute("rel", "noopener noreferrer");
    cta.addEventListener("click", () => cb.onItemClick?.(item));
    li.appendChild(cta);
    return li;
  };

  const paint = (): void => {
    const s = style();
    if (!s || items.length === 0) { host.style.display = "none"; if (opened) closePanel(false); return; }
    host.style.display = "";
    const left = onLeft();
    for (const e of [bell, panel]) { e.style.left = left ? "16px" : ""; e.style.right = left ? "" : "16px"; }
    bell.style.background = s.accent; bell.style.color = s.accentText;
    panel.style.width = "360px"; panel.style.maxWidth = "calc(100vw - 32px)"; // plain width first, the viewport-aware cap second
    panel.style.background = s.background; panel.style.color = s.text; panel.style.borderRadius = `${Math.max(s.radius, 8)}px`;
    const n = unread();
    badge.textContent = n > 9 ? "9+" : String(n);
    badge.style.display = n > 0 ? "" : "none";
    bell.setAttribute("aria-label", n > 0 ? `Notifications, ${n} unread` : "Notifications");
    list.replaceChildren(...items.map(card));
  };

  const outside = (e: Event): void => { if (!e.composedPath().includes(host)) closePanel(false); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") closePanel(true); };

  function openPanel(): void {
    if (opened || items.length === 0) return;
    const fresh = cb.getItems?.();
    if (fresh) items = sortFeed(fresh);
    if (items.length === 0) { paint(); return; }
    unreadAtOpen = new Set(items.filter((i) => !(cb.isRead?.(i.versionId) ?? false)).map((i) => i.versionId));
    opened = true;
    paint();
    panel.style.display = "flex";
    bell.setAttribute("aria-expanded", "true");
    cb.onOpen?.(items);
    cb.markRead?.(items.map((i) => i.versionId)); // opening the feed is what clears the unread badge
    const n = unread();
    badge.textContent = n > 9 ? "9+" : String(n); badge.style.display = n > 0 ? "" : "none";
    bell.setAttribute("aria-label", n > 0 ? `Notifications, ${n} unread` : "Notifications");
    panel.focus({ preventScroll: true });
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", onKey, true);
  }

  function closePanel(restoreFocus: boolean): void {
    if (!opened) return;
    opened = false;
    unreadAtOpen = new Set();
    panel.style.display = "none";
    bell.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", onKey, true);
    if (restoreFocus) bell.focus({ preventScroll: true });
  }

  on(bell, "click", () => (opened ? closePanel(true) : openPanel()));
  on(closeBtn, "click", () => closePanel(true));

  paint();
  mount.appendChild(host);
  if (opts.open) openPanel();

  return {
    host,
    get isOpen() { return opened; },
    open: openPanel,
    close: () => closePanel(false),
    update(next) { items = sortFeed(next); paint(); },
    destroy() {
      closePanel(false);
      for (const d of disposers.splice(0)) d();
      host.remove();
    },
  };
}
