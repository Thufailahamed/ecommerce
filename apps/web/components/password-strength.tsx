"use client";
import clsx from "clsx";
import { Check } from "lucide-react";

/** Scores a password by length and variety. A hint for the person choosing it, not a security guarantee. */
export function scorePassword(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (pw.length === 0) return { score: 0, label: "" };
  let points = 0;
  if (pw.length >= 10) points++;
  if (pw.length >= 14) points++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) points++;
  const score = Math.min(4, points) as 0 | 1 | 2 | 3 | 4;
  if (pw.length < 10) return { score: Math.min(score, 1) as 0 | 1, label: "Too short" };
  const label = ["Fair", "Fair", "Good", "Good", "Strong"][score] ?? "Fair";
  return { score, label };
}

const BARS = ["bg-danger", "bg-warn", "bg-warn", "bg-ok"];

/** Four bars that fill as the password gets stronger. Announced politely so screen readers hear the label change. */
export function PasswordStrength({ value }: { value: string }) {
  const { score, label } = scorePassword(value);
  if (!value) return null;
  return (
    <div className="-mt-2 space-y-2" aria-live="polite">
      <div className="grid grid-cols-4 gap-1.5" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={clsx("h-1.5 rounded-full transition-all duration-500", n <= score ? BARS[score - 1] : "bg-ink/[0.08]")} style={{ boxShadow: n <= score ? "0 0 10px currentColor" : undefined }} />
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        {score === 4 && <Check className="size-3.5 text-ok" aria-hidden />}
        <span>Strength: <span className={clsx("font-medium", score === 4 ? "text-ok" : score >= 2 ? "text-warn" : "text-danger")}>{label}</span></span>
      </p>
    </div>
  );
}
