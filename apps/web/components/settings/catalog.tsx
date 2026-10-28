"use client";
import { useState } from "react";
import { api, ApiError, type Store } from "@/lib/api";
import { Badge, Button, ErrorNote, Field, Input } from "../ui";
import { Section } from "./section";

interface Connection { connected: boolean; kind: string | null }

/** Live catalog connection for WooCommerce and BigCommerce. Syncs one page per request so a big catalog never times out. */
export function CatalogConnect({ store, connection, onChanged }: { store: Store; connection: Connection | undefined; onChanged: () => void | Promise<void> }) {
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [hash, setHash] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const base = `/api/v1/stores/${store.id}/integration`;
  if (store.platform !== "woocommerce" && store.platform !== "bigcommerce") return null;
  const woo = store.platform === "woocommerce";

  async function connect(e: React.FormEvent) {
    e.preventDefault(); setBusy("connect"); setError(null);
    try {
      await api(`${base}/connect`, { method: "POST", body: woo ? { kind: "woocommerce", consumerKey: key, consumerSecret: secret } : { kind: "bigcommerce", storeHash: hash, accessToken: token } });
      setKey(""); setSecret(""); setToken(""); await onChanged();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save credentials"); } finally { setBusy(null); }
  }

  async function sync() {
    setBusy("sync"); setError(null); setProgress("Starting…");
    let page: number | null = 1, total = 0;
    try {
      while (page !== null && page <= 200) {
        const r: { imported: number; nextPage: number | null } = await api(`${base}/sync`, { method: "POST", body: { page } });
        total += r.imported; page = r.nextPage;
        setProgress(`Imported ${total} products…`);
      }
      setProgress(`Done: ${total} products synced.`); await onChanged();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Sync failed"); setProgress(null); } finally { setBusy(null); }
  }

  return (
    <Section id="catalog-connect" title={`${woo ? "WooCommerce" : "BigCommerce"} catalog sync`}
      sub={woo ? "Create a read-only REST API key in WooCommerce (Settings, Advanced, REST API) and paste it here. Keys are encrypted and requests only go to your registered domain." : "Create an API account with read-only Products scope in BigCommerce and paste the store hash and access token. Credentials are encrypted."}>
      <ErrorNote error={error} />
      <p className="text-sm">Status: <Badge tone={connection?.connected ? "ok" : "warn"}>{connection?.connected ? "Connected" : "Not connected"}</Badge></p>
      <form className="grid max-w-xl gap-3 sm:grid-cols-2" onSubmit={connect}>
        {woo ? (<>
          <Field label="Consumer key"><Input required minLength={8} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ck_…" /></Field>
          <Field label="Consumer secret"><Input required minLength={8} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="cs_…" /></Field>
        </>) : (<>
          <Field label="Store hash" hint="The code in your API path, like abc123"><Input required value={hash} onChange={(e) => setHash(e.target.value.toLowerCase())} /></Field>
          <Field label="Access token"><Input required minLength={8} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
        </>)}
        <div className="sm:col-span-2"><Button type="submit" busy={busy === "connect"}>{connection?.connected ? "Replace credentials" : "Save credentials"}</Button></div>
      </form>
      {connection?.connected && (
        <div className="flex items-center gap-3">
          <Button variant="primary" busy={busy === "sync"} onClick={() => void sync()}>Sync catalog now</Button>
          {progress && <span role="status" className="text-sm text-ink-2">{progress}</span>}
        </div>
      )}
    </Section>
  );
}
