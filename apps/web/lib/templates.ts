import type { CampaignConfig } from "@convertflow/contracts";
import { defaultConfig, type EditorTool } from "./campaign-defaults";

/**
 * Starting points for the campaign gallery. Each one is a complete, valid campaign config built on the same
 * defaults the editor uses, so picking one opens the editor with everything filled in and nothing published.
 * Copy is neutral on purpose: no invented numbers, and no discount unless the template says it needs a code.
 */

type Cfg = CampaignConfig;

export type TemplateFormat = "popup" | "slide_in" | "bar" | "toast" | "feed" | "inline" | "recommendation";
export type TemplateGoal = "signups" | "announce" | "add_to_cart" | "free_shipping" | "coupon" | "restock";

export interface Template {
  id: string;
  name: string;
  /** One line shown under the name. */
  blurb: string;
  /** The campaign format shown in the filters. */
  format: TemplateFormat;
  goal: TemplateGoal;
  /** What the merchant has to have in place for it to work, shown as a note on the card. */
  needs?: string;
  /** Growth plan only. */
  growth?: boolean;
  config: () => Cfg;
}

export const FORMAT_LABEL: Record<TemplateFormat, string> = {
  popup: "Popups", slide_in: "Slide-ins", bar: "Bars", toast: "Toasts", feed: "Notification feed", inline: "Inline forms", recommendation: "Recommendations",
};
export const GOAL_LABEL: Record<TemplateGoal, string> = {
  signups: "Email signups", announce: "Announcements", add_to_cart: "Add to cart", free_shipping: "Free shipping", coupon: "Coupons", restock: "Back in stock",
};

const style = (c: Cfg, s: Partial<Cfg["style"]>): Cfg => ({ ...c, style: { ...c.style, ...s } });
const copy = (c: Cfg, creative: Partial<Cfg["creative"]>): Cfg => ({ ...c, creative: { ...c.creative, ...creative } });
const site = (c: Cfg, over: Partial<Cfg>): Cfg => ({ ...c, ...over });

const email = (name: string, over: Partial<Cfg>, creative: Partial<Cfg["creative"]>): Cfg => {
  const c = defaultConfig("email");
  return site(copy(c, creative), { name, ...over });
};

