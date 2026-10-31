/**
 * Platform adapters. Each normaliser maps a platform's product payload into the neutral shape
 * the API imports. Availability is `undefined` (stored as "unknown") unless the platform states it.
 */
export interface NormalizedProduct {
  externalId: string;
  title: string;
  url?: string;
  handle?: string;
  imageUrl?: string;
  status: "active" | "draft" | "archived";
  collectionIds: string[];
  variants: { externalId: string; title?: string; price?: number; available?: boolean }[];
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Shopify product webhook / REST payload. Inventory untracked => purchasable => available. */
export function normalizeShopifyProduct(raw: unknown): NormalizedProduct | null {
  const p = obj(raw);
  const id = p["id"] ?? p["admin_graphql_api_id"];
  const title = str(p["title"]);
  if ((typeof id !== "string" && typeof id !== "number") || !title) return null;
  const status = p["status"] === "active" ? "active" : p["status"] === "archived" ? "archived" : "draft";
  const handle = str(p["handle"]);
  return strip<NormalizedProduct>({
    externalId: String(id), title, status, collectionIds: [] as string[],
    ...(handle ? { handle, url: `/products/${handle}` } : {}),
    ...(str(obj(p["image"])["src"]) ? { imageUrl: str(obj(p["image"])["src"]) as string } : {}),
    variants: arr(p["variants"]).map((vr) => {
      const v = obj(vr);
      const tracked = v["inventory_management"] != null;
      const qty = typeof v["inventory_quantity"] === "number" ? v["inventory_quantity"] : undefined;
      const available = !tracked ? true : v["inventory_policy"] === "continue" ? true : qty === undefined ? undefined : qty > 0;
      return strip({ externalId: String(v["id"]), title: str(v["title"]), price: num(v["price"]), available });
    }),
  });
}

/** WooCommerce stock status. "onbackorder" stays unknown: it is neither in stock nor a promise of when. */
const wooAvailable = (stock: unknown): boolean | undefined => (stock === "instock" ? true : stock === "outofstock" ? false : undefined);

/** A variable product's variations come from their own endpoint (`/products/<id>/variations`), not the product payload. */
export const isWooVariable = (raw: unknown): boolean => obj(raw)["type"] === "variable";

/** One WooCommerce REST v3 variation as a variant. Disabled ("private") variations cannot be bought and are left out. */
export function normalizeWooVariation(raw: unknown): NormalizedProduct["variants"][number] | null {
  const v = obj(raw);
  if (v["id"] === undefined || (v["status"] !== undefined && v["status"] !== "publish")) return null;
  const options = arr(v["attributes"]).map((a) => str(obj(a)["option"])).filter((x): x is string => !!x);
  return strip({ externalId: String(v["id"]), title: options.length ? options.join(" / ").slice(0, 200) : undefined, price: num(v["price"]), available: wooAvailable(v["stock_status"]) });
}

/**
 * WooCommerce REST v3 product. A simple product is its own single variant (same id, which is what the storefront's
 * add-to-cart uses). A variable product's variants are its variations: pass them when fetched. Without them the product
 * is returned with no variants, so the import leaves stock it already knows untouched instead of inventing a variant.
 */
export function normalizeWooProduct(raw: unknown, variations?: unknown[]): NormalizedProduct | null {
  const p = obj(raw);
  const title = str(p["name"]);
  if (p["id"] === undefined || !title) return null;
  const permalink = str(p["permalink"]);
  let url: string | undefined;
  try { if (permalink) url = new URL(permalink).pathname; } catch { /* leave undefined */ }
  const img = str(obj(arr(p["images"])[0])["src"]);
  const variants = isWooVariable(p)
    ? (variations ?? []).map(normalizeWooVariation).filter((v): v is NonNullable<typeof v> => v !== null).slice(0, 100)
    : [strip({ externalId: String(p["id"]), price: num(p["price"]), available: wooAvailable(p["stock_status"]) })];
  return strip({
    externalId: String(p["id"]), title: title.slice(0, 300),
    status: p["status"] === "publish" ? ("active" as const) : p["status"] === "trash" ? ("archived" as const) : ("draft" as const),
    collectionIds: arr(p["categories"]).map((c) => String(obj(c)["id"])).filter((x) => x !== "undefined").slice(0, 50),
    url, imageUrl: img,
    variants,
  });
}

/**
 * The facts of a WooCommerce REST v3 order that become an observed purchase: id, total, currency, time. Nothing about the
 * customer is read. Null for orders that are not purchases (yet): drafts from the block checkout, failed or cancelled ones.
 */
export function wooOrderFacts(raw: unknown): { externalOrderId: string; total: number; currency: string; placedAt: string | null } | null {
  const o = obj(raw);
  const id = o["id"];
  if ((typeof id !== "number" && typeof id !== "string") || String(id).length === 0) return null;
  if (["checkout-draft", "failed", "cancelled", "trash", "auto-draft"].includes(String(o["status"] ?? ""))) return null;
  const total = num(o["total"]);
  const currency = String(o["currency"] ?? "").toUpperCase();
  if (total === undefined || !/^[A-Z]{3}$/.test(currency)) return null;
  // date_created_gmt has no zone suffix ("2026-10-27T10:00:00"): it is UTC.
  const gmt = str(o["date_created_gmt"]);
  const placed = gmt ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(gmt) ? gmt : `${gmt}Z`) : NaN;
  return { externalOrderId: String(id).slice(0, 100), total, currency, placedAt: Number.isNaN(placed) ? null : new Date(placed).toISOString() };
}

