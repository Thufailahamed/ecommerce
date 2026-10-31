import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { CampaignConfig, SHIPPED_TOOLS, type RecommendOptions } from "@convertflow/contracts";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { entitlementsFor } from "./entitlements.js";
import { publishConfig } from "./campaigns.js";
import { resolveSite } from "./sites.js";
import { recordAudit } from "./audit.js";

const { products, productVariants: variants, productRelationships: rel, stores } = schema;

/** What the storefront receives for one recommended product. Never personal data, never anything the shopper could not already see. */
export interface RecProduct {
  id: string;
  title: string;
  url: string;
  imageUrl?: string;
  /** The lowest price among the variants that are in stock, in store currency. Omitted when the catalog has none. */
  price?: number;
  /** Present only for a product with a single variant, which can be added to the cart without choosing options. */
  variantId?: string;
  addable: boolean;
}

/** What the browser tells us about the page. It only narrows which catalog items are relevant; it cannot widen what is shown. */
export interface RecContext {
  /** Catalog external id of the product being viewed. */
  productId?: string | undefined;
  /** External ids of products already in the cart: never recommended back. */
  cartProductIds: string[];
  cartSubtotal?: number | undefined;
}

const CANDIDATES = 60; // how many ordered candidates to look at before the availability filter trims them
export const MAX_CART_IDS = 20;
export const MAX_RELATIONS_PER_PRODUCT = 50;
export const MAX_RELATIONS_PER_STORE = 5000;

