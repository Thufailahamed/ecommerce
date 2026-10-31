import { SHIPPED_TOOLS, type Tool } from "@convertflow/contracts";

export interface ToolMeta {
  key: Tool;
  /** Shown in navigation and headings. Override per deployment with NEXT_PUBLIC_TOOL_NAME_<KEY> (for example NEXT_PUBLIC_TOOL_NAME_TOAST). */
  name: string;
  tagline: string;
  /** What the tool does, in one or two sentences, for its landing page. */
  about: string;
  /** Whether the whole path (editor, storefront, backend, analytics) exists and is tested. Unshipped tools cannot be created or published. */
  shipped: boolean;
  /** What a merchant needs to do before it works. */
  setup: string[];
}

// NEXT_PUBLIC_* must be read with a static property name for Next.js to inline it at build time.
const NAMES: Record<Tool, string | undefined> = {
  toast: process.env.NEXT_PUBLIC_TOOL_NAME_TOAST,
  feed: process.env.NEXT_PUBLIC_TOOL_NAME_FEED,
  upsell: process.env.NEXT_PUBLIC_TOOL_NAME_UPSELL,
  sms: process.env.NEXT_PUBLIC_TOOL_NAME_SMS,
  email: process.env.NEXT_PUBLIC_TOOL_NAME_EMAIL,
};

const BASE: Record<Tool, Omit<ToolMeta, "key" | "name" | "shipped"> & { defaultName: string }> = {
  toast: {
    defaultName: "Toasts",
    tagline: "Small, non-blocking messages",
    about: "Show offers, shipping incentives and announcements in a small notification that never covers the page. Targeted by page, cart and visitor, capped so shoppers are not nagged.",
    setup: ["Install the storefront snippet", "Optional: import your catalog for product offers"],
  },
  feed: {
    defaultName: "Notification feed",
    tagline: "A bell shoppers can reopen",
    about: "A bell that stays on the page so shoppers can find your offers and updates whenever they are ready. Each campaign is one card; it can be scheduled, expire, and be targeted like any other. Read state stays in the shopper's own browser.",
    setup: ["Install the storefront snippet"],
  },
  upsell: {
    defaultName: "Upsells",
    tagline: "Recommendations that add to cart",
    about: "Show relevant, in-stock products on the product page, the cart or in a toast, and let shoppers add them to the cart without leaving the page. Products, prices and stock come from your catalog; recommendations are rule-based (your picks, collections, product links, or the free-shipping gap), never guessed.",
    setup: ["Install the storefront snippet", "Import or sync your catalog", "Custom store only: provide ConvertFlow.addToCart so products can be added in place"],
  },
  sms: {
    defaultName: "SMS signup",
    tagline: "Consent-aware phone capture",
    about: "Collect SMS marketing subscribers with an explicit, unticked consent box. Shoppers confirm their number with a one-time code we text them, so nobody is subscribed to a number they do not hold. Popup, slide-in, bar or inline form. Export verified numbers as a CSV, or have them copied with their SMS consent to Klaviyo. This app does not send marketing texts itself.",
    setup: ["Install the storefront snippet", "Connect Klaviyo (Subscribers page) to text your subscribers from there", "Have your SMS consent wording reviewed for the countries you sell to"],
  },
  email: {
    defaultName: "Email signup",
    tagline: "Consent-aware email capture",
    about: "Collect email subscribers with an explicit, unticked consent box and double opt-in. Popup, slide-in, bar or inline form, with an optional first name and a discount code that is revealed only after they confirm. Export confirmed subscribers as a CSV, or have them copied automatically to Klaviyo or Mailchimp. This app does not send marketing email itself.",
    setup: ["Install the storefront snippet", "Optional: connect Klaviyo or Mailchimp (Subscribers page)", "Have your consent wording reviewed for the regions you sell to"],
  },
};

export const TOOL_ORDER: readonly Tool[] = ["toast", "feed", "upsell", "sms", "email"];

export const TOOLS: Record<Tool, ToolMeta> = Object.fromEntries(TOOL_ORDER.map((key) => {
  const { defaultName, ...rest } = BASE[key];
  return [key, { key, name: NAMES[key]?.trim() || defaultName, shipped: SHIPPED_TOOLS.has(key), ...rest }];
})) as Record<Tool, ToolMeta>;

export const isTool = (v: string): v is Tool => (TOOL_ORDER as readonly string[]).includes(v);
