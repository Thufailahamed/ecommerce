import {
  assignGroup, isSignalTriggerSatisfied, quietUntilAfterDismiss, selectExperiences,
  type SuppressionState, type VisitorContext,
} from "@convertflow/campaign-engine";
import { slotOf, toolOf } from "@convertflow/contracts/slots";
import type { CampaignConfig, PublishedCampaign, Slot, StorefrontConfig, TrackedEvent } from "@convertflow/contracts";
import { renderBasic } from "./basic";
import { createCartTracker } from "./cart";
import { detectContext } from "./detect";
// Type-only: the renderers behind these live in separate scripts (see registry.ts) and are loaded when first needed.
import type { FeedHandle, FeedItem } from "./feed";
import type { RecHandle, RecProduct } from "./recommend";
import type { ToolMods, ToolName } from "./registry";
import type { RenderCallbacks, RenderContext, RenderHandle, SmsConfirmed } from "./render";

/** Set by the build to the content-hashed file name of each per-tool script. Absent in unit tests, which register the renderers directly. */
declare const __CF_CHUNKS__: Partial<Record<ToolName, string>> | undefined;

declare global {
  interface Window {
    ConvertFlow?: {
      /** Set true/false from your cookie banner. Takes precedence over Shopify's Customer Privacy API. */
      consent?: boolean;
      /** Call once on the order-confirmation page. Sent only with consent. */
      trackPurchase?: (o: { orderId: string; total: number; currency: string }) => void;
      /** Tell the SDK what is in the cart (any platform). Subtotal in store currency. */
      setCart?: (c: { subtotal?: number; itemCount?: number; productIds?: string[] }) => void;
      /** Tell the SDK an item was just added to the cart. Optionally pass the new cart state. */
      trackAddToCart?: (c?: { subtotal?: number; itemCount?: number; productIds?: string[] }) => void;
      /**
       * Provide this on a custom store so recommended products can be added to the cart without leaving the page. Resolve when
       * the item is in the cart (optionally with the new cart state); throw or reject when it is not. Without it (and without
       * Shopify or WooCommerce), recommended products link to their page instead.
       */
      addToCart?: (item: { productId: string; variantId?: string; quantity: 1 }) => unknown;
      /** Remove everything the SDK added (UI, listeners, timers) and allow a fresh boot. */
      destroy?: () => void;
      __loaded?: boolean;
    };
    Shopify?: { customerPrivacy?: { analyticsProcessingAllowed?: () => boolean } };
  }
}

const LS = "cf:v1";
const SS = "cf:s:v1";
const FEED = "cf:feed:v1";

interface Persisted {
  visitorImpressions: Record<string, number>;
  dismissedAt: Record<string, number>;
  clickedAt: Record<string, number>;
  firstSeen: number;
  lastClick?: { campaignId: string; versionId: string; at: number };
  /** Random id, only ever created and stored with analytics consent; drives experiment arms. */
  visitorId?: string;
  exp?: { campaignId: string; versionId: string; group: "treatment" | "holdout"; at: number };
  cfg?: { at: number; v: unknown };
  /** Set after a signup so that channel's forms are not shown again. Persisted only with analytics consent, like the rest. */
  subscribed?: { email?: true; sms?: true };
}

interface Session {
  id: string;
  impressions: Record<string, number>;
  pages: number;
  assigned?: Record<string, 1>;
  /** After any dismissal, interruptive and ambient experiences stay quiet until this time (cross-tool). */
  quietUntil?: number;
  /** Feed items already reported as seen this session, so reopening the panel does not inflate the count. */
  feedSeen?: Record<string, 1>;
  /** Signed up during this tab session (kept even without analytics consent, so the form does not nag). */
  subscribed?: { email?: true; sms?: true };
}

/** Cheap structural guard. Full Zod validation happens server-side at publish; shipping Zod here would triple the bundle. */
function isConfig(v: unknown): v is StorefrontConfig {
  const c = v as StorefrontConfig | null;
  return !!c && c.schemaVersion === 1 && typeof c.deliveryEnabled === "boolean" && Array.isArray(c.campaigns);
}

