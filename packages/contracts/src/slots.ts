// Pure helpers with type-only imports. They live apart from campaign.ts (which pulls in Zod) so the storefront
// bundle can use them without shipping a validation library to every shopper: import them from
// "@convertflow/contracts/slots". The SDK build budget fails if that ever regresses.
import type { CampaignFormat } from "./campaign";
import type { Slot, Tool } from "./tools";

/** The tool a config belongs to. Configs saved before tools existed are promotions, or restock forms. */
export function toolOf(c: { tool?: Tool | undefined; format: CampaignFormat }): Tool {
  return c.tool ?? (c.format === "restock" ? "email" : "toast");
}

/**
 * Which screen slot a campaign occupies. Shared by the engine (arbitration), the SDK and the preview.
 * - interruptive: takes attention (modal popups, popup/slide-in signup forms)
 * - ambient: small and non-blocking (toasts, bars)
 * - passive: part of the page (feed bell, inline forms, inline recommendations)
 */
export function slotOf(c: { tool?: Tool | undefined; format: CampaignFormat; recommend?: { placement: string } | undefined }): Slot {
  const tool = toolOf(c);
  if (tool === "feed") return "passive";
  if (tool === "upsell") return c.recommend?.placement === "toast" ? "ambient" : "passive";
  if (tool === "toast") return c.format === "popup" ? "interruptive" : "ambient";
  // sms / email forms
  if (c.format === "inline") return "passive";
  if (c.format === "announcement_bar") return "ambient";
  return "interruptive"; // popup, slide_in and the restock form ask for input, so they are interruptive
}
