"use client";
import Link from "next/link";
import { describeRuleGroup } from "@convertflow/campaign-engine";
import { CampaignConfig, toolOf } from "@convertflow/contracts";
import type { CampaignRow } from "@/lib/api";
import { summarise } from "@/lib/studio";
import { TOOLS } from "@/lib/tools";
import { CampaignPreview } from "@/components/campaign-preview";
import { Badge, Button } from "@/components/ui";

export interface StudioResult {
  campaign: CampaignRow;
  explanation: string;
  /** Fixes the server applied to the model's output (consent wording, form fields, priority...). */
  repairs?: string[];
  /** Repairs plus the editor's usual advice for this campaign. */
  warnings?: string[];
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="text-xs uppercase tracking-wide text-ink-3">{label}</dt><dd className="break-words">{children}</dd></div>
);

/** The review step: what the AI built, what the server changed, and what to check before approving. Nothing here publishes. */
export function StudioReview({ result, domain, currency }: { result: StudioResult; domain: string; currency?: string }) {
  const parsed = CampaignConfig.safeParse(result.campaign.draftConfig);
  if (!parsed.success) return <p role="alert" className="text-sm">The saved draft could not be read. Open it in the editor to fix it.</p>;
  const cfg = parsed.data;
  const tool = toolOf(cfg);
  const repairs = result.repairs ?? [];
  const advice = (result.warnings ?? []).filter((w) => !repairs.includes(w));

  return (
    <div className="space-y-5" data-testid="studio-review">
      <div className="flex items-center gap-2"><Badge tone="neutral">{TOOLS[tool].name}</Badge><span className="text-sm text-ink-3">Draft: not live</span></div>
      <CampaignPreview config={cfg} device="desktop" domain={domain} {...(currency ? { currency } : {})} />
      <div className="border-l-2 border-brand bg-brand-soft px-4 py-3 text-sm"><div className="mb-1 font-medium">Why this campaign</div>{result.explanation}</div>

      {repairs.length > 0 && (
        <section aria-labelledby="studio-repairs" className="border border-line px-4 py-3 text-sm">
          <h3 id="studio-repairs" className="mb-1 font-medium">Changed by the server before saving</h3>
          <p className="mb-2 text-ink-3">The AI does not control these. Check each one.</p>
          <ul className="list-disc space-y-1 pl-5">{repairs.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
      )}
      {advice.length > 0 && (
        <section aria-labelledby="studio-advice" className="border border-line px-4 py-3 text-sm">
          <h3 id="studio-advice" className="mb-1 font-medium">Check before you publish</h3>
          <ul className="list-disc space-y-1 pl-5">{advice.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Row label="Tool">{TOOLS[tool].name}</Row>
        <Row label="Format">{cfg.format.replace(/_/g, " ")}</Row>
        <Row label="Trigger">{cfg.trigger.type.replace(/_/g, " ")}</Row>
        <Row label="Goal">{cfg.goal.type.replace(/_/g, " ")}</Row>
        <div className="col-span-2"><dt className="text-xs uppercase tracking-wide text-ink-3">Audience</dt><dd>{describeRuleGroup(cfg.targeting)}</dd></div>
        <Row label="Frequency">{cfg.frequency.maxImpressionsPerSession} per session</Row>
        {summarise(cfg).map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}
      </dl>

      <div>
        <Link href={`/app/campaigns/${result.campaign.id}`}><Button variant="primary">Review in the editor and approve</Button></Link>
        <p className="mt-2 text-xs text-ink-3">This draft is saved but not live. You review, edit and approve it in the editor; nothing is published until you do.</p>
      </div>
    </div>
  );
}
