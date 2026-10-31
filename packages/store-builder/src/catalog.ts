import type { Product, SectionOf, Settings, SiteDocument } from "./schema";

/** Products a featured-products section shows, in the order a shopper sees them. Unavailable products sort last. */
export function productsForSection(doc: SiteDocument, s: SectionOf<"featured_products">): Product[] {
  let list: Product[];
  switch (s.source) {
    case "manual": list = s.productIds.map((id) => doc.products.find((p) => p.id === id)).filter((p): p is Product => Boolean(p)); break;
    case "collection": list = collectionProducts(doc, s.collectionId ?? null); break;
    case "featured": { const f = doc.products.filter((p) => p.featured); list = f.length ? f : doc.products; break; }
    default: list = doc.products;
  }
  return list.slice(0, s.limit);
}

/** A collection's products in the merchant's order; null is every product. */
export function collectionProducts(doc: SiteDocument, collectionId: string | null): Product[] {
  if (!collectionId) return doc.products;
  const c = doc.collections.find((x) => x.id === collectionId);
  if (!c) return doc.products;
  return c.productIds.map((id) => doc.products.find((p) => p.id === id)).filter((p): p is Product => Boolean(p));
}

export function productCategories(products: readonly Product[]): string[] {
  return [...new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))];
}

export function formatMoney(amount: number, currency: string, locale = "en-US"): string {
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}

/* ---------- cart pricing: the server recomputes this from the published document; browsers only display it ---------- */

export interface CartLine { productId: string; quantity: number; options?: Record<string, string> }
export interface PricedLine { productId: string; title: string; slug: string; quantity: number; unitPrice: number; lineTotal: number; options: Record<string, string>; image: string }
export interface PricedCart { lines: PricedLine[]; subtotal: number; shipping: number; total: number; currency: string; issues: string[] }

export const MAX_LINE_QTY = 99;
export const MAX_CART_LINES = 50;

export const lineKey = (l: Pick<CartLine, "productId" | "options">) =>
  `${l.productId}|${Object.entries(l.options ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&")}`;

export function shippingFor(settings: Settings, subtotal: number): number {
  if (subtotal <= 0) return 0;
  if (settings.shipping.freeOver !== null && subtotal >= settings.shipping.freeOver) return 0;
  return settings.shipping.flatRate;
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Prices a cart against the catalogue. Unknown or unavailable products, invalid option choices and bad quantities are
 * dropped with a reason, never priced from what the browser sent.
 */
export function priceCart(doc: SiteDocument, lines: readonly CartLine[]): PricedCart {
  const issues: string[] = [];
  const out: PricedLine[] = [];
  for (const l of lines.slice(0, MAX_CART_LINES)) {
    const p = doc.products.find((x) => x.id === l.productId);
    if (!p) { issues.push("An item in your cart is no longer sold and was removed."); continue; }
    if (!p.available) { issues.push(`${p.title} is sold out and was removed.`); continue; }
    const qty = Math.floor(l.quantity);
    if (!Number.isFinite(qty) || qty < 1) continue;
    const options: Record<string, string> = {};
    let valid = true;
    for (const o of p.options) {
      const v = l.options?.[o.name];
      if (!v || !o.values.includes(v)) { valid = false; break; }
      options[o.name] = v;
    }
    if (!valid) { issues.push(`Choose options for ${p.title}.`); continue; }
    const quantity = Math.min(qty, MAX_LINE_QTY);
    out.push({ productId: p.id, title: p.title, slug: p.slug, quantity, unitPrice: p.price, lineTotal: cents(p.price) * quantity / 100, options, image: p.images[0]?.src ?? "" });
  }
  const subtotal = out.reduce((s, l) => s + cents(l.lineTotal), 0) / 100;
  const shipping = shippingFor(doc.settings, subtotal);
  return { lines: out, subtotal, shipping, total: (cents(subtotal) + cents(shipping)) / 100, currency: doc.settings.currency, issues };
}
