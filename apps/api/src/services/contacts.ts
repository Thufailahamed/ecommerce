import { and, desc, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { CampaignConfig, SHIPPED_TOOLS } from "@convertflow/contracts";
import { schema } from "@convertflow/database";
import { b64url, newId, randomToken, sha256Hex } from "../lib/crypto.js";
import type { Deps } from "../deps.js";
import { emailEnabled, templates } from "./email.js";
import { onConfirmed, onRevoked, removeFromProviders, syncStatusFor } from "./providers.js";
import { entitlementsFor, quota, recordUsage } from "./entitlements.js";
import { ProviderError } from "@convertflow/integrations";
import { forgetContactEvents, publishDomainEvent } from "./domain-events.js";
import { identifierHash, isSuppressed } from "./suppression.js";

const { contacts, consentEvents, suppressionRecords, stores, campaigns, campaignVersions } = schema;

export type Channel = "email" | "sms";
export type ConsentStatus = (typeof schema.CONSENT_STATUSES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;
const enc = new TextEncoder();
/** A shopper who asks again within this window is not sent a second confirmation (stops the form being used to mail-bomb an address). */
export const OPT_IN_COOLDOWN_MS = 10 * 60_000;
export const CONFIRM_TTL_MS = 7 * 86_400_000;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** Strict E.164 only. Guessing a country for a national number would text the wrong person, so we never do. */
export function normalizePhone(raw: string): string | null {
  const p = raw.trim().replace(/[\s().-]/g, "");
  return E164_RE.test(p) ? p : null;
}

const normalize = (channel: Channel, raw: string) => (channel === "email" ? normalizeEmail(raw) : normalizePhone(raw));
const statusKey = (channel: Channel) => (channel === "email" ? "emailStatus" : "smsStatus") as "emailStatus" | "smsStatus";

export { identifierHash, isSuppressed };

/** A first name is for greeting someone, so keep letters, marks, spaces and the few punctuation marks real names use. */
export function normalizeFirstName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.normalize("NFC").replace(/[^\p{L}\p{M}' .-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return n.length > 0 ? n : null;
}

async function findContact(d: Deps, storeId: string, channel: Channel, value: string) {
  const col = channel === "email" ? contacts.email : contacts.phone;
  const [c] = await d.db.select().from(contacts).where(and(eq(contacts.storeId, storeId), eq(col, value))).limit(1);
  return c;
}

export interface OptInInput {
  channel: Channel;
  value: string;
  /** Where the shopper agreed, e.g. "form:<campaignId>". */
  source: string;
  /** The exact words the shopper saw next to the unticked checkbox. */
  consentText: string;
  privacyUrl?: string | undefined;
  /** The published form version the shopper used. Kept so the incentive they were promised is the one honoured on confirmation. */
  versionId?: string | undefined;
  firstName?: string | null | undefined;
}

/**
 * Records a request to subscribe and returns the one-time confirmation token to deliver, or null when nothing
 * should be sent: unusable input, a suppressed or already-subscribed identifier, or a request made moments ago.
 * Nothing here sends anything, and the contact stays "pending" (and unmessageable) until `confirmOptIn`.
 */
export async function requestOptIn(d: Deps, storeId: string, i: OptInInput): Promise<{ contactId: string; token: string } | null> {
  const value = normalize(i.channel, i.value);
  const text = i.consentText.trim();
  if (!value || text.length < 20 || text.length > 600) return null;
  if (await isSuppressed(d, storeId, i.channel, value)) return null;

  const key = statusKey(i.channel);
  const now = d.now().toISOString();
  let c = await findContact(d, storeId, i.channel, value);
  if (c && (c[key] === "subscribed" || c[key] === "unsubscribed")) return null;
  if (c && c[key] === "pending") {
    // The cooldown runs from the last request whose message actually went out: a request whose confirmation failed to send
    // is followed by a `delivery_failed` event, and the shopper may try again straight away.
    const [last] = await d.db.select({ createdAt: consentEvents.createdAt, event: consentEvents.event }).from(consentEvents)
      .where(and(eq(consentEvents.contactId, c.id), eq(consentEvents.channel, i.channel), inArray(consentEvents.event, ["requested", "delivery_failed"])))
      .orderBy(desc(consentEvents.createdAt), sql`rowid desc`).limit(1);
    if (last?.event === "requested" && d.now().getTime() - Date.parse(last.createdAt) < OPT_IN_COOLDOWN_MS) return null;
  }
  const firstName = normalizeFirstName(i.firstName);
  if (!c) {
    await d.db.insert(contacts).values({ id: newId("ctc"), storeId, email: i.channel === "email" ? value : null, phone: i.channel === "sms" ? value : null, firstName, source: i.source, createdAt: now, updatedAt: now }).onConflictDoNothing();
    c = await findContact(d, storeId, i.channel, value); // re-read: a concurrent request may have created it first
    if (!c) return null;
  } else if (firstName && firstName !== c.firstName) {
    await d.db.update(contacts).set({ firstName }).where(eq(contacts.id, c.id)); // a pending contact asking again may correct their name
  }

  const token = randomToken(24);
  await d.db.insert(consentEvents).values({
    id: newId("cev"), storeId, contactId: c.id, channel: i.channel, event: "requested", source: i.source, versionId: i.versionId ?? null,
    consentText: text, consentTextHash: await sha256Hex(text), privacyUrl: i.privacyUrl ?? null, tokenHash: await sha256Hex(token), createdAt: now,
  });
  await d.db.update(contacts).set({ [key]: "pending", updatedAt: now }).where(eq(contacts.id, c.id));
  return { contactId: c.id, token };
}

/** Records that the confirmation message for the latest request could not be sent, so that request does not count toward the cooldown. */
export async function markDeliveryFailed(d: Deps, storeId: string, contactId: string, channel: Channel, source: string): Promise<void> {
  await d.db.insert(consentEvents).values({ id: newId("cev"), storeId, contactId, channel, event: "delivery_failed", source, createdAt: d.now().toISOString() });
}

export interface Incentive { code: string; percentOff: number; label?: string | undefined }
export interface Confirmed { contactId: string; storeId: string; channel: Channel; incentive?: Incentive | undefined }

/**
 * The discount the shopper was promised: the one in the form version they used, shown only now that they have confirmed.
 * It must still be allowed (the store has promotions on and the percentage is within its ceiling today), so a merchant
 * who lowers the ceiling never has an old form hand out more than the store now permits.
 */
async function incentiveFor(d: Deps, storeId: string, versionId: string | null): Promise<Incentive | undefined> {
  if (!versionId) return undefined;
  const [v] = await d.db.select({ config: campaignVersions.config }).from(campaignVersions).where(and(eq(campaignVersions.id, versionId), eq(campaignVersions.storeId, storeId))).limit(1);
  const cfg = v ? CampaignConfig.safeParse(v.config) : undefined;
  const promo = cfg?.success ? cfg.data.promotion : undefined;
  if (!promo) return undefined;
  const [s] = await d.db.select({ max: stores.maxDiscountPercent }).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (s?.max === null || s?.max === undefined || promo.percentOff > s.max) return undefined;
  return { code: promo.code, percentOff: promo.percentOff, label: promo.label };
}

/** Single use: only a pending contact can be confirmed, so a repeated or stale link does nothing. */
export async function confirmOptIn(d: Deps, token: string): Promise<Confirmed | null> {
  if (!token) return null;
  const [req] = await d.db.select().from(consentEvents).where(and(eq(consentEvents.tokenHash, await sha256Hex(token)), eq(consentEvents.event, "requested"))).limit(1);
  if (!req || Date.parse(req.createdAt) + CONFIRM_TTL_MS < d.now().getTime()) return null;
  return confirmRequest(d, req);
}

/**
 * Turns one recorded request into a subscription, whatever proved it (an emailed link, a texted code). The contact must
 * still be pending and not suppressed, and the claim is atomic, so two confirmations of the same request count once.
 */
async function confirmRequest(d: Deps, req: typeof consentEvents.$inferSelect): Promise<Confirmed | null> {
  const [c] = await d.db.select().from(contacts).where(eq(contacts.id, req.contactId)).limit(1);
  const value = c && (req.channel === "email" ? c.email : c.phone);
  if (!c || !value || await isSuppressed(d, c.storeId, req.channel, value)) return null;

  const key = statusKey(req.channel);
  const now = d.now().toISOString();
  const claimed = await d.db.update(contacts).set({ [key]: "subscribed", updatedAt: now }).where(and(eq(contacts.id, c.id), eq(contacts[key], "pending"))).returning({ id: contacts.id });
  if (!claimed[0]) return null;
  const confirmedId = newId("cev");
  await d.db.insert(consentEvents).values({ id: confirmedId, storeId: c.storeId, contactId: c.id, channel: req.channel, event: "confirmed", source: req.source, versionId: req.versionId, createdAt: now });
  await onConfirmed(d, c.storeId, c.id, req.channel); // queue the copy to the merchant's list provider(s); never blocks or fails the confirmation
  await publishDomainEvent(d, { type: "customer.subscribed", payload: { contactId: c.id, channel: req.channel }, idempotencyKey: `consent:${confirmedId}`, storeId: c.storeId, source: "storefront" });
  return { contactId: c.id, storeId: c.storeId, channel: req.channel, incentive: await incentiveFor(d, c.storeId, req.versionId) };
}

/** After a confirmation: email the shopper the code they signed up for, so they keep it after closing the page. Best effort. */
export async function sendIncentive(d: Deps, confirmed: Confirmed): Promise<void> {
  if (!confirmed.incentive || confirmed.channel !== "email" || !d.email || !d.secrets?.apiOrigin) return;
  try {
    const [c] = await d.db.select({ email: contacts.email, name: contacts.firstName }).from(contacts).where(eq(contacts.id, confirmed.contactId)).limit(1);
    const [store] = await d.db.select({ name: stores.name }).from(stores).where(eq(stores.id, confirmed.storeId)).limit(1);
    const unsub = await unsubscribeToken(d, confirmed.contactId, "email");
    if (!c?.email || !store || !unsub) return;
    await d.email.send(templates.contactIncentive(c.email, store.name, confirmed.incentive, c.name, `${d.secrets.apiOrigin}/api/v1/notifications/subscribe/unsubscribe?token=${encodeURIComponent(unsub)}`));
  } catch (e) { console.error(JSON.stringify({ level: "error", where: "contact_incentive_email", message: e instanceof Error ? e.message : "send failed" })); }
}

/**
 * Opts an identifier out and suppresses it. Works whether or not a contact exists, so any flow (unsubscribe link,
 * bounce, restock opt-out) can call it. Idempotent.
 */
export async function revokeConsent(d: Deps, storeId: string, channel: Channel, rawValue: string, source: string): Promise<void> {
  const value = normalize(channel, rawValue);
  if (!value) return;
  const now = d.now().toISOString();
  await d.db.insert(suppressionRecords).values({ id: newId("sup"), storeId, emailHash: await identifierHash(storeId, value), channel, reason: "unsubscribed", createdAt: now }).onConflictDoNothing();
  const c = await findContact(d, storeId, channel, value);
  const key = statusKey(channel);
  if (!c || c[key] === "unsubscribed") return;
  await d.db.update(contacts).set({ [key]: "unsubscribed", updatedAt: now }).where(eq(contacts.id, c.id));
  const revokedId = newId("cev");
  await d.db.insert(consentEvents).values({ id: revokedId, storeId, contactId: c.id, channel, event: "revoked", source, createdAt: now });
  await onRevoked(d, storeId, c.id, channel); // take them off the merchant's list provider(s) too
  await publishDomainEvent(d, { type: "customer.unsubscribed", payload: { contactId: c.id, channel }, idempotencyKey: `consent:${revokedId}`, storeId, source: "storefront" });
}

/* ---------- signed unsubscribe links ---------- */

async function sign(d: Deps, message: string): Promise<string | null> {
  const k = d.secrets?.credentialKey;
  if (!k) return null;
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(k), (ch) => ch.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))));
}

