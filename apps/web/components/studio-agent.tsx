"use client";
import clsx from "clsx";
import { Check, Circle, Loader2, Sparkles, Wand2 } from "lucide-react";

export type AgentState = "idle" | "working" | "done";

/** The agent's mark: a small, glowing core that reads as "something is working on this". Pure CSS, no assets. */
export function AgentOrb({ state = "idle", size = 40, className }: { state?: AgentState; size?: number; className?: string }) {
  return (
    <span aria-hidden data-state={state} className={clsx("agent-orb", className)} style={{ width: size, height: size }}>
      <Sparkles className="relative z-10 text-white" style={{ width: Math.round(size * 0.42), height: Math.round(size * 0.42) }} strokeWidth={1.8} />
    </span>
  );
}

export const RUN_STEPS = [
  { label: "Understanding the brief", detail: "Goal, tool and the guardrails you set." },
  { label: "Reading your catalog", detail: "Real products, prices and stock." },
  { label: "Drafting the campaign", detail: "Copy, layout, trigger and audience." },
  { label: "Checking every claim", detail: "Policy, consent and frequency rules." },
] as const;

/** A live-looking run timeline. It mirrors the phases the server actually goes through, in order. */
export function RunTimeline({ step }: { step: number }) {
  return (
    <ol aria-label="Agent run" className="space-y-0">
      {RUN_STEPS.map((s, i) => {
        const state = i < step ? "done" : i === step ? "active" : "pending";
        const last = i === RUN_STEPS.length - 1;
        return (
          <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span aria-hidden className="agent-connector absolute left-[13px] top-8 h-[calc(100%-1.5rem)] w-px" />}
            <span aria-hidden className={clsx(
              "relative z-10 grid size-[27px] shrink-0 place-items-center rounded-full border transition-colors",
              state === "done" && "border-ok/40 bg-ok/15 text-ok",
              state === "active" && "border-brand-tint bg-brand-soft text-brand shadow-[0_0_22px_-4px_rgba(91,130,255,0.9)]",
              state === "pending" && "border-line bg-surface text-ink-3",
            )}>
              {state === "done" ? <Check className="size-3.5" /> : state === "active" ? <Loader2 className="size-3.5 animate-spin" /> : <Circle className="size-2.5" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={clsx("text-sm font-medium", state === "pending" ? "text-ink-3" : "text-ink")}>{s.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{s.detail}</p>
              {state === "active" && <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-brand"><span aria-hidden className="size-1.5 rounded-full bg-brand" />Working</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export interface DraftChange { label: string; from: string; to: string }

/** A compact before/after card, so a refinement reads as a real edit instead of a vague "done". */
export function ChangeCard({ changes }: { changes: DraftChange[] }) {
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-ok/25 bg-ok/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ok">
        <Wand2 className="size-3" aria-hidden />Draft updated
      </div>
      {changes.map((c) => (
        <div key={c.label} className="min-w-0">
          <div className="text-[11px] font-medium text-ink-2">{c.label}</div>
          {c.from && <p className="mt-0.5 text-xs leading-relaxed text-ink-3 line-through decoration-ink-3/50">{c.from}</p>}
          <p className="text-xs leading-relaxed text-ink">{c.to}</p>
        </div>
      ))}
    </div>
  );
}
