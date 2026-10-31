import type { Plan } from "./plans";
import { SHIPPED_TOOLS, type Tool } from "./tools";

/**
 * What a workspace's plan lets it do, separate from what a member's role lets them do (permissions.ts). The API
 * enforces both.
 *
 * `availability` is the commercial state of a capability, independent of plans:
 * - `ga`: granted by the plan rule.
 * - `preview`: built, but only for workspaces that have the matching feature flag (`organization_features`). Never on a
 *   pricing page.
 * - `planned`: an identifier reserved for a future module. Never granted, whatever the plan or flags say.
 */
export type Availability = "ga" | "preview" | "planned";

const toolOn = (p: Plan, t: Tool) => SHIPPED_TOOLS.has(t) && p.tools.includes(t);

interface CapabilityDef { availability: Availability; description: string; grantedBy: (p: Plan) => boolean }

export const CAPABILITIES = {
  "campaigns.create": { availability: "ga", description: "Create and publish campaigns", grantedBy: () => true },
  // A tool is granted only once it is in SHIPPED_TOOLS (read at call time: that set is the one gate for what can reach shoppers).
  "tools.toast": { availability: "ga", description: "Publish toast campaigns", grantedBy: (p) => toolOn(p, "toast") },
  "tools.feed": { availability: "ga", description: "Publish notification-feed campaigns", grantedBy: (p) => toolOn(p, "feed") },
  "tools.upsell": { availability: "ga", description: "Publish upsell campaigns and serve recommendations", grantedBy: (p) => toolOn(p, "upsell") },
  "tools.email": { availability: "ga", description: "Publish email signup forms and collect subscribers", grantedBy: (p) => toolOn(p, "email") },
  "tools.sms": { availability: "ga", description: "Publish SMS signup forms and collect verified phone subscribers", grantedBy: (p) => toolOn(p, "sms") && p.smsVerificationsPerMonth > 0 },
  "ai.generate": { availability: "ga", description: "AI campaign drafts and AI tasks", grantedBy: (p) => p.aiGenerationsPerMonth > 0 },
  "experiments.run": { availability: "ga", description: "Holdout experiments", grantedBy: (p) => p.experiments },
  "restock.alerts": { availability: "ga", description: "Back-in-stock email alerts", grantedBy: (p) => p.notificationsPerMonth > 0 },
  "integrations.connect": { availability: "ga", description: "Connect catalog and list providers", grantedBy: () => true },
  "sites.build": { availability: "ga", description: "AI store builder", grantedBy: (p) => p.maxSites > 0 },
  "workflows.create": { availability: "preview", description: "Automation workflows", grantedBy: (p) => p.experiments },
  "ai.commerce_manager": { availability: "preview", description: "AI Commerce Manager proposals", grantedBy: (p) => p.aiGenerationsPerMonth > 0 },
  "analytics.advanced": { availability: "planned", description: "Advanced analytics (not built)", grantedBy: () => false },
  "loyalty.enabled": { availability: "planned", description: "Loyalty (not built)", grantedBy: () => false },
  "reviews.enabled": { availability: "planned", description: "Reviews (not built)", grantedBy: () => false },
  "post_purchase.enabled": { availability: "planned", description: "Post-purchase experiences (not built)", grantedBy: () => false },
} as const satisfies Record<string, CapabilityDef>;

export type Capability = keyof typeof CAPABILITIES;

export const toolCapability = (t: Tool): Capability => `tools.${t}` as Capability;

/** Metered quantities. Each is counted per workspace per calendar month (UTC) in `usage_records`. */
export const USAGE_METRICS = ["pageviews", "ai_generations", "notifications", "workflow_executions", "builder_messages", "ai_images", "sms_verifications"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

/** The plan's monthly allowance for a metric. */
export function monthlyLimit(p: Plan, m: UsageMetric): number {
  switch (m) {
    case "pageviews": return p.trackedPageviewsPerMonth;
    case "ai_generations": return p.aiGenerationsPerMonth;
    case "notifications": return p.notificationsPerMonth;
    // Workflows are a preview: a modest allowance on plans that hold the capability, none elsewhere.
    case "workflow_executions": return p.experiments ? (p.id === "scale" ? 10_000 : 1_000) : 0;
    case "builder_messages": return p.builderMessagesPerMonth;
    case "ai_images": return p.aiImagesPerMonth;
    case "sms_verifications": return p.smsVerificationsPerMonth;
  }
}

/** Pure decision; the server adds the workspace's feature flags. */
export function capabilityGranted(c: Capability, plan: Plan, flags: ReadonlySet<string>): boolean {
  const def = CAPABILITIES[c];
  if (def.availability === "planned") return false;
  if (def.availability === "preview" && !flags.has(c)) return false;
  return def.grantedBy(plan);
}
