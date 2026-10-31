import { z } from "zod";

/**
 * Internal platform events: things that HAPPENED inside the platform or at a connected commerce platform, recorded once
 * and delivered to any module that subscribes. They are not the storefront analytics beacons in `events.ts` (those are
 * anonymous, browser-reported, high volume and are only ever aggregated).
 *
 * Rules (see docs/event-catalog.md):
 * - An event is emitted only after the outcome it names is durable (the row is written, the webhook verified).
 * - Payloads carry ids and the minimum facts a consumer needs. Never an address, a phone number, a name or a credential.
 * - Every type is versioned. A breaking payload change is a new `schemaVersion`, and consumers say which they accept.
 */

const Id = z.string().min(1).max(100);
const Currency = z.string().regex(/^[A-Z]{3}$/);

export const DOMAIN_EVENT_SOURCES = ["api", "shopify_webhook", "woocommerce_webhook", "storefront", "scheduler", "system"] as const;
export const DomainEventSource = z.enum(DOMAIN_EVENT_SOURCES);
export type DomainEventSource = z.infer<typeof DomainEventSource>;

/**
 * `none`: no link to a person at all. `pseudonymous`: carries an internal id that a person's record also carries
 * (a contact id), so it is deleted when that person is erased. Nothing classed higher is allowed on the bus.
 */
export const PRIVACY_CLASSES = ["none", "pseudonymous"] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

interface CatalogEntry<P extends z.ZodType> { version: number; privacy: PrivacyClass; payload: P; description: string }
const entry = <P extends z.ZodType>(e: CatalogEntry<P>) => e;

export const DOMAIN_EVENTS = {
  "store.connected": entry({
    version: 1, privacy: "none", description: "A store was added to a workspace and can be served.",
    payload: z.object({ storeId: Id, platform: z.enum(["shopify", "woocommerce", "bigcommerce", "magento", "custom"]) }).strict(),
  }),
  "store.disconnected": entry({
    version: 1, privacy: "none", description: "A store stopped being served: the merchant disconnected it, or the platform reported the app uninstalled.",
    payload: z.object({ storeId: Id, reason: z.enum(["merchant", "platform_uninstalled"]) }).strict(),
  }),
  "campaign.published": entry({
    version: 1, privacy: "none", description: "A new immutable campaign version became the served version (publish or rollback).",
    payload: z.object({
      campaignId: Id, versionId: Id, version: z.number().int().positive(),
      tool: z.enum(["toast", "feed", "upsell", "sms", "email"]), origin: z.enum(["manual", "ai", "rollback"]),
    }).strict(),
  }),
  "campaign.paused": entry({
    version: 1, privacy: "none", description: "A live campaign stopped being served by a merchant's choice.",
    payload: z.object({ campaignId: Id }).strict(),
  }),
  "campaign.resumed": entry({
    version: 1, privacy: "none", description: "A paused campaign is served again from its published version.",
    payload: z.object({ campaignId: Id }).strict(),
  }),
  "campaign.archived": entry({
    version: 1, privacy: "none", description: "A campaign was archived; it is never served again.",
    payload: z.object({ campaignId: Id }).strict(),
  }),
  "order.created": entry({
    version: 1, privacy: "none",
    description: "The commerce platform reported a new order through a verified webhook. Not emitted for browser-reported purchases, which stay analytics beacons.",
    payload: z.object({
      platform: z.enum(["shopify", "woocommerce"]), externalOrderId: Id, total: z.number().min(0), currency: Currency, placedAt: z.iso.datetime(),
    }).strict(),
  }),
  "catalog.products_changed": entry({
    version: 1, privacy: "none",
    description: "Products were created, updated or archived in one batch (an import, one sync page, or one product webhook). Counts only, plus the external ids of products that came back in stock.",
    payload: z.object({
      origin: z.enum(["import", "sync", "webhook"]),
      created: z.number().int().min(0), updated: z.number().int().min(0), archived: z.number().int().min(0),
      restockedExternalIds: z.array(Id).max(100),
    }).strict(),
  }),
  "customer.subscribed": entry({
    version: 1, privacy: "pseudonymous", description: "A contact confirmed marketing consent on one channel (double opt-in completed).",
    payload: z.object({ contactId: Id, channel: z.enum(["email", "sms"]) }).strict(),
  }),
  "customer.unsubscribed": entry({
    version: 1, privacy: "pseudonymous", description: "A contact's marketing consent on one channel was revoked. Their identifier is suppressed on that channel.",
    payload: z.object({ contactId: Id, channel: z.enum(["email", "sms"]) }).strict(),
  }),
  "action.executed": entry({
    version: 1, privacy: "none", description: "A registered automation action ran (from an approved request or a workflow) and its outcome is recorded.",
    payload: z.object({
      action: z.string().min(1).max(60), origin: z.enum(["workflow", "ai"]), outcome: z.enum(["succeeded", "failed"]),
      requestId: Id.optional(), workflowRunId: Id.optional(),
    }).strict(),
  }),
} as const;

export type DomainEventType = keyof typeof DOMAIN_EVENTS;
export const DOMAIN_EVENT_TYPES = Object.keys(DOMAIN_EVENTS) as DomainEventType[];
export type DomainEventPayload<T extends DomainEventType> = z.infer<(typeof DOMAIN_EVENTS)[T]["payload"]>;

/** The stored, delivered form. `idempotencyKey` is unique per workspace: publishing the same outcome twice records it once. */
export interface DomainEvent<T extends DomainEventType = DomainEventType> {
  id: string;
  type: T;
  schemaVersion: number;
  organizationId: string;
  storeId: string | null;
  occurredAt: string;
  recordedAt: string;
  source: DomainEventSource;
  correlationId: string | null;
  idempotencyKey: string;
  privacy: PrivacyClass;
  payload: DomainEventPayload<T>;
}

export function isDomainEventType(x: string): x is DomainEventType {
  return Object.prototype.hasOwnProperty.call(DOMAIN_EVENTS, x);
}

/** Validates a payload against its catalog entry. Returns the parsed (stripped of nothing: payloads are strict) value or the issues. */
export function parseDomainEventPayload<T extends DomainEventType>(type: T, payload: unknown):
  { ok: true; payload: DomainEventPayload<T> } | { ok: false; issues: string[] } {
  const r = DOMAIN_EVENTS[type].payload.safeParse(payload);
  return r.success
    ? { ok: true, payload: r.data as DomainEventPayload<T> }
    : { ok: false, issues: r.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`) };
}
