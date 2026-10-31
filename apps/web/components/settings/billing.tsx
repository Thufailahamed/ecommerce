"use client";
import { useState } from "react";
import { PLANS } from "@convertflow/contracts";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, ErrorNote, Notice } from "../ui";
import { Section } from "./section";
import { CreditCard } from "lucide-react";

interface Subscription {
  plan: string; status: string; provider: "stripe" | "shopify" | null; currentPeriodEnd: string | null;
  usage: { pageviews: number; aiGenerations: number }; billingConfigured: boolean;
  /** A store in this workspace has the Shopify app installed: plans are then bought through Shopify (App Store rule). */
  shopifyBilling?: { available: boolean; storeIds: string[] };
}

/** What Shopify's return redirect (or Stripe's) put in the URL, in words. */
const RETURN_NOTICE: Record<string, { tone: "ok" | "warn"; text: string }> = {
  success: { tone: "ok", text: "Your plan is active." },
  declined: { tone: "warn", text: "The subscription was declined in Shopify, so your plan has not changed." },
  pending: { tone: "warn", text: "Shopify has not confirmed the subscription yet. This page shows the new plan once it does." },
  error: { tone: "warn", text: "We could not confirm the subscription with Shopify. Your plan has not changed; try again in a moment." },
  cancelled: { tone: "warn", text: "Checkout was cancelled. Your plan has not changed." },
};

export function BillingSection({ store, isOwner }: { store: Store; isOwner: boolean }) {
  const sub = useApi<Subscription>(`/api/v1/billing/subscription?organizationId=${store.organizationId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returned] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("billing")));
  const go = async (key: string, path: string, body: object) => {
    setBusy(key); setError(null);
    try {
      const r = await api<{ url?: string; confirmationUrl?: string }>(path, { method: "POST", body });
      const next = r.url ?? r.confirmationUrl;
      if (next) window.location.href = next; else { setBusy(null); await sub.reload(); }
    } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong"); setBusy(null); }
  };
  const s = sub.data;
  const paid = s && s.plan !== "free";
  const viaShopify = Boolean(s?.shopifyBilling?.available) && s?.provider !== "stripe";
  const canChange = isOwner && (viaShopify || s?.billingConfigured);
  const live = s && (s.status === "active" || s.status === "trialing");
  const notice = returned ? RETURN_NOTICE[returned] : undefined;

  return (
    <Section id="billing" icon={CreditCard} title="Plan and usage" sub="Limits are enforced on the server. If a payment fails, the workspace falls back to Free limits until it is resolved; nothing is deleted, and campaigns your plan no longer covers stop showing until it is.">
      <ErrorNote error={error ?? sub.error} />
      {notice && <div role="status"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
      {s && (
        <p className="text-sm">Current plan: <span className="font-medium capitalize">{s.plan}</span> <Badge tone={live ? "ok" : "warn"}>{s.status.replace("_", " ")}</Badge>
          {s.provider && <span className="ml-2 text-xs text-ink-3">billed {s.provider === "shopify" ? "through Shopify" : "by card"}</span>}
          <span className="num ml-3 text-ink-2">{s.usage.pageviews.toLocaleString()} pageviews · {s.usage.aiGenerations} AI drafts this month</span></p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-2 font-medium">Plan</th><th className="font-medium">Price</th><th className="font-medium">Live campaigns</th><th className="font-medium">AI / month</th><th className="font-medium">Pageviews</th><th className="font-medium">Restock alerts</th><th className="font-medium">SMS verifications</th><th className="font-medium">Experiments</th><th /></tr></thead>
          <tbody>{Object.values(PLANS).map((p) => (
            <tr key={p.id} className="border-b border-line">
              <td className="py-2.5 font-medium capitalize">{p.id}</td><td className="num">${p.priceUsdMonthly}</td><td className="num">{p.maxActiveCampaigns}</td><td className="num">{p.aiGenerationsPerMonth}</td>
              <td className="num">{p.trackedPageviewsPerMonth.toLocaleString()}</td><td className="num">{p.notificationsPerMonth ? p.notificationsPerMonth.toLocaleString() : "–"}</td><td className="num">{p.smsVerificationsPerMonth ? p.smsVerificationsPerMonth.toLocaleString() : "–"}</td><td>{p.experiments ? "Yes" : "–"}</td>
              <td className="text-right">{p.id !== "free" && !(s?.plan === p.id && live) && <Button variant="ghost" busy={busy === `plan-${p.id}`} disabled={!canChange} title={canChange ? undefined : isOwner ? "Billing is not enabled on this deployment" : "Only the workspace owner can change the plan"}
                onClick={() => void (viaShopify
                  ? go(`plan-${p.id}`, "/api/v1/billing/shopify/subscribe", { organizationId: store.organizationId, plan: p.id, ...(s?.shopifyBilling?.storeIds.includes(store.id) ? { storeId: store.id } : {}) })
                  : go(`plan-${p.id}`, "/api/v1/billing/checkout", { organizationId: store.organizationId, plan: p.id }))}>Choose</Button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {viaShopify && <p className="text-xs text-ink-3">This workspace has a store with the Shopify app installed, so plans are charged through your Shopify bill. You approve each change in Shopify; uninstalling the app ends the subscription.</p>}
      {paid && live && isOwner && s?.provider === "shopify" && (
        <Button busy={busy === "cancel"} onClick={() => { if (window.confirm("Cancel the Shopify subscription? The workspace moves to the Free plan; nothing is deleted.")) void go("cancel", "/api/v1/billing/shopify/cancel", { organizationId: store.organizationId }); }}>Cancel subscription</Button>
      )}
      {paid && isOwner && s?.provider !== "shopify" && s?.billingConfigured && (
        <Button busy={busy === "portal"} onClick={() => void go("portal", "/api/v1/billing/portal", { organizationId: store.organizationId })}>Manage billing, invoices or cancel</Button>
      )}
      {s && !s.billingConfigured && !viaShopify && <p className="text-xs text-ink-3">Billing is not enabled on this deployment, so plan changes are unavailable.</p>}
    </Section>
  );
}
