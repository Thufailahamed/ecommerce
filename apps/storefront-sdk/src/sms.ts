import type { CampaignConfig } from "@convertflow/contracts";
import { el, isSafeUrl, shell } from "./panel";
import type { RenderCallbacks, RenderHandle } from "./render";

/**
 * SMS signup form, in two steps: the number (with an unticked consent box carrying the exact words the server stores),
 * then the one-time code texted to it. Nobody is subscribed until the code is confirmed. An incentive is shown only
 * after that, and only if the server returns it. Popup, slide-in, bar and inline layouts share this renderer.
 */

/** Dial code, and whether a national number is written with a leading 0 that is dropped internationally. */
export const COUNTRIES: Record<string, [dial: string, trunk0: boolean]> = {
  US: ["1", false], CA: ["1", false], GB: ["44", true], IE: ["353", true], AU: ["61", true], NZ: ["64", true],
  DE: ["49", true], FR: ["33", true], ES: ["34", false], IT: ["39", false], NL: ["31", true], BE: ["32", true],
  AT: ["43", true], CH: ["41", true], SE: ["46", true], NO: ["47", false], DK: ["45", false], FI: ["358", true],
  PL: ["48", false], PT: ["351", false], CZ: ["420", false], GR: ["30", false], RO: ["40", true], TR: ["90", true],
  IL: ["972", true], AE: ["971", true], SA: ["966", true], ZA: ["27", true], NG: ["234", true], IN: ["91", true],
  SG: ["65", false], HK: ["852", false], JP: ["81", true], KR: ["82", true], PH: ["63", true], MY: ["60", true],
  TH: ["66", true], ID: ["62", true], MX: ["52", false], BR: ["55", false],
};

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * The shopper's number in E.164, or undefined. A number typed with + or 00 is taken as international; otherwise the
 * chosen country's dial code is added (dropping a national leading 0). Nothing else is guessed: the server re-checks.
 */
