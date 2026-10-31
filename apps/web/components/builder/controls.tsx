"use client";
import clsx from "clsx";
import { X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Compact controls for the builder's panels. Text fields keep their own value while focused: the document schema trims
 * and cleans text, so feeding the cleaned value straight back would eat a trailing space mid-word.
 */

export const inputClass = "w-full rounded-lg border border-line bg-ink/[0.03] px-3 text-[13px] text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft disabled:opacity-50";

export function Label({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-ink-2">{children}</label>
      {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
    </div>
  );
}

export function TextField({ label, value, onChange, placeholder, max, hint, type = "text", disabled, autoFocus }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; max?: number; hint?: string; type?: string; disabled?: boolean; autoFocus?: boolean }) {
  const id = useId();
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setLocal(value); }, [value]);
  return (
    <div>
      {label && <Label htmlFor={id} {...(max ? { hint: `${local.length}/${max}` } : hint ? { hint } : {})}>{label}</Label>}
      <input id={id} type={type} value={local} placeholder={placeholder} maxLength={max} disabled={disabled} autoFocus={autoFocus}
        onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setLocal(value); }}
        onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
        className={clsx(inputClass, "h-9")} />
    </div>
  );
}

export function TextAreaField({ label, value, onChange, placeholder, max, rows = 3, disabled }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; max?: number; rows?: number; disabled?: boolean }) {
  const id = useId();
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setLocal(value); }, [value]);
  return (
    <div>
      {label && <Label htmlFor={id} {...(max ? { hint: `${local.length}/${max}` } : {})}>{label}</Label>}
      <textarea id={id} value={local} placeholder={placeholder} maxLength={max} rows={rows} disabled={disabled}
        onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setLocal(value); }}
        onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
        className={clsx(inputClass, "resize-y py-2 leading-relaxed")} />
    </div>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1, prefix }: { label: string; value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; prefix?: string }) {
  const id = useId();
  const [local, setLocal] = useState(value === null ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setLocal(value === null ? "" : String(value)); }, [value]);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">{prefix}</span>}
        <input id={id} type="number" inputMode="decimal" value={local} min={min} max={max} step={step}
          onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setLocal(value === null ? "" : String(value)); }}
          onChange={(e) => { setLocal(e.target.value); const n = e.target.value === "" ? null : Number(e.target.value); if (n === null || Number.isFinite(n)) onChange(n); }}
          className={clsx(inputClass, "h-9 num", prefix && "pl-11")} />
      </div>
    </div>
  );
}

export function SelectField<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select id={id} value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }} className={clsx(inputClass, "h-9 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23a9b0c2%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_10px_center] bg-no-repeat pr-8")}>
        {options.map((o) => <option key={String(o.value)} value={String(o.value)} className="bg-surface">{o.label}</option>)}
      </select>
    </div>
  );
}

/** Two to five choices side by side. */
export function Segmented<T extends string | number>({ label, value, options, onChange, iconOnly }: { label?: string; value: T; options: readonly { value: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void; iconOnly?: boolean }) {
  const id = useId();
  return (
    <div>
      {label && <div id={id} className="mb-1.5 text-[12px] font-medium text-ink-2">{label}</div>}
      <div role="radiogroup" aria-labelledby={label ? id : undefined} className="flex gap-1 rounded-lg border border-line bg-ink/[0.02] p-1">
        {options.map((o) => {
          const Icon = o.icon;
          const on = o.value === value;
          return (
            <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)} title={o.label} aria-label={o.label}
              className={clsx("flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors", on ? "bg-ink/[0.1] text-ink shadow-sm" : "text-ink-3 hover:text-ink-2")}>
              {Icon && <Icon className="size-3.5" aria-hidden />}
              {(!Icon || !iconOnly) && <span className="truncate">{o.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">{label}</label>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{hint}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={clsx("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-brand-solid" : "bg-ink/[0.12]")}>
        <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="flex items-center gap-2.5">
      <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-line-strong shadow-inner" style={{ background: value }}>
        <span className="sr-only">{label} colour</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[12px] font-medium text-ink-2">{label}</label>
        <input id={id} value={local} spellCheck={false} onChange={(e) => { setLocal(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }}
          className="num w-full bg-transparent text-[12px] uppercase text-ink-3 focus:text-ink focus:outline-none" />
      </div>
    </div>
  );
}

export function PanelSection({ title, children, action, description }: { title: string; children: ReactNode; action?: ReactNode; description?: string }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{title}</h3>
        {action}
      </div>
      {description && <p className="-mt-1.5 mb-3 text-[12px] leading-relaxed text-ink-3">{description}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function IconButton({ icon: Icon, label, onClick, active, disabled, tone = "default", size = "md" }: { icon: LucideIcon; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; tone?: "default" | "danger"; size?: "sm" | "md" }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={active}
      className={clsx("grid shrink-0 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        size === "sm" ? "size-7" : "size-8",
        active ? "bg-ink/[0.1] text-ink" : tone === "danger" ? "text-ink-3 hover:bg-danger/10 hover:text-danger" : "text-ink-3 hover:bg-ink/[0.07] hover:text-ink")}>
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
    </button>
  );
}

/** A centred dialog in a portal, closed by Escape or the backdrop. Focus moves into it and back out. */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <button aria-label="Close" data-close className="absolute inset-0 bg-[#0a0c14]/45 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={clsx("pop-in relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-ink/[0.015] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Btn({ children, onClick, variant = "secondary", disabled, busy, type = "button", size = "md", className, title }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; busy?: boolean; type?: "button" | "submit"; size?: "sm" | "md"; className?: string; title?: string }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} title={title}
      className={clsx("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        variant === "primary" && "bg-brand-solid text-white shadow-[0_8px_24px_-10px_rgba(35,80,255,1)] hover:bg-brand-solid-hover",
        variant === "secondary" && "border border-line-strong bg-ink/[0.03] text-ink hover:bg-ink/[0.07]",
        variant === "ghost" && "text-ink-2 hover:bg-ink/[0.06] hover:text-ink",
        variant === "danger" && "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
        className)}>
      {busy && <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}
