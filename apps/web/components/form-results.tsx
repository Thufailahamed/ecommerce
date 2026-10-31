"use client";
import type { Analytics } from "@/lib/analytics";
import { int, pct } from "@/lib/use-api";

/**
 * Per signup form: requests and confirmations are counted on the server, so they include shoppers who declined analytics.
 * Impressions come only from browsers that accepted analytics, so the request rate is an estimate and is labelled as one.
 */
export function FormResults({ forms, nameOf }: { forms: NonNullable<Analytics["forms"]>; nameOf: (id: string) => string }) {
  if (forms.length === 0) return null;
  return (
    <section aria-labelledby="forms-h" className="mt-10">
      <h2 id="forms-h" className="font-display text-sm font-bold uppercase tracking-[0.14em]">Email signup forms</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">
        Requests and confirmations are counted on our server. A person counts as confirmed only after they click the link in their inbox. Impressions are reported by visitors&apos; browsers who accepted analytics, so the request rate is an estimate.
      </p>
      <div className="card mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr:hover]:bg-ink/[0.025] [&_td]:px-5 [&_td]:py-3.5 [&_th]:bg-ink/[0.02] [&_th]:px-5 [&_th]:py-3">
            <caption className="sr-only">Email signup forms</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Form</th><th className="text-right font-medium">Impressions</th><th className="text-right font-medium">Sign-up requests</th><th className="text-right font-medium">Request rate (est.)</th><th className="text-right font-medium">Confirmed</th><th className="text-right font-medium">Confirmed rate</th></tr></thead>
            <tbody>{forms.map((f) => (
              <tr key={f.campaignId}>
                <td className="font-medium">{nameOf(f.campaignId)}</td>
                <td className="num text-right">{int(f.impressions)}</td>
                <td className="num text-right">{int(f.requested)}</td>
                <td className="num text-right">{pct(f.requestRate)}</td>
                <td className="num text-right">{int(f.confirmed)}</td>
                <td className="num text-right">{pct(f.confirmRate)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
