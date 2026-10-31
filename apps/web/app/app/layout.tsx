"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  Bell, ChevronDown, LogOut, Mail, Megaphone, Menu, MessageSquare, Search, Settings, ShoppingBag, Smartphone, X, type LucideIcon,
} from "lucide-react";
import { CommandPalette, useCommandShortcut } from "@/components/command-palette";
import { SessionProvider, useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Logo } from "@/components/logo";
import { VerifyBanner } from "@/components/verify-banner";
import { Spotlight } from "@/components/marketing/fx";
import { TOOLS, TOOL_ORDER } from "@/lib/tools";
import { CAMPAIGN_TYPES, campaignsHref } from "@/lib/campaign-types";
import { SECTION_LABEL, visibleModules, type ModuleSection } from "@/lib/modules";

interface NavItem { href: string; label: string; icon: LucideIcon; preview?: boolean }

const SETTINGS: NavItem = { href: "/app/settings", label: "Settings", icon: Settings };
const SECTIONS: ModuleSection[] = ["workspace", "audience", "measure", "operate"];

const TOOL_ICON: Record<string, LucideIcon> = { toast: MessageSquare, feed: Bell, upsell: ShoppingBag, sms: Smartphone, email: Mail };

const isActive = (path: string, href: string) => href === "/app" ? path === "/app" : path.startsWith(href);

const linkClass = (active: boolean) => clsx(
  "group flex h-10 items-center gap-3 rounded-xl px-2.5 text-sm font-medium transition-all duration-200",
  active ? "nav-active text-ink" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink",
);
const tileClass = (active: boolean) => clsx(
  "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
  active ? "bg-brand-solid text-white shadow-[0_6px_16px_-6px_rgba(35,80,255,1)]" : "bg-ink/[0.05] text-ink-3 group-hover:text-ink-2",
);

function SectionLabel({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return <div id={id} className={clsx("mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3", className)}>{children}</div>;
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={linkClass(active)}>
      <span className={tileClass(active)}><Icon className="size-4" aria-hidden /></span>
      <span className="truncate">{item.label}</span>
      {item.preview && <span className="ml-auto rounded-full bg-ink/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-3">Preview</span>}
    </Link>
  );
}

