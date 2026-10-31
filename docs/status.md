# Status (2026-10-29)

## Store connections: Shopify storefront setup, WooCommerce end to end (2026-10-29, latest)

- **Shopify** (`docs/shopify.md`): on install the app now creates its **web pixel** itself (`webPixelCreate`; an app pixel
  cannot be added by a merchant, so the earlier "add the pixel under Customer events" step could never have worked) and
  writes the site key into **app-data metafields** the theme embed reads (no pasting). Settings shows a setup checklist:
  pixel state with *Retry setup*, a live check of whether the embed is on in the published theme, and a theme-editor link
  that activates it. New `inventory_levels/update` webhook (stock changes re-read from the Admin API; drives back-in-stock).
  Disconnecting a Shopify store now uninstalls the app at Shopify. New scopes `read_themes,write_pixels,read_customer_events`
  (existing installs are asked to reconnect).
- **WooCommerce** (`docs/woocommerce.md`): one-click connect through WooCommerce's own key approval
  (`/wc-auth/v1/authorize`), keys checked before they are trusted (pasted keys too), **product and order webhooks** created
  at the store with a per-store signing secret (verify, dedupe, repair, remove on disconnect), **variable products with
  their variations**, orders as `order.created` platform events counted once with the plugin's browser report, a live
  health check, and the **WordPress plugin** (`apps/woocommerce-plugin`: script, exact page data, WP Consent API,
  purchase reporting). Migration 0014.
- Hardened while chasing a browser-test failure: two setups running at once (e.g. a double submit) each deleted the
  other's webhooks as "unknown". Delivery URLs now name the connection so concurrent runs agree on which webhooks are
  current, disconnect removes every webhook pointing at the store (recorded or not), and the dashboard clears the
  approval-return parameters so a reload or remount cannot rerun setup (unit test "setup run twice at once"). The browser
  failure itself turned out to be the test's own locator ("Connect WooCommerce" also matched "Disconnect WooCommerce"),
  fixed with an exact match; whether setup had actually run twice in that run was not established.

**Verified on 2026-10-29:** `pnpm lint`; `pnpm db:check` (0014 on a fresh local D1); forced `turbo run typecheck test
build` 26/27 with the storefront SDK's known jsdom worker flake under concurrency (SDK untouched; passed alone, 9/9
files). Tests: api 410 (+1 skipped; new: woocommerce 13, shopify +5), web 170 (new: woocommerce settings 6, shopify +2),
integrations 37, contracts 75, database 45 (migration 0014: 3). **Playwright 106/106** (new `woocommerce.spec.ts` 4, the
Shopify spec now also checks the pixel, prefilled embed settings and live embed state), run with
`E2E_API_PORT=8809 E2E_STORE_PORT=4010 E2E_MAIL_PORT=4110`. **Not verified:** anything
against a real Shopify store or a real WordPress/WooCommerce site; the WordPress plugin has never been installed and
`php -l` was not run (no PHP on this machine; parsed with a JavaScript PHP parser instead).

## Launch round: SMS, Shopify app, billing, hardening (2026-10-29)

Audit first (`docs/launch-readiness-audit.md`), then implementation. The verdict and evidence are in
`docs/final-verification-report.md`; what remains before launch is in `docs/production-launch-checklist.md`.

- **All six tools are shipped.** SMS signup (`docs/sms.md`): phone form with country codes, Twilio Verify one-time
  codes, consent proof from the live form, STOP required in the consent wording, Klaviyo SMS sync, merchant-recorded
  opt-outs, export by channel, metered verifications (Growth 500, Scale 5,000 a month).
- **Shopify app** (`docs/shopify.md`): OAuth install from the dashboard or the App Store with claim and reinstall,
  Admin GraphQL catalog sync, uninstall handling, privacy webhooks that act on stored contacts, **Shopify Billing**, and
  daily catalog and billing reconciliation. Migration 0013.