/** "<contactId>.<channel>.<HMAC>". Rebuildable for any later message, nothing sensitive stored. */
export async function unsubscribeToken(d: Deps, contactId: string, channel: Channel): Promise<string | null> {
  const sig = await sign(d, `contact-unsub:${contactId}:${channel}`);
  return sig ? `${contactId}.${channel}.${sig}` : null;
}

export async function unsubscribeByToken(d: Deps, token: string): Promise<boolean> {
  const [id, channel] = token.split(".");
  if (!id || (channel !== "email" && channel !== "sms")) return false;
  const want = await unsubscribeToken(d, id, channel);
  // constant-time compare of equal-length strings
  if (!want || want.length !== token.length || [...want].reduce((a, ch, n) => a | (ch.charCodeAt(0) ^ token.charCodeAt(n)), 0) !== 0) return false;
  const [c] = await d.db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  const value = c && (channel === "email" ? c.email : c.phone);
  if (!c || !value) return false;
  await revokeConsent(d, c.storeId, channel, value, "unsubscribe_link");
  return true;
}

/* ---------- public email sign-up ---------- */

/**
 * Email sign-up needs the tool to be shipped, email delivery, the signing key (for unsubscribe links) and the API
 * origin (for the links themselves). Until the email tool ships nothing is collected.
 */
