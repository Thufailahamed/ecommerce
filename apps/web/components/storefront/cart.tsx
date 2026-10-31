"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ShoppingBag, Trash2, X } from "lucide-react";
import { lineKey, MAX_CART_LINES, MAX_LINE_QTY, priceCart, productPath, type CartLine, type Product, type SiteDocument } from "@convertflow/store-builder";
import { useStore } from "./context";
import { cx, Price, QtyStepper, SfImage, SfLink, useDialog } from "./ui";

interface CartApi {
  lines: CartLine[];
  count: number;
  add: (productId: string, options: Record<string, string>, quantity: number) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const CartCtx = createContext<CartApi | null>(null);

export function useCart(): CartApi {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside <CartProvider>");
  return c;
}

const clampQty = (n: number) => Math.max(1, Math.min(MAX_LINE_QTY, Math.floor(n)));

function readStored(key: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((l): CartLine[] => {
      if (typeof l !== "object" || l === null) return [];
      const { productId, quantity, options } = l as Record<string, unknown>;
      if (typeof productId !== "string" || typeof quantity !== "number" || !Number.isFinite(quantity)) return [];
      const opts = typeof options === "object" && options !== null
        ? Object.fromEntries(Object.entries(options).filter((e): e is [string, string] => typeof e[1] === "string"))
        : {};
      return [{ productId, quantity: clampQty(quantity), options: opts }];
    });
  } catch { return []; }
}

/** Merges duplicate keys, clamps quantities and drops lines whose product left the catalogue. */
function sanitize(lines: CartLine[], products: readonly Product[]): CartLine[] {
  const ids = new Set(products.map((p) => p.id));
  const byKey = new Map<string, CartLine>();
  for (const l of lines) {
    if (!ids.has(l.productId)) continue;
    const k = lineKey(l);
    const prev = byKey.get(k);
    byKey.set(k, { ...l, quantity: clampQty((prev?.quantity ?? 0) + l.quantity) });
  }
  return [...byKey.values()].slice(0, MAX_CART_LINES);
}

export function CartProvider({ doc, storageKey, children }: { doc: SiteDocument; storageKey: string; children: ReactNode }) {
  const [raw, setRaw] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // localStorage is read after mount so the server render and first client render agree.
  useEffect(() => {
    setRaw(readStored(storageKey));
    setLoaded(true);
    const onStorage = (e: StorageEvent) => { if (e.key === storageKey) setRaw(readStored(storageKey)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const lines = useMemo(() => sanitize(raw, doc.products), [raw, doc.products]);

  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(lines)); } catch { /* storage full or blocked: the cart still works for this visit */ }
  }, [lines, loaded, storageKey]);

  const add = useCallback((productId: string, options: Record<string, string>, quantity: number) => {
    setRaw((prev) => {
      const k = lineKey({ productId, options });
      const existing = prev.find((l) => lineKey(l) === k);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: clampQty(l.quantity + quantity) } : l));
      return [...prev, { productId, options, quantity: clampQty(quantity) }];
    });
    setDrawerOpen(true);
  }, []);
  const remove = useCallback((key: string) => setRaw((prev) => prev.filter((l) => lineKey(l) !== key)), []);
  const setQuantity = useCallback((key: string, quantity: number) => {
    if (quantity < 1) { remove(key); return; }
    setRaw((prev) => prev.map((l) => (lineKey(l) === key ? { ...l, quantity: clampQty(quantity) } : l)));
  }, [remove]);
  const clear = useCallback(() => setRaw([]), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const api = useMemo<CartApi>(() => ({
    lines, count: lines.reduce((n, l) => n + l.quantity, 0),
    add, setQuantity, remove, clear, drawerOpen, openDrawer, closeDrawer,
  }), [lines, add, setQuantity, remove, clear, drawerOpen, openDrawer, closeDrawer]);

  return <CartCtx.Provider value={api}>{children}</CartCtx.Provider>;
}

/* ---------- shared pieces ---------- */

