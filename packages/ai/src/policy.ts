import { z } from "zod";
import { CampaignConfig, ConsentText, SHIPPED_TOOLS, SafeUrl, Tool, toolOf, type Condition } from "@convertflow/contracts";

export interface CatalogItem {
  id: string;
  title: string;
  url?: string;
  /** "unknown" must be passed through; the model may not claim stock for unknown items. */
  availability: "in_stock" | "out_of_stock" | "unknown";
}

export interface CampaignGenerationInput {
  objective: string;
  /** The draft being refined, when the merchant is iterating on an existing draft. Treated as data, never instructions. */
  previousConfig?: CampaignConfig;
  /** The tool to build. Omit to let the model choose (it still may not pick a tool that is not available). */
  tool?: Tool;
  /** Legacy and signup-form format hint. Toast, feed and upsell have exactly one format each. */
  format?: "popup" | "slide_in" | "announcement_bar";
  constraints?: string;
  /** Free text the merchant explicitly authorises, e.g. "10% off orders over $50". Empty = no promotions allowed. */
  allowedPromotion?: string;
  /** The store's free-shipping subtotal, supplied by the merchant. Without it the model may make no shipping-amount claim. */
  freeShippingThreshold?: number;
  /** The merchant's own consent wording for signup forms. Without it the server's template is used. The model never writes consent text. */
  consentText?: string;
  /** The merchant's privacy-policy URL for signup forms. Without it a default path is used and the draft warns about it. */
  privacyUrl?: string;
  catalog: CatalogItem[];
  siteDomain: string;
  currency: string;
  feedback?: string;
}

export interface CampaignProposal {
  config: CampaignConfig;
  explanation: string;
  /** Deterministic fixes the server applied to the model's output, in plain words. Shown to the merchant at review. */
  repairs: string[];
}

export class AIValidationError extends Error {
  constructor(message: string, readonly issues: string[]) { super(message); }
}

/** The model returns this; the server converts it into a full CampaignConfig after validation. */
export const RawProposal = z.object({
  config: z.unknown(),
  explanation: z.string().max(1200),
});

/** Used when the merchant supplies no privacy URL. A draft that uses it carries a warning. */
export const DEFAULT_PRIVACY_PATH = "/privacy-policy";

/** Highest priority the AI may assign. Arbitration is by priority, so a generated campaign must never outrank the merchant's own. */
export const MAX_AI_PRIORITY = 50;

/** Templates only: a lawyer must review the wording for the regions the store sells into. */
export function consentTemplate(channel: "email" | "sms", domain: string): string {
  return channel === "sms"
    ? `I agree to receive recurring marketing text messages from ${domain} at the number I provide. Message frequency varies. Message and data rates may apply. Reply STOP to opt out at any time.`
    : `I agree to receive marketing emails from ${domain}. I can unsubscribe at any time using the link in every email.`;
}

