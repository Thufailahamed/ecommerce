import type { z } from "zod";
import { FONTS, ICONS, type FontKey } from "./schema";

/**
 * Model output is close to the schema but rarely exact: prices as "$24.00", "#fff" colours, font names instead of keys,
 * ids with spaces. These helpers fix what can be fixed unambiguously before validation, and `salvage` drops optional
 * values that still do not validate, so one bad link does not throw away a whole section.
 */

type Json = Record<string, unknown>;
export const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function slugify(s: string, max = 60): string {
  const out = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return out || "item";
}

/** Random, URL-safe, schema-valid id with a readable prefix. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

export const toId = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[_-]+/, "").slice(0, 48);
  return s || null;
};

export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  let s = slugify(base);
  if (!taken.has(s)) return s;
  for (let i = 2; i < 1000; i++) {
    const c = `${s.slice(0, 55)}-${i}`;
    if (!taken.has(c)) return c;
  }
  return `${s.slice(0, 50)}-${Date.now() % 100000}`;
}

export function toMoney(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function toColor(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
  return undefined;
}

const FONT_BY_NAME = new Map<string, FontKey>(Object.entries(FONTS).flatMap(([k, f]) => [[k, k as FontKey], [f.label.toLowerCase(), k as FontKey], [k.replace(/_/g, " "), k as FontKey]]));
export function toFont(v: unknown): FontKey | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (FONT_BY_NAME.has(s)) return FONT_BY_NAME.get(s);
  for (const [name, key] of FONT_BY_NAME) if (s.includes(name)) return key;
  if (/serif/.test(s) && !/sans/.test(s)) return "playfair";
  if (/mono|grotesk|geometric|tech/.test(s)) return "space_grotesk";
  return undefined;
}

const ICON_SET = new Set<string>(ICONS);
const ICON_ALIASES: Record<string, (typeof ICONS)[number]> = {
  shipping: "truck", delivery: "truck", secure: "lock", security: "shield", eco: "leaf", organic: "leaf", sustainable: "recycle",
  quality: "award", returns: "refresh", "return": "refresh", support: "phone", love: "heart", fast: "zap", worldwide: "globe",
  handmade: "feather", natural: "droplet", time: "clock", box: "package", present: "gift", rating: "star", magic: "sparkles",
};
export function toIcon(v: unknown): (typeof ICONS)[number] {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (ICON_SET.has(s)) return s as (typeof ICONS)[number];
    for (const [k, icon] of Object.entries(ICON_ALIASES)) if (s.includes(k)) return icon;
  }
  return "check";
}

/** Fixes the shapes models most often get wrong in an image: a bare string, or `url` instead of `src`. */
export function toImage(v: unknown): Json | undefined {
  if (typeof v === "string") return /^https:\/\//.test(v) ? { src: v, alt: "" } : { src: "", alt: "", prompt: v };
  if (!isObj(v)) return undefined;
  const src = typeof v["src"] === "string" ? v["src"] : typeof v["url"] === "string" ? v["url"] : "";
  const out: Json = { src: /^(https:\/\/|asset:|\/photos\/)/.test(src) ? src : "", alt: typeof v["alt"] === "string" ? v["alt"] : "" };
  const prompt = v["prompt"] ?? v["description"];
  if (typeof prompt === "string" && prompt.trim()) out["prompt"] = prompt;
  return out;
}

/** A link written as a string, or with `url`/`text` keys. */
export function toLink(v: unknown): Json | undefined {
  if (!isObj(v)) return undefined;
  const label = v["label"] ?? v["text"] ?? v["title"];
  const href = v["href"] ?? v["url"] ?? v["link"];
  if (typeof label !== "string" || typeof href !== "string") return undefined;
  return { label, href: href.trim() };
}

const IMAGE_KEYS = new Set(["image", "logo"]);
const LINK_KEYS = new Set(["primaryCta", "secondaryCta", "cta"]);

/** Applies the shape fixes above to a section-like object, in place-safe copy. */
export function coerceSection(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const s: Json = { ...raw };
  for (const k of Object.keys(s)) {
    if (s[k] === null) continue; // null means "remove this field" in an update
    if (IMAGE_KEYS.has(k)) { const img = toImage(s[k]); if (img) s[k] = img; else delete s[k]; }
    if (LINK_KEYS.has(k)) { const l = toLink(s[k]); if (l) s[k] = l; else delete s[k]; }
  }
  if (Array.isArray(s["images"])) s["images"] = (s["images"] as unknown[]).map(toImage).filter(Boolean);
  if (Array.isArray(s["items"]) && s["type"] === "features") s["items"] = (s["items"] as unknown[]).map((i) => isObj(i) ? { ...i, icon: toIcon(i["icon"]) } : i);
  if (s["type"] === "logo_strip" && Array.isArray(s["items"])) s["items"] = (s["items"] as unknown[]).map((i) => isObj(i) ? i["name"] ?? i["label"] : i).filter((x) => typeof x === "string");
  for (const k of ["columns", "limit"]) if (typeof s[k] === "string" && /^\d+$/.test(s[k] as string)) s[k] = Number(s[k]);
  if (typeof s["columns"] === "number") s["columns"] = Math.min(4, Math.max(2, Math.round(s["columns"] as number)));
  for (const k of ["productIds", "collectionIds"]) if (Array.isArray(s[k])) s[k] = (s[k] as unknown[]).map(toId).filter(Boolean);
  if (s["collectionId"] !== undefined) { const c = toId(s["collectionId"]); if (c) s["collectionId"] = c; else delete s["collectionId"]; }
  return s;
}

