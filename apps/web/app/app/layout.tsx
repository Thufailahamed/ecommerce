"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { BarChart3, Bell, LayoutDashboard, Mail, Megaphone, Menu, MessageSquare, Settings, ShoppingBag, Smartphone, Sparkles, Users, X } from "lucide-react";
import { SessionProvider, useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";
import { VerifyBanner } from "@/components/verify-banner";
import { TOOLS, TOOL_ORDER } from "@/lib/tools";

const NAV = [
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

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 overflow-y-auto">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/app" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
            className={clsx("flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors", active ? "bg-brand-soft font-semibold text-brand" : "text-ink-2 hover:bg-surface hover:text-ink")}>
            <Icon className="size-4" aria-hidden />{label}
          </Link>
        );
      })}
      <div className="mb-1 mt-4 px-3 text-[11px] font-medium uppercase tracking-wide text-ink-3" id="tools-heading">Tools</div>
      <div role="group" aria-labelledby="tools-heading" className="flex flex-col gap-0.5">
        {TOOL_ORDER.map((key) => {
          const t = TOOLS[key];
          const href = "/app/tools/" + key;
          const Icon = TOOL_ICON[key];
          const active = path.startsWith(href);
          return (
            <Link key={key} href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
              className={clsx("flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors", active ? "bg-brand-soft font-semibold text-brand" : "text-ink-2 hover:bg-surface hover:text-ink")}>
              <Icon className="size-4" aria-hidden />{t.name}
              {!t.shipped && <span className="ml-auto rounded bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">Soon</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <aside className={clsx("fixed inset-y-0 left-0 z-30 w-[232px] border-r border-line bg-surface-2 p-4 transition-transform md:static md:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="mb-6 flex items-center justify-between">
          <Link href="/app" aria-label="Overview"><Logo /></Link>
          <button className="md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X className="size-5" /></button>
        </div>
        {stores.length > 0 && (
          <div className="mb-5">
            <label htmlFor="store-switch" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-3">Store</label>
            <select id="store-switch" value={store?.id ?? ""} onChange={(e) => selectStore(e.target.value)}
              className="h-9 w-full rounded-md border border-line bg-surface px-2 text-sm">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        {nav}
        <div className="absolute inset-x-4 bottom-4 border-t border-line pt-3 text-xs text-ink-3">
          <div className="truncate" title={me.email}>{me.email}</div>
          <button className="mt-1 underline underline-offset-2 hover:text-ink"
            onClick={async () => { await api("/api/v1/auth/logout", { method: "POST", body: {} }); router.replace("/login"); }}>Sign out</button>
        </div>
      </aside>
      {open && <button aria-label="Close menu" className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0">
        <div className="flex h-12 items-center border-b border-line px-4 md:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="size-5" /></button>
        </div>
        <VerifyBanner />
        <main className="mx-auto max-w-6xl px-5 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider><Shell>{children}</Shell></SessionProvider>;
}
