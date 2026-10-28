"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { BarChart3, Bell, ChevronDown, LayoutDashboard, LogOut, Mail, Megaphone, Menu, MessageSquare, Settings, ShoppingBag, Smartphone, Sparkles, Users, X, type LucideIcon } from "lucide-react";
import { SessionProvider, useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";
import { VerifyBanner } from "@/components/verify-banner";
import { Spotlight } from "@/components/marketing/fx";
import { TOOLS, TOOL_ORDER } from "@/lib/tools";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/app/subscribers", label: "Subscribers", icon: Users },
  { href: "/app/studio", label: "AI studio", icon: Sparkles },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

const TOOL_ICON = { toast: MessageSquare, feed: Bell, upsell: ShoppingBag, sms: Smartphone, email: Mail } as const;

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { me, stores, store, selectStore } = useSession();
  const [open, setOpen] = useState(false);

  const link = (active: boolean) =>
    clsx(
      "group flex h-11 items-center gap-3 rounded-xl px-2.5 text-sm font-medium transition-all duration-200",
      active ? "nav-active text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink",
    );
  const tile = (active: boolean) =>
    clsx(
      "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
      active ? "bg-brand-solid text-white shadow-[0_6px_16px_-6px_rgba(35,80,255,1)]" : "bg-white/[0.05] text-ink-3 group-hover:text-ink-2",
    );

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1 overflow-y-auto">
      <div className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Workspace</div>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/app" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={link(active)}>
            <span className={tile(active)}><Icon className="size-4" aria-hidden /></span>
            {label}
          </Link>
        );
      })}
      <div className="mb-2 mt-6 px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3" id="tools-heading">Tools</div>
      <div role="group" aria-labelledby="tools-heading" className="flex flex-col gap-1">
        {TOOL_ORDER.map((key) => {
          const t = TOOLS[key];
          const href = "/app/tools/" + key;
          const Icon = TOOL_ICON[key];
          const active = path.startsWith(href);
          return (
            <Link key={key} href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={link(active)}>
              <span className={tile(active)}><Icon className="size-4" aria-hidden /></span>
              {t.name}
              {!t.shipped && <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3 ring-1 ring-white/10">Soon</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="relative min-h-dvh bg-canvas md:grid md:grid-cols-[256px_1fr]">
      <Spotlight />
      <aside className={clsx(
        "fixed inset-y-0 left-0 z-30 flex w-[256px] flex-col border-r border-line bg-[#080a10]/95 p-4 backdrop-blur-xl transition-transform duration-300 md:static md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="mb-7 flex items-center justify-between px-1.5 pt-1">
          <Link href="/app" aria-label="Overview" className="rounded-lg"><Logo /></Link>
          <button className="rounded-lg p-1.5 text-ink-2 hover:bg-white/[0.06] hover:text-ink md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X className="size-5" /></button>
        </div>

        {stores.length > 0 && (
          <div className="mb-6">
            <label htmlFor="store-switch" className="mb-2 block px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Store</label>
            <div className="relative">
              <select id="store-switch" value={store?.id ?? ""} onChange={(e) => selectStore(e.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-line bg-surface pl-3.5 pr-9 text-sm font-medium transition-colors hover:border-line-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3.5 size-4 text-ink-3" />
            </div>
          </div>
        )}

        {nav}

        <div className="mt-auto pt-6">
          <div className="card-flat flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-solid to-brand-glow text-sm font-bold uppercase text-white">
              {me.email.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-ink-2" title={me.email}>{me.email}</div>
              <button className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-ink-3 hover:text-ink"
                onClick={async () => { await api("/api/v1/auth/logout", { method: "POST", body: {} }); router.replace("/login"); }}>
                <LogOut className="size-3" aria-hidden />Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {open && <button aria-label="Close menu" className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />}

      <div className="relative min-w-0">
        <div aria-hidden className="app-glow pointer-events-none fixed inset-x-0 top-0 -z-0 h-[480px]" />
        <div className="relative flex h-14 items-center border-b border-line bg-canvas/80 px-4 backdrop-blur md:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-ink-2 hover:bg-white/[0.06] hover:text-ink"><Menu className="size-5" /></button>
          <div className="ml-3"><Logo /></div>
        </div>
        <VerifyBanner />
        <main className="relative mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-10">
          {/* Keyed by route so each page plays its entrance again when the user navigates. */}
          <div key={path} className="reveal">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider><Shell>{children}</Shell></SessionProvider>;
}
