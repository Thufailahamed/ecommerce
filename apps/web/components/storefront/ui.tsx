"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import {
  Award, Check, Clock, Coffee, Droplet, Feather, Gift, Globe, Heart, ImageIcon, Leaf, Lock, Mail, MapPin, Package, Phone,
  Plus, Recycle, RefreshCw, ShieldCheck, Smile, Sparkles, Star, Sun, Truck, Zap, type LucideIcon,
} from "lucide-react";
import { isInternal, productCategories, productPath, type ICONS, type Link as DocLink, type Product } from "@convertflow/store-builder";
import { useStore } from "./context";
import { useCart } from "./cart";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- links ---------- */

interface SfLinkProps {
  href: string;
  className?: string | undefined;
  children: ReactNode;
  onClick?: (() => void) | undefined;
  "aria-label"?: string | undefined;
  "aria-current"?: "page" | undefined;
  tabIndex?: number | undefined;
  "aria-hidden"?: boolean | undefined;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Every link in the store. Live internal links are real (prefixed) URLs; in the editor and draft preview the same links
 * report the store path to the host instead of navigating the frame. Section clicks in edit mode never reach here: the
 * section captures them to select itself.
 */
export function SfLink({ href, className, children, onClick, ...rest }: SfLinkProps) {
  const { mode, url, navigate } = useStore();
  if (isInternal(href)) {
    if (mode === "live") return <Link href={url(href)} className={className} onClick={onClick} {...rest}>{children}</Link>;
    const go = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      onClick?.();
      navigate(href);
    };
    return <a href={href} className={className} onClick={go} {...rest}>{children}</a>;
  }
  if (href.startsWith("#")) {
    const jump = (e: MouseEvent<HTMLAnchorElement>) => {
      const el = href.length > 1 ? document.getElementById(href.slice(1)) : null;
      if (!el) return;
      e.preventDefault();
      onClick?.();
      el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    };
    return <a href={href} className={className} onClick={jump} {...rest}>{children}</a>;
  }
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return <a href={href} className={className} onClick={onClick} {...rest}>{children}</a>;
  return <a href={href} className={className} onClick={onClick} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
}

export function ButtonLink({ link, variant = "primary", className }: { link: DocLink; variant?: "primary" | "outline" | "link"; className?: string }) {
  return <SfLink href={link.href} className={cx("sf-btn", `sf-btn-${variant}`, className)}>{link.label}</SfLink>;
}

/* ---------- images ---------- */

export function Placeholder({ label, className }: { label?: string | undefined; className?: string | undefined }) {
  const initial = label?.trim().charAt(0).toUpperCase() ?? "";
  return (
    <div className={cx("sf-ph", className)} aria-hidden="true">
      {initial ? <span className="sf-ph-initial">{initial}</span> : <ImageIcon className="sf-ph-icon" strokeWidth={1.25} />}
    </div>
  );
}

interface SfImageProps { src: string; alt: string; className?: string | undefined; eager?: boolean; label?: string | undefined; sizes?: string }

/** Document image, or the themed placeholder when the source is empty or fails to load. Never a broken image. */
export function SfImage(p: SfImageProps) {
  const { image } = useStore();
  const url = image(p.src);
  if (!url) return <Placeholder label={p.label ?? p.alt} className={p.className} />;
  return <LoadedImage key={url} {...p} url={url} />;
}

function LoadedImage({ url, alt, className, eager, label, sizes }: SfImageProps & { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Placeholder label={label ?? alt} className={className} />;
  return (
    <img
      src={url} alt={alt} className={className} sizes={sizes}
      loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "high" : "auto"}
      onError={() => setFailed(true)}
    />
  );
}

/* ---------- text ---------- */

export function Price({ price, compareAt, className }: { price: number; compareAt?: number | null; className?: string }) {
  const { money } = useStore();
  const sale = compareAt != null && compareAt > price;
  return (
    <span className={cx("sf-price", className)}>
      <span className={cx("sf-price-now", sale && "is-sale")}>{sale && <span className="sf-sr">Sale price </span>}{money(price)}</span>
      {sale && <s className="sf-price-was"><span className="sf-sr">Regular price </span>{money(compareAt)}</s>}
    </span>
  );
}

/** Paragraphs split on blank lines; "- " lines become a bullet list and "## " lines a subheading. Always plain text. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseRich(text), [text]);
  if (!blocks.length) return null;
  return (
    <div className={cx("sf-rich", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "h") return <h3 key={i} className="sf-h4">{b.text}</h3>;
        if (b.kind === "ul") return <ul key={i}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>;
        return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{l}</span>)}</p>;
      })}
    </div>
  );
}

type RichBlock = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] } | { kind: "h"; text: string };

function parseRich(text: string): RichBlock[] {
  const out: RichBlock[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    let para: string[] = [];
    let list: string[] = [];
    const flush = () => {
      if (para.length) out.push({ kind: "p", lines: para });
      if (list.length) out.push({ kind: "ul", items: list });
      para = []; list = [];
    };
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("## ")) { flush(); out.push({ kind: "h", text: line.slice(3).trim() }); }
      else if (line.startsWith("- ")) { if (para.length) { out.push({ kind: "p", lines: para }); para = []; } list.push(line.slice(2).trim()); }
      else { if (list.length) { out.push({ kind: "ul", items: list }); list = []; } para.push(line); }
    }
    flush();
  }
  return out;
}

export const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/* ---------- icons ---------- */

export const ICON_MAP: Record<(typeof ICONS)[number], LucideIcon> = {
  truck: Truck, shield: ShieldCheck, leaf: Leaf, sparkles: Sparkles, heart: Heart, star: Star, gift: Gift, recycle: Recycle,
  clock: Clock, award: Award, package: Package, refresh: RefreshCw, lock: Lock, sun: Sun, droplet: Droplet, zap: Zap,
  globe: Globe, smile: Smile, check: Check, phone: Phone, mail: Mail, map: MapPin, coffee: Coffee, feather: Feather,
};

