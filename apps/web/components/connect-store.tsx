"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button, ErrorNote, Field, Input, Select } from "./ui";
import { Mascot } from "./illustrations";

const PLATFORMS = [
  { id: "custom", label: "Any website (script snippet)" },
  { id: "shopify", label: "Shopify (snippet or app embed)" },
  { id: "woocommerce", label: "WooCommerce" },
  { id: "bigcommerce", label: "BigCommerce" },
  { id: "magento", label: "Magento" },
] as const;

/** First-run step: register the storefront. Works for any platform via the universal snippet. */
export function ConnectStore() {
  const { me, reload, selectStore } = useSession();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [platform, setPlatform] = useState<string>("custom");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const org = me.organizations[0];
      if (!org) throw new Error("No workspace found");
      const s = await api<{ id: string }>("/api/v1/stores", { method: "POST", body: { organizationId: org.id, platform, name, domain, currency } });
      await reload(); selectStore(s.id);
    } catch (err) { setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card mx-auto max-w-xl space-y-5 p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="eyebrow pt-2">Get started</div>
        <Mascot mood="happy" size={72} />
      </div>
      <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight">Connect your store</h2>
      <p className="text-sm leading-relaxed text-ink-2">Tell us where campaigns will run. You&apos;ll get a one-line snippet that works on any platform.</p>
      <ErrorNote error={error} />
      <Field label="Store name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Store domain" hint="For example shop.example.com"><Input required value={domain} onChange={(e) => setDomain(e.target.value)} /></Field>
      <div className="grid grid-cols-[1fr_96px] gap-3">
        <Field label="Platform"><Select value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field label="Currency"><Input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
      </div>
      <Button type="submit" variant="primary" busy={busy}>Connect store</Button>
    </form>
  );
}
