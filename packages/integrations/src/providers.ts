/**
 * List providers: where a merchant's confirmed subscribers are copied to (Klaviyo for email and SMS, Mailchimp for email).
 * Everything here is behind one interface so the sync service never knows which provider it is talking to, and so a
 * recording fake can stand in for tests.
 *
 * VERIFICATION STATUS: the Klaviyo and Mailchimp adapters follow those vendors' documented public REST APIs, but they have
 * NEVER been run against the real services (no accounts). They are tested against recorded request shapes and a fake.
 * Nothing in the product may claim they work until a real connection check has passed (see `live` and the dashboard label).
 */

export type ProviderKey = "klaviyo" | "mailchimp";
export type ProviderChannel = "email" | "sms";

export interface ProviderCredentials { apiKey: string }
export interface ProviderList { id: string; name: string }

/** What a provider is told about one person. Only what the shopper gave plus when and where they agreed. */
export interface ProviderContact {
  channel: ProviderChannel;
  email?: string | undefined;
  phone?: string | undefined;
  firstName?: string | undefined;
  /** ISO time the shopper confirmed their consent. */
  consentedAt: string;
  /** Where they agreed, e.g. "form:<campaignId>". Sent as the provider's "source" so the merchant can see it. */
  source: string;
}

/**
 * `auth`: the key is wrong, revoked or lacks a scope. `rate_limited`: slow down (retryAfterMs when the provider says).
 * `transient`: a network or server error; retry later. `rejected`: the provider refused this request for good.
 */
export type ProviderErrorKind = "auth" | "rate_limited" | "transient" | "rejected";

export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string, readonly retryAfterMs?: number) { super(message); }
}

export interface ProviderAdapter {
  readonly key: ProviderKey;
  readonly channels: readonly ProviderChannel[];
  /** True only when requests go to the provider's real API. A staging or mock origin is never "live", so it can never count as verified. */
  readonly live: boolean;
  /** Proves the key works and returns the lists it can see. Throws ProviderError. */
  checkConnection(): Promise<ProviderList[]>;
  /** Idempotent: subscribing someone already on the list is not an error. Returns the provider's own id for the person when it gives one. */
  subscribe(listId: string, c: ProviderContact): Promise<{ ref?: string }>;
  /** Idempotent: removing someone who is not on the list is not an error. */
  unsubscribe(listId: string, c: ProviderContact): Promise<void>;
}

export interface AdapterOptions {
  fetchFn?: typeof fetch;
  /** Replaces the provider's origin (staging, or a local mock in tests). */
  baseUrl?: string;
}

/* ---------- shared HTTP ---------- */

const MAX_RETRY_AFTER_MS = 6 * 3_600_000;

/** Retry-After is seconds or an HTTP date. A wild value is capped so one response cannot park a job for days. */
function retryAfter(h: string | null, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(h) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : undefined;
}

/**
 * One request, with every failure turned into a ProviderError. Messages carry the status and the provider's short error
 * code or title only: the response body is never copied, because providers echo the address back in error details.
 */
async function request(fetchFn: typeof fetch, url: string, init: RequestInit, shortError: (body: unknown) => string | undefined): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try { res = await fetchFn(url, init); } catch { throw new ProviderError("transient", "Could not reach the provider"); }
  const text = await res.text().catch(() => "");
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (res.ok) return { status: res.status, json };
  const why = shortError(json);
  const msg = `HTTP ${res.status}${why ? `: ${why}` : ""}`;
  if (res.status === 401 || res.status === 403) throw new ProviderError("auth", msg);
  if (res.status === 429) throw new ProviderError("rate_limited", msg, retryAfter(res.headers.get("retry-after")));
  if (res.status === 408 || res.status >= 500) throw new ProviderError("transient", msg, retryAfter(res.headers.get("retry-after")));
  throw new ProviderError("rejected", msg);
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const short = (v: unknown): string | undefined => (typeof v === "string" && /^[\w .:-]{1,60}$/.test(v) ? v : undefined);

/* ---------- Klaviyo (UNVERIFIED against the live service) ---------- */

export const KLAVIYO_ORIGIN = "https://a.klaviyo.com";
/** Klaviyo versions its API by date header. Pinned so a vendor change cannot alter behaviour under us. */
export const KLAVIYO_REVISION = "2024-10-15";

/** The identifier Klaviyo keys a profile on for this channel. */
const klaviyoIdentity = (c: ProviderContact): Record<string, string> | undefined =>
  c.channel === "email" ? (c.email ? { email: c.email } : undefined) : c.phone ? { phone_number: c.phone } : undefined;