export function toE164(country: string, raw: string): string | undefined {
  const t = raw.trim();
  let n: string;
  if (/^(\+|00)/.test(t)) n = `+${t.replace(/^00/, "").replace(/\D/g, "")}`;
  else {
    const c = COUNTRIES[country];
    if (!c) return undefined;
    let digits = t.replace(/\D/g, "");
    if (c[1] && digits.startsWith("0")) digits = digits.slice(1);
    if (c[0] === "1" && digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    n = `+${c[0]}${digits}`;
  }
  return E164.test(n) ? n : undefined;
}

/** "+1 •••• 0123": enough to recognise the number without printing it in full on a shared screen. */
const masked = (e164: string): string => `${e164.slice(0, e164.length - 10 > 1 ? e164.length - 10 : 2)} •••• ${e164.slice(-4)}`;

/** Messages for the error codes the storefront passes back (see index.ts). Anything else is a generic retry. */
const ERRORS: Record<string, string> = {
  phone_undeliverable: "We can't text that number. Check it, including the country code.",
  invalid_code: "That code is not right or has expired.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
};

export function renderSmsSignup(doc: Document, cfg: CampaignConfig, cb: RenderCallbacks = {}, mount: HTMLElement = doc.body): RenderHandle {
  const { style: s, creative: c } = cfg;
  const f = cfg.form!;
  const { host, root, panel, close, btnCss, bar } = shell(doc, cfg, cb, { promotion: false });

  const radius = Math.min(s.radius, 999);
  const field = `box-sizing:border-box;font:inherit;padding:9px 12px;border:1px solid ${s.text}55;border-radius:${radius}px;background:#fff;color:#16181a;`;
  const col = bar ? "display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;" : "display:flex;flex-direction:column;gap:10px;";
  const status = el(doc, "div", `font-size:13px;min-height:1em;${bar ? "flex:1 1 100%;text-align:center;" : ""}`);
  status.setAttribute("role", "status");
  const fail = (e: unknown) => { status.textContent = ERRORS[e instanceof Error ? e.message : ""] ?? "Something went wrong. Please try again."; };

  /* ---------- step 1: number + consent ---------- */
  const form = el(doc, "form", col);
  form.setAttribute("novalidate", "");
  const row = el(doc, "div", `display:flex;gap:6px;${bar ? "flex:1 1 240px;max-width:320px;" : "width:100%;"}`);
  const country = el(doc, "select", `${field}flex:none;width:88px;padding-right:4px;`);
  country.setAttribute("aria-label", "Country code");
  country.setAttribute("autocomplete", "tel-country-code");
  const def = COUNTRIES[f.defaultCountry] ? f.defaultCountry : "US";
  for (const iso of Object.keys(COUNTRIES)) {
    const o = el(doc, "option", "", `${iso} +${COUNTRIES[iso]![0]}`);
    o.setAttribute("value", iso);
    if (iso === def) o.setAttribute("selected", "");
    country.appendChild(o);
  }
  country.value = def;
  const phone = el(doc, "input", `${field}flex:1 1 auto;min-width:0;`);
  phone.setAttribute("type", "tel"); phone.setAttribute("name", "phone"); phone.setAttribute("autocomplete", "tel-national");
  phone.setAttribute("inputmode", "tel"); phone.setAttribute("placeholder", "Mobile number"); phone.setAttribute("aria-label", "Mobile number"); phone.setAttribute("required", "");
  row.append(country, phone);

  let first: HTMLInputElement | undefined;
  if (f.collect.firstName) {
    first = el(doc, "input", `${field}${bar ? "flex:1 1 120px;min-width:0;max-width:180px;" : "width:100%;"}`);
    first.setAttribute("type", "text"); first.setAttribute("name", "firstName"); first.setAttribute("autocomplete", "given-name");
    first.setAttribute("maxlength", "60"); first.setAttribute("placeholder", "First name (optional)"); first.setAttribute("aria-label", "First name (optional)");
  }

  const consent = el(doc, "label", `display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.4;cursor:pointer;${bar ? "flex:1 1 100%;justify-content:center;text-align:left;" : ""}`);
  const box = el(doc, "input", "margin:2px 0 0;flex:none;width:16px;height:16px;");
  box.setAttribute("type", "checkbox"); box.setAttribute("name", "consent");
  consent.append(box, el(doc, "span", "", f.consentText));
  const submit = el(doc, "button", `${btnCss}${bar ? "" : "width:100%;"}`, c.ctaLabel);
  submit.setAttribute("type", "submit");

  form.append(row);
  if (first) form.append(first);
  if (bar) form.append(submit, consent); else form.append(consent);
  if (isSafeUrl(f.privacyUrl)) {
    const link = el(doc, "a", "font-size:12px;color:inherit;text-decoration:underline;", "Privacy policy");
    link.setAttribute("href", f.privacyUrl); link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener noreferrer");
    form.appendChild(link);
  }
  if (!bar) form.append(submit);
  form.append(status);

  /* ---------- step 2: the texted code ---------- */
  const verify = (number: string): void => {
    const step = el(doc, "form", col);
    step.setAttribute("novalidate", "");
    const sent = el(doc, "div", `font-weight:600;${bar ? "flex:1 1 100%;text-align:center;" : ""}`, `We texted a code to ${masked(number)}.`);
    const code = el(doc, "input", `${field}${bar ? "flex:0 1 160px;" : "width:100%;"}letter-spacing:.2em;`);
    code.setAttribute("type", "text"); code.setAttribute("name", "code"); code.setAttribute("inputmode", "numeric");
    code.setAttribute("autocomplete", "one-time-code"); code.setAttribute("maxlength", "10"); code.setAttribute("pattern", "[0-9]*");
    code.setAttribute("aria-label", "Verification code"); code.setAttribute("placeholder", "Code");
    const ok = el(doc, "button", `${btnCss}${bar ? "" : "width:100%;"}`, "Confirm");
    ok.setAttribute("type", "submit");
    const back = el(doc, "button", "font:inherit;font-size:12px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;padding:0;align-self:flex-start;", "Use a different number");
    back.setAttribute("type", "button");
    back.addEventListener("click", () => { step.replaceWith(form); submit.removeAttribute("disabled"); status.textContent = ""; phone.focus(); });
    step.append(sent, code, ok, back, status);
    status.textContent = "";

    step.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = code.value.replace(/\D/g, "");
      if (v.length < 4) { status.textContent = "Enter the code from the text message."; code.focus(); return; }
      ok.setAttribute("disabled", ""); status.textContent = "Checking…";
      void Promise.resolve(cb.onSmsConfirm?.(number, v)).then(
        (r) => {
          const done = el(doc, "div", "font-weight:600;", f.successMessage);
          done.setAttribute("role", "status");
          const inc = r && typeof r === "object" ? r.incentive : undefined;
          if (inc) {
            const line = el(doc, "div", "font-weight:400;margin-top:6px;", `${inc.label ?? "Your code"} · ${inc.percentOff}% off: `);
            line.appendChild(el(doc, "code", `font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px dashed ${s.text};border-radius:6px;padding:2px 6px;`, inc.code));
            done.appendChild(line);
          }
          step.replaceWith(done);
        },
        (err) => { ok.removeAttribute("disabled"); fail(err); code.select(); code.focus(); },
      );
    });
    form.replaceWith(step);
    code.focus();
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const number = toE164(country.value, phone.value);
    if (!number) { status.textContent = "Enter a valid mobile number."; phone.focus(); return; }
    if (!box.checked) { status.textContent = "Tick the box to agree before signing up."; box.focus(); return; }
    submit.setAttribute("disabled", ""); status.textContent = "Sending…";
    const name = first?.value.trim().slice(0, 60);
    void Promise.resolve(name ? cb.onSmsStart?.(number, name) : cb.onSmsStart?.(number)).then(
      () => verify(number),
      (err) => { submit.removeAttribute("disabled"); fail(err); },
    );
  });

  panel.appendChild(form);
  if (close) panel.appendChild(close);
  root.appendChild(panel);
  mount.appendChild(host);
  close?.focus?.({ preventScroll: true } as FocusOptions);

  return { host, destroy: () => host.remove() };
}