export const contactCaptureAvailable = (d: Deps): boolean =>
  SHIPPED_TOOLS.has("email") && emailEnabled(d) && Boolean(d.secrets?.credentialKey) && Boolean(d.secrets?.apiOrigin);

/**
 * Public and unauthenticated. The caller answers identically whatever happens here (no signal about plans,
 * suppression or existing subscriptions). Double opt-in: only the confirmation email is sent until the shopper confirms.
 */
export async function subscribeEmail(d: Deps, input: { siteKey: string; campaignId: string; email: string; firstName?: string | undefined }): Promise<void> {
  if (!contactCaptureAvailable(d)) return;
  const [store] = await d.db.select().from(stores).where(eq(stores.siteKey, input.siteKey)).limit(1);
  if (!store || store.status !== "active") return;
  if (!(await entitlementsFor(d, store.organizationId)).has("tools.email")) return;

  // The words the shopper agreed to come from the form that is live right now, never from the request: a caller
  // cannot claim consent to something the form did not say.
  const [camp] = await d.db.select().from(campaigns).where(and(eq(campaigns.id, input.campaignId), eq(campaigns.storeId, store.id))).limit(1);
  if (!camp || camp.status !== "active" || camp.tool !== "email" || !camp.publishedVersionId) return;
  const [version] = await d.db.select().from(campaignVersions).where(eq(campaignVersions.id, camp.publishedVersionId)).limit(1);
  const cfg = version ? CampaignConfig.safeParse(version.config) : undefined;
  const form = cfg?.success ? cfg.data.form : undefined;
  if (!form?.collect.email) return;

  const source = `form:${camp.id}`;
  // A name is kept only when the published form actually asks for one: the request cannot add a field the form does not have.
  const r = await requestOptIn(d, store.id, { channel: "email", value: input.email, source, consentText: form.consentText, privacyUrl: form.privacyUrl, versionId: camp.publishedVersionId, firstName: form.collect.firstName ? input.firstName : undefined });
  if (!r) return;
  const email = normalizeEmail(input.email)!; // requestOptIn returned a token, so this is valid
  const consentText = form.consentText;
  const origin = d.secrets!.apiOrigin!;
  const link = (path: string, token: string) => `${origin}${path}?token=${encodeURIComponent(token)}`;
  try {
    const unsub = link("/api/v1/notifications/subscribe/unsubscribe", (await unsubscribeToken(d, r.contactId, "email"))!);
    await d.email!.send(templates.contactConfirm(email, link("/api/v1/notifications/subscribe/confirm", r.token), store.name, consentText.trim(), unsub));
  } catch (e) {
    console.error(JSON.stringify({ level: "error", where: "contact_confirm_email", message: e instanceof Error ? e.message : "send failed" }));
    // Nothing reached the shopper, so this request must not hold them in the cooldown.
    await markDeliveryFailed(d, store.id, r.contactId, "email", source).catch(() => undefined);
  }
}

