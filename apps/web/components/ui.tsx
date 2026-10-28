"use client";
import clsx from "clsx";
import { Inbox, Loader2, type LucideIcon } from "lucide-react";
import { cloneElement, isValidElement, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean };
export function Button({ variant = "secondary", busy, className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      {...p}
      disabled={disabled || busy}
      className={clsx(
        "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-semibold transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-brand-solid text-white shadow-[0_10px_28px_-12px_rgba(35,80,255,1)] hover:bg-brand-solid-hover hover:shadow-[0_0_0_5px_rgba(47,91,255,0.18),0_14px_34px_-12px_rgba(35,80,255,1)]",
        variant === "secondary" && "border border-line-strong bg-white/[0.03] text-ink hover:border-brand-tint hover:bg-brand-soft",
        variant === "ghost" && "h-8 px-3 text-ink-2 hover:bg-white/[0.06] hover:text-ink",
        variant === "danger" && "border border-danger/40 bg-danger/5 text-danger hover:bg-danger/15",
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const field = "w-full rounded-xl border border-line bg-canvas/60 px-3.5 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft";
/**
 * The label wraps only its text and the control, so the accessible name is just the label. Hints and errors sit
 * outside it and are linked with aria-describedby (applied to direct control elements; wrapper divs keep the
 * implicit label association instead).
 */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const id = useId();
  const note = error ?? hint;
  // A single control element gets an explicit for/id link, so its accessible name is exactly the label text
  // (a <select> nested in a <label> would otherwise pull every <option> into the name).
  const direct = isValidElement(children) && children.type !== "div";
  return (
    <div>
      {direct ? (
        <>
          <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-ink-2">{label}</label>
          {cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, ...(note ? { "aria-describedby": `${id}-note` } : {}) })}
        </>
      ) : (
        <label className="block">
          <span className="mb-2 block text-[13px] font-medium text-ink-2">{label}</span>
          {children}
        </label>
      )}
      {note && (error
        ? <span id={`${id}-note`} role="alert" className="mt-1.5 block text-xs text-danger">{error}</span>
        : <span id={`${id}-note`} className="mt-1.5 block text-xs text-ink-3">{hint}</span>)}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(field, "h-10", p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(field, "py-2.5", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={clsx(field, "h-10", p.className)} />;

const tone = {
  neutral: "bg-white/[0.06] text-ink-2 ring-white/10",
  ok: "bg-ok/12 text-ok ring-ok/25",
  warn: "bg-warn/12 text-warn ring-warn/25",
  danger: "bg-danger/12 text-danger ring-danger/25",
};
export function Badge({ tone: t = "neutral", dot = false, children }: { tone?: keyof typeof tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", tone[t])}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
export const statusTone = (s: string): keyof typeof tone => (s === "active" ? "ok" : s === "scheduled" ? "warn" : s === "paused" ? "warn" : "neutral");

/** A small glowing dot for "live" states. Pulses unless the user prefers reduced motion. */
export function LiveDot({ on = true }: { on?: boolean }) {
  return (
    <span aria-hidden className="relative flex size-2">
      {on && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />}
      <span className={clsx("relative inline-flex size-2 rounded-full", on ? "bg-ok shadow-[0_0_8px_rgba(95,217,154,0.9)]" : "bg-ink-3")} />
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("skeleton", className)} />;
}

export function Empty({ title, body, action, icon: Icon = Inbox }: { title: string; body: string; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="relative overflow-hidden rounded-[1.5rem] border border-dashed border-line-strong bg-surface/50 px-6 py-16 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 grid-lines opacity-40" />
      <div className="relative">
        <div aria-hidden className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-brand-solid/15 text-brand ring-1 ring-brand-tint">
          <Icon className="size-6" />
        </div>
        <h3 className="font-display text-base font-bold uppercase tracking-wide">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">{body}</p>
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p role="alert" className="mb-6 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null;
}

/** A soft callout for warnings and notes. Same colour language as the status badges. */
export function Notice({ tone: t = "warn", children, role }: { tone?: "warn" | "ok" | "brand"; children: ReactNode; role?: "status" | "alert" }) {
  const styles = {
    warn: "border-warn/30 bg-warn/10 text-ink",
    ok: "border-ok/30 bg-ok/10 text-ink",
    brand: "border-brand-tint bg-brand-soft text-ink",
  };
  return <div {...(role ? { role } : {})} className={clsx("rounded-xl border px-4 py-3 text-sm leading-relaxed", styles[t])}>{children}</div>;
}

export function PageHeader({ title, sub, actions, eyebrow }: { title: string; sub?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight md:text-3xl">{title}</h1>
        {sub && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Heading for a block of content inside a page. Display face, small caps-like tracking. */
export function SectionTitle({ id, children, sub }: { id?: string; children: ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 id={id} className="font-display text-sm font-bold uppercase tracking-[0.14em] text-ink">{children}</h2>
      {sub && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">{sub}</p>}
    </div>
  );
}

/** A table lives inside a card so its header, rows and hover states read as one surface. */
export const tableClass = "w-full min-w-full text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-white/[0.025] [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_td]:px-5 [&_td]:py-3.5 [&_th]:px-5 [&_th]:py-3 [&_th]:bg-white/[0.02]";

/** Key number on a card: label, a tinted icon, a large mono value and an optional note. */
export function Metric({ label, value, note, icon: Icon }: { label: string; value: string; note?: string; icon?: LucideIcon }) {
  return (
    <div className="spot card relative overflow-hidden p-5 md:p-6">
      <span aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent" />
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">{label}</div>
        {Icon && <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand ring-1 ring-brand-tint"><Icon className="size-4" /></span>}
      </div>
      <div className="num mt-5 text-3xl font-medium tracking-tight md:text-4xl">{value}</div>
      {note && <div className="mt-2 text-xs text-ink-3">{note}</div>}
    </div>
  );
}
