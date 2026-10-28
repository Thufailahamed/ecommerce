import type { ReactNode } from "react";

export function Section({ title, sub, id, children }: { title: string; sub?: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {sub && <p className="mb-4 mt-1 max-w-2xl text-sm text-ink-2">{sub}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}
