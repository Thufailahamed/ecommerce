import { z } from "zod";
import { SCHEMA_VERSION } from "./campaign";

export const EventType = z.enum([
  "campaign_eligible", "campaign_impression", "campaign_click", "campaign_dismiss",
  "experiment_assigned", "purchase_observed",
  "notification_subscribed", "notification_delivered", "notification_clicked",
  // Feed
  "feed_open", "feed_item_click",
  // Upsell
  "recommendation_impression", "recommendation_click", "recommendation_add_to_cart",
  // Signup forms. These carry no personal data: the submission itself goes to /api/v1/subscribe.
  "form_submit_attempt", "form_submit_success", "form_submit_failure",
]);
export type EventType = z.infer<typeof EventType>;

export const TrackedEvent = z.object({
  eventId: z.string().min(8).max(64),
  type: EventType,
  siteId: z.string().min(1).max(64),
  campaignId: z.string().max(64).optional(),
  versionId: z.string().max(64).optional(),
  sessionId: z.string().min(8).max(64),
  occurredAt: z.string().datetime(),
  /** For experiment_assigned: which arm this visitor was randomised into. */
  group: z.enum(["treatment", "holdout"]).optional(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Order data for purchase_observed. Amounts in minor units are not assumed; currency is ISO 4217. */
  order: z.object({
    orderId: z.string().max(100),
    total: z.number().min(0),
    currency: z.string().length(3),
    /**
     * Client-reported last campaign click (from SDK storage). Spoofable by design of any
     * client-side signal; the server verifies the version belongs to the store and the 7-day window,
     * and the dashboard labels the result as attributed, never incremental.
     */
    lastClick: z.object({
      campaignId: z.string().max(64),
      versionId: z.string().max(64),
      clickedAt: z.string().datetime(),
    }).optional(),
    /** The visitor's experiment arm at purchase time, so orders can be compared across treatment and holdout. */
    experiment: z.object({
      campaignId: z.string().max(64),
      versionId: z.string().max(64),
      group: z.enum(["treatment", "holdout"]),
    }).optional(),
  }).optional(),
});
export type TrackedEvent = z.infer<typeof TrackedEvent>;

export const EventBatch = z.object({
  consent: z.literal(true),
  events: z.array(TrackedEvent).min(1).max(50),
});
export type EventBatch = z.infer<typeof EventBatch>;
