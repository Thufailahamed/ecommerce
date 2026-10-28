import Link from "next/link";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Logo } from "./logo";

/** Split layout shared by every signed-out screen: brand panel on large screens, form on the right. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="on-deep hero-glow relative hidden flex-col justify-between overflow-hidden p-12 text-deep-ink lg:flex">
        <div aria-hidden className="grid-lines pointer-events-none absolute inset-0" />
        <Link href="/" aria-label="Home" className="relative"><Logo className="!text-deep-ink" /></Link>
        <div className="relative">
          <p className="eyebrow">Approve everything. Prove everything.</p>
          <h2 className="display mt-5 text-5xl">Campaigns you can explain to <span className="text-grad">your whole team.</span></h2>
          <ul className="mt-10 space-y-4 text-[15px] text-deep-ink-2">
            {["AI drafts, you approve: nothing goes live by itself", "Live preview that matches your storefront exactly", "Roll back any change in one click", "Analytics that never confuse attribution with lift"].map((t) => (
              <li key={t} className="flex gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-solid text-brand-ink"><Check className="size-3" strokeWidth={3} aria-hidden /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-deep-ink-2">Works with Shopify, WooCommerce, BigCommerce, Magento and custom stores.</p>
      </aside>
      <main className="grid place-items-center px-5 py-10">
        <div className="w-full max-w-sm space-y-5">
          <Link href="/" className="lg:hidden" aria-label="Home"><Logo /></Link>
          {children}
        </div>
      </main>
    </div>
  );
}
