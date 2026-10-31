import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { CampaignConfig, SHIPPED_TOOLS, toolCapability, toolOf, type Tool, type StorefrontConfig } from "@convertflow/contracts";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { entitlementsFor, getPlan, quota } from "./entitlements.js";
import { restockAvailable } from "./restock.js";
import { contactCaptureAvailable, smsCaptureAvailable } from "./contacts.js";
import { putSite } from "./sites.js";
import { recordAudit, type AuditSummary } from "./audit.js";
import { publishDomainEvent } from "./domain-events.js";

const { campaigns, campaignVersions, stores } = schema;

export function validateDraft(raw: unknown): { valid: boolean; issues: string[]; warnings: string[]; config?: CampaignConfig } {
  const r = CampaignConfig.safeParse(raw);
  if (!r.success) return { valid: false, issues: r.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`), warnings: [] };
  const c = r.data, warnings: string[] = [];
  if (c.targeting.conditions.length === 0) warnings.push("No targeting rules: this will show to every visitor on every page.");
  if (c.trigger.type === "immediate" && c.format === "popup") warnings.push("A popup that opens immediately can hurt the experience; consider a delay or scroll trigger.");
  if (c.frequency.maxImpressionsPerSession > 3) warnings.push("More than 3 impressions per session can feel intrusive.");
  if (c.schedule.endsAt && Date.parse(c.schedule.endsAt) < Date.now()) warnings.push("The end date is in the past, so it will never show.");
  if (c.format === "restock" && !c.targeting.conditions.some((x) => x.field === "product_available")) warnings.push("Add the rule “Product is out of stock” so the form only appears on unavailable products.");
  if (c.format === "restock" && c.targeting.match === "any") warnings.push("Use “all” matching so the out-of-stock rule is always required.");
  if (c.experiment) warnings.push(`${c.experiment.holdoutPercent}% of consenting visitors will not see this campaign, so results can be measured. Visitors who have not consented always see it.`);
  if (c.promotion) warnings.push("This campaign shows a discount code. Make sure the code exists in your store and is valid for these products.");
  warnings.push(...toolWarnings(c));
  return { valid: true, issues: [], warnings, config: c };
}

/** Advice that is specific to a tool. Warnings never block saving; hard rules live in the contract and in assertEntitled. */
function toolWarnings(c: CampaignConfig): string[] {
  const w: string[] = [];
  const tool = toolOf(c);
  if (tool === "sms" && c.form) {
    if (!/msg|message|data|rates/i.test(c.form.consentText)) w.push("The SMS consent text does not mention message frequency or that message and data rates may apply.");
    w.push("SMS consent wording must be reviewed for the countries you sell into before you collect numbers.");
  }
  if (tool === "email" && c.form && c.format !== "restock" && !c.form.doubleOptIn) w.push("Double opt-in is off: addresses are treated as subscribed without confirmation, which raises the risk of typos and spam-trap signups.");
  if ((tool === "sms" || tool === "email") && c.trigger.type === "immediate" && (c.format === "popup" || c.format === "slide_in")) w.push("A signup form that opens immediately converts poorly and annoys visitors; consider a delay, scroll or exit-intent trigger.");
  if (tool === "toast" && c.toast?.kind === "coupon" && !c.promotion) w.push("This is a coupon toast but no discount is configured, so it will show no code.");
  if (tool === "toast" && c.trigger.type === "exit_intent") w.push("Exit intent only works on desktop with a mouse; mobile visitors will not see this.");
  if (tool === "upsell" && c.recommend?.placement === "cart" && !c.targeting.conditions.some((x) => x.field === "page_type" || x.field === "cart_item_count" || x.field === "cart_subtotal")) w.push("A cart upsell should target the cart page or a cart condition, otherwise it may appear where there is no cart.");
  if (tool === "feed" && c.schedule.endsAt === undefined) w.push("This feed item never expires. Add an end date for time-limited offers so stale notifications do not stay in the feed.");
  if (tool === "feed" && c.feed?.audience === "public" && c.targeting.conditions.length > 0) w.push("Audience is set to public but targeting rules are present; the rules still apply.");
  return w;
}

export async function createCampaign(d: Deps, storeId: string, actorId: string, raw: unknown) {
  const v = validateDraft(raw);
  if (!v.valid || !v.config) throw new HttpError(422, "invalid_campaign", "Campaign is invalid", v.issues);
  const now = d.now().toISOString();
  const row = { id: newId("cmp"), storeId, name: v.config.name, tool: toolOf(v.config), status: "draft" as const, draftConfig: v.config, publishedVersionId: null, createdBy: actorId, createdAt: now, updatedAt: now };
  await d.db.insert(campaigns).values(row);
  return row;
}

async function load(d: Deps, storeId: string, id: string) {
  const [c] = await d.db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.storeId, storeId))).limit(1);
  if (!c) throw new HttpError(404, "not_found", "Campaign not found");
  return c;
}

export async function listCampaigns(d: Deps, storeId: string, tool?: Tool) {
  return d.db.select().from(campaigns).where(tool ? and(eq(campaigns.storeId, storeId), eq(campaigns.tool, tool)) : eq(campaigns.storeId, storeId)).orderBy(desc(campaigns.updatedAt));
}
export const getCampaign = load;

export async function updateDraft(d: Deps, storeId: string, id: string, raw: unknown) {
  const c = await load(d, storeId, id);
  if (c.status === "archived") throw new HttpError(409, "archived", "Archived campaigns cannot be edited");
  const v = validateDraft(raw);
  if (!v.valid || !v.config) throw new HttpError(422, "invalid_campaign", "Campaign is invalid", v.issues);
  const now = d.now().toISOString();
  await d.db.update(campaigns).set({ draftConfig: v.config, name: v.config.name, tool: toolOf(v.config), updatedAt: now }).where(eq(campaigns.id, id));
  return { ...c, draftConfig: v.config, name: v.config.name, tool: toolOf(v.config), updatedAt: now };
}

/**
 * Publishing requires the caller to pass the `updatedAt` of the draft they reviewed.
 * If the draft changed since (including an AI regeneration), the publish is refused,
 * so what is approved is exactly what goes live.
 */
export async function publish(d: Deps, storeId: string, id: string, actorId: string, approvedUpdatedAt: string, source: "manual" | "ai" | "rollback" = "manual") {
  const c = await load(d, storeId, id);
  if (c.status === "archived") throw new HttpError(409, "archived", "Archived campaigns cannot be published");
  if (c.updatedAt !== approvedUpdatedAt) throw new HttpError(409, "stale_approval", "The draft changed after it was reviewed. Review it again before publishing.");
  const v = validateDraft(c.draftConfig);
  if (!v.valid || !v.config) throw new HttpError(422, "invalid_campaign", "Campaign is invalid", v.issues);

  await assertEntitled(d, storeId, v.config);
  if (c.status !== "active" && c.status !== "scheduled") await assertActiveCapacity(d, storeId);

  const [{ m } = { m: 0 }] = await d.db.select({ m: sql<number>`coalesce(max(${campaignVersions.version}), 0)` }).from(campaignVersions).where(eq(campaignVersions.campaignId, id));
  const now = d.now();
  const versionId = newId("ver");
  await d.db.insert(campaignVersions).values({ id: versionId, campaignId: id, storeId, version: m + 1, config: v.config, publishedBy: actorId, source, createdAt: now.toISOString() });
  await d.db.update(campaigns).set({ publishedVersionId: versionId, status: statusFor(v.config, now), updatedAt: now.toISOString() }).where(eq(campaigns.id, id));
  await audit(d, storeId, actorId, "campaign.published", id, { version: m + 1, origin: source });
  await publishConfig(d, storeId);
  await publishDomainEvent(d, { type: "campaign.published", payload: { campaignId: id, versionId, version: m + 1, tool: toolOf(v.config), origin: source }, idempotencyKey: `campaign.published:${versionId}`, storeId, source: "api" });
  return { versionId, version: m + 1 };
}

/**
 * Server-side gates that depend on the store and its plan, so they cannot be bypassed by editing a draft:
 * paid features need the plan, and a promotion needs the store's explicit opt-in and stays under its ceiling.
 */
export async function assertEntitled(d: Deps, storeId: string, cfg: CampaignConfig) {
  const [s] = await d.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!s) throw new HttpError(404, "not_found", "Store not found");
  const ent = await entitlementsFor(d, s.organizationId);
  // An explicit tool is a multi-tool campaign. Configs without one are legacy promotions or restock forms and keep their old rules.
  const explicitTool = cfg.tool;
  const legacyRestock = cfg.tool === "email" && cfg.format === "restock";
  if (explicitTool && !legacyRestock) {
    if (!SHIPPED_TOOLS.has(explicitTool)) throw new HttpError(409, "tool_unavailable", `The ${explicitTool} tool is not available yet`);
    if (!ent.has(toolCapability(explicitTool))) throw new HttpError(402, "plan_limit", `The ${explicitTool} tool is not included in your plan. Upgrade to publish it.`);
  }
  // A form must never collect people it cannot confirm: without delivery it would hold every signup as pending, silently.
  if (explicitTool === "email" && !legacyRestock && !contactCaptureAvailable(d)) throw new HttpError(409, "email_unavailable", "Email signup needs email delivery (for confirmation messages), which is not configured on this deployment");
  if (explicitTool === "sms" && !smsCaptureAvailable(d)) throw new HttpError(409, "sms_unavailable", "SMS signup needs phone verification (a texted confirmation code), which is not configured on this deployment");
  if (cfg.format === "restock") {
    if (!ent.has("restock.alerts")) throw new HttpError(402, "plan_limit", "Back-in-stock alerts are included in the Growth and Scale plans");
    if (!restockAvailable(d)) throw new HttpError(409, "restock_unavailable", "Back-in-stock alerts need email delivery, which is not configured on this deployment");
  }
  if (cfg.experiment && !ent.has("experiments.run")) throw new HttpError(402, "plan_limit", "Holdout experiments are included in the Growth and Scale plans");
  if (cfg.promotion) {
    if (s.maxDiscountPercent === null) throw new HttpError(422, "promotion_not_allowed", "Promotions are off for this store. Set a maximum discount in Settings first.");
    if (cfg.promotion.percentOff > s.maxDiscountPercent) throw new HttpError(422, "promotion_exceeds_limit", `This store caps promotions at ${s.maxDiscountPercent}% off. Lower the discount or raise the limit in Settings.`);
  }
}

function statusFor(cfg: CampaignConfig, now: Date): "active" | "scheduled" {
  return cfg.schedule.startsAt && Date.parse(cfg.schedule.startsAt) > now.getTime() ? "scheduled" : "active";
}

async function assertActiveCapacity(d: Deps, storeId: string) {
  const [s] = await d.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!s) return;
  const plan = await getPlan(d, s.organizationId);
  const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)` }).from(campaigns).where(and(eq(campaigns.storeId, storeId), inArray(campaigns.status, ["active", "scheduled"])));
  if (n >= plan.maxActiveCampaigns) throw new HttpError(402, "plan_limit", `Your plan allows ${plan.maxActiveCampaigns} live campaign(s). Pause one or upgrade.`);
}