- Serving now follows the plan: a downgrade or lapsed payment stops paid tools on the storefront at once without
  deleting anything; signup forms cannot be published on a deployment that cannot confirm signups.
- Security review with fixes (`docs/security.md`): a cross-tenant shop-squatting hole (P0), privacy webhooks that
  ignored stored PII (P0), four P1s.
- Extension contracts for post-purchase, reviews and loyalty (contracts only; `docs/extension-points.md`).
- CI: repository checks, a D1 migration check, a manual deploy workflow; per-environment Wrangler configs.

**Verified on 2026-10-29:** `pnpm lint`; forced `turbo run typecheck test build` **27/27, 0 cached**; **1,015** unit and
integration tests (+1 skipped live probe); all migrations on local D1; backup drill on the current schema (48 tables,
byte-identical); `pnpm audit` clean; **Playwright 102/102**; load test exact (3,134 events/s locally). **Not verified:** anything against a real
third-party service or a real Cloudflare account.

## AI store builder (added 2026-10-29)

Describe a store in chat; the AI builds it (brand, theme, catalogue, home/About/FAQ/Contact/Shop pages, images) through
Cloudflare AI Gateway, the merchant refines it by chat or in a live editor, and publishes it at `/s/<address>` with a
cart and server-priced checkout (orders recorded, or Stripe Checkout on the merchant's own key). Details:
`docs/store-builder.md`. New: `packages/store-builder`, `packages/ai/src/gateway.ts`, `apps/api/src/services/builder/*`,
`apps/api/src/routes/builder.ts`, migration 0012, `apps/web/components/{builder,storefront}`, routes `/app/sites`,
`/builder/[id]`, `/preview/[siteId]`, `/s/[slug]`.

**Verified on 2026-10-29:** typecheck, unit/integration tests and production builds for every package (`pnpm verify`
tasks; the storefront SDK's known jsdom worker flake failed once under concurrency and passed 140/140 rerun alone).
New tests: store-builder 24, ai gateway 6, database migration 0012 (3), API builder 16 (full build pipeline, streaming
edits, retry, lock, quota, concurrency, versions, publish checklist, published-vs-draft, checkout pricing and tampering,
Stripe session confirmation, forms, image sniffing, tenancy, plan limits, account deletion takes stores offline), web
editor 6 and storefront 5. **End to end** (`tests/e2e/builder.spec.ts`, real Worker + production Next build + a mock AI
Gateway): prompt → streamed build → click-to-select and edit → streamed chat edit → publish blocked by sample
testimonials → hide → publish → shopper adds to cart and checks out → merchant sees order #1001. Full Playwright suite
**89/89** (the 88 existing tests plus this one) against the real Worker and a production Next build.

**Not verified:** the live AI Gateway / Workers AI models (no Cloudflare account here; the mock gateway answers with
scripted output, so real model quality and latency for the build pipeline are untested), live Stripe Checkout,
migration 0012 on a real D1, and the OpenNext build of the new routes.

## Platform foundation, phases 1-6 (completed 2026-10-29)

Every foundation item in `docs/implementation-roadmap.md` that can be built without a deploy or third-party accounts is
built and tested:

- **Entitlements and usage**: one capability catalog (`ga` / `preview` / `planned`), per-workspace preview flags
  (migration 0009), and one metering service. Publishing, capacity, AI, restock and pageview limits go through it.
- **Integration registry**: built vs planned capabilities and verification state per provider, with live connection
  status and health checks. Shown on the Operations page.
- **Dashboard module registry**: navigation by permission and capability. Preview modules appear only for workspaces
  that hold the capability.
- **Catalog platform event** `catalog.products_changed`: one per import, sync page or product webhook.
- **Workflow engine** (preview, `docs/workflow-engine.md`): an action registry, versioned definitions, event and daily
  triggers, consent-aware conditions, approvals, caps, loop prevention, and run records (migration 0010). Dashboard:
  **Automations**.
- **AI platform**: a task registry, an authorised context, one governed and metered path with cost estimates
  (migration 0011), and an insights summary that may only quote figures from its evidence.
- **Metric registry** (`docs/analytics-definitions.md`) and the **consent facade** `canContact`.
- **AI Commerce Manager** (preview): objective → at most five checked proposals → pending approvals → executed on the
  approver's authority. Dashboard: **AI manager**.

Previews are off by default. Locally: `pnpm dev:feature <email> workflows.create` (or `ai.commerce_manager`), on a
plan that grants the capability (growth or scale).

**Verified on 2026-10-29 after these changes:** `pnpm verify` **24/24** tasks (typecheck, tests and production builds,
including `next build` with the new `/app/automations` and `/app/manager` pages). **871 tests**: contracts 65, database
36, campaign-engine 40, ai 89, integrations 25, storefront-sdk 140, api 333 (+1 skipped live AI probe), web 143. **Not
run**: Playwright e2e, the load test, the backup drill and `pnpm audit`. Migrations 0008-0011 have not been applied to a
real D1, and `insights.summarize` and `objective.plan` have only run against a fake model.

## Platform foundation (added 2026-10-29)

- Central permission catalog and authorization: every store route, store creation, billing and invites now go through it.
- Audit service: workspace id, actor type, correlation id and summary; paginated store and workspace logs.
- Platform event bus: 9 versioned events, store-then-deliver, per-subscriber retry, an operational status endpoint.
- Migration 0008.
- Two bugs fixed: Shopify `products/delete` archived every tenant's product with the same id, and the store audit
  endpoint returned the oldest rows.

Details are in `docs/platform-audit.md`. After the change, `pnpm verify` passed in every package except the SDK (the
known jsdom worker-start flake), and the SDK and web tasks then passed when rerun alone. Unit and integration totals:
contracts 60, database 32, api 306 (+1 skipped), ai 89, campaign-engine 40, integrations 25. Playwright e2e, the load
test and the backup drill were **not** rerun. Migration 0008 has not been applied to a real D1.

## Campaign workspace (added 2026-10-28)

The campaign area is now one workspace rather than a list plus a single editor:

- **Folders** come from the saved format (Popups, Sticky bars, Embeds, Toasts & feed), with counts, deep links (`/app/campaigns?type=popups`) and an active state in the sidebar. Landing pages are visible but marked Soon and cannot be selected.
- **Merchant groups** (max 50 per store) support create, rename, delete and per-campaign membership toggles. Groups are organisational only and never affect storefront delivery.
- **Saved templates** (max 50 per store) capture a valid campaign draft and start a new draft; the per-campaign ⋯ menu saves one, and the Templates page lists, uses and deletes them.
- **Five campaign steps**: Campaign (performance), Builder, Preview, Launch and Submissions, each with its own page. The ⋯ menu links every step, saves a template and manages groups, with keyboard focus moved into the portalled panel.
- **Builder completeness**: all ten contract targeting conditions (page, URL, device, cart value/count, product, collection, visitor, pages viewed, stock), multi-value page/device rules, the optional per-visitor cap and click cooldown, and schedule fields that round-trip in the merchant's local time.
- **Submissions** and **Experiments** pages aggregate the existing form and holdout data across campaigns.
- **Migration 0007** adds `campaign_groups`, `campaign_group_members` and `campaign_templates`; store purge removes both merchant-owned tables.

**Verified after this change**: `pnpm verify` 24/24 (787 tests: contracts 54, database 29, campaign-engine 40, ai 89, integrations 25, storefront-sdk 140, api 290, web 120), the production Next build, and the full Playwright browser suite **88/88** against the real Worker runtime and a built Next app. The campaign-workspace and studio specs cover the folder/editor flow and the AI generate → select → refine → device flow; the editor tests cover every targeting rule type and the full frequency/schedule controls.

## AI studio (updated 2026-10-28)

- The studio is a refinement loop, not a one-shot generator. Asking for a change loads the saved draft, sends it (minus merchant-owned consent/privacy text) as `<current_draft>`, and updates **the same draft** instead of creating a new one. Only drafts can be refined; live campaigns are refused.
- The real storefront renderer is the canvas: desktop/mobile preview, click the headline, body, button or signup form to target it, quick suggestions, conversation history, and a busy overlay while a refinement is in flight.
- The default model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, routed through the Cloudflare AI Gateway `default` tunnel (`apps/api/wrangler.jsonc`), which AI Gateway auto-creates on the first authenticated request; override with `AI_MODEL`/`AI_GATEWAY_ID`. Every generation stays a draft and remains metered.
- **AI Gateway connectivity and one full generation were verified live** on 2026-10-28. A direct call returned `"connected"` (42 prompt / 2 completion tokens, 1.53 neurons), and a full toast generation through the same gateway/model produced a valid draft (775 prompt / 215 completion tokens, `gateway: true`) after the server repaired model shorthand and a bare config response. Feed, upsell and email generations still need live runs; the browser test mocks the generation response. The opt-in live probe lives at `apps/api/test/live-ai.test.ts` (`LIVE_AI=1`), so the remaining tools can be checked without changing the normal deterministic suite.

The temporary unlimited free-plan override committed on 2026-10-28 was removed. The free plan again enforces its documented limits (1 store, 1 live campaign, 3 AI generations, 5,000 tracked pageviews, toast and feed only), which the pricing page and API tests expect.

## Six-tool expansion: where it stood (superseded: SMS and upsell have since shipped, see the launch round above)

The platform is being extended from one campaign kind to six tools on one shared engine (see `architecture-v2.md`, `checklist.md`). **Three of the five customer-facing tools are shipped and verified end to end: the toast tool, the notification feed and email signup (capture and export only: nothing is sent from this app).** The upsell and SMS tools are **not built**; their contracts, slot rules, plan entitlements and an API gate that refuses to publish them exist, so nothing half-finished can reach shoppers. The six-tool platform is therefore **not** ready for the commercial beta described in the brief.

| Tool | State |
|---|---|
| Toast (promotional, non-blocking) | Shipped: editor, live preview, storefront renderer, triggers, arbitration, analytics, e2e |
| Notification feed | Shipped: bell + panel renderer, browser-local read state, editor with live preview, ordering, scheduling/expiry, targeting, analytics via the shared pipeline, e2e |
| Upsell / recommendations | Not built |
| SMS signup | Not built (contacts/consent foundation exists, see below) |
| Email signup | Shipped: editor with live preview, popup / slide-in / bar / inline forms with an unticked consent box, optional first name, a discount code revealed only after confirming, double opt-in, consent proof stored from the published form, one-click unsubscribe, Subscribers page (list, erase, CSV export), retention, per-form request/confirmation counts, **copy of confirmed subscribers to Klaviyo and Mailchimp (adapters never run against the real services; the dashboard says "Not verified against the live provider" until a check with a real key passes)**, e2e. **Not built: sending any marketing email from this app** |
| Per-tool analytics | Partial: per-campaign metrics only (feed opens count as impressions, item clicks as clicks) |
| AI studio across tools | Extended for toast, feed, upsell and email (tool choice, per-tool configs, per-tool policy gate, merchant-owned consent wording, review step); SMS refused until it ships. **Tested against fakes only: the live Workers AI model has never been called** (see `checklist.md` Phase 7) |

The tool names in the original brief are identical to a competitor's marketed product names, so the dashboard defaults to neutral names (Toasts, Notification feed, Upsells, SMS signup, Email signup) and each can be overridden with `NEXT_PUBLIC_TOOL_NAME_<KEY>`.

**Verdict for the original single-campaign product: feature-complete for everything that can be built and tested without third-party accounts, and heavily tested, but NOT launch-ready.** The remaining blockers need accounts, credentials or people that do not exist yet (see "Launch blockers"). Nothing below claims more than was actually run.

## Contacts and consent foundation (added after the figures below)
Migration 0003, `apps/api/src/services/contacts.ts`, and the email tool built on them. **Run after the change: `pnpm verify` 24/24 (398 unit tests: contracts 50, database 14, campaign-engine 36, ai 8, integrations 6, storefront-sdk 87, api 154, web 43) and the full browser suite 59/59** (51 earlier + 8 for email; run as a full pass of 47 plus a rerun of the 12 toast tests after fixing a stale "email is Soon" assertion). SDK is 11,924 B gzip. The load test, backup drill, `pnpm audit` and secret scan were **not rerun** (the backup drill's source database still predates migration 0003). Migration 0003 has been applied to in-memory SQLite and the local D1 emulator, never to a real Cloudflare D1.

The figures in the tables below predate this change.

## Verified (actually executed)
| What | Result |
|---|---|
| `pnpm verify` (typecheck + test + build, every package) | 24/24 tasks pass (rerun after the expansion) |
| Unit + integration tests | **357**: contracts 49, database 9, campaign-engine 36, ai 8, integrations 6, storefront-sdk 77, api 134 (real migrations on in-memory SQLite), web 38 |
| End-to-end, real Chromium vs the real stack (Worker on workerd + local D1/KV/Queue, built Next app, storefront on another origin, mock email server) | **51/51**: the original 29, 12 for the toast tool and 10 for the feed (see lists below) |
| Accessibility (axe, WCAG 2 A/AA) | 0 serious/critical on every public and app screen, **light and dark** |
| Load / integrity (local runtime; **not rerun after the expansion**) | 25 req/s, 1,246 events/s, p95 1.6 s, 20,500 events aggregated **exactly**, replay changes nothing |
| Backup/restore drill (**reran and passed, but it reports 31 indexes and migration 0002 adds one, so its source database predates 0002; it does not prove the new schema**) | 25 tables, 20,561 rows restored byte-identical, 0 FK violations, 31/31 indexes, unique constraints intact |
| `pnpm audit --prod`, secret scan (**not rerun after the expansion**; no dependencies were added) | clean |
| SDK size | Core `cf.js` 10,278 B gzip; toast, feed, upsell and email are separate scripts of 2.7 to 3.7 KB each, loaded on demand; all together 23.0 KB (the build fails over 12 KB core, 35 KB total, or the 15 KB marketing claim, which now says "core"). It was 15,242 B in one file with 118 B of headroom before the split. |
| OpenAPI | generated from real request schemas; a test fails if any route is undocumented or any documented route is not served |

Toast end-to-end covers: tool navigation and honest "not available" pages; the server refusing to publish an unshipped tool even via the API; building a free-shipping toast with a live preview, approval and publish; an eligible visitor seeing the real remaining amount without focus being taken; ineligible visitors (wrong page, unknown cart, already-qualifying cart) seeing nothing; cart changes; axe on the toast; a 390 px layout; reduced motion; a recorded click and a purchase attributed once; remembered dismissal; consent respected; pause.

Feed end-to-end covers: building and publishing cards through the editor with a live preview of the real feed; unread count for eligible cards only (targeting and expiry respected); the merchant's ordering; read state surviving a reload with consent and a different page adding its own unread card; keyboard (Enter opens, Escape closes and restores focus); axe on the open panel; outside click; a 390 px viewport; opens and clicks counted and a later purchase attributed once; consent respected (no persistence beyond the tab session, nothing sent); pausing removes the bell.

End-to-end (original suite) covers: marketing page + interactive demo + pricing parity with the API; signup; **email confirmation gate**; editor with live preview; approve-and-publish; storefront show/hide by rule; dismissal; click tracking; consent (shown but not recorded); purchase attribution once; pause; mobile; **password reset** (single-use, signs out other devices); **two-step verification** (enrol, code login, recovery code once, disable); **team** (invite, wrong-account rejection, role, removal revokes access); **back-in-stock** (double opt-in, one alert, one-click unsubscribe); **promotion guardrail**; **holdout experiment** (both arms observed, honest verdict); CSP; dark-mode accessibility.

## Bugs found by testing and fixed (not hypothetical)
- **Every email would have failed in production**: `this.fetchFn(...)` throws "Illegal invocation" on Cloudflare Workers. Node tests cannot show it; the real runtime did. Fixed and covered by a test that reproduces the Workers behaviour.
- Event ingestion queried D1 per request, and D1 is single-threaded, so reads stalled behind the consumer's writes (p95 18.8 s). Now KV + queue only on the hot path, and the consumer batches its writes (3 -> 25 req/s).
- SDK kept showing a paused campaign from cache; URL validator accepted `/\evil.com` (open redirect) and leading whitespace; colour contrast; a `<select>` inside a `<label>` polluted the accessible name; a failed first publish discarded its own error message (editor remounted); a `drizzle-orm` duplicate; order double counted by webhook and pixel; an ordering leak in the invite route (403 vs 404).

## Implemented
Auth (PBKDF2, hashed sessions, CSRF origin check, rate limits, Turnstile, **password reset, email verification, TOTP 2FA + recovery codes**), **team invites with roles**, **multiple workspaces**, tenancy with 404-on-foreign-ids, campaign lifecycle (immutable versions, rollback, approval-staleness guard, kill switch), edge-served config, consent-gated analytics via queue (idempotent, batched, DLQ), last-click attribution **and randomised holdout experiments with a conservative z-test**, **back-in-stock alerts** (double opt-in, quota, one-click unsubscribe, retention), **promotions with a store-level discount ceiling** (AI can never create them), **hand-picked product cards**, catalog import (JSON/CSV) plus **live WooCommerce and BigCommerce sync**, AI generation via Workers AI with policy validation, plan limits incl. pageview hard stop, **Stripe checkout + customer portal**, Shopify webhook handler, AES-GCM credential storage, account deletion and store purge, daily cron, **OpenAPI**, **CSP and security headers**, request logging, CI.

## Found and fixed during the expansion
- Importing two pure helpers from `@convertflow/contracts` into the storefront bundle pulled in all of Zod: the SDK went from 6 KB to **107 KB gzip**. Caught by the size budget in the build; the helpers now live in a zod-free `@convertflow/contracts/slots` module (9 KB).
- `remainingForFreeShipping` rounded 74.995 against a 75 threshold to "$0.00 away" while the cart was still short. Now rounds up and never shows less than one cent.
- The SDK never cleared its "something is on screen" marker after a dismissal, so no other campaign could show for the rest of that page view.
- A regex written through a shell heredoc silently contained backspace characters and never matched. All sources are now scanned for control characters.

- The feed's "New" label was dimmed by a parent's opacity and failed colour contrast (about 3.7:1). Caught by axe in the e2e, fixed.
- The feed queued its page-view event without flushing, so a shopper who never opened the bell was not counted until the page unloaded. Caught by a unit test, fixed.
- An e2e "pause everything" step passed vacuously because it counted buttons before the list had loaded. Rewritten to wait for the rows and assert every card shows as paused.

## Launch blockers (need you) (earlier list; the current one is docs/production-launch-checklist.md. Shopify install, sync and billing are now built, verified against a mock only)
1. **Cloudflare account**: create D1/KV/Queues (+DLQ), set secrets, deploy 3 Workers, DNS so web and API share a registrable domain (cookie is `SameSite=Lax`), add rate-limiting rules (the in-app limiter is per-isolate only), real `wrangler` ids. See `docs/deployment.md`.
2. **AI generation has one live end-to-end run (toast) but not all tools.** The default is `@cf/meta/llama-3.3-70b-instruct-fp8-fast` routed through the auto-created AI Gateway `default`; change `AI_GATEWAY_ID` for a named gateway. Run live generations for feed, upsell and email, plus refinement flows, and review quality/cost.
3. **Stripe** (checkout, portal, webhooks) is tested against fakes/fixtures only. Do a test-mode run with real keys.
4. **Email provider**: the Resend adapter is verified against a mock (including the Workers `fetch` constraint) but not against Resend itself. Verify a sending domain (SPF/DKIM) and send a real message.
5. **Shopify** (only if distributing via the App Store): install/OAuth/token exchange, Admin API sync, and Shopify Billing are **not built**; theme embed, web pixel and toml are unverified drafts (`apps/shopify-app`).
6. **WooCommerce/BigCommerce live sync** is tested against fakes only: confirm against a real store.
7. **OpenNext/Cloudflare build** of the web app could not be verified on this Windows machine (symlink EPERM; it compiled and bundled up to that step). It is in the Linux CI job.
8. **Legal**: Privacy/Terms are templates needing counsel; add company details, DPA, sub-processor list, cookie/consent wording.
9. **Name**: "ConvertFlow" is an existing company in this category. Rename before launch (`NEXT_PUBLIC_BRAND_NAME` / `NEXT_PUBLIC_BRAND_SUFFIX`) and run a trademark search.
10. **Klaviyo and Mailchimp**: the adapters (`packages/integrations/src/providers.ts`) follow the vendors' documented REST APIs but have **never been run against the real services**. With a test account for each: connect from the Subscribers page, confirm a signup, check the person arrives on the list with their consent time and first name, unsubscribe and check removal. Klaviyo's first-name handling (a profile import before the subscription job) and the required key scopes are the least certain parts. Until a real check passes, the dashboard says "Not verified against the live provider".
11. **Host the whole `apps/storefront-sdk/dist/` directory**, not just `cf.js`: it now loads `cf-<tool>.<hash>.js` from the same directory on demand (`README.md`, `docs/storefront-sdk.md`). A merchant with a strict Content-Security-Policy must allow that origin for scripts. Not tested against a real CDN or CSP.

## Known limitations (deliberate or not yet built)
- **Platform cart detection is unverified on live stores.** Shopify (`/cart/add`, `/cart.js`, amounts assumed to be cents) and WooCommerce (`added_to_cart`) hooks are tested only against fakes. The generic `ConvertFlow.setCart()` / `trackAddToCart()` API is what is verified end to end.
- Arbitration is by eligibility, not trigger timing: an eligible popup still waiting for exit intent suppresses a toast on that page (`architecture-v2.md`).
- `pnpm verify` once reported the web tests as "no tests" while the Next build ran concurrently, and one SDK test run once reported 32 tests instead of 55 (55/55 on three reruns). Neither is root-caused.
- **Email list sync is polling and queue based**: a copy to a provider happens a few seconds after the shopper confirms (the Subscribers page refreshes every 4 s for about two minutes while anything is waiting). Rate limits and outages back off up to 6 h and give up visibly after 8 attempts; a daily sweep re-queues anything stranded. Erasing someone unsubscribes them at the provider but does not delete their profile there. The discount code a form promises is the merchant's one shared code, not a personal one.
- **Creative A/B variants** (testing copy A against copy B) are not built. Holdout experiments measure whether a campaign works at all, not which of two versions works better. No plan claims otherwise.
- Product recommendations are manual picks, not algorithmic. Margin-aware promotions are a store-level discount ceiling, not per-product margin rules. **Autonomous AI optimisation is intentionally not built**: nothing should change live campaigns without a merchant's approval.
- Experiment arms and purchases are reported by visitors' browsers, so they can be spoofed; results are labelled estimates. Holdouts only apply to consenting visitors.
- Rate limiting is in-memory per isolate (best effort). CSP allows inline scripts (Next.js hydration), so it limits damage rather than preventing script injection.
- No shared load numbers for production: local figures only. D1 is a single writer; the migration path is in `docs/architecture.md`.
- No monitoring dashboards or paging wired up (structured logs per request exist; alert on DLQ depth and 5xx rate).
- Web app has unit tests for the security-critical components and client, not exhaustive coverage of every page (the browser suite covers the flows).
- Tests were run on Windows and macOS. CI on Linux has not run yet.
