"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, Users } from "lucide-react";
import { apiErase, apiFile, apiPage, ApiError, type Contact, type ContactSync, type Store } from "@/lib/api";
import { NeedStore } from "@/components/need-store";
import { ProviderPanel } from "@/components/providers";
import { Badge, Button, Empty, ErrorNote, Input, Notice, PageHeader, Select, Skeleton, tableClass } from "@/components/ui";

const STATUS_LABEL = { none: "None", pending: "Waiting to confirm", subscribed: "Subscribed", unsubscribed: "Unsubscribed" } as const;
const TONE = { none: "neutral", pending: "warn", subscribed: "ok", unsubscribed: "neutral" } as const;
const PROVIDER_NAME = { klaviyo: "Klaviyo", mailchimp: "Mailchimp" } as const;

/** What the provider copy of this person is doing, in words: a removal and a copy mean different things. */
function syncLabel(s: ContactSync): { text: string; tone: "ok" | "warn" | "danger" | "neutral" } {
  const name = PROVIDER_NAME[s.provider];
  if (s.status === "synced") return { text: s.action === "subscribe" ? `In ${name}` : `Removed from ${name}`, tone: s.action === "subscribe" ? "ok" : "neutral" };
  if (s.status === "pending") return { text: s.action === "subscribe" ? `Adding to ${name}…` : `Removing from ${name}…`, tone: "warn" };
  if (s.status === "failed") return { text: `${name} failed`, tone: "danger" };
  return { text: `Not sent to ${name}`, tone: "neutral" };
}
type Filter = "all" | Contact["emailStatus"];

const where = (source: string) => (source.startsWith("form:") ? "Signup form" : source === "restock_unsubscribe" ? "Back-in-stock opt-out" : source);
const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

