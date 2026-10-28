import { ConsentText, SafeUrl, toolOf, type CampaignConfig, type Tool } from "@convertflow/contracts";
import { TOOLS, TOOL_ORDER } from "./tools";

/** "auto" lets the model choose among the tools that are available. */
export type StudioTool = "auto" | Tool;

export interface StudioForm {
  tool: StudioTool;
  objective: string;
  format: string;
  constraints: string;
  promo: string;
  /** Free-shipping subtotal, typed by the merchant. Empty means the AI may make no shipping-amount claim. */
  threshold: string;
  consentText: string;
  privacyUrl: string;
  feedback: string;
}

export const emptyStudioForm: StudioForm = { tool: "auto", objective: "", format: "", constraints: "", promo: "", threshold: "", consentText: "", privacyUrl: "", feedback: "" };

export interface StudioToolOption { value: StudioTool; label: string; disabled: boolean }

/** Every tool is listed so the choice is honest; one that is not shipped cannot be picked. */
export function studioToolOptions(): StudioToolOption[] {
  return [
    { value: "auto", label: "Let AI choose", disabled: false },
    ...TOOL_ORDER.map((key) => ({ value: key, label: TOOLS[key].shipped ? TOOLS[key].name : `${TOOLS[key].name} (not available yet)`, disabled: !TOOLS[key].shipped })),
  ];
}

/** Which optional inputs apply to a tool. In auto mode every input is offered, because the model may pick any tool. */
export function fieldsFor(tool: StudioTool): { threshold: boolean; consent: boolean; format: boolean } {
  return {
    threshold: tool === "auto" || tool === "toast" || tool === "upsell",
    consent: tool === "auto" || tool === "email" || tool === "sms",
    format: tool === "email" || tool === "sms",
  };
}

export type BodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

/** Builds the request. Only fields that apply to the chosen tool and were filled in are sent, and merchant-supplied facts are checked before a generation is spent. */
export function buildGenerateBody(f: StudioForm, withFeedback = false): BodyResult {
  const objective = f.objective.trim();
  if (objective.length < 10) return { ok: false, error: "Describe your goal in at least 10 characters." };
  const use = fieldsFor(f.tool);
  const body: Record<string, unknown> = { objective };
  if (f.tool !== "auto") body["tool"] = f.tool;
  if (use.format && f.format) body["format"] = f.format;
  if (f.constraints.trim()) body["constraints"] = f.constraints.trim();
  if (f.promo.trim()) body["allowedPromotion"] = f.promo.trim();
  if (use.threshold && f.threshold.trim()) {
    const n = Number(f.threshold.trim());
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return { ok: false, error: "The free-shipping threshold must be a positive number." };
    body["freeShippingThreshold"] = n;
  }
  if (use.consent) {
    if (f.consentText.trim()) {
      if (!ConsentText.safeParse(f.consentText.trim()).success) return { ok: false, error: "Consent wording must be between 20 and 600 characters." };
      body["consentText"] = f.consentText.trim();
    }
    if (f.privacyUrl.trim()) {
      if (!SafeUrl.safeParse(f.privacyUrl.trim()).success) return { ok: false, error: "The privacy policy link must start with https:// or be a path such as /privacy-policy." };
      body["privacyUrl"] = f.privacyUrl.trim();
    }
  }
  if (withFeedback && f.feedback.trim()) body["feedback"] = f.feedback.trim();
  return { ok: true, body };
}

const human = (s: string): string => s.replace(/_/g, " ");

/** The tool-specific facts a merchant should check at review. Plain text only; the page renders them as text. */
export function summarise(config: CampaignConfig): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  switch (toolOf(config)) {
    case "toast": {
      const t = config.toast;
      if (t) {
        rows.push(["Kind", human(t.kind)], ["Corner", human(t.corner)], ["Hides", t.durationSeconds ? `after ${t.durationSeconds} seconds` : "when dismissed"]);
        if (t.freeShippingThreshold !== undefined) rows.push(["Free-shipping threshold", String(t.freeShippingThreshold)]);
      }
      break;
    }
    case "feed": {
      const f = config.feed;
      if (f) rows.push(["Category", f.category], ["Position", human(f.position)], ["Audience", f.audience]);
      break;
    }
    case "upsell": {
      const r = config.recommend;
      if (r) {
        rows.push(["Products chosen by", human(r.source)], ["Where", human(r.placement)], ["Layout", `${r.layout}, up to ${r.maxProducts}`]);
        if (r.productIds.length) rows.push(["Picked products", r.productIds.join(", ")]);
        if (r.freeShippingThreshold !== undefined) rows.push(["Free-shipping threshold", String(r.freeShippingThreshold)]);
      }
      break;
    }
    case "email":
    case "sms": {
      const f = config.form;
      if (f) {
        rows.push(["Collects", f.collect.phone ? "Phone number" : "Email address"], ["Consent wording", f.consentText], ["Privacy link", f.privacyUrl]);
        if (!f.collect.phone) rows.push(["Double opt-in", f.doubleOptIn ? "On" : "Off"]);
      }
      break;
    }
  }
  return rows;
}
