import { z } from "zod";
import { SafeUrl } from "./url";

/**
 * A tool is a configuration schema + a renderer + a metric set. Everything else (targeting, schedule,
 * frequency, versions, publishing, analytics) is shared. Keys are neutral; display names are configurable.
 */
export const Tool = z.enum(["toast", "feed", "upsell", "sms", "email"]);
export type Tool = z.infer<typeof Tool>;

/**
 * Tools whose whole path (editor, renderer, backend, analytics) exists and has been tested. The API refuses to publish
 * a campaign for any other tool, so a merchant can never put a form or widget in front of shoppers that cannot work.
 * Add a tool here only in the same change that finishes and tests it.
 */
export const SHIPPED_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["toast", "feed", "upsell", "email"]);

/**
 * Where a tool's UI sits. Arbitration allows at most one campaign per slot, and `interruptive` and
 * `ambient` never share the screen. `passive` surfaces (feed bell, inline recommendations) never block.
 */
export const Slot = z.enum(["interruptive", "ambient", "passive"]);
export type Slot = z.infer<typeof Slot>;

/* ---------- toast (non-blocking promotional notification) ---------- */

export const ToastKind = z.enum(["announcement", "product_offer", "coupon", "shipping_incentive"]);
export const ToastCorner = z.enum(["bottom_left", "bottom_right", "top_left", "top_right"]);

export const ToastOptions = z.object({
  kind: ToastKind.default("announcement"),
  corner: ToastCorner.default("bottom_left"),
  /** Auto-dismiss after this many seconds. Omit to stay until dismissed. Auto-dismiss is not a user dismissal. */
  durationSeconds: z.number().int().min(3).max(120).optional(),
  animation: z.enum(["none", "fade", "slide"]).default("slide"),
  /** shipping_incentive only: the free-shipping threshold, in store currency. The remaining amount is computed from the real cart. */
  freeShippingThreshold: z.number().positive().max(1_000_000).optional(),
});
export type ToastOptions = z.infer<typeof ToastOptions>;

/* ---------- feed (persistent notification centre) ---------- */

export const FeedOptions = z.object({
  /** Merchant-defined grouping label, e.g. "Offers". Plain text. */
  category: z.string().trim().min(1).max(40).default("Updates"),
  /** Lower sorts first within the feed; ties go to the newest. */
  order: z.number().int().min(0).max(1000).default(100),
  /** Public items are shown to everyone; targeted ones go through the normal targeting rules. */
  audience: z.enum(["public", "targeted"]).default("public"),
  /** Where the bell sits. Taken from the highest-ranked item currently in the feed. */
  position: z.enum(["bottom_right", "bottom_left"]).default("bottom_right"),
});
export type FeedOptions = z.infer<typeof FeedOptions>;

/* ---------- upsell (recommendations) ---------- */

/**
 * Level 1 sources only: everything here is deterministic and explainable. Algorithmic sources
 * (frequently-bought-together from orders, AI ranking) are not offered until their data exists.
 */
export const RecommendSource = z.enum([
  "manual",            // merchant-picked products
  "same_collection",   // other products in the viewed product's collection
  "complements",       // explicit complementary relationships set by the merchant
  "shipping_threshold", // products that would close the gap to free shipping
  "alternatives",      // in-stock alternatives to an unavailable product
]);

export const RecommendOptions = z.object({
  source: RecommendSource,
  productIds: z.array(z.string().min(1).max(100)).max(50).default([]),
  collectionIds: z.array(z.string().min(1).max(100)).max(20).default([]),
  excludeProductIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  maxProducts: z.number().int().min(1).max(6).default(3),
  layout: z.enum(["row", "grid", "list"]).default("row"),
  placement: z.enum(["product_page", "cart", "toast"]).default("product_page"),
  showPrice: z.boolean().default(true),
  /** Always true in practice: unavailable products are never recommended. Kept explicit so a config can never claim otherwise. */
  onlyAvailable: z.literal(true).default(true),
  addToCart: z.boolean().default(true),
  /** shipping_threshold only: the store's free-shipping subtotal, in store currency. */
  freeShippingThreshold: z.number().positive().max(1_000_000).optional(),
});
export type RecommendOptions = z.infer<typeof RecommendOptions>;

/* ---------- sms / email signup forms ---------- */

/**
 * The words the shopper actually agreed to. The server stores a hash and version of this exact text
 * with each consent, so consent is provable. Plain text only; never pre-checked.
 */
export const ConsentText = z.string().trim().min(20).max(600);

export const FormOptions = z.object({
  collect: z.object({
    email: z.boolean().default(false),
    phone: z.boolean().default(false),
    firstName: z.boolean().default(false),
  }).default({ email: false, phone: false, firstName: false }),
  /** ISO 3166-1 alpha-2, used to pre-select the dial code. Numbers are always stored in E.164. */
  defaultCountry: z.string().length(2).toUpperCase().default("US"),
  consentText: ConsentText,
  /** Each channel the shopper agrees to is a separate, unticked checkbox: never pre-checked, never bundled. */
  consentCheckbox: z.literal(true).default(true),
  privacyUrl: SafeUrl,
  termsUrl: SafeUrl.optional(),
  /** Email only: require the shopper to confirm from their inbox before they are treated as subscribed. */
  doubleOptIn: z.boolean().default(true),
  successMessage: z.string().trim().min(1).max(160).default("Thanks. You're signed up."),
  pendingMessage: z.string().trim().min(1).max(160).default("Check your inbox to confirm your subscription."),
  // An incentive is the campaign's `promotion` (it carries percentOff, so the store's discount ceiling
  // still applies). It is revealed only after the opt-in succeeds, never before.
});
export type FormOptions = z.infer<typeof FormOptions>;