const isSafeUrl = (u: string): boolean => (/^\/(?![\/\\])/.test(u) || /^https:\/\//i.test(u)) && !/[\u0000-\u001f\u007f\\]/.test(u);

type ProductRow = typeof products.$inferSelect;
type Availability = "in_stock" | "out_of_stock" | "unknown";

/** Product-level availability: in stock if any variant is, out of stock only when every variant is known to be, otherwise unknown. */
function availabilityOf(vs: { availability: Availability }[]): Availability {
  return vs.some((v) => v.availability === "in_stock") ? "in_stock" : vs.length > 0 && vs.every((v) => v.availability === "out_of_stock") ? "out_of_stock" : "unknown";
}

/**
 * Turns an ordered list of candidate product rows into what the storefront may show. This is the single place the
 * "never recommend something unavailable" rule lives: only products the catalog positively says are in stock pass
 * (unknown is not assumed in stock), and each needs a link the browser can safely follow.
 */
async function hydrate(d: Deps, storeId: string, ordered: ProductRow[], exclude: Set<string>, limit: number): Promise<RecProduct[]> {
  const rows = ordered.filter((p) => p.status === "active" && !exclude.has(p.externalId));
  if (rows.length === 0) return [];
  const vs = await d.db.select().from(variants).where(and(eq(variants.storeId, storeId), inArray(variants.productId, rows.map((p) => p.id))));
  const out: RecProduct[] = [];
  const seen = new Set<string>();
  for (const p of rows) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const mine = vs.filter((v) => v.productId === p.id);
    if (availabilityOf(mine) !== "in_stock") continue;
    const path = p.url ?? (p.handle ? `/products/${encodeURIComponent(p.handle)}` : undefined);
    const url = path && isSafeUrl(path) ? path : p.handle ? `/products/${encodeURIComponent(p.handle)}` : undefined;
    if (!url) continue;
    const inStock = mine.filter((v) => v.availability === "in_stock");
    const prices = inStock.map((v) => v.price).filter((x): x is number => typeof x === "number");
    const single = mine.length === 1 ? mine[0] : undefined;
    out.push({
      id: p.externalId, title: p.title, url,
      ...(p.imageUrl && isSafeUrl(p.imageUrl) ? { imageUrl: p.imageUrl } : {}),
      ...(prices.length ? { price: Math.min(...prices) } : {}),
      ...(single ? { variantId: single.externalId } : {}),
      addable: Boolean(single),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Rows for these catalog ids, returned in the order asked. Unknown ids are skipped. */
async function byExternalIds(d: Deps, storeId: string, ids: string[]): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const rows = await d.db.select().from(products).where(and(eq(products.storeId, storeId), inArray(products.externalId, ids)));
  const by = new Map(rows.map((r) => [r.externalId, r]));
  return ids.flatMap((id) => { const r = by.get(id); return r ? [r] : []; });
}

async function byDbIds(d: Deps, ids: string[]): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const rows = await d.db.select().from(products).where(inArray(products.id, ids));
  const by = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => { const r = by.get(id); return r ? [r] : []; });
}

const related = async (d: Deps, storeId: string, from: string[], kind: "complement" | "alternative"): Promise<ProductRow[]> => {
  if (from.length === 0) return [];
  // Ties break by the catalog id (not the internal row id, which is random), so the same links always give the same order.
  const links = await d.db.select({ to: rel.relatedProductId }).from(rel)
    .innerJoin(products, eq(products.id, rel.relatedProductId))
    .where(and(eq(rel.storeId, storeId), eq(rel.kind, kind), inArray(rel.productId, from)))
    .orderBy(desc(rel.weight), asc(products.externalId)).limit(CANDIDATES);
  return byDbIds(d, [...new Set(links.map((l) => l.to))]);
};

const inCollections = async (d: Deps, storeId: string, collectionIds: string[]): Promise<ProductRow[]> => {
  if (collectionIds.length === 0) return [];
  // collection_ids is a JSON array of external ids, so membership is a json_each lookup. Title then id keeps the order stable.
  return d.db.select().from(products).where(and(
    eq(products.storeId, storeId), eq(products.status, "active"),
    sql`exists (select 1 from json_each(${products.collectionIds}) where json_each.value in (${sql.join(collectionIds.map((c) => sql`${c}`), sql`, `)}))`,
  )).orderBy(sql`${products.title} collate nocase`, asc(products.externalId)).limit(CANDIDATES);
};

/**
 * The deterministic recommender. Same catalog, same relationships and same context always give the same answer,
 * and every item can be explained by its source: a merchant pick, a shared collection, a merchant-set complement or
 * alternative, or a price that closes the gap to free shipping. Nothing is inferred from shopper behaviour.
 */
export async function recommend(d: Deps, storeId: string, o: RecommendOptions, ctx: RecContext): Promise<RecProduct[]> {
  const exclude = new Set<string>([...o.excludeProductIds, ...ctx.cartProductIds]);
  if (ctx.productId) exclude.add(ctx.productId);
  const viewed = ctx.productId ? (await byExternalIds(d, storeId, [ctx.productId]))[0] : undefined;
  const cartRows = ctx.cartProductIds.length ? await byExternalIds(d, storeId, ctx.cartProductIds.slice(0, MAX_CART_IDS)) : [];
  // Products the shopper is looking at or holding: the starting points for relationships and collections.
  const anchors = viewed ? [viewed] : cartRows;

  let candidates: ProductRow[] = [];
  switch (o.source) {
    case "manual":
      candidates = await byExternalIds(d, storeId, o.productIds);
      break;
    case "same_collection": {
      const ids = o.collectionIds.length ? o.collectionIds : [...new Set(anchors.flatMap((p) => p.collectionIds))];
      candidates = await inCollections(d, storeId, ids);
      break;
    }
    case "complements":
      candidates = await related(d, storeId, anchors.map((p) => p.id), "complement");
      break;
    case "alternatives": {
      // Only for a product the catalog positively says is unavailable: a substitute for something in stock is just a distraction.
      if (!viewed) return [];
      const vs = await d.db.select({ availability: variants.availability }).from(variants).where(and(eq(variants.storeId, storeId), eq(variants.productId, viewed.id)));
      if (availabilityOf(vs) !== "out_of_stock") return [];
      candidates = await related(d, storeId, [viewed.id], "alternative");
      break;
    }
    case "shipping_threshold": {
      const threshold = o.freeShippingThreshold;
      // The gap comes from the real cart. An unknown cart, or one that already qualifies, has nothing to recommend.
      if (threshold === undefined || ctx.cartSubtotal === undefined || !(ctx.cartSubtotal >= 0) || ctx.cartSubtotal >= threshold) return [];
      const gap = threshold - ctx.cartSubtotal;
      // Every in-stock option of the product must close the gap, so what is shown always does what it says.
      const close = await d.db.select({ productId: variants.productId }).from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .where(and(eq(variants.storeId, storeId), eq(variants.availability, "in_stock"), isNotNull(variants.price)))
        .groupBy(variants.productId, products.externalId).having(sql`min(${variants.price}) >= ${gap}`)
        .orderBy(sql`min(${variants.price})`, asc(products.externalId)).limit(CANDIDATES);
      candidates = await byDbIds(d, close.map((r) => r.productId));
      break;
    }
  }
  return hydrate(d, storeId, candidates, exclude, o.maxProducts);
}

/** Parsed, bounded input from the public query string. Anything malformed is dropped, never trusted. */
export function parseContext(q: { productId?: string | undefined; cart?: string | undefined; subtotal?: string | undefined }): RecContext {
  const id = (s: string) => s.length > 0 && s.length <= 100;
  const subtotal = q.subtotal !== undefined && q.subtotal !== "" ? Number(q.subtotal) : undefined;
  return {
    ...(q.productId && id(q.productId) ? { productId: q.productId } : {}),
    cartProductIds: [...new Set((q.cart ?? "").split(",").map((s) => s.trim()).filter(id))].slice(0, MAX_CART_IDS),
    ...(subtotal !== undefined && Number.isFinite(subtotal) && subtotal >= 0 && subtotal < 1e9 ? { cartSubtotal: subtotal } : {}),
  };
}

/**
 * Public and unauthenticated. The options come from the campaign version that is live right now (never from the
 * request), and every reason to show nothing (unknown site, paused or unpublished campaign, kill switch, a plan
 * without the tool) gives the same empty answer, so the endpoint reveals nothing about the store.
 */
export async function recommendationsForSite(d: Deps, input: { siteKey: string; campaignId: string; ctx: RecContext }): Promise<{ products: RecProduct[]; currency?: string }> {
  const none = { products: [] as RecProduct[] };
  if (!SHIPPED_TOOLS.has("upsell")) return none;
  const site = await resolveSite(d, input.siteKey); // KV first: the common reject path costs no D1 read
  if (!site?.active || !site.id) return none;

  let raw = await d.kv.get(`config:${input.siteKey}`);
  if (!raw) raw = JSON.stringify(await publishConfig(d, site.id));
  let served: { deliveryEnabled?: boolean; campaigns?: { campaignId: string; config: unknown }[] };
  try { served = JSON.parse(raw) as typeof served; } catch { return none; }
  if (!served.deliveryEnabled) return none;
  const live = served.campaigns?.find((c) => c.campaignId === input.campaignId);
  const cfg = live ? CampaignConfig.safeParse(live.config) : undefined;
  if (!cfg?.success || cfg.data.tool !== "upsell" || !cfg.data.recommend) return none;

  const [store] = await d.db.select().from(stores).where(eq(stores.id, site.id)).limit(1);
  if (!store || store.status !== "active") return none;
  if (!(await entitlementsFor(d, store.organizationId)).has("tools.upsell")) return none;

  return { products: await recommend(d, store.id, cfg.data.recommend, input.ctx), currency: store.currency };
}

/* ---------- merchant-managed relationships ---------- */

export type RelationKind = "complement" | "alternative";

/** Links for one product (or the whole store), with both titles so the dashboard needs no second lookup. */
export async function listRelationships(d: Deps, storeId: string, productExternalId?: string) {
  const rows = await d.db.select({ id: rel.id, kind: rel.kind, weight: rel.weight, productId: rel.productId, relatedProductId: rel.relatedProductId, createdAt: rel.createdAt })
    .from(rel).where(eq(rel.storeId, storeId)).orderBy(asc(rel.productId), asc(rel.kind), desc(rel.weight), asc(rel.relatedProductId)).limit(MAX_RELATIONS_PER_STORE);
  const ids = [...new Set(rows.flatMap((r) => [r.productId, r.relatedProductId]))];
  const ps = ids.length ? await d.db.select({ id: products.id, externalId: products.externalId, title: products.title }).from(products).where(and(eq(products.storeId, storeId), inArray(products.id, ids))) : [];
  const by = new Map(ps.map((p) => [p.id, p]));
  const shaped = rows.flatMap((r) => {
    const from = by.get(r.productId), to = by.get(r.relatedProductId);
    return from && to ? [{ id: r.id, kind: r.kind, weight: r.weight, product: { id: from.externalId, title: from.title }, related: { id: to.externalId, title: to.title }, createdAt: r.createdAt }] : [];
  });
  return productExternalId ? shaped.filter((r) => r.product.id === productExternalId) : shaped;
}

/** Creates or updates a link. Both products must belong to this store, so a caller can never link into another tenant's catalog. */
export async function setRelationship(d: Deps, storeId: string, actorId: string, input: { productId: string; relatedProductId: string; kind: RelationKind; weight: number }) {
  if (input.productId === input.relatedProductId) throw new HttpError(422, "validation_failed", "A product cannot be related to itself");
  const found = await byExternalIds(d, storeId, [input.productId, input.relatedProductId]);
  const from = found.find((p) => p.externalId === input.productId), to = found.find((p) => p.externalId === input.relatedProductId);
  if (!from || !to) throw new HttpError(404, "not_found", "Product not found in this store's catalog");

  const existing = await d.db.select({ id: rel.id }).from(rel).where(and(eq(rel.storeId, storeId), eq(rel.productId, from.id), eq(rel.relatedProductId, to.id), eq(rel.kind, input.kind))).limit(1);
  if (existing[0]) {
    await d.db.update(rel).set({ weight: input.weight }).where(eq(rel.id, existing[0].id));
    return { id: existing[0].id, created: false };
  }
  const [{ perProduct } = { perProduct: 0 }] = await d.db.select({ perProduct: sql<number>`count(*)` }).from(rel).where(and(eq(rel.storeId, storeId), eq(rel.productId, from.id), eq(rel.kind, input.kind)));
  if (perProduct >= MAX_RELATIONS_PER_PRODUCT) throw new HttpError(409, "limit_reached", `A product can have at most ${MAX_RELATIONS_PER_PRODUCT} ${input.kind} links`);
  const [{ total } = { total: 0 }] = await d.db.select({ total: sql<number>`count(*)` }).from(rel).where(eq(rel.storeId, storeId));
  if (total >= MAX_RELATIONS_PER_STORE) throw new HttpError(409, "limit_reached", `A store can have at most ${MAX_RELATIONS_PER_STORE} product links`);

  const id = newId("rel");
  await d.db.insert(rel).values({ id, storeId, productId: from.id, relatedProductId: to.id, kind: input.kind, weight: input.weight, createdAt: d.now().toISOString() });
  await recordAudit(d, { action: "relationship.set", actorId, storeId, targetType: "relationship", targetId: id });
  return { id, created: true };
}

export async function removeRelationship(d: Deps, storeId: string, actorId: string, id: string): Promise<boolean> {
  const gone = await d.db.delete(rel).where(and(eq(rel.id, id), eq(rel.storeId, storeId))).returning({ id: rel.id });
  if (gone.length === 0) return false;
  await recordAudit(d, { action: "relationship.removed", actorId, storeId, targetType: "relationship", targetId: id });
  return true;
}
