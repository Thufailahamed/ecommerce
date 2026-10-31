/**
 * Store-level metric definitions: what each number means, where it comes from and what it cannot tell you. The
 * analytics API, the AI context (as evidence) and docs/analytics-definitions.md all use these, so a figure has one
 * meaning everywhere. Per-tool metrics are in tool-metrics.ts and use the same sources.
 *
 * `kind` keeps three different things apart:
 * - `observed`: counted directly (an event happened, an order was reported).
 * - `attributed`: credited to a campaign by a named rule (last click, 7 days). Never causal.
 * - `incremental`: estimated against a randomised holdout. The only kind that measures lift.
 */
export type MetricKind = "observed" | "attributed" | "incremental";

export interface MetricDef {
  key: string;
  label: string;
  kind: MetricKind;
  format: "count" | "rate" | "money";
  source: string;
  /** For rates: what the numerator is divided by. */
  denominator?: string;
  window: string;
  limitations: string;
}

const CONSENT = "Only browsers that consented to analytics send events; visitors who declined are not counted.";

export const STORE_METRICS = [
  { key: "eligible", label: "Eligible page views", kind: "observed", format: "count", source: "campaign_eligible beacons, de-duplicated by event id, daily aggregates", window: "Selected range, UTC days", limitations: `${CONSENT} One per campaign per page view, so it is not unique visitors.` },
  { key: "impressions", label: "Impressions", kind: "observed", format: "count", source: "campaign_impression, feed_open and recommendation_impression beacons", window: "Selected range, UTC days", limitations: CONSENT },
  { key: "clicks", label: "Clicks", kind: "observed", format: "count", source: "campaign_click, feed_item_click and recommendation_click beacons", window: "Selected range, UTC days", limitations: CONSENT },
  { key: "ctr", label: "Click-through rate", kind: "observed", format: "rate", source: "clicks / impressions", denominator: "impressions", window: "Selected range", limitations: "Null (not 0%) when nothing was shown. Different tools have different surfaces, so a store-wide rate mixes unlike things." },
  { key: "dismissals", label: "Dismissals", kind: "observed", format: "count", source: "campaign_dismiss beacons", window: "Selected range, UTC days", limitations: `${CONSENT} A toast that hides itself is not a dismissal.` },
  { key: "addToCarts", label: "Recommendation add-to-carts", kind: "observed", format: "count", source: "recommendation_add_to_cart beacons", window: "Selected range, UTC days", limitations: `${CONSENT} Only adds made from an upsell block.` },
  { key: "observedOrders", label: "Orders observed", kind: "observed", format: "count", source: "conversions: platform order webhooks and purchase beacons, one per order id", window: "Selected range, by order time", limitations: "Browser-reported purchases can be spoofed; platform webhooks cannot. Includes orders no campaign touched." },
  { key: "observedRevenue", label: "Revenue observed", kind: "observed", format: "money", source: "Sum of order totals in conversions", window: "Selected range, by order time", limitations: "Order totals as reported, in the order's currency; no refunds, costs or margins." },
  { key: "attributedOrders", label: "Attributed orders", kind: "attributed", format: "count", source: "attribution_records, rule last_click_7d", window: "Orders in range, clicks up to 7 days earlier", limitations: "Credit, not causation: these shoppers may have bought anyway." },
  { key: "attributedRevenue", label: "Attributed revenue", kind: "attributed", format: "money", source: "Order totals of attributed orders", window: "Orders in range, clicks up to 7 days earlier", limitations: "Not incremental revenue. Use a holdout experiment for lift." },
  { key: "holdoutLift", label: "Relative lift (holdout)", kind: "incremental", format: "rate", source: "experiment_stats + conversions by arm, conservative z-test", denominator: "holdout orders per session", window: "Selected range", limitations: "Per campaign; only consenting visitors are randomised; arms are browser-reported. Labelled an estimate." },
] as const satisfies readonly MetricDef[];

export type StoreMetricKey = (typeof STORE_METRICS)[number]["key"];
