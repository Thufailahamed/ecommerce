# Final verification report (2026-10-29)

What was tested, where, how, with what result, and what is still not verified. Environment for everything below:
Windows 11, Node 24, pnpm 12, the repository at the end of this round. **Production environment: none.** No Cloudflare
account, Shopify Partner account, Twilio, Klaviyo, Mailchimp, Stripe or Resend account was available, so no row below is
"production verified".

## 1. Commands and results

| Check | Command | Result |
|---|---|---|
| Repository checks | `pnpm lint` (`scripts/check-repo.mjs`) | Pass (440 files): no focused tests, control characters or committed secrets; every migration has a test; Shopify scopes in code and toml agree; every shipped tool has an SDK chunk |
| Typecheck, unit, integration, contract tests, production builds | `pnpm turbo run typecheck test build --concurrency=3 --force` (no cache) | **27/27 tasks** |
| Unit + integration tests | (same) | **1,015 passed**, 1 skipped (the opt-in live AI probe): api 392, web 162, storefront-sdk 150, ai 95, contracts 75, database 42, campaign-engine 40, integrations 35, store-builder 24. Baseline at the start of the round: 931 |
| Migrations on D1 | `pnpm db:check` (wrangler local D1) | 0000-0013 applied to an empty database |
| Wrangler environments | `wrangler deploy --dry-run [--env staging/production]` (api, sdk) | All three API environments bundle with their own D1, KV, Queue and AI bindings (337 KiB gzip); SDK assets resolve in each environment |
| End to end (real browser, real Worker runtime, local D1/KV/Queues, production Next build) | `pnpm e2e` with `E2E_STORE_PORT=4010 E2E_MAIL_PORT=4110` | **102/102 passed** (10.2 min): the 89 earlier journeys plus SMS (4), Shopify (5) and tenancy (4). Earlier runs this round failed 3, then 1: an export button renamed by this work, an axe race (fixed by waiting for animations, which then exposed a real AA contrast defect, fixed), a store-selection bug after the Shopify redirect (fixed), and two test-harness mistakes (a redirect page.route cannot intercept; a plan helper that left the status cancelled) |
| Backup and restore | `node scripts/backup-drill.mjs tests/e2e/.state` | **Pass**: 48 tables, every row byte-identical, 0 foreign-key violations, 71/71 indexes, unique constraints enforced |
| Dependency audit | `pnpm audit --prod --audit-level=high` | No known vulnerabilities |
| Load and integrity (local runtime) | `node tests/load/events-load.mjs 15 16` | **Pass**: 48,050 events in 15.3 s (63 req/s, 3,134 events/s, 0 errors), latency p50 96 ms / p95 726 ms / p99 846 ms; aggregated exactly 48,050; a replayed batch changed the total by 0; config endpoint 189 req/s, p99 141 ms. Local workerd + SQLite only, **not** a production capacity claim |
| SDK size | `pnpm --filter @convertflow/storefront-sdk build` | Core `cf.js` **10,719 B gzip** (budget 12 KB); all six scripts **27,851 B** (budget 35 KB); SMS chunk 4,367 B |
| OpenNext (Cloudflare) web build | — | **Not run**: needs symlinks Windows refuses; it is a CI step on Linux, which has never run |

## 2. Critical workflows

| Workflow | What was tested | Environment | Suite | Result | Remaining limitation | Production verified |
|---|---|---|---|---|---|---|
| **A. Installation and onboarding** | Merchant installs from Settings → Shopify authorization (signed redirect) → callback links the store → lands on that store → catalog sync of 12 products over 2 pages with Shopify's availability → integration "connected" and live health check OK → reinstall from the Shopify admin claimed at `/connect/shopify` returns the same store | Real browser + Worker; Shopify played by `page.route` (authorize/approve) and `mock-shopify.mjs` (token, GraphQL) | `tests/e2e/shopify.spec.ts`, `apps/api/test/shopify.test.ts` (22) | Pass (5/5 browser, 22/22 API) | Never run against Shopify; theme embed and pixel never deployed; App Store embedding requirement unconfirmed | No |
| **B. Campaign lifecycle** | Create toast → edit → validate → live preview → approve and publish → eligible storefront shows it → frequency and dismissal rules → pause → storefront stops showing it | Real browser + Worker + demo storefront | `toast.spec.ts`, `flow.spec.ts`, `campaign-workspace.spec.ts` | Pass | Shopify cart hooks fake-tested only | No |
| **C. Commerce analytics** | Storefront events → schema validation → queue → consumer; duplicate delivery counted once; purchase beacon and order webhook → one conversion; last-click attribution; dashboard shows the processed numbers; form submits counted per tool | Browser + Worker + local Queue; API integration tests | `flow.spec.ts`, `feed.spec.ts`, `upsell.spec.ts`, `test/ingest.test.ts`, `test/tool-analytics.test.ts`, `test/sms.test.ts` | Pass | Local runtime only; consent-gated by design | No |
| **D. Subscriber lifecycle** | Email: unticked consent → confirmation email with the exact wording → confirm → Klaviyo/Mailchimp copy → unsubscribe → removal → suppressed. **SMS (new)**: consent → code texted → wrong code refused → right code subscribes → merchant sees and exports the number → records an opt-out → the number is never texted again | Browser + Worker; mock Resend, mock Klaviyo/Mailchimp, mock Twilio | `email.spec.ts`, `provider.spec.ts`, `sms.spec.ts`; `test/contacts.test.ts`, `test/providers.test.ts`, `test/sms.test.ts` (16) | Pass (SMS 4/4 new) | No real email, SMS, Klaviyo or Mailchimp delivery | No |
| **E. AI campaign generation** | Objective → authorised context → structured proposal → invalid output rejected (schema and policy) → preview → approve → publish → audit trail; SMS drafts get the server's consent template | Browser + Worker + mock AI Gateway; fake models in unit tests | `studio.spec.ts`, `builder.spec.ts`; `test/ai-tools.test.ts`, `test/ai-manager.test.ts`, `packages/ai` (95) | Pass | Live models: one toast generation was verified in an earlier round; other tools never live | No |
| **F. Tenant security** | Two workspaces; cross-workspace reads and writes by URL and body id substitution (stores, campaigns, contacts, integrations, audit, analytics, Shopify, providers, delivery, deletion) all 404 with nothing leaked; CSRF from another origin 403; pasted ids show nothing in the dashboard; shop squatting by typed domain claims nothing | Browser + Worker; API tests | `tenancy.spec.ts` (new), `test/security.test.ts`, `test/platform.test.ts`, `test/shopify.test.ts` | Pass (4/4 new) | No external penetration test | No |

