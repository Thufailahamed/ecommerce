import type { Tool } from "./tools";

/**
 * What each tool is measured by. Zod-free so the dashboard can import it without pulling in the schema library.
 *
 * Most metrics reuse the shared per-campaign columns: a tool maps its own events onto them (a feed item shown in an opened
 * panel is an impression, a recommendation added to the cart is an `addToCarts`), so every tool flows through the same
 * pipeline. Metrics with no column are counted in `metric_counters`, keyed by the event type that produced them.
 */

/** Event types counted in `metric_counters`. Each is one event, de-duplicated by event id, from a consenting browser. */
export const COUNTER_EVENTS = ["form_submit_attempt", "form_submit_success", "form_submit_failure"] as const;
export type CounterEvent = (typeof COUNTER_EVENTS)[number];
export const isCounterEvent = (t: string): t is CounterEvent => (COUNTER_EVENTS as readonly string[]).includes(t);

export type ToolMetricKey =
  | "eligible" | "impressions" | "clicks" | "ctr" | "dismissals" | "dismissRate" | "addToCarts" | "addToCartRate"
  | "formSubmitAttempts" | "formSubmitSuccesses" | "formSubmitFailures"
  | "requested" | "confirmed" | "requestRate" | "confirmRate"
  | "attributedOrders" | "attributedRevenue";

export type MetricFormat = "count" | "rate" | "money";

export interface ToolMetricDef { key: ToolMetricKey; label: string; format: MetricFormat; note?: string }

const ATTRIBUTED: ToolMetricDef[] = [
  { key: "attributedOrders", label: "Attributed orders", format: "count", note: "Last click, 7 days" },
  { key: "attributedRevenue", label: "Attributed revenue", format: "money", note: "Not incremental" },
];

const FORM: ToolMetricDef[] = [
  { key: "impressions", label: "Form views", format: "count", note: "Consenting browsers only" },
  // Browser-reported, so only consenting visitors are counted; the server's request and confirmation counts are the real numbers.
  { key: "formSubmitSuccesses", label: "Form submissions", format: "count", note: "Consenting browsers only" },
  { key: "formSubmitFailures", label: "Failed submissions", format: "count", note: "Network or server errors seen by the browser" },
  { key: "requested", label: "Sign-up requests", format: "count", note: "Counted on the server" },
  { key: "confirmed", label: "Confirmed opt-ins", format: "count", note: "Counted on the server" },
  { key: "requestRate", label: "Request rate", format: "rate", note: "Requests per form view; an estimate" },
  { key: "confirmRate", label: "Confirmation rate", format: "rate", note: "Confirmed per request" },
];

/** SMS: a request is a code texted to the number, a confirmation is the shopper entering that code. */
const SMS_FORM: ToolMetricDef[] = FORM.map((m) =>
  m.key === "requested" ? { ...m, label: "Codes sent" }
  : m.key === "confirmed" ? { ...m, label: "Verified numbers" }
  : m.key === "confirmRate" ? { ...m, label: "Verification rate", note: "Verified per code sent" }
  : m);

/** The metrics shown first for each tool, in order. */
export const TOOL_METRICS: Record<Tool, readonly ToolMetricDef[]> = {
  toast: [
    { key: "impressions", label: "Shown", format: "count" },
    { key: "clicks", label: "Clicks", format: "count" },
    { key: "ctr", label: "Click rate", format: "rate" },
    { key: "dismissals", label: "Dismissed", format: "count" },
    { key: "dismissRate", label: "Dismiss rate", format: "rate" },
    ...ATTRIBUTED,
  ],
  feed: [
    { key: "impressions", label: "Item views", format: "count", note: "Once per item per session, in an opened panel" },
    { key: "clicks", label: "Item clicks", format: "count" },
    { key: "ctr", label: "Click rate", format: "rate", note: "Clicks per item view" },
    ...ATTRIBUTED,
  ],
  upsell: [
    { key: "impressions", label: "Blocks shown", format: "count" },
    { key: "clicks", label: "Product clicks", format: "count" },
    { key: "ctr", label: "Click rate", format: "rate", note: "Per block shown" },
    { key: "addToCarts", label: "Added to cart", format: "count" },
    { key: "addToCartRate", label: "Add-to-cart rate", format: "rate", note: "Per block shown" },
    ...ATTRIBUTED,
  ],
  email: FORM,
  sms: SMS_FORM,
};
