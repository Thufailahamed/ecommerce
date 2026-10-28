"use client";
import { useState } from "react";
import { PLANS } from "@convertflow/contracts";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, ErrorNote } from "../ui";
import { Section } from "./section";

interface Subscription { plan: string; status: string; usage: { pageviews: number; aiGenerations: number }; billingConfigured: boolean }

export function BillingSection({ store, isOwner }: { store: Store; isOwner: boolean }) {
  const sub = useApi<Subscription>(`/api/v1/billing/subscription?organizationId=${store.organizationId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (key: string, path: string, body: object) => {
    setBusy(key); setError(null);
    try { const r = await api<{ url: string }>(path, { method: "POST", body }); window.location.href = r.url; }
    catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong"); setBusy(null); }
  };
  const s = sub.data;
  const paid = s && s.plan !== "free";
  const canChange = isOwner && s?.billingConfigured;

  return (
    <Section id="billing" title="Plan and usage" sub="Limits are enforced on the server. If a payment fails, the workspace falls back to Free limits until it is resolved.">
      <ErrorNote error={error ?? sub.error} />
      {s && (
        <p className="text-sm">Current plan: <span className="font-medium capitalize">{s.plan}</span> <Badge tone={s.status === "active" || s.status === "trialing" ? "ok" : "warn"}>{s.status.replace("_", " ")}</Badge>
          <span className="num ml-3 text-ink-2">{s.usage.pageviews.toLocaleString()} pageviews · {s.usage.aiGenerations} AI drafts this month</span></p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-2 font-medium">Plan</th><th className="font-medium">Price</th><th className="font-medium">Live campaigns</th><th className="font-medium">AI / month</th><th className="font-medium">Pageviews</th><th className="font-medium">Restock alerts</th><th className="font-medium">Experiments</th><th /></tr></thead>
          <tbody>{Object.values(PLANS).map((p) => (
            <tr key={p.id} className="border-b border-line">
              <td className="py-2.5 font-medium capitalize">{p.id}</td><td className="num">${p.priceUsdMonthly}</td><td className="num">{p.maxActiveCampaigns}</td><td className="num">{p.aiGenerationsPerMonth}</td>
              <td className="num">{p.trackedPageviewsPerMonth.toLocaleString()}</td><td className="num">{p.notificationsPerMonth ? p.notificationsPerMonth.toLocaleString() : "–"}</td><td>{p.experiments ? "Yes" : "–"}</td>
              <td className="text-right">{p.id !== "free" && s?.plan !== p.id && <Button variant="ghost" busy={busy === `plan-${p.id}`} disabled={!canChange} title={canChange ? undefined : isOwner ? "Billing is not enabled on this deployment" : "Only the workspace owner can change the plan"}
                onClick={() => void go(`plan-${p.id}`, "/api/v1/billing/checkout", { organizationId: store.organizationId, plan: p.id })}>Choose</Button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {paid && isOwner && s?.billingConfigured && (
        <Button busy={busy === "portal"} onClick={() => void go("portal", "/api/v1/billing/portal", { organizationId: store.organizationId })}>Manage billing, invoices or cancel</Button>
      )}
      {s && !s.billingConfigured && <p className="text-xs text-ink-3">Billing is not enabled on this deployment, so plan changes are unavailable.</p>}
    </Section>
  );
}
