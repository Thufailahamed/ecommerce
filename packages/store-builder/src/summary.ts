import type { Section, SiteDocument } from "./schema";

/**
 * What the model is shown about the current store on an edit turn. Every id it may target is included; long text is
 * trimmed, because the model needs to know what is there, not reread every paragraph. The selected section (if any) is
 * sent in full so precise edits keep everything else in it intact.
 */

const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

function sectionBrief(s: Section): Record<string, unknown> {
  const out: Record<string, unknown> = { id: s.id, type: s.type };
  if (s.hidden) out["hidden"] = true;
  if (s.background !== "default") out["background"] = s.background;
  const rec = s as unknown as Record<string, unknown>;
  for (const k of ["eyebrow", "heading", "subheading", "layout", "source", "collectionId", "imagePosition"]) {
    const v = rec[k];
    if (typeof v === "string" && v) out[k] = clip(v, 90);
  }
  if ("body" in s && typeof s.body === "string" && s.body) out["body"] = clip(s.body, 120);
  if ("items" in s && Array.isArray(s.items)) out["items"] = s.items.length;
  if ("primaryCta" in s && s.primaryCta) out["primaryCta"] = s.primaryCta;
  if ("cta" in s && s.cta) out["cta"] = s.cta;
  if (s.type === "testimonials") out["sample"] = s.sample;
  return out;
}

export function summarizeDocument(doc: SiteDocument): Record<string, unknown> {
  return {
    brand: { name: doc.brand.name, tagline: doc.brand.tagline },
    theme: { palette: doc.theme.palette, fonts: doc.theme.fonts, radius: doc.theme.radius, buttonShape: doc.theme.buttonShape, headingCase: doc.theme.headingCase, spacing: doc.theme.spacing },
    settings: { currency: doc.settings.currency, contactEmail: doc.settings.contactEmail ?? null, announcement: doc.settings.announcement, shipping: doc.settings.shipping },
    navigation: { header: doc.navigation.header, footer: doc.navigation.footer.map((g) => ({ title: g.title, links: g.links })) },
    pages: doc.pages.map((p) => ({ id: p.id, path: p.slug ? `/${p.slug}` : "/", title: p.title, sections: p.sections.map(sectionBrief) })),
    collections: doc.collections.map((c) => ({ id: c.id, title: c.title, products: c.productIds })),
    products: doc.products.slice(0, 80).map((p) => ({
      id: p.id, title: p.title, price: p.price, ...(p.compareAtPrice ? { compareAtPrice: p.compareAtPrice } : {}),
      ...(p.category ? { category: p.category } : {}), ...(p.featured ? { featured: true } : {}), ...(p.available ? {} : { available: false }),
      ...(p.options.length ? { options: p.options.map((o) => o.name) } : {}),
    })),
    ...(doc.products.length > 80 ? { moreProducts: doc.products.length - 80 } : {}),
  };
}

export function findSectionById(doc: SiteDocument, id: string): { pageId: string; section: Section } | null {
  for (const p of doc.pages) { const s = p.sections.find((x) => x.id === id); if (s) return { pageId: p.id, section: s }; }
  return null;
}
