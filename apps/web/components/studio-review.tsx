"use client";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Wand2 } from "lucide-react";
import { describeRuleGroup } from "@convertflow/campaign-engine";
import { CampaignConfig, toolOf } from "@convertflow/contracts";
import type { CampaignRow } from "@/lib/api";
import { summarise } from "@/lib/studio";
import { TOOLS } from "@/lib/tools";
import { CampaignPreview, type Device, type PreviewField } from "@/components/campaign-preview";
import { Badge, Button } from "@/components/ui";

export interface StudioResult {
  campaign: CampaignRow;
  explanation: string;
  /** Fixes the server applied to the model's output (consent wording, form fields, priority...). */
  repairs?: string[];
  /** Repairs plus the editor's usual advice for this campaign. */
  warnings?: string[];
  /** True when this refined an existing draft rather than creating a new one. */
  updated?: boolean;
  /** Model that produced the draft, when the provider reports it. */
  model?: string;
  /** True when the call went through Cloudflare AI Gateway. */
  gateway?: boolean;
  usage?: { inputTokens?: number | null; outputTokens?: number | null };
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</dt><dd className="mt-0.5 break-words text-sm text-ink-2">{children}</dd></div>
);

/** The review step: what the AI built, what the server changed, and what to check before approving. Nothing here publishes. */
export function StudioReview({ result, domain, currency, device = "desktop", onSelectField, selectedField, busy = false, hideExplanation = false }: {
  result: StudioResult; domain: string; currency?: string;
  device?: Device; onSelectField?: (field: PreviewField) => void; selectedField?: PreviewField | null; busy?: boolean; hideExplanation?: boolean;
}) {
  const parsed = CampaignConfig.safeParse(result.campaign.draftConfig);
  if (!parsed.success) return <p role="alert" className="text-sm">The saved draft could not be read. Open it in the editor to fix it.</p>;
  const cfg = parsed.data;
  const tool = toolOf(cfg);
  const repairs = result.repairs ?? [];
  const advice = (result.warnings ?? []).filter((w) => !repairs.includes(w));

  return (
    <div className="space-y-5" data-testid="studio-review">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{TOOLS[tool].name}</Badge><span className="text-sm text-ink-3">{result.updated ? "Draft updated" : "Draft: not live"}</span>
        {result.gateway && <Badge tone="ok">AI Gateway</Badge>}
        {result.model && <span className="ml-auto max-w-[18rem] truncate text-[11px] text-ink-3" title={result.model}>Drafted with {result.model.split("/").pop()}</span>}
      </div>

      <div className="relative overflow-hidden rounded-2xl ring-1 ring-line">
        <CampaignPreview config={cfg} device={device} domain={domain} {...(currency ? { currency } : {})} {...(onSelectField ? { onSelectField } : {})} {...(selectedField ? { selectedField } : {})} />
        {busy && <div className="absolute inset-0 z-20 grid place-items-center bg-canvas/70 backdrop-blur-[2px]"><span role="status" className="inline-flex items-center gap-2 rounded-full border border-brand-tint bg-surface px-4 py-2 text-xs font-medium text-ink-2"><span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brand" />Updating draft…</span></div>}
        {onSelectField && !busy && <div aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-2xl ring-1 ring-inset ring-white/[0.04]" />}
      </div>
      {!hideExplanation && <div className="rounded-xl border border-brand-tint bg-brand-soft px-4 py-3 text-sm leading-relaxed"><div className="mb-1 font-medium">Why this campaign</div>{result.explanation}</div>}

      {repairs.length > 0 && (
        <section aria-labelledby="studio-repairs" className="rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3 text-sm">
          <h3 id="studio-repairs" className="mb-1 flex items-center gap-2 font-medium"><Wand2 className="size-3.5 text-warn" aria-hidden />Changed by the server before saving</h3>
          <p className="mb-2 text-ink-3">The AI does not control these. Check each one.</p>
          <ul className="list-disc space-y-1 pl-5 text-ink-2">{repairs.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
      )}
      {advice.length > 0 && (
        <section aria-labelledby="studio-advice" className="rounded-xl border border-line bg-canvas/50 px-4 py-3 text-sm">
          <h3 id="studio-advice" className="mb-1 flex items-center gap-2 font-medium"><ShieldCheck className="size-3.5 text-brand" aria-hidden />Check before you publish</h3>
          <ul className="list-disc space-y-1 pl-5 text-ink-2">{advice.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
      )}

      <div className="rounded-2xl border border-line bg-canvas/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3"><span aria-hidden className="h-px flex-1 bg-line" />Campaign plan<span aria-hidden className="h-px flex-1 bg-line" /></div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
          <Row label="Tool">{TOOLS[tool].name}</Row>
          <Row label="Format">{cfg.format.replace(/_/g, " ")}</Row>
          <Row label="Trigger">{cfg.trigger.type.replace(/_/g, " ")}</Row>
          <Row label="Goal">{cfg.goal.type.replace(/_/g, " ")}</Row>
          <div className="col-span-2"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">Audience</dt><dd className="mt-0.5 text-sm text-ink-2">{describeRuleGroup(cfg.targeting)}</dd></div>
          <Row label="Frequency">{cfg.frequency.maxImpressionsPerSession} per session</Row>
          {summarise(cfg).map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}
        </dl>
      </div>

      <div className="rounded-2xl border border-brand-tint bg-brand-soft p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <p className="font-display text-xs font-bold uppercase tracking-[0.14em]">Ready for your review</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">This draft is saved but not live. You review, edit and approve it in the editor; nothing is published until you do.</p>
        </div>
        <Link href={`/app/campaigns/${result.campaign.id}`} className="mt-3 inline-flex w-full shrink-0 sm:mt-0 sm:w-auto"><Button variant="primary" className="w-full sm:w-auto">Review in the editor and approve<ArrowRight className="size-4" aria-hidden /></Button></Link>
      </div>
    </div>
  );
}