export const optionText = (options: Record<string, string> | undefined) => Object.entries(options ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ");

function LineItem({ line, compact, onNavigate }: { line: CartLine; compact?: boolean; onNavigate?: () => void }) {
  const { doc, money } = useStore();
  const cart = useCart();
  const product = doc.products.find((p) => p.id === line.productId);
  if (!product) return null;
  const key = lineKey(line);
  const img = product.images[0];
  const opts = optionText(line.options);
  return (
    <li className={cx("sf-line", compact && "is-compact", !product.available && "is-soldout")}>
      <SfLink href={productPath(product)} className="sf-line-media" onClick={onNavigate} tabIndex={-1} aria-hidden>
        <SfImage src={img?.src ?? ""} alt={img?.alt || product.title} label={product.title} />
      </SfLink>
      <div className="sf-line-info">
        <div className="sf-line-top">
          <div>
            <p className="sf-line-title"><SfLink href={productPath(product)} onClick={onNavigate}>{product.title}</SfLink></p>
            {opts && <p className="sf-line-opts">{opts}</p>}
            {!product.available ? <p className="sf-line-warn">Sold out. Remove it to check out.</p> : <Price price={product.price} compareAt={product.compareAtPrice} className="sf-line-unit" />}
          </div>
          <p className="sf-line-total">{product.available ? money(Math.round(product.price * 100) * line.quantity / 100) : "—"}</p>
        </div>
        <div className="sf-line-actions">
          <QtyStepper value={line.quantity} min={0} max={MAX_LINE_QTY} onChange={(n) => cart.setQuantity(key, n)} label={`Quantity of ${product.title}`} />
          <button type="button" className="sf-line-remove" onClick={() => cart.remove(key)} aria-label={`Remove ${product.title}`}>
            <Trash2 size={15} aria-hidden="true" /><span>Remove</span>
          </button>
        </div>
      </div>
    </li>
  );
}

function FreeShipping({ subtotal }: { subtotal: number }) {
  const { doc, money } = useStore();
  const { freeOver, flatRate } = doc.settings.shipping;
  if (freeOver === null || flatRate === 0 || subtotal <= 0) return null;
  const left = Math.max(0, freeOver - subtotal);
  const pct = Math.min(100, Math.round((subtotal / freeOver) * 100));
  return (
    <div className="sf-freeship">
      <p>{left > 0 ? <>You&rsquo;re <strong>{money(left)}</strong> away from free shipping</> : <>You&rsquo;ve unlocked <strong>free shipping</strong></>}</p>
      <div className="sf-freeship-bar" role="progressbar" aria-label="Progress to free shipping" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/* ---------- drawer ---------- */

export function CartDrawer() {
  const { doc, money } = useStore();
  const cart = useCart();
  const panel = useRef<HTMLDivElement>(null);
  useDialog(cart.drawerOpen, cart.closeDrawer, panel);
  const priced = useMemo(() => priceCart(doc, cart.lines), [doc, cart.lines]);
  if (!cart.drawerOpen) return null;
  return (
    <div className="sf-drawer-root">
      <div className="sf-scrim" onClick={cart.closeDrawer} aria-hidden="true" />
      <div ref={panel} className="sf-drawer sf-drawer-right" role="dialog" aria-modal="true" aria-labelledby="sf-cart-title" tabIndex={-1}>
        <div className="sf-drawer-head">
          <h2 id="sf-cart-title" className="sf-drawer-title">Your cart{cart.count > 0 && <span className="sf-drawer-count">{cart.count}</span>}</h2>
          <button type="button" className="sf-icon-btn" onClick={cart.closeDrawer} aria-label="Close cart"><X size={20} aria-hidden="true" /></button>
        </div>
        {cart.lines.length === 0 ? (
          <div className="sf-drawer-empty">
            <ShoppingBag size={36} strokeWidth={1.25} aria-hidden="true" />
            <p>Your cart is empty.</p>
            <SfLink href="/collections/all" className="sf-btn sf-btn-primary" onClick={cart.closeDrawer}>Start shopping</SfLink>
          </div>
        ) : (
          <>
            <FreeShipping subtotal={priced.subtotal} />
            <ul className="sf-lines sf-drawer-body">
              {cart.lines.map((l) => <LineItem key={lineKey(l)} line={l} compact onNavigate={cart.closeDrawer} />)}
            </ul>
            <div className="sf-drawer-foot">
              <div className="sf-sum-row is-strong"><span>Subtotal</span><span>{money(priced.subtotal)}</span></div>
              <p className="sf-fine">Shipping is calculated at checkout.</p>
              <SfLink href="/checkout" className={cx("sf-btn sf-btn-primary sf-btn-block", !priced.lines.length && "is-disabled")} onClick={cart.closeDrawer}>Checkout</SfLink>
              <SfLink href="/cart" className="sf-btn sf-btn-outline sf-btn-block" onClick={cart.closeDrawer}>View cart</SfLink>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- cart page ---------- */

export function CartPage() {
  const { doc, money } = useStore();
  const cart = useCart();
  const priced = useMemo(() => priceCart(doc, cart.lines), [doc, cart.lines]);
  const soldOut = cart.lines.some((l) => !doc.products.find((p) => p.id === l.productId)?.available);
  return (
    <div className="sf-container sf-page-pad">
      <h1 className="sf-h1 sf-page-title">Your cart</h1>
      {cart.lines.length === 0 ? (
        <div className="sf-empty sf-empty-lg">
          <ShoppingBag size={44} strokeWidth={1.25} aria-hidden="true" />
          <h2 className="sf-h3">Your cart is empty</h2>
          <p className="sf-muted">Find something you love and it will be waiting for you here.</p>
          <SfLink href="/collections/all" className="sf-btn sf-btn-primary">Continue shopping</SfLink>
        </div>
      ) : (
        <div className="sf-cart-layout">
          <ul className="sf-lines sf-cart-lines" aria-label="Items in your cart">
            {cart.lines.map((l) => <LineItem key={lineKey(l)} line={l} />)}
          </ul>
          <aside className="sf-summary" aria-label="Order summary">
            <h2 className="sf-h4">Order summary</h2>
            <FreeShipping subtotal={priced.subtotal} />
            <div className="sf-sum-row"><span>Subtotal</span><span>{money(priced.subtotal)}</span></div>
            <div className="sf-sum-row"><span>Shipping</span><span>{priced.shipping === 0 ? "Free" : money(priced.shipping)}</span></div>
            <div className="sf-sum-row is-total"><span>Total</span><span>{money(priced.total)} <small>{priced.currency}</small></span></div>
            {soldOut && <p className="sf-notice sf-notice-warn" role="status">Some items are sold out and won&rsquo;t be included in your order.</p>}
            <SfLink href="/checkout" className={cx("sf-btn sf-btn-primary sf-btn-block", !priced.lines.length && "is-disabled")}>Check out</SfLink>
            <SfLink href="/collections/all" className="sf-btn sf-btn-link sf-btn-block">Continue shopping</SfLink>
          </aside>
        </div>
      )}
    </div>
  );
}
