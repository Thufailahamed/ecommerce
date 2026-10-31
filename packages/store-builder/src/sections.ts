import type { Section, SectionType } from "./schema";

/**
 * One definition per section type: what the editor's inspector shows, what the "add section" library offers, and how
 * the AI is told the section works. Keeping all three here means a new section type cannot be half-added.
 */

export type FieldDef =
  | { key: string; label: string; kind: "text"; max: number; optional?: boolean; placeholder?: string }
  | { key: string; label: string; kind: "textarea"; max: number; optional?: boolean; rows?: number }
  | { key: string; label: string; kind: "link"; optional?: boolean }
  | { key: string; label: string; kind: "image"; optional?: boolean }
  | { key: string; label: string; kind: "images"; max: number }
  | { key: string; label: string; kind: "select"; options: readonly { value: string | number; label: string }[] }
  | { key: string; label: string; kind: "boolean"; hint?: string }
  | { key: string; label: string; kind: "number"; min: number; max: number }
  | { key: string; label: string; kind: "icon" }
  | { key: string; label: string; kind: "products" }
  | { key: string; label: string; kind: "collection"; optional?: boolean }
  | { key: string; label: string; kind: "collections" }
  | { key: string; label: string; kind: "strings"; max: number; itemLabel: string }
  | { key: string; label: string; kind: "list"; max: number; itemLabel: string; fields: FieldDef[]; newItem: () => Record<string, unknown> };

/** Omit that keeps the union: a plain Omit<Section, "id"> collapses to the fields every section shares. */
export type NewSection = Section extends infer S ? (S extends Section ? Omit<S, "id"> : never) : never;

export interface SectionDef {
  type: SectionType;
  label: string;
  /** For the merchant (library card). */
  description: string;
  /** For the model: when to use it and what each important field means. */
  ai: string;
  category: "intro" | "commerce" | "content" | "social" | "engagement";
  fields: FieldDef[];
  /** A sensible new section of this type, minus its id. */
  create: () => NewSection;
}

const columns = [{ value: 2, label: "2" }, { value: 3, label: "3" }, { value: 4, label: "4" }] as const;

const base = { hidden: false, background: "default", spacing: "md" } as const;

