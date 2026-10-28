import type { RecProduct } from "./recommend";

/**
 * Adding a recommended product to the cart, on any platform. In order of preference:
 *  1. ConvertFlow.addToCart(item): the store's own function, for custom sites and platform plugins (works anywhere).
 *  2. Shopify: POST <root>cart/add.js with the variant id (the storefront cart API every theme supports).
 *  3. WooCommerce: the store's own wc-ajax add_to_cart endpoint, then the `added_to_cart` event so its mini-cart refreshes.
 * With none of these a product simply links to its page: the SDK never pretends something was added.
 *
 * The Shopify and WooCommerce paths are tested against fakes only. They have not been run on a live store (see docs/status.md).
 */
export interface CartInput { subtotal?: number; itemCount?: number; productIds?: string[] }

export interface Adder {
  kind: "custom" | "shopify" | "woocommerce";
  /** Resolves when the product is in the cart; rejects when it is not. */
  add(p: RecProduct): Promise<CartInput | undefined>;
  /** True when the cart tracker already saw this add (it watches Shopify requests and Woo's event), so the SDK must not report it twice. */
  tracked: boolean;
}

type Win = Window & {
  ConvertFlow?: { addToCart?: (item: { productId: string; variantId?: string; quantity: 1 }) => unknown };
  Shopify?: { routes?: { root?: string } };
  wc_add_to_cart_params?: { wc_ajax_url?: string };
  jQuery?: (el: unknown) => { trigger(e: string, args?: unknown[]): unknown };
};

/** A Shopify variant id is numeric; a GraphQL gid ends in the number. Anything else cannot be added by id. */
export function shopifyVariantId(v: string | undefined): number | undefined {
  const m = v === undefined ? null : /^(?:gid:\/\/shopify\/ProductVariant\/)?(\d{1,20})$/.exec(v);
  return m ? Number(m[1]) : undefined;
}

const cartOf = (j: unknown): CartInput | undefined => {
  const c = j as CartInput | null | undefined;
  if (!c || typeof c !== "object") return undefined;
  return {
    ...(typeof c.subtotal === "number" ? { subtotal: c.subtotal } : {}),
    ...(typeof c.itemCount === "number" ? { itemCount: c.itemCount } : {}),
    ...(Array.isArray(c.productIds) ? { productIds: c.productIds } : {}),
  };
};

export function resolveAdder(win: Win, p: RecProduct): Adder | undefined {
  if (typeof win.ConvertFlow?.addToCart === "function") {
    const fn = win.ConvertFlow.addToCart;
    return { kind: "custom", tracked: false, add: async (x) => cartOf(await fn.call(win.ConvertFlow, { productId: x.id, ...(x.variantId ? { variantId: x.variantId } : {}), quantity: 1 })) };
  }
  if (win.Shopify && typeof win.fetch === "function" && shopifyVariantId(p.variantId) !== undefined) {
    return {
      kind: "shopify", tracked: true,
      add: async (x) => {
        const root = win.Shopify?.routes?.root ?? "/";
        const r = await win.fetch(`${root}cart/add.js`, {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ items: [{ id: shopifyVariantId(x.variantId), quantity: 1 }] }),
        });
        if (!r.ok) throw new Error(`cart/add ${r.status}`); // 422 = the variant sold out meanwhile
        return undefined;
      },
    };
  }
  const wc = win.wc_add_to_cart_params?.wc_ajax_url;
  if (typeof wc === "string" && wc.includes("%%endpoint%%") && typeof win.fetch === "function") {
    return {
      kind: "woocommerce", tracked: typeof win.jQuery === "function",
      add: async (x) => {
        const r = await win.fetch(wc.replace("%%endpoint%%", "add_to_cart"), {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ product_id: x.id, quantity: "1" }).toString(),
        });
        const j = (await r.json().catch(() => null)) as { error?: unknown; fragments?: unknown; cart_hash?: unknown } | null;
        if (!r.ok || !j || j.error) throw new Error("add_to_cart failed"); // Woo answers 200 with {error: true, product_url} when it cannot add
        try { win.jQuery?.(win.document.body).trigger("added_to_cart", [j.fragments, j.cart_hash]); } catch { /* the theme's own listeners must not fail the add */ }
        return undefined;
      },
    };
  }
  return undefined;
}