class Klaviyo implements ProviderAdapter {
  readonly key = "klaviyo" as const;
  readonly channels = ["email", "sms"] as const;
  readonly live: boolean;
  private readonly origin: string;
  private readonly fetchFn: typeof fetch;
  constructor(private readonly creds: ProviderCredentials, o: AdapterOptions) {
    this.origin = (o.baseUrl ?? KLAVIYO_ORIGIN).replace(/\/+$/, "");
    this.live = o.baseUrl === undefined;
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a)); // never call fetch as a method of this object: Workers throws "Illegal invocation"
  }
  private call(method: string, pathOrUrl: string, body?: unknown) {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.origin}${pathOrUrl}`;
    return request(this.fetchFn, url, {
      method,
      headers: { authorization: `Klaviyo-API-Key ${this.creds.apiKey}`, revision: KLAVIYO_REVISION, accept: "application/vnd.api+json", ...(body ? { "content-type": "application/vnd.api+json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, (j) => short(rec(rec(j)["errors"] instanceof Array ? (rec(j)["errors"] as unknown[])[0] : undefined)["code"]));
  }

  async checkConnection(): Promise<ProviderList[]> {
    const lists: ProviderList[] = [];
    let next: string | undefined = "/api/lists?fields[list]=name";
    for (let page = 0; next && page < 10; page++) {
      const { json } = await this.call("GET", next);
      for (const item of (rec(json)["data"] as unknown[] | undefined) ?? []) {
        const i = rec(item); const name = rec(i["attributes"])["name"];
        if (typeof i["id"] === "string" && typeof name === "string") lists.push({ id: i["id"], name });
      }
      const link = rec(rec(json)["links"])["next"];
      // Only ever follow a link back to the same origin: a key must not be sent anywhere a response points it.
      next = typeof link === "string" && link.startsWith(this.origin) ? link : undefined;
    }
    return lists;
  }

  async subscribe(listId: string, c: ProviderContact): Promise<{ ref?: string }> {
    const who = klaviyoIdentity(c);
    if (!who) throw new ProviderError("rejected", c.channel === "email" ? "An email subscriber needs an address" : "An SMS subscriber needs a phone number");
    let ref: string | undefined;
    // A first name is a profile attribute, not a subscription one, so it goes in as a profile upsert first.
    if (c.firstName) {
      const { json } = await this.call("POST", "/api/profile-import/", { data: { type: "profile", attributes: { ...who, first_name: c.firstName } } });
      const id = rec(rec(json)["data"])["id"];
      if (typeof id === "string") ref = id;
    }
    // SMS consent is its own channel at Klaviyo: subscribing a number by SMS says nothing about email, and the reverse.
    const consent = { marketing: { consent: "SUBSCRIBED", consented_at: c.consentedAt } };
    await this.call("POST", "/api/profile-subscription-bulk-create-jobs/", {
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          custom_source: c.source.slice(0, 100),
          profiles: { data: [{ type: "profile", attributes: { ...who, subscriptions: c.channel === "email" ? { email: consent } : { sms: consent } } }] },
        },
        relationships: { list: { data: { type: "list", id: listId } } },
      },
    });
    return ref ? { ref } : {};
  }

  async unsubscribe(listId: string, c: ProviderContact): Promise<void> {
    const who = klaviyoIdentity(c);
    if (!who) throw new ProviderError("rejected", c.channel === "email" ? "An email subscriber needs an address" : "An SMS subscriber needs a phone number");
    // An SMS opt-out names the channel, so a shopper who stops texts keeps whatever email consent they gave separately.
    const attributes = c.channel === "sms" ? { ...who, subscriptions: { sms: { marketing: { consent: "UNSUBSCRIBED" } } } } : who;
    await this.call("POST", "/api/profile-subscription-bulk-delete-jobs/", {
      data: {
        type: "profile-subscription-bulk-delete-job",
        attributes: { profiles: { data: [{ type: "profile", attributes }] } },
        relationships: { list: { data: { type: "list", id: listId } } },
      },
    });
  }
}

/* ---------- Mailchimp (UNVERIFIED against the live service) ---------- */

/** A Mailchimp API key ends in the data centre that holds the account, e.g. "...-us21". */
export const mailchimpDataCentre = (apiKey: string): string | undefined => /-([a-z]{2,3}\d{1,3})$/.exec(apiKey)?.[1];

class Mailchimp implements ProviderAdapter {
  readonly key = "mailchimp" as const;
  readonly channels = ["email"] as const;
  readonly live: boolean;
  private readonly origin: string | undefined;
  private readonly fetchFn: typeof fetch;
  constructor(private readonly creds: ProviderCredentials, o: AdapterOptions) {
    const dc = mailchimpDataCentre(creds.apiKey);
    this.origin = o.baseUrl ? o.baseUrl.replace(/\/+$/, "") : dc ? `https://${dc}.api.mailchimp.com` : undefined;
    this.live = o.baseUrl === undefined;
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
  }
  private call(method: string, path: string, body?: unknown) {
    if (!this.origin) throw new ProviderError("auth", "That does not look like a Mailchimp API key (it should end in a data centre such as -us21)");
    return request(this.fetchFn, `${this.origin}/3.0${path}`, {
      method,
      headers: { authorization: `Basic ${btoa(`convertflow:${this.creds.apiKey}`)}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, (j) => short(rec(j)["title"]));
  }

  async checkConnection(): Promise<ProviderList[]> {
    const { json } = await this.call("GET", "/lists?count=100&fields=lists.id,lists.name");
    const out: ProviderList[] = [];
    for (const l of (rec(json)["lists"] as unknown[] | undefined) ?? []) {
      const r = rec(l);
      if (typeof r["id"] === "string" && typeof r["name"] === "string") out.push({ id: r["id"], name: r["name"] });
    }
    return out;
  }

  async subscribe(listId: string, c: ProviderContact): Promise<{ ref?: string }> {
    if (c.channel !== "email" || !c.email) throw new ProviderError("rejected", "Mailchimp sync supports email only");
    // `status_if_new` only: a member who already exists keeps their status, so someone who unsubscribed inside Mailchimp is never silently re-subscribed.
    const { json } = await this.call("PUT", `/lists/${encodeURIComponent(listId)}/members/${md5Hex(c.email.trim().toLowerCase())}`, {
      email_address: c.email, status_if_new: "subscribed", ...(c.firstName ? { merge_fields: { FNAME: c.firstName } } : {}),
    });
    const r = rec(json);
    if (r["status"] !== undefined && r["status"] !== "subscribed" && r["status"] !== "pending") {
      throw new ProviderError("rejected", `Mailchimp has this address as ${short(r["status"]) ?? "not subscribed"}, so it was not re-subscribed`);
    }
    return typeof r["id"] === "string" ? { ref: r["id"] } : {};
  }

  async unsubscribe(listId: string, c: ProviderContact): Promise<void> {
    if (c.channel !== "email" || !c.email) throw new ProviderError("rejected", "Mailchimp sync supports email only");
    try {
      await this.call("PATCH", `/lists/${encodeURIComponent(listId)}/members/${md5Hex(c.email.trim().toLowerCase())}`, { status: "unsubscribed" });
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "rejected" && e.message.startsWith("HTTP 404")) return; // not on the list: already the state we want
      throw e;
    }
  }
}

export function createAdapter(key: ProviderKey, creds: ProviderCredentials, o: AdapterOptions = {}): ProviderAdapter {
  return key === "klaviyo" ? new Klaviyo(creds, o) : new Mailchimp(creds, o);
}

/* ---------- recording fake, for tests ---------- */

export interface FakeCall { op: "check" | "subscribe" | "unsubscribe"; listId?: string; contact?: ProviderContact }

/** Records every call and can be told to fail. Never talks to the network. `live` is false unless a test sets it to check what "verified" means. */
export class FakeProvider implements ProviderAdapter {
  readonly channels: readonly ProviderChannel[] = ["email", "sms"];
  live: boolean = false;
  readonly calls: FakeCall[] = [];
  lists: ProviderList[] = [{ id: "list_1", name: "Newsletter" }, { id: "list_2", name: "VIPs" }];
  private failures: ProviderError[] = [];
  constructor(readonly key: ProviderKey = "klaviyo") {}
  /** The next call fails with this error (queue several for several failures). */
  failNext(kind: ProviderErrorKind, message = "fake failure", retryAfterMs?: number): this { this.failures.push(new ProviderError(kind, message, retryAfterMs)); return this; }
  private maybeFail(): void { const f = this.failures.shift(); if (f) throw f; }
  async checkConnection(): Promise<ProviderList[]> { this.calls.push({ op: "check" }); this.maybeFail(); return this.lists; }
  async subscribe(listId: string, contact: ProviderContact): Promise<{ ref?: string }> { this.calls.push({ op: "subscribe", listId, contact }); this.maybeFail(); return { ref: `fake_${contact.email ?? contact.phone}` }; }
  async unsubscribe(listId: string, contact: ProviderContact): Promise<void> { this.calls.push({ op: "unsubscribe", listId, contact }); this.maybeFail(); }
}

/* ---------- MD5 (Mailchimp identifies a member by the MD5 of the lower-cased address; WebCrypto has no MD5) ---------- */

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);

export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const blocks = ((bytes.length + 8) >>> 6) + 1;
  const buf = new Uint8Array(blocks * 64);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(buf.length - 4, Math.floor((bytes.length * 8) / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let off = 0; off < buf.length; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      f = (f + a + MD5_K[i]! + view.getUint32(off + g * 4, true)) | 0;
      a = d; d = c; c = b;
      const s = MD5_S[(i >>> 4) * 4 + (i % 4)]!;
      b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true); out.setUint32(4, b0, true); out.setUint32(8, c0, true); out.setUint32(12, d0, true);
  return Array.from(new Uint8Array(out.buffer), (x) => x.toString(16).padStart(2, "0")).join("");
}
