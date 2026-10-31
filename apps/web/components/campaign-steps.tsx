"use client";
import Link from "next/link";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";

/** The five steps every campaign moves through, in the order a merchant works: measure, build, check, launch, then read the responses. */
const STEPS = [
  { key: "campaign", label: "Campaign", path: "performance" },
  { key: "builder", label: "Builder", path: "" },
  { key: "preview", label: "Preview", path: "preview" },
  { key: "launch", label: "Launch", path: "launch" },
  { key: "submissions", label: "Submissions", path: "submissions" },
] as const;

export type CampaignStep = (typeof STEPS)[number]["key"];

export function CampaignSteps({ id, current }: { id: string; current: CampaignStep }) {
  return (
    <nav aria-label="Campaign steps" className="mb-6 flex flex-wrap items-center gap-1 text-sm">
      {STEPS.map((s, i) => {
        const on = s.key === current;
        return (
          <span key={s.key} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 text-ink-3" />}
            <Link href={`/app/campaigns/${id}${s.path ? `/${s.path}` : ""}`} aria-current={on ? "step" : undefined}
              className={clsx("rounded-full px-3.5 py-1.5 font-medium transition-colors",
                on ? "bg-brand-solid text-white shadow-[0_8px_20px_-10px_rgba(35,80,255,1)]" : "text-ink-2 hover:bg-ink/[0.06] hover:text-ink")}>
              {s.label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
