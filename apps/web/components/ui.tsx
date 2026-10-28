"use client";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { cloneElement, isValidElement, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean };
export function Button({ variant = "secondary", busy, className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      {...p}
      disabled={disabled || busy}
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "rounded-full bg-brand-solid text-brand-ink hover:bg-[var(--brand-solid-hover)]",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-brand-soft",
        variant === "ghost" && "text-ink-2 hover:bg-brand-soft hover:text-ink",
        variant === "danger" && "border border-danger/40 text-danger hover:bg-danger/10",
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const field = "w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus-visible:border-brand";
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
          <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</label>
          {cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, ...(note ? { "aria-describedby": `${id}-note` } : {}) })}
        </>
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
          {children}
        </label>
      )}
      {note && (error
        ? <span id={`${id}-note`} role="alert" className="mt-1 block text-xs text-danger">{error}</span>
        : <span id={`${id}-note`} className="mt-1 block text-xs text-ink-3">{hint}</span>)}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(field, "h-9", p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(field, "py-2", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={clsx(field, "h-9", p.className)} />;

const tone = { neutral: "bg-line/60 text-ink-2", ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", danger: "bg-danger/15 text-danger" };
export function Badge({ tone: t = "neutral", children }: { tone?: keyof typeof tone; children: ReactNode }) {
  return <span className={clsx("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", tone[t])}>{children}</span>;
}
export const statusTone = (s: string): keyof typeof tone => (s === "active" ? "ok" : s === "scheduled" ? "warn" : s === "paused" ? "warn" : "neutral");

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-pulse rounded bg-line/70", className)} />;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-line px-6 py-14 text-center">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-2">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p role="alert" className="border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[1.75rem] font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="num mt-1 text-2xl font-medium">{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-3">{note}</div>}
    </div>
  );
}
