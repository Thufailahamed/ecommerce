import { z } from "zod";

/**
 * The store document: everything a generated store is, as data. The AI never writes code or markup; it proposes
 * operations on this document (ops.ts), every write is parsed with these schemas, and one renderer turns the result
 * into the editor preview and the published storefront. That is what makes AI output safe to publish: text is plain,
 * links and images are checked, and every section is one of a closed set of types.
 */

export const SCHEMA_VERSION = 1;

/* ---------- primitives ---------- */

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One line of plain text: no markup, no control characters, bounded. Model output and merchant input are untrusted. */
export const Line = (max: number) => z.string().transform((s) => s.replace(CONTROL, " ").replace(/[\r\n\t]+/g, " ").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/\s{2,}/g, " ").trim().slice(0, max));
/** Plain text that may keep paragraph breaks. Rendered as text, never as HTML. */
export const Prose = (max: number) => z.string().transform((s) => s.replace(/\r\n?/g, "\n").replace(CONTROL, " ").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max));
const Required = (max: number) => Line(max).pipe(z.string().min(1));

export const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/, "ids are lowercase letters, digits, - and _");
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slugs are lowercase words joined by -").max(60);
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colours are #rrggbb").transform((s) => s.toLowerCase());
export const Money = z.number().finite().min(0).max(1_000_000).transform((n) => Math.round(n * 100) / 100);

/** Paths reserved by the storefront's built-in pages. A merchant page cannot take them. */
export const RESERVED_SLUGS = new Set(["products", "collections", "cart", "checkout", "orders", "search", "account", "api", "assets", "_next"]);

/**
 * A link a shopper can follow: a path inside the store, an in-page anchor, mail/phone, or an absolute http(s) URL.
 * Protocol-relative ("//evil.com") and backslash tricks ("/\\evil.com") are refused, as are javascript: and data: URLs.
 */
