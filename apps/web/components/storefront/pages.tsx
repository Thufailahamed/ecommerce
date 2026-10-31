"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CheckCircle2, Clock3, PackageCheck, XCircle } from "lucide-react";
import { collectionProducts, MAX_LINE_QTY, type Collection, type PricedLine, type Product } from "@convertflow/store-builder";
import { useStore } from "./context";
import { optionText, useCart } from "./cart";
import { cx, paragraphs, Price, ProductCard, ProductGridView, QtyStepper, SfImage, SfLink } from "./ui";

/* ---------- product ---------- */

export function ProductPage({ product }: { product: Product }) {
  const { doc } = useStore();
  const cart = useCart();
  const ids = useId();
  const [imageIndex, setImageIndex] = useState(0);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);

  // Options with a single value need no decision from the shopper.
  const choices = useMemo(() => {
    const out: Record<string, string> = {};
    for (const o of product.options) {
      const v = picked[o.name];
      if (v && o.values.includes(v)) out[o.name] = v;
      else if (o.values.length === 1 && o.values[0]) out[o.name] = o.values[0];
    }
    return out;
  }, [product.options, picked]);
  const missing = product.options.filter((o) => !choices[o.name]);
  const canAdd = product.available && missing.length === 0;

  const images = product.images.length ? product.images : [{ src: "", alt: product.title }];
  const current = images[Math.min(imageIndex, images.length - 1)] ?? images[0]!;
  const related = useMemo(() => {
    const others = doc.products.filter((p) => p.id !== product.id && p.available);
    const same = product.category ? others.filter((p) => p.category === product.category) : [];
    return (same.length ? same : others).slice(0, 4);
  }, [doc.products, product]);
  const collection = doc.collections.find((c) => c.productIds.includes(product.id));

  return (
    <div className="sf-container sf-page-pad">
      <nav className="sf-crumbs" aria-label="Breadcrumb">
        <ol>
          <li><SfLink href="/">Home</SfLink></li>
          <li><SfLink href={collection ? `/collections/${collection.slug}` : "/collections/all"}>{collection?.title ?? "Shop"}</SfLink></li>
          <li aria-current="page">{product.title}</li>
        </ol>
      </nav>
      <div className="sf-pdp">
        <div className="sf-gallery">
          <div className="sf-gallery-main">
            <SfImage src={current.src} alt={current.alt || product.title} label={product.title} eager />
            {!product.available && <span className="sf-badge sf-badge-muted sf-gallery-badge">Sold out</span>}
          </div>
          {images.length > 1 && (
            <ul className="sf-thumbs" aria-label="Product images">
              {images.map((img, i) => (
                <li key={i}>
                  <button type="button" className="sf-thumb" aria-pressed={i === imageIndex} aria-label={`Show image ${i + 1} of ${images.length}`} onClick={() => setImageIndex(i)}>
                    <SfImage src={img.src} alt="" label={product.title} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sf-pdp-info">
          {product.category && <p className="sf-eyebrow">{product.category}</p>}
          <h1 className="sf-h1 sf-pdp-title">{product.title}</h1>
          <Price price={product.price} compareAt={product.compareAtPrice} className="sf-pdp-price" />

          <form className="sf-pdp-form" onSubmit={(e) => { e.preventDefault(); if (canAdd) { cart.add(product.id, choices, qty); setQty(1); } }}>
            {product.options.map((o, i) => {
              const legend = `${ids}-opt-${i}`;
              return (
                <fieldset key={o.name} className="sf-option" aria-describedby={legend}>
                  <legend className="sf-option-legend">
                    {o.name}
                    <span id={legend} className="sf-option-value">{choices[o.name] ?? `Choose ${o.name.toLowerCase()}`}</span>
                  </legend>
                  <div className="sf-pills">
                    {o.values.map((v) => (
                      <button key={v} type="button" className="sf-pill" aria-pressed={choices[o.name] === v} onClick={() => setPicked((p) => ({ ...p, [o.name]: v }))}>{v}</button>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {product.available && (
              <div className="sf-option">
                <span className="sf-option-legend">Quantity</span>
                <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(MAX_LINE_QTY, n)))} max={MAX_LINE_QTY} label="Quantity" />
              </div>
            )}
            <button type="submit" className="sf-btn sf-btn-primary sf-btn-block sf-btn-lg" disabled={!canAdd}>
              {product.available ? "Add to cart" : "Sold out"}
            </button>
            {product.available && missing.length > 0 && (
              <p className="sf-fine" aria-live="polite">Choose {missing.map((o) => o.name.toLowerCase()).join(" and ")} to add this to your cart.</p>
            )}
          </form>

          {product.description && (
            <div className="sf-rich sf-pdp-desc">
              {paragraphs(product.description).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="sf-related" aria-labelledby={`${ids}-related`}>
          <h2 id={`${ids}-related`} className="sf-h2">You may also like</h2>
          <ul className="sf-products sf-cols-4">
            {related.map((p) => <li key={p.id}><ProductCard product={p} /></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ---------- collection ---------- */

export function CollectionPage({ collection }: { collection: Collection | null }) {
  const { doc } = useStore();
  const products = useMemo(() => collectionProducts(doc, collection?.id ?? null), [doc, collection]);
  return (
    <div className="sf-container sf-page-pad">
      <header className="sf-collection-head">
        <h1 className="sf-h1">{collection?.title ?? "All products"}</h1>
        {collection?.description && <p className="sf-lead sf-muted">{collection.description}</p>}
      </header>
      <ProductGridView products={products} columns={4} />
    </div>
  );
}

/* ---------- order confirmation ---------- */

interface Order {
  id: string; number: string | number; status: "pending_payment" | "paid" | "unpaid" | "fulfilled" | "cancelled";
  email: string; name: string; lines: PricedLine[]; currency: string; subtotal: number; shipping: number; total: number; createdAt: string;
}

const STATUS: Record<Order["status"], { title: string; body: string; tone: "ok" | "wait" | "bad" }> = {
  pending_payment: { title: "Confirming your payment…", body: "This usually takes a few seconds. You can keep this page open.", tone: "wait" },
  paid: { title: "Thank you! Your order is confirmed.", body: "Payment received. We'll email you when it ships.", tone: "ok" },
  unpaid: { title: "Thank you! We've received your order.", body: "The store will be in touch about payment.", tone: "ok" },
  fulfilled: { title: "Your order is on its way.", body: "It has been packed and handed to the carrier.", tone: "ok" },
  cancelled: { title: "This order was cancelled.", body: "If this is unexpected, please contact the store.", tone: "bad" },
};

export function OrderPage({ orderId, token }: { orderId: string; token: string | undefined }) {
  const { mode, apiUrl, slug, money } = useStore();
  const cart = useCart();
  const clearCart = cart.clear;
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; order: Order }>({ kind: "loading" });

  useEffect(() => {
    if (mode !== "live" || !apiUrl || !slug) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = async () => {
      attempts += 1;
      try {
        const res = await fetch(`${apiUrl}/api/v1/storefront/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token ?? "")}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) { setState({ kind: "error", message: res.status === 404 ? "We couldn't find this order. Check the link in your confirmation email." : "We couldn't load your order. Please refresh the page." }); return; }
        const { data } = (await res.json()) as { data: Order };
        if (cancelled) return;
        setState({ kind: "ok", order: data });
        clearCart();
        // Reading the order also confirms a Stripe payment, so ask again while it settles.
        if (data.status === "pending_payment" && attempts < 6) timer = setTimeout(load, 2500);
      } catch {
        if (!cancelled) setState({ kind: "error", message: "We couldn't reach the store. Please refresh the page." });
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [mode, apiUrl, slug, orderId, token, clearCart]);

  if (mode !== "live") {
    return (
      <div className="sf-container sf-page-pad sf-narrow">
        <div className="sf-empty sf-empty-lg">
          <PackageCheck size={44} strokeWidth={1.25} aria-hidden="true" />
          <h1 className="sf-h2">Order confirmation</h1>
          <p className="sf-muted">Shoppers see their order details here after checking out on your published store.</p>
        </div>
      </div>
    );
  }
  if (state.kind === "loading") return <div className="sf-container sf-page-pad sf-narrow"><p className="sf-muted" role="status">Loading your order…</p></div>;
  if (state.kind === "error") {
    return (
      <div className="sf-container sf-page-pad sf-narrow">
        <div className="sf-empty sf-empty-lg">
          <h1 className="sf-h2">Order not available</h1>
          <p className="sf-muted">{state.message}</p>
          <SfLink href="/" className="sf-btn sf-btn-primary">Back to the store</SfLink>
        </div>
      </div>
    );
  }
  const { order } = state;
  const s = STATUS[order.status] ?? STATUS.unpaid;
  const Icon = s.tone === "bad" ? XCircle : s.tone === "wait" ? Clock3 : CheckCircle2;
  const fmt = (n: number) => money(n);
  return (
    <div className="sf-container sf-page-pad sf-narrow">
      <div className={cx("sf-order-hero", `is-${s.tone}`)} role="status">
        <Icon size={40} strokeWidth={1.5} aria-hidden="true" />
        <p className="sf-eyebrow">Order #{order.number}</p>
        <h1 className="sf-h2">{s.title}</h1>
        <p className="sf-muted">{s.body} A confirmation was sent to <strong>{order.email}</strong>.</p>
      </div>
      <div className="sf-summary sf-order-summary">
        <h2 className="sf-h4">Order details</h2>
        <ul className="sf-sum-lines">
          {order.lines.map((l, i) => (
            <li key={i} className="sf-sum-line">
              <div className="sf-sum-thumb"><SfImage src={l.image} alt="" label={l.title} /><span className="sf-sum-qty">{l.quantity}</span></div>
              <div className="sf-sum-name"><p>{l.title}</p>{optionText(l.options) && <p className="sf-fine">{optionText(l.options)}</p>}</div>
              <span>{fmt(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="sf-sum-row"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
        <div className="sf-sum-row"><span>Shipping</span><span>{order.shipping === 0 ? "Free" : fmt(order.shipping)}</span></div>
        <div className="sf-sum-row is-total"><span>Total</span><span>{fmt(order.total)} <small>{order.currency}</small></span></div>
      </div>
      <p className="sf-center"><SfLink href="/collections/all" className="sf-btn sf-btn-outline">Continue shopping</SfLink></p>
    </div>
  );
}

/* ---------- 404 ---------- */

export function NotFoundView() {
  return (
    <div className="sf-container sf-page-pad sf-narrow">
      <div className="sf-empty sf-empty-lg sf-404">
        <p className="sf-404-code" aria-hidden="true">404</p>
        <h1 className="sf-h2">This page wandered off</h1>
        <p className="sf-muted">The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.</p>
        <div className="sf-btn-row is-center">
          <SfLink href="/" className="sf-btn sf-btn-primary">Back to home</SfLink>
          <SfLink href="/collections/all" className="sf-btn sf-btn-outline">Shop all</SfLink>
        </div>
      </div>
    </div>
  );
}