/** BigCommerce catalog v3 product. */
export function normalizeBigCommerceProduct(raw: unknown): NormalizedProduct | null {
  const p = obj(raw);
  const title = str(p["name"]);
  if (p["id"] === undefined || !title) return null;
  const tracked = p["inventory_tracking"] && p["inventory_tracking"] !== "none";
  const level = typeof p["inventory_level"] === "number" ? p["inventory_level"] : undefined;
  const available = p["availability"] === "disabled" ? false : !tracked ? (p["availability"] === "available" ? true : undefined) : level === undefined ? undefined : level > 0;
  const img = str(obj(arr(p["images"])[0])["url_standard"]);
  return strip({
    externalId: String(p["id"]), title,
    status: p["is_visible"] === false ? ("draft" as const) : ("active" as const),
    collectionIds: arr(p["categories"]).map(String),
    url: str(obj(p["custom_url"])["url"]), imageUrl: img,
    variants: [strip({ externalId: String(p["id"]), price: num(p["price"]), available })],
  });
}

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; if (row.some((c) => c !== "")) rows.push(row); row = [];
    } else cell += ch;
  }
  row.push(cell); if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export interface CsvResult { products: NormalizedProduct[]; errors: string[] }

/** Columns: id,title (required); url,image,price,available,collections (optional, case-insensitive). One row per product. */
export function productsFromCsv(text: string): CsvResult {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (n: string) => head.indexOf(n);
  const errors: string[] = [];
  if (col("id") < 0 || col("title") < 0) return { products: [], errors: ['CSV needs "id" and "title" columns'] };
  const products: NormalizedProduct[] = [];
  rows.forEach((r, i) => {
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    const id = get("id"), title = get("title");
    if (!id || !title) { errors.push(`Row ${i + 2}: missing id or title`); return; }
    const avail = get("available").toLowerCase();
    const price = num(get("price"));
    const available = ["true", "yes", "1", "in stock", "instock"].includes(avail) ? true : ["false", "no", "0", "out of stock", "outofstock"].includes(avail) ? false : undefined;
    products.push(strip({
      externalId: id, title, status: "active" as const,
      collectionIds: get("collections") ? get("collections").split("|").map((c) => c.trim()).filter(Boolean) : [],
      url: get("url") || undefined, imageUrl: get("image") || undefined,
      variants: [strip({ externalId: id, price, available })],
    }));
  });
  return { products, errors };
}

export * from "./providers";
export * from "./sms";
export * from "./capabilities";
