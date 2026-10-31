import type { Collection, Page, Product, Section, SiteDocument } from "./schema";

/**
 * Store paths are relative to the store root ("/", "/about", "/products/mug", "/collections/all", "/cart"). The
 * published storefront prefixes its base path; the editor preview navigates between them in place.
 */
export type Route =
  | { kind: "page"; page: Page }
  | { kind: "product"; product: Product }
  | { kind: "collection"; collection: Collection | null }
  | { kind: "cart" }
  | { kind: "checkout" }
  | { kind: "order"; orderId: string }
  | { kind: "not_found" };

export function normalizePath(path: string): string {
  const p = ("/" + path.split(/[?#]/)[0]!.replace(/^\/+/, "")).replace(/\/+$/, "");
  return p === "" ? "/" : p.toLowerCase();
}

export function resolveRoute(doc: SiteDocument, path: string): Route {
  const p = normalizePath(path);
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) { const home = doc.pages.find((x) => x.slug === ""); return home ? { kind: "page", page: home } : { kind: "not_found" }; }
  const [a, b, ...rest] = parts;
  if (rest.length) return { kind: "not_found" };
  if (a === "products" && b) { const product = doc.products.find((x) => x.slug === b); return product ? { kind: "product", product } : { kind: "not_found" }; }
  if (a === "collections" && b) {
    if (b === "all") return { kind: "collection", collection: null };
    const collection = doc.collections.find((x) => x.slug === b);
    return collection ? { kind: "collection", collection } : { kind: "not_found" };
  }
  if (a === "cart" && !b) return { kind: "cart" };
  if (a === "checkout" && !b) return { kind: "checkout" };
  if (a === "orders" && b && /^[a-z0-9_-]{4,64}$/.test(b)) return { kind: "order", orderId: b };
  if (!b) { const page = doc.pages.find((x) => x.slug === a); if (page) return { kind: "page", page }; }
  return { kind: "not_found" };
}

export const pagePath = (p: Pick<Page, "slug">) => (p.slug ? `/${p.slug}` : "/");
export const productPath = (p: Pick<Product, "slug">) => `/products/${p.slug}`;
export const collectionPath = (c: Pick<Collection, "slug"> | null) => `/collections/${c ? c.slug : "all"}`;

export const isInternal = (href: string) => href.startsWith("/") && !href.startsWith("//");

/** Whether an internal link leads somewhere that exists. External links, anchors, mailto and tel always pass. */
export function linkResolves(doc: SiteDocument, href: string): boolean {
  if (!isInternal(href)) return true;
  return resolveRoute(doc, href).kind !== "not_found";
}

export interface LinkTarget { label: string; href: string; group: "Pages" | "Collections" | "Products" | "Store" }

/** Everything a link can point at inside the store, for the editor's link picker and for the AI. */
export function linkTargets(doc: SiteDocument): LinkTarget[] {
  return [
    ...doc.pages.map((p) => ({ label: p.title, href: pagePath(p), group: "Pages" as const })),
    { label: "All products", href: "/collections/all", group: "Collections" as const },
    ...doc.collections.map((c) => ({ label: c.title, href: collectionPath(c), group: "Collections" as const })),
    ...doc.products.map((p) => ({ label: p.title, href: productPath(p), group: "Products" as const })),
    { label: "Cart", href: "/cart", group: "Store" as const },
  ];
}

/** Every link in the document with where it lives, for the broken-link check. */
export function allLinks(doc: SiteDocument): { href: string; where: string; sectionId?: string; pageId?: string }[] {
  const out: { href: string; where: string; sectionId?: string; pageId?: string }[] = [];
  doc.navigation.header.forEach((l) => out.push({ href: l.href, where: `Header menu: ${l.label}` }));
  doc.navigation.footer.forEach((g) => g.links.forEach((l) => out.push({ href: l.href, where: `Footer (${g.title}): ${l.label}` })));
  if (doc.settings.announcement.enabled && doc.settings.announcement.href) out.push({ href: doc.settings.announcement.href, where: "Announcement bar" });
  for (const page of doc.pages) {
    for (const s of page.sections) {
      for (const l of sectionLinks(s)) out.push({ href: l.href, where: `${page.title}: ${l.label}`, sectionId: s.id, pageId: page.id });
    }
  }
  return out;
}

function sectionLinks(s: Section): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  for (const k of ["primaryCta", "secondaryCta", "cta"] as const) {
    const l = (s as Record<string, unknown>)[k] as { label: string; href: string } | undefined;
    if (l) links.push(l);
  }
  return links;
}
