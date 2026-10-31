# Production launch checklist

State on 2026-10-29. ✅ done and verified here · ⚠️ done in code, verified only against mocks/fixtures or locally ·
⛔ not done (blocked or open). Evidence for every ✅ is in `docs/final-verification-report.md`.

## Product
| Item | State | Notes |
|---|---|---|
| All launch-scope features verified | ⚠️ | Six tools, analytics, AI Commerce Manager (preview), Shopify app and billing pass unit, integration and browser tests against mocks. **No third-party service has been exercised for real** |
| Onboarding complete | ⚠️ | Snippet path verified in the browser; Shopify install, sync and claim verified against a mock Shopify |
| Error states implemented | ✅ | Every new route and screen has explicit error, empty and loading states; Shopify callback errors explained on `/connect/shopify` |
| Support documentation available | ⛔ | Engineering docs exist (`docs/`); merchant-facing help centre not written |
| Demo data separated from production data | ✅ | Previews use labelled sample products; no fabricated metrics in the dashboard (audit §0) |

## Shopify
| Item | State | Notes |
|---|---|---|
| App configuration verified | ⛔ | `shopify.app.toml` has placeholder client id and URLs; never deployed (no Partner account) |
| Required scopes justified | ✅ | `read_products`, `read_inventory`, `read_orders` (docs/shopify.md); `pnpm lint` keeps toml and code in step |
| Webhooks configured | ⚠️ | Topics declared in the toml; handlers tested with signed fixtures |
| Extensions tested | ⛔ | Theme embed and web pixel never deployed to a store |
| Privacy webhooks verified | ⚠️ | Tested with fixtures (redact erases contacts, data_request records them, shop/redact purges) |
| Uninstall and reinstall tested | ⚠️ | Against the mock Shopify, unit and browser |
| App Store requirements reviewed | ⛔ | The app is non-embedded; confirm whether listing requires an embedded app with session tokens (docs/shopify.md §3) |

## Infrastructure
| Item | State | Notes |
|---|---|---|
| Production resources configured | ⛔ | `wrangler.jsonc` env sections hold `REPLACE_WITH_…` ids (docs/deployment.md §1) |
| Secrets configured securely | ⛔ | Names and purposes documented; none set |
| Database migrations applied | ⛔ | 0000-0013 apply to local D1 (`pnpm db:check`, e2e); never to remote D1 |
| Queues tested | ⚠️ | Local Queues in the e2e runtime; DLQ never exercised on Cloudflare |
| Backups configured | ⛔ | D1 Time Travel is on by default; weekly export not scheduled; drill run locally only |
| Monitoring and alerting enabled | ⛔ | Alerts specified in docs/operations.md; none created |
| Recovery procedures documented | ✅ | docs/operations.md |

## Security and privacy
| Item | State | Notes |
|---|---|---|
| Tenant isolation verified | ✅ | API suite (404 for foreign ids on every route) and `tests/e2e/tenancy.spec.ts` in a real browser |
| Authorization tests passed | ✅ | Role thresholds and owner-only billing tested |
| Secrets not exposed | ✅ | Tokens/keys never returned or logged (tested); repository check for committed secrets; client bundles contain only `NEXT_PUBLIC_*` |
| Consent and suppression tested | ✅ | Email and SMS: unticked consent, recorded wording, double opt-in / code verification, opt-out, suppression, provider removal |
| Deletion workflows tested | ✅ | Contact erasure, account deletion, store purge, Shopify redact webhooks |
| Privacy documentation reviewed | ⛔ | docs/privacy-and-data.md written for counsel; privacy policy and terms are templates |
| External security review / pen test | ⛔ | Only the author's review (docs/security.md) |

## Commercial
| Item | State | Notes |
|---|---|---|
| Billing verified | ⚠️ | Stripe and Shopify Billing state machines tested against fixtures/mocks; no live or test-mode charge made |
| Plan entitlements tested | ✅ | Server-side on publish, at serve time (downgrades stop paid tools without deleting) and on public endpoints |
| Usage limits enforced | ✅ | Pageviews (hard stop), AI drafts, restock alerts, SMS verifications, builder messages and images |
| Support contact established | ⛔ | |
| Terms and privacy policy available | ⛔ | Templates only |
| Pricing and feature claims match the product | ⚠️ | Pricing page reads `PLANS`; the marketing site does not yet mention SMS signup or Shopify billing (deliberately not advertised before live verification) |
| Brand name cleared | ⛔ | "ConvertFlow" is an existing company's name; the Noti* names belong to a competitor (configurable via env) |

## Quality
| Item | State | Notes |
|---|---|---|
| CI passes | ⚠️ | Every step passes locally on Windows; the GitHub Linux run (incl. OpenNext build) has never run |
| Critical E2E workflows pass | ✅ | See the final report (Workflows A-F) |
| No unresolved release-blocking defects | ⛔ | P0/P1 below are external blockers, not code defects |
| Storefront performance measured | ✅ | Core 10.7 KB gzip; per-tool scripts lazy; async, never blocks rendering (tested) |
| Analytics definitions documented | ✅ | docs/analytics-definitions.md |
| Known limitations documented | ✅ | docs/final-verification-report.md, docs/status.md |

## Launch operations
| Item | State |
|---|---|
| Staging environment validated | ⛔ |
| Rollback procedure tested where feasible | ⛔ (documented; `wrangler rollback` needs a deployment) |
| Error alerts configured | ⛔ |
| Production smoke tests prepared | ✅ (deploy workflow + docs/deployment.md §5) |
| Incident response owner identified | ⛔ (name a person) |
| Customer support process prepared | ⛔ |

## Open issues by priority
| P | Issue | Why it blocks / what unblocks it |
|---|---|---|
| P0 | No production environment exists (Cloudflare resources, secrets, DNS) | Blocked: Cloudflare account |
| P0 | Privacy policy, terms and DPA are templates | Blocked: counsel. Collecting shoppers' emails and phone numbers for merchants without a DPA is not acceptable |
| P0 | No real third-party verification: Shopify install/sync/billing, Twilio Verify, Klaviyo (email and SMS), Mailchimp, Stripe, Resend, AI Gateway for all tools | Blocked: accounts. Each has a checklist (docs/shopify.md §5, docs/sms.md, docs/status.md) |
| P1 | App Store embedding requirement unconfirmed | Decide before Shopify submission |
| P1 | Monitoring and alerting not configured | Needs the account; specified in docs/operations.md |
| P1 | Rate limiting is per isolate | Add Cloudflare rate-limiting rules (docs/deployment.md §4.7) |
| P1 | Brand name conflict | Rename before any public launch |
| P2 | Suppression hashes are unkeyed (phone numbers can be brute-forced from them) | Keyed hash + migration |
| P2 | GitHub CI (Linux, OpenNext build) never ran | Push to GitHub |
| P2 | Merchant help centre and support process | Write before onboarding merchants |
| P3 | Products with more than 50 variants import only the first 50 | Reported in the sync result; page variants if merchants need it |
| P3 | Klaviyo/Mailchimp take one list per store; no per-form mapping | Existing limitation |

**Do not launch with the P0s open.** The P0s are all outside the code: accounts, counsel and live verification.