export const TEMPLATES: Template[] = [
  {
    id: "email-newsletter", name: "Newsletter popup", blurb: "A clean signup that appears after a short delay.", format: "popup", goal: "signups",
    config: () => email("Newsletter popup", { trigger: { type: "delay", seconds: 8 } }, { headline: "Join our email list", body: "News and offers, straight to your inbox." }),
  },
  {
    id: "email-welcome-offer", name: "Welcome offer", blurb: "Reveal a discount code after the shopper confirms.", format: "popup", goal: "signups", needs: "A discount code that already exists in your store, within your store's limit.",
    config: () => {
      const c = email("Welcome offer", { trigger: { type: "delay", seconds: 6 }, promotion: { code: "WELCOME10", percentOff: 10, label: "Welcome offer" } },
        { headline: "Get 10% off your first order", body: "Sign up and confirm your email to unlock your code." });
      return style(c, { accent: "#111111", accentText: "#FFFFFF" });
    },
  },
  {
    id: "email-exit-intent", name: "Exit-intent signup", blurb: "One last chance to subscribe as they leave (desktop).", format: "popup", goal: "signups",
    config: () => email("Exit-intent signup", { trigger: { type: "exit_intent" }, targeting: { match: "all", conditions: [{ field: "device", op: "in", value: ["desktop"] }] } },
      { headline: "Before you go", body: "Get new arrivals and offers by email. No spam." }),
  },
  {
    id: "email-slide-in", name: "Slide-in signup", blurb: "A quiet corner card after the shopper scrolls.", format: "slide_in", goal: "signups",
    config: () => style(email("Slide-in signup", { format: "slide_in", trigger: { type: "scroll_depth", percent: 40 } }, { headline: "Stay in the loop", body: "New arrivals and offers by email." }), { placement: "bottom_right" }),
  },
  {
    id: "email-bar", name: "Signup bar", blurb: "A slim bar along the top of every page.", format: "bar", goal: "signups",
    config: () => style(email("Signup bar", { format: "announcement_bar", trigger: { type: "immediate" } }, { headline: "Get news and offers by email", body: "", ctaLabel: "Sign up" }), { placement: "top", background: "#0A0C14", text: "#FFFFFF", accent: "#2350FF" }),
  },
  {
    id: "email-inline", name: "Footer signup form", blurb: "A form that sits in the page, never triggers.", format: "inline", goal: "signups", needs: "Optional: add data-convertflow-form where it should appear.",
    config: () => email("Footer signup form", { format: "inline", trigger: { type: "immediate" } }, { headline: "Join our email list", body: "News and offers, straight to your inbox." }),
  },
  {
    id: "toast-free-shipping", name: "Free-shipping progress", blurb: "Tells shoppers how far their real cart is from free shipping.", format: "toast", goal: "free_shipping", needs: "Set your store's real free-shipping minimum.",
    config: () => {
      const c = defaultConfig("toast");
      return copy(site(c, { name: "Free-shipping progress", trigger: { type: "delay", seconds: 3 }, goal: { type: "purchase" }, toast: { kind: "shipping_incentive", corner: "bottom_left", animation: "slide", freeShippingThreshold: 75 } }),
        { headline: "You're close to free shipping", body: "", ctaLabel: "Keep shopping", ctaUrl: "/collections/all" });
    },
  },
  {
    id: "toast-announcement", name: "Announcement toast", blurb: "A short message with a button that never covers the page.", format: "toast", goal: "announce",
    config: () => copy(site(defaultConfig("toast"), { name: "Announcement toast", trigger: { type: "delay", seconds: 4 } }), { headline: "Something new just landed", body: "", ctaLabel: "Take a look", ctaUrl: "/collections/all" }),
  },
  {
    id: "toast-coupon", name: "Coupon reveal", blurb: "Hides the code until the shopper asks for it.", format: "toast", goal: "coupon", needs: "A discount code that already exists in your store, within your store's limit.",
    config: () => copy(site(defaultConfig("toast"), { name: "Coupon reveal", trigger: { type: "delay", seconds: 10 }, toast: { kind: "coupon", corner: "bottom_right", animation: "slide" }, promotion: { code: "THANKS10", percentOff: 10, label: "A little thank-you" } }),
      { headline: "A little thank-you", body: "Tap to reveal your code.", ctaLabel: "Reveal code" }),
  },
  {
    id: "feed-new-arrivals", name: "New arrivals card", blurb: "A card in the bell menu shoppers can reopen any time.", format: "feed", goal: "announce",
    config: () => site(defaultConfig("feed"), { name: "New arrivals card" }),
  },
  {
    id: "feed-sale", name: "Sale announcement card", blurb: "Pinned first in the feed, with an end date you set.", format: "feed", goal: "announce",
    config: () => {
      const c = defaultConfig("feed");
      return copy(site(c, { name: "Sale announcement card", feed: { ...c.feed!, category: "Offers", order: 10 } }), { headline: "The sale is on", body: "Browse everything that's marked down.", ctaLabel: "Shop the sale", ctaUrl: "/collections/sale" });
    },
  },
  {
    id: "upsell-product-page", name: "You might also like", blurb: "In-stock products from the same collection on product pages.", format: "recommendation", goal: "add_to_cart", needs: "A catalog with collections imported or synced.",
    config: () => site(defaultConfig("upsell"), { name: "You might also like" }),
  },
  {
    id: "upsell-free-shipping-gap", name: "Close the shipping gap", blurb: "Products that bring the cart up to free shipping.", format: "recommendation", goal: "free_shipping", needs: "A catalog, and your store's real free-shipping minimum.",
    config: () => {
      const c = defaultConfig("upsell");
      return copy(site(c, { name: "Close the shipping gap", recommend: { ...c.recommend!, source: "shipping_threshold", freeShippingThreshold: 75, placement: "cart" },
        targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["cart"] }] } }), { headline: "Add a little more for free shipping" });
    },
  },
  {
    id: "upsell-sold-out", name: "Alternatives when sold out", blurb: "Offer similar products when the viewed one is out of stock.", format: "recommendation", goal: "add_to_cart", needs: "Link alternatives on the Upsells page and keep stock synced.",
    config: () => {
      const c = defaultConfig("upsell");
      return copy(site(c, { name: "Alternatives when sold out", recommend: { ...c.recommend!, source: "alternatives" } }), { headline: "Sold out? Try one of these" });
    },
  },
  {
    id: "bar-sitewide", name: "Sitewide announcement bar", blurb: "A slim bar for shipping dates, sales and notices.", format: "bar", goal: "announce",
    config: () => style(copy(site(defaultConfig(), { name: "Sitewide announcement bar", format: "announcement_bar", trigger: { type: "immediate" } }), { headline: "Free returns on every order", body: "", ctaLabel: "Learn more", ctaUrl: "/policies/refund-policy" }), { placement: "top", background: "#0A0C14", text: "#FFFFFF", accent: "#2350FF" }),
  },
  {
    id: "slide-in-promo", name: "Promo slide-in", blurb: "A corner card for a collection or an offer.", format: "slide_in", goal: "announce",
    config: () => style(copy(site(defaultConfig(), { name: "Promo slide-in", format: "slide_in", trigger: { type: "scroll_depth", percent: 35 } }), { headline: "New this week", body: "Fresh arrivals, just in.", ctaLabel: "Shop new", ctaUrl: "/collections/new" }), { placement: "bottom_right" }),
  },
  {
    id: "popup-announcement", name: "Announcement popup", blurb: "A centred message for something that can't be missed.", format: "popup", goal: "announce",
    config: () => copy(site(defaultConfig(), { name: "Announcement popup", trigger: { type: "delay", seconds: 6 } }), { headline: "Our summer collection is here", body: "Take a look at what's new.", ctaLabel: "Shop now", ctaUrl: "/collections/all" }),
  },
  {
    id: "restock-alert", name: "Back-in-stock alert", blurb: "Shoppers leave an email and get one alert when it returns.", format: "popup", goal: "restock", growth: true, needs: "Your product pages must provide the product id to the snippet.",
    config: () => {
      const c = defaultConfig();
      return copy(site(c, { name: "Back-in-stock alert", format: "restock", trigger: { type: "immediate" }, goal: { type: "subscribe" },
        targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["product"] }, { field: "product_available", op: "equals", value: false }] } }),
      { headline: "Notify me when it's back", body: "Leave your email and we'll tell you once.", ctaLabel: "Notify me", ctaUrl: "/" });
    },
  },
];

export const templateById = (id: string | null | undefined): Template | undefined => TEMPLATES.find((t) => t.id === id);

/** Tool the editor should open for a template's config, so the right controls show. */
export const editorToolOf = (c: Cfg): EditorTool | undefined => (c.tool === "toast" || c.tool === "feed" || c.tool === "email" || c.tool === "upsell" ? c.tool : undefined);
