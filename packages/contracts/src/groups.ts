import { z } from "zod";

/** Limits keep a store's folders and saved drafts a manageable size. Enforced by the API. */
export const GROUP_LIMIT = 50;
export const TEMPLATE_LIMIT = 50;

export const CampaignGroupInput = z.object({ name: z.string().trim().min(1).max(60) });
export type CampaignGroupInput = z.infer<typeof CampaignGroupInput>;

export const GroupMembersInput = z.object({ campaignIds: z.array(z.string().min(1).max(100)).min(1).max(200) });
export type GroupMembersInput = z.infer<typeof GroupMembersInput>;

export const CampaignTemplateInput = z.object({
  name: z.string().trim().min(1).max(80),
  campaignId: z.string().min(1).max(100),
});
export type CampaignTemplateInput = z.infer<typeof CampaignTemplateInput>;
