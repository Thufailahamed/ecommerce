import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@convertflow/database";
import { newId } from "../lib/crypto.js";
import type { Deps } from "../deps.js";

/**
 * Platform-neutral catalog shape. Shopify/WooCommerce/BigCommerce adapters, CSV import and
 * the public bulk API all normalise into this and call `upsertProducts`.
 */
export const CatalogProductInput = z.object({
  externalId: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  url: z.string().max(2048).optional(),
  handle: z.string().max(200).optional(),
  imageUrl: z.string().max(2048).optional(),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  collectionIds: z.array(z.string().max(100)).max(50).default([]),
  variants: z.array(z.object({
    externalId: z.string().min(1).max(100),
    title: z.string().max(200).optional(),
    price: z.number().min(0).optional(),
    /** Omit when the platform does not tell us: stored as "unknown", never assumed in stock. */
    available: z.boolean().optional(),
  })).max(100).default([]),
});
export type CatalogProductInput = z.infer<typeof CatalogProductInput>;

export const MAX_IMPORT = 100;

type Avail = "in_stock" | "out_of_stock" | "unknown";
/** in_stock if any variant is; out_of_stock only if every variant is known out; otherwise unknown. */
export const rollupAvailability = (vs: { availability: Avail }[]): Avail =>
  vs.some((v) => v.availability === "in_stock") ? "in_stock" : vs.length > 0 && vs.every((v) => v.availability === "out_of_stock") ? "out_of_stock" : "unknown";

export async function upsertProducts(d: Deps, storeId: string, items: CatalogProductInput[]) {
  const now = d.now().toISOString();
  let created = 0, updated = 0;
  /** Existing products that moved from not-in-stock to in-stock in this import (drives back-in-stock alerts). */
  const restocked: string[] = [];
  for (const p of items) {
    const [existing] = await d.db.select({ id: schema.products.id }).from(schema.products)
      .where(and(eq(schema.products.storeId, storeId), eq(schema.products.externalId, p.externalId))).limit(1);
    const productId = existing?.id ?? newId("prd");
    const before = existing ? rollupAvailability(await d.db.select({ availability: schema.productVariants.availability }).from(schema.productVariants).where(eq(schema.productVariants.productId, productId))) : null;
    const values = { storeId, externalId: p.externalId, title: p.title, handle: p.handle ?? null, url: p.url ?? null, status: p.status, imageUrl: p.imageUrl ?? null, collectionIds: p.collectionIds, syncedAt: now };
    if (existing) { await d.db.update(schema.products).set(values).where(eq(schema.products.id, productId)); updated++; }
    else { await d.db.insert(schema.products).values({ id: productId, ...values }); created++; }

    for (const v of p.variants) {
      const vv = {
        storeId, productId, externalId: v.externalId, title: v.title ?? null, price: v.price ?? null,
        availability: v.available === undefined ? ("unknown" as const) : v.available ? ("in_stock" as const) : ("out_of_stock" as const), syncedAt: now,
      };
      await d.db.insert(schema.productVariants).values({ id: newId("var"), ...vv })
        .onConflictDoUpdate({ target: [schema.productVariants.storeId, schema.productVariants.externalId], set: vv });
    }
    if (before !== null && before !== "in_stock" && p.variants.length > 0) {
      const after = rollupAvailability(await d.db.select({ availability: schema.productVariants.availability }).from(schema.productVariants).where(eq(schema.productVariants.productId, productId)));
      if (after === "in_stock") restocked.push(p.externalId);
    }
  }
  return { created, updated, restocked };
}

export async function listProducts(d: Deps, storeId: string, limit = 50) {
  return d.db.select().from(schema.products).where(eq(schema.products.storeId, storeId)).limit(Math.min(limit, 200));
}

/** Product-level availability: in_stock if any variant is, out_of_stock only if all variants are known out, else unknown. */
export async function catalogForAI(d: Deps, storeId: string, domain: string) {
  const prods = await d.db.select().from(schema.products).where(and(eq(schema.products.storeId, storeId), eq(schema.products.status, "active"))).limit(40);
  const vars = await d.db.select().from(schema.productVariants).where(eq(schema.productVariants.storeId, storeId));
  return prods.map((p) => {
    const vs = vars.filter((v) => v.productId === p.id);
    const availability = vs.some((v) => v.availability === "in_stock") ? "in_stock" as const
      : vs.length > 0 && vs.every((v) => v.availability === "out_of_stock") ? "out_of_stock" as const : "unknown" as const;
    const item: { id: string; title: string; url?: string; availability: typeof availability } = { id: p.externalId, title: p.title, availability };
    const path = p.url ?? (p.handle ? `/products/${p.handle}` : undefined);
    if (path) item.url = path.startsWith("/") ? path : path;
    void domain;
    return item;
  });
}