export function isSafeHref(h: string): boolean {
  if (!h || h.length > 500 || (/\s/.test(h) && !h.startsWith("tel:"))) return false;
  if (h.startsWith("/")) return !h.startsWith("//") && !h.startsWith("/\\") && !h.includes("\\");
  if (h.startsWith("#")) return /^#[A-Za-z0-9_-]*$/.test(h);
  if (h.startsWith("mailto:")) return /^mailto:[^\s<>"]+@[^\s<>"]+$/.test(h);
  if (h.startsWith("tel:")) return /^tel:\+?[0-9 ()-]{3,30}$/.test(h);
  try {
    const u = new URL(h);
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch { return false; }
}
export const Href = z.string().trim().max(500).refine(isSafeHref, "links must be a store path (/about), #anchor, mailto:, tel: or an http(s) URL");

/**
 * An image source: an uploaded or generated asset ("asset:<id>", resolved by the renderer), an https URL, a bundled
 * photo ("/photos/..."), or empty (the renderer draws a branded placeholder).
 */
export function isSafeImageSrc(s: string): boolean {
  if (s === "") return true;
  if (/^asset:[a-z0-9_-]{4,64}$/.test(s)) return true;
  if (/^\/photos\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(s)) return true;
  try { const u = new URL(s); return u.protocol === "https:" && Boolean(u.hostname) && s.length <= 1000; } catch { return false; }
}
export const ImageSrc = z.string().trim().max(1000).refine(isSafeImageSrc, "images must be an uploaded asset, an https URL or empty");
export const Image = z.object({
  src: ImageSrc.default(""),
  alt: Line(160).default(""),
  /** What to generate when src is empty. Kept so "generate images" can run later. Never shown to shoppers. */
  prompt: Line(400).optional(),
});
export type Image = z.infer<typeof Image>;

export const Link = z.object({ label: Required(40), href: Href });
export type Link = z.infer<typeof Link>;

/* ---------- theme ---------- */

/** Fonts the storefront ships (self-hosted at build time). The model may only choose from these. */
export const FONTS = {
  inter: { label: "Inter", kind: "sans" },
  dm_sans: { label: "DM Sans", kind: "sans" },
  manrope: { label: "Manrope", kind: "sans" },
  outfit: { label: "Outfit", kind: "sans" },
  space_grotesk: { label: "Space Grotesk", kind: "sans" },
  syne: { label: "Syne", kind: "display" },
  playfair: { label: "Playfair Display", kind: "serif" },
  fraunces: { label: "Fraunces", kind: "serif" },
  cormorant: { label: "Cormorant Garamond", kind: "serif" },
  dm_serif: { label: "DM Serif Display", kind: "serif" },
} as const;
export type FontKey = keyof typeof FONTS;
export const FontKey = z.enum(Object.keys(FONTS) as [FontKey, ...FontKey[]]);

export const Palette = z.object({
  background: Color, surface: Color, text: Color, muted: Color,
  primary: Color, primaryText: Color, accent: Color, border: Color,
});
export type Palette = z.infer<typeof Palette>;

export const Theme = z.object({
  palette: Palette,
  fonts: z.object({ heading: FontKey, body: FontKey }),
  radius: z.enum(["none", "sm", "md", "lg", "xl"]).default("md"),
  buttonShape: z.enum(["square", "rounded", "pill"]).default("rounded"),
  headingCase: z.enum(["normal", "uppercase"]).default("normal"),
  headingWeight: z.enum(["400", "500", "600", "700", "800"]).default("600"),
  spacing: z.enum(["compact", "comfortable", "airy"]).default("comfortable"),
  productImageRatio: z.enum(["square", "portrait", "landscape"]).default("portrait"),
});
export type Theme = z.infer<typeof Theme>;

/* ---------- sections ---------- */

export const ICONS = ["truck", "shield", "leaf", "sparkles", "heart", "star", "gift", "recycle", "clock", "award", "package", "refresh", "lock", "sun", "droplet", "zap", "globe", "smile", "check", "phone", "mail", "map", "coffee", "feather"] as const;
export const Icon = z.enum(ICONS);
export type IconKey = (typeof ICONS)[number];

const SectionBase = {
  id: Id,
  /** Hidden sections stay in the document (and the editor) but are never rendered to shoppers. */
  hidden: z.boolean().default(false),
  background: z.enum(["default", "surface", "primary", "accent", "inverse"]).default("default"),
  spacing: z.enum(["sm", "md", "lg"]).default("md"),
};

export const HeroSection = z.object({
  ...SectionBase, type: z.literal("hero"),
  eyebrow: Line(60).optional(), heading: Required(120), subheading: Prose(300).optional(),
  primaryCta: Link.optional(), secondaryCta: Link.optional(),
  image: Image.optional(),
  layout: z.enum(["centered", "split", "overlay"]).default("split"),
  height: z.enum(["md", "lg", "full"]).default("lg"),
});
export const FeaturedProductsSection = z.object({
  ...SectionBase, type: z.literal("featured_products"),
  heading: Line(100).optional(), subheading: Prose(240).optional(),
  source: z.enum(["featured", "collection", "manual", "all"]).default("featured"),
  collectionId: Id.optional(), productIds: z.array(Id).max(24).default([]),
  limit: z.number().int().min(1).max(24).default(8),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(4),
  cta: Link.optional(),
});
export const CollectionListSection = z.object({
  ...SectionBase, type: z.literal("collection_list"),
  heading: Line(100).optional(), subheading: Prose(240).optional(),
  /** Empty means every collection, in document order. */
  collectionIds: z.array(Id).max(12).default([]),
  layout: z.enum(["grid", "tiles"]).default("tiles"),
});
export const ImageWithTextSection = z.object({
  ...SectionBase, type: z.literal("image_with_text"),
  eyebrow: Line(60).optional(), heading: Required(120), body: Prose(1200).default(""),
  image: Image.optional(), imagePosition: z.enum(["left", "right"]).default("left"), cta: Link.optional(),
});
export const RichTextSection = z.object({
  ...SectionBase, type: z.literal("rich_text"),
  heading: Line(120).optional(), body: Prose(6000).default(""),
  align: z.enum(["left", "center"]).default("left"), width: z.enum(["narrow", "wide"]).default("narrow"),
});
export const FeaturesSection = z.object({
  ...SectionBase, type: z.literal("features"),
  heading: Line(100).optional(), subheading: Prose(240).optional(),
  items: z.array(z.object({ icon: Icon.default("check"), title: Required(60), body: Prose(240).default("") })).min(1).max(8),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
});
export const TestimonialsSection = z.object({
  ...SectionBase, type: z.literal("testimonials"),
  heading: Line(100).optional(),
  items: z.array(z.object({ quote: Required(500), author: Required(60), role: Line(60).optional() })).min(1).max(9),
  /**
   * True until the merchant confirms these are real customer quotes. Sample quotes are shown in the editor but block
   * publishing: invented reviews mislead shoppers (and breach consumer-protection rules in most markets).
   */
  sample: z.boolean().default(true),
});
export const NewsletterSection = z.object({
  ...SectionBase, type: z.literal("newsletter"),
  heading: Required(100), body: Prose(300).optional(),
  buttonLabel: Required(30).default("Subscribe"), placeholder: Line(60).default("Email address"),
  successMessage: Line(160).default("Thanks for subscribing."),
});
export const FaqSection = z.object({
  ...SectionBase, type: z.literal("faq"),
  heading: Line(100).optional(),
  items: z.array(z.object({ question: Required(200), answer: Prose(1200) })).min(1).max(24),
});
export const CtaBannerSection = z.object({
  ...SectionBase, type: z.literal("cta_banner"),
  heading: Required(120), body: Prose(300).optional(), cta: Link, image: Image.optional(),
});
export const GallerySection = z.object({
  ...SectionBase, type: z.literal("gallery"),
  heading: Line(100).optional(),
  images: z.array(Image).min(1).max(12),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
});
export const ContactSection = z.object({
  ...SectionBase, type: z.literal("contact"),
  heading: Required(100), body: Prose(500).optional(),
  showForm: z.boolean().default(true),
  email: Line(254).optional(), phone: Line(40).optional(), address: Prose(300).optional(), hours: Prose(300).optional(),
});
export const ProductGridSection = z.object({
  ...SectionBase, type: z.literal("product_grid"),
  heading: Line(100).optional(),
  /** Absent: every product. */
  collectionId: Id.optional(),
  showFilters: z.boolean().default(true), showSort: z.boolean().default(true),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
});
export const LogoStripSection = z.object({
  ...SectionBase, type: z.literal("logo_strip"),
  heading: Line(100).optional(),
  /** Names shown as wordmarks (press, partners, certifications). Real ones only; the AI is told not to invent them. */
  items: z.array(Required(40)).min(1).max(10),
});

export const Section = z.discriminatedUnion("type", [
  HeroSection, FeaturedProductsSection, CollectionListSection, ImageWithTextSection, RichTextSection, FeaturesSection,
  TestimonialsSection, NewsletterSection, FaqSection, CtaBannerSection, GallerySection, ContactSection, ProductGridSection,
  LogoStripSection,
]);
export type Section = z.infer<typeof Section>;
export type SectionType = Section["type"];
export type SectionOf<T extends SectionType> = Extract<Section, { type: T }>;
export const SECTION_TYPES = Section.options.map((o) => o.shape.type.value) as SectionType[];

/* ---------- catalog ---------- */

export const Product = z.object({
  id: Id,
  slug: Slug,
  title: Required(120),
  description: Prose(4000).default(""),
  price: Money,
  /** Shown struck through when higher than price. Only the merchant can set it for a real sale. */
  compareAtPrice: Money.nullable().default(null),
  images: z.array(Image).max(8).default([]),
  category: Line(60).optional(),
  tags: z.array(Line(30).pipe(z.string().min(1))).max(12).default([]),
  /** Choices a shopper picks (size, colour). Every combination has the product's price. */
  options: z.array(z.object({ name: Required(30), values: z.array(Required(40)).min(1).max(20) })).max(3).default([]),
  available: z.boolean().default(true),
  featured: z.boolean().default(false),
  sku: Line(60).optional(),
});
export type Product = z.infer<typeof Product>;

export const Collection = z.object({
  id: Id,
  slug: Slug,
  title: Required(80),
  description: Prose(600).default(""),
  image: Image.optional(),
  productIds: z.array(Id).max(200).default([]),
});
export type Collection = z.infer<typeof Collection>;

/* ---------- pages, navigation, settings ---------- */

export const Page = z.object({
  id: Id,
  /** "" is the home page. */
  slug: z.union([z.literal(""), Slug]).refine((s) => !RESERVED_SLUGS.has(s), "that address is used by a built-in page"),
  title: Required(80),
  seo: z.object({ title: Line(70).optional(), description: Line(170).optional() }).default({}),
  sections: z.array(Section).max(40).default([]),
});
export type Page = z.infer<typeof Page>;

export const Brand = z.object({
  name: Required(60),
  tagline: Line(140).default(""),
  logo: Image.optional(),
});

const SocialUrl = Href.refine((h) => /^https?:\/\//.test(h), "social links are full URLs");
export const Settings = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  contactEmail: Line(254).optional(),
  announcement: z.object({ enabled: z.boolean().default(false), text: Line(140).default(""), href: Href.optional() }).default({ enabled: false, text: "" }),
  social: z.object({
    instagram: SocialUrl.optional(), tiktok: SocialUrl.optional(), x: SocialUrl.optional(),
    facebook: SocialUrl.optional(), youtube: SocialUrl.optional(), pinterest: SocialUrl.optional(),
  }).default({}),
  seo: z.object({ title: Line(70).optional(), description: Line(170).optional() }).default({}),
  /** Charged at checkout. The AI never sets amounts; the merchant does. */
  shipping: z.object({ flatRate: Money.default(0), freeOver: Money.nullable().default(null) }).default({ flatRate: 0, freeOver: null }),
});
export type Settings = z.infer<typeof Settings>;

