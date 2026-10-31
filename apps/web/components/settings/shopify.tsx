"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, ShoppingBag } from "lucide-react";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, ErrorNote, Field, Input, Notice } from "../ui";
import { Section } from "./section";

interface Install {
  configured: boolean; shop: string | null; status: "pending" | "installed" | "uninstalled" | "not_installed"; connected: boolean;
  scopes: string[]; missingScopes: string[]; installedAt: string | null; uninstalledAt: string | null;
  setup?: { pixelActive: boolean; embedSettingsSavedAt: string | null; error: string | null; themeEditorUrl: string | null };
}
interface Embed { state: "enabled" | "disabled" | "unknown"; theme: string | null; themeEditorUrl: string }

/** What the OAuth callback put in the URL when it sent the merchant back here. */
const CALLBACK_NOTICE: Record<string, string> = {
  connected: "Shopify is connected. Sync your catalog, then switch on the app embed in your theme.",
};

/** One row of the setup checklist. */
function Step({ done, title, children }: { done: boolean | null; title: string; children?: React.ReactNode }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex gap-3">
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${done ? "text-ok" : "text-ink-3"}`} />
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm font-medium text-ink">{title} <span className="sr-only">{done ? "(done)" : done === null ? "(unknown)" : "(to do)"}</span></p>
        {children}
      </div>
    </li>
  );
}

/**
 * Shopify stores: install the app (Shopify's authorization page), see what it was granted, sync the catalog through the
 * Admin API, and follow a checklist for the storefront pieces: the purchase pixel and the theme embed's settings are set up
 * by the app itself; switching the embed on is the merchant's one click in the theme editor. Rendered only for Shopify stores.
 */
export function ShopifySection({ store, canManage }: { store: Store; canManage: boolean }) {
  const inst = useApi<Install>(store.platform === "shopify" ? `/api/v1/stores/${store.id}/shopify` : null);
  const [shop, setShop] = useState(store.domain.endsWith(".myshopify.com") ? store.domain : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [embed, setEmbed] = useState<Embed | null>(null);
  const [returned] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("shopify")));
  const i = inst.data;
  const connected = Boolean(i?.connected);

  async function checkEmbed() {
    try { setEmbed(await api<Embed>(`/api/v1/stores/${store.id}/shopify/theme-embed`)); }
    catch { setEmbed(null); } // the checklist then just shows the theme editor link
  }
  useEffect(() => { if (connected) void checkEmbed(); }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (store.platform !== "shopify") return null;

  async function connect(e: React.FormEvent) {
    e.preventDefault(); setBusy("connect"); setError(null);
    try {
      const r = await api<{ authorizeUrl: string }>(`/api/v1/stores/${store.id}/shopify/connect`, { method: "POST", body: { shop } });
      window.location.href = r.authorizeUrl; // Shopify's own page: the merchant approves the app there
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not start the installation"); setBusy(null); }
  }

  async function sync() {
    setBusy("sync"); setError(null); setProgress("Starting…");
    let cursor: string | null = null, total = 0, truncated = 0, pages = 0;
    try {
      do {
        const r: { imported: number; nextCursor: string | null; truncatedVariants?: number } = await api(`/api/v1/stores/${store.id}/integration/sync`, { method: "POST", body: { cursor } });
        total += r.imported; truncated += r.truncatedVariants ?? 0; cursor = r.nextCursor; pages++;
        setProgress(`Imported ${total} products…`);
      } while (cursor && pages < 2000);
      setProgress(`Done: ${total} products synced from Shopify.${truncated ? ` ${truncated} product(s) have more than 50 variants; only the first 50 of each were imported.` : ""}`);
    } catch (err) { setError(err instanceof ApiError ? err.message : "Sync failed"); setProgress(null); } finally { setBusy(null); }
  }

  async function retrySetup() {
    setBusy("setup"); setError(null);
    try { await api(`/api/v1/stores/${store.id}/shopify/setup`, { method: "POST" }); await inst.reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Setup failed"); } finally { setBusy(null); }
  }

  const setup = i?.setup;
  const editorUrl = embed?.themeEditorUrl ?? setup?.themeEditorUrl ?? null;

  return (
    <Section id="shopify" icon={ShoppingBag} title="Shopify app" sub="Installing the app lets ConvertFlow read your products and stock through Shopify's Admin API, receive product, stock, order and privacy webhooks, report purchases through its checkout pixel, and bill through Shopify. Campaigns load through the theme app embed.">
      <ErrorNote error={error ?? inst.error} />
      {returned && CALLBACK_NOTICE[returned] && <div role="status"><Notice tone="ok">{CALLBACK_NOTICE[returned]}</Notice></div>}
      {i && !i.configured && <Notice tone="warn">The Shopify app is not configured on this deployment, so it cannot be installed yet. The snippet and manual catalog import still work.</Notice>}
      {i && (
        <p className="text-sm">Status: <Badge tone={i.connected ? "ok" : "warn"} dot>{i.connected ? "Installed" : i.status === "uninstalled" ? "Uninstalled" : "Not installed"}</Badge>
          {i.shop && <span className="num ml-2 text-ink-2">{i.shop}</span>}
          {i.connected && i.scopes.length > 0 && <span className="ml-2 text-xs text-ink-3">Access: {i.scopes.join(", ")}</span>}</p>
      )}
      {i?.connected && i.missingScopes.length > 0 && <Notice tone="warn">The app needs more access than it was granted ({i.missingScopes.join(", ")}). Reconnect to approve it.</Notice>}
      {i?.configured && (!i.connected || i.missingScopes.length > 0) && (
        <form className="flex max-w-xl flex-wrap items-end gap-3" onSubmit={connect}>
          <Field label="Shopify store address" hint="Your permanent .myshopify.com address (Shopify admin, Settings, Domains)">
            <Input required value={shop} placeholder="your-store.myshopify.com" onChange={(e) => setShop(e.target.value.trim())} />
          </Field>
          <Button type="submit" variant="primary" busy={busy === "connect"} disabled={!canManage} title={canManage ? undefined : "Only admins can install apps"}>{i.status === "not_installed" ? "Install on Shopify" : "Reconnect"}</Button>
        </form>
      )}
      {i?.connected && (
        <ol aria-label="Shopify setup" className="space-y-4">
          <Step done title="App installed" />
          <Step done={progress?.startsWith("Done") ? true : false} title="Sync your catalog">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" busy={busy === "sync"} onClick={() => void sync()}>Sync catalog from Shopify</Button>
              {progress && <span role="status" className="text-sm text-ink-2">{progress}</span>}
            </div>
            <p className="text-xs text-ink-3">Afterwards product, stock and order changes arrive by webhook, and a daily pass catches anything missed.</p>
          </Step>
          <Step done={setup?.pixelActive ?? false} title={setup?.pixelActive ? "Purchase pixel active" : "Purchase pixel not active"}>
            <p className="text-xs text-ink-3">The app adds its pixel to Shopify's Customer events for you, with your site key <code className="num">{store.siteKey}</code>. Shopify runs it only for visitors whose privacy choices allow analytics.</p>
            {!setup?.pixelActive && <Button busy={busy === "setup"} disabled={!canManage} onClick={() => void retrySetup()}>Retry setup</Button>}
          </Step>
          <Step done={embed ? (embed.state === "unknown" ? null : embed.state === "enabled") : null} title={embed?.state === "enabled" ? "App embed is on" : "Switch on the app embed"}>
            <p className="text-xs text-ink-3">
              {embed?.state === "enabled" ? `Campaigns load on your live theme${embed.theme ? ` (${embed.theme})` : ""}.`
                : "One click in your theme editor: it opens with ConvertFlow campaigns switched on, then save."}
              {setup?.embedSettingsSavedAt ? " Your site key is already filled in." : ` Paste your site key ${store.siteKey} into the embed's settings.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {editorUrl && <a className="btn btn-ghost" href={editorUrl} target="_blank" rel="noreferrer">Open theme editor <ExternalLink aria-hidden className="size-3.5" /></a>}
              <Button variant="ghost" onClick={() => void checkEmbed()}>Check again</Button>
            </div>
          </Step>
        </ol>
      )}
      {setup?.error && i?.connected && <p className="text-xs text-ink-3">Last setup attempt: {setup.error.replaceAll("_", " ")}. If you installed before the app asked for pixel and theme access, Reconnect to approve it.</p>}
    </Section>
  );
}
