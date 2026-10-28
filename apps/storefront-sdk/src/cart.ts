/**
 * Cart awareness, without assuming a platform. Three sources, all optional, all feeding one state:
 *  1. The public API (works on any store): ConvertFlow.setCart({ subtotal, itemCount }) and ConvertFlow.trackAddToCart().
 *  2. Shopify: observes the storefront's own /cart/add, /cart/change, /cart/update requests, then reads /cart.js.
 *  3. WooCommerce: listens for the `added_to_cart` jQuery event.
 *
 * Unknown stays unknown: a subtotal is only ever set from real data, never estimated. The Shopify and WooCommerce
 * hooks are tested against fakes only; they have not been run on a live store (see docs/status.md).
 */
export interface CartState { subtotal?: number; itemCount?: number; /** Catalog ids of what is in the cart, when the platform tells us. */ productIds?: string[] }

type CartInput = { subtotal?: number; itemCount?: number; productIds?: string[] };

export interface CartTracker {
  readonly state: CartState;
  /** Called whenever the cart is learned or changes; `added` is true when an item was just added. Returns an unsubscribe. */
  onChange(cb: (s: CartState, added: boolean) => void): () => void;
  /** Read the cart once (Shopify only). Safe to call repeatedly; a no-op elsewhere. */
  prime(): Promise<void>;
  destroy(): void;
}

type Listener = (s: CartState, added: boolean) => void;
type Win = Window & {
  Shopify?: unknown;
  jQuery?: (el: unknown) => { on(e: string, f: () => void): unknown; off(e: string, f: () => void): unknown };
};

/** Locale prefixes are allowed (/en-ca/cart/add.js). */
const CART_MUTATION = /\/cart\/(add|change|update|clear)(\.js|\.json)?$/;

export function createCartTracker(win: Win, publicApi: Record<string, unknown>): CartTracker {
  const state: CartState = {};
  const listeners = new Set<Listener>();
  const disposers: Array<() => void> = [];
  let primeFn: (() => Promise<void>) | undefined;

  const emit = (added: boolean): void => {
    for (const l of [...listeners]) { try { l({ ...state }, added); } catch { /* a listener must never break the page */ } }
  };
  const set = (subtotal: unknown, itemCount: unknown, productIds?: unknown): void => {
    if (typeof subtotal === "number" && Number.isFinite(subtotal) && subtotal >= 0) state.subtotal = subtotal;
    if (typeof itemCount === "number" && Number.isInteger(itemCount) && itemCount >= 0) state.itemCount = itemCount;
    if (Array.isArray(productIds)) state.productIds = productIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 100).slice(0, 50);
  };

  // 1. Public API, for custom stores and any platform plugin.
  publicApi["setCart"] = (c: CartInput | null | undefined): void => { if (c) { set(c.subtotal, c.itemCount, c.productIds); emit(false); } };
  publicApi["trackAddToCart"] = (c?: CartInput | null): void => { if (c) set(c.subtotal, c.itemCount, c.productIds); emit(true); };

  // 2. Shopify.
  if (win.Shopify && typeof win.fetch === "function") {
    const original = win.fetch;
    // Always `.call(win, ...)`: invoking fetch as a method of any other object throws "Illegal invocation".
    const rawFetch: typeof fetch = (input, init) => original.call(win, input, init);

    const readCart = async (): Promise<void> => {
      try {
        const r = await rawFetch("/cart.js", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (!r.ok) return;
        const j = (await r.json()) as { items_subtotal_price?: unknown; item_count?: unknown; items?: { product_id?: unknown }[] };
        // /cart.js reports money in minor units (cents). Zero-decimal currencies are not verified: see docs/status.md.
        set(typeof j.items_subtotal_price === "number" ? j.items_subtotal_price / 100 : undefined, j.item_count,
          Array.isArray(j.items) ? j.items.map((i) => (i && (typeof i.product_id === "number" || typeof i.product_id === "string") ? String(i.product_id) : "")) : undefined);
      } catch { /* leave the cart unknown */ }
    };

    const wrapped: typeof fetch = (input, init) => {
      const p = rawFetch(input, init);
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const m = CART_MUTATION.exec(new URL(url, win.location.href).pathname);
        if (m) void p.then((res) => { if (res.ok) void readCart().then(() => emit(m[1] === "add")); }, () => undefined);
      } catch { /* never interfere with the shop's own request */ }
      return p;
    };
    win.fetch = wrapped;
    disposers.push(() => { if (win.fetch === wrapped) win.fetch = original; });

    let primed: Promise<void> | undefined;
    primeFn = () => (primed ??= readCart().then(() => emit(false)));
  }

  // 3. WooCommerce (jQuery event; it carries no cart total, so the subtotal stays unknown unless setCart is used).
  try {
    if (win.jQuery && win.document?.body) {
      const h = (): void => emit(true);
      const $body = win.jQuery(win.document.body);
      $body.on("added_to_cart", h);
      disposers.push(() => { try { $body.off("added_to_cart", h); } catch { /* ignore */ } });
    }
  } catch { /* ignore */ }

  return {
    state,
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    prime: () => primeFn?.() ?? Promise.resolve(),
    destroy() {
      listeners.clear();
      for (const d of disposers.splice(0)) d();
      delete publicApi["setCart"]; delete publicApi["trackAddToCart"];
    },
  };
}
