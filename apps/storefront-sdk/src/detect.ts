import type { VisitorContext } from "@convertflow/campaign-engine";

/**
 * Platform-agnostic page context. Order of precedence:
 *  1. window.ConvertFlowContext (merchant/platform plugin supplies exact data)
 *  2. platform globals (Shopify)
 *  3. URL heuristics, covering Shopify, WooCommerce, BigCommerce, Magento and generic paths
 * Anything not determinable is left undefined (unknown), never guessed.
 */
export interface PageOverrides extends Partial<Omit<VisitorContext, "now" | "visitorType" | "pagesViewed">> {}

type Win = Window & {
  ConvertFlowContext?: PageOverrides | (() => PageOverrides);
  Shopify?: { currency?: { active?: string } };
  ShopifyAnalytics?: { meta?: { page?: { pageType?: string; resourceId?: number | string } } };
};

const RULES: Array<[RegExp, VisitorContext["pageType"]]> = [
  [/^\/?$/, "home"],
  [/\/(cart|basket|bag)(\/|$)/i, "cart"],
  [/\/(checkout|checkouts)(\/|$)/i, "checkout"],
  [/\/(products?|p|item|shop\/[^/]+)\/[^/]+/i, "product"],
  [/\/(collections?|category|categories|product-category|c|shop)(\/|$)/i, "collection"],
  [/\/(search|s)(\/|$)/i, "search"],
  [/\/(pages?|blogs?|about|contact|faq)(\/|$)/i, "content"],
];

export function pageTypeFromPath(path: string): VisitorContext["pageType"] {
  for (const [re, t] of RULES) if (re.test(path)) return t;
  return "other";
}

export function deviceFromWidth(w: number): VisitorContext["device"] {
  return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
}

export function detectContext(win: Window): Omit<VisitorContext, "now" | "visitorType" | "pagesViewed"> {
  const w = win as Win;
  const path = win.location.pathname;
  const base: Omit<VisitorContext, "now" | "visitorType" | "pagesViewed"> = {
    pageType: pageTypeFromPath(path),
    urlPath: path,
    device: deviceFromWidth(win.innerWidth),
  };

  const sp = w.ShopifyAnalytics?.meta?.page?.pageType;
  if (sp) {
    const m: Record<string, VisitorContext["pageType"]> = { home: "home", collection: "collection", product: "product", cart: "cart", searchresults: "search", page: "content" };
    base.pageType = m[sp] ?? base.pageType;
    const id = w.ShopifyAnalytics?.meta?.page?.resourceId;
    if (base.pageType === "product" && id !== undefined) (base as VisitorContext).productId = String(id);
  }

  const o = typeof w.ConvertFlowContext === "function" ? w.ConvertFlowContext() : w.ConvertFlowContext;
  return o ? { ...base, ...o } : base;
}
