/**
 * Phone verification for SMS signups: a one-time code is texted to the number, and the shopper types it back into the
 * form. This proves the person holds the number before anyone treats it as subscribed (double opt-in for SMS). The code
 * text is transactional; nothing here sends marketing messages.
 *
 * VERIFICATION STATUS: the Twilio Verify adapter follows Twilio's documented REST API (Verify v2) but has NEVER been run
 * against the real service (no account). It is tested against recorded request shapes and a fake. `live` is false for any
 * non-default origin, so a staging or mock run can never count as verified.
 */
import { ProviderError } from "./providers";

export interface StartOptions {
  /** Shown in the texted message instead of the Verify service's own name, e.g. the store's name. */
  friendlyName?: string;
}

export interface PhoneVerifier {
  readonly key: "twilio";
  /** True only when requests go to the provider's real API. */
  readonly live: boolean;
  /** Texts a new code to an E.164 number. Throws ProviderError (`rejected` for a number the provider will not text). */
  start(phone: string, o?: StartOptions): Promise<void>;
  /** True when the code is the current one for this number. A wrong, used or expired code is false, never an error. */
  check(phone: string, code: string): Promise<boolean>;
}

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  fetchFn?: typeof fetch;
  /** Replaces https://verify.twilio.com (a local mock in tests). */
  baseUrl?: string;
}

export const TWILIO_VERIFY_ORIGIN = "https://verify.twilio.com";
const MAX_RETRY_AFTER_MS = 3_600_000;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Twilio's numeric error code only (e.g. 60200): its message can echo the phone number back, so it is never copied. */
const twilioCode = (j: unknown): string | undefined => {
  const c = rec(j)["code"];
  return typeof c === "number" && Number.isInteger(c) ? String(c) : undefined;
};

class TwilioVerify implements PhoneVerifier {
  readonly key = "twilio" as const;
  readonly live: boolean;
  private readonly origin: string;
  private readonly fetchFn: typeof fetch;
  constructor(private readonly o: TwilioOptions) {
    this.origin = (o.baseUrl ?? TWILIO_VERIFY_ORIGIN).replace(/\/+$/, "");
    this.live = o.baseUrl === undefined;
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a)); // never call fetch as a method of this object: Workers throws "Illegal invocation"
  }

  private async post(path: string, form: Record<string, string>): Promise<{ status: number; json: unknown }> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.origin}/v2/Services/${encodeURIComponent(this.o.serviceSid)}${path}`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`${this.o.accountSid}:${this.o.authToken}`)}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams(form).toString(),
      });
    } catch { throw new ProviderError("transient", "Could not reach the SMS provider"); }
    const text = await res.text().catch(() => "");
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, json };
  }

  private fail(status: number, json: unknown, retryAfter: string | null): never {
    const code = twilioCode(json);
    const msg = `HTTP ${status}${code ? `: Twilio error ${code}` : ""}`;
    if (status === 401 || status === 403) throw new ProviderError("auth", msg);
    if (status === 429) {
      const s = Number(retryAfter);
      throw new ProviderError("rate_limited", msg, Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, MAX_RETRY_AFTER_MS) : undefined);
    }
    if (status === 408 || status >= 500) throw new ProviderError("transient", msg);
    throw new ProviderError("rejected", msg);
  }

  async start(phone: string, o: StartOptions = {}): Promise<void> {
    const form: Record<string, string> = { To: phone, Channel: "sms" };
    const name = o.friendlyName?.replace(/[^\p{L}\p{N} .'&-]/gu, "").trim().slice(0, 30);
    if (name) form["CustomFriendlyName"] = name;
    const r = await this.post("/Verifications", form);
    if (r.status >= 200 && r.status < 300) return;
    this.fail(r.status, r.json, null);
  }

  async check(phone: string, code: string): Promise<boolean> {
    if (!/^\d{4,10}$/.test(code)) return false;
    const r = await this.post("/VerificationCheck", { To: phone, Code: code });
    // 404: no pending verification for this number (expired, already approved, or never started).
    if (r.status === 404) return false;
    if (r.status >= 200 && r.status < 300) return rec(r.json)["status"] === "approved";
    this.fail(r.status, r.json, null);
  }
}

export function createTwilioVerifier(o: TwilioOptions): PhoneVerifier {
  return new TwilioVerify(o);
}

/* ---------- recording fake, for tests and local runs ---------- */

/** Never touches the network. Each start issues a fresh 6-digit code, readable with `codeFor`. */
export class FakePhoneVerifier implements PhoneVerifier {
  readonly key = "twilio" as const;
  live = false;
  readonly sent: { phone: string; friendlyName?: string | undefined }[] = [];
  readonly checks: { phone: string; code: string }[] = [];
  private codes = new Map<string, string>();
  private failures: ProviderError[] = [];
  private seq = 0;
  failNext(kind: ProviderError["kind"], message = "fake failure"): this { this.failures.push(new ProviderError(kind, message)); return this; }
  codeFor(phone: string): string | undefined { return this.codes.get(phone); }
  async start(phone: string, o: StartOptions = {}): Promise<void> {
    this.sent.push({ phone, friendlyName: o.friendlyName });
    const f = this.failures.shift(); if (f) throw f;
    this.codes.set(phone, String(123456 + this.seq++).padStart(6, "0"));
  }
  async check(phone: string, code: string): Promise<boolean> {
    this.checks.push({ phone, code });
    const f = this.failures.shift(); if (f) throw f;
    if (this.codes.get(phone) !== code) return false;
    this.codes.delete(phone); // a code works once
    return true;
  }
}