export async function pause(d: Deps, storeId: string, id: string, actorId: string) {
  const c = await load(d, storeId, id);
  if (c.status !== "active" && c.status !== "scheduled") throw new HttpError(409, "not_live", "Only live campaigns can be paused");
  const at = d.now().toISOString();
  await d.db.update(campaigns).set({ status: "paused", updatedAt: at }).where(eq(campaigns.id, id));
  await audit(d, storeId, actorId, "campaign.paused", id);
  await publishConfig(d, storeId);
  await publishDomainEvent(d, { type: "campaign.paused", payload: { campaignId: id }, idempotencyKey: `campaign.paused:${id}:${at}`, storeId, source: "api" });
}

export async function resume(d: Deps, storeId: string, id: string, actorId: string) {
  const c = await load(d, storeId, id);
  if (c.status !== "paused" || !c.publishedVersionId) throw new HttpError(409, "not_paused", "Only paused campaigns can be resumed");
  await assertActiveCapacity(d, storeId);
  const [v] = await d.db.select().from(campaignVersions).where(eq(campaignVersions.id, c.publishedVersionId)).limit(1);
  const cfg = CampaignConfig.parse(v?.config);
  const at = d.now().toISOString();
  await d.db.update(campaigns).set({ status: statusFor(cfg, d.now()), updatedAt: at }).where(eq(campaigns.id, id));
  await audit(d, storeId, actorId, "campaign.resumed", id);
  await publishConfig(d, storeId);
  await publishDomainEvent(d, { type: "campaign.resumed", payload: { campaignId: id }, idempotencyKey: `campaign.resumed:${id}:${at}`, storeId, source: "api" });
}

