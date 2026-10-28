import clsx from "clsx";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * One settings block as a card. `icon` gives it a tile in the header so the page scans like a dashboard.
 * `danger` gives destructive actions a red edge so they read differently from routine ones.
 */
export function Section({ title, sub, id, icon: Icon, danger = false, children }: { title: string; sub?: string; id?: string; icon?: LucideIcon; danger?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={clsx("card group scroll-mt-8 p-6 transition-colors duration-300 md:p-7", danger && "border-danger/35 bg-[linear-gradient(180deg,rgba(255,122,107,0.07),rgba(255,122,107,0)_50%),var(--surface)]")}>
      <div className="flex items-center gap-3.5">
        {Icon && (
          <span aria-hidden className={clsx("grid size-10 shrink-0 place-items-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-105", danger ? "bg-danger/12 text-danger ring-danger/30" : "bg-brand-solid/15 text-brand ring-brand-tint")}>
            <Icon className="size-[1.15rem]" />
          </span>
        )}
        <h2 id={id ? `${id}-h` : undefined} className={clsx("font-display text-sm font-bold uppercase tracking-[0.14em]", danger && "text-danger")}>{title}</h2>
      </div>
      {sub && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">{sub}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}