/* ---------- public SMS sign-up (verified by a texted one-time code) ---------- */

/** How long after a code was requested it can be entered. Twilio Verify codes last 10 minutes; this only bounds our own lookup. */
export const SMS_CONFIRM_WINDOW_MS = 30 * 60_000;

/** SMS sign-up needs the tool to be shipped, a phone verifier and the signing key (consent proof and erasure use it). */
export const smsCaptureAvailable = (d: Deps): boolean => SHIPPED_TOOLS.has("sms") && Boolean(d.phoneVerifier) && Boolean(d.secrets?.credentialKey);

/** The live SMS form a request names, or nothing: the browser can name a campaign but never what its form says. */
async function liveSmsForm(d: Deps, siteKey: string, campaignId: string) {
  const [store] = await d.db.select().from(stores).where(eq(stores.siteKey, siteKey)).limit(1);
  if (!store || store.status !== "active") return undefined;
  if (!(await entitlementsFor(d, store.organizationId)).has("tools.sms")) return undefined;
  const [camp] = await d.db.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.storeId, store.id))).limit(1);
  if (!camp || camp.status !== "active" || camp.tool !== "sms" || !camp.publishedVersionId) return undefined;
  const [version] = await d.db.select().from(campaignVersions).where(eq(campaignVersions.id, camp.publishedVersionId)).limit(1);
  const cfg = version ? CampaignConfig.safeParse(version.config) : undefined;
  const form = cfg?.success ? cfg.data.form : undefined;
  if (!form?.collect.phone) return undefined;
  return { store, camp, form, versionId: camp.publishedVersionId, source: `form:${camp.id}` };
}

