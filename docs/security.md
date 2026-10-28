# Security model

| Area | Implementation | Verified by |
|---|---|---|
| Passwords | PBKDF2-SHA256, 100k iterations (Workers cap), per-user salt, constant-time compare, a hash is computed even for unknown emails | api tests |
| Sessions | 32-byte random token in an HttpOnly, SameSite=Lax (Secure on https) cookie; only SHA-256 stored; 14-day expiry; revoked on logout, password reset, account deletion; other sessions revoked when MFA changes | api + e2e |
| Password reset / email verification | Single-use, expiring tokens stored hashed; consumed with an atomic conditional update (a concurrent double-submit succeeds once); identical responses for unknown accounts; 60 s cooldown; reset signs out all devices | api + e2e |
| MFA | RFC 6238 TOTP (verified against the RFC vectors), secret AES-GCM encrypted, 8 single-use recovery codes stored hashed; MFA is only revealed after the password is proven; disabling needs password + code | api + e2e |
| CSRF | State-changing app requests must carry the app `Origin`; CORS allows only `ALLOWED_ORIGIN` with credentials | api tests |
| Tenancy | Every store/org route resolves membership first; foreign ids are 404; roles viewer < editor < admin < owner; invites bind to the invited email, are single-use and expire in 7 days; owners cannot be demoted or removed | api + e2e |
| Input | Zod on every body; 512 KB JSON cap; 64 KB event cap; 4 KB restock cap | api tests |
| Output / XSS | Campaign copy rendered with `textContent` in a shadow root; URLs allow only https or `/path` (no backslashes, control characters, whitespace), re-checked at render; email templates HTML-escape names | contracts, sdk, api, e2e |
| AI | Output untrusted: schema + policy gate (no unauthorised promos, unverifiable stock claims, off-site links, model-set images, promotions, experiments, products or restock forms); store text fenced as data; drafts only; approval bound to the exact draft | ai + api tests |
| Webhooks | Shopify HMAC-SHA256 and Stripe signature (5-min replay window), constant-time, idempotent on delivery id | api tests |
| Secrets | Worker secrets only; platform tokens AES-256-GCM at rest (fresh IV), never returned by any route; missing key fails closed | api tests |
| Server-side fetch | WooCommerce sync only ever requests the store's own registered domain (no user-supplied URLs: no SSRF); BigCommerce store hash validated; Stripe/Resend/Turnstile are fixed hosts | api tests |
| Privacy | Analytics only after consent (schema-enforced; SDK honours Shopify Customer Privacy API); experiment visitor ids exist only for consenting visitors; no raw events stored; dedup ledger purged after 3 days; shopper emails for restock alerts purged (7 days unconfirmed, 30 days after alert/unsubscribe) with only a hashed suppression entry kept; account deletion and `shop/redact` hard-delete | api + e2e |
| Email to shoppers | Double opt-in; one alert only; List-Unsubscribe + one-click POST; unsubscribe tokens are stateless HMACs (tamper-proof, rebuildable); quota per plan | api + e2e |
| Abuse | Per-isolate rate limits on auth/forgot/AI/events/restock (best effort); Turnstile on signup when configured; unknown site keys indistinguishable from known ones and negatively cached | api tests |
| Web headers | CSP (no framing/plugins, connect-src restricted to the API, scripts from self + Turnstile), X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy; API sets nosniff and `no-store` on token pages | e2e |
| Supply chain | `pnpm audit --prod` in CI; lockfile committed; secret scan clean | CI |

## Honest limits
- The CSP allows `'unsafe-inline'` scripts because Next.js emits inline hydration scripts; it limits blast radius but does not stop injected inline script.
- Rate limiting in the app is per isolate. Add Cloudflare rate-limiting rules for `/api/v1/auth/*`, `/api/v1/events/batch` and `/api/v1/notifications/*`.
- Experiment assignment, purchases and last-click are reported by the visitor's browser and can be spoofed; the UI labels them estimates.
- No external penetration test has been done. Do one before taking real customer data.
- Not built: login-attempt lockout per account (only per-IP limits), device management UI, audit-log export.

## List providers (Klaviyo, Mailchimp) and the sign-up incentive

Not security-reviewed by anyone but the author. What the code does:

- **Keys**: a merchant's provider API key is checked against the provider before it is stored, encrypted at rest with AES-GCM under `CREDENTIAL_KEY` (the same path as platform tokens), and never returned by any route, written to the audit log or logged. Only admins can connect, choose a list, retry or disconnect; editors can read status.
- **Where requests go**: the provider origin is fixed in code (or a server-side variable such as `KLAVIYO_BASE_URL`), never taken from a request, so a merchant cannot point the Worker at an internal address. A Klaviyo pagination link is followed only if it stays on the same origin, so the key is never sent to a host a response names.
- **What is kept from a provider's reply**: an HTTP status and the provider's short error code or title (and only if it matches a strict pattern). The response body is never copied, because providers echo the address back in error details. Errors shown to merchants are our own words.
- **Consent**: a subscribe job is only created from a confirmed subscription and re-checks current consent and suppression at the moment it runs. An opt-out that arrives while a subscribe is in flight queues a removal that is certain to run after it. Pending requests, unsubscribed people and suppressed addresses are never sent. The shopper's address leaves this system only to the provider the merchant connected.
- **Erasure** unsubscribes the person at each provider and erases locally even when a provider is down (reported in `x-provider-cleanup-failed`, audited by provider name only). It does not delete their profile at the provider.
- **Incentive**: the code is never in the form, the config, or the confirmation request email; it appears only on the single-use confirmation page (HTML-escaped) and in one email after confirming. It is only given while the store's discount ceiling still allows it, using the form version the shopper actually used.
- **Not done**: no rate limit per provider beyond the per-isolate limiter on the connect and check routes; no key rotation or expiry; the mock-vs-real distinction relies on a server variable being unset in production.
