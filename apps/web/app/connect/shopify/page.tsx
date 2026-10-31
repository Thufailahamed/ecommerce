"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { Button, ErrorNote, Field, Select } from "@/components/ui";
import { Mascot, Scene } from "@/components/illustrations";

/** Why the Shopify callback sent the merchant here instead of to their store, in words they can act on. */
const ERRORS: Record<string, string> = {
  invalid_signature: "This link was not signed by Shopify, or it is too old. Start again from your Shopify admin.",
  invalid_request: "The link from Shopify is incomplete. Start again from your Shopify admin.",
  expired: "This installation link has expired or was already used. Start again from your Shopify admin or from Settings.",
  shop_mismatch: "Shopify returned a different store than the one you started with. Start again.",
  signed_out: "Sign in with the account that started the installation, then try again from Settings.",
  token_exchange_failed: "Shopify did not confirm the installation. Try again in a moment.",
  missing_scopes: "The app was not given the access it needs (read products and inventory). Install it again and approve the requested access.",
  shop_in_use: "This Shopify store is already connected in another ConvertFlow workspace. Disconnect it there first.",
  link_failed: "We could not attach the store. Try again from Settings.",
};

function Claim() {
  const params = useSearchParams();
  const token = params.get("claim") ?? "";
  const failure = params.get("error");
  const next = `/connect/shopify?claim=${encodeURIComponent(token)}`;
  const [me, setMe] = useState<Me | null | false>(null);
  const [shop, setShop] = useState<string | null>(null);
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<Me>("/api/v1/auth/me").then((m) => {
      setMe(m);
      setOrg(m.organizations.find((o) => o.role === "owner" || o.role === "admin")?.id ?? "");
      return api<{ shop: string }>(`/api/v1/shopify/claim?token=${encodeURIComponent(token)}`).then((r) => setShop(r.shop));
    }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) setMe(false);
      else setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    });
  }, [token]);

  async function claim() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ storeId: string }>("/api/v1/shopify/claim", { method: "POST", body: { token, organizationId: org } });
      try { localStorage.setItem("cf:store", r.storeId); } catch { /* storage unavailable: the dashboard picks a store itself */ }
      window.location.href = `/app/settings?shopify=connected&store=${encodeURIComponent(r.storeId)}`;
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not reach the server."); setBusy(false); }
  }

  if (failure || !token) return (
    <div className="space-y-4 text-center">
      <Scene kind="lost" className="mx-auto w-40" />
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight">Shopify was not connected</h1>
      <p className="text-sm text-ink-2">{ERRORS[failure ?? ""] ?? "This link is incomplete. Start again from your Shopify admin."}</p>
      <Link className="btn btn-ghost w-full" href="/app/settings">Go to Settings</Link>
    </div>
  );
  if (me === false) return (
    <div className="space-y-4 text-center">
      <Scene kind="invite" className="mx-auto w-48" />
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight">Finish installing on Shopify</h1>
      <p className="text-sm text-ink-2">Sign in, or create an account, to choose the workspace this Shopify store belongs to. This link works for 30 minutes.</p>
      <div className="flex flex-col gap-2"><Link className="btn btn-primary w-full" href={`/signup?next=${encodeURIComponent(next)}`}>Create account</Link><Link className="btn btn-ghost w-full" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></div>
    </div>
  );
  if (me === null || (!shop && !error)) return <div className="flex flex-col items-center gap-4 py-4"><Mascot mood="thinking" size={96} /><p className="text-sm text-ink-3">Loading…</p></div>;
  const orgs = me.organizations.filter((o) => o.role === "owner" || o.role === "admin");
  return (
    <div className="space-y-4">
      <Scene kind="check" className="mx-auto w-40" />
      <h1 className="text-center font-display text-2xl font-extrabold uppercase tracking-tight">Connect your Shopify store</h1>
      {shop && <p className="text-center text-sm text-ink-2">Shopify approved the app for <span className="num font-medium text-ink">{shop}</span>. Choose the workspace it belongs to.</p>}
      <ErrorNote error={error} />
      {shop && (orgs.length === 0
        ? <p className="text-sm text-ink-2">You need to be an owner or admin of a workspace to add a store. Ask its owner to invite you as an admin, or create your own workspace.</p>
        : <>
            <Field label="Workspace"><Select value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
            <Button variant="primary" busy={busy} disabled={!org} onClick={() => void claim()} className="w-full">Connect store</Button>
          </>)}
    </div>
  );
}

export default function ConnectShopify() {
  return <AuthShell><Suspense fallback={null}><Claim /></Suspense></AuthShell>;
}
