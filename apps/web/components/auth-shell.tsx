import Link from "next/link";
import type { ReactNode } from "react";
import { BarChart3, Eye, RotateCcw, Sparkles } from "lucide-react";
import { Logo } from "./logo";
import { IconTile, Mascot } from "./illustrations";
import { ToolVisual } from "./visuals";

const POINTS = [
  { icon: Sparkles, title: "AI drafts, you approve", body: "Nothing goes live by itself." },
  { icon: Eye, title: "Preview that matches your store", body: "The same renderer shoppers see." },
  { icon: RotateCcw, title: "Roll back in one click", body: "Every publish is a version." },
  { icon: BarChart3, title: "Honest analytics", body: "Association is never shown as lift." },
];

/** Split layout shared by every signed-out screen: a brand panel with the character on large screens, the form on the right. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh overflow-hidden lg:grid-cols-[1.05fr_1fr]">
      <aside className="on-deep hero-glow relative hidden flex-col justify-between overflow-hidden border-r border-line p-12 text-deep-ink lg:flex">
        <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 opacity-70" />
        <div aria-hidden className="glow-orb -left-24 bottom-0 size-96 opacity-40" />
        <Link href="/" aria-label="Home" className="relative w-fit"><Logo className="!text-deep-ink" /></Link>

        <div className="relative">
          <div className="grid grid-cols-[1fr_auto] items-end gap-6">
            <div>
              <p className="eyebrow">Approve everything. Prove everything.</p>
              <h2 className="display mt-5 text-5xl leading-[0.95]">Campaigns you can explain to <span className="text-grad">your whole team.</span></h2>
            </div>
            <Mascot mood="happy" size={112} className="mb-1" />
          </div>

          <ul className="mt-10 grid gap-3">
            {POINTS.map(({ icon, title, body }, i) => (
              <li key={title} className="card-flat group flex items-center gap-4 rounded-2xl border border-line bg-ink/[0.03] p-3.5 transition-colors hover:border-brand-tint" style={{ animation: `rise .7s var(--ease-out) ${i * 110}ms both` }}>
                <IconTile icon={icon} />
                <div>
                  <div className="text-[15px] font-semibold">{title}</div>
                  <div className="text-sm text-deep-ink-2">{body}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-end justify-between gap-6">
          <p className="max-w-[16rem] text-xs leading-relaxed text-deep-ink-2">Works with Shopify, WooCommerce, BigCommerce, Magento and custom stores.</p>
          <div className="relative h-28 w-44">
            <div className="float-card absolute left-0 top-0 w-28 rotate-[-6deg] rounded-2xl bg-surface p-1.5 shadow-[0_24px_50px_-20px_rgba(35,80,255,0.8)] ring-1 ring-line" style={{ "--tilt": "-6deg" } as React.CSSProperties}>
              <ToolVisual tool="toast" />
            </div>
            <div className="float-card-b absolute right-0 top-6 w-28 rotate-[5deg] rounded-2xl bg-surface p-1.5 shadow-[0_24px_50px_-20px_rgba(91,59,255,0.8)] ring-1 ring-line" style={{ "--tilt": "5deg" } as React.CSSProperties}>
              <ToolVisual tool="email" />
            </div>
          </div>
        </div>
      </aside>

      <main className="relative grid place-items-center bg-paper px-5 py-12">
        <div aria-hidden className="app-glow pointer-events-none absolute inset-0 -z-0" />
        <div className="relative w-full max-w-sm space-y-6">
          <div className="flex items-center justify-between lg:hidden">
            <Link href="/" aria-label="Home"><Logo /></Link>
            <Mascot size={56} />
          </div>
          <div className="card rounded-[1.75rem] p-7 md:p-8">
            <div className="space-y-5">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
