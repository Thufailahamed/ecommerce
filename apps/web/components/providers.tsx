"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ProviderView, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, ErrorNote, Field, Input, Select } from "./ui";

interface List { id: string; name: string }

const KEY_HELP: Record<ProviderView["provider"], string> = {
  klaviyo: "A private API key (starts with pk_) with permission to read lists and to manage profiles and subscriptions.",
  mailchimp: "An API key from Mailchimp (it ends with a data centre such as -us21).",
};

const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

/**
 * Copies confirmed email subscribers to the list the merchant already uses. Honest about what is and is not proven: the
 * connection is labelled "not verified against the live provider" until a check with the merchant's real key has passed.
 */
export function ProviderPanel({ store, refreshKey }: { store: Store; /** Changes whenever a contact's sync status does, so the counts here never lag behind the list. */ refreshKey?: string }) {
  const providers = useApi<ProviderView[]>(`/api/v1/stores/${store.id}/providers`);
  const seen = useRef(refreshKey);
  useEffect(() => { if (seen.current !== refreshKey) { seen.current = refreshKey; void providers.reload(); } }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-labelledby="prov-h" className="mb-10">
      <h2 id="prov-h" className="mb-2 font-display text-sm font-bold uppercase tracking-[0.14em]">Copy subscribers to your email platform</h2>
      <p className="mb-4 max-w-2xl text-sm text-ink-2">
        Connect Klaviyo or Mailchimp and everyone who confirms their subscription is added to the list you choose. Only confirmed subscribers are ever sent. If someone unsubscribes, they are taken off that list too. This app does not send marketing email itself.
      </p>
      <ErrorNote error={providers.error} />
      <div className="grid gap-4 md:grid-cols-2">
        {providers.data?.map((p) => <ProviderCard key={p.provider} store={store} view={p} onChange={providers.reload} />)}
      </div>
    </section>
  );
}

function ProviderCard({ store, view, onChange }: { store: Store; view: ProviderView; onChange: () => Promise<void> }) {
  const base = `/api/v1/stores/${store.id}/providers/${view.provider}`;
  const [apiKey, setApiKey] = useState("");
  const [lists, setLists] = useState<List[] | null>(null);
  const [listId, setListId] = useState("");
  const [syncExisting, setSyncExisting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what); setError(null); setNotice(null);
    try { await fn(); await onChange(); } catch (e) { setError(message(e)); } finally { setBusy(null); }
  }
  const connect = (e: React.FormEvent) => { e.preventDefault(); void run("connect", async () => {
    const r = await api<{ lists: List[] }>(base, { method: "PUT", body: { apiKey } });
    setApiKey(""); setLists(r.lists); setListId(r.lists[0]?.id ?? "");
    setNotice(r.lists.length ? "Connected. Now choose the list new subscribers go to." : "Connected, but this key can see no lists. Create one in your account first.");
  }); };
  const loadLists = () => run("lists", async () => { const l = await api<List[]>(`${base}/lists`); setLists(l); setListId(view.listId ?? l[0]?.id ?? ""); });
  const chooseList = () => run("list", async () => {
    const r = await api<{ queued: number }>(base, { method: "PUT", body: { listId, syncExisting } });
    setLists(null); setNotice(r.queued ? `List chosen. ${r.queued} existing subscriber${r.queued === 1 ? " is" : "s are"} being added.` : "List chosen. New confirmed subscribers will be added to it.");
  });
  const check = () => run("check", async () => { await api(`${base}/check`, { method: "POST", body: {} }); setNotice("The connection works."); });
  const retry = () => run("retry", async () => { const r = await api<{ retried: number }>(`${base}/retry`, { method: "POST", body: {} }); setNotice(`${r.retried} failed ${r.retried === 1 ? "contact was" : "contacts were"} sent again.`); });
  const disconnect = () => run("disconnect", async () => { await api(base, { method: "DELETE" }); setConfirmOff(false); setLists(null); setNotice("Disconnected. People already copied stay on that list."); });

  const c = view.counts;
  const waiting = c.pending;
  return (
    <article className="card p-5" aria-label={`${view.label} connection`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{view.label}</h3>
        {view.connected && <Badge tone={view.status === "error" ? "danger" : "ok"}>{view.status === "error" ? "Needs attention" : "Connected"}</Badge>}
      </div>

      {!view.connected && (
        <form className="mt-3 space-y-3" onSubmit={connect}>
          <Field label={`${view.label} API key`} hint={KEY_HELP[view.provider]}>
            <Input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" busy={busy === "connect"} disabled={apiKey.trim().length < 8}>Connect</Button>
          <p className="text-xs text-ink-3">The key is checked with {view.label} before it is saved, stored encrypted, and never shown again.</p>
        </form>
      )}

      {view.connected && (
        <div className="mt-3 space-y-3 text-sm">
          {/* Honest status: a connection is only called verified once a check with the merchant's real key has passed against the real service. */}
          {view.verified
            ? <p>Verified with {view.label} on {new Date(view.verifiedAt!).toLocaleDateString()}.</p>
            : <p className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-xs leading-relaxed">Not verified against the live provider. This integration follows {view.label}&apos;s public API but has not been tested against the real service by us. Use Check connection with your real key to verify it.</p>}
          {view.status === "error" && view.lastError && <ErrorNote error={view.lastError} />}
          <p>{view.listId ? <>Adding confirmed subscribers to <strong>{view.listName}</strong>.</> : <strong>No list chosen yet: nothing is being copied.</strong>}</p>

          {lists && (
            <div className="space-y-2">
              <Field label={`${view.label} list`}>
                <Select value={listId} onChange={(e) => setListId(e.target.value)}>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
              </Field>
              <label className="flex items-center gap-2"><input type="checkbox" checked={syncExisting} onChange={(e) => setSyncExisting(e.target.checked)} />Also add everyone who is already subscribed</label>
              <Button variant="primary" onClick={() => void chooseList()} busy={busy === "list"} disabled={!listId}>Use this list</Button>
            </div>
          )}

          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-ink-3">Copied</dt><dd className="num text-base font-medium">{c.synced}</dd></div>
            <div><dt className="text-ink-3">Waiting</dt><dd className="num text-base font-medium">{waiting}</dd></div>
            <div><dt className="text-ink-3">Failed</dt><dd className="num text-base font-medium">{c.failed}</dd></div>
          </dl>

          <div className="flex flex-wrap gap-2">
            {!lists && <Button onClick={() => void loadLists()} busy={busy === "lists"}>{view.listId ? "Change list" : "Choose list"}</Button>}
            <Button onClick={() => void check()} busy={busy === "check"}>Check connection</Button>
            {c.failed > 0 && <Button onClick={() => void retry()} busy={busy === "retry"}>Retry {c.failed} failed</Button>}
            {confirmOff
              ? <span className="inline-flex gap-2"><Button variant="danger" onClick={() => void disconnect()} busy={busy === "disconnect"}>Disconnect for good</Button><Button variant="ghost" onClick={() => setConfirmOff(false)}>Cancel</Button></span>
              : <Button variant="ghost" onClick={() => setConfirmOff(true)}>Disconnect</Button>}
          </div>
        </div>
      )}

      <ErrorNote error={error} />
      {notice && <p role="status" className="mt-3 text-xs text-ink-2">{notice}</p>}
    </article>
  );
}