export const SECTION_DEFS: Record<SectionType, SectionDef> = {
  hero: {
    type: "hero", label: "Hero", category: "intro",
    description: "Big opening statement with an image and buttons.",
    ai: "Opening banner. heading (<=10 words, specific to the brand), subheading (1-2 sentences), primaryCta {label, href} usually to /collections/all, optional secondaryCta, image {alt, prompt}, layout centered|split|overlay, height md|lg|full.",
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "text", max: 60, optional: true },
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "subheading", label: "Subheading", kind: "textarea", max: 300, optional: true, rows: 3 },
      { key: "primaryCta", label: "Primary button", kind: "link", optional: true },
      { key: "secondaryCta", label: "Secondary button", kind: "link", optional: true },
      { key: "image", label: "Image", kind: "image", optional: true },
      { key: "layout", label: "Layout", kind: "select", options: [{ value: "split", label: "Split" }, { value: "centered", label: "Centered" }, { value: "overlay", label: "Text over image" }] },
      { key: "height", label: "Height", kind: "select", options: [{ value: "md", label: "Medium" }, { value: "lg", label: "Large" }, { value: "full", label: "Full screen" }] },
    ],
    create: () => ({ ...base, type: "hero", heading: "A headline for your store", subheading: "Say what you sell and why it is worth it.", primaryCta: { label: "Shop now", href: "/collections/all" }, image: { src: "", alt: "" }, layout: "split", height: "lg" }),
  },
  featured_products: {
    type: "featured_products", label: "Featured products", category: "commerce",
    description: "A row or grid of products with prices and quick add to cart.",
    ai: "Product cards. source featured (products with featured=true) | collection (set collectionId) | manual (set productIds) | all. limit 1-24, columns 2|3|4, optional cta link.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100, optional: true },
      { key: "subheading", label: "Subheading", kind: "textarea", max: 240, optional: true, rows: 2 },
      { key: "source", label: "Show", kind: "select", options: [{ value: "featured", label: "Featured products" }, { value: "collection", label: "A collection" }, { value: "manual", label: "Hand-picked" }, { value: "all", label: "All products" }] },
      { key: "collectionId", label: "Collection", kind: "collection", optional: true },
      { key: "productIds", label: "Products", kind: "products" },
      { key: "limit", label: "How many", kind: "number", min: 1, max: 24 },
      { key: "columns", label: "Columns", kind: "select", options: columns },
      { key: "cta", label: "Button", kind: "link", optional: true },
    ],
    create: () => ({ ...base, type: "featured_products", heading: "Bestsellers", source: "featured", productIds: [], limit: 8, columns: 4, cta: { label: "View all", href: "/collections/all" } }),
  },
  collection_list: {
    type: "collection_list", label: "Collections", category: "commerce",
    description: "Image tiles linking to your collections.",
    ai: "Tiles linking to collections. collectionIds (empty = all), layout grid|tiles.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100, optional: true },
      { key: "subheading", label: "Subheading", kind: "textarea", max: 240, optional: true, rows: 2 },
      { key: "collectionIds", label: "Collections (empty shows all)", kind: "collections" },
      { key: "layout", label: "Layout", kind: "select", options: [{ value: "tiles", label: "Image tiles" }, { value: "grid", label: "Cards" }] },
    ],
    create: () => ({ ...base, type: "collection_list", heading: "Shop by collection", collectionIds: [], layout: "tiles" }),
  },
  image_with_text: {
    type: "image_with_text", label: "Image with text", category: "content",
    description: "Tell a story next to a photo.",
    ai: "Story block. eyebrow, heading, body (1-3 short paragraphs separated by blank lines), image {alt, prompt}, imagePosition left|right, optional cta.",
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "text", max: 60, optional: true },
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "body", label: "Text", kind: "textarea", max: 1200, rows: 6 },
      { key: "image", label: "Image", kind: "image", optional: true },
      { key: "imagePosition", label: "Image side", kind: "select", options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
      { key: "cta", label: "Button", kind: "link", optional: true },
    ],
    create: () => ({ ...base, type: "image_with_text", heading: "Our story", body: "Tell shoppers who you are and why you started.", image: { src: "", alt: "" }, imagePosition: "left" }),
  },
  rich_text: {
    type: "rich_text", label: "Text", category: "content",
    description: "Headline and paragraphs. Good for policies and about pages.",
    ai: "Plain paragraphs. heading, body (paragraphs separated by blank lines; lines starting with '- ' render as bullets; a line starting with '## ' is a subheading), align left|center, width narrow|wide.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120, optional: true },
      { key: "body", label: "Text", kind: "textarea", max: 6000, rows: 10 },
      { key: "align", label: "Alignment", kind: "select", options: [{ value: "left", label: "Left" }, { value: "center", label: "Center" }] },
      { key: "width", label: "Width", kind: "select", options: [{ value: "narrow", label: "Narrow" }, { value: "wide", label: "Wide" }] },
    ],
    create: () => ({ ...base, type: "rich_text", heading: "Heading", body: "Write something here.", align: "left", width: "narrow" }),
  },
  features: {
    type: "features", label: "Features", category: "content",
    description: "Icons with short benefits: shipping, materials, guarantees.",
    ai: `Benefit grid. items [{icon, title, body}] 3-6 items, columns 2|3|4. Only state facts the merchant gave you or generic qualities; never invent guarantees, delivery times or certifications.`,
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100, optional: true },
      { key: "subheading", label: "Subheading", kind: "textarea", max: 240, optional: true, rows: 2 },
      { key: "items", label: "Items", kind: "list", max: 8, itemLabel: "Feature", newItem: () => ({ icon: "check", title: "New feature", body: "" }), fields: [
        { key: "icon", label: "Icon", kind: "icon" },
        { key: "title", label: "Title", kind: "text", max: 60 },
        { key: "body", label: "Text", kind: "textarea", max: 240, rows: 2 },
      ] },
      { key: "columns", label: "Columns", kind: "select", options: columns },
    ],
    create: () => ({ ...base, type: "features", heading: "Why shop with us", items: [{ icon: "leaf", title: "Thoughtfully made", body: "" }, { icon: "package", title: "Packed with care", body: "" }, { icon: "heart", title: "Loved by customers", body: "" }], columns: 3 }),
  },
  testimonials: {
    type: "testimonials", label: "Testimonials", category: "social",
    description: "Customer quotes. Must be real before you publish.",
    ai: "Customer quotes. Only use quotes the merchant supplied; if you add the section without real quotes, keep sample=true so the merchant must replace them before publishing.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100, optional: true },
      { key: "items", label: "Quotes", kind: "list", max: 9, itemLabel: "Quote", newItem: () => ({ quote: "What a customer said.", author: "Customer name" }), fields: [
        { key: "quote", label: "Quote", kind: "textarea", max: 500, rows: 3 },
        { key: "author", label: "Name", kind: "text", max: 60 },
        { key: "role", label: "Detail (e.g. city)", kind: "text", max: 60, optional: true },
      ] },
      { key: "sample", label: "Sample quotes (not real yet)", kind: "boolean", hint: "Untick only when these are real quotes from real customers. Sample quotes cannot be published." },
    ],
    create: () => ({ ...base, type: "testimonials", heading: "What customers say", items: [{ quote: "Replace this with a real customer quote.", author: "Customer name" }], sample: true }),
  },
  newsletter: {
    type: "newsletter", label: "Newsletter", category: "engagement",
    description: "Collect email sign-ups.",
    ai: "Email sign-up. heading, body, buttonLabel, successMessage. Do not promise discounts the merchant did not offer.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100 },
      { key: "body", label: "Text", kind: "textarea", max: 300, optional: true, rows: 2 },
      { key: "buttonLabel", label: "Button", kind: "text", max: 30 },
      { key: "placeholder", label: "Field placeholder", kind: "text", max: 60 },
      { key: "successMessage", label: "Thank-you message", kind: "text", max: 160 },
    ],
    create: () => ({ ...base, type: "newsletter", background: "surface", heading: "Join the list", body: "New arrivals and stories, a few times a month.", buttonLabel: "Subscribe", placeholder: "Email address", successMessage: "Thanks for subscribing." }),
  },
  faq: {
    type: "faq", label: "FAQ", category: "content",
    description: "Questions and answers in an accordion.",
    ai: "Accordion. items [{question, answer}] 4-8. Answers must not invent policies (shipping times, return windows): keep them general or ask the merchant to fill in specifics.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100, optional: true },
      { key: "items", label: "Questions", kind: "list", max: 24, itemLabel: "Question", newItem: () => ({ question: "New question?", answer: "Answer." }), fields: [
        { key: "question", label: "Question", kind: "text", max: 200 },
        { key: "answer", label: "Answer", kind: "textarea", max: 1200, rows: 3 },
      ] },
    ],
    create: () => ({ ...base, type: "faq", heading: "Questions", items: [{ question: "How long does shipping take?", answer: "Add your shipping times here." }] }),
  },
  cta_banner: {
    type: "cta_banner", label: "Call to action", category: "engagement",
    description: "A bold banner with one button.",
    ai: "Banner. heading, body, cta {label, href} (required), optional image.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "body", label: "Text", kind: "textarea", max: 300, optional: true, rows: 2 },
      { key: "cta", label: "Button", kind: "link" },
      { key: "image", label: "Background image", kind: "image", optional: true },
    ],
    create: () => ({ ...base, type: "cta_banner", background: "primary", heading: "Find your favourite", cta: { label: "Shop all", href: "/collections/all" } }),
  },
  gallery: {
    type: "gallery", label: "Gallery", category: "content",
    description: "A grid of photos.",
    ai: "Photo grid. images [{alt, prompt}] 3-9, columns 2|3|4.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100, optional: true },
      { key: "images", label: "Images", kind: "images", max: 12 },
      { key: "columns", label: "Columns", kind: "select", options: columns },
    ],
    create: () => ({ ...base, type: "gallery", heading: "Gallery", images: [{ src: "", alt: "" }, { src: "", alt: "" }, { src: "", alt: "" }], columns: 3 }),
  },
  contact: {
    type: "contact", label: "Contact", category: "engagement",
    description: "Contact details and a message form.",
    ai: "Contact block. heading, body, showForm. email/phone/address/hours only if the merchant provided them.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100 },
      { key: "body", label: "Text", kind: "textarea", max: 500, optional: true, rows: 3 },
      { key: "showForm", label: "Show message form", kind: "boolean" },
      { key: "email", label: "Email", kind: "text", max: 254, optional: true },
      { key: "phone", label: "Phone", kind: "text", max: 40, optional: true },
      { key: "address", label: "Address", kind: "textarea", max: 300, optional: true, rows: 2 },
      { key: "hours", label: "Hours", kind: "textarea", max: 300, optional: true, rows: 2 },
    ],
    create: () => ({ ...base, type: "contact", heading: "Get in touch", body: "Questions about an order or a product? Send us a message.", showForm: true }),
  },
  product_grid: {
    type: "product_grid", label: "Product grid", category: "commerce",
    description: "Every product (or one collection) with filters and sorting.",
    ai: "Full catalogue grid for a shop page. Optional collectionId; showFilters, showSort, columns 2|3|4.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100, optional: true },
      { key: "collectionId", label: "Collection (empty shows all)", kind: "collection", optional: true },
      { key: "showFilters", label: "Category filters", kind: "boolean" },
      { key: "showSort", label: "Sorting", kind: "boolean" },
      { key: "columns", label: "Columns", kind: "select", options: columns },
    ],
    create: () => ({ ...base, type: "product_grid", heading: "Shop all", showFilters: true, showSort: true, columns: 3 }),
  },
  logo_strip: {
    type: "logo_strip", label: "Logo strip", category: "social",
    description: "Press mentions, partners or certifications as wordmarks.",
    ai: "Wordmarks. Only names the merchant supplied (press, stockists, certifications); never invent them.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 100, optional: true },
      { key: "items", label: "Names", kind: "strings", max: 10, itemLabel: "Name" },
    ],
    create: () => ({ ...base, type: "logo_strip", heading: "As featured in", items: ["Publication"] }),
  },
};

export const SECTION_CATEGORIES: { key: SectionDef["category"]; label: string }[] = [
  { key: "intro", label: "Intro" }, { key: "commerce", label: "Commerce" }, { key: "content", label: "Content" },
  { key: "social", label: "Social proof" }, { key: "engagement", label: "Engagement" },
];

/** A short, readable label for a section in lists ("Hero: Slow mornings, better coffee"). */
export function sectionLabel(s: Section): string {
  const def = SECTION_DEFS[s.type];
  const text = "heading" in s && typeof s.heading === "string" && s.heading ? s.heading : "";
  return text ? `${def.label}: ${text}` : def.label;
}
