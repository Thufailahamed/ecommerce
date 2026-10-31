# SMS signup (NotiSMS → `sms` tool)

**Status: shipped in the code, tested end to end against mocks (API `test/sms.test.ts`, SDK `src/sms.test.ts`, web
`test/sms-editor.test.tsx`, browser `tests/e2e/sms.spec.ts`). Never run against real Twilio or Klaviyo SMS**: no accounts.

## Flow
1. The merchant builds an SMS form (popup, slide-in, bar or inline) on Growth or Scale. The contract only accepts a form
   that collects a phone number and no email, always verifies the number, and whose consent wording contains the opt-out
   keyword **STOP**. The editor starts from a template that also states frequency, rates, HELP and that consent is not a
   condition of purchase; it warns if "rates" is missing and always asks for legal review.
2. Publishing needs a phone verifier on the deployment (`sms_unavailable` otherwise) and the plan's `tools.sms`.
3. The shopper picks a country (the form's default is preselected), types the number and ticks the unticked consent box.
   The SDK turns it into E.164 (dropping a national leading 0, or taking a `+`/`00` number as international); the server
   re-validates strictly and never guesses a country.
4. `POST /api/v1/notifications/sms/subscribe` records the request with the **live form's** consent wording (hash, text,
   privacy link, form version), then Twilio Verify texts a one-time code in the store's name. The answer is the same
   whatever happened (already subscribed, suppressed, not collecting, quota used up), except `phone_undeliverable` for a
   number Twilio will not text, which says nothing about our data and lets the shopper fix a typo.
5. `POST /api/v1/notifications/sms/confirm` with the code: only a pending request from the same live form, within 30
   minutes, and only when Twilio approves the code. Then the contact is `subscribed`, a `confirmed` consent event is
   written, `customer.subscribed` is published, and the number is queued to Klaviyo with **SMS** consent.
6. The form shows its success message, and only now the form's incentive code, if it has one.

## Opt-out, suppression, erasure
- This app sends **no marketing texts**. The sending service (Klaviyo) handles STOP replies for the messages it sends.
- An opt-out received elsewhere is recorded on Subscribers (SMS tab → *Opt out*, `POST /contacts/:id/opt-out`): the
  contact becomes unsubscribed, a hashed suppression entry is kept, the Klaviyo copy is unsubscribed **on the SMS channel
  only**, and the form will never text that number again (tested end to end).
- Erasure removes the contact and consent history after unsubscribing the Klaviyo copy. Shopify `customers/redact` does
  the same for a matching phone.
- Retention: never-confirmed numbers are deleted after 7 days; anyone not subscribed after 30 (`purgeContacts`).

## Abuse and cost controls
- Each code costs the operator a Twilio Verify fee, so codes are metered (`sms_verifications`: Growth 500, Scale 5,000 a
  month) and checked **before** anything is sent. A number is texted at most once per 10 minutes (the opt-in cooldown);
  a failed send does not start the cooldown. Twilio caps sends and checks per number as well.
- Rate limits: 10 subscribe requests per site and address per minute; 10 code checks per site and address and 10 per
  number per minute (per isolate: add Cloudflare rate-limiting rules on `/api/v1/notifications/*`).
- No phone number is written to logs or to the analytics pipeline; Twilio's error messages (which can echo the number) are
  reduced to their numeric code.

## Configuration
| Name | Kind | Purpose |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | var | Twilio account |
| `TWILIO_AUTH_TOKEN` | secret | Twilio auth (an API key secret also works as Basic auth) |
| `TWILIO_VERIFY_SERVICE_SID` | var | A Verify service; set its code length to 6 and enable custom friendly names |
| `TWILIO_VERIFY_BASE_URL` | var, optional | A mock for end-to-end runs only. Never set it in production |
| `CREDENTIAL_KEY` | secret | Required (consent proof and erasure use it) |

Klaviyo SMS needs SMS enabled on the merchant's Klaviyo account with a sending number in the shopper's country; Klaviyo
may text its own confirmation depending on the account's settings. Mailchimp is email-only here.

## Compliance: what the code does and what it cannot do
The code records explicit, unticked-box consent with the exact wording and form version, verifies number ownership,
honours opt-outs and suppression, and refuses consent text without an opt-out instruction. It **cannot** make an
SMS program compliant on its own: TCPA/CTIA (US), CASL (Canada), PECR/GDPR (UK/EU) and carrier rules depend on the
wording, quiet hours, frequency and sending practices of the merchant and their SMS provider. The merchant's counsel must
review the consent text for each country they sell into. Nothing in the product claims compliance.

## Verification still needed (blocked: accounts)
1. Twilio Verify: a real code arrives with the store's name (custom friendly names must be enabled on the service);
   a wrong code, an expired code and a landline behave as tested.
2. Klaviyo SMS: a verified number appears with SMS consent and the consent time; an opt-out here removes SMS consent
   there without touching email consent. Klaviyo's handling of `consented_at` for SMS is the least certain part.
