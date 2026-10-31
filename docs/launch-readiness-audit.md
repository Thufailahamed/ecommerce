# Launch-readiness audit (2026-10-29)

Written against the repository as found, before any change in this round, then updated with what this round built and
the evidence it produced (the **Final evidence** column and section 5). Every status below comes from code that was read
and checks that were run on this machine (Windows 11, Node 24, pnpm 12). A file existing is never treated as evidence.

Statuses: **Not implemented** · **Partial** · **Implemented, unverified** · **Verified (test env)** ·
**Production verified** · **Blocked (external)**. Nothing in this repository is *Production verified*: there is no
Cloudflare account, Shopify Partner account, Stripe/Twilio/Klaviyo/Mailchimp account or production domain available
to this work.

## 0. Baseline checks (before any edit)

| Check | Result |
|---|---|
| `pnpm verify` (typecheck, unit + integration tests, production builds; 27 turbo tasks) | 27/27 pass (23 replayed from turbo cache) |
| Unit + integration tests | **931**: contracts 65, store-builder 24, integrations 25, database 39, campaign-engine 40, ai 95, api 349 (+1 skipped live AI probe), storefront-sdk 140, web 154 |
| SDK size | core `cf.js` 10,278 B gzip; all scripts 23,043 B gzip (budgets 12 KB / 35 KB) |
| Lint | **No lint script exists in any package**: `pnpm lint` is a no-op. Formatting is not checked |
| Last Playwright run on disk | passed (89/89 per `docs/status.md`); not rerun before this audit |
| Committed secrets scan | none: matches are test fixtures (`shpat_plain`, `sk_test_abc…`) and a key-format validator |
| Placeholder / fabricated data in the dashboard | none found: previews use products and carts labelled "sample", never shown as metrics |
| Hardcoded deployment values | `apps/api/wrangler.jsonc` holds a real-looking D1 id, KV id and a personal `*.workers.dev` origin while its comment calls them placeholders; `shopify.app.toml` holds placeholder client id and URLs |

## 1. Foundations

| Feature | Status found | Verification found | Known defects / gaps | Required change | Dependencies | Acceptance criteria | Final evidence |
|---|---|---|---|---|---|---|---|
| Authentication, sessions | Verified (test env) | api tests + Playwright (signup, email gate, reset, TOTP) | none found | none | Resend for real email | login, expiry, revocation, MFA tested | unchanged; full suite rerun (section 5) |
| Org / store membership, roles | Verified (test env) | `platform.test.ts`, `security.test.ts`, e2e team flow | none found | cover new routes | none | 404 outsider / 403 member on every new route | new Shopify, SMS and billing routes covered in `shopify.test.ts`, `sms.test.ts` |
| Tenant-scoped data access | Verified (test env) | foreign-id 404 tests across 48 routes | none found | same for new routes | none | object-id substitution rejected | `shopify.test.ts` "tenancy", `sms.test.ts` "tenancy" |
| Credential storage | Verified (test env) | AES-GCM round trip, never returned | none | reuse for Shopify tokens | `CREDENTIAL_KEY` secret | token never in API output or logs | `shopify.test.ts` asserts token not in any response |
| Unified commerce data (products, variants, availability) | Partial | import/Woo/BigCommerce fake-tested; Shopify webhook-only | **no Shopify Admin API sync, so Shopify variant ids were never fetched** | Shopify GraphQL catalog sync | Shopify OAuth | paginated sync, availability from inventory, no fabricated stock | built; fake-Admin-API tested |
| Orders | Partial | `orders/create` webhook → platform event → conversion | conversions only (no order entity) | contract for fulfilment events | none | documented order/fulfilment contracts | `order.fulfilled` / `order.refunded` contracts + fixture test |
| Event platform (contracts, idempotency, queue, retry, DLQ, replay) | Verified (test env) | `platform.test.ts`, load test (earlier round) | DLQ not exercised on real Queues | none | Cloudflare Queues | duplicates do not double count | unchanged; rerun |
| Workflow engine | Verified (test env), preview | `workflows.test.ts` | preview flag only | none | none | lifecycle, loops, caps, approvals | unchanged; rerun |
| AI platform (structured output, validation, metering, approvals) | Verified (test env) against fakes | `ai.test.ts`, `ai-manager.test.ts`; one live toast generation (earlier round) | other tools never run live | none in code | Cloudflare AI Gateway | invalid output rejected; approvals required | unchanged; live runs **Blocked (external)** |
| Entitlements / usage | Verified (test env) | `entitlements.test.ts` | no Shopify Billing source of plan | Shopify Billing state → subscription | Shopify Partner app | expired/declined plan falls back to free server-side | `shopify.test.ts` › Shopify Billing (serving follows the plan; nothing deleted) |
| Consent / suppression | Verified (test env) | contacts, providers tests, e2e | SMS channel had no public path | SMS capture + verification | Twilio Verify | no SMS contact without verified number and recorded wording | `sms.test.ts` |
| Audit log | Verified (test env) | `platform.test.ts` | none | audit new actions | none | install, billing, SMS provider changes audited | asserted in new tests |
| Observability | Implemented, unverified | structured request logs, request ids | no alerting wired | document alerts | Cloudflare account | — | `docs/operations.md` |
| Feature flags | Verified (test env) | preview capabilities | none | none | none | — | unchanged |
| Data retention / deletion | Verified (test env) | purge tests, GDPR webhook tests | Shopify `shop/redact` purges data; uninstall does not | none (by design) | none | — | unchanged |
| API contract validation | Verified (test env) | OpenAPI sync test | none | document new routes | none | every route documented | OpenAPI test passes with new routes |

## 2. Product suite

