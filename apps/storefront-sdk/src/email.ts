import type { CampaignConfig } from "@convertflow/contracts";
import { EMAIL_RE, el, isSafeUrl, shell } from "./panel";
import type { RenderCallbacks, RenderHandle } from "./render";

/**
 * Email signup form in every layout it can take: popup, slide-in, announcement bar and inline. The consent box is its
 * own control, never pre-ticked, and carries the exact words the server stores as proof (it re-reads them from the
 * published form, so what is shown here is what is recorded). An incentive is never drawn here: the shopper receives
 * it only after confirming from their inbox.
 */
export function renderSignup(doc: Document, cfg: CampaignConfig, cb: RenderCallbacks = {}, mount: HTMLElement = doc.body): RenderHandle {
  const { style: s, creative: c } = cfg;
  const f = cfg.form!;
  const { host, root, panel, close, btnCss, bar } = shell(doc, cfg, cb, { promotion: false });

  const radius = Math.min(s.radius, 999);
  const field = `box-sizing:border-box;font:inherit;padding:9px 12px;border:1px solid ${s.text}55;border-radius:${radius}px;background:#fff;color:#16181a;`;
  const form = el(doc, "form", bar ? "display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;" : "display:flex;flex-direction:column;gap:10px;");
  form.setAttribute("novalidate", "");

  const input = el(doc, "input", `${field}${bar ? "flex:1 1 180px;min-width:0;max-width:260px;" : "width:100%;"}`);
  input.setAttribute("type", "email"); input.setAttribute("name", "email"); input.setAttribute("autocomplete", "email");
  input.setAttribute("placeholder", "you@example.com"); input.setAttribute("aria-label", "Email address"); input.setAttribute("required", "");

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
  const status = el(doc, "div", `font-size:13px;min-height:1em;${bar ? "flex:1 1 100%;text-align:center;" : ""}`);
  status.setAttribute("role", "status");

  form.append(input);
  if (first) form.append(first);
  if (bar) form.append(submit, consent); else form.append(consent);
  if (isSafeUrl(f.privacyUrl)) {
    const link = el(doc, "a", "font-size:12px;color:inherit;text-decoration:underline;", "Privacy policy");
    link.setAttribute("href", f.privacyUrl); link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener noreferrer");
    form.appendChild(link);
  }
  if (!bar) form.append(submit);
  form.append(status);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!EMAIL_RE.test(v)) { status.textContent = "Enter a valid email address."; input.focus(); return; }
    if (!box.checked) { status.textContent = "Tick the box to agree before signing up."; box.focus(); return; }
    submit.setAttribute("disabled", ""); status.textContent = "Sending…";
    const name = first?.value.trim().slice(0, 60);
    void Promise.resolve(name ? cb.onSignup?.(v, name) : cb.onSignup?.(v)).then( // the second argument exists only when the shopper gave a name
      () => {
        const done = el(doc, "div", "font-weight:600;", f.pendingMessage);
        done.setAttribute("role", "status");
        // Say that something is coming, never what: the code itself is shown on the confirmation page.
        const note = cfg.promotion ? el(doc, "div", "font-weight:400;opacity:.85;margin-top:4px;", "Your discount code is shown once you confirm.") : undefined;
        if (note) done.appendChild(note);
        form.replaceChildren(done);
      },
      () => { submit.removeAttribute("disabled"); status.textContent = "Something went wrong. Please try again."; },
    );
  });

  panel.appendChild(form);
  if (close) panel.appendChild(close);
  root.appendChild(panel);
  mount.appendChild(host);
  close?.focus?.({ preventScroll: true } as FocusOptions);

  return { host, destroy: () => host.remove() };
}