export async function archive(d: Deps, storeId: string, id: string, actorId: string) {
  const c = await load(d, storeId, id);
  await d.db.update(campaigns).set({ status: "archived", updatedAt: d.now().toISOString() }).where(eq(campaigns.id, id));
  await audit(d, storeId, actorId, "campaign.archived", id);
  await publishConfig(d, storeId);
  // Archiving twice is one outcome: the campaign is not served any more.
  if (c.status !== "archived") await publishDomainEvent(d, { type: "campaign.archived", payload: { campaignId: id }, idempotencyKey: `campaign.archived:${id}`, storeId, source: "api" });
}

export async function duplicate(d: Deps, storeId: string, id: string, actorId: string) {
  const c = await load(d, storeId, id);
  const cfg = { ...(c.draftConfig as Record<string, unknown>), name: `${c.name} (copy)`.slice(0, 80) };
  return createCampaign(d, storeId, actorId, cfg);
}

export async function listVersions(d: Deps, storeId: string, id: string) {
  await load(d, storeId, id);
  return d.db.select({ id: campaignVersions.id, version: campaignVersions.version, source: campaignVersions.source, createdAt: campaignVersions.createdAt, config: campaignVersions.config })
    .from(campaignVersions).where(eq(campaignVersions.campaignId, id)).orderBy(desc(campaignVersions.version));
}

