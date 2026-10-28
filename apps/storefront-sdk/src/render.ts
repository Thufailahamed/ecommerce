import type { CampaignConfig } from "@convertflow/contracts";
import { renderBasic } from "./basic";
import { renderSignup } from "./email";
import { renderFeed } from "./feed";
import { renderRecommendations, type RecProduct } from "./recommend";
import { renderToast } from "./toast";

export type { RecProduct } from "./recommend";

export interface RenderHandle {
  host: HTMLElement;
  destroy(): void;
}

export interface RenderCallbacks {
  onClick?: () => void;
  onDismiss?: () => void;
  /** Restock form submitted with a syntactically valid email. The renderer never sees the network. */
  onSubscribe?: (email: string) => void | Promise<void>;
  /** A toast timed out. Not a shopper action, so it must not be recorded as a dismissal. */
  onAutoDismiss?: () => void;
  /** Email signup form submitted with a valid address (and first name, when the form asks) and the consent box ticked. Rejecting shows an error and lets the shopper retry. */
  onSignup?: (email: string, firstName?: string) => void | Promise<void>;
  /** Recommendations: a product link was followed. */
  onProductClick?: (p: RecProduct) => void;
  /** Recommendations: add this product to the cart (resolve = added, reject = failed). Absent: products link to their page instead. */
  onAdd?: (p: RecProduct) => Promise<void>;
  /** Recommendations: whether this product can be added here (see RecCallbacks.canAdd). */
  canAdd?: (p: RecProduct) => boolean;
}

/** Live facts the renderer may need. Anything unknown is left undefined, never guessed. */
export interface RenderContext {
  cartSubtotal?: number;
  /** Width to lay out for, when it is not the real window (the editor's mobile preview). */
  viewportWidth?: number;
  /** ISO 4217 currency of the store, for formatting amounts. */
  currency?: string;
  /** Recommendations: the products to show. The storefront passes what the server chose; the editor passes labelled samples. */
  products?: RecProduct[];
}

/** An email signup form (not the back-in-stock form, which is a plain format of its own). */
export const isSignupForm = (cfg: CampaignConfig): boolean => cfg.format !== "restock" && cfg.form?.collect.email === true;

/**
 * Shared by the editor's live preview and the tests: it draws any campaign by calling the same per-tool renderers the
 * storefront script loads on demand, so what the merchant sees is what shoppers get. All text is set via textContent;
 * URLs are re-checked at render time.
 */
export function renderCampaign(doc: Document, cfg: CampaignConfig, cb: RenderCallbacks = {}, mount: HTMLElement = doc.body, ctx?: RenderContext): RenderHandle {
  if (cfg.format === "toast") return renderToast(doc, cfg, cb, mount, ctx);
  if (cfg.format === "recommendation") {
    return renderRecommendations(doc, cfg, ctx?.products ?? [], {
      ...(cb.onProductClick ? { onClick: cb.onProductClick } : {}), ...(cb.onAdd ? { onAdd: cb.onAdd } : {}), ...(cb.canAdd ? { canAdd: cb.canAdd } : {}), ...(cb.onDismiss ? { onDismiss: cb.onDismiss } : {}),
    }, mount, ctx);
  }
  // The editor previews a feed item as the real feed, opened, containing just that item.
  if (cfg.format === "feed_item") return renderFeed(doc, [{ campaignId: "preview", versionId: "preview", config: cfg, publishedAt: new Date().toISOString() }], {}, mount, { open: true });
  if (isSignupForm(cfg)) return renderSignup(doc, cfg, cb, mount);
  return renderBasic(doc, cfg, cb, mount, ctx);
}
