import type { CampaignConfig } from "@convertflow/contracts";

type Cfg = CampaignConfig;

export type EditorTool = "toast" | "feed" | "email" | "upsell";

export const defaultConfig = (tool?: EditorTool): Cfg => {
  const base: Cfg = {
    schemaVersion: 1, name: "New campaign", format: "popup",
    creative: { headline: "Welcome in", body: "Take a look at what's new.", ctaLabel: "Shop now", ctaUrl: "/collections/all" },
    style: { background: "#FFFFFF", text: "#191A1B", accent: "#003FFF", accentText: "#FFFFFF", radius: 8, placement: "center" },
    trigger: { type: "delay", seconds: 5 },
    targeting: { match: "all", conditions: [] },
    schedule: {}, frequency: { maxImpressionsPerSession: 1, suppressAfterDismissDays: 7, suppressAfterClickDays: 30 },
    priority: 50, goal: { type: "clicks" },
  };
  if (tool === "feed") {
    return { ...base, name: "New notification", tool: "feed", format: "feed_item", feed: { category: "Updates", order: 100, audience: "public", position: "bottom_right" },
      creative: { ...base.creative, headline: "A new collection just dropped", body: "Take a look at what's new this week." }, trigger: { type: "immediate" } };
  }
  if (tool === "email") {
    return { ...base, name: "New email signup", tool: "email", format: "popup", goal: { type: "subscribe" },
      creative: { ...base.creative, headline: "Join our email list", body: "News and offers, straight to your inbox.", ctaLabel: "Sign up", ctaUrl: "/" },
      form: {
        collect: { email: true, phone: false, firstName: false }, defaultCountry: "US",
        consentText: "I agree to receive marketing emails from this store. I can unsubscribe at any time.",
        consentCheckbox: true, privacyUrl: "/policies/privacy-policy", doubleOptIn: true,
        successMessage: "Thanks. You're signed up.", pendingMessage: "Check your inbox to confirm your subscription.",
      } };
  }
  if (tool === "upsell") {
    return { ...base, name: "New recommendations", tool: "upsell", format: "recommendation", goal: { type: "add_to_cart" }, trigger: { type: "immediate" },
      creative: { ...base.creative, headline: "You might also like", body: "", ctaLabel: "Add to cart", ctaUrl: "/" },
      targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["product"] }] },
      recommend: { source: "same_collection", productIds: [], collectionIds: [], excludeProductIds: [], maxProducts: 3, layout: "row", placement: "product_page", showPrice: true, onlyAvailable: true, addToCart: true } };
  }
  return tool === "toast"
    ? { ...base, name: "New toast", tool: "toast", format: "toast", toast: { kind: "announcement", corner: "bottom_left", animation: "slide" }, creative: { ...base.creative, headline: "Something new just landed", body: "" } }
    : base;
};
