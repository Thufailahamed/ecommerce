"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, ShoppingCart } from "lucide-react";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, ErrorNote, Field, Input, Notice } from "../ui";
import { Section } from "./section";

export interface WooConnection {
  configured: boolean; connected: boolean; method: "authorize" | "manual" | null; keyPermissions: string | null; verifiedAt: string | null; connectedAt: string | null;
  webhooks: { state: "pending" | "active" | "failed" | "read_only"; error: string | null; count: number; topics: string[]; lastReceivedAt: string | null };
}

const WEBHOOK_TEXT: Record<WooConnection["webhooks"]["state"], string> = {
  active: "Product and order changes arrive by webhook",
  pending: "Webhooks are being set up",
  failed: "The store refused the webhooks. Repair to try again",
  read_only: "Read-only keys: products sync, but changes and orders do not arrive by webhook. Connect again with Read/Write access",
};

/** Where WooCommerce's approval page sent the merchant back: success=1 when they approved, 0 when they declined. */
function readReturn(storeId: string): "approved" | "declined" | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get("woocommerce") !== "returned" || (q.get("store") && q.get("store") !== storeId)) return null;
  return q.get("success") === "1" ? "approved" : "declined";
}

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex gap-3">
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${done ? "text-ok" : "text-ink-3"}`} />
      <div className="min-w-0 space-y-1.5"><p className="text-sm font-medium text-ink">{title} <span className="sr-only">{done ? "(done)" : "(to do)"}</span></p>{children}</div>
    </li>
  );
}

/**
 * WooCommerce stores: connect through WooCommerce's own approval page (or paste keys), then the API checks the keys and
 * creates its product and order webhooks. Sync pages through the catalog; the plugin puts the script and purchase reporting
 * on the storefront. Rendered only for WooCommerce stores.
 */
export function WooCommerceSection({ store, canManage, onChanged }: { store: Store; canManage: boolean; onChanged?: () => void | Promise<void> }) {
  const woo = store.platform === "woocommerce";
  const conn = useApi<WooConnection>(woo ? `/api/v1/stores/${store.id}/woocommerce` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const handled = useRef(false);

  // Back from the approval page: WooCommerce has posted the keys to the API; check them and create the webhooks now.
  useEffect(() => {
    if (!woo || handled.current) return;
    const r = readReturn(store.id);
    if (!r) return;
    handled.current = true;
    // Once only: the section can remount while the store loads, and a reload must not run setup again.
    const clean = new URL(window.location.href);
    for (const k of ["woocommerce", "success", "user_id"]) clean.searchParams.delete(k);
    window.history.replaceState(window.history.state, "", clean.toString());
    if (r === "declined") { setError("The connection was not approved in WooCommerce. Nothing was changed."); return; }
    void (async () => {
      setBusy("setup");
      try { await api(`/api/v1/stores/${store.id}/woocommerce/setup`, { method: "POST" }); setNotice("WooCommerce is connected. Sync your catalog, then install the plugin."); }
      catch (e) { setError(e instanceof ApiError ? e.message : "Could not finish connecting"); }
      finally { setBusy(null); await conn.reload(); await onChanged?.(); }
    })();
  }, [woo, store.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!woo) return null;
  const c = conn.data;
  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong"); } finally { setBusy(null); }
  };

  const authorize = () => run("authorize", async () => {
    const r = await api<{ authorizeUrl: string }>(`/api/v1/stores/${store.id}/woocommerce/authorize`, { method: "POST" });
    window.location.href = r.authorizeUrl; // the store's own WordPress admin: the merchant approves there
  });
  const saveKeys = (e: React.FormEvent) => { e.preventDefault(); void run("keys", async () => {
    await api(`/api/v1/stores/${store.id}/integration/connect`, { method: "POST", body: { kind: "woocommerce", consumerKey: key, consumerSecret: secret } });
    setKey(""); setSecret(""); setNotice("Keys checked and saved."); await conn.reload(); await onChanged?.();
  }); };
  const repair = () => run("setup", async () => { await api(`/api/v1/stores/${store.id}/woocommerce/setup`, { method: "POST" }); await conn.reload(); });
  const disconnect = () => { if (window.confirm("Disconnect WooCommerce? Webhooks are removed from your store and the keys are deleted here. Campaigns and products stay.")) void run("disconnect", async () => {
    await api(`/api/v1/stores/${store.id}/woocommerce`, { method: "DELETE" }); await conn.reload(); await onChanged?.();
  }); };
  async function sync() {
    setBusy("sync"); setError(null); setProgress("Starting…");
    let page: number | null = 1, total = 0;
    try {
      while (page !== null && page <= 400) {
        const r: { imported: number; nextPage: number | null } = await api(`/api/v1/stores/${store.id}/integration/sync`, { method: "POST", body: { page } });
        total += r.imported; page = r.nextPage;
        setProgress(`Imported ${total} products…`);
      }
      setProgress(`Done: ${total} products synced from WooCommerce.`); await onChanged?.();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Sync failed"); setProgress(null); } finally { setBusy(null); }
  }

  const manualForm = (
    <form className="grid max-w-xl gap-3 sm:grid-cols-2" onSubmit={saveKeys}>
      <Field label="Consumer key"><Input required minLength={8} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="ck_…" /></Field>
      <Field label="Consumer secret"><Input required minLength={8} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value.trim())} placeholder="cs_…" /></Field>
      <div className="sm:col-span-2"><Button type="submit" busy={busy === "keys"} disabled={!canManage}>{c?.connected ? "Replace keys" : "Check and save keys"}</Button></div>
    </form>
  );

  return (
    <Section id="woocommerce" icon={ShoppingCart} title="WooCommerce" sub="Connecting lets ConvertFlow read your products and stock through the WooCommerce REST API and receive product and order webhooks. Requests only go to your registered domain, and keys are stored encrypted.">
      <ErrorNote error={error ?? conn.error} />
      {notice && <div role="status"><Notice tone="ok">{notice}</Notice></div>}
      {c && (
        <p className="text-sm">Status: <Badge tone={c.connected ? (c.webhooks.state === "failed" ? "warn" : "ok") : "warn"} dot>{c.connected ? "Connected" : "Not connected"}</Badge>
          {c.connected && c.keyPermissions && <span className="ml-2 text-xs text-ink-3">Access: {c.keyPermissions.replace("_", "/")}</span>}</p>
      )}
      {c && !c.connected && (
        <div className="space-y-4">
          {c.configured
            ? <div className="space-y-2">
                <Button variant="primary" busy={busy === "authorize"} disabled={!canManage} title={canManage ? undefined : "Only admins can connect stores"} onClick={() => void authorize()}>Connect WooCommerce</Button>
                <p className="text-xs text-ink-3">Opens your WordPress admin at <span className="num">{store.domain}</span> to approve Read/Write access. Your site must use HTTPS.</p>
              </div>
            : <Notice tone="warn">One-click connection is not configured on this deployment. Paste REST API keys below instead.</Notice>}
          <details className="rounded-xl border border-line p-4" open={!c.configured}>
            <summary className="cursor-pointer text-sm font-medium text-ink-2">Use API keys instead</summary>
            <p className="my-3 text-xs text-ink-3">WooCommerce, Settings, Advanced, REST API, Add key. Choose Read/Write so the app can create its webhooks; Read-only keys sync products but nothing arrives by webhook.</p>
            {manualForm}
          </details>
        </div>
      )}
      {c?.connected && (
        <ol aria-label="WooCommerce setup" className="space-y-4">
          <Step done={Boolean(c.verifiedAt)} title={c.verifiedAt ? "Store connected" : "Store connected, not checked yet"}>
            <p className="text-xs text-ink-3"><Badge tone={c.webhooks.state === "active" ? "ok" : "warn"}>{c.webhooks.state === "active" ? `${c.webhooks.count} webhooks active` : "Webhooks off"}</Badge> <span className="ml-1">{WEBHOOK_TEXT[c.webhooks.state]}.</span>
              {c.webhooks.lastReceivedAt && <span className="ml-1">Last received {new Date(c.webhooks.lastReceivedAt).toLocaleString()}.</span>}</p>
            <div className="flex flex-wrap gap-2">
              <Button busy={busy === "setup"} disabled={!canManage} onClick={() => void repair()}>{c.verifiedAt ? "Repair" : "Check connection"}</Button>
              {c.webhooks.state === "read_only" && c.configured && <Button disabled={!canManage} busy={busy === "authorize"} onClick={() => void authorize()}>Connect with Read/Write</Button>}
              <Button variant="ghost" busy={busy === "disconnect"} disabled={!canManage} onClick={disconnect}>Disconnect WooCommerce</Button>
            </div>
          </Step>
          <Step done={progress?.startsWith("Done") ?? false} title="Sync your catalog">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" busy={busy === "sync"} onClick={() => void sync()}>Sync catalog now</Button>
              {progress && <span role="status" className="text-sm text-ink-2">{progress}</span>}
            </div>
            <p className="text-xs text-ink-3">Variable products are imported with their variations. A daily pass catches anything a webhook missed.</p>
          </Step>
          <Step done={false} title="Install the ConvertFlow plugin">
            <p className="text-xs text-ink-3">In WordPress, Plugins, Add New, Upload the ConvertFlow plugin, activate it, then open WooCommerce, ConvertFlow and paste your site key <code className="num">{store.siteKey}</code>. It loads campaigns with exact product and cart data, follows the WP Consent API, and reports purchases for attribution.</p>
          </Step>
          <details className="rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink-2">Replace API keys</summary>
            <div className="mt-3">{manualForm}</div>
          </details>
        </ol>
      )}
    </Section>
  );
}