/* ---------- dialogs ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal behaviour for drawers: focus moves in, Tab cycles inside, Escape closes, the page behind stops scrolling. */
export function useDialog(open: boolean, onClose: () => void, panel: RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (items()[0] ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close.current(); return; }
      if (e.key !== "Tab") return;
      const list = items();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, panel]);
}

/* ---------- products ---------- */

export function ProductCard({ product, eager }: { product: Product; eager?: boolean }) {
  const cart = useCart();
  const [first, second] = product.images;
  const quickAdd = product.available && product.options.length === 0;
  const sale = product.compareAtPrice !== null && product.compareAtPrice > product.price;
  const href = productPath(product);
  return (
    <article className={cx("sf-card", !product.available && "is-soldout")}>
      <div className="sf-card-media">
        <SfLink href={href} className="sf-card-media-link" tabIndex={-1} aria-hidden>
          <SfImage src={first?.src ?? ""} alt={first?.alt || product.title} label={product.title} className="sf-card-img" eager={eager ?? false} />
          {second?.src && <SfImage src={second.src} alt="" className="sf-card-img sf-card-img-alt" />}
        </SfLink>
        <div className="sf-card-badges">
          {!product.available && <span className="sf-badge sf-badge-muted">Sold out</span>}
          {product.available && sale && <span className="sf-badge sf-badge-accent">Sale</span>}
        </div>
        {quickAdd && (
          <button type="button" className="sf-card-add" onClick={() => cart.add(product.id, {}, 1)} aria-label={`Add ${product.title} to cart`}>
            <Plus aria-hidden="true" size={16} strokeWidth={2} /><span>Add</span>
          </button>
        )}
      </div>
      <div className="sf-card-body">
        <h3 className="sf-card-title"><SfLink href={href}>{product.title}</SfLink></h3>
        {product.category && <p className="sf-card-meta">{product.category}</p>}
        <Price price={product.price} compareAt={product.compareAtPrice} className="sf-card-price" />
      </div>
    </article>
  );
}

type Sort = "featured" | "price-asc" | "price-desc" | "title";
const SORTS: { value: Sort; label: string }[] = [
  { value: "featured", label: "Featured" }, { value: "price-asc", label: "Price, low to high" },
  { value: "price-desc", label: "Price, high to low" }, { value: "title", label: "Alphabetical, A–Z" },
];

export function ProductGridView({ products, columns, showFilters = true, showSort = true, emptyText }: {
  products: Product[]; columns: 2 | 3 | 4; showFilters?: boolean; showSort?: boolean; emptyText?: string;
}) {
  const categories = useMemo(() => productCategories(products), [products]);
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("featured");
  const active = category && categories.includes(category) ? category : null;

  const list = useMemo(() => {
    const filtered = active ? products.filter((p) => p.category === active) : products.slice();
    const soldOutLast = (a: Product, b: Product) => Number(!a.available) - Number(!b.available);
    switch (sort) {
      case "price-asc": return filtered.sort((a, b) => a.price - b.price);
      case "price-desc": return filtered.sort((a, b) => b.price - a.price);
      case "title": return filtered.sort((a, b) => a.title.localeCompare(b.title));
      default: return filtered.sort(soldOutLast);
    }
  }, [products, active, sort]);

  const filters = showFilters && categories.length > 1;
  return (
    <div className="sf-grid-view">
      {(filters || showSort) && products.length > 0 && (
        <div className="sf-toolbar">
          {filters ? (
            <div className="sf-chips" role="group" aria-label="Filter by category">
              <button type="button" className="sf-chip" aria-pressed={active === null} onClick={() => setCategory(null)}>All</button>
              {categories.map((c) => (
                <button key={c} type="button" className="sf-chip" aria-pressed={active === c} onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>
          ) : <p className="sf-toolbar-count">{products.length} {products.length === 1 ? "product" : "products"}</p>}
          {showSort && (
            <label className="sf-sort">
              <span>Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {list.length ? (
        <ul className={cx("sf-products", `sf-cols-${columns}`)}>
          {list.map((p, i) => <li key={p.id}><ProductCard product={p} eager={i < 2} /></li>)}
        </ul>
      ) : (
        <div className="sf-empty"><p>{emptyText ?? "No products here yet. Check back soon."}</p></div>
      )}
    </div>
  );
}

export function SectionHeader({ heading, subheading, cta, align = "start", eyebrow }: {
  heading?: string | undefined; subheading?: string | undefined; cta?: DocLink | undefined; align?: "start" | "center"; eyebrow?: string | undefined;
}) {
  if (!heading && !subheading && !cta) return null;
  return (
    <header className={cx("sf-section-head", align === "center" && "is-center")}>
      <div className="sf-section-head-text">
        {eyebrow && <p className="sf-eyebrow">{eyebrow}</p>}
        {heading && <h2 className="sf-h2">{heading}</h2>}
        {subheading && <p className="sf-lead sf-muted">{subheading}</p>}
      </div>
      {cta && <SfLink href={cta.href} className="sf-btn sf-btn-link">{cta.label}<span aria-hidden="true" className="sf-arrow">→</span></SfLink>}
    </header>
  );
}

export function QtyStepper({ value, onChange, label, min = 1, max }: { value: number; onChange: (n: number) => void; label: string; min?: number; max: number }) {
  return (
    <div className="sf-qty" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Decrease quantity">−</button>
      <output aria-live="polite" aria-label="Quantity">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">+</button>
    </div>
  );
}
