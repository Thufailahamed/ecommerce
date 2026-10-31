"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { Menu, ShoppingBag, X } from "lucide-react";
import { formatMoney, imageUrl, normalizePath, resolveRoute, themeVars, type SiteDocument } from "@convertflow/store-builder";
import { joinPath, StoreProvider, useStore, type StoreContext } from "./context";
import { CartDrawer, CartPage, CartProvider, useCart } from "./cart";
import { CheckoutPage } from "./checkout";
import { CollectionPage, NotFoundView, OrderPage, ProductPage } from "./pages";
import { SectionView, type EditHooks } from "./sections";
import { fontVar, storefrontFontClass } from "./fonts";
import { cx, SfImage, SfLink, useDialog } from "./ui";

export interface StorefrontProps {
  doc: SiteDocument;
  /** Store-relative: "/", "/about", "/products/x", "/collections/all", "/cart", "/checkout", "/orders/<id>". */
  path: string;
  /** live = published site; edit = inside the editor (selection overlays); preview = draft preview, no overlays. */
  mode: "live" | "edit" | "preview";
  /** live: "/s/<slug>"; edit/preview: "". */
  basePath: string;
  assetBase: string;
  slug?: string;
  apiUrl?: string;
  /** live: whether card payment (Stripe) is on. */
  payments?: boolean;
  /** edit/preview: called with the store-relative path instead of real navigation. */
  onNavigate?: (path: string) => void;
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelectSection?: (sectionId: string, pageId: string) => void;
  onHoverSection?: (sectionId: string | null) => void;
  /** Order page: token. */
  searchParams?: Record<string, string>;
}

export function Storefront(p: StorefrontProps): JSX.Element {
  const { doc, mode, basePath, assetBase, onNavigate } = p;
  const currency = doc.settings.currency;
  // Hosts often pass a fresh callback each render; reading it through a ref keeps the context (and every consumer) stable.
  const navRef = useRef(onNavigate);
  useEffect(() => { navRef.current = onNavigate; }, [onNavigate]);
  const ctx = useMemo<StoreContext>(() => ({
    doc, mode, basePath, assetBase, slug: p.slug, apiUrl: p.apiUrl, payments: Boolean(p.payments),
    url: (path) => joinPath(basePath, path),
    navigate: (path) => {
      if (mode === "live") window.location.assign(joinPath(basePath, path));
      else navRef.current?.(path);
    },
    money: (n) => formatMoney(n, currency),
    image: (src) => imageUrl(src, assetBase),
  }), [doc, mode, basePath, assetBase, p.slug, p.apiUrl, p.payments, currency]);

  const style = useMemo(() => themeVars(doc.theme, fontVar) as CSSProperties, [doc.theme]);
  const path = normalizePath(p.path);

  // The dashboard's dark canvas sits behind the store; paint the document in the store's colour so overscroll matches.
  useEffect(() => {
    if (mode !== "live") return;
    const html = document.documentElement;
    const prev = [html.style.background, document.body.style.background];
    html.style.background = document.body.style.background = doc.theme.palette.background;
    return () => { html.style.background = prev[0] ?? ""; document.body.style.background = prev[1] ?? ""; };
  }, [mode, doc.theme.palette.background]);

  // The editor swaps routes in place, so start each page at the top like a real navigation would.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (mode !== "live") window.scrollTo?.({ top: 0 });
  }, [path, mode]);

  return (
    <StoreProvider value={ctx}>
      <CartProvider doc={doc} storageKey={`sf-cart:${p.slug ?? "preview"}`}>
        <div className={cx("sf", `sf-mode-${mode}`, storefrontFontClass)} style={style}>
          <a href="#sf-main" className="sf-skip">Skip to content</a>
          <Announcement />
          <Header path={path} />
          <main id="sf-main" className="sf-main" tabIndex={-1}>
            <Route path={path} p={p} />
          </main>
          <Footer />
          <CartDrawer />
        </div>
      </CartProvider>
    </StoreProvider>
  );
}

function Route({ path, p }: { path: string; p: StorefrontProps }) {
  const route = resolveRoute(p.doc, path);
  const edit: EditHooks = { selectedId: p.selectedId, hoveredId: p.hoveredId, onSelect: p.onSelectSection, onHover: p.onHoverSection };
  switch (route.kind) {
    case "page": {
      const visible = route.page.sections.filter((s) => !s.hidden || p.mode === "edit");
      if (!visible.length) {
        return (
          <div className="sf-container sf-page-pad">
            <h1 className="sf-h1">{route.page.title}</h1>
            {p.mode !== "live" && <div className="sf-hint">This page has no sections yet.</div>}
          </div>
        );
      }
      return <>{visible.map((s) => <SectionView key={s.id} section={s} pageId={route.page.id} edit={edit} />)}</>;
    }
    case "product": return <ProductPage key={route.product.id} product={route.product} />;
    case "collection": return <CollectionPage key={route.collection?.id ?? "all"} collection={route.collection} />;
    case "cart": return <CartPage />;
    case "checkout": return <CheckoutPage />;
    case "order": return <OrderPage orderId={route.orderId} token={p.searchParams?.["token"]} />;
    default: return <NotFoundView />;
  }
}

/* ---------- chrome ---------- */