/**
 * "sent": a code is on its way. "skipped": nothing was sent (not collecting, suppressed, already subscribed, asked moments
 * ago, or the month's verification allowance is used up); the caller answers exactly as for "sent". "undeliverable": the
 * provider will not text this number (a landline, an invalid number), which says nothing about our data and lets the
 * shopper correct it.
 */
export type SmsStartResult = "sent" | "skipped" | "undeliverable";

/** Public and unauthenticated. Records the request with the exact consent wording of the live form, then texts a code. */
export async function startSmsSignup(d: Deps, input: { siteKey: string; campaignId: string; phone: string; firstName?: string | undefined }): Promise<SmsStartResult> {
  if (!smsCaptureAvailable(d)) return "skipped";
  const live = await liveSmsForm(d, input.siteKey, input.campaignId);
  if (!live) return "skipped";
  const phone = normalizePhone(input.phone);
  if (!phone) return "undeliverable";
  // Each code costs the platform a verification fee, so the month's allowance is checked before anything is recorded or sent.
  if ((await quota(d, live.store.organizationId, "sms_verifications")).remaining <= 0) return "skipped";
  const r = await requestOptIn(d, live.store.id, { channel: "sms", value: phone, source: live.source, consentText: live.form.consentText, privacyUrl: live.form.privacyUrl, versionId: live.versionId, firstName: live.form.collect.firstName ? input.firstName : undefined });
  if (!r) return "skipped";
  try {
    await d.phoneVerifier!.start(phone, { friendlyName: live.store.name });
    await recordUsage(d, live.store.organizationId, "sms_verifications");
    return "sent";
  } catch (e) {
    console.error(JSON.stringify({ level: "error", where: "sms_verification_start", kind: e instanceof ProviderError ? e.kind : "unexpected", message: e instanceof Error ? e.message : "send failed" }));
    // Nothing reached the shopper, so this request must not hold them in the cooldown.
    await markDeliveryFailed(d, live.store.id, r.contactId, "sms", live.source).catch(() => undefined);
    return e instanceof ProviderError && e.kind === "rejected" ? "undeliverable" : "skipped";
  }
}

/**
 * The shopper typed the code back into the form. Only a request made from this same live form, still pending and recent,
 * can be confirmed, and only when the provider agrees the code is right. Returns null for every way of not confirming.
 */
