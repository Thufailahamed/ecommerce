"use client";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { LogoMark } from "../logo";

/** Fades and lifts its children in the first time they scroll into view. `mask` wipes them in from the top instead. */
export function Reveal({ children, className = "", delay = 0, mask, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; mask?: boolean; as?: "div" | "li" | "span" | "h2" | "p" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { el.classList.add("in"); io.disconnect(); } }, { rootMargin: "0px 0px -12% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`${mask ? "rv-mask" : "rv"} ${className}`} style={{ "--d": `${delay}ms` } as CSSProperties}>{children}</Tag>;
}

/** Endless horizontal ticker. Content is rendered twice so the -50% loop is seamless; the copy is hidden from assistive tech. */
export function Marquee({ children, duration = 18, reverse, className = "" }: { children: ReactNode; duration?: number; reverse?: boolean; className?: string }) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <div className={`marquee ${reverse ? "marquee-rev" : ""}`} style={{ "--marquee-dur": `${duration}s` } as CSSProperties}>
        <div className="flex shrink-0">{children}</div>
        <div className="flex shrink-0" aria-hidden>{children}</div>
      </div>
    </div>
  );
}

/**
 * Section that pins once its bottom edge reaches the bottom of the viewport, so the next panel slides up over it.
 * `trap` adds the chamfered tab on its top edge. Sticky top is (viewport − own height), kept current on resize.
 */
export function Panel({ children, className = "", trap = true, id, label }: { children: ReactNode; className?: string; trap?: boolean; id?: string; label?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => { el.style.top = `${Math.min(0, innerHeight - el.offsetHeight)}px`; };
    const ro = new ResizeObserver(set);
    ro.observe(el);
    addEventListener("resize", set);
    set();
    return () => { ro.disconnect(); removeEventListener("resize", set); };
  }, []);
  return <section ref={ref} id={id} aria-label={label} className={`stack ${trap ? "trap" : ""} ${className}`}>{children}</section>;
}

/**
 * A row of cards that stack up as you scroll: the row pins in the middle of the viewport and vertical scroll drives
 * its scrollLeft. Each card is sticky on both sides, so finished cards pile up on the left with a sliver showing and
 * upcoming cards wait in a staggered stack on the right (offsets come from `--i` in `.stack-slider`).
 * The wrapper is (viewport + horizontal travel) tall, so the last card lands exactly as the pin releases.
 * Reduced motion gets a plain horizontally scrollable row.
 */
export function StackSlider({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = outer.current, r = row.current;
    if (!o || !r) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const travel = () => Math.max(0, r.scrollWidth - r.clientWidth);
    const update = () => {
      if (reduced.matches) return;
      const pinTop = (innerHeight - r.offsetHeight) / 2;
      r.scrollLeft = Math.min(travel(), Math.max(0, pinTop - o.getBoundingClientRect().top));
    };
    const size = () => {
      const pinTop = (innerHeight - r.offsetHeight) / 2;
      r.style.top = reduced.matches ? "" : `${pinTop}px`;
      o.style.height = reduced.matches ? "" : `${r.offsetHeight + travel() + Math.max(0, innerHeight - r.offsetHeight)}px`;
      update();
    };
    const ro = new ResizeObserver(size);
    ro.observe(r);
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", size);
    size();
    return () => {
      ro.disconnect();
      removeEventListener("scroll", update);
      removeEventListener("resize", size);
    };
  }, []);
  return (
    <div ref={outer}>
      <div ref={row} className="stack-slider">{children}</div>
    </div>
  );
}

/**
 * Renders children at a fixed design size (default 1000×625) and scales them to fill the parent's width, so a
 * detailed mock reads the same in a phone-width card and a desktop laptop screen.
 */
export function Scaled({ children, width = 1000, height = 625, className = "" }: { children: ReactNode; width?: number; height?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const b = box.current, i = inner.current;
    // Older test environments (jsdom) have no ResizeObserver; the preview then stays at scale(0), which is harmless.
    if (!b || !i || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { i.style.transform = `scale(${b.clientWidth / width})`; });
    ro.observe(b);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className={`relative w-full overflow-hidden ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <div ref={inner} className="absolute left-0 top-0 origin-top-left" style={{ width, height, transform: "scale(0)" }}>{children}</div>
    </div>
  );
}

/** One page-wide listener that feeds the pointer position into the hovered `.spot` card for its glow. */
export function Spotlight() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(".spot") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--sx", `${e.clientX - r.left}px`);
      el.style.setProperty("--sy", `${e.clientY - r.top}px`);
    };
    addEventListener("pointermove", onMove, { passive: true });
    return () => removeEventListener("pointermove", onMove);
  }, []);
  return null;
}

/** Hides the element (via data-hidden) while the page scrolls down past the fold, and brings it back on scroll up. */
export function AutoHide({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let last = scrollY;
    const onScroll = () => {
      const y = scrollY, el = ref.current;
      if (el && Math.abs(y - last) > 6) { el.dataset["hidden"] = String(y > last && y > innerHeight * 0.6); last = y; }
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  return <header ref={ref} className={`site-header ${className}`}>{children}</header>;
}

/** Full-screen logo splash that plays once per page load and gets out of the way (CSS only, skipped for reduced motion). */
export function Preloader() {
  return <div className="preloader" aria-hidden><LogoMark className="size-28" /></div>;
}
