"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api, ApiError, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Button, ErrorNote, Field, Input, Select } from "./ui";

interface Link { id: string; kind: "complement" | "alternative"; weight: number; product: { id: string; title: string }; related: { id: string; title: string } }
interface CatalogRow { id: string; externalId: string; title: string }

const KIND_LABEL = { complement: "Goes well with", alternative: "Alternative to" } as const;

/**
 * The links the "Goes well with" and "Alternatives when sold out" recommendation sources use. A merchant sets them by hand;
 * nothing is inferred. Linking only works between products in this store's catalog.
 */
export function ProductLinks({ store }: { store: Store }) {
  const links = useApi<Link[]>(`/api/v1/stores/${store.id}/relationships`);
  const catalog = useApi<CatalogRow[]>(`/api/v1/stores/${store.id}/products`);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<Link["kind"]>("complement");
  const [weight, setWeight] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/stores/${store.id}/relationships`;
  const products = catalog.data ?? [];

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy("add"); setError(null);
    try {
      await api(base, { method: "POST", body: { productId: from, relatedProductId: to, kind, weight } });
      setTo(""); await links.reload();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save the link"); } finally { setBusy(null); }
  }
  async function remove(id: string) {
    setBusy(id); setError(null);
    try { await api(`${base}/${id}`, { method: "DELETE" }); await links.reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not remove the link"); } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="links-heading" className="mt-10">
      <h2 id="links-heading" className="mb-2 font-display text-sm font-bold uppercase tracking-[0.14em]">Product links</h2>
      <p className="mb-4 max-w-2xl text-sm text-ink-2">Tell recommendations which products go together, or which to offer when one is sold out. Higher weight is shown first. Only products from your catalog can be linked.</p>
      <ErrorNote error={error ?? links.error ?? catalog.error} />
      {products.length < 2 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 px-5 py-8 text-center text-sm text-ink-2">Import at least two products into your catalog (Settings) to link them.</p>
      ) : (
        <form className="grid max-w-3xl gap-3 sm:grid-cols-[1fr_9rem_1fr_6rem_auto] sm:items-end" onSubmit={add}>
          <Field label="Product"><Select required value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose…</option>{products.map((p) => <option key={p.id} value={p.externalId}>{p.title}</option>)}</Select></Field>
          <Field label="Relationship"><Select value={kind} onChange={(e) => setKind(e.target.value as Link["kind"])}><option value="complement">Goes well with</option><option value="alternative">Alternative to</option></Select></Field>
          <Field label="Other product"><Select required value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{products.filter((p) => p.externalId !== from).map((p) => <option key={p.id} value={p.externalId}>{p.title}</option>)}</Select></Field>
          <Field label="Weight"><Input type="number" min={0} max={1000} value={weight} onChange={(e) => setWeight(Math.min(1000, Math.max(0, Math.trunc(Number(e.target.value) || 0))))} /></Field>
          <Button type="submit" variant="primary" busy={busy === "add"} disabled={!from || !to}>Add link</Button>
        </form>
      )}

      {links.data && links.data.length > 0 && (
        <table className="mt-6 w-full text-sm">
          <caption className="sr-only">Product links</caption>
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="py-2 font-medium">Product</th><th className="font-medium">Relationship</th><th className="font-medium">Other product</th><th className="font-medium">Weight</th><th className="w-10"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>{links.data.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="py-2.5">{l.product.title}</td><td>{KIND_LABEL[l.kind]}</td><td>{l.related.title}</td><td className="num">{l.weight}</td>
              <td><button type="button" aria-label={`Remove link from ${l.product.title} to ${l.related.title}`} disabled={busy === l.id} className="text-ink-3 hover:text-danger disabled:opacity-50" onClick={() => void remove(l.id)}><Trash2 className="size-4" /></button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {links.data && links.data.length === 0 && products.length >= 2 && <p className="mt-4 text-sm text-ink-3">No links yet.</p>}
    </section>
  );
}
