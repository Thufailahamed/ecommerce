import { z } from "zod";
import {
  Brand, Collection, Navigation, Page, Product, Section, Settings, SiteDocument, Theme,
  type SiteDocument as Doc, type Section as SectionT,
} from "./schema";
import { coerceProduct, coerceSection, coerceTheme, isObj, newId, salvage, slugify, toId, toImage, uniqueSlug } from "./normalize";
import { repairPalette } from "./theme";
import { SECTION_DEFS } from "./sections";

/**
 * Every change to a store, from the AI or from the editor, is one of these operations. Operations are applied one at a
 * time and the whole document is validated after each, so an operation either lands completely or not at all, and a
 * bad one never takes the good ones down with it.
 */

const Obj = z.record(z.string(), z.unknown());
const Ref = z.string().min(1).max(60);

export const Operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_brand"), brand: Obj }),
  z.object({ op: z.literal("set_theme"), theme: Obj }),
  z.object({ op: z.literal("set_settings"), settings: Obj }),
  z.object({ op: z.literal("set_navigation"), navigation: Obj }),
  z.object({ op: z.literal("add_page"), page: Obj }),
  z.object({ op: z.literal("update_page"), page: Ref, props: Obj }),
  z.object({ op: z.literal("remove_page"), page: Ref }),
  /** `after`: a section id to insert after, or "start". Omitted: at the end of the page. */
  z.object({ op: z.literal("add_section"), page: Ref, section: Obj, after: Ref.optional() }),
  z.object({ op: z.literal("update_section"), section: Ref, props: Obj }),
  z.object({ op: z.literal("replace_section"), section: Ref, with: Obj }),
  z.object({ op: z.literal("remove_section"), section: Ref }),
  z.object({ op: z.literal("move_section"), section: Ref, to: z.number().int().min(0).max(100) }),
  z.object({ op: z.literal("add_product"), product: Obj }),
  z.object({ op: z.literal("update_product"), product: Ref, props: Obj }),
  z.object({ op: z.literal("remove_product"), product: Ref }),
  z.object({ op: z.literal("add_collection"), collection: Obj }),
  z.object({ op: z.literal("update_collection"), collection: Ref, props: Obj }),
  z.object({ op: z.literal("remove_collection"), collection: Ref }),
]);
export type Operation = z.infer<typeof Operation>;
export const OPERATION_NAMES = Operation.options.map((o) => o.shape.op.value);

export interface AppliedOp { op: Operation["op"]; target: string; summary: string; dropped?: string[] }
export interface FailedOp { op: string; target?: string; error: string }
export interface ApplyResult { doc: Doc; applied: AppliedOp[]; failed: FailedOp[] }

class OpError extends Error {}

/** Shallow merge where `null` deletes a key and nested plain objects (image, cta, seo) merge one level deep. */
function merge(base: Record<string, unknown>, patch: Record<string, unknown>, protectedKeys: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (protectedKeys.includes(k)) continue;
    if (v === null) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = { ...(out[k] as Record<string, unknown>), ...v };
    else out[k] = v;
  }
  return out;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = v === null ? undefined : deepMerge(out[k], v);
  return out;
}

const findSection = (doc: Doc, id: string) => {
  for (const page of doc.pages) {
    const i = page.sections.findIndex((s) => s.id === id);
    if (i >= 0) return { page, index: i, section: page.sections[i]! };
  }
  throw new OpError(`no section "${id}"`);
};
const findPage = (doc: Doc, ref: string) => {
  const p = doc.pages.find((x) => x.id === ref) ?? doc.pages.find((x) => x.slug === ref || (ref === "home" && x.slug === ""));
  if (!p) throw new OpError(`no page "${ref}"`);
  return p;
};
const findProduct = (doc: Doc, ref: string) => {
  const p = doc.products.find((x) => x.id === ref) ?? doc.products.find((x) => x.slug === ref);
  if (!p) throw new OpError(`no product "${ref}"`);
  return p;
};
const findCollection = (doc: Doc, ref: string) => {
  const c = doc.collections.find((x) => x.id === ref) ?? doc.collections.find((x) => x.slug === ref);
  if (!c) throw new OpError(`no collection "${ref}"`);
  return c;
};

const allSectionIds = (doc: Doc) => new Set(doc.pages.flatMap((p) => p.sections.map((s) => s.id)));