export const Navigation = z.object({
  header: z.array(Link).max(8).default([]),
  footer: z.array(z.object({ title: Required(40), links: z.array(Link).max(8) })).max(4).default([]),
  footerNote: Line(200).default(""),
});

export const SiteDocument = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  brand: Brand,
  theme: Theme,
  settings: Settings,
  navigation: Navigation,
  pages: z.array(Page).min(1).max(20),
  products: z.array(Product).max(200).default([]),
  collections: z.array(Collection).max(30).default([]),
}).superRefine((doc, ctx) => {
  const unique = (label: string, values: string[], path: string) => {
    const seen = new Set<string>();
    values.forEach((v, i) => {
      if (seen.has(v)) ctx.addIssue({ code: "custom", message: `duplicate ${label} "${v}"`, path: [path, i] });
      seen.add(v);
    });
  };
  unique("page id", doc.pages.map((p) => p.id), "pages");
  unique("page address", doc.pages.map((p) => p.slug), "pages");
  unique("product id", doc.products.map((p) => p.id), "products");
  unique("product address", doc.products.map((p) => p.slug), "products");
  unique("collection id", doc.collections.map((c) => c.id), "collections");
  unique("collection address", doc.collections.map((c) => c.slug), "collections");
  if (!doc.pages.some((p) => p.slug === "")) ctx.addIssue({ code: "custom", message: "the store needs a home page", path: ["pages"] });
  const sectionIds = doc.pages.flatMap((p) => p.sections.map((s) => s.id));
  unique("section id", sectionIds, "pages");
  if (doc.collections.some((c) => c.slug === "all")) ctx.addIssue({ code: "custom", message: `"all" is the built-in all-products collection`, path: ["collections"] });
});
export type SiteDocument = z.infer<typeof SiteDocument>;
/** What callers may write: defaults not yet applied. */
export type SiteDocumentInput = z.input<typeof SiteDocument>;

/** Bounds the stored document. A store at the item limits stays well under this. */
export const MAX_DOCUMENT_BYTES = 600_000;

export function parseDocument(raw: unknown): { ok: true; doc: SiteDocument } | { ok: false; issues: string[] } {
  const r = SiteDocument.safeParse(raw);
  if (r.success) {
    if (JSON.stringify(r.data).length > MAX_DOCUMENT_BYTES) return { ok: false, issues: ["the store is too large to save"] };
    return { ok: true, doc: r.data };
  }
  return { ok: false, issues: r.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "document"}: ${i.message}`) };
}