## 3. What this round built and fixed (with evidence)
| Change | Evidence |
|---|---|
| **SMS signup shipped**: form (country codes, E.164), Twilio Verify code confirmation, consent proof from the live form, STOP required in consent, Klaviyo SMS sync, merchant opt-out, erasure, export by channel, quota and rate limits, analytics labels | `sms.test.ts` (API 16, SDK 10), `sms-editor.test.tsx` (3), `sms.spec.ts` (4), integrations `sms.test.ts` (6) |
| **Shopify app**: OAuth install (dashboard and App Store), claim, reinstall, Admin GraphQL catalog sync, uninstall, privacy webhooks acting on contacts, **Shopify Billing**, daily catalog and billing reconciliation | `shopify.test.ts` (22), `shopify-settings.test.tsx` (5), `shopify.spec.ts`, migration 0013 + test |
| Serving follows the plan: a downgrade or lapsed payment stops paid tools at once, nothing deleted | `shopify.test.ts` billing |
| Signup forms cannot be published without a working confirmation path | `tools.test.ts` |
| Form-submit analytics now have a source (SDK), shown per tool | SDK `sms.test.ts`, contracts |
| Extension contracts (post-purchase, reviews, loyalty) + exactly-once loyalty fixture on the live order pipeline | `extensions.test.ts` (9), `extension-points.test.ts` (2) |
| Security fixes: shop squatting (P0), privacy webhooks ignoring stored PII (P0), and four P1s | `docs/security.md` "Security review of the launch round" |
| UX fixes found by the browser suite: returning from Shopify landed on another store; a store chosen by link was not remembered; marketing text below AA contrast hidden by an animation race in the a11y test | `shopify.spec.ts`, `flow.spec.ts` |
| CI: repository checks, D1 migration check, manual deploy workflow with approvals and no implicit production migrations; per-environment Wrangler configs | `.github/workflows/*`, `wrangler.jsonc` dry runs |
| Docs: launch audit, launch checklist, operations, privacy and data, Shopify, SMS, extension points, deployment, security | `docs/` |

## 4. Remaining issues
| P | Issue |
|---|---|
| P0 | No production environment (Cloudflare resources, secrets, DNS) |
| P0 | Privacy policy, terms and DPA are templates; counsel must review, including SMS consent wording per country |
| P0 | No third-party integration has run against the real service: Shopify, Twilio Verify, Klaviyo (email and SMS), Mailchimp, Stripe, Resend, live AI for all tools |
| P1 | Shopify App Store embedding requirement unconfirmed |
| P1 | Monitoring and alerting not configured (specified in docs/operations.md) |
| P1 | In-app rate limiting is per isolate; edge rate-limiting rules needed |
| P1 | Brand name conflict ("ConvertFlow", and the Noti* names) |
| P2 | Unkeyed suppression hashes (phone numbers brute-forceable) |
| P2 | GitHub CI on Linux (including the OpenNext build) has never run |
| P2 | No merchant help centre or support process |
| P3 | Shopify products with more than 50 variants import the first 50; one list per store at Klaviyo/Mailchimp |

## 5. Launch recommendation

**Not ready for launch.** The code for the agreed scope is complete and passes every automated check available here,
including real-browser end-to-end runs of all six critical workflows, but three P0s remain and none of them is a code
defect: there is no production environment, the legal documents are templates, and not one third-party integration
(Shopify, Twilio, Klaviyo, Mailchimp, Stripe, Resend) has been exercised for real.

The fastest honest path to a **controlled beta**: provision staging (docs/deployment.md), run the Shopify development-store
checklist (docs/shopify.md §5), a Twilio test number and Klaviyo test account (docs/sms.md), a Stripe test-mode checkout
and a real Resend domain, get counsel's sign-off on the privacy policy, terms, DPA and consent wording, configure the
alerts in docs/operations.md, then onboard a handful of merchants on staging-grade infrastructure with test-mode billing.