/** Parses a section from model or editor input; fills in the type's defaults, repairs shapes, drops invalid optional values. */
export function buildSection(raw: Record<string, unknown>, taken: ReadonlySet<string>): { section: SectionT; dropped: string[] } {
  const type = raw["type"];
  if (typeof type !== "string" || !(type in SECTION_DEFS)) throw new OpError(`unknown section type "${String(type)}"`);
  const def = SECTION_DEFS[type as SectionT["type"]];
  let id = toId(raw["id"]);
  if (!id || taken.has(id)) id = newId(type.replace(/_/g, "").slice(0, 8));
  const candidate = { ...def.create(), ...(coerceSection(raw) as Record<string, unknown>), id, type };
  const r = salvage(Section, candidate);
  if (!r) throw new OpError(`the ${def.label.toLowerCase()} section is not valid`);
  return { section: r.data, dropped: r.dropped };
}

function buildProduct(raw: Record<string, unknown>, doc: Doc, keepId?: string): { product: z.infer<typeof Product>; dropped: string[] } {
  const p = coerceProduct(raw) as Record<string, unknown>;
  const title = typeof p["title"] === "string" ? p["title"] : "";
  const takenIds = new Set(doc.products.map((x) => x.id).filter((x) => x !== keepId));
  const takenSlugs = new Set(doc.products.filter((x) => x.id !== keepId).map((x) => x.slug));
  let id = keepId ?? toId(p["id"]);
  if (!id || takenIds.has(id)) id = newId("prod");
  const slugBase = typeof p["slug"] === "string" && p["slug"] ? p["slug"] : title || id;
  const slug = takenSlugs.has(slugify(slugBase)) ? uniqueSlug(slugBase, takenSlugs) : slugify(slugBase);
  const r = salvage(Product, { ...p, id, slug });
  if (!r) throw new OpError(`product "${title || id}" is not valid (it needs a title and a price)`);
  return { product: r.data, dropped: r.dropped };
}

function buildCollection(raw: Record<string, unknown>, doc: Doc, keepId?: string) {
  const c: Record<string, unknown> = { ...raw };
  const title = typeof c["title"] === "string" ? c["title"] : "";
  const takenIds = new Set(doc.collections.map((x) => x.id).filter((x) => x !== keepId));
  const takenSlugs = new Set(["all", ...doc.collections.filter((x) => x.id !== keepId).map((x) => x.slug)]);
  let id = keepId ?? toId(c["id"]);
  if (!id || takenIds.has(id)) id = newId("col");
  const slugBase = typeof c["slug"] === "string" && c["slug"] ? c["slug"] : title || id;
  const slug = takenSlugs.has(slugify(slugBase)) ? uniqueSlug(slugBase, takenSlugs) : slugify(slugBase);
  // Product references may be slugs or ids; keep only the ones that exist.
  const known = new Map(doc.products.flatMap((p) => [[p.id, p.id], [p.slug, p.id]] as const));
  if (Array.isArray(c["productIds"])) c["productIds"] = [...new Set((c["productIds"] as unknown[]).map((x) => (typeof x === "string" ? known.get(x) : undefined)).filter(Boolean))];
  if (c["image"] !== undefined) { const img = toImage(c["image"]); if (img) c["image"] = img; else delete c["image"]; }
  const r = salvage(Collection, { ...c, id, slug });
  if (!r) throw new OpError(`collection "${title || id}" is not valid`);
  return { collection: r.data, dropped: r.dropped };
}

/** Removes references to a deleted product or collection so nothing points at it. */
function dropReferences(doc: Doc, kind: "product" | "collection", id: string) {
  for (const page of doc.pages) {
    page.sections = page.sections.map((s) => {
      if (kind === "product" && s.type === "featured_products") return { ...s, productIds: s.productIds.filter((x) => x !== id) };
      if (kind === "collection" && s.type === "featured_products" && s.collectionId === id) { const { collectionId: _c, ...rest } = s; return { ...rest, source: "featured" as const }; }
      if (kind === "collection" && s.type === "product_grid" && s.collectionId === id) { const { collectionId: _c, ...rest } = s; return rest; }
      if (kind === "collection" && s.type === "collection_list") return { ...s, collectionIds: s.collectionIds.filter((x) => x !== id) };
      return s;
    });
  }
  if (kind === "product") doc.collections = doc.collections.map((c) => ({ ...c, productIds: c.productIds.filter((x) => x !== id) }));
}

