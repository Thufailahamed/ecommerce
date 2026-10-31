# Privacy, data processing and retention

Engineering facts for counsel. **This is not legal advice and the product does not claim legal compliance.** The privacy
policy and terms in `apps/web/app/{privacy,terms}` are templates that a lawyer must complete (company details, DPA,
sub-processors, cookie and consent wording) before launch.

## Roles
- For **merchants' account data** (users, workspaces, billing), the operator is the controller.
- For **shoppers' data** (signup contacts, consent records, analytics), the merchant is the controller and the operator
  is a processor acting on the merchant's instructions. A DPA is required with every merchant.

## What is stored
| Data | About | Purpose | Retention | Deleted by |
|---|---|---|---|---|
| Email, password hash (PBKDF2), name, sessions (hashed tokens), MFA secret (encrypted) | Merchants | Accounts | Until account deletion; sessions 14 days | `DELETE /auth/account` |
| Audit log (actor id, action, ids, sanitised summary) | Merchants | Security, support | Until store/account deletion | Store purge, account deletion |
| Contacts: email or E.164 phone, optional first name, status per channel, source | Shoppers who used a signup form | Marketing consent the shopper gave | Unconfirmed: 7 days; not subscribed: 30 days; subscribed: until opt-out, erasure or store deletion | Purge cron, erasure, `customers/redact`, `shop/redact`, store purge |
| Consent events: exact wording, its hash, privacy link, form version, timestamps | Shoppers | Proof of consent | With the contact | As above |
| Suppression entries: SHA-256 of store id + email/phone, per channel | Shoppers who opted out | Never re-add someone who opted out | Kept after erasure (holds no address in clear) | Store purge |
| Restock alert subscribers (email) | Shoppers | One back-in-stock email | 7 days unconfirmed; 30 days after alert or opt-out | Purge cron |
| Analytics aggregates (counts per campaign per day), conversions (order id, total, currency, anonymous session id) | No person | Campaign performance | Until store deletion | Store purge |
| Event dedup ledger (event ids) | No person | Exactly-once counting | 3 days | Purge cron |
| Platform events (ids only; contact ids for consent events) | Pseudonymous | Module integration | 30 days delivered/pseudonymous, 90 days otherwise; contact erasure removes theirs | Purge cron, erasure |
| Integration tokens and provider keys (AES-GCM) | Merchants' accounts at Shopify, WooCommerce, BigCommerce, Klaviyo, Mailchimp | Catalog sync, list sync | Until disconnect/uninstall | Disconnect, uninstall, store purge |
| Storefront browser storage (with analytics consent): random visitor id, impression/dismissal counters, last click; feed read state | Shoppers' browsers | Frequency caps, attribution | Shopper's browser | The shopper |

The suppression hash is not keyed: a phone number (a small search space) could be recovered from it by brute force, so treat suppression entries as pseudonymous personal data, not anonymous. Moving to an HMAC under a secret key needs a migration of existing entries (tracked as a P2 in docs/production-launch-checklist.md).

No raw page-view events, IP addresses or user agents are stored. Rate limiting keeps IP-derived keys in Worker memory only.

## Sub-processors (to list in the DPA)
| Service | Data it receives | When |
|---|---|---|
| Cloudflare (Workers, D1, KV, Queues, Workers AI, AI Gateway) | Everything above (hosting) | Always |
| Resend | Merchant and shopper email addresses, message content | Account emails, signup confirmations, restock alerts |
| Twilio (Verify) | Shopper phone numbers, store name | SMS signup confirmation codes |
| Stripe | Merchant billing details | Card billing |
| Shopify | Order and product data (the merchant's own), billing | Shopify stores |
| Klaviyo, Mailchimp | Confirmed subscribers' email/phone, first name, consent time | Only if the merchant connects them |
| Cloudflare Turnstile | Bot-check signals | Signup, when configured |

AI models receive store context (products, campaign copy, aggregate metrics), never contact data.

## Shopper rights
- **Access**: the merchant opens the contact (consent history included) or exports subscribers; Shopify
  `customers/data_request` records which contacts match so the merchant can respond.
- **Erasure**: the merchant erases a contact (provider copies unsubscribed first); Shopify `customers/redact` does it
  automatically for a matching email or phone.
- **Opt-out**: email unsubscribe links (one-click), SMS STOP at the sending provider, merchant-recorded opt-outs.
- **Objection to analytics**: the SDK records nothing without consent (`window.ConvertFlow.consent` or Shopify's Customer
  Privacy API).

## Integration permissions
| Integration | Access requested | Why |
|---|---|---|
| Shopify | `read_products`, `read_inventory`, `read_orders` (read-only) | Catalog, availability, order webhooks (docs/shopify.md) |
| WooCommerce | A read-only REST key | Catalog sync from the store's own domain only |
| BigCommerce | API account with read-only Products | Catalog sync |
| Klaviyo | Private key with lists read and subscriptions write | Copy confirmed subscribers, remove opt-outs |
| Mailchimp | API key | Same, email only |
| Stripe | Operator's own account | Billing |

## Privacy policy: what it must say (checklist for counsel)
- Who the operator is, contact details, DPO if required, and the processor role toward merchants' shoppers.
- The data table and retention above; the sub-processor list; international transfers (Cloudflare edge, US providers).
- The storefront script: what it stores in the shopper's browser and that analytics need consent.
- SMS: that numbers are verified by a texted code through Twilio and copied to the merchant's SMS provider.
- How shoppers exercise rights (through the merchant) and how merchants reach the operator.