export function coerceProduct(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const p: Json = { ...raw };
  for (const k of ["price", "compareAtPrice"]) if (p[k] !== undefined && p[k] !== null) { const m = toMoney(p[k]); if (m === undefined) delete p[k]; else p[k] = m; }
  if (p["compareAtPrice"] !== undefined && p["compareAtPrice"] !== null && typeof p["price"] === "number" && (p["compareAtPrice"] as number) <= (p["price"] as number)) p["compareAtPrice"] = null;
  if (p["image"] !== undefined && p["images"] === undefined) { p["images"] = [p["image"]]; delete p["image"]; }
  if (Array.isArray(p["images"])) p["images"] = (p["images"] as unknown[]).map(toImage).filter(Boolean).slice(0, 8);
  if (typeof p["tags"] === "string") p["tags"] = (p["tags"] as string).split(",").map((t) => t.trim()).filter(Boolean);
  if (Array.isArray(p["tags"])) p["tags"] = (p["tags"] as unknown[]).filter((t) => typeof t === "string").slice(0, 12);
  if (Array.isArray(p["options"])) p["options"] = (p["options"] as unknown[]).filter((o) => isObj(o) && Array.isArray(o["values"]) && (o["values"] as unknown[]).length > 0).slice(0, 3);
  if (typeof p["slug"] === "string") p["slug"] = slugify(p["slug"]);
  return p;
}

export function coerceTheme(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const t: Json = { ...raw };
  if (isObj(t["palette"])) {
    const pal: Json = {};
    for (const [k, v] of Object.entries(t["palette"])) { const c = toColor(v); if (c) pal[k] = c; }
    t["palette"] = pal;
  }
  if (isObj(t["fonts"])) {
    const f: Json = {};
    for (const k of ["heading", "body"]) { const font = toFont((t["fonts"] as Json)[k]); if (font) f[k] = font; }
    t["fonts"] = f;
  }
  for (const k of ["headingWeight"]) if (typeof t[k] === "number") t[k] = String(Math.min(800, Math.max(400, Math.round((t[k] as number) / 100) * 100)));
  return t;
}

/**
 * Parses `value`; on failure removes the values the issues point at (an array element, or an optional key) and tries
 * again. Returns null when a required part is wrong, so callers still refuse genuinely broken output.
 */
export function salvage<T extends z.ZodType>(schema: T, value: unknown, rounds = 8): { data: z.infer<T>; dropped: string[] } | null {
  let current: unknown = structuredClone(value);
  const dropped: string[] = [];
  for (let i = 0; i <= rounds; i++) {
    const r = schema.safeParse(current);
    if (r.success) return { data: r.data, dropped };
    let changed = false;
    // Deepest paths first, so removing an array element does not shift the index of a later issue.
    const paths = r.error.issues.map((x) => x.path).filter((p) => p.length > 0).sort((a, b) => b.length - a.length || String(b.at(-1)).localeCompare(String(a.at(-1))));
    const seen = new Set<string>();
    for (const path of paths) {
      const key = path.join(".");
      if (seen.has(key)) continue;
      seen.add(key);
      if (removeAt(current, path)) { dropped.push(key); changed = true; continue; }
      // The value is missing (a required field inside an optional object): drop the object that holds it.
      const parent = path.slice(0, -1);
      if (parent.length && removeAt(current, parent)) { dropped.push(parent.join(".")); changed = true; }
    }
    if (!changed) return null;
  }
  return null;
}

function removeAt(root: unknown, path: PropertyKey[]): boolean {
  let parent: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (!isObj(parent) && !Array.isArray(parent)) return false;
    parent = (parent as Record<PropertyKey, unknown>)[path[i] as PropertyKey];
  }
  const last = path[path.length - 1];
  if (Array.isArray(parent) && typeof last === "number" && last < parent.length) { parent.splice(last, 1); return true; }
  if (isObj(parent) && typeof last === "string" && last in parent) { delete parent[last]; return true; }
  return false;
}