export async function confirmSmsSignup(d: Deps, input: { siteKey: string; campaignId: string; phone: string; code: string }): Promise<Confirmed | null> {
  if (!smsCaptureAvailable(d) || !/^\d{4,10}$/.test(input.code)) return null;
  const live = await liveSmsForm(d, input.siteKey, input.campaignId);
  const phone = normalizePhone(input.phone);
  if (!live || !phone) return null;
  const c = await findContact(d, live.store.id, "sms", phone);
  if (!c || c.smsStatus !== "pending") return null;
  const [req] = await d.db.select().from(consentEvents)
    .where(and(eq(consentEvents.contactId, c.id), eq(consentEvents.channel, "sms"), eq(consentEvents.event, "requested"), eq(consentEvents.source, live.source)))
    .orderBy(desc(consentEvents.createdAt), sql`rowid desc`).limit(1);
  if (!req || Date.parse(req.createdAt) + SMS_CONFIRM_WINDOW_MS < d.now().getTime()) return null;
  let approved: boolean;
  try { approved = await d.phoneVerifier!.check(phone, input.code); }
  catch (e) {
    console.error(JSON.stringify({ level: "error", where: "sms_verification_check", kind: e instanceof ProviderError ? e.kind : "unexpected" }));
    throw e;
  }
  return approved ? confirmRequest(d, req) : null;
}

/** A merchant records an opt-out they received another way (a STOP reply at their SMS provider, a support request). */
export async function optOutContact(d: Deps, storeId: string, contactId: string, channel: Channel): Promise<boolean> {
  const [c] = await d.db.select().from(contacts).where(and(eq(contacts.storeId, storeId), eq(contacts.id, contactId))).limit(1);
  const value = c && (channel === "email" ? c.email : c.phone);
  if (!c || !value) return false;
  await revokeConsent(d, storeId, channel, value, "merchant");
  return true;
}

/* ---------- merchant-facing reads and erasure ---------- */

const PAGE_MAX = 100;

export interface ContactFilter { limit?: number | undefined; cursor?: string | undefined; email?: string | undefined; phone?: string | undefined; channel?: Channel | undefined; status?: ConsentStatus | undefined }