/** Rollback never mutates history: it publishes the old config as a new immutable version. */
export async function rollback(d: Deps, storeId: string, id: string, actorId: string, toVersionId: string) {
  const c = await load(d, storeId, id);
  const [v] = await d.db.select().from(campaignVersions).where(and(eq(campaignVersions.id, toVersionId), eq(campaignVersions.campaignId, id))).limit(1);
  if (!v) throw new HttpError(404, "not_found", "Version not found");
  const parsed = validateDraft(v.config);
  if (!parsed.valid || !parsed.config) throw new HttpError(422, "invalid_campaign", "That version no longer validates", parsed.issues);
  const now = d.now().toISOString();
  await d.db.update(campaigns).set({ draftConfig: parsed.config, name: parsed.config.name, tool: toolOf(parsed.config), updatedAt: now }).where(eq(campaigns.id, id));
  return publish(d, storeId, id, actorId, now, "rollback").then(async (r) => { await audit(d, storeId, actorId, "campaign.rolled_back", id); return { ...r, status: c.status }; });
}

const audit = (d: Deps, storeId: string, actorId: string, action: string, targetId: string, summary?: AuditSummary) =>
  recordAudit(d, { action, actorId, storeId, targetType: "campaign", targetId, ...(summary ? { summary } : {}) });

export async function buildStorefrontConfig(d: Deps, storeId: string): Promise<StorefrontConfig> {
  const [s] = await d.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!s) throw new HttpError(404, "not_found", "Store not found");
  const rows = await d.db
    .select({ campaignId: campaigns.id, versionId: campaignVersions.id, config: campaignVersions.config, publishedAt: campaignVersions.createdAt })
    .from(campaigns).innerJoin(campaignVersions, eq(campaignVersions.id, campaigns.publishedVersionId))
    .where(and(eq(campaigns.storeId, storeId), inArray(campaigns.status, ["active", "scheduled"])));
  // What the workspace's plan allows today. A downgrade or a lapsed payment stops paid tools from being served without
  // touching the campaigns themselves: they stay live in the dashboard and come back as soon as the plan allows them again.
  const ent = await entitlementsFor(d, s.organizationId);
  const published = rows.flatMap((r) => {
    const p = CampaignConfig.safeParse(r.config);
    if (!p.success) return [];
    const cfg = p.data;
    if (cfg.format === "restock") { if (!ent.has("restock.alerts")) return []; }
    else if (cfg.tool && !ent.has(toolCapability(cfg.tool))) return [];
    // A holdout needs the experiments entitlement; without it the campaign is shown to everyone rather than hidden from some.
    const { experiment: _e, ...rest } = cfg;
    return [{ campaignId: r.campaignId, versionId: r.versionId, config: cfg.experiment && !ent.has("experiments.run") ? rest as CampaignConfig : cfg, publishedAt: r.publishedAt, priority: cfg.priority }];
  });
  // Over the plan's live-campaign limit (after a downgrade): serve the highest-priority ones, newest first on a tie.
  const allowed = published.sort((a, b) => b.priority - a.priority || b.publishedAt.localeCompare(a.publishedAt)).slice(0, Math.min(ent.plan.maxActiveCampaigns, 50))
    .map(({ priority: _p, ...c }) => c);
  // Hard stop when the organisation has used its monthly tracked-pageview allowance.
  const overLimit = (await quota(d, s.organizationId, "pageviews", ent.plan)).remaining <= 0;
  return { schemaVersion: 1, siteId: s.siteKey, generatedAt: d.now().toISOString(), currency: s.currency, deliveryEnabled: s.deliveryEnabled && s.status === "active" && !overLimit, campaigns: allowed };
}

/** After a plan or payment change: every active store of the workspace serves what the new plan allows, straight away. */
export async function republishOrganization(d: Deps, organizationId: string): Promise<void> {
  const rows = await d.db.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.status, "active")));
  for (const r of rows) await publishConfig(d, r.id);
}

/** Writes the edge-served config. The storefront only ever reads this blob. */
export async function publishConfig(d: Deps, storeId: string) {
  const cfg = await buildStorefrontConfig(d, storeId);
  await d.kv.put(`config:${cfg.siteId}`, JSON.stringify(cfg));
  await putSite(d, cfg.siteId, { id: storeId, active: true }); // only active stores are ever published
  return cfg;
}
