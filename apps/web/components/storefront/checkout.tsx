"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Lock, ShoppingBag } from "lucide-react";
import { priceCart } from "@convertflow/store-builder";
import { joinPath, postStore, useStore } from "./context";
import { optionText, useCart } from "./cart";
import { cx, SfImage, SfLink } from "./ui";

interface Field { name: string; label: string; autoComplete: string; type?: string; required?: boolean; half?: boolean; inputMode?: "email" | "tel" | "text" }

const CONTACT: Field[] = [
  { name: "email", label: "Email", autoComplete: "email", type: "email", required: true, inputMode: "email" },
  { name: "phone", label: "Phone (optional)", autoComplete: "tel", type: "tel", inputMode: "tel" },
];
const ADDRESS: Field[] = [
  { name: "name", label: "Full name", autoComplete: "name", required: true },
  { name: "address1", label: "Address", autoComplete: "address-line1", required: true },
  { name: "address2", label: "Apartment, suite, etc. (optional)", autoComplete: "address-line2" },
  { name: "city", label: "City", autoComplete: "address-level2", required: true, half: true },
  { name: "region", label: "State / region (optional)", autoComplete: "address-level1", half: true },
  { name: "postalCode", label: "Postal code", autoComplete: "postal-code", required: true, half: true },
  { name: "country", label: "Country", autoComplete: "country-name", required: true, half: true },
];

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "notice"; message: string } | { kind: "error"; message: string; details?: string[] };

export function CheckoutPage() {
  const ctx = useStore();
  const { doc, mode, money, payments } = ctx;
  const cart = useCart();
  const priced = useMemo(() => priceCart(doc, cart.lines), [doc, cart.lines]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status.kind === "sending") return;
    if (mode !== "live") { setStatus({ kind: "notice", message: "Checkout works on your published store. Publish your store to take real orders." }); return; }
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const customer: Record<string, string> = {};
    for (const f of [...CONTACT, ...ADDRESS]) { const v = get(f.name); if (v) customer[f.name] = v; }
    const note = get("note");
    setStatus({ kind: "sending" });
    const res = await postStore<{ orderId: string; token: string; redirectUrl: string | null }>(ctx, "/checkout", {
      lines: priced.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, ...(Object.keys(l.options).length ? { options: l.options } : {}) })),
      customer,
      ...(note ? { note } : {}),
    });
    if (res.ok) {
      if (res.data.redirectUrl) window.location.assign(res.data.redirectUrl);
      else window.location.assign(joinPath(ctx.basePath, `/orders/${encodeURIComponent(res.data.orderId)}?token=${encodeURIComponent(res.data.token)}`));
      return;
    }
    const details = Array.isArray(res.details) ? res.details.filter((d): d is string => typeof d === "string") : undefined;
    const message =
      res.code === "cart_changed" ? "Some items in your cart changed. Review your cart and try again."
      : res.code === "empty_cart" ? "Your cart is empty."
      : res.status === 429 ? "Too many attempts. Please wait a minute and try again."
      : res.code === "payment_unavailable" ? "Card payment is unavailable right now. Please try again shortly."
      : res.message;
    setStatus({ kind: "error", message, ...(details?.length ? { details } : {}) });
  };

  if (!priced.lines.length) {
    return (
      <div className="sf-container sf-page-pad sf-narrow">
        <div className="sf-empty sf-empty-lg">
          <ShoppingBag size={44} strokeWidth={1.25} aria-hidden="true" />
          <h1 className="sf-h2">Nothing to check out yet</h1>
          <p className="sf-muted">Add a few things to your cart first.</p>
          <SfLink href="/collections/all" className="sf-btn sf-btn-primary">Shop all products</SfLink>
        </div>
      </div>
    );
  }

  const field = (f: Field) => (
    <div key={f.name} className={cx("sf-field", f.half && "is-half")}>
      <label htmlFor={`sf-co-${f.name}`}>{f.label}</label>
      <input id={`sf-co-${f.name}`} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} required={f.required} inputMode={f.inputMode} maxLength={f.name === "email" ? 254 : 200} />
    </div>
  );

  return (
    <div className="sf-container sf-page-pad">
      <h1 className="sf-h1 sf-page-title">Checkout</h1>
      <div className="sf-checkout">
        <form className="sf-checkout-form" onSubmit={submit} noValidate={mode !== "live"}>
          <fieldset className="sf-fieldset">
            <legend className="sf-h4">Contact</legend>
            <div className="sf-fields">{CONTACT.map(field)}</div>
          </fieldset>
          <fieldset className="sf-fieldset">
            <legend className="sf-h4">Shipping address</legend>
            <div className="sf-fields">{ADDRESS.map(field)}</div>
          </fieldset>
          <div className="sf-field">
            <label htmlFor="sf-co-note">Order note (optional)</label>
            <textarea id="sf-co-note" name="note" rows={3} maxLength={500} />
          </div>
          <p className="sf-fine sf-pay-note">
            <Lock size={14} aria-hidden="true" />
            {payments ? "You'll pay securely by card on the next step." : "No payment is taken now. The store will contact you to arrange payment."}
          </p>
          {status.kind === "error" && (
            <div className="sf-notice sf-notice-error" role="alert">
              <p>{status.message}</p>
              {status.details && <ul>{status.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
              {status.details && <p><SfLink href="/cart">Review your cart</SfLink></p>}
            </div>
          )}
          {status.kind === "notice" && <div className="sf-notice" role="status">{status.message}</div>}
          <button type="submit" className="sf-btn sf-btn-primary sf-btn-block sf-btn-lg" disabled={status.kind === "sending"}>
            {status.kind === "sending" ? "Placing order…" : payments ? `Continue to payment · ${money(priced.total)}` : `Place order · ${money(priced.total)}`}
          </button>
        </form>

        <aside className="sf-summary sf-checkout-summary" aria-label="Order summary">
          <h2 className="sf-h4">Order summary</h2>
          <ul className="sf-sum-lines">
            {priced.lines.map((l) => (
              <li key={`${l.productId}|${optionText(l.options)}`} className="sf-sum-line">
                <div className="sf-sum-thumb"><SfImage src={l.image} alt="" label={l.title} /><span className="sf-sum-qty" aria-label={`Quantity ${l.quantity}`}>{l.quantity}</span></div>
                <div className="sf-sum-name"><p>{l.title}</p>{optionText(l.options) && <p className="sf-fine">{optionText(l.options)}</p>}</div>
                <span>{money(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="sf-sum-row"><span>Subtotal</span><span>{money(priced.subtotal)}</span></div>
          <div className="sf-sum-row"><span>Shipping</span><span>{priced.shipping === 0 ? "Free" : money(priced.shipping)}</span></div>
          <div className="sf-sum-row is-total"><span>Total</span><span>{money(priced.total)} <small>{priced.currency}</small></span></div>
          {priced.issues.length > 0 && <div className="sf-notice sf-notice-warn" role="status">{priced.issues.map((i, n) => <p key={n}>{i}</p>)}</div>}
        </aside>
      </div>
    </div>
  );
}