/** Campaigns is both a destination and a disclosure for its folders, so the row is split into a link and a chevron. */
function CampaignsRow({ active, open, onToggle, onNavigate }: { active: boolean; open: boolean; onToggle: () => void; onNavigate: () => void }) {
  return (
    <div className={clsx("group flex items-center rounded-xl transition-colors", active ? "nav-active" : "hover:bg-ink/[0.04]")}>
      <Link href="/app/campaigns" onClick={onNavigate} aria-current={active ? "page" : undefined}
        className={clsx("flex h-10 min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 text-sm font-medium transition-colors", active ? "text-ink" : "text-ink-2 group-hover:text-ink")}>
        <span className={tileClass(active)}><Megaphone className="size-4" aria-hidden /></span>
        <span className="truncate">Campaigns</span>
      </Link>
      <button type="button" aria-expanded={open} aria-controls="campaign-folders" aria-label={open ? "Hide campaign folders" : "Show campaign folders"}
        onClick={onToggle} className={clsx("mr-1 grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ink/[0.08] hover:text-ink", active && "text-ink-2")}>
        <ChevronDown className={clsx("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden />
      </button>
    </div>
  );
}

/** The folders themselves, kept presentational so the Suspense fallback and the live links look identical. */
function FolderList({ current, onNavigate }: { current: string | null; onNavigate: () => void }) {
  return (
    <div className="ml-[26px] space-y-0.5 border-l border-line pl-3">
      {CAMPAIGN_TYPES.map((t) => t.shipped ? (
        <Link key={t.key} href={campaignsHref(t.key)} onClick={onNavigate} aria-current={current === t.key ? "page" : undefined}
          className={clsx("group flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors",
            current === t.key ? "bg-brand-soft text-ink" : "text-ink-3 hover:bg-ink/[0.04] hover:text-ink-2")}>
          <span aria-hidden className={clsx("size-1.5 shrink-0 rounded-full transition-colors", current === t.key ? "bg-brand shadow-[0_0_8px_rgba(111,143,255,0.9)]" : "bg-line-strong group-hover:bg-ink-3")} />
          <span className="truncate">{t.label}</span>
        </Link>
      ) : (
        <span key={t.key} aria-disabled="true" className="flex h-8 cursor-not-allowed items-center gap-2 rounded-lg px-2 text-[13px] text-ink-3 opacity-60">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-line" />
          <span className="truncate">{t.label}</span>
          <span className="ml-auto rounded-full bg-ink/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">Soon</span>
        </span>
      ))}
    </div>
  );
}

/** Reads the folder from `?type=`, so the sidebar reflects the list's filter without a second state copy. */
function FolderLinks({ onNavigate }: { onNavigate: () => void }) {
  const path = usePathname();
  const params = useSearchParams();
  const current = path === "/app/campaigns" ? params.get("type") : null;
  return <FolderList current={current} onNavigate={onNavigate} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { me, stores, store, selectStore, capabilities } = useSession();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(path.startsWith("/app/campaigns"));
  const [toolsOpen, setToolsOpen] = useState(path.startsWith("/app/tools/"));
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandShortcut(openPalette);

  const campaignsActive = path.startsWith("/app/campaigns");
  const toolsActive = path.startsWith("/app/tools/");

  // Open a disclosure when its section becomes the current page, but remember a manual choice elsewhere.
  useEffect(() => { if (campaignsActive) setFoldersOpen(true); }, [campaignsActive]);
  useEffect(() => { if (toolsActive) setToolsOpen(true); }, [toolsActive]);

  const org = me.organizations.find((o) => o.id === store?.organizationId) ?? me.organizations[0];
  const role = org?.role ? org.role.charAt(0).toUpperCase() + org.role.slice(1) : "Member";
  // Keep the profile compact: a long email-like organisation name is not useful here.
  const orgLabel = org?.name && org.name.length <= 24 && !org.name.includes("@") ? org.name : null;
  const closeOnNavigate = () => setOpen(false);
  // Navigation comes from the module registry, filtered by this member's permissions and the workspace's capabilities.
  const modules = visibleModules(org?.role, capabilities ?? new Set());
  const inSection = (s: ModuleSection) => modules.filter((m) => m.section === s);

  return (
    <div className="relative min-h-dvh bg-paper md:grid md:grid-cols-[272px_1fr]">
      <Spotlight />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <aside className={clsx(
        "fixed inset-y-0 left-0 z-30 flex w-[280px] max-w-[85vw] on-deep flex-col overflow-hidden border-r border-line bg-deep p-4 shadow-2xl transition-transform duration-300 md:sticky md:inset-y-auto md:left-auto md:top-0 md:h-dvh md:w-[272px] md:max-w-none md:translate-x-0 md:shadow-none",
        open ? "translate-x-0" : "-translate-x-full",
      )}>
        <div aria-hidden className="sidebar-glow pointer-events-none absolute inset-x-0 top-0 h-44" />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="mb-5 flex shrink-0 items-center justify-between px-1">
            <Link href="/app" aria-label="Overview" className="rounded-lg"><Logo /></Link>
            <button className="rounded-lg p-1.5 text-ink-2 hover:bg-ink/[0.06] hover:text-ink md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X className="size-5" /></button>
          </div>

          {stores.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <label htmlFor="store-switch" className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Store</label>
                {stores.length > 1 && <span className="text-[10px] text-ink-3">{stores.length} stores</span>}
              </div>
              <div className="group relative">
                <div aria-hidden className="pointer-events-none flex h-[54px] items-center gap-3 rounded-xl border border-line bg-surface/70 px-3 transition-all group-hover:border-line-strong group-focus-within:border-brand group-focus-within:ring-4 group-focus-within:ring-brand-soft">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-solid to-brand-glow text-xs font-bold uppercase text-white shadow-[0_6px_16px_-8px_rgba(35,80,255,1)]">
                    {store?.name?.charAt(0).toUpperCase() ?? "S"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">{store?.name ?? "Select a store"}</div>
                    <div className="truncate text-[10px] text-ink-3">{store?.domain ?? "No store connected"}</div>
                  </div>
                  <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-focus-within:rotate-180" />
                </div>
                <select id="store-switch" value={store?.id ?? ""} onChange={(e) => selectStore(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-xl opacity-0">
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <button type="button" onClick={openPalette} aria-keyshortcuts="Meta+K Control+K"
            className="group mb-4 flex h-9 w-full shrink-0 items-center gap-2.5 rounded-xl border border-line bg-ink/[0.02] px-3 text-[13px] text-ink-3 transition-all hover:border-brand-tint hover:bg-brand-soft hover:text-ink-2">
            <Search className="size-3.5" aria-hidden />
            <span className="flex-1 text-left">Search</span>
            <kbd aria-hidden className="rounded-md border border-line bg-canvas/40 px-1.5 py-0.5 text-[10px] text-ink-3 group-hover:text-ink-2">⌘K</kbd>
          </button>

          <nav aria-label="Main" className="sidebar-scroll -mr-1 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-3 pr-1">
            {SECTIONS.filter((s) => inSection(s).length > 0).map((section, i) => (
              <div key={section}>
                <SectionLabel id={`${section}-heading`} className={i > 0 ? "mt-5" : undefined}>{SECTION_LABEL[section]}</SectionLabel>
                <div role="group" aria-labelledby={`${section}-heading`} className="space-y-0.5">
              {inSection(section).map((item) => item.key === "campaigns" ? (
                <div key={item.href}>
                  <CampaignsRow active={campaignsActive} open={foldersOpen} onToggle={() => setFoldersOpen((v) => !v)} onNavigate={closeOnNavigate} />
                  <div id="campaign-folders" hidden={!foldersOpen} role="group" aria-label="Campaign folders" className="pb-1">
                    <Suspense fallback={<FolderList current={null} onNavigate={closeOnNavigate} />}>
                      <FolderLinks onNavigate={closeOnNavigate} />
                    </Suspense>
                  </div>
                </div>
              ) : (
                <NavLink key={item.href} item={item} active={isActive(path, item.href)} onNavigate={closeOnNavigate} />
              ))}
                </div>
              </div>
            ))}

            <div className="mt-auto pt-5">
              <button type="button" id="tools-heading" aria-expanded={toolsOpen} aria-controls="tools-list" onClick={() => setToolsOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3 transition-colors hover:text-ink-2">
                <span>Tools</span>
                <ChevronDown className={clsx("size-3 transition-transform", !toolsOpen && "-rotate-90")} aria-hidden />
              </button>
              <div id="tools-list" role="group" aria-labelledby="tools-heading" hidden={!toolsOpen} className="mt-1 space-y-0.5">
                {TOOL_ORDER.map((key) => {
                  const t = TOOLS[key];
                  const href = "/app/tools/" + key;
                  const Icon = TOOL_ICON[key] ?? Megaphone;
                  const active = path.startsWith(href);
                  return (
                    <Link key={key} href={href} onClick={closeOnNavigate} aria-current={active ? "page" : undefined}
                      className={clsx("group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                        active ? "bg-brand-soft text-ink" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink")}>
                      <Icon className={clsx("size-4 shrink-0", active ? "text-brand" : "text-ink-3 group-hover:text-ink-2")} aria-hidden />
                      <span className="truncate">{t.name}</span>
                      {!t.shipped && <span className="ml-auto rounded-full bg-ink/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-3">Soon</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          </nav>

          <div className="shrink-0 border-t border-line pt-3">
            <nav aria-label="Account">
              <NavLink item={SETTINGS} active={isActive(path, SETTINGS.href)} onNavigate={closeOnNavigate} />
            </nav>
            <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-line bg-ink/[0.02] p-2.5">
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-solid to-brand-glow text-[11px] font-bold uppercase text-white ring-2 ring-white/10">
                {me.email.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-ink-2" title={me.email}>{me.email}</div>
                <div className="truncate text-[10px] text-ink-3">{role}{orgLabel ? ` · ${orgLabel}` : ""}</div>
              </div>
              <button type="button" aria-label="Sign out" title="Sign out"
                onClick={async () => { await api("/api/v1/auth/logout", { method: "POST", body: {} }); router.replace("/login"); }}
                className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ink/[0.08] hover:text-ink">
                <LogOut className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {open && <button aria-label="Close navigation" className="fixed inset-0 z-20 bg-[#0a0c14]/45 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />}

      <div className="relative min-w-0">
        <div aria-hidden className="app-glow pointer-events-none fixed inset-x-0 top-0 -z-0 h-[480px]" />
        <div className="on-deep relative flex h-14 items-center border-b border-line bg-deep px-4 md:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-ink-2 hover:bg-ink/[0.06] hover:text-ink"><Menu className="size-5" /></button>
          <div className="ml-3"><Logo /></div>
          <button aria-label="Search" onClick={openPalette} className="ml-auto rounded-lg p-1.5 text-ink-2 hover:bg-ink/[0.06] hover:text-ink"><Search className="size-5" /></button>
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
