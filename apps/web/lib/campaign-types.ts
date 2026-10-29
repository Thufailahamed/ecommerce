import type { CampaignRow } from "./api";

/**
 * The campaign folders shown in the sidebar and above the list, grouped the way a merchant thinks about a campaign
 * (a popup, a bar at the top, an inline form) rather than by internal tool name. A campaign's folder comes from its
 * format, so the same grouping works for every tool.
 */
export const CAMPAIGN_TYPES = [
  { key: "popups", label: "Popups", shipped: true },
  { key: "sticky-bars", label: "Sticky bars", shipped: true },
  { key: "embeds", label: "Embeds", shipped: true },
  { key: "on-site-tools", label: "Toasts & feed", shipped: true },
  { key: "landing-pages", label: "Landing pages", shipped: false },
] as const;

export type CampaignType = (typeof CAMPAIGN_TYPES)[number]["key"];

export const isCampaignType = (v: string | null): v is CampaignType =>
  CAMPAIGN_TYPES.some((t) => t.key === v && t.shipped);

const FORMAT_TYPE: Record<string, CampaignType> = {
  popup: "popups",
  slide_in: "popups",
  restock: "popups",
  announcement_bar: "sticky-bars",
  inline: "embeds",
  toast: "on-site-tools",
  feed_item: "on-site-tools",
  recommendation: "on-site-tools",
};

/** The folder a campaign belongs to. Reads the saved draft's format; falls back to the on-site tools folder. */
export function typeOf(c: Pick<CampaignRow, "draftConfig">): CampaignType {
  const format = (c.draftConfig as { format?: unknown } | null)?.format;
  return (typeof format === "string" && FORMAT_TYPE[format]) || "on-site-tools";
}

export const typeLabel = (key: CampaignType): string => CAMPAIGN_TYPES.find((t) => t.key === key)?.label ?? key;

/** Canonical list URL for a folder. The campaign list reads `type` from the URL, so links and tabs stay in sync. */
export const campaignsHref = (folder: "all" | CampaignType): string =>
  folder === "all" ? "/app/campaigns" : `/app/campaigns?type=${folder}`;
