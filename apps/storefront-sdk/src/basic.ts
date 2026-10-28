import type { CampaignConfig } from "@convertflow/contracts";
import { EMAIL_RE, el, isSafeUrl, shell } from "./panel";
import type { RenderCallbacks, RenderContext, RenderHandle } from "./render";

/**
 * Popup, slide-in and announcement bar with a plain call to action, plus the back-in-stock form. This is the part of
 * the storefront script every page needs, so it stays in the core; toast, feed, recommendations and signup forms are
 * separate scripts loaded only when a campaign of that tool is eligible.
 */
export function renderBasic(doc: Document, cfg: CampaignConfig, cb: RenderCallbacks = {}, mount: HTMLElement = doc.body, _ctx?: RenderContext): RenderHandle {
  const { style: s, creative: c, format } = cfg;
  const { host, root, panel, close, btnCss } = shell(doc, cfg, cb, { promotion: true });

  if (format === "restock") {
    // Back-in-stock email form. Validation is the browser's; the SDK sends it, the server double-opts-in.
    const form = el(doc, "form", "display:flex;gap:8px;flex-wrap:wrap;");
    form.setAttribute("novalidate", "");
    const input = el(doc, "input", `flex:1 1 160px;min-width:0;font:inherit;padding:9px 12px;border:1px solid ${s.text}55;border-radius:${Math.min(s.radius, 999)}px;background:#fff;color:#16181a;`);
    input.setAttribute("type", "email"); input.setAttribute("name", "email"); input.setAttribute("autocomplete", "email");
    input.setAttribute("placeholder", "you@example.com"); input.setAttribute("aria-label", "Email address"); input.setAttribute("required", "");
    const submit = el(doc, "button", btnCss, c.ctaLabel);
    submit.setAttribute("type", "submit");
    const status = el(doc, "div", "width:100%;font-size:13px;min-height:1em;");
    status.setAttribute("role", "status");
    form.append(input, submit, status);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!EMAIL_RE.test(v)) { status.textContent = "Enter a valid email address."; input.focus(); return; }
      submit.setAttribute("disabled", ""); status.textContent = "Sending…";
      void Promise.resolve(cb.onSubscribe?.(v)).then(
        () => { form.replaceChildren(el(doc, "div", "font-weight:600;", "Check your inbox to confirm. We'll email you once when it's back.")); form.setAttribute("role", "status"); },
        () => { submit.removeAttribute("disabled"); status.textContent = "Something went wrong. Please try again."; },
      );
    });
    panel.append(form, close!);
  } else {
    const cta = el(doc, "a", btnCss, c.ctaLabel);
    // Defence in depth: the server already validated this, but never trust a config at render time.
    cta.setAttribute("href", isSafeUrl(c.ctaUrl) ? c.ctaUrl : "#");
    cta.setAttribute("rel", "noopener noreferrer");
    cta.addEventListener("click", () => cb.onClick?.());
    panel.append(cta, close!);
  }

  root.appendChild(panel);
  mount.appendChild(host);
  close!.focus?.({ preventScroll: true } as FocusOptions);

  return { host, destroy: () => host.remove() };
}