function Announcement() {
  const { doc } = useStore();
  const a = doc.settings.announcement;
  if (!a.enabled || !a.text) return null;
  return (
    <div className="sf-announce">
      <div className="sf-container">{a.href ? <SfLink href={a.href}>{a.text}<span aria-hidden="true"> →</span></SfLink> : <p>{a.text}</p>}</div>
    </div>
  );
}

function Brand() {
  const { doc } = useStore();
  const logo = doc.brand.logo;
  return (
    <SfLink href="/" className="sf-logo" aria-label={`${doc.brand.name} home`}>
      {logo?.src ? <SfImage src={logo.src} alt={logo.alt || doc.brand.name} eager className="sf-logo-img" /> : <span className="sf-logo-text">{doc.brand.name}</span>}
    </SfLink>
  );
}

function isActive(href: string, path: string) {
  if (!href.startsWith("/")) return false;
  const h = normalizePath(href);
  return h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`);
}

function Header({ path }: { path: string }) {
  const { doc } = useStore();
  const cart = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const links = doc.navigation.header;
  const close = useCallback(() => setMenuOpen(false), []);
  const cartLabel = `Cart, ${cart.count} ${cart.count === 1 ? "item" : "items"}`;
  return (
    <header className="sf-header">
      <div className="sf-container sf-header-inner">
        <div className="sf-header-start">
          {links.length > 0 && (
            <button type="button" className="sf-icon-btn sf-menu-btn" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="sf-mobile-menu" onClick={() => setMenuOpen(true)}>
              <Menu size={22} aria-hidden="true" />
            </button>
          )}
          <Brand />
        </div>
        {links.length > 0 && (
          <nav className="sf-nav" aria-label="Main">
            <ul>
              {links.map((l, i) => (
                <li key={i}><SfLink href={l.href} className="sf-nav-link" aria-current={isActive(l.href, path) ? "page" : undefined}>{l.label}</SfLink></li>
              ))}
            </ul>
          </nav>
        )}
        <div className="sf-header-end">
          <button type="button" className="sf-icon-btn sf-cart-btn" aria-label={cartLabel} onClick={cart.openDrawer}>
            <ShoppingBag size={21} strokeWidth={1.75} aria-hidden="true" />
            {cart.count > 0 && <span className="sf-cart-count" aria-hidden="true">{cart.count > 99 ? "99+" : cart.count}</span>}
          </button>
        </div>
      </div>
      <MobileMenu open={menuOpen} onClose={close} path={path} />
    </header>
  );
}

function MobileMenu({ open, onClose, path }: { open: boolean; onClose: () => void; path: string }) {
  const { doc } = useStore();
  const panel = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, panel);
  if (!open) return null;
  return (
    <div className="sf-drawer-root">
      <div className="sf-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panel} id="sf-mobile-menu" className="sf-drawer sf-drawer-left" role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1}>
        <div className="sf-drawer-head">
          <span className="sf-logo-text">{doc.brand.name}</span>
          <button type="button" className="sf-icon-btn" onClick={onClose} aria-label="Close menu"><X size={20} aria-hidden="true" /></button>
        </div>
        <nav aria-label="Mobile">
          <ul className="sf-mobile-links">
            {doc.navigation.header.map((l, i) => (
              <li key={i}><SfLink href={l.href} onClick={onClose} aria-current={isActive(l.href, path) ? "page" : undefined}>{l.label}</SfLink></li>
            ))}
            <li><SfLink href="/cart" onClick={onClose}>Cart</SfLink></li>
          </ul>
        </nav>
      </div>
    </div>
  );
}

const SOCIAL: { key: keyof SiteDocument["settings"]["social"]; label: string }[] = [
  { key: "instagram", label: "Instagram" }, { key: "tiktok", label: "TikTok" }, { key: "x", label: "X" },
  { key: "facebook", label: "Facebook" }, { key: "youtube", label: "YouTube" }, { key: "pinterest", label: "Pinterest" },
];

function Footer() {
  const { doc } = useStore();
  const social = SOCIAL.flatMap((s) => { const href = doc.settings.social[s.key]; return href ? [{ ...s, href }] : []; });
  const email = doc.settings.contactEmail;
  return (
    <footer className="sf-footer">
      <div className="sf-container">
        <div className="sf-footer-grid">
          <div className="sf-footer-brand">
            <p className="sf-footer-name">{doc.brand.name}</p>
            {doc.brand.tagline && <p className="sf-muted">{doc.brand.tagline}</p>}
            {email && <p><a href={`mailto:${email}`} className="sf-footer-link">{email}</a></p>}
            {social.length > 0 && (
              <ul className="sf-social" aria-label="Social media">
                {social.map((s) => <li key={s.key}><SfLink href={s.href} className="sf-social-link" aria-label={`${doc.brand.name} on ${s.label}`}>{s.label}</SfLink></li>)}
              </ul>
            )}
          </div>
          {doc.navigation.footer.map((g, i) => (
            <nav key={i} className="sf-footer-col" aria-label={g.title}>
              <p className="sf-footer-title">{g.title}</p>
              <ul>{g.links.map((l, j) => <li key={j}><SfLink href={l.href} className="sf-footer-link">{l.label}</SfLink></li>)}</ul>
            </nav>
          ))}
        </div>
        <div className="sf-footer-bottom">
          <p suppressHydrationWarning>© {new Date().getFullYear()} {doc.brand.name}</p>
          {doc.navigation.footerNote && <p>{doc.navigation.footerNote}</p>}
        </div>
      </div>
    </footer>
  );
}
