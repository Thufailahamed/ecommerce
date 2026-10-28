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

/** WooCommerce REST v3 product. */
export function normalizeWooProduct(raw: unknown): NormalizedProduct | null {
  const p = obj(raw);
  const title = str(p["name"]);
  if (p["id"] === undefined || !title) return null;
  const stock = p["stock_status"];
  const available = stock === "instock" ? true : stock === "outofstock" ? false : undefined;
  const permalink = str(p["permalink"]);
  let url: string | undefined;
  try { if (permalink) url = new URL(permalink).pathname; } catch { /* leave undefined */ }
  const img = str(obj(arr(p["images"])[0])["src"]);
  return strip({
    externalId: String(p["id"]), title,
    status: p["status"] === "publish" ? ("active" as const) : p["status"] === "trash" ? ("archived" as const) : ("draft" as const),
    collectionIds: arr(p["categories"]).map((c) => String(obj(c)["id"])).filter((x) => x !== "undefined"),
    url, imageUrl: img,
    variants: [strip({ externalId: String(p["id"]), price: num(p["price"]), available })],
  });
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