/** Newest first. Cursor is "<createdAt>|<id>" from the previous page's `nextCursor`. */
export async function listContacts(d: Deps, storeId: string, f: ContactFilter = {}) {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), PAGE_MAX);
  const where = [eq(contacts.storeId, storeId)];
  if (f.email) where.push(eq(contacts.email, f.email.trim().toLowerCase()));
  if (f.phone) where.push(eq(contacts.phone, f.phone.replace(/[\s().-]/g, "")));
  if (f.status) where.push(eq(contacts[statusKey(f.channel ?? "email")], f.status));
  else if (f.channel) where.push(isNotNull(f.channel === "email" ? contacts.email : contacts.phone)); // everyone reachable on that channel, whatever their status
  if (f.cursor) {
    const [at, id] = f.cursor.split("|");
    if (at && id) where.push(or(lt(contacts.createdAt, at), and(eq(contacts.createdAt, at), lt(contacts.id, id)))!);
  }
  const rows = await d.db.select({
    id: contacts.id, email: contacts.email, phone: contacts.phone, firstName: contacts.firstName, emailStatus: contacts.emailStatus, smsStatus: contacts.smsStatus, source: contacts.source, createdAt: contacts.createdAt,
  }).from(contacts).where(and(...where)).orderBy(desc(contacts.createdAt), desc(contacts.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const sync = await syncStatusFor(d, storeId, page.map((r) => r.id));
  return { data: page.map((r) => ({ ...r, sync: sync.get(r.id) ?? [] })), nextCursor: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null };
}

export const EXPORT_MAX = 50_000;
/** A cell that starts with = + - @ is run as a formula by spreadsheets, and an email address may legally start with any of them. */
const csvCell = (v: string): string => {
  // A validated E.164 number ("+" then digits) cannot form a formula, and an apostrophe would corrupt every row for an SMS importer.
  const s = /^[=+\-@\t\r]/.test(v) && !E164_RE.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Everyone currently subscribed on one channel, as CSV: the merchant's way to use the list in their own sending tool.
 * Pending and unsubscribed contacts are never included. SMS rows hold the E.164 number. `subscribed_at` is when they confirmed (a subscribed
 * contact's last change is its confirmation).
 */
export async function exportSubscribers(d: Deps, storeId: string, channel: Channel = "email"): Promise<{ csv: string; truncated: boolean }> {
  const id = channel === "email" ? contacts.email : contacts.phone;
  const rows = await d.db.select({ id, firstName: contacts.firstName, source: contacts.source, subscribedAt: contacts.updatedAt })
    .from(contacts).where(and(eq(contacts.storeId, storeId), eq(contacts[statusKey(channel)], "subscribed"))).orderBy(contacts.createdAt, sql`rowid`).limit(EXPORT_MAX + 1); // rowid = insertion order, so contacts created in the same instant keep a stable order
  const page = rows.slice(0, EXPORT_MAX);
  const lines = [`${channel === "email" ? "email" : "phone"},first_name,subscribed_at,source`, ...page.map((r) => [r.id ?? "", r.firstName ?? "", r.subscribedAt, r.source].map(csvCell).join(","))];
  return { csv: lines.join("\r\n") + "\r\n", truncated: rows.length > EXPORT_MAX };
}

/** The contact with its full consent history: what they saw, when they asked, when they confirmed or opted out. */
export async function getContact(d: Deps, storeId: string, contactId: string) {
  const [c] = await d.db.select().from(contacts).where(and(eq(contacts.storeId, storeId), eq(contacts.id, contactId))).limit(1);
  if (!c) return null;
  const events = await d.db.select({
    id: consentEvents.id, channel: consentEvents.channel, event: consentEvents.event, source: consentEvents.source,
    consentText: consentEvents.consentText, consentTextHash: consentEvents.consentTextHash, privacyUrl: consentEvents.privacyUrl, createdAt: consentEvents.createdAt,
  }).from(consentEvents).where(eq(consentEvents.contactId, c.id)).orderBy(consentEvents.createdAt, sql`rowid`); // rowid = insertion order, so events in the same instant keep their real sequence
  const sync = (await syncStatusFor(d, storeId, [c.id])).get(c.id) ?? [];
  return { id: c.id, email: c.email, phone: c.phone, firstName: c.firstName, emailStatus: c.emailStatus, smsStatus: c.smsStatus, source: c.source, createdAt: c.createdAt, sync, consentEvents: events };
}

/**
 * Erasure: the contact and its consent history are deleted. An opt-out's hashed suppression entry deliberately
 * survives (it holds no address) so an erased person who had unsubscribed cannot be re-added by mistake.
 * Their copy at each list provider is removed first. The local erasure always goes ahead; a provider that could not be
 * reached is reported back (and audited, by provider name only) so the merchant can remove that copy themselves.
 */
export async function eraseContact(d: Deps, storeId: string, contactId: string): Promise<{ erased: boolean; providerFailures: string[] }> {
  const [c] = await d.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.storeId, storeId), eq(contacts.id, contactId))).limit(1);
  if (!c) return { erased: false, providerFailures: [] };
  const providerFailures = await removeFromProviders(d, storeId, contactId);
  const r = await d.db.delete(contacts).where(and(eq(contacts.storeId, storeId), eq(contacts.id, contactId))).returning({ id: contacts.id });
  await forgetContactEvents(d, storeId, contactId);
  return { erased: r.length > 0, providerFailures };
}

/**
 * Data minimisation. Contacts that never confirmed are dropped after 7 days; anyone not currently subscribed is dropped
 * after 30. The hashed suppression entries remain, so an unsubscribed person still cannot be re-subscribed.
 */
export async function purgeContacts(d: Deps): Promise<number> {
  const ago = (days: number) => new Date(d.now().getTime() - days * 86_400_000).toISOString();
  const unconfirmed = ["none", "pending"] as const;
  let n = 0;
  for (const cond of [
    and(inArray(contacts.emailStatus, unconfirmed), inArray(contacts.smsStatus, unconfirmed), lt(contacts.updatedAt, ago(7))),
    and(ne(contacts.emailStatus, "subscribed"), ne(contacts.smsStatus, "subscribed"), lt(contacts.updatedAt, ago(30))),
  ]) n += (await d.db.delete(contacts).where(cond).returning({ id: contacts.id })).length;
  return n;
}
