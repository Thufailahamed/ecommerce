import { HttpError, type Deps, type EmailMessage, type EmailProvider } from "../deps.js";

/** Resend REST adapter (https://resend.com/docs/api-reference/emails/send-email). Never logs message bodies (they hold links with tokens). */
export class ResendEmail implements EmailProvider {
  constructor(private apiKey: string, private from: string, private fetchFn: typeof fetch = fetch, private baseUrl = "https://api.resend.com") {}
  async send(m: EmailMessage): Promise<void> {
    // Workers' fetch throws "Illegal invocation" when called as a method of another object (this.fetchFn(...)).
    // Always call it as a plain function.
    const doFetch = this.fetchFn;
    const res = await doFetch(`${this.baseUrl}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}), ...(m.headers ? { headers: m.headers } : {}) }),
    });
    if (!res.ok) throw new Error(`email provider responded ${res.status}`);
  }
}

export const emailEnabled = (d: Deps): boolean => d.email !== undefined;

export function requireEmail(d: Deps): EmailProvider {
  if (!d.email) throw new HttpError(503, "email_not_configured", "Email delivery is not configured on this deployment");
  return d.email;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function layout(brand: string, heading: string, lines: string[], cta?: { label: string; url: string }, footer?: string): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Inter,Arial,sans-serif;color:#191a1b"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px"><tr><td style="padding:32px"><div style="font-weight:700;font-size:16px;color:#003fff">${esc(brand)}</div><h1 style="font-size:22px;margin:20px 0 12px">${esc(heading)}</h1>${lines.map((l) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#475467">${esc(l)}</p>`).join("")}${cta ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="background:#003fff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p><p style="font-size:12px;color:#586377;word-break:break-all">If the button does not work, open this link: ${esc(cta.url)}</p>` : ""}${footer ? `<p style="font-size:12px;color:#586377;margin-top:24px">${esc(footer)}</p>` : ""}</td></tr></table></td></tr></table></body></html>`;
  const text = [heading, "", ...lines, ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), ...(footer ? ["", footer] : [])].join("\n");
  return { html, text };
}

const BRAND = "ConvertFlow AI";

export const templates = {
  verifyEmail(to: string, url: string): EmailMessage {
    const { html, text } = layout(BRAND, "Confirm your email", ["Confirm this address to publish campaigns and use AI drafts. The link expires in 24 hours."], { label: "Confirm email", url }, "If you did not create an account, ignore this email.");
    return { to, subject: "Confirm your email address", text, html };
  },
  passwordReset(to: string, url: string): EmailMessage {
    const { html, text } = layout(BRAND, "Reset your password", ["We received a request to reset your password. The link works once and expires in 1 hour."], { label: "Choose a new password", url }, "If you did not request this, you can ignore this email. Your password will not change.");
    return { to, subject: "Reset your password", text, html };
  },
  invite(to: string, url: string, org: string, inviter: string, role: string): EmailMessage {
    const { html, text } = layout(BRAND, `Join ${org}`, [`${inviter} invited you to ${org} as ${role}.`, "The invitation expires in 7 days."], { label: "Accept invitation", url });
    return { to, subject: `You're invited to ${org}`, text, html };
  },
  restockConfirm(to: string, url: string, storeName: string, productTitle: string, unsubscribeUrl: string): EmailMessage {
    const { html, text } = layout(storeName, "Confirm your back-in-stock alert", [`You asked to be emailed when “${productTitle}” is available again at ${storeName}.`, "Confirm to start receiving this one alert. We will not email you about anything else."], { label: "Confirm alert", url }, `Changed your mind? Unsubscribe: ${unsubscribeUrl}`);
    return { to, subject: `Confirm your alert for ${productTitle}`, text, html, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
  },
  contactConfirm(to: string, url: string, storeName: string, consentText: string, unsubscribeUrl: string): EmailMessage {
    const { html, text } = layout(storeName, "Confirm your subscription", [`Someone entered this address to receive marketing emails from ${storeName}.`, `What was agreed to: “${consentText}”`, "Confirm to start receiving them. If this was not you, ignore this email and nothing will be sent."], { label: "Confirm subscription", url }, `Not for you? Unsubscribe: ${unsubscribeUrl}`);
    return { to, subject: `Confirm your subscription to ${storeName}`, text, html, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
  },
  /** Sent once, right after a shopper confirms, because the sign-up form promised them a code. The code is never shown before confirmation. */
  contactIncentive(to: string, storeName: string, incentive: { code: string; percentOff: number; label?: string | undefined }, firstName: string | null, unsubscribeUrl: string): EmailMessage {
    const { html, text } = layout(storeName, `Your ${incentive.percentOff}% off code`, [
      `${firstName ? `Hi ${firstName}, you` : "You"} are subscribed to ${storeName}. Thanks for confirming.`,
      `${incentive.label ?? "Your code"}: ${incentive.code} (${incentive.percentOff}% off). Enter it at checkout.`,
    ], undefined, `You are receiving this because you signed up and confirmed. Unsubscribe: ${unsubscribeUrl}`);
    return { to, subject: `Your ${incentive.percentOff}% off code from ${storeName}`, text, html, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
  },
  restockAvailable(to: string, storeName: string, productTitle: string, productUrl: string, unsubscribeUrl: string): EmailMessage {
    const { html, text } = layout(storeName, `${productTitle} is available again`, [`Good news from ${storeName}: an item you asked about is available again. Availability can change quickly.`], { label: "View product", url: productUrl }, `You are receiving this one-time alert because you asked for it. Unsubscribe: ${unsubscribeUrl}`);
    return { to, subject: `${productTitle} is available again`, text, html, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
  },
};