const DISCOUNT = /(\d{1,3}\s?%\s?off|\$\s?\d+\s?off|discount code|promo code|coupon|use code|\bsale\b|\bBOGO\b|save (up to )?\$?\d)/i;
const FREE_SHIPPING = /(free\s+(shipping|delivery)|ships?\s+free|shipping\s+is\s+free)/i;
const STOCK = /(in stock|only \d+ left|selling fast|almost gone|limited stock|last chance|back in stock)/i;
const URGENCY = /(hurry|act (now|fast)|ends?\s+(soon|tonight|today|tomorrow|in\s+\d+|at midnight)|today only|last chance|don'?t miss( out)?|limited[- ]time|while (supplies|stocks) last|countdown|expires?\s+(soon|in|today)|running out|now or never|final hours?|only \d+ (hours?|minutes?|days?) left)/i;
const SOCIAL_PROOF = /(\d[\d,.]*\s?[kK+]?\s*(people|customers|shoppers|buyers|others|orders|sold|reviews|five[- ]star|subscribers?|members?|fans|followers|visitors|readers|happy|satisfied|stores|brands|families)|\b(bought|purchased|ordered)\s+(this|it|today|recently)|best[- ]?sell(er|ing)|most[- ]popular|top[- ]rated|trending|\b\d(\.\d)?\s*(\/\s*5|stars?)|rated\s+\d|\bare (viewing|looking at|watching|buying)|everyone('?s| is)|(customer|fan) favou?rite|sold out (fast|quickly)|as seen (on|in)|#1\b)/i;
const MARKUP = /<\s*[a-z!/?]/i;
const SHIPPING_WORDS = /ship|deliver/i;

const hostOf = (u: string): string | undefined => { try { return new URL(u).hostname; } catch { return undefined; } };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numbersIn = (s: string): number[] => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => parseFloat(n.replace(",", "."))).filter((n) => Number.isFinite(n));

/** Toast, feed and upsell each render exactly one format, so a missing or wrong one is repaired rather than rejected. */
const SINGLE_FORMAT: Partial<Record<Tool, string>> = { toast: "toast", feed: "feed_item", upsell: "recommendation" };
/** Formats an AI-built signup form may use. Inline and bar forms need merchant placement, so they are chosen in the editor. */
const AI_FORM_FORMATS = ["popup", "slide_in"];
const CONSENT_FLAGS = ["preChecked", "prechecked", "defaultChecked", "checked", "bundled", "autoOptIn", "autoSubscribe"];

export interface PolicyOptions {
  /** Tools the model may build. Defaults to the shipped tools. */
  allowedTools?: ReadonlySet<Tool>;
}

function repairForm(cfg: Record<string, unknown>, tool: "email" | "sms", input: CampaignGenerationInput, repairs: string[]): Record<string, unknown> {
  const model = isRecord(cfg["form"]) ? cfg["form"] : {};
  const consentText = input.consentText?.trim() || consentTemplate(tool, input.siteDomain);
  const privacyUrl = input.privacyUrl?.trim() || DEFAULT_PRIVACY_PATH;
  const form: Record<string, unknown> = {
    collect: tool === "email" ? { email: true, phone: false, firstName: false } : { email: false, phone: true, firstName: false },
    consentCheckbox: true,
    consentText,
    privacyUrl,
    doubleOptIn: true,
  };
  for (const k of ["defaultCountry", "successMessage", "pendingMessage"]) if (typeof model[k] === "string") form[k] = model[k];

  const who = input.consentText?.trim() ? "the merchant's" : "the standard template";
  if (model["consentText"] !== consentText) repairs.push(`Consent wording was set to ${who} text. The AI never writes consent text.`);
  const mc = isRecord(model["collect"]) ? model["collect"] : {};
  if ((tool === "email" && mc["phone"] === true) || (tool === "sms" && mc["email"] === true) || mc["firstName"] === true) {
    repairs.push(tool === "email" ? "The form collects an email address only; extra fields the AI added were removed." : "The form collects a phone number only; extra fields the AI added were removed.");
  }
  if (model["doubleOptIn"] === false) repairs.push("Double opt-in was switched back on.");
  if (CONSENT_FLAGS.some((k) => model[k] === true) || model["consentCheckbox"] === false) repairs.push("The consent box is always unticked and separate; pre-ticking or bundling was removed.");
  if (model["termsUrl"] !== undefined) repairs.push("A terms link the AI added was removed; add one in the editor.");
  if (!input.privacyUrl?.trim()) repairs.push(`No privacy policy URL was supplied, so the form links to ${DEFAULT_PRIVACY_PATH}. Check that this page exists.`);
  return form;
}

/** Expand shorthand and coerce common operator mistakes into the contract's exact condition shapes. */
function normalizeCondition(raw: unknown): Condition | undefined {
  if (!isRecord(raw)) return undefined;
  const oneOrMany = (v: unknown): string[] | undefined =>
    typeof v === "string" ? [v] : Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") ? v : undefined;
  const value = raw["value"];
  if (typeof raw["field"] === "string") {
    const field = raw["field"];
    const op = typeof raw["op"] === "string" ? raw["op"] : undefined;
    if (field === "visitor_type") {
      const v = Array.isArray(value) && value.length === 1 ? value[0] : value;
      if (v === "new" || v === "returning") return { field, op: "equals", value: v };
    }
    if (field === "product_available" && typeof value === "boolean") return { field, op: "equals", value };
    if ((field === "pages_viewed" || field === "cart_item_count" || field === "cart_subtotal") && typeof value === "number") {
      const safeOp = field === "cart_subtotal" ? (op === "lte" || op === "between" ? op : "gte") : (op === "lte" ? "lte" : "gte");
      return { field, op: safeOp, value, ...(field === "cart_subtotal" && safeOp === "between" && typeof raw["valueTo"] === "number" ? { valueTo: raw["valueTo"] } : {}) } as Condition;
    }
    if (field === "url_path" && typeof value === "string") return { field, op: op === "equals" || op === "contains" ? op : "starts_with", value };
    if (field === "page_type" || field === "device") {
      const values = oneOrMany(value);
      if (values) return { field, op: op === "not_in" ? "not_in" : "in", value: values } as Condition;
    }
    if (field === "product_id" || field === "collection_id") {
      const values = oneOrMany(value);
      if (values) return { field, op: op === "not_in" ? "not_in" : "in", value: values };
    }
    return undefined;
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1) return undefined;
  const key = keys[0]!;
  const simple = raw[key];
  if (key === "page_type" || key === "device" || key === "product_id" || key === "collection_id") {
    const values = oneOrMany(simple);
    if (values) return { field: key, op: "in", value: values } as Condition;
  }
  if (key === "visitor_type" && (simple === "new" || simple === "returning")) return { field: key, op: "equals", value: simple };
  if (key === "product_available" && typeof simple === "boolean") return { field: key, op: "equals", value: simple };
  if ((key === "pages_viewed" || key === "cart_item_count" || key === "cart_subtotal") && typeof simple === "number") return { field: key, op: "gte", value: simple } as Condition;
  if (key === "url_path" && typeof simple === "string") return { field: key, op: "starts_with", value: simple };
  return undefined;
}

function repairRaw(rawCfg: unknown, input: CampaignGenerationInput, repairs: string[]): unknown {
  if (!isRecord(rawCfg)) return rawCfg;
  const cfg: Record<string, unknown> = { ...rawCfg };
  if (input.tool && cfg["tool"] === undefined) { cfg["tool"] = input.tool; repairs.push(`The tool was set to ${input.tool}, as requested.`); }
  const tool = typeof cfg["tool"] === "string" ? cfg["tool"] as Tool : undefined;
  const single = tool ? SINGLE_FORMAT[tool] : undefined;
  if (single && cfg["format"] !== single) { cfg["format"] = single; repairs.push(`The format was set to ${single}, the only one the ${tool} tool uses.`); }
  if ((tool === "email" || tool === "sms") && cfg["format"] !== "restock") cfg["form"] = repairForm(cfg, tool, input, repairs);
  const targeting = cfg["targeting"];
  if (isRecord(targeting) && Array.isArray(targeting["conditions"])) {
    let changed = false;
    const conditions = targeting["conditions"].map((raw) => {
      const normalized = normalizeCondition(raw);
      if (normalized && JSON.stringify(normalized) !== JSON.stringify(raw)) { changed = true; return normalized; }
      return raw;
    });
    if (changed) {
      cfg["targeting"] = { ...targeting, conditions };
      repairs.push("Targeting rules were expanded into the required field/op/value shape.");
    }
  }
  const frequency = cfg["frequency"];
  if (isRecord(frequency)) {
    const aliases: Array<[string, string]> = [["impressionsPerSession", "maxImpressionsPerSession"], ["impressionsPerVisitor", "maxImpressionsPerVisitor"], ["dismissAfterDays", "suppressAfterDismissDays"], ["clickCooldownDays", "suppressAfterClickDays"]];
    let changed = false;
    const next = { ...frequency };
    for (const [from, to] of aliases) {
      if (next[from] !== undefined && next[to] === undefined) { next[to] = next[from]; delete next[from]; changed = true; }
    }
    if (changed) { cfg["frequency"] = next; repairs.push("Frequency setting names were corrected."); }
  }
  if (typeof cfg["priority"] === "number" && cfg["priority"] > MAX_AI_PRIORITY) {
    cfg["priority"] = MAX_AI_PRIORITY;
    repairs.push(`Priority was lowered to ${MAX_AI_PRIORITY} so this draft cannot outrank your existing campaigns.`);
  }
  return cfg;
}

function textFields(c: CampaignConfig): Array<[string, string]> {
  const out: Array<[string, string]> = [["headline", c.creative.headline], ["body", c.creative.body], ["button label", c.creative.ctaLabel]];
  if (c.feed) out.push(["feed category", c.feed.category]);
  if (c.form) out.push(["success message", c.form.successMessage], ["pending message", c.form.pendingMessage]);
  return out.filter(([, t]) => t.length > 0);
}

/**
 * Server-side policy gate. Model output is untrusted: deterministic repairs for things the server owns (consent wording,
 * form fields, format, priority), then schema validation, then checks for invented promotions, scarcity, urgency, social proof,
 * shipping claims, unknown products and off-site destinations. Nothing here publishes: a proposal is only ever a draft.
 */
export function validateProposal(raw: unknown, input: CampaignGenerationInput, opts: PolicyOptions = {}): CampaignProposal {
  const allowed = opts.allowedTools ?? SHIPPED_TOOLS;
  // Small models sometimes return the campaign object directly instead of wrapping it in {config, explanation}. Both are
  // deterministic and safe to accept; the explanation is not used for policy decisions.
  const candidate = isRecord(raw) && !("config" in raw) && ("schemaVersion" in raw || "creative" in raw)
    ? { config: raw, explanation: "A campaign draft generated from your goal." }
    : raw;
  const outer = RawProposal.safeParse(candidate);
  if (!outer.success) throw new AIValidationError("Model returned malformed output", ["response shape invalid"]);

  if (input.privacyUrl !== undefined && !SafeUrl.safeParse(input.privacyUrl.trim()).success) throw new AIValidationError("Invalid privacy URL", ["The privacy policy URL must be https or a relative path"]);
  if (input.consentText !== undefined && !ConsentText.safeParse(input.consentText).success) throw new AIValidationError("Invalid consent text", ["The consent text must be 20 to 600 characters"]);

  const repairs: string[] = [];
  const cfgResult = CampaignConfig.safeParse(repairRaw(outer.data.config, input, repairs));
  if (!cfgResult.success) {
    throw new AIValidationError("Proposal does not match campaign schema", cfgResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const config = cfgResult.data;
  const tool = toolOf(config);
  const issues: string[] = [];

  /* ---------- which tool ---------- */
  if (input.tool && tool !== input.tool) issues.push(`The merchant asked for the ${input.tool} tool but the AI built a ${tool} campaign`);
  if (!allowed.has(tool)) issues.push(`The ${tool} tool is not available yet`);

  /* ---------- copy ---------- */
  const fields = textFields(config);
  const joined = fields.map(([, t]) => t).join(" \n ");
  const authorised = Boolean(input.allowedPromotion?.trim());
  const supplied = new Set<number>([...(input.allowedPromotion ? numbersIn(input.allowedPromotion) : []), ...(input.freeShippingThreshold !== undefined ? [input.freeShippingThreshold] : [])]);

  if (fields.some(([, t]) => MARKUP.test(t))) issues.push("Copy must be plain text: markup was found");
  if (DISCOUNT.test(joined) && !authorised) issues.push("Copy contains a promotion or discount the merchant did not authorise");
  if (FREE_SHIPPING.test(joined) && !authorised && input.freeShippingThreshold === undefined) issues.push("Copy offers free shipping but the merchant supplied no free-shipping threshold or promotion");
  if (SHIPPING_WORDS.test(joined) && numbersIn(joined).some((n) => !supplied.has(n))) issues.push("Copy states a shipping or delivery amount or time the merchant did not supply");
  const allKnownInStock = input.catalog.length > 0 && input.catalog.every((p) => p.availability === "in_stock");
  if (STOCK.test(joined) && !allKnownInStock) issues.push("Copy makes a stock or scarcity claim that is not backed by known availability");
  if (URGENCY.test(joined)) issues.push("Copy uses urgency or a countdown the merchant did not set up (invented deadlines are not allowed)");
  if (SOCIAL_PROOF.test(joined)) issues.push("Copy makes a popularity or social-proof claim (counts, ratings, best-seller) that cannot be verified");

  /* ---------- destinations and fields the AI may not set ---------- */
  const dest = config.creative.ctaUrl;
  if (!dest.startsWith("/")) {
    if (hostOf(dest) !== input.siteDomain && !hostOf(dest)?.endsWith(`.${input.siteDomain}`)) {
      issues.push("CTA destination is not on the merchant's site");
    }
  }
  if (config.creative.imageUrl) issues.push("AI may not set image URLs; choose an image in the editor");
  if (config.promotion) issues.push("AI may not create promotions or discount codes");
  if (config.experiment) issues.push("AI may not configure experiments");
  if (config.creative.products?.length) issues.push("AI may not pick products; choose them in the editor");
  if (config.format === "restock") issues.push("AI may not create back-in-stock forms");
  if (config.schedule.startsAt || config.schedule.endsAt) issues.push("AI may not set schedule dates; set them in the editor so deadlines are real");

  /* ---------- targeting: only ids the AI was actually shown ---------- */
  const known = new Map(input.catalog.map((p) => [p.id, p]));
  for (const cond of config.targeting.conditions) {
    if (cond.field === "product_id") for (const id of cond.value) if (!known.has(id)) issues.push(`Targeting uses product id ${id}, which is not in the catalog`);
    if (cond.field === "collection_id") issues.push("AI may not target collection ids; it is not shown any. Choose collections in the editor");
  }

  /* ---------- per tool ---------- */
  if (tool === "toast" && config.toast) {
    const t = config.toast;
    if (t.kind === "coupon") issues.push("AI may not create a coupon toast: coupons need a discount the merchant configures");
    if (t.kind === "shipping_incentive" && (input.freeShippingThreshold === undefined || t.freeShippingThreshold !== input.freeShippingThreshold)) {
      issues.push("A shipping-incentive toast needs the free-shipping threshold the merchant supplied, unchanged");
    } else if (t.kind !== "shipping_incentive" && t.freeShippingThreshold !== undefined && t.freeShippingThreshold !== input.freeShippingThreshold) {
      issues.push("The free-shipping threshold does not match the one the merchant supplied");
    }
  }
  if (tool === "upsell" && config.recommend) {
    const r = config.recommend;
    for (const id of r.productIds) {
      const p = known.get(id);
      if (!p) issues.push(`Recommended product ${id} is not in the catalog`);
      else if (p.availability !== "in_stock") issues.push(`Recommended product ${id} is not known to be in stock`);
    }
    for (const id of r.excludeProductIds) if (!known.has(id)) issues.push(`Excluded product ${id} is not in the catalog`);
    if (r.collectionIds.length) issues.push("AI may not choose collection ids; it is not shown any. Choose collections in the editor");
    if (r.freeShippingThreshold !== undefined && r.freeShippingThreshold !== input.freeShippingThreshold) issues.push("The free-shipping threshold does not match the one the merchant supplied");
    if (r.source === "shipping_threshold" && input.freeShippingThreshold === undefined) issues.push("A shipping-gap recommendation needs the free-shipping threshold, which the merchant did not supply");
  }
  if ((tool === "email" || tool === "sms") && !AI_FORM_FORMATS.includes(config.format)) issues.push("AI builds signup forms as a popup or slide-in; use the editor for inline or bar forms");

  if (issues.length) throw new AIValidationError("Proposal rejected by policy", issues);
  const explanation = outer.data.explanation.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return { config, explanation, repairs };
}