The Noti* names in the brief are a competitor's marketed product names, so the code and dashboard use neutral keys
(`docs/architecture-v2.md` §6). Mapping: NotiFeed = `feed`, NotiPop = `toast` (+ popup / slide-in / bar formats),
NotiSell = `upsell`, NotiSMS = `sms`, NotiEmail = `email`.

| Tool | Status found | Verification found | Known defects / gaps | Required change | Dependencies | Final evidence |
|---|---|---|---|---|---|---|
| NotiFeed (`feed`) | Verified (test env) | SDK + api + 10 Playwright specs | cross-device read state not built (no customer identity) | none | live Shopify store for theme test | unchanged; e2e rerun |
| NotiPop (`toast`, popups) | Verified (test env) | 12 Playwright specs + original 29 | arbitration by eligibility, not trigger time (documented) | none | live store | unchanged; e2e rerun |
| NotiSell (`upsell`) | Verified (test env) | api + SDK + e2e | Shopify `/cart/add.js` and variant ids fake-tested only | Shopify Admin sync supplies real variant ids | Shopify dev store | sync stores numeric variant ids from GraphQL GIDs (test) |
| NotiSMS (`sms`) | **Not implemented** | contract + schema only; publish refused | no route, no form, no adapter, no verification | full tool: form, E.164, OTP verification, consent proof, Klaviyo SMS sync, opt-out, erasure, analytics | Twilio Verify, Klaviyo SMS | built; `sms.test.ts`, SDK `sms.test.ts`, web editor test, e2e `sms.spec.ts`; live providers **Blocked (external)** |
| NotiEmail (`email`) | Verified (test env); providers unverified | e2e + providers tests vs mocks | Klaviyo/Mailchimp never run live; SDK never emitted form-submit events | emit form events | Klaviyo/Mailchimp accounts | form events emitted and counted (SDK + api tests) |
| Analytics | Partial | per-tool metrics; form browser counters had no source | form submit counters read zero; no SMS metrics | SDK emits `form_submit_*`; SMS metrics | none | counted end to end (tests) |

## 3. AI Commerce Manager and extension points

| Item | Status found | Required change | Final evidence |
|---|---|---|---|
| AI Commerce Manager (objective → evidence → proposals → approval → execution → audit) | Verified (test env) against a fake model, preview flag | none in code | unchanged; live model **Blocked (external)** |
| Marketing automation on the workflow engine | Verified (test env) | none | unchanged |
| AI shopping assistant (reusable product search / availability / cart services) | Partial: recommendation + catalog services exist | none this round | documented in `docs/extension-points.md` |
| Loyalty / referrals | Not implemented (types only) | contract + fixture proving it rides on `order.created` | `extension-points.test.ts` (contract only, not a product) |
| Reviews / UGC | Not implemented (types only) | review entity, moderation states and events as contracts | `extension-points.test.ts` (contract only) |
| Post-purchase | Not implemented | `order.fulfilled` / `order.refunded` contracts | contracts in `domain-events.ts` + fixture |
| Product intelligence | Partial (catalog, inventory, conversions) | document what data exists (no cost/margin) | `docs/extension-points.md` |

## 4. Shopify, billing, operations

| Item | Status found | Required change | Dependencies | Final evidence |
|---|---|---|---|---|
| OAuth install / token exchange | **Not implemented** | authorization-code install with HMAC + state + shop validation, encrypted offline token, linking to a workspace, reinstall | Shopify Partner app | built; tested against a fake Shopify; live **Blocked (external)** |
| Admin API catalog sync | Not implemented | GraphQL products + variants + inventory, cursor pagination, throttle handling | as above | built; fake-tested |
| Webhooks (HMAC, idempotency, GDPR, uninstall) | Verified (test env) with fixtures | add `app_subscriptions/update`; uninstall clears installation | Shopify | tests pass |
| Theme app embed, Web Pixel | Implemented, unverified (never deployed) | none possible without a store | Shopify dev store | **Blocked (external)** |
| Shopify Billing | Not implemented | `appSubscriptionCreate`, confirmation, webhook-driven state, downgrade to free on decline/cancel/freeze | Shopify Partner app | built; fake-tested |
| Stripe billing (non-Shopify merchants) | Implemented, fixture-tested | none | Stripe test account | unchanged |
| CI | Partial: verify, audit, OpenNext build, e2e | add formatting/lint check, migration validation | GitHub | updated `ci.yml` |
| Deployment docs | Partial | Shopify + SMS secrets, staging/prod separation, rollback | — | `docs/deployment.md` updated |

## 5. Outcome of this round

| Area | Status at the start | Status now |
|---|---|---|
| NotiSMS (`sms`) | Not implemented | Verified (test env); live Twilio and Klaviyo SMS **Blocked (external)** |
| Shopify install, catalog sync, billing | Not implemented | Verified (test env) against a fake Shopify; live **Blocked (external)** |
| Form-submit analytics | Partial (no source) | Verified (test env) |
| Serving follows the plan after a downgrade | Not implemented (gap found in this audit) | Verified (test env) |
| Extension contracts (post-purchase, reviews, loyalty) | Not implemented (types only) | Contracts and fixtures verified; modules remain **not built**, by design |
| Scheduled reconciliation (catalog, billing) | Not implemented | Verified (test env) |
| Every other foundation and tool | Verified (test env) | Verified (test env), full suites rerun with no cache |
| Production (Cloudflare, Shopify, Stripe, Twilio, Klaviyo, Mailchimp, Resend) | Blocked (external) | Blocked (external) |

Commands, results and the launch recommendation: `docs/final-verification-report.md`. What remains before launch:
`docs/production-launch-checklist.md`.