function load<T>(store: Storage | undefined, key: string): T | undefined {
  try { const r = store?.getItem(key); return r ? (JSON.parse(r) as T) : undefined; } catch { return undefined; }
}
function save(store: Storage | undefined, key: string, v: unknown): void {
  try { store?.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: degrade silently */ }
}
function rid(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tracking and persistence require explicit consent. Rendering a campaign does not. */
function hasConsent(): boolean {
  const explicit = window.ConvertFlow?.consent;
  if (explicit !== undefined) return explicit === true;
  try { return window.Shopify?.customerPrivacy?.analyticsProcessingAllowed?.() === true; } catch { return false; }
}

/**
 * keepalive survives page unload like sendBeacon, but unlike a credentialed beacon it works cross-origin
 * with `Access-Control-Allow-Origin: *`. text/plain keeps it a "simple" request (no preflight round-trip).
 */
function post(api: string, body: string): void {
  try {
    void fetch(`${api}/api/v1/events/batch`, { method: "POST", body, keepalive: true, credentials: "omit", headers: { "content-type": "text/plain;charset=UTF-8" } }).catch(() => undefined);
  } catch { /* never break the page */ }
}

/** First-party, 7-day cookie so a sandboxed checkout pixel can attribute a purchase. Written only with consent. */
function writeClickCookie(c: { campaignId: string; versionId: string; at: number }): void {
  if (!hasConsent()) return;
  try { document.cookie = `cf_lc=${c.campaignId}.${c.versionId}.${c.at}; Max-Age=604800; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* ignore */ }
}

/** Does any published campaign depend on what is in the cart? Only then is the cart read at all. */
function needsCart(cfg: StorefrontConfig): boolean {
  return cfg.campaigns.some(({ config: c }) =>
    c.trigger.type === "add_to_cart" || c.trigger.type === "cart_threshold" || c.toast?.kind === "shipping_incentive" || c.tool === "upsell"
    || c.targeting.conditions.some((x) => x.field === "cart_subtotal" || x.field === "cart_item_count"));
}

/** Which per-tool script draws this campaign. Popup, slide-in, bar and restock with a plain call to action are drawn by the core itself. */
function toolFor(c: CampaignConfig): ToolName | undefined {
  if (c.format === "toast") return "toast";
  if (c.format === "recommendation") return "upsell";
  if (c.format === "feed_item") return "feed";
  if (c.format !== "restock" && c.form?.collect.phone) return "sms";
  if (c.format !== "restock" && c.form?.collect.email) return "email";
  return undefined;
}

/** Signup forms of either channel, which share inline placement and the form-submit metrics. */
const isForm = (c: CampaignConfig): boolean => { const t = toolFor(c); return t === "email" || t === "sms"; };

/** Where an inline signup form goes: a spot the merchant marked with data-convertflow-form, else the end of <main>, else the end of the page. */
const formMount = (doc: Document): HTMLElement => (doc.querySelector("[data-convertflow-form]") ?? doc.querySelector("main") ?? doc.body) as HTMLElement;

export function boot(script: HTMLScriptElement): void {
  if (window.ConvertFlow?.__loaded) return; // avoid duplicate rendering
  window.ConvertFlow = { ...window.ConvertFlow, __loaded: true };

  const siteId = script.dataset["site"];
  const api = script.dataset["api"];
  if (!siteId || !api) return;

  // Cleanup manager: everything the SDK starts (timers, listeners, observers) registers a disposer here,
  // so removing the SDK leaves nothing behind.
  const disposers: Array<() => void> = [];
  const later = (fn: () => void, ms: number): void => { const id = setTimeout(fn, ms); disposers.push(() => clearTimeout(id)); };
  const listen = <T extends EventTarget>(t: T, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): (() => void) => {
    t.addEventListener(type, fn as EventListener, opts);
    const off = (): void => t.removeEventListener(type, fn as EventListener, opts);
    disposers.push(off);
    return off;
  };

  // Per-tool scripts sit next to this one. Their names carry a content hash (set by the build), so a cached core can never
  // meet a different version of a tool script. A script that fails to load just means that tool shows nothing.
  const base = script.src ? script.src.slice(0, script.src.lastIndexOf("/") + 1) : "";
  const loading = new Map<ToolName, Promise<boolean>>();
  const failed = new Set<ToolName>();
  let gone = false;
  disposers.push(() => { gone = true; });
  const loadTool = (name: ToolName): Promise<boolean> => {
    let p = loading.get(name);
    if (!p) {
      const file = typeof __CF_CHUNKS__ !== "undefined" ? __CF_CHUNKS__[name] : undefined;
      p = new Promise<boolean>((resolve) => {
        if (!file) { resolve(false); return; }
        const s = document.createElement("script");
        s.src = base + file; s.async = true;
        s.onload = () => resolve(window.__cfTools?.[name] !== undefined);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
      loading.set(name, p);
    }
    return p;
  };
  /** The tool's renderer if it is loaded; otherwise start loading it and call `again` once it arrives. */
  const need = <K extends ToolName>(name: K, again: () => void): ToolMods[K] | undefined => {
    const m = window.__cfTools?.[name];
    if (m) return m;
    if (!failed.has(name)) void loadTool(name).then((ok) => { if (!ok) failed.add(name); else if (!gone) again(); });
    return undefined;
  };
  /** Draws a campaign that is shown as the winner of the interruptive or ambient slot. Its tool script must already be loaded. */
  const draw = (c: CampaignConfig, cb: RenderCallbacks, ctx: RenderContext): RenderHandle | undefined => {
    const t = window.__cfTools;
    switch (toolFor(c)) {
      case "toast": return t?.toast?.renderToast(document, c, cb, document.body, ctx);
      case "upsell": return t?.upsell?.renderRecommendations(document, c, ctx.products ?? [], {
        ...(cb.onProductClick ? { onClick: cb.onProductClick } : {}), ...(cb.onAdd ? { onAdd: cb.onAdd } : {}), ...(cb.canAdd ? { canAdd: cb.canAdd } : {}), ...(cb.onDismiss ? { onDismiss: cb.onDismiss } : {}),
      }, document.body, ctx);
      case "email": return t?.email?.renderSignup(document, c, cb, document.body);
      case "sms": return t?.sms?.renderSmsSignup(document, c, cb, document.body);
      default: return renderBasic(document, c, cb, document.body, ctx);
    }
  };

  const persisted: Persisted = load<Persisted>(localStorage, LS) ?? { visitorImpressions: {}, dismissedAt: {}, clickedAt: {}, firstSeen: Date.now() };
  const session: Session = load<Session>(sessionStorage, SS) ?? { id: rid(), impressions: {}, pages: 0 };
  session.pages += 1;
  save(sessionStorage, SS, session);

  const queue: TrackedEvent[] = [];
  let active: RenderHandle | undefined;
  let activeId: string | undefined;
  let activeSlot: Slot | undefined;
  /** Campaigns whose trigger is pending, so a re-evaluation (for example after the cart changes) never schedules one twice. */
  const scheduled = new Set<string>();

  const cart = createCartTracker(window, window.ConvertFlow as Record<string, unknown>);
  disposers.push(() => cart.destroy());

  window.ConvertFlow.trackPurchase = (o) => {
    if (!hasConsent() || !o || !o.orderId || !(o.total >= 0) || !/^[A-Za-z]{3}$/.test(o.currency)) return;
    const lc = persisted.lastClick;
    const ex = persisted.exp && Date.now() - persisted.exp.at < 30 * 86_400_000 ? persisted.exp : undefined; // the arm this visitor was randomised into
    queue.push({
      eventId: rid(), type: "purchase_observed", siteId, sessionId: session.id, occurredAt: new Date().toISOString(), schemaVersion: 1,
      order: {
        orderId: String(o.orderId).slice(0, 100), total: o.total, currency: o.currency.toUpperCase(),
        ...(lc ? { lastClick: { campaignId: lc.campaignId, versionId: lc.versionId, clickedAt: new Date(lc.at).toISOString() } } : {}),
        ...(ex ? { experiment: { campaignId: ex.campaignId, versionId: ex.versionId, group: ex.group } } : {}),
      },
    });
    post(api, JSON.stringify({ consent: true, events: queue.splice(0, 50) }));
  };

  const track = (type: TrackedEvent["type"], p: PublishedCampaign): void => {
    if (!hasConsent()) return;
    queue.push({ eventId: rid(), type, siteId, campaignId: p.campaignId, versionId: p.versionId, sessionId: session.id, occurredAt: new Date().toISOString(), schemaVersion: 1 });
  };
  const flush = (): void => {
    if (!queue.length || !hasConsent()) return;
    post(api, JSON.stringify({ consent: true, events: queue.splice(0, 50) }));
  };
  const persist = (): void => { if (hasConsent()) save(localStorage, LS, persisted); save(sessionStorage, SS, session); };

  const clear = (): void => { active?.destroy(); active = undefined; activeId = undefined; activeSlot = undefined; };

  // The freshest config seen. Anything scheduled from a stale cached config re-checks against this
  // at the moment it would render, so a pause or the kill switch is honoured even mid-delay.
  let latest: StorefrontConfig | undefined;
  const stillLive = (p: PublishedCampaign): boolean =>
    !!latest && latest.deliveryEnabled && latest.campaigns.some((c) => c.campaignId === p.campaignId && c.versionId === p.versionId);

  const context = (): VisitorContext => ({
    // What the SDK observed comes first, so explicit page data from the merchant (ConvertFlowContext) wins.
    ...(cart.state.subtotal !== undefined ? { cartSubtotal: cart.state.subtotal } : {}),
    ...(cart.state.itemCount !== undefined ? { cartItemCount: cart.state.itemCount } : {}),
    ...detectContext(window), now: Date.now(),
    visitorType: Date.now() - persisted.firstSeen > 60_000 ? "returning" : "new",
    pagesViewed: session.pages,
  });
  const subscribedTo = (ch: "email" | "sms"): boolean => persisted.subscribed?.[ch] === true || session.subscribed?.[ch] === true;
  const suppression = (): SuppressionState => ({
    sessionImpressions: session.impressions, visitorImpressions: persisted.visitorImpressions,
    dismissedAt: persisted.dismissedAt, clickedAt: persisted.clickedAt,
    ...(activeId && activeSlot ? { active: [{ campaignId: activeId, slot: activeSlot }] } : {}),
    ...(session.quietUntil !== undefined ? { quietUntil: session.quietUntil } : {}),
    ...(subscribedTo("email") || subscribedTo("sms") ? { subscribed: { ...(subscribedTo("email") ? { email: true } : {}), ...(subscribedTo("sms") ? { sms: true } : {}) } } : {}),
  });

  /**
   * Feed read state is the shopper's own, kept in their browser only: no identifier is created and nothing is sent.
   * With analytics consent it lasts across visits (localStorage); without it, only for the tab's session.
   */
  const feedStore = (): Storage | undefined => (hasConsent() ? localStorage : sessionStorage);
  const readMap = (): Record<string, number> => load<Record<string, number>>(feedStore(), FEED) ?? {};
  let feed: FeedHandle | undefined;
  const feedItems = (): FeedItem[] => {
    if (!latest) return [];
    return selectExperiences(latest, context(), suppression()).passive
      .filter((c) => toolOf(c.config) === "feed")
      .map((c) => ({ campaignId: c.campaignId, versionId: c.versionId, config: c.config, publishedAt: c.publishedAt }));
  };
  const syncFeed = (): void => {
    const items = feedItems();
    if (items.length === 0) { feed?.destroy(); feed = undefined; return; }
    if (feed) { feed.update(items); return; }
    const mod = need("feed", syncFeed);
    if (!mod) return; // loading: syncFeed runs again when the script arrives
    const asPub = (i: FeedItem): PublishedCampaign => ({ campaignId: i.campaignId, versionId: i.versionId, config: i.config });
    track("campaign_eligible", asPub(items[0]!)); // one per page, so a feed counts as a tracked page view like any other campaign
    flush();
    feed = mod.renderFeed(document, items, {
      getItems: feedItems,
      isRead: (v) => v in readMap(),
      markRead: (ids) => {
        const r = readMap(); const now = Date.now();
        for (const id of ids) r[id] = now;
        const keep = Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 200); // bounded: old versions fall away
        save(feedStore(), FEED, Object.fromEntries(keep));
      },
      onOpen: (shown) => {
        session.feedSeen ??= {};
        for (const i of shown) if (!session.feedSeen[i.versionId]) { session.feedSeen[i.versionId] = 1; track("feed_open", asPub(i)); }
        persist(); flush();
      },
      onItemClick: (i) => {
        persisted.clickedAt[i.campaignId] = Date.now();
        persisted.lastClick = { campaignId: i.campaignId, versionId: i.versionId, at: Date.now() };
        writeClickCookie(persisted.lastClick);
        track("feed_item_click", asPub(i)); persist(); flush();
      },
    });
  };
  disposers.push(() => { feed?.destroy(); feed = undefined; });

  /**
   * Holdout experiment: only for consenting visitors (the assignment needs a persisted id, which is analytics storage).
   * Visitors without consent are never held out: they simply see the campaign and nothing is recorded.
   * Returns true when this visitor is in the control arm, so the campaign must not be shown.
   */
  const heldOut = (c: PublishedCampaign): boolean => {
    const exp = c.config.experiment;
    if (!exp || !hasConsent()) return false;
    persisted.visitorId ??= rid();
    const group = assignGroup(persisted.visitorId, c.campaignId, exp.holdoutPercent);
    persisted.exp = { campaignId: c.campaignId, versionId: c.versionId, group, at: Date.now() };
    session.assigned ??= {};
    if (!session.assigned[c.campaignId]) {
      session.assigned[c.campaignId] = 1;
      queue.push({ eventId: `ea_${session.id}_${c.campaignId}`.slice(0, 64), type: "experiment_assigned", group, siteId, campaignId: c.campaignId, versionId: c.versionId, sessionId: session.id, occurredAt: new Date().toISOString(), schemaVersion: 1 });
    }
    save(localStorage, LS, persisted); save(sessionStorage, SS, session); flush();
    return group === "holdout";
  };

  /* ---------- upsell: recommendations ---------- */

  /** What the server answers with is data, not trusted markup: check the shape before it reaches the renderer. */
  const isRecProduct = (x: unknown): x is RecProduct => {
    const p = x as RecProduct | null;
    return !!p && typeof p.id === "string" && typeof p.title === "string" && typeof p.url === "string" && typeof p.addable === "boolean";
  };
  /** The server picks the products from the live campaign. The browser only says which campaign and what page it is on. */
  const fetchRecs = async (p: PublishedCampaign): Promise<RecProduct[]> => {
    const q = new URLSearchParams({ siteId, campaignId: p.campaignId });
    const pid = context().productId;
    if (pid) q.set("productId", pid);
    const ids = cart.state.productIds;
    if (ids?.length) q.set("cart", ids.slice(0, 20).join(","));
    if (cart.state.subtotal !== undefined) q.set("subtotal", String(cart.state.subtotal));
    const r = await fetch(`${api}/api/v1/recommendations?${q.toString()}`, { credentials: "omit" });
    if (!r.ok) return [];
    const j = (await r.json()) as { products?: unknown };
    return Array.isArray(j.products) ? j.products.filter(isRecProduct) : [];
  };
  /**
   * A request is only repeated when something it depends on changed. A product-page block does not depend on the cart
   * (apart from a shipping-gap source), so adding to the cart never redraws it under the shopper. It excludes what is
   * already in the cart only as far as the cart was known when the page loaded.
   */
  const recKey = (c: PublishedCampaign): string => {
    const o = c.config.recommend;
    const cartPart = o?.placement !== "product_page" || o.source === "shipping_threshold"
      ? [String(cart.state.subtotal ?? ""), (cart.state.productIds ?? []).join(",")]
      : [];
    return [c.versionId, context().productId ?? "", ...cartPart].join("|");
  };
  const recClick = (c: PublishedCampaign): void => {
    persisted.clickedAt[c.campaignId] = Date.now();
    persisted.lastClick = { campaignId: c.campaignId, versionId: c.versionId, at: Date.now() };
    writeClickCookie(persisted.lastClick);
    track("recommendation_click", c); persist(); flush();
  };
  // Only reachable once the upsell script has drawn something, which is what brings resolveAdder with it.
  const recCanAdd = (p: RecProduct): boolean => window.__cfTools?.upsell?.resolveAdder(window, p) !== undefined;
  const recAdd = (c: PublishedCampaign) => async (p: RecProduct): Promise<void> => {
    const adder = window.__cfTools?.upsell?.resolveAdder(window, p);
    if (!adder) throw new Error("no add-to-cart adapter");
    const cartState = await adder.add(p); // throws when the platform refuses, which the block shows as a failure
    if (!adder.tracked) window.ConvertFlow?.trackAddToCart?.(cartState); // the Shopify and WooCommerce paths were already seen by the cart tracker
    persisted.clickedAt[c.campaignId] = Date.now();
    persisted.lastClick = { campaignId: c.campaignId, versionId: c.versionId, at: Date.now() };
    writeClickCookie(persisted.lastClick);
    track("recommendation_add_to_cart", c); persist(); flush();
  };

  interface RecEntry { key: string; seq: number; handle?: RecHandle; impressed?: true; held?: true }
  const recs = new Map<string, RecEntry>();
  let recSeq = 0;
  const loadRecs = async (c: PublishedCampaign): Promise<void> => {
    const mod = need("upsell", syncRecs);
    if (!mod) return; // loading: syncRecs runs again when the script arrives
    const key = recKey(c);
    let e = recs.get(c.campaignId);
    if (e?.key === key) return;
    if (!e) {
      e = { key: "", seq: 0 };
      recs.set(c.campaignId, e);
      if (heldOut(c)) e.held = true;
    }
    if (e.held) return;
    e.key = key;
    const mine = (e.seq = ++recSeq);
    let products: RecProduct[] = [];
    try { products = await fetchRecs(c); } catch { /* a failed request shows nothing */ }
    if (recs.get(c.campaignId) !== e || e.seq !== mine) return; // superseded by a newer request, or the campaign went away
    if (products.length === 0) { e.handle?.destroy(); delete e.handle; return; }
    if (e.handle) { e.handle.update(products); return; }
    if (!stillLive(c)) return;
    track("campaign_eligible", c); // one per page, so a block counts as a tracked page view like any other campaign
    e.handle = mod.renderRecommendations(document, c.config, products,
      { onClick: () => recClick(c), onAdd: recAdd(c), canAdd: recCanAdd },
      mod.recommendationMount(document, c.config.recommend?.placement ?? "product_page"),
      { ...(latest?.currency ? { currency: latest.currency } : {}) });
    if (!e.impressed) { e.impressed = true; track("recommendation_impression", c); }
    persist(); flush();
  };
  const syncRecs = (): void => {
    if (!latest) return;
    const list = selectExperiences(latest, context(), suppression()).passive.filter((c) => toolOf(c.config) === "upsell");
    const want = new Set(list.map((c) => c.campaignId));
    for (const [id, e] of recs) if (!want.has(id)) { e.handle?.destroy(); recs.delete(id); } // paused, expired, rolled back or off this page
    for (const c of list) void loadRecs(c);
  };
  disposers.push(() => { for (const e of recs.values()) e.handle?.destroy(); recs.clear(); });
  /** Floating recommendations that came back empty for a given page and cart, so they are not asked for again on every re-evaluation. */
  const noRecs = new Set<string>();

  /* ---------- signup forms (email and SMS) ---------- */

  const markSubscribed = (ch: "email" | "sms"): void => {
    session.subscribed = { ...session.subscribed, [ch]: true };
    if (hasConsent()) persisted.subscribed = { ...persisted.subscribed, [ch]: true };
  };
  /**
   * One form submission as the browser saw it: an attempt, then a success (the server accepted it) or a failure (a network
   * or server error). Counted only with consent, like every event, and never with what the shopper typed.
   */
  const submitted = async <T>(c: PublishedCampaign, send: () => Promise<T>): Promise<T> => {
    track("form_submit_attempt", c);
    try { const r = await send(); track("form_submit_success", c); return r; }
    catch (e) { track("form_submit_failure", c); throw e; }
    finally { persist(); flush(); }
  };
  const postJson = async (path: string, body: unknown): Promise<Response> =>
    fetch(`${api}${path}`, { method: "POST", credentials: "omit", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
  /** Rejects with the server's error code as the message, so the form can show the matching words. */
  const failWith = async (r: Response): Promise<never> => {
    const j = (await r.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    throw new Error(typeof j?.error?.code === "string" ? j.error.code : "request_failed");
  };

  /** The browser sends only the address, an optional first name and that the box was ticked. The server records the words of the form that is live. */
  const signupFor = (c: PublishedCampaign) => async (email: string, firstName?: string): Promise<void> => {
    await submitted(c, async () => {
      const r = await postJson("/api/v1/notifications/subscribe", { siteId, campaignId: c.campaignId, email, consent: true, ...(firstName ? { firstName } : {}) });
      if (!r.ok) await failWith(r);
    });
    markSubscribed("email");
    track("notification_subscribed", c); persist(); flush();
  };
  /** SMS: the number is only subscribed once the shopper types back the code texted to it. */
  const smsFor = (c: PublishedCampaign): Pick<RenderCallbacks, "onSmsStart" | "onSmsConfirm"> => ({
    onSmsStart: (phone: string, firstName?: string) => submitted(c, async () => {
      const r = await postJson("/api/v1/notifications/sms/subscribe", { siteId, campaignId: c.campaignId, phone, consent: true, ...(firstName ? { firstName } : {}) });
      if (!r.ok) await failWith(r);
    }),
    onSmsConfirm: async (phone: string, code: string): Promise<SmsConfirmed> => {
      const r = await postJson("/api/v1/notifications/sms/confirm", { siteId, campaignId: c.campaignId, phone, code });
      if (!r.ok) await failWith(r);
      const j = (await r.json().catch(() => ({}))) as SmsConfirmed;
      markSubscribed("sms");
      track("notification_subscribed", c); persist(); flush();
      return j.incentive && typeof j.incentive.code === "string" ? { incentive: j.incentive } : {};
    },
  });

  /** Inline signup forms are part of the page (a passive surface). One per campaign; kept on screen after signing up so the shopper sees the confirmation message. */
  const forms = new Map<string, { versionId: string; handle?: RenderHandle; signedUp?: true }>();
  const syncForms = (): void => {
    if (!latest) return;
    const list = selectExperiences(latest, context(), suppression()).passive.filter((c) => isForm(c.config) && c.config.format === "inline");
    const want = new Set(list.map((c) => c.campaignId));
    for (const [id, e] of forms) if (!want.has(id) && !e.signedUp) { e.handle?.destroy(); forms.delete(id); } // paused, expired, rolled back or off this page
    for (const c of list) {
      const have = forms.get(c.campaignId);
      if (have && (have.versionId === c.versionId || have.signedUp)) continue;
      have?.handle?.destroy();
      const sms = toolFor(c.config) === "sms";
      const mod = sms ? need("sms", syncForms) : need("email", syncForms);
      if (!mod) { forms.delete(c.campaignId); continue; } // loading: syncForms runs again when the script arrives
      const entry: { versionId: string; handle?: RenderHandle; signedUp?: true } = { versionId: c.versionId };
      forms.set(c.campaignId, entry);
      if (heldOut(c)) continue;
      track("campaign_eligible", c);
      if (sms) {
        const cbs = smsFor(c);
        entry.handle = window.__cfTools!.sms!.renderSmsSignup(document, c.config, { ...cbs, onSmsConfirm: async (phone, code) => { const r = await cbs.onSmsConfirm!(phone, code); entry.signedUp = true; return r; } }, formMount(document));
      } else {
        const send = signupFor(c);
        entry.handle = window.__cfTools!.email!.renderSignup(document, c.config, { onSignup: async (email, name) => { await send(email, name); entry.signedUp = true; } }, formMount(document));
      }
      track("campaign_impression", c); persist(); flush();
    }
  };
  disposers.push(() => { for (const e of forms.values()) e.handle?.destroy(); forms.clear(); });

  const run = (raw: unknown): void => {
    if (!isConfig(raw)) return; // invalid config: show nothing
    const cfg = raw;
    latest = cfg;
    if (needsCart(cfg)) void cart.prime();

    syncFeed();
    syncRecs(); syncForms();
    const ctx = context();
    const sup = suppression();
    const picked = selectExperiences(cfg, ctx, sup);
    const winner = picked.interruptive ?? picked.ambient;
    if (!winner || active || scheduled.has(winner.campaignId)) return;
    // A restock form is useless without knowing which product it is for.
    if (winner.config.format === "restock" && !ctx.productId) return;
    const isRec = toolOf(winner.config) === "upsell"; // a recommendation card in the toast placement
    if (isRec && noRecs.has(recKey(winner))) return;

    if (heldOut(winner)) return; // control arm: the campaign is intentionally not shown
    track("campaign_eligible", winner);
    scheduled.add(winner.campaignId);

    const present = (products?: RecProduct[]): void => {
      activeId = winner.campaignId;
      activeSlot = slotOf(winner.config);
      session.impressions[winner.campaignId] = (session.impressions[winner.campaignId] ?? 0) + 1;
      persisted.visitorImpressions[winner.campaignId] = (persisted.visitorImpressions[winner.campaignId] ?? 0) + 1;
      active = draw(winner.config, {
        onClick: () => { persisted.clickedAt[winner.campaignId] = Date.now(); persisted.lastClick = { campaignId: winner.campaignId, versionId: winner.versionId, at: Date.now() }; writeClickCookie(persisted.lastClick); track("campaign_click", winner); persist(); flush(); },
        onDismiss: () => {
          persisted.dismissedAt[winner.campaignId] = Date.now();
          session.quietUntil = quietUntilAfterDismiss(Date.now()); // a dismissal quiets interruptive and ambient experiences across every tool
          track("campaign_dismiss", winner); clear(); persist(); flush();
        },
        // A timed-out toast is not a shopper decision: do not record a dismissal or start a quiet period.
        onAutoDismiss: () => { clear(); persist(); },
        ...(toolFor(winner.config) === "email" ? { onSignup: signupFor(winner) } : {}),
        ...(toolFor(winner.config) === "sms" ? smsFor(winner) : {}),
        ...(winner.config.format === "restock" ? { onSubscribe: async (email: string) => {
          const r = await fetch(`${api}/api/v1/notifications/restock`, { method: "POST", credentials: "omit", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ siteId, productId: ctx.productId, email }) });
          if (!r.ok) throw new Error("subscribe failed");
          track("notification_subscribed", winner); flush();
        } } : {}),
        ...(products ? { onProductClick: () => recClick(winner), onAdd: recAdd(winner), canAdd: recCanAdd } : {}),
      }, { ...(cart.state.subtotal !== undefined ? { cartSubtotal: cart.state.subtotal } : {}), ...(cfg.currency ? { currency: cfg.currency } : {}), ...(products ? { products } : {}) });
      if (!active) { clear(); return; } // the tool's script is not there: nothing was drawn, so nothing is counted
      track(products ? "recommendation_impression" : "campaign_impression", winner);
      persist();
      flush();
    };

    // Start fetching the tool's script now, so it is usually there by the time the trigger fires.
    const tool = toolFor(winner.config);
    if (tool) need(tool, () => undefined);

    const show = (): void => {
      if (active || !stillLive(winner)) { scheduled.delete(winner.campaignId); return; }
      if (tool && !window.__cfTools?.[tool]) {
        if (failed.has(tool)) { scheduled.delete(winner.campaignId); return; }
        void loadTool(tool).then((ok) => { if (!ok) failed.add(tool); if (ok && !gone) show(); else scheduled.delete(winner.campaignId); });
        return;
      }
      if (!isRec) { scheduled.delete(winner.campaignId); present(); return; }
      // A recommendation card needs products first. With none, nothing is shown and nothing is counted.
      const k = recKey(winner);
      void fetchRecs(winner).then(
        (ps) => {
          scheduled.delete(winner.campaignId);
          if (ps.length === 0) { noRecs.add(k); return; }
          if (active || !stillLive(winner)) return;
          present(ps);
        },
        () => { scheduled.delete(winner.campaignId); noRecs.add(k); },
      );
    };

    const t = winner.config.trigger;
    switch (t.type) {
      case "immediate": show(); break;
      case "delay": later(show, t.seconds * 1000); break;
      case "idle": later(show, t.seconds * 1000); break;
      case "scroll_depth": {
        const off = listen(window, "scroll", () => {
          const max = document.documentElement.scrollHeight - innerHeight;
          if (max > 0 && (scrollY / max) * 100 >= t.percent) { off(); show(); }
        }, { passive: true });
        break;
      }
      case "exit_intent": {
        const off = listen(document, "mouseleave", (e: MouseEvent) => { if (e.clientY <= 0) { off(); show(); } });
        break;
      }
      case "add_to_cart": {
        const off = cart.onChange((_s, added) => { if (!added) return; off(); later(show, t.delaySeconds * 1000); });
        disposers.push(off);
        break;
      }
      case "cart_threshold": {
        const check = (s: { subtotal?: number }): boolean => {
          if (!isSignalTriggerSatisfied(t, { ...(s.subtotal !== undefined ? { cartSubtotal: s.subtotal } : {}) })) return false;
          off(); show(); return true;
        };
        const off = cart.onChange((s) => { check(s); });
        disposers.push(off);
        check(cart.state);
        break;
      }
    }
  };

  // A cart change can make a different campaign eligible (a subtotal rule, a shipping gap), so re-evaluate when nothing is on screen.
  disposers.push(cart.onChange(() => { if (!active && latest) run(latest); }));

  // Stale-while-revalidate: show from cache instantly, refresh in background. Failure never blocks the page.
  const cached = persisted.cfg;
  const usable = cached && Date.now() - cached.at < 3600_000; // short TTL bounds how long a stale config can be used
  if (usable) run(cached.v);
  fetch(`${api}/sdk/v1/config/${encodeURIComponent(siteId)}.json`, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((v: unknown) => {
      if (!isConfig(v)) return;
      persisted.cfg = { at: Date.now(), v };
      if (hasConsent()) save(localStorage, LS, persisted);
      if (!usable) { run(v); return; }
      latest = v;
      syncFeed();
      syncRecs(); syncForms();
      // Fresh config no longer includes what is on screen (paused, rolled back, kill switch): take it down now.
      if (active && activeId && !(v.deliveryEnabled && v.campaigns.some((c) => c.campaignId === activeId))) clear();
    })
    .catch(() => { /* API down: cached config (if any) already ran */ });
  listen(window, "pagehide", flush);

  window.ConvertFlow.destroy = () => {
    clear();
    scheduled.clear();
    for (const d of disposers.splice(0)) { try { d(); } catch { /* ignore */ } }
    if (window.ConvertFlow) { delete window.ConvertFlow.destroy; window.ConvertFlow.__loaded = false; }
  };
}

const s = document.currentScript;
if (s instanceof HTMLScriptElement) {
  const go = (): void => { try { boot(s); } catch { /* SDK must never throw into the host page */ } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
}
