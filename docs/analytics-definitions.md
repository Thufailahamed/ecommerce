# Analytics definitions

The registry is `packages/contracts/src/metrics.ts` (store level) and `packages/contracts/src/tool-metrics.ts` (per
tool). The analytics API, the dashboard and the AI context (as evidence) all read these definitions, so a figure means
the same thing everywhere. This page mirrors the registry; if they disagree, the code wins and this page is out of date.

## Three kinds of number, never mixed

| Kind | Meaning | May be called |
|---|---|---|
| **observed** | Counted directly: an event happened, an order was reported | "views", "clicks", "orders" |
| **attributed** | Credited to a campaign by a named rule (last click within 7 days) | "attributed", never "caused" or "generated" |
| **incremental** | Estimated against a randomised holdout | "lift", always labelled an estimate |

## Store metrics

| Key | Label | Kind | Source | Window | Limitations |
|---|---|---|---|---|---|
| eligible | Eligible page views | observed | `campaign_eligible` beacons, de-duplicated by event id, daily aggregates | Selected range, UTC days | Consenting browsers only. One per campaign per page view, not unique visitors |
| impressions | Impressions | observed | `campaign_impression`, `feed_open`, `recommendation_impression` | Selected range, UTC days | Consenting browsers only |
| clicks | Clicks | observed | `campaign_click`, `feed_item_click`, `recommendation_click` | Selected range, UTC days | Consenting browsers only |
| ctr | Click-through rate | observed | clicks / impressions | Selected range | Null (not 0%) when nothing was shown. Store-wide it mixes unlike surfaces |
| dismissals | Dismissals | observed | `campaign_dismiss` | Selected range, UTC days | A toast that hides itself is not a dismissal |
| addToCarts | Recommendation add-to-carts | observed | `recommendation_add_to_cart` | Selected range, UTC days | Only adds made from an upsell block |
| observedOrders | Orders observed | observed | `conversions`: platform order webhooks and purchase beacons, one per order id | By order time | Browser-reported purchases can be spoofed; webhooks cannot. Includes orders no campaign touched |
| observedRevenue | Revenue observed | observed | Sum of order totals in `conversions` | By order time | As reported, in the order's currency; no refunds, costs or margins |
| attributedOrders | Attributed orders | attributed | `attribution_records`, rule `last_click_7d` | Orders in range, clicks up to 7 days earlier | Credit, not causation |
| attributedRevenue | Attributed revenue | attributed | Order totals of attributed orders | As above | Not incremental revenue |
| holdoutLift | Relative lift (holdout) | incremental | `experiment_stats` + conversions by arm, conservative z-test | Selected range | Per campaign; only consenting visitors are randomised; labelled an estimate |

## Signup form metrics (email and SMS)

| Key | Label (email / SMS) | Kind | Source | Limitations |
|---|---|---|---|---|
| impressions | Form views | observed | `campaign_impression` | Consenting browsers only |
| formSubmitSuccesses | Form submissions | observed | `form_submit_success` beacons, sent by the SDK after the server accepted a submission (since 2026-10-29) | Consenting browsers only; never carries what was typed |
| formSubmitFailures | Failed submissions | observed | `form_submit_failure` beacons: a network or server error seen by the browser | Consenting browsers only. A rejected number (`phone_undeliverable`) counts here |
| requested | Sign-up requests / Codes sent | observed | `consent_events` `requested` rows from `form:<campaignId>` | Server-side: includes shoppers who declined analytics. SMS: a code was texted (a request that failed to send is followed by `delivery_failed`) |
| confirmed | Confirmed opt-ins / Verified numbers | observed | `consent_events` `confirmed` rows | Server-side. Email: clicked the link; SMS: typed back the code |
| requestRate | Request rate | observed (estimate) | requested / impressions | Server count over a browser count: an estimate, can exceed 100% |
| confirmRate | Confirmation / Verification rate | observed | confirmed / requested | Both server counts |

Per-tool metrics (form views, sign-up requests and confirmations, add-to-cart rate…) are listed with their notes in
`tool-metrics.ts`. Sign-up requests and confirmations are counted on the server, so they include shoppers who declined
analytics. Rates that divide a server count by a browser count are therefore labelled estimates.

## What the AI may see

`apps/api/src/services/metrics.ts › metricSnapshot` builds the only performance data a model is shown: the store
metrics above plus per-campaign impressions, clicks, CTR and attributed orders for the last N days. It contains no
shopper, contact, order id or address. Any number a model's answer quotes must be one of these values (as is, rounded,
or as a percentage), or a count of 10 or less. Otherwise the answer is rejected (`ai-tasks.ts › unsupportedNumbers`).
With no data at all, the insights summary is a fixed sentence and no model is called.

## Freshness

Every analytics response carries the latest UTC day with any counted figure. The AI insights summary and the AI
manager flag their answer as stale when that day is more than three days old.
