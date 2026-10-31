import { allLinks, linkResolves } from "./links";
import type { Image, SiteDocument } from "./schema";
import { SECTION_DEFS } from "./sections";

/**
 * The publish checklist. Errors block publishing (the server re-runs this); warnings are shown so the merchant can
 * decide. Each issue says where to go to fix it.
 */
export interface SiteIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  target?: { kind: "section"; pageId: string; sectionId: string } | { kind: "product"; productId: string } | { kind: "page"; pageId: string } | { kind: "settings" } | { kind: "navigation" };
}

const placeholder = (img: Image | undefined) => !img || img.src === "";

export function checkSite(doc: SiteDocument): { errors: SiteIssue[]; warnings: SiteIssue[] } {
  const issues: SiteIssue[] = [];
  const add = (i: SiteIssue) => issues.push(i);

  if (doc.products.length === 0) add({ level: "error", code: "no_products", message: "Add at least one product before publishing." });

  for (const page of doc.pages) {
    for (const s of page.sections) {
      if (s.hidden) continue;
      const target = { kind: "section" as const, pageId: page.id, sectionId: s.id };
      if (s.type === "testimonials" && s.sample) add({ level: "error", code: "sample_testimonials", message: `${page.title}: the testimonials are samples. Replace them with real customer quotes (and untick "Sample quotes"), or hide the section.`, target });
      if (s.type === "logo_strip") add({ level: "warning", code: "logo_strip_check", message: `${page.title}: check that every name in the logo strip is a real press mention, partner or certification.`, target });
      const images: Image[] = [];
      if ("image" in s && s.image) images.push(s.image);
      if (s.type === "gallery") images.push(...s.images);
      const needsImage = s.type === "hero" ? s.layout !== "centered" : s.type === "image_with_text" || s.type === "gallery";
      if (needsImage && (images.length === 0 || images.some(placeholder))) add({ level: "warning", code: "missing_image", message: `${page.title}: the ${SECTION_DEFS[s.type].label.toLowerCase()} section has no image yet.`, target });
    }
  }

  const noImage = doc.products.filter((p) => p.images.length === 0 || placeholder(p.images[0]));
  if (noImage.length) add({ level: "warning", code: "product_images", message: `${noImage.length} product${noImage.length === 1 ? " has" : "s have"} no photo yet.`, ...(noImage[0] ? { target: { kind: "product" as const, productId: noImage[0].id } } : {}) });
  const free = doc.products.filter((p) => p.price === 0);
  if (free.length) add({ level: "warning", code: "zero_price", message: `${free.length} product${free.length === 1 ? " is" : "s are"} priced at zero.`, ...(free[0] ? { target: { kind: "product" as const, productId: free[0].id } } : {}) });

  for (const l of allLinks(doc)) {
    if (!linkResolves(doc, l.href)) {
      add({ level: "error", code: "broken_link", message: `${l.where} links to ${l.href}, which does not exist.`, target: l.sectionId && l.pageId ? { kind: "section", pageId: l.pageId, sectionId: l.sectionId } : { kind: "navigation" } });
    }
  }

  if (!doc.settings.contactEmail) add({ level: "warning", code: "no_contact_email", message: "Add a contact email so customers can reach you about orders.", target: { kind: "settings" } });
  if (!doc.settings.seo.description) add({ level: "warning", code: "no_seo_description", message: "Add a search description so the store looks right in search results and link previews.", target: { kind: "settings" } });

  return { errors: issues.filter((i) => i.level === "error"), warnings: issues.filter((i) => i.level === "warning") };
}
