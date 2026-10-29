import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";
import { BRAND, BRAND_FULL } from "@/lib/brand";
import { Logo } from "../logo";
import { AutoHide } from "./fx";

const NAV = [["How it works", "/#how"], ["Features", "/#features"], ["Platforms", "/#platforms"], ["Pricing", "/#pricing"], ["FAQ", "/#faq"]] as const;

/** Floating header: a graphite pill for brand + navigation, and a separate blue pill for the main call to action. */
export function SiteHeader() {
  return (
    <AutoHide className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center gap-2 px-3 pt-4">
      <div className="pointer-events-auto flex h-12 items-center gap-1 rounded-2xl bg-[#12141c]/80 pl-4 pr-1.5 text-white ring-1 ring-white/10 backdrop-blur-xl">
        <Link href="/" aria-label={`${BRAND_FULL} home`} className="mr-1 sm:mr-3"><Logo /></Link>
        <nav aria-label="Primary" className="hidden items-center text-[13px] font-medium lg:flex">
          {NAV.map(([l, h]) => <a key={h} href={h} className="rounded-xl px-3 py-2 text-white/80 transition-colors hover:bg-white/5 hover:text-white">{l}</a>)}
          <Link href="/login" className="rounded-xl px-3 py-2 text-white/80 transition-colors hover:bg-white/5 hover:text-white">Sign in</Link>
        </nav>
        <details className="relative lg:hidden">
          <summary aria-label="Menu" className="grid size-9 cursor-pointer list-none place-items-center rounded-xl hover:bg-white/5 [&::-webkit-details-marker]:hidden"><Menu className="size-5" /></summary>
          <div className="absolute right-0 top-12 w-56 rounded-2xl bg-[#12141c] p-2 ring-1 ring-white/10 shadow-[var(--shadow-lift)]">
            {NAV.map(([l, h]) => <a key={h} href={h} className="block rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-white/5">{l}</a>)}
            <Link href="/login" className="block rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-white/5">Sign in</Link>
          </div>
        </details>
      </div>
      <Link href="/signup" className="pointer-events-auto btn btn-primary !h-12 !rounded-2xl ring-1 ring-white/25 !px-4 text-[13px] sm:!px-6">Start free</Link>
    </AutoHide>
  );
}

const COLS = [
  ["Product", [["How it works", "/#how"], ["Features", "/#features"], ["Pricing", "/#pricing"], ["FAQ", "/#faq"]]],
  ["Platforms", [["Shopify", "/#platforms"], ["WooCommerce", "/#platforms"], ["BigCommerce", "/#platforms"], ["Magento", "/#platforms"], ["Any website", "/#platforms"]]],
  ["Account", [["Sign in", "/login"], ["Create workspace", "/signup"], ["Privacy", "/privacy"], ["Terms", "/terms"]]],
] as const;

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-canvas text-white">
      <div aria-hidden className="glow-orb left-1/2 top-0 h-[30vw] w-[70vw] -translate-x-1/2 opacity-60" />
      <div aria-hidden className="display select-none whitespace-nowrap px-2 relative pt-10 text-center text-[8.4vw] leading-[0.9] text-grad">{BRAND.name}</div>
      <div className="wrap grid gap-10 border-t border-white/10 py-12 md:grid-cols-[1.4fr_2fr]">
        <div>
          <p className="max-w-sm text-[15px] leading-relaxed text-white/60">On-site campaigns that you describe, review and approve. Built for any online store.</p>
          <Link href="/signup" className="btn btn-primary mt-6">Start free <ArrowUpRight className="size-4" aria-hidden /></Link>
        </div>
        <div className="grid grid-cols-2 gap-8 rounded-3xl bg-surface p-6 ring-1 ring-white/5 sm:grid-cols-3 md:p-8">
          {COLS.map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <h2 className="text-[13px] font-semibold text-white/50">{title}</h2>
              <ul className="mt-4 space-y-2.5 text-[15px]">
                {links.map(([l, h]) => <li key={l}><Link href={h} className="text-white/85 transition-colors hover:text-brand-glow">{l}</Link></li>)}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="wrap flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-6 text-xs text-white/55">
        <span>© {new Date().getFullYear()} {BRAND_FULL}</span>
        <span>All trademarks belong to their owners; no affiliation with the platforms named here is implied.</span>
        <span className="num">Prices in USD</span>
      </div>
    </footer>
  );
}