function applyOne(doc: Doc, op: Operation): AppliedOp & { doc: Doc } {
  const d = structuredClone(doc);
  let target = "";
  let summary = "";
  let dropped: string[] = [];
  switch (op.op) {
    case "set_brand": {
      const r = salvage(Brand, merge(d.brand, op.brand));
      if (!r) throw new OpError("brand is not valid");
      d.brand = r.data; dropped = r.dropped; target = "brand"; summary = "Updated brand";
      break;
    }
    case "set_theme": {
      const merged = deepMerge(d.theme, coerceTheme(op.theme));
      const r = salvage(Theme, merged);
      if (!r) throw new OpError("theme is not valid");
      d.theme = { ...r.data, palette: repairPalette(r.data.palette).palette };
      dropped = r.dropped; target = "theme"; summary = "Updated theme";
      break;
    }
    case "set_settings": {
      const r = salvage(Settings, deepMerge(d.settings, op.settings));
      if (!r) throw new OpError("settings are not valid");
      d.settings = r.data; dropped = r.dropped; target = "settings"; summary = "Updated store settings";
      break;
    }
    case "set_navigation": {
      const r = salvage(Navigation, merge(d.navigation, op.navigation));
      if (!r) throw new OpError("navigation is not valid");
      d.navigation = r.data; dropped = r.dropped; target = "navigation"; summary = "Updated navigation";
      break;
    }
    case "add_page": {
      const raw = op.page;
      const title = typeof raw["title"] === "string" ? raw["title"] : "Page";
      const takenSlugs = new Set(d.pages.map((p) => p.slug));
      const want = typeof raw["slug"] === "string" ? slugify(raw["slug"]) : slugify(title);
      if (raw["slug"] === "" && takenSlugs.has("")) throw new OpError("the store already has a home page");
      const slug = raw["slug"] === "" ? "" : takenSlugs.has(want) ? uniqueSlug(want, takenSlugs) : want;
      let id = toId(raw["id"]);
      if (!id || d.pages.some((p) => p.id === id)) id = slug ? slugify(slug, 40).replace(/-/g, "_") : "home";
      if (d.pages.some((p) => p.id === id)) id = newId("page");
      const taken = allSectionIds(d);
      const sections = (Array.isArray(raw["sections"]) ? raw["sections"] : []).filter(isObj).map((s) => {
        const b = buildSection(s, taken);
        taken.add(b.section.id);
        return b.section;
      });
      const r = salvage(Page, { ...raw, id, slug, title, sections });
      if (!r) throw new OpError(`page "${title}" is not valid`);
      d.pages.push(r.data); target = r.data.id; summary = `Added page "${r.data.title}"`; dropped = r.dropped;
      break;
    }
    case "update_page": {
      const p = findPage(d, op.page);
      const props = { ...op.props };
      delete props["sections"]; delete props["id"];
      if (typeof props["slug"] === "string") {
        if (p.slug === "") delete props["slug"]; // the home page always lives at "/"
        else props["slug"] = slugify(props["slug"]);
      }
      const r = salvage(Page, merge(p, props));
      if (!r) throw new OpError(`page "${p.title}" update is not valid`);
      d.pages[d.pages.indexOf(p)] = r.data; target = p.id; summary = `Updated page "${r.data.title}"`; dropped = r.dropped;
      break;
    }
    case "remove_page": {
      const p = findPage(d, op.page);
      if (p.slug === "") throw new OpError("the home page cannot be removed");
      d.pages = d.pages.filter((x) => x.id !== p.id); target = p.id; summary = `Removed page "${p.title}"`;
      break;
    }
    case "add_section": {
      const p = findPage(d, op.page);
      const b = buildSection(op.section, allSectionIds(d));
      let at = p.sections.length;
      if (op.after === "start") at = 0;
      else if (op.after) { const i = p.sections.findIndex((s) => s.id === op.after); if (i >= 0) at = i + 1; }
      p.sections.splice(at, 0, b.section);
      target = b.section.id; summary = `Added ${SECTION_DEFS[b.section.type].label.toLowerCase()} to ${p.title}`; dropped = b.dropped;
      break;
    }
    case "update_section": {
      const { page, index, section } = findSection(d, op.section);
      const patched = merge(section as unknown as Record<string, unknown>, coerceSection({ ...op.props, type: section.type }) as Record<string, unknown>, ["id", "type"]);
      const r = salvage(Section, patched);
      if (!r) throw new OpError(`the ${SECTION_DEFS[section.type].label.toLowerCase()} update is not valid`);
      page.sections[index] = r.data; target = section.id; summary = `Edited ${SECTION_DEFS[section.type].label.toLowerCase()}`; dropped = r.dropped;
      break;
    }
    case "replace_section": {
      const { page, index, section } = findSection(d, op.section);
      const taken = allSectionIds(d); taken.delete(section.id);
      const b = buildSection({ ...op.with, id: section.id }, taken);
      page.sections[index] = b.section; target = section.id; summary = `Rebuilt ${SECTION_DEFS[b.section.type].label.toLowerCase()}`; dropped = b.dropped;
      break;
    }
    case "remove_section": {
      const { page, index, section } = findSection(d, op.section);
      page.sections.splice(index, 1); target = section.id; summary = `Removed ${SECTION_DEFS[section.type].label.toLowerCase()}`;
      break;
    }
    case "move_section": {
      const { page, index, section } = findSection(d, op.section);
      page.sections.splice(index, 1);
      page.sections.splice(Math.min(op.to, page.sections.length), 0, section);
      target = section.id; summary = `Moved ${SECTION_DEFS[section.type].label.toLowerCase()}`;
      break;
    }
    case "add_product": {
      const b = buildProduct(op.product, d);
      d.products.push(b.product);
      // A collection named on the product ("collection": "Mugs") links it, when that collection exists.
      const col = op.product["collection"] ?? op.product["collectionId"];
      if (typeof col === "string") {
        const c = d.collections.find((x) => x.id === col || x.slug === slugify(col) || x.title.toLowerCase() === col.toLowerCase());
        if (c && !c.productIds.includes(b.product.id)) c.productIds.push(b.product.id);
      }
      target = b.product.id; summary = `Added product "${b.product.title}"`; dropped = b.dropped;
      break;
    }
    case "update_product": {
      const p = findProduct(d, op.product);
      const b = buildProduct(merge(p as unknown as Record<string, unknown>, op.props, ["id"]), d, p.id);
      d.products[d.products.indexOf(p)] = b.product; target = p.id; summary = `Updated product "${b.product.title}"`; dropped = b.dropped;
      break;
    }
    case "remove_product": {
      const p = findProduct(d, op.product);
      d.products = d.products.filter((x) => x.id !== p.id);
      dropReferences(d, "product", p.id); target = p.id; summary = `Removed product "${p.title}"`;
      break;
    }
    case "add_collection": {
      const b = buildCollection(op.collection, d);
      d.collections.push(b.collection); target = b.collection.id; summary = `Added collection "${b.collection.title}"`; dropped = b.dropped;
      break;
    }
    case "update_collection": {
      const c = findCollection(d, op.collection);
      const b = buildCollection(merge(c as unknown as Record<string, unknown>, op.props, ["id"]), d, c.id);
      d.collections[d.collections.indexOf(c)] = b.collection; target = c.id; summary = `Updated collection "${b.collection.title}"`; dropped = b.dropped;
      break;
    }
    case "remove_collection": {
      const c = findCollection(d, op.collection);
      d.collections = d.collections.filter((x) => x.id !== c.id);
      dropReferences(d, "collection", c.id); target = c.id; summary = `Removed collection "${c.title}"`;
      break;
    }
  }
  const parsed = SiteDocument.safeParse(d);
  if (!parsed.success) throw new OpError(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return { doc: parsed.data, op: op.op, target, summary, ...(dropped.length ? { dropped } : {}) };
}

/** Applies operations in order. Invalid ones are reported and skipped; the rest still apply. */
export function applyOps(doc: Doc, ops: readonly unknown[]): ApplyResult {
  let current = doc;
  const applied: AppliedOp[] = [];
  const failed: FailedOp[] = [];
  for (const raw of ops) {
    const parsed = Operation.safeParse(raw);
    if (!parsed.success) {
      failed.push({ op: isObj(raw) && typeof raw["op"] === "string" ? raw["op"] : "unknown", error: `not a valid operation (${parsed.error.issues[0]?.message ?? "invalid"})` });
      continue;
    }
    try {
      const { doc: next, ...info } = applyOne(current, parsed.data);
      current = next;
      applied.push(info);
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      const op = parsed.data;
      const target = "section" in op && typeof op.section === "string" ? op.section : "product" in op && typeof op.product === "string" ? op.product : "page" in op && typeof op.page === "string" ? op.page : undefined;
      failed.push({ op: op.op, ...(target ? { target } : {}), error: e.message });
    }
  }
  return { doc: current, applied, failed };
}