function View({ store }: { store: Store }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [lookup, setLookup] = useState("");
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<Contact[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [erasing, setErasing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useCallback((after: string | null) => {
    const q = new URLSearchParams({ limit: "50" });
    if (filter !== "all") { q.set("channel", "email"); q.set("status", filter); }
    if (email) q.set("email", email);
    if (after) q.set("cursor", after);
    return `/api/v1/stores/${store.id}/contacts?${q}`;
  }, [store.id, filter, email]);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    apiPage<Contact>(query(null))
      .then((r) => { if (live) { setRows(r.data); setCursor(r.nextCursor); } })
      .catch((e: unknown) => { if (live) setError(message(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query]);

  // A copy to a list provider finishes a moment after the shopper confirms, so while any is still waiting, refresh their
  // status every few seconds instead of leaving "Adding to Klaviyo…" on screen after it is done. It gives up after about two minutes:
  // a job that is backing off from a provider outage stays as it is until its next try.
  const waiting = rows.some((c) => c.sync?.some((s) => s.status === "pending"));
  useEffect(() => {
    if (!waiting) return;
    let live = true, polls = 0;
    const timer = setInterval(() => {
      if (++polls > 30) { clearInterval(timer); return; }
      apiPage<Contact>(query(null))
        .then((r) => { if (live) { const fresh = new Map(r.data.map((c) => [c.id, c])); setRows((cur) => cur.map((c) => fresh.get(c.id) ?? c)); } })
        .catch(() => undefined);
    }, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [waiting, query]);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try { const r = await apiPage<Contact>(query(cursor)); setRows((x) => [...x, ...r.data]); setCursor(r.nextCursor); }
    catch (e) { setError(message(e)); } finally { setLoading(false); }
  }

  async function erase(id: string) {
    setError(null);
    try {
      const r = await apiErase(`/api/v1/stores/${store.id}/contacts/${id}`);
      setRows((x) => x.filter((c) => c.id !== id)); setErasing(null);
      setNotice(r.providerCleanupFailed.length
        ? `Erased here, but we could not reach ${r.providerCleanupFailed.map((p) => PROVIDER_NAME[p as keyof typeof PROVIDER_NAME] ?? p).join(" and ")} to take them off the list. Remove them there yourself.`
        : "Erased. Their consent history was deleted with them, and they were taken off any connected list. Their profile in Klaviyo or Mailchimp, if any, is not deleted: remove it there if you need to.");
    } catch (e) { setError(message(e)); setErasing(null); }
  }

  async function exportCsv() {
    setExporting(true); setError(null); setNotice(null);
    try {
      const { blob, truncated } = await apiFile(`/api/v1/stores/${store.id}/contacts/export`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "subscribers.csv"; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setNotice(truncated ? "Exported the first 50,000 subscribers. The list is longer than one export holds." : "Exported everyone who is currently subscribed.");
    } catch (e) { setError(message(e)); } finally { setExporting(false); }
  }

  return (
    <>
      <PageHeader eyebrow="Audience" title="Subscribers" sub="People who signed up through your email forms. Only people who confirmed from their inbox count as subscribed; anyone waiting to confirm is never contacted."
        actions={<Button onClick={() => void exportCsv()} busy={exporting}><Download className="size-4" />Export subscribed (CSV)</Button>} />
      <ErrorNote error={error} />
      {notice && <div role="status" className="mb-6"><Notice tone="brand">{notice}</Notice></div>}

      <ProviderPanel store={store} refreshKey={rows.map((c) => (c.sync ?? []).map((s) => `${s.provider}:${s.status}:${s.action}`).join(",")).join("|")} />

      <div className="card-flat mb-5 flex flex-wrap items-center gap-2 p-2">
        <Select aria-label="Status" className="w-full sm:w-52" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All contacts</option><option value="subscribed">Subscribed</option><option value="pending">Waiting to confirm</option><option value="unsubscribed">Unsubscribed</option>
        </Select>
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setEmail(lookup.trim()); }}>
          <Input aria-label="Find by exact email address" type="search" placeholder="Find an exact email address" className="min-w-0 flex-1 sm:max-w-sm" value={lookup} onChange={(e) => { setLookup(e.target.value); if (!e.target.value) setEmail(""); }} />
          <Button type="submit">Find</Button>
        </form>
      </div>

      {loading && rows.length === 0 && <Skeleton className="h-40" />}
      {!loading && !error && rows.length === 0 && (
        <Empty icon={Users} title={email || filter !== "all" ? "No contacts match" : "No subscribers yet"} body={email || filter !== "all" ? "Try another status or address." : "Create an email signup campaign under Tools. People appear here once they enter their address, and become subscribed when they confirm."} />
      )}
      {rows.length > 0 && (
        <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead><tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-3"><th className="font-medium">Email</th><th className="font-medium">Status</th><th className="font-medium">Came from</th><th className="font-medium">Signed up</th><th className="font-medium">Email platform</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}>
              <td className="break-all">{c.firstName && <span className="mr-1 font-medium">{c.firstName}</span>}{c.email ?? c.phone ?? "–"}</td>
              <td><Badge tone={TONE[c.emailStatus]} dot>{STATUS_LABEL[c.emailStatus]}</Badge></td>
              <td className="text-ink-2">{where(c.source)}</td>
              <td className="num text-ink-2">{new Date(c.createdAt).toLocaleDateString()}</td>
              <td>{(c.sync ?? []).length === 0 ? <span className="text-ink-3">–</span> : <span className="flex flex-wrap gap-1">{(c.sync ?? []).map((s) => { const l = syncLabel(s); return <span key={s.provider} title={s.error ?? undefined}><Badge tone={l.tone}>{l.text}</Badge></span>; })}</span>}</td>
              <td className="text-right">
                {erasing === c.id
                  ? <span className="inline-flex gap-2"><Button variant="danger" onClick={() => void erase(c.id)}>Erase for good</Button><Button variant="ghost" onClick={() => setErasing(null)}>Cancel</Button></span>
                  : <Button variant="ghost" aria-label={`Erase ${c.email ?? c.phone ?? "contact"}`} onClick={() => setErasing(c.id)}>Erase</Button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
        </div>
        </div>
      )}
      {cursor && <div className="mt-4"><Button onClick={() => void more()} busy={loading}>Load more</Button></div>}
      <p className="mt-8 text-xs leading-relaxed text-ink-3">Erasing deletes the contact and their consent history, and takes them off any connected Klaviyo or Mailchimp list (their profile there is not deleted). If they had unsubscribed, a hashed entry (not their address) stays so they are never re-added by mistake.</p>
    </>
  );
}

export default function Page() {
  return <NeedStore>{(s) => <View store={s} />}</NeedStore>;
}
