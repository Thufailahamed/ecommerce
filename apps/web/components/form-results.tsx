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
    <section aria-labelledby="forms-h" className="mt-12">
      <h2 id="forms-h" className="text-sm font-semibold">Email signup forms</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-2">
        Requests and confirmations are counted on our server. A person counts as confirmed only after they click the link in their inbox. Impressions are reported by visitors&apos; browsers who accepted analytics, so the request rate is an estimate.
      </p>
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">Email signup forms</caption>
        <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-2 font-medium">Form</th><th className="text-right font-medium">Impressions</th><th className="text-right font-medium">Sign-up requests</th><th className="text-right font-medium">Request rate (est.)</th><th className="text-right font-medium">Confirmed</th><th className="text-right font-medium">Confirmed rate</th></tr></thead>
        <tbody>{forms.map((f) => (
          <tr key={f.campaignId} className="border-b border-line">
            <td className="py-3 font-medium">{nameOf(f.campaignId)}</td>
            <td className="num text-right">{int(f.impressions)}</td>
            <td className="num text-right">{int(f.requested)}</td>
            <td className="num text-right">{pct(f.requestRate)}</td>
            <td className="num text-right">{int(f.confirmed)}</td>
            <td className="num text-right">{pct(f.confirmRate)}</td>
          </tr>))}</tbody>
      </table>
    </section>
  );
}
