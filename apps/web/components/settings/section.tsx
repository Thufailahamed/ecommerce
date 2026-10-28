import clsx from "clsx";
import type { ReactNode } from "react";

/** One settings block as a card. `danger` gives destructive actions a red edge so they read differently from routine ones. */
export function Section({ title, sub, id, danger = false, children }: { title: string; sub?: string; id?: string; danger?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={clsx("card scroll-mt-8 p-6 md:p-7", danger && "border-danger/35 bg-[linear-gradient(180deg,rgba(255,122,107,0.07),rgba(255,122,107,0)_50%),var(--surface)]")}>
      <h2 id={id ? `${id}-h` : undefined} className={clsx("font-display text-sm font-bold uppercase tracking-[0.14em]", danger && "text-danger")}>{title}</h2>
      {sub && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">{sub}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}
